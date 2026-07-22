import type { StreamEvent, ToolCall } from "./types";

interface PartialCall {
  id: string;
  type: string;
  name: string;
  args: string;
}

/**
 * Incremental OpenAI-compatible SSE parser. Pure accumulation — feed() returns
 * the events found in each chunk; finish() flushes the tail and emits the
 * assembled tool calls plus the final done event.
 *
 * Defensive by design: CJK can split mid-multibyte across chunks (TextDecoder
 * stream mode), tool-call deltas may omit `index` (fall back to last-seen index,
 * or open a new slot when a fresh `id` appears), and `arguments` may arrive as
 * an object instead of a string on some providers.
 */
export class SseAccumulator {
  private decoder = new TextDecoder();
  private buffer = "";
  private calls = new Map<number, PartialCall>();
  private lastIndex: number | null = null;
  private finishReason = "";
  private finished = false;

  feed(chunk: Uint8Array): StreamEvent[] {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drain();
  }

  finish(): StreamEvent[] {
    if (this.finished) return [];
    this.finished = true;
    this.buffer += this.decoder.decode();
    const events = this.drain();
    // Some providers end the stream without a trailing blank line.
    if (this.buffer.trim()) {
      events.push(...this.parseBlock(this.buffer));
      this.buffer = "";
    }
    const calls = this.assembledCalls();
    if (calls.length) events.push({ type: "tool_calls", calls });
    events.push({
      type: "done",
      finishReason: this.finishReason || (calls.length ? "tool_calls" : "stop"),
    });
    return events;
  }

  private assembledCalls(): ToolCall[] {
    return [...this.calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, c]) => ({
        id: c.id || `call_${index}`,
        // Preserve the streamed type: Kimi's $web_search arrives as
        // "builtin_function", and replaying it as "function" breaks the echo.
        type: (c.type === "builtin_function" ? "builtin_function" : "function") as ToolCall["type"],
        function: { name: c.name, arguments: c.args },
      }))
      .filter((c) => c.function.name);
  }

  private drain(): StreamEvent[] {
    const events: StreamEvent[] = [];
    for (;;) {
      const m = /\r?\n\r?\n/.exec(this.buffer);
      if (!m) break;
      const raw = this.buffer.slice(0, m.index);
      this.buffer = this.buffer.slice(m.index + m[0].length);
      events.push(...this.parseBlock(raw));
    }
    return events;
  }

  private parseBlock(block: string): StreamEvent[] {
    const dataLines = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim());
    if (!dataLines.length) return []; // comments / keep-alives
    const payload = dataLines.join("\n");
    if (payload === "[DONE]") return [];

    let parsed: any;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return []; // partial garbage between events — skip
    }

    const events: StreamEvent[] = [];
    if (parsed?.usage && typeof parsed.usage.prompt_tokens === "number") {
      events.push({
        type: "usage",
        prompt: parsed.usage.prompt_tokens,
        completion: parsed.usage.completion_tokens ?? 0,
      });
    }
    const choice = parsed?.choices?.[0];
    if (!choice) return events;
    if (choice.finish_reason) this.finishReason = choice.finish_reason;

    const delta = choice.delta ?? choice.message ?? {};
    if (typeof delta.content === "string" && delta.content !== "") {
      events.push({ type: "text", delta: delta.content });
    }
    const reasoning = delta.reasoning_content ?? delta.reasoning;
    if (typeof reasoning === "string" && reasoning !== "") {
      events.push({ type: "reasoning", delta: reasoning });
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) this.accumulateToolCall(tc);
    }
    return events;
  }

  private accumulateToolCall(tc: any): void {
    let index: number;
    if (typeof tc?.index === "number") {
      index = tc.index;
    } else if (tc?.id && ![...this.calls.values()].some((c) => c.id === tc.id)) {
      index = this.calls.size; // fresh id, no index — open a new slot
    } else {
      index = this.lastIndex ?? 0; // continuation fragment
    }
    this.lastIndex = index;

    let slot = this.calls.get(index);
    if (!slot) {
      slot = { id: "", type: "", name: "", args: "" };
      this.calls.set(index, slot);
    }
    if (typeof tc?.id === "string" && tc.id) slot.id = tc.id;
    if (typeof tc?.type === "string" && tc.type) slot.type = tc.type;
    const fn = tc?.function ?? {};
    if (typeof fn.name === "string" && fn.name) {
      if (!slot.name) slot.name = fn.name;
      else if (fn.name !== slot.name) slot.name += fn.name; // fragmented name
    }
    if (fn.arguments != null) {
      if (typeof fn.arguments === "string") slot.args += fn.arguments;
      else slot.args = JSON.stringify(fn.arguments); // object-shaped arguments
    }
  }
}
