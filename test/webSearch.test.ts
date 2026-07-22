import { describe, expect, it } from "vitest";
import { buildWebSearchEcho, displayQuery, isWebSearchCall } from "../src/agent/webSearch";
import { buildRequestBody } from "../src/llm/client";
import { getPreset } from "../src/llm/providers";
import type { ChatMessage, LlmSettings, ToolCall, ToolDef } from "../src/llm/types";

const messages: ChatMessage[] = [{ role: "user", content: "hi" }];

function settingsFor(providerId: LlmSettings["providerId"]): LlmSettings {
  return {
    providerId,
    baseUrl: "https://example.com/v1",
    model: "m",
    apiKey: "k",
    useProxy: false,
    proxyUrl: "",
    temperature: 0.3,
    maxTokens: 100,
  };
}

const excelTool: ToolDef = {
  type: "function",
  function: { name: "read_range", description: "d", parameters: {} },
};

function body(providerId: LlmSettings["providerId"], opts: { tools?: ToolDef[]; webSearch?: boolean }) {
  return buildRequestBody({
    settings: settingsFor(providerId),
    quirks: getPreset(providerId).quirks,
    messages,
    ...opts,
  });
}

describe("buildRequestBody web search", () => {
  it("kimi: appends the $web_search builtin alongside excel tools, keeps tool_choice", () => {
    const b = body("kimi", { tools: [excelTool], webSearch: true });
    const tools = b.tools as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(2);
    expect(tools[1]).toEqual({ type: "builtin_function", function: { name: "$web_search" } });
    expect(b.tool_choice).toBe("auto");
  });

  it("kimi: search works tool-less (browser preview) without tool_choice", () => {
    const b = body("kimi", { webSearch: true });
    const tools = b.tools as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(1);
    expect(tools[0].type).toBe("builtin_function");
    expect(b.tool_choice).toBeUndefined(); // no function tool present
  });

  it("glm: appends a web_search tools entry, no tool_choice when it is alone", () => {
    const b = body("glm", { webSearch: true });
    const tools = b.tools as Array<Record<string, unknown>>;
    expect(tools).toEqual([{ type: "web_search", web_search: { enable: true, search_result: true } }]);
    expect(b.tool_choice).toBeUndefined();
  });

  it("qwen: sets enable_search flags and they survive the extraBody merge", () => {
    const b = body("qwen", { webSearch: true });
    expect(b.enable_search).toBe(true);
    expect(b.search_options).toEqual({ forced_search: false });
    expect(b.enable_thinking).toBe(false); // quirk extraBody still present
    expect(b.tools).toBeUndefined();
  });

  it("adds nothing when the toggle is off or the provider is unsupported", () => {
    expect(body("kimi", { tools: [excelTool], webSearch: false }).tools).toHaveLength(1);
    const ds = body("deepseek", { webSearch: true });
    expect(ds.tools).toBeUndefined();
    expect(ds.enable_search).toBeUndefined();
    const mm = body("minimax", { webSearch: true });
    expect(mm.tools).toBeUndefined();
  });
});

describe("$web_search echo", () => {
  it("recognizes only the exact builtin name", () => {
    expect(isWebSearchCall("$web_search")).toBe(true);
    expect(isWebSearchCall("web_search")).toBe(false);
    expect(isWebSearchCall("read_range")).toBe(false);
  });

  it("echoes arguments byte-for-byte, including hostile payloads", () => {
    const hostile = [
      '{"query":"NEV 政策 2026","extra":{"nested":true}}',
      '{"query":"trailing", }', // invalid JSON — must still echo untouched
      '{"query":"”full-width quotes“"}',
      `{"blob":"${"x".repeat(50_000)}"}`, // huge — must not be clipped
    ];
    for (const args of hostile) {
      const tc: ToolCall = { id: "c1", type: "builtin_function", function: { name: "$web_search", arguments: args } };
      const echo = buildWebSearchEcho(tc);
      expect(echo).toEqual({ role: "tool", tool_call_id: "c1", content: args });
      expect(echo.content).toBe(args); // identity, not a normalized copy
    }
  });

  it("displayQuery is best-effort and never throws", () => {
    expect(displayQuery('{"query":"比亚迪 7月 销量"}')).toBe("比亚迪 7月 销量");
    expect(displayQuery('{"search_query":"policy"}')).toBe("policy");
    expect(displayQuery("not json")).toBeUndefined();
    expect(displayQuery("{}")).toBeUndefined();
  });
});
