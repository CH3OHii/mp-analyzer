import { describe, expect, it } from "vitest";
import { buildRequestBody, effectiveBaseUrl, sanitizeMessages } from "../src/llm/client";
import { getPreset } from "../src/llm/providers";
import type { ChatMessage, LlmSettings, ToolDef } from "../src/llm/types";

function settingsFor(providerId: LlmSettings["providerId"], patch: Partial<LlmSettings> = {}): LlmSettings {
  return {
    providerId,
    baseUrl: "https://example.com/v1",
    model: "m",
    apiKey: "k",
    useProxy: false,
    proxyUrl: "https://localhost:8788",
    temperature: 0.3,
    maxTokens: 100,
    ...patch,
  };
}

const messages: ChatMessage[] = [{ role: "user", content: "hi" }];

const excelTool: ToolDef = {
  type: "function",
  function: { name: "read_range", description: "d", parameters: {} },
};

describe("buildRequestBody", () => {
  it("builds the least-common-denominator body", () => {
    const b = buildRequestBody({ settings: settingsFor("custom"), quirks: getPreset("custom").quirks, messages });
    expect(b).toEqual({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
      temperature: 0.3,
      max_tokens: 100,
    });
    expect(b.tools).toBeUndefined();
    expect(b.tool_choice).toBeUndefined();
  });

  it("adds stream_options only when the provider supports usage-in-stream", () => {
    const withIt = buildRequestBody({ settings: settingsFor("deepseek"), quirks: getPreset("deepseek").quirks, messages });
    expect(withIt.stream_options).toEqual({ include_usage: true });
    const without = buildRequestBody({ settings: settingsFor("glm"), quirks: getPreset("glm").quirks, messages });
    expect(without.stream_options).toBeUndefined();
  });

  it("merges provider extraBody (qwen enable_thinking:false)", () => {
    const b = buildRequestBody({ settings: settingsFor("qwen"), quirks: getPreset("qwen").quirks, messages });
    expect(b.enable_thinking).toBe(false);
  });

  it("qwen web-search flags are set AFTER the extraBody merge so both survive", () => {
    const b = buildRequestBody({
      settings: settingsFor("qwen"),
      quirks: getPreset("qwen").quirks,
      messages,
      webSearch: true,
    });
    expect(b.enable_thinking).toBe(false);
    expect(b.enable_search).toBe(true);
    expect(b.search_options).toEqual({ forced_search: false });
  });

  it("sends tool_choice only when a function tool is present", () => {
    const withFn = buildRequestBody({
      settings: settingsFor("kimi"),
      quirks: getPreset("kimi").quirks,
      messages,
      tools: [excelTool],
    });
    expect(withFn.tool_choice).toBe("auto");
    // GLM with only the web_search wire entry must NOT get tool_choice.
    const searchOnly = buildRequestBody({
      settings: settingsFor("glm"),
      quirks: getPreset("glm").quirks,
      messages,
      webSearch: true,
    });
    expect(searchOnly.tools).toHaveLength(1);
    expect(searchOnly.tool_choice).toBeUndefined();
  });
});

describe("sanitizeMessages", () => {
  it("strips display-only fields and null content, keeps tool wiring", () => {
    const msgs: ChatMessage[] = [
      { role: "assistant", content: null, reasoning: "chain of thought", tool_calls: [{ id: "1", type: "function", function: { name: "f", arguments: "{}" } }] },
      { role: "tool", content: "ok", tool_call_id: "1" },
    ];
    const out = sanitizeMessages(msgs);
    expect(out[0]).toEqual({
      role: "assistant",
      content: "",
      tool_calls: [{ id: "1", type: "function", function: { name: "f", arguments: "{}" } }],
    });
    expect(out[0].reasoning).toBeUndefined();
    expect(out[1]).toEqual({ role: "tool", content: "ok", tool_call_id: "1" });
  });
});

describe("effectiveBaseUrl", () => {
  it("returns the trimmed base directly when the proxy is off", () => {
    expect(effectiveBaseUrl({ baseUrl: "https://api.deepseek.com/", useProxy: false, proxyUrl: "" })).toBe(
      "https://api.deepseek.com"
    );
  });
  it("prefixes the proxy URL when on", () => {
    expect(
      effectiveBaseUrl({ baseUrl: "https://api.deepseek.com", useProxy: true, proxyUrl: "https://localhost:8788/" })
    ).toBe("https://localhost:8788/https://api.deepseek.com");
  });
});
