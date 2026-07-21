import { fetchWithRetry } from "./retry";
import { SseAccumulator } from "./sse";
import type { ChatMessage, LlmSettings, ProviderQuirks, StreamEvent, ToolCall, ToolDef } from "./types";

export interface StreamResult {
  text: string;
  reasoning: string;
  toolCalls: ToolCall[];
  finishReason: string;
  usage: { prompt: number; completion: number } | null;
}

/** The entire direct↔proxy switch: prefix the target URL with the local proxy. */
export function effectiveBaseUrl(s: Pick<LlmSettings, "baseUrl" | "useProxy" | "proxyUrl">): string {
  const base = s.baseUrl.replace(/\/+$/, "");
  if (!s.useProxy) return base;
  return s.proxyUrl.replace(/\/+$/, "") + "/" + base;
}

/** Strip display-only fields; providers 400 on unknown keys like `reasoning`. */
export function sanitizeMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    const out: Record<string, unknown> = { role: m.role, content: m.content ?? "" };
    if (m.tool_calls?.length) out.tool_calls = m.tool_calls;
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
    return out;
  });
}

export async function streamChat(opts: {
  settings: LlmSettings;
  quirks: ProviderQuirks;
  messages: ChatMessage[];
  tools?: ToolDef[];
  signal?: AbortSignal;
  onEvent?: (ev: StreamEvent) => void;
}): Promise<StreamResult> {
  const { settings: s, quirks } = opts;
  // Least-common-denominator body; quirk flags add the rest per provider.
  const body: Record<string, unknown> = {
    model: s.model,
    messages: sanitizeMessages(opts.messages),
    stream: true,
    temperature: s.temperature,
    max_tokens: s.maxTokens,
  };
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }
  if (quirks.supportsStreamOptionsUsage) body.stream_options = { include_usage: true };
  if (quirks.extraBody) Object.assign(body, quirks.extraBody);

  // Transient 429/5xx/network failures retry with backoff. Retries only happen
  // here, before the body reader exists — a stream that already started fails loud.
  const res = await fetchWithRetry(
    () =>
      fetch(effectiveBaseUrl(s) + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.apiKey}` },
        body: JSON.stringify(body),
        signal: opts.signal,
      }),
    { signal: opts.signal }
  );
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText || ""} — ${text.slice(0, 400)}`);
  }

  const acc = new SseAccumulator();
  const result: StreamResult = { text: "", reasoning: "", toolCalls: [], finishReason: "", usage: null };
  const handle = (ev: StreamEvent) => {
    if (ev.type === "text") result.text += ev.delta;
    else if (ev.type === "reasoning") result.reasoning += ev.delta;
    else if (ev.type === "tool_calls") result.toolCalls = ev.calls;
    else if (ev.type === "usage") result.usage = { prompt: ev.prompt, completion: ev.completion };
    else if (ev.type === "done") result.finishReason = ev.finishReason;
    opts.onEvent?.(ev);
  };

  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of acc.feed(value)) handle(ev);
    }
  } finally {
    reader.releaseLock?.();
  }
  for (const ev of acc.finish()) handle(ev);
  return result;
}

/** Non-stream 1-token probe. A readable 401/404 still proves CORS passes —
 *  only a thrown network/TypeError means the browser blocked the call. */
export async function testConnection(
  s: LlmSettings,
  streaming = false
): Promise<{ ok: boolean; corsOk: boolean; status?: number; message: string }> {
  try {
    const res = await fetch(effectiveBaseUrl(s) + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.apiKey || "sk-cors-probe"}` },
      body: JSON.stringify({
        model: s.model || "test",
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: streaming,
      }),
    });
    const text = await res.text().catch(() => "");
    return {
      ok: res.ok,
      corsOk: true,
      status: res.status,
      message: res.ok ? "OK" : `HTTP ${res.status}: ${text.slice(0, 200)}`,
    };
  } catch (e) {
    return {
      ok: false,
      corsOk: false,
      message: `Network/CORS failure: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
