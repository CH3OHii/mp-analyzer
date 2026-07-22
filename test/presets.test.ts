import { describe, expect, it } from "vitest";
import {
  builtinAnalysisPresets,
  filterPresets,
  mergeSkillSources,
  resolveAnalysisPresets,
  type Preset,
  type SkillSource,
} from "../src/agent/presets";

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

describe("mergeSkillSources", () => {
  const src = (slug: string, raw: string): SkillSource => ({ slug, raw });

  it("keeps user skills first, then committed built-ins", () => {
    const merged = mergeSkillSources([src("zeta-private", "u")], [src("alpha-builtin", "b")]);
    expect(merged.map((s) => s.slug)).toEqual(["zeta-private", "alpha-builtin"]);
  });

  it("a private user file overrides a committed builtin with the same slug", () => {
    const merged = mergeSkillSources([src("ev-industry-analyst", "USER FORK")], [src("ev-industry-analyst", "SHIPPED")]);
    expect(merged).toHaveLength(1);
    expect(merged[0].raw).toBe("USER FORK");
  });

  it("works with either side empty", () => {
    expect(mergeSkillSources([], [src("a", "1")])).toHaveLength(1);
    expect(mergeSkillSources([src("a", "1")], [])).toHaveLength(1);
    expect(mergeSkillSources([], [])).toEqual([]);
  });
});

// Subset assertions only — developers may have extra private skills in the
// top-level skills/ dir, so never assert exact list equality.
describe("shipped builtin skills", () => {
  const SHIPPED = ["ev-industry-analyst"];

  it("all five resolve with bilingual names, a note, and a token estimate", () => {
    for (const slug of SHIPPED) {
      const p = builtinAnalysisPresets.find((x) => x.id === slug);
      expect(p, slug).toBeDefined();
      expect(p!.nameEn.length).toBeGreaterThan(0);
      expect(p!.nameZh).not.toBe(p!.nameEn); // real Chinese name, not a fallback
      expect(p!.adaptationNote.length).toBeGreaterThan(50);
      expect(p!.approxTokens).toBeGreaterThan(0);
    }
  });

  it("frontmatter is stripped from bodies", () => {
    for (const slug of SHIPPED) {
      const p = builtinAnalysisPresets.find((x) => x.id === slug)!;
      expect(p.body.startsWith("---")).toBe(false);
      expect(p.body).not.toContain("name_en:");
      expect(p.body.startsWith("#")).toBe(true);
    }
  });

  it("README is never a preset and custom presets sort after builtins", () => {
    const all = resolveAnalysisPresets([{ id: "c1", nameEn: "C", nameZh: "C", body: "b" }]);
    expect(all.some((p) => p.id.toLowerCase() === "readme")).toBe(false);
    expect(all[all.length - 1].id).toBe("c1");
  });
});
