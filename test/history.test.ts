import { describe, expect, it } from "vitest";
import { ELIDED_RESULT, estimateHistoryTokens, estimateTokens, trimHistory } from "../src/agent/history";
import type { ChatMessage } from "../src/llm/types";

describe("estimateTokens", () => {
  it("counts CJK as 1/char and latin as 1/4chars", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("渗透率")).toBe(3);
    expect(estimateTokens("NEV渗透率2026")).toBeGreaterThanOrEqual(4);
    expect(estimateTokens("")).toBe(0);
  });
});

function toolTurn(userText: string, resultSize: number, callId: string): ChatMessage[] {
  return [
    { role: "user", content: userText },
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: callId, type: "function", function: { name: "read_range", arguments: '{"range":"A1:H50"}' } }],
    },
    { role: "tool", tool_call_id: callId, content: JSON.stringify({ values: "x".repeat(resultSize) }) },
    { role: "assistant", content: "分析完成 " + callId },
  ];
}

describe("trimHistory", () => {
  it("returns history untouched when under budget", () => {
    const h = toolTurn("hi", 100, "c1");
    const out = trimHistory(h, 100_000);
    expect(out).toHaveLength(h.length);
    expect(out[2].content).toContain("x");
  });

  it("elides old tool-result bodies but keeps the tool message paired", () => {
    const h = [...toolTurn("first", 8000, "c1"), ...toolTurn("second", 8000, "c2"), ...toolTurn("third", 200, "c3")];
    const budget = estimateHistoryTokens(h) - 1500; // force pass 1 only
    const out = trimHistory(h, budget);
    const firstTool = out.find((m) => m.tool_call_id === "c1")!;
    expect(firstTool).toBeDefined();
    expect(firstTool.content).toBe(ELIDED_RESULT);
    // every tool message still has a preceding assistant with matching tool_calls
    for (const m of out) {
      if (m.role === "tool") {
        const owner = out.find((a) => a.role === "assistant" && a.tool_calls?.some((tc) => tc.id === m.tool_call_id));
        expect(owner).toBeDefined();
      }
    }
  });

  it("drops middle exchanges, keeping the first user message and the last block", () => {
    const h = [...toolTurn("first", 4000, "c1"), ...toolTurn("second", 4000, "c2"), ...toolTurn("third", 4000, "c3")];
    const out = trimHistory(h, 300); // brutal budget → pass 2
    expect(out[0]).toMatchObject({ role: "user", content: "first" });
    expect(out.some((m) => m.role === "user" && m.content === "third")).toBe(true);
    expect(out.some((m) => m.role === "user" && m.content === "second")).toBe(false);
    for (const m of out) {
      if (m.role === "tool") {
        const owner = out.find((a) => a.role === "assistant" && a.tool_calls?.some((tc) => tc.id === m.tool_call_id));
        expect(owner).toBeDefined();
      }
    }
  });

  it("does not mutate the original history", () => {
    const h = toolTurn("first", 8000, "c1");
    const before = JSON.stringify(h);
    trimHistory(h, 10);
    expect(JSON.stringify(h)).toBe(before);
  });
});
