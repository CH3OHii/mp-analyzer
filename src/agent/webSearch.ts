// Kimi/Moonshot $web_search protocol: the model emits a builtin_function tool
// call; the client sends the call's arguments back VERBATIM as the tool result
// and Moonshot executes the search server-side on the next request. GLM and
// Qwen searches are fully server-side and never reach this module.
import type { ChatMessage, ToolCall } from "../llm/types";

export const WEB_SEARCH_TOOL_NAME = "$web_search";

export function isWebSearchCall(name: string): boolean {
  return name === WEB_SEARCH_TOOL_NAME;
}

/** Byte-exact echo — the arguments string must NEVER pass through
 *  repairToolArgs/validateArgs/toToolResultString, which normalize or clip. */
export function buildWebSearchEcho(tc: ToolCall): ChatMessage {
  return { role: "tool", tool_call_id: tc.id, content: tc.function.arguments };
}

/** Best-effort query extraction for the tool card ONLY — display, not wire. */
export function displayQuery(argsRaw: string): string | undefined {
  try {
    const o = JSON.parse(argsRaw) as Record<string, unknown>;
    const q = o?.query ?? o?.search_query ?? o?.q;
    return typeof q === "string" && q ? q : undefined;
  } catch {
    return undefined;
  }
}
