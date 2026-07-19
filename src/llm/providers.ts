import type { ProviderId, ProviderPreset } from "./types";

// Model ids and prices drift quarterly — the model field in Settings stays free
// text and the price table is labeled an estimate in the UI.
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "kimi",
    label: "Kimi (Moonshot)",
    baseUrls: ["https://api.moonshot.cn/v1", "https://api.moonshot.ai/v1"],
    defaultModel: "kimi-k2-0905-preview",
    models: ["kimi-k2-0905-preview", "kimi-k2-turbo-preview", "kimi-latest"],
    quirks: { supportsStreamOptionsUsage: true },
    price: { input: 0.6, output: 2.5 },
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrls: ["https://api.deepseek.com"],
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    quirks: { supportsStreamOptionsUsage: true },
    price: { input: 0.28, output: 0.42 },
  },
  {
    id: "glm",
    label: "GLM (Zhipu)",
    baseUrls: ["https://open.bigmodel.cn/api/paas/v4"],
    defaultModel: "glm-4.6",
    models: ["glm-4.6", "glm-4.5", "glm-4.5-air"],
    quirks: { supportsStreamOptionsUsage: false },
    price: { input: 0.6, output: 2.2 },
  },
  {
    id: "qwen",
    label: "Qwen (DashScope)",
    baseUrls: [
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    ],
    defaultModel: "qwen3-max",
    models: ["qwen3-max", "qwen-plus", "qwen-flash"],
    quirks: { supportsStreamOptionsUsage: true, extraBody: { enable_thinking: false } },
    price: { input: 1.2, output: 6 },
  },
  {
    id: "minimax",
    label: "MiniMax",
    baseUrls: ["https://api.minimaxi.com/v1", "https://api.minimax.io/v1"],
    defaultModel: "MiniMax-M2",
    models: ["MiniMax-M2", "MiniMax-Text-01"],
    quirks: { supportsStreamOptionsUsage: false },
    price: { input: 0.3, output: 1.2 },
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    baseUrls: [""],
    defaultModel: "",
    models: [],
    quirks: { supportsStreamOptionsUsage: false },
  },
];

export function getPreset(id: ProviderId): ProviderPreset {
  return PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1];
}
