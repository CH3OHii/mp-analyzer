import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveVerifier, type AppSettings } from "../src/store/settings";

function baseSettings(patch: Partial<AppSettings> = {}): AppSettings {
  return {
    llm: {
      providerId: "kimi",
      baseUrl: "https://api.moonshot.cn/v1",
      model: "kimi-k2-0905-preview",
      useProxy: false,
      proxyUrl: "https://localhost:8788",
      temperature: 0.3,
      maxTokens: 4096,
    },
    apiKeys: { kimi: "kimi-key" },
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
    ...patch,
  };
}

describe("resolveVerifier", () => {
  it("null verifierLlm resolves to the primary model, not cross", () => {
    const s = baseSettings();
    const v = resolveVerifier(s);
    expect(v.isCross).toBe(false);
    expect(v.fellBackNoKey).toBe(false);
    expect(v.providerId).toBe("kimi");
    expect(v.llm.model).toBe("kimi-k2-0905-preview");
    expect(v.llm.apiKey).toBe("kimi-key");
  });

  it("configured verifier with a saved key resolves cross, inheriting proxy and sampling from primary", () => {
    const s = baseSettings({
      apiKeys: { kimi: "kimi-key", deepseek: "ds-key" },
      verifierLlm: { providerId: "deepseek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
    });
    const v = resolveVerifier(s);
    expect(v.isCross).toBe(true);
    expect(v.fellBackNoKey).toBe(false);
    expect(v.providerId).toBe("deepseek");
    expect(v.llm).toMatchObject({
      providerId: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "ds-key",
      proxyUrl: "https://localhost:8788",
      temperature: 0.3,
      maxTokens: 4096,
    });
  });

  it("configured verifier without a saved key falls back to primary and flags it", () => {
    const s = baseSettings({
      verifierLlm: { providerId: "deepseek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
    });
    const v = resolveVerifier(s);
    expect(v.isCross).toBe(false);
    expect(v.fellBackNoKey).toBe(true);
    expect(v.providerId).toBe("kimi");
    expect(v.llm.apiKey).toBe("kimi-key");
  });

  it("custom provider passes its baseUrl through and honors explicit useProxy", () => {
    const s = baseSettings({
      apiKeys: { kimi: "kimi-key", custom: "c-key" },
      verifierLlm: { providerId: "custom", baseUrl: "https://my.gateway/v1", model: "my-model", useProxy: true },
    });
    const v = resolveVerifier(s);
    expect(v.isCross).toBe(true);
    expect(v.llm.baseUrl).toBe("https://my.gateway/v1");
    expect(v.llm.useProxy).toBe(true);
    expect(v.llm.apiKey).toBe("c-key");
  });

  it("verifier on the same provider as primary reuses that provider's key", () => {
    const s = baseSettings({
      verifierLlm: { providerId: "kimi", baseUrl: "https://api.moonshot.cn/v1", model: "kimi-latest" },
    });
    const v = resolveVerifier(s);
    expect(v.isCross).toBe(true);
    expect(v.llm.model).toBe("kimi-latest");
    expect(v.llm.apiKey).toBe("kimi-key");
  });
});

describe("settings persistence merge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function loadStoreWith(persisted: unknown) {
    vi.resetModules();
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify(persisted),
      setItem: () => {},
      removeItem: () => {},
    });
    return await import("../src/store/settings");
  }

  it("old persisted settings without verifierLlm default it to null", async () => {
    const mod = await loadStoreWith({ language: "en" });
    expect(mod.getSettings().verifierLlm).toBeNull();
    expect(mod.getSettings().language).toBe("en");
  });

  it("persisted verifierLlm survives a reload", async () => {
    const mod = await loadStoreWith({
      verifierLlm: { providerId: "glm", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4.6" },
    });
    expect(mod.getSettings().verifierLlm).toMatchObject({ providerId: "glm", model: "glm-4.6" });
  });
});
