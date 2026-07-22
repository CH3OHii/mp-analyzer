import { describe, expect, it } from "vitest";
import { filterPresets, type Preset } from "../src/agent/presets";

function p(id: string, nameEn: string, nameZh: string): Preset {
  return { id, nameEn, nameZh, source: "builtin", body: "b", adaptationNote: "", approxTokens: 1 };
}

const presets: Preset[] = [
  p("market-sizing-forecasting", "Market Sizing & Forecasting", "市场规模与预测"),
  p("kpi-variance-decomposition", "KPI Variance Decomposition", "KPI差异分解"),
  p("custom_123", "My Framework", "我的框架"),
];

describe("filterPresets", () => {
  it("returns all presets for an empty or whitespace query", () => {
    expect(filterPresets("", presets)).toHaveLength(3);
    expect(filterPresets("  ", presets)).toHaveLength(3);
  });

  it("matches the English name case-insensitively", () => {
    expect(filterPresets("SIZING", presets).map((x) => x.id)).toEqual(["market-sizing-forecasting"]);
  });

  it("matches a Chinese-name substring", () => {
    expect(filterPresets("差异", presets).map((x) => x.id)).toEqual(["kpi-variance-decomposition"]);
  });

  it("matches the slug/id", () => {
    expect(filterPresets("kpi-var", presets).map((x) => x.id)).toEqual(["kpi-variance-decomposition"]);
  });

  it("returns empty on no match", () => {
    expect(filterPresets("zzz", presets)).toEqual([]);
  });
});
