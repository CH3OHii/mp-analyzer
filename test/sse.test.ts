import { describe, expect, it } from "vitest";
import { SseAccumulator } from "../src/llm/sse";
import type { StreamEvent } from "../src/llm/types";

const enc = new TextEncoder();

function ev(chunk: object): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}
function textDelta(content: string): string {
  return ev({ choices: [{ delta: { content } }] });
}
function collect(acc: SseAccumulator, ...chunks: (string | Uint8Array)[]): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const c of chunks) events.push(...acc.feed(typeof c === "string" ? enc.encode(c) : c));
  events.push(...acc.finish());
  return events;
}
function textOf(events: StreamEvent[]): string {
  return events.filter((e) => e.type === "text").map((e: any) => e.delta).join("");
}

describe("SseAccumulator", () => {
  it("parses simple text deltas", () => {
    const events = collect(new SseAccumulator(), textDelta("Hello"), textDelta(" world"), "data: [DONE]\n\n");
    expect(textOf(events)).toBe("Hello world");
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "stop" });
  });

  it("survives a chunk boundary in the middle of a CJK multibyte sequence", () => {
    const bytes = enc.encode(textDelta("渗透率分析"));
    // split inside the UTF-8 bytes of a CJK char (each is 3 bytes; header is ASCII)
    const cut = bytes.length - 10;
    const events = collect(new SseAccumulator(), bytes.slice(0, cut), bytes.slice(cut));
    expect(textOf(events)).toBe("渗透率分析");
  });

  it("handles multiple events in one chunk and CRLF separators", () => {
    const chunk = textDelta("a") + `data: ${JSON.stringify({ choices: [{ delta: { content: "b" } }] })}\r\n\r\n` + textDelta("c");
    const events = collect(new SseAccumulator(), chunk);
    expect(textOf(events)).toBe("abc");
  });

  it("assembles fragmented tool calls keyed by index", () => {
    const acc = new SseAccumulator();
    const events = collect(
      acc,
      ev({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "read_range", arguments: "" } }] } }] }),
      ev({ choices: [{ delta: { tool_calls: [{ index: 1, id: "c2", function: { name: "find", arguments: '{"query":' } }] } }] }),
      ev({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"range":"A1:B2"}' } }] } }] }),
      ev({ choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '"NEV"}' } }] } }] }),
      ev({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })
    );
    const tc = events.find((e) => e.type === "tool_calls") as any;
    expect(tc.calls).toHaveLength(2);
    expect(tc.calls[0]).toMatchObject({ id: "c1", function: { name: "read_range", arguments: '{"range":"A1:B2"}' } });
    expect(tc.calls[1]).toMatchObject({ id: "c2", function: { name: "find", arguments: '{"query":"NEV"}' } });
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "tool_calls" });
  });

  it("handles tool-call deltas that omit index (continuation goes to last slot)", () => {
    const events = collect(
      new SseAccumulator(),
      ev({ choices: [{ delta: { tool_calls: [{ id: "x1", function: { name: "write_range", arguments: '{"start_cell":' } }] } }] }),
      ev({ choices: [{ delta: { tool_calls: [{ function: { arguments: '"B2","values":[[1]]}' } }] } }] })
    );
    const tc = events.find((e) => e.type === "tool_calls") as any;
    expect(tc.calls).toHaveLength(1);
    expect(tc.calls[0].function.arguments).toBe('{"start_cell":"B2","values":[[1]]}');
  });

  it("stringifies object-shaped arguments", () => {
    const events = collect(
      new SseAccumulator(),
      ev({ choices: [{ delta: { tool_calls: [{ index: 0, id: "a", function: { name: "find", arguments: { query: "x" } } }] } }] })
    );
    const tc = events.find((e) => e.type === "tool_calls") as any;
    expect(JSON.parse(tc.calls[0].function.arguments)).toEqual({ query: "x" });
  });

  it("emits usage from a final stats chunk with empty choices", () => {
    const events = collect(
      new SseAccumulator(),
      textDelta("hi"),
      ev({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 8 } }),
      "data: [DONE]\n\n"
    );
    expect(events).toContainEqual({ type: "usage", prompt: 120, completion: 8 });
  });

  it("parses a final block that lacks the trailing blank line", () => {
    const acc = new SseAccumulator();
    const events: StreamEvent[] = [...acc.feed(enc.encode("data: " + JSON.stringify({ choices: [{ delta: { content: "tail" } }] })))];
    events.push(...acc.finish());
    expect(textOf(events)).toBe("tail");
  });

  it("captures reasoning_content separately from text", () => {
    const events = collect(
      new SseAccumulator(),
      ev({ choices: [{ delta: { reasoning_content: "думаю... " } }] }),
      ev({ choices: [{ delta: { content: "answer" } }] })
    );
    expect(events.some((e) => e.type === "reasoning")).toBe(true);
    expect(textOf(events)).toBe("answer");
  });

  it("ignores keep-alive comments and garbage blocks", () => {
    const events = collect(new SseAccumulator(), ": ping\n\n", "data: {broken json\n\n", textDelta("ok"));
    expect(textOf(events)).toBe("ok");
  });
});
