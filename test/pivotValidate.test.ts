import { describe, expect, it } from "vitest";
import { deepValidate, validatePivotArgs } from "../src/excel/validate";
import { aggFromOffice, PIVOT_AGG, pivotPreviewNote } from "../src/excel/pivotConfig";

describe("validatePivotArgs", () => {
  it("accepts a well-formed create", () => {
    const r = validatePivotArgs({
      action: "create",
      source: "RawMonthly!A1:H180000",
      rows: ["品牌"],
      values: [{ field: "NEV零售", agg: "sum" }],
      dest_cell: "A3",
    });
    expect(r.ok).toBe(true);
  });

  it("accepts a create sourced from a table name", () => {
    expect(
      validatePivotArgs({ action: "create", source: "SalesTable", rows: ["品牌"], values: [{ field: "NEV零售" }] }).ok
    ).toBe(true);
  });

  it("create requires source, at least one of rows/columns, and one values entry", () => {
    expect(validatePivotArgs({ action: "create", rows: ["x"], values: [{ field: "y" }] }).ok).toBe(false);
    expect(validatePivotArgs({ action: "create", source: "A1:B2", values: [{ field: "y" }] }).ok).toBe(false);
    expect(validatePivotArgs({ action: "create", source: "A1:B2", rows: ["x"] }).ok).toBe(false);
    expect(validatePivotArgs({ action: "create", source: "A1:B2", rows: ["x"], values: [] }).ok).toBe(false);
  });

  it("rejects a bad agg and a bad dest_cell", () => {
    expect(
      validatePivotArgs({ action: "create", source: "A1:B2", rows: ["x"], values: [{ field: "y", agg: "median" }] }).ok
    ).toBe(false);
    expect(
      validatePivotArgs({ action: "create", source: "A1:B2", rows: ["x"], values: [{ field: "y" }], dest_cell: "??" }).ok
    ).toBe(false);
  });

  it("edit actions require name and field; set_aggregation requires agg", () => {
    expect(validatePivotArgs({ action: "add_field", field: "x", area: "rows" }).ok).toBe(false);
    expect(validatePivotArgs({ action: "add_field", name: "P", area: "rows" }).ok).toBe(false);
    expect(validatePivotArgs({ action: "add_field", name: "P", field: "x", area: "nowhere" }).ok).toBe(false);
    expect(validatePivotArgs({ action: "add_field", name: "P", field: "x", area: "rows" }).ok).toBe(true);
    expect(validatePivotArgs({ action: "set_aggregation", name: "P", field: "x" }).ok).toBe(false);
    expect(validatePivotArgs({ action: "set_aggregation", name: "P", field: "x", agg: "average" }).ok).toBe(true);
    expect(validatePivotArgs({ action: "remove_field", name: "P", field: "x" }).ok).toBe(true);
  });

  it("refresh/delete/describe require name; list does not", () => {
    expect(validatePivotArgs({ action: "refresh" }).ok).toBe(false);
    expect(validatePivotArgs({ action: "delete", name: "P" }).ok).toBe(true);
    expect(validatePivotArgs({ action: "describe" }).ok).toBe(false);
    expect(validatePivotArgs({ action: "list" }).ok).toBe(true);
  });

  it("rejects unknown actions and is wired into deepValidate", () => {
    expect(validatePivotArgs({ action: "explode" }).ok).toBe(false);
    expect(deepValidate("manage_pivot", { action: "list" }).ok).toBe(true);
    expect(deepValidate("manage_pivot", { action: "refresh" }).ok).toBe(false);
  });
});

describe("PIVOT_AGG map", () => {
  it("maps every supported agg to the Office enum string", () => {
    expect(PIVOT_AGG).toEqual({
      sum: "Sum",
      count: "Count",
      average: "Average",
      min: "Min",
      max: "Max",
      product: "Product",
    });
  });
});

describe("pivotPreviewNote", () => {
  it("summarizes a create", () => {
    const n = pivotPreviewNote({
      action: "create",
      name: "ByBrand",
      source: "RawMonthly!A1:H180000",
      dest_sheet: "Pivot",
      dest_cell: "A3",
      rows: ["品牌"],
      values: [{ field: "NEV零售", agg: "sum" }],
    });
    expect(n).toContain("create");
    expect(n).toContain("ByBrand");
    expect(n).toContain("RawMonthly!A1:H180000");
    expect(n).toContain("品牌");
    expect(n).toContain("sum(NEV零售)");
  });

  it("summarizes edits and flags delete as not revertable", () => {
    expect(pivotPreviewNote({ action: "add_field", name: "P", field: "月份", area: "columns" })).toContain("月份");
    expect(pivotPreviewNote({ action: "delete", name: "P" })).toContain("cannot be reverted");
  });
});

describe("aggFromOffice fidelity", () => {
  it("maps known aggregations and passes unknown ones through verbatim", () => {
    expect(aggFromOffice("Sum")).toBe("sum");
    expect(aggFromOffice("Average")).toBe("average");
    // Never coerce to "sum": a restore would silently change a user pivot's aggregation.
    expect(aggFromOffice("CountNumbers")).toBe("CountNumbers");
    expect(aggFromOffice("Automatic")).toBe("Automatic");
    expect(aggFromOffice("StandardDeviation")).toBe("StandardDeviation");
  });
});
