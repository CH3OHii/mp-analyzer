export type Role = "system" | "user" | "assistant" | "tool";

/** How a tool mutates the workbook: "no" = read-only, "soft" = normal write
 *  (respects auto-apply), "hard" = destructive (always asks). */
export type MutKind = "no" | "soft" | "hard";

export interface ToolCall {
  id: string;
  /** "builtin_function" = provider-executed tool (Kimi $web_search) — the type
   *  must survive the round-trip or the echo protocol breaks. */
  type: "function" | "builtin_function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: Role;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  /** Reasoning/thinking text — display only, never sent back to the provider. */
  reasoning?: string;
}

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/** What actually goes on the wire in `tools` — function tools plus the
 *  provider-native web-search entries. */
export type WireTool =
  | ToolDef
  | { type: "builtin_function"; function: { name: string } }
  | { type: "web_search"; web_search: Record<string, unknown> };

export interface ProviderQuirks {
  /** Provider honors stream_options: { include_usage: true } */
  supportsStreamOptionsUsage: boolean;
  /** Extra request-body fields this provider needs (e.g. Qwen3 enable_thinking:false) */
  extraBody?: Record<string, unknown>;
  /** Server-side web search mechanism, when the provider has one:
   *  kimi-builtin = $web_search builtin_function (client echoes args back),
   *  glm-tool     = {type:"web_search"} tools entry,
   *  qwen-flag    = enable_search request-body flag. */
  webSearch?: "kimi-builtin" | "glm-tool" | "qwen-flag";
}

export type ProviderId = "deepseek" | "kimi" | "glm" | "qwen" | "minimax" | "custom";

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  /** [0] is the default (CN endpoint); alternates (intl) follow. */
  baseUrls: string[];
  defaultModel: string;
  /** Suggestions only — the model field stays free text (ids drift quarterly). */
  models: string[];
  quirks: ProviderQuirks;
  /** USD per 1M tokens [input, output] — rough estimate, prices drift. */
  price?: { input: number; output: number };
  defaultUseProxy?: boolean;
}

export interface LlmSettings {
  providerId: ProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
  useProxy: boolean;
  proxyUrl: string;
  temperature: number;
  maxTokens: number;
}

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool_calls"; calls: ToolCall[] }
  | { type: "usage"; prompt: number; completion: number }
  | { type: "done"; finishReason: string };
