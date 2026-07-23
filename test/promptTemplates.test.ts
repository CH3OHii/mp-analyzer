import { describe, expect, it } from "vitest";
import { extractPlaceholders, fillTemplate } from "../src/agent/promptTemplates";

describe("extractPlaceholders", () => {
  it("finds unique tokens in first-appearance order", () => {
    expect(extractPlaceholders("分析{月份}的NEV销量，对比{品牌}与{月份}")).toEqual(["月份", "品牌"]);
  });

  it("handles adjacent tokens and trims whitespace", () => {
    expect(extractPlaceholders("{a}{ b }{c}")).toEqual(["a", "b", "c"]);
  });

  it("ignores empty, over-long, and malformed tokens", () => {
    expect(extractPlaceholders("{}")).toEqual([]);
    expect(extractPlaceholders(`{${"x".repeat(31)}}`)).toEqual([]);
    expect(extractPlaceholders("no tokens here { unclosed")).toEqual([]);
    expect(extractPlaceholders("nested {{月份}} outer")).toEqual(["月份"]); // inner match only
  });
});

describe("fillTemplate", () => {
  it("substitutes every occurrence", () => {
    expect(fillTemplate("{m}和{m}与{b}", { m: "7月", b: "比亚迪" })).toBe("7月和7月与比亚迪");
  });

  it("leaves blank or missing values as visible literal tokens", () => {
    expect(fillTemplate("分析{月份}的{指标}", { 月份: "2026年7月", 指标: "  " })).toBe("分析2026年7月的{指标}");
    expect(fillTemplate("{未提供}", {})).toBe("{未提供}");
  });

  it("matches trimmed token names against trimmed keys", () => {
    expect(fillTemplate("{ 月份 }", { 月份: "7月" })).toBe("7月");
  });
});
