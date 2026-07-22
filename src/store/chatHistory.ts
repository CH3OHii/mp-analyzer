// Persisted chat history. NOTE: unrelated to src/agent/history.ts, which trims
// context for outgoing requests — this module stores past conversations.
//
// Pure core + thin localStorage shell: everything below the IO section is
// testable without a browser.
import { ELIDED_RESULT } from "../agent/history";
import type { ChatMessage } from "../llm/types";
import { getChat as getLiveChat, llmHistory, resetChat, restoreChat } from "./chatStore";
import type { ChatItem, ChatState } from "./chatStore";

export interface SavedChat {
  id: string;
  title: string;
  /** Workbook this chat was started against; null outside Excel. */
  workbook: string | null;
  createdAt: number;
  updatedAt: number;
  usage: { prompt: number; completion: number };
  items: ChatItem[];
  llmHistory: ChatMessage[];
}

/** List-view projection — the panel never needs the transcripts. */
export interface ChatSummary {
  id: string;
  title: string;
  workbook: string | null;
  updatedAt: number;
  messageCount: number;
}

export const MAX_CHATS = 50;
/** Above this, a single chat starts shedding old tool-result bodies. */
export const MAX_CHAT_BYTES = 150_000;
const FIELD_CLIP = 2000;
/** Recent tool results are never elided — they are what makes a resume useful. */
const KEEP_TOOL_TAIL = 6;

const STORAGE_KEY = "mp-analyzer-chats-v1";

// ---------------------------------------------------------------- pure core

/** First user message → title. Collapses whitespace, keeps it short. */
export function makeTitle(items: ChatItem[]): string {
  const first = items.find((it) => it.kind === "user");
  const text = first && first.kind === "user" ? first.text.replace(/\s+/g, " ").trim() : "";
  if (!text) return "";
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

export function countMessages(items: ChatItem[]): number {
  return items.filter((it) => it.kind === "user" || it.kind === "assistant").length;
}

function clip(s: string | undefined, n = FIELD_CLIP): string | undefined {
  if (s == null) return s;
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Drop transient approval UI and clip unbounded strings before storing. */
export function compactItems(items: ChatItem[]): ChatItem[] {
  return items.map((it) => {
    if (it.kind !== "tool") return it;
    // `preview` holds before/after grids for the approval gate — worthless in a
    // transcript and by far the largest field on a card.
    const { preview: _drop, ...card } = it.card;
    return {
      ...it,
      card: { ...card, argsRaw: clip(card.argsRaw) ?? "", resultSummary: clip(card.resultSummary) },
    };
  });
}

export function chatBytes(chat: SavedChat): number {
  return JSON.stringify(chat).length;
}

/**
 * Shed old tool-result bodies until the chat fits. Free in fidelity: trimHistory
 * elides these same old bodies before sending, so a resumed chat puts exactly
 * what a live one would on the wire.
 */
export function shrinkChat(chat: SavedChat, maxBytes = MAX_CHAT_BYTES): SavedChat {
  if (chatBytes(chat) <= maxBytes) return chat;
  const llmHistory = chat.llmHistory.map((m) => ({ ...m }));
  const limit = llmHistory.length - KEEP_TOOL_TAIL;
  let out = { ...chat, llmHistory };
  for (let i = 0; i < limit; i++) {
    const m = llmHistory[i];
    if (m.role === "tool" && m.content && m.content !== ELIDED_RESULT) {
      m.content = ELIDED_RESULT;
      out = { ...chat, llmHistory };
      if (chatBytes(out) <= maxBytes) return out;
    }
  }
  return out;
}

/** Newest first, capped. */
export function evict(chats: SavedChat[], max = MAX_CHATS): SavedChat[] {
  return [...chats].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, max);
}

export function upsert(chats: SavedChat[], chat: SavedChat): SavedChat[] {
  const rest = chats.filter((c) => c.id !== chat.id);
  return evict([chat, ...rest]);
}

export function toSummary(c: SavedChat): ChatSummary {
  return {
    id: c.id,
    title: c.title,
    workbook: c.workbook,
    updatedAt: c.updatedAt,
    messageCount: countMessages(c.items),
  };
}

/**
 * Strip per-session state that must NOT survive a restore. stepId is the
 * critical one: the undo stack (src/excel/snapshot.ts) numbers steps from
 * step_1 on every pane load, so a restored card holding an old id would offer
 * a Revert button wired to an unrelated edit in the CURRENT session.
 */
export function sanitizeRestored(items: ChatItem[]): ChatItem[] {
  return items.map((it) => {
    if (it.kind !== "tool") return it;
    const { stepId: _drop, ...card } = it.card;
    return { ...it, card };
  });
}

// ------------------------------------------------------------------- IO shell

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // storage disabled by policy
  }
}

