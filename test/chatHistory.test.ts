import { describe, expect, it } from "vitest";
import { ELIDED_RESULT } from "../src/agent/history";
import {
  chatBytes,
  compactItems,
  countMessages,
  evict,
  loadAll,
  makeTitle,
  MAX_CHATS,
  persist,
  sanitizeRestored,
  shrinkChat,
  toSummary,
  upsert,
  type SavedChat,
  type StorageLike,
} from "../src/store/chatHistory";
import type { ChatItem } from "../src/store/chatStore";

function userItem(id: number, text: string): ChatItem {
  return { kind: "user", id, text };
}
function toolItem(id: number, over: Partial<ChatItem & { card: any }> = {}): ChatItem {
  return {
    kind: "tool",
    id,
    card: {
      id,
      callId: `c${id}`,
      name: "write_range",
      argsRaw: "{}",
      status: "applied",
      mutating: "soft",
      stepId: `step_${id}`,
      preview: { before: [["a"]], after: [["b"]], cells: 1 },
      resultSummary: "ok",
      ...(over as any).card,
    },
  } as ChatItem;
}

function chat(over: Partial<SavedChat> = {}): SavedChat {
  return {
    id: "chat_1",
    title: "t",
    workbook: null,
    createdAt: 1,
    updatedAt: 1,
    usage: { prompt: 0, completion: 0 },
    items: [],
    llmHistory: [],
    ...over,
  };
}

function memStore(): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe("makeTitle", () => {
  it("uses the first user message and collapses whitespace", () => {
    expect(makeTitle([userItem(1, "  分析\n\n  NEV 销量  ")])).toBe("分析 NEV 销量");
  });

  it("truncates long titles with an ellipsis", () => {
    const t = makeTitle([userItem(1, "x".repeat(80))]);
    expect(t).toHaveLength(41); // 40 chars + …
    expect(t.endsWith("…")).toBe(true);
  });

  it("ignores non-user items and returns empty when there is no user message", () => {
    expect(makeTitle([{ kind: "notice", id: 1, text: "hi" } as ChatItem])).toBe("");
    expect(makeTitle([])).toBe("");
  });
});

describe("compactItems", () => {
  it("drops the preview grid and clips unbounded fields", () => {
    const big = toolItem(1, { card: { argsRaw: "a".repeat(5000), resultSummary: "r".repeat(5000) } } as any);
    const [out] = compactItems([big]) as any[];
    expect(out.card.preview).toBeUndefined();
    expect(out.card.argsRaw.length).toBe(2001); // 2000 + …
    expect(out.card.resultSummary.length).toBe(2001);
  });

  it("leaves non-tool items untouched", () => {
    const items = [userItem(1, "hello")];
    expect(compactItems(items)).toEqual(items);
  });
});

describe("sanitizeRestored", () => {
  it("strips stepId so a restored card can never revert a live session step", () => {
    const [out] = sanitizeRestored([toolItem(3)]) as any[];
    expect(out.card.stepId).toBeUndefined();
    expect(out.card.name).toBe("write_range"); // everything else survives
  });
});

describe("shrinkChat", () => {
  const bigHistory = () =>
    Array.from({ length: 20 }, (_, i) => ({
      role: "tool" as const,
      tool_call_id: `c${i}`,
      content: "x".repeat(2000),
    }));

  it("elides oldest tool bodies until the chat fits, keeping the recent tail", () => {
    const out = shrinkChat(chat({ llmHistory: bigHistory() }), 20_000);
    expect(chatBytes(out)).toBeLessThanOrEqual(20_000);
    expect(out.llmHistory[0].content).toBe(ELIDED_RESULT);
    expect(out.llmHistory.at(-1)!.content).toBe("x".repeat(2000)); // tail preserved
  });

  it("stops at the protected tail rather than gutting recent context", () => {
    // The last 6 tool results are never elided, so they are a hard floor —
    // persist()'s quota fallback, not shrinkChat, is the backstop past this.
    const out = shrinkChat(chat({ llmHistory: bigHistory() }), 1000);
    expect(chatBytes(out)).toBeGreaterThan(1000);
    expect(out.llmHistory.slice(0, 14).every((m) => m.content === ELIDED_RESULT)).toBe(true);
    expect(out.llmHistory.slice(14).every((m) => m.content === "x".repeat(2000))).toBe(true);
  });

  it("returns the chat untouched when it already fits", () => {
    const c = chat({ llmHistory: [{ role: "tool", tool_call_id: "c", content: "small" }] });
    expect(shrinkChat(c, 100_000)).toBe(c);
  });
});

describe("evict / upsert", () => {
  it("sorts newest first and enforces the cap", () => {
    const many = Array.from({ length: MAX_CHATS + 10 }, (_, i) => chat({ id: `c${i}`, updatedAt: i }));
    const out = evict(many);
    expect(out).toHaveLength(MAX_CHATS);
    expect(out[0].id).toBe(`c${MAX_CHATS + 9}`); // newest
    expect(out.some((c) => c.id === "c0")).toBe(false); // oldest evicted
  });

  it("replaces an existing chat in place rather than duplicating it", () => {
    const before = [chat({ id: "a", updatedAt: 1 }), chat({ id: "b", updatedAt: 2 })];
    const out = upsert(before, chat({ id: "a", updatedAt: 3, title: "updated" }));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: "a", title: "updated" });
  });
});

describe("persist / loadAll", () => {
  it("round-trips through storage", () => {
    const store = memStore();
    const c = chat({ id: "x", items: [userItem(1, "hi")] });
    expect(persist([c], store)).toBe(true);
    expect(loadAll(store)).toEqual([c]);
  });

  it("sheds the oldest chats when storage rejects the write", () => {
    let allow = false;
    const store: StorageLike = {
      getItem: () => null,
      setItem: (_k, v) => {
        // Accept only once the payload is down to a single chat.
        if (!allow && JSON.parse(v).length > 1) throw new Error("QuotaExceededError");
        allow = true;
      },
    };
    const chats = [chat({ id: "new", updatedAt: 5 }), chat({ id: "old", updatedAt: 1 })];
    expect(persist(chats, store)).toBe(true);
  });

  it("treats corrupt or absent payloads as an empty history", () => {
    const store = memStore();
    expect(loadAll(store)).toEqual([]);
    store.data["mp-analyzer-chats-v1"] = "{not json";
    expect(loadAll(store)).toEqual([]);
    store.data["mp-analyzer-chats-v1"] = '{"shape":"wrong"}';
    expect(loadAll(store)).toEqual([]);
  });

  it("degrades quietly when storage is unavailable", () => {
    expect(loadAll(null)).toEqual([]);
    expect(persist([chat()], null)).toBe(false);
  });
});

describe("toSummary", () => {
  it("counts only user and assistant turns", () => {
    const items = [
      userItem(1, "q"),
      { kind: "assistant", id: 2, text: "a", reasoning: "", streaming: false } as ChatItem,
      toolItem(3),
      { kind: "notice", id: 4, text: "n" } as ChatItem,
    ];
    expect(countMessages(items)).toBe(2);
    expect(toSummary(chat({ items }))).toMatchObject({ messageCount: 2 });
  });
});
