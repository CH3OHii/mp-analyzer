import { describe, expect, it } from "vitest";
import {
  EXPECT_MAX,
  checkExpectations,
  deepValidate,
  suggestSheet,
  validateCfRule,
  validateExpect,
  validateFormatArgs,
  validateNumberFormatShape,
  validateRectMatrix,
} from "../src/excel/validate";

describe("validateRectMatrix", () => {
  it("accepts a rectangular matrix of primitives", () => {
    expect(validateRectMatrix([["a", 1], [null, true]]).ok).toBe(true);
  });

  it("rejects non-arrays and empty input", () => {
    expect(validateRectMatrix(undefined).ok).toBe(false);
    expect(validateRectMatrix([]).ok).toBe(false);
    expect(validateRectMatrix([[]]).ok).toBe(false);
  });

  it("rejects ragged rows with row numbers and a teaching message", () => {
    const r = validateRectMatrix([
      ["a", "b", "c"],
      ["d", "e"],
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("ragged_values");
      expect(r.message).toContain("row 2");
      expect(r.message).toContain("pad with null");
    }
  });

  it("rejects object/array cells with coordinates", () => {
    const r = validateRectMatrix([["ok", { a: 1 }]]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("row 1, col 2");
  });
});

describe("validateNumberFormatShape", () => {
  it("passes scalars through", () => {
    expect(validateNumberFormatShape("0.0%", 3, 2).ok).toBe(true);
  });
  it("requires exact rows×cols for 2D formats", () => {
    expect(validateNumberFormatShape([["0", "0"]], 1, 2).ok).toBe(true);
    expect(validateNumberFormatShape([["0", "0"]], 2, 2).ok).toBe(false);
    expect(validateNumberFormatShape([["0", "0", "0"]], 1, 2).ok).toBe(false);
  });
  it("requires string entries", () => {
    expect(validateNumberFormatShape([[0]], 1, 1).ok).toBe(false);
  });
});

describe("expect preconditions", () => {
  it("validates entries and caps the list", () => {
    expect(validateExpect(undefined).ok).toBe(true);
    expect(validateExpect([{ cell: "B4", value: "Region" }]).ok).toBe(true);
    expect(validateExpect([{ cell: "not-a-cell", value: 1 }]).ok).toBe(false);
    expect(validateExpect([{ cell: "Other!A1", value: 1 }]).ok).toBe(false); // sheet prefixes silently mis-target
    expect(validateExpect([{ cell: "A1", value: { nested: true } }]).ok).toBe(false);
    expect(validateExpect("A1").ok).toBe(false);
    const tooMany = Array.from({ length: EXPECT_MAX + 1 }, (_, i) => ({ cell: `A${i + 1}`, value: i }));
    expect(validateExpect(tooMany).ok).toBe(false);
  });

  it("compares numbers numerically and strings trimmed", () => {
    const expects = [
      { cell: "A1", value: 3 },
      { cell: "A2", value: "Region " },
      { cell: "A3", value: "x" },
    ];
    const mismatches = checkExpectations(expects, ["3.0", "Region", "y"]);
    expect(mismatches).toEqual([{ cell: "A3", expected: "x", actual: "y" }]);
  });

  it("treats null/empty as equivalent blanks", () => {
    expect(checkExpectations([{ cell: "A1", value: null }], [""])).toEqual([]);
  });

  it("never lets blank match 0 in either direction (sheet-drift guard)", () => {
    expect(checkExpectations([{ cell: "A1", value: 0 }], [""])).toHaveLength(1);
    expect(checkExpectations([{ cell: "A1", value: 0 }], ["   "])).toHaveLength(1);
    expect(checkExpectations([{ cell: "A1", value: null }], [0])).toHaveLength(1);
    expect(checkExpectations([{ cell: "A1", value: 0 }], [0])).toEqual([]);
  });

  it("compares booleans strictly (true does not match 1)", () => {
    expect(checkExpectations([{ cell: "A1", value: true }], [1])).toHaveLength(1);
    expect(checkExpectations([{ cell: "A1", value: true }], [true])).toEqual([]);
    expect(checkExpectations([{ cell: "A1", value: false }], [""])).toHaveLength(1);
  });
});

describe("suggestSheet", () => {
  const sheets = ["Sales 2026", "数据", "Summary"];
  it("matches case-insensitively and ignoring spaces", () => {
    expect(suggestSheet("sales2026", sheets)).toBe("Sales 2026");
  });
  it("folds full-width characters (NFKC)", () => {
    expect(suggestSheet("Ｓｕｍｍａｒｙ", sheets)).toBe("Summary");
  });
  it("suggests within edit distance 2", () => {
    expect(suggestSheet("Sumary", sheets)).toBe("Summary");
  });
  it("suggests on containment", () => {
    expect(suggestSheet("Sales", sheets)).toBe("Sales 2026");
  });
  it("returns undefined when nothing is close", () => {
    expect(suggestSheet("Quarterly Report", sheets)).toBeUndefined();
    expect(suggestSheet("", sheets)).toBeUndefined();
  });
  it("ignores sheets whose name normalizes to empty (e.g. ' ')", () => {
    expect(suggestSheet("Quarterly Report", [" "])).toBeUndefined();
  });
});

describe("validateFormatArgs / validateCfRule", () => {
  it("checks 2D number_format against the range shape", () => {
    expect(validateFormatArgs({ range: "A1:B2", number_format: [["0", "0"], ["0", "0"]] }).ok).toBe(true);
    expect(validateFormatArgs({ range: "A1:B2", number_format: [["0", "0"]] }).ok).toBe(false);
  });
  it("validates borders edges and style", () => {
    expect(validateFormatArgs({ range: "A1", borders: { edges: ["top"], style: "thin" } }).ok).toBe(true);
    expect(validateFormatArgs({ range: "A1", borders: { edges: ["diagonal"], style: "thin" } }).ok).toBe(false);
    expect(validateFormatArgs({ range: "A1", borders: { edges: ["top"], style: "dashed" } }).ok).toBe(false);
  });
  it("requires operator+value1 for cell_value rules", () => {
    expect(validateCfRule({ type: "cell_value", operator: "greater_than", value1: 10 }).ok).toBe(true);
    expect(validateCfRule({ type: "cell_value", value1: 10 }).ok).toBe(false);
    expect(validateCfRule({ type: "cell_value", operator: "between", value1: 1 }).ok).toBe(false);
  });
  it("requires a formula for custom_formula rules", () => {
    expect(validateCfRule({ type: "custom_formula", formula: "=$C2>0.5" }).ok).toBe(true);
    expect(validateCfRule({ type: "custom_formula" }).ok).toBe(false);
  });
  it("rejects unknown rule types", () => {
    expect(validateCfRule({ type: "sparkline" }).ok).toBe(false);
  });
});

describe("deepValidate dispatch", () => {
  it("routes write_range through rect + expect checks", () => {
    expect(deepValidate("write_range", { values: [["a"], ["b", "c"]] }).ok).toBe(false);
    expect(deepValidate("write_range", { values: [["a"]], expect: [{ cell: "??", value: 1 }] }).ok).toBe(false);
    expect(deepValidate("write_range", { values: [["a"]] }).ok).toBe(true);
  });
  it("checks set_formulas matrix rectangularity when present", () => {
    expect(deepValidate("set_formulas", { range: "A1:B1", formulas: [["=1", "=2"]] }).ok).toBe(true);
    expect(deepValidate("set_formulas", { range: "A1:B2", formulas: [["=1", "=2"], ["=3"]] }).ok).toBe(false);
    expect(deepValidate("set_formulas", { range: "A1:B1", formula_r1c1: "=RC[-1]" }).ok).toBe(true);
  });
  it("passes unknown tools through", () => {
    expect(deepValidate("read_range", { range: "A1" }).ok).toBe(true);
  });
});