export function loadAll(store: StorageLike | null = browserStorage()): SavedChat[] {
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedChat[]) : [];
  } catch {
    return []; // corrupt payload — history is disposable, never throw
  }
}

/** Persist, shedding oldest chats if the browser refuses the write. */
export function persist(chats: SavedChat[], store: StorageLike | null = browserStorage()): boolean {
  if (!store) return false;
  let working = evict(chats);
  for (;;) {
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(working));
      return true;
    } catch {
      if (working.length <= 1) return false;
      working = working.slice(0, -1); // drop the oldest and retry
    }
  }
}

// ------------------------------------------------------------- session state

let currentId: string | null = null;
let seq = 0;
let workbookName: string | null = null;
let workbookResolved = false;

/** Cached once per pane session — the pane is bound to one document. */
async function resolveWorkbookName(): Promise<string | null> {
  if (workbookResolved) return workbookName;
  workbookResolved = true;
  try {
    const { hasExcel, runExcel } = await import("../excel/env");
    if (!hasExcel()) return null;
    workbookName = await runExcel(async (ctx) => {
      ctx.workbook.load("name");
      await ctx.sync();
      return ctx.workbook.name;
    });
  } catch {
    workbookName = null;
  }
  return workbookName;
}

export function listChats(): ChatSummary[] {
  return evict(loadAll()).map(toSummary);
}

export function getChat(id: string): SavedChat | null {
  return loadAll().find((c) => c.id === id) ?? null;
}

export function deleteChat(id: string): void {
  persist(loadAll().filter((c) => c.id !== id));
  if (currentId === id) currentId = null;
}

export function clearAllChats(): void {
  persist([]);
  currentId = null;
}

/** Forget which record the live conversation maps to (New chat / restore). */
export function setCurrentChatId(id: string | null): void {
  currentId = id;
}

export function getCurrentChatId(): string | null {
  return currentId;
}

/**
 * Upsert the live conversation. Called after every settled turn and before
 * New chat, so an interrupted or failed turn is still recoverable.
 */
export async function saveCurrentChat(state: ChatState, llmHistory: ChatMessage[]): Promise<void> {
  if (!state.items.some((it) => it.kind === "user")) return; // nothing worth keeping
  const now = Date.now();
  const existing = currentId ? getChat(currentId) : null;
  if (!currentId) currentId = `chat_${now}_${++seq}`;
  const chat: SavedChat = shrinkChat({
    id: currentId,
    title: makeTitle(state.items) || existing?.title || "",
    workbook: existing?.workbook ?? (await resolveWorkbookName()),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    usage: state.usage,
    items: compactItems(state.items),
    llmHistory: llmHistory.map((m) => ({ ...m })),
  });
  persist(upsert(loadAll(), chat));
}

/** New chat: bank the outgoing conversation first, then clear. */
export async function newChatWithSave(): Promise<void> {
  await saveCurrentChat(getLiveChat(), llmHistory).catch(() => {});
  currentId = null;
  resetChat();
}

/** Open a past chat: bank the current one, then load the saved transcript and
 *  its model-side context. Subsequent turns update the reopened record. */
export async function openChat(id: string): Promise<boolean> {
  const saved = getChat(id);
  if (!saved) return false;
  await saveCurrentChat(getLiveChat(), llmHistory).catch(() => {});
  restoreChat(sanitizeRestored(saved.items), saved.llmHistory, saved.usage);
  currentId = saved.id;
  return true;
}
