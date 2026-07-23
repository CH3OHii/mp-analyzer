import { useSyncExternalStore } from "react";
import type { PromptTemplate } from "../agent/promptTemplates";
import { getPreset } from "../llm/providers";
import type { LlmSettings, ProviderId } from "../llm/types";

export interface CustomPreset {
  id: string;
  nameEn: string;
  nameZh: string;
  body: string;
}

export interface AppSettings {
  llm: Omit<LlmSettings, "apiKey">;
  /** Keys are stored per provider so switching providers keeps each key.
   *  localStorage ONLY — never Office document settings (those travel inside
   *  shared .xlsx files and would leak the key). */
  apiKeys: Partial<Record<ProviderId, string>>;
  language: "en" | "zh";
  autoApply: boolean;
  /** Result verification: "basic" = deterministic read-back audit only,
   *  "full" = audit + one extra LLM review call per mutating turn. */
  verifyMode: "off" | "basic" | "full";
  contextBudgetTokens: number;
  maxIters: number;
  analysisPresetId: string | null;
  styleLayerOn: boolean;
  customPresets: CustomPreset[];
  /** Provider-native web search (Kimi/GLM/Qwen). Ignored where unsupported. */
  webSearchOn: boolean;
  /** User-authored prompt templates with {placeholder} tokens. */
  promptTemplates: PromptTemplate[];
  /** Independent reviewer model for verifyMode "full". null = review with the
   *  primary model. Its API key comes from the per-provider apiKeys map. */
  verifierLlm: null | { providerId: ProviderId; baseUrl: string; model: string; useProxy?: boolean };
}

const KEY = "mp-analyzer-settings-v1";

function defaults(): AppSettings {
  const kimi = getPreset("kimi");
  return {
    llm: {
      providerId: "kimi",
      baseUrl: kimi.baseUrls[0],
      model: kimi.defaultModel,
      useProxy: false,
      proxyUrl: "https://localhost:8788",
      temperature: 0.3,
      maxTokens: 4096,
    },
    apiKeys: {},
    language: "zh",
    autoApply: false,
    verifyMode: "full",
    contextBudgetTokens: 32000,
    maxIters: 15,
    analysisPresetId: null,
    styleLayerOn: false,
    customPresets: [],
    webSearchOn: false,
    promptTemplates: [],
    verifierLlm: null,
  };
}

function load(): AppSettings {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const p = JSON.parse(raw);
    return { ...d, ...p, llm: { ...d.llm, ...(p.llm ?? {}) }, apiKeys: { ...(p.apiKeys ?? {}) } };
  } catch {
    return d;
  }
}

let state: AppSettings = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage may be unavailable — settings survive in memory for the session */
  }
}

export function getSettings(): AppSettings {
  return state;
}

export function updateSettings(
  patch: Partial<Omit<AppSettings, "llm">> & { llm?: Partial<AppSettings["llm"]> }
): void {
  state = {
    ...state,
    ...patch,
    llm: patch.llm ? { ...state.llm, ...patch.llm } : state.llm,
    apiKeys: patch.apiKeys ? { ...state.apiKeys, ...patch.apiKeys } : state.apiKeys,
  };
  persist();
  listeners.forEach((l) => l());
}

/** Switch provider preset, filling endpoint + default model; per-provider keys persist. */
export function switchProvider(id: ProviderId): void {
  const p = getPreset(id);
  updateSettings({
    llm: {
      providerId: id,
      baseUrl: p.baseUrls[0] || state.llm.baseUrl,
      model: p.defaultModel || state.llm.model,
      useProxy: p.defaultUseProxy ?? false,
    },
  });
}

/** Full LLM settings with the current provider's key injected. */
export function effectiveLlm(s: AppSettings = state): LlmSettings {
  return { ...s.llm, apiKey: s.apiKeys[s.llm.providerId] ?? "" };
}

/** Resolve the reviewer model for the turn-end verification pass.
 *  Pure — unit-tested without the store. Falls back to the primary model when
 *  no reviewer is configured, or when the configured provider has no saved key
 *  (fellBackNoKey lets the loop surface a notice instead of failing silently). */
export function resolveVerifier(s: AppSettings = state): {
  llm: LlmSettings;
  providerId: ProviderId;
  isCross: boolean;
  fellBackNoKey: boolean;
} {
  const v = s.verifierLlm;
  if (!v) return { llm: effectiveLlm(s), providerId: s.llm.providerId, isCross: false, fellBackNoKey: false };
  const key = s.apiKeys[v.providerId] ?? "";
  if (!key) return { llm: effectiveLlm(s), providerId: s.llm.providerId, isCross: false, fellBackNoKey: true };
  return {
    llm: {
      providerId: v.providerId,
      baseUrl: v.baseUrl,
      model: v.model,
      apiKey: key,
      useProxy: v.useProxy ?? getPreset(v.providerId).defaultUseProxy ?? false,
      proxyUrl: s.llm.proxyUrl,
      // Sampling comes from the primary; runVerifierPass overrides to temp 0 / 1024 anyway.
      temperature: s.llm.temperature,
      maxTokens: s.llm.maxTokens,
    },
    providerId: v.providerId,
    isCross: true,
    fellBackNoKey: false,
  };
}

export function useSettings(): AppSettings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state
  );
}
