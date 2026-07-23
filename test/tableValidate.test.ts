import { describe, expect, it } from "vitest";
import { deepValidate, validateSortFilterArgs, validateTableArgs, validateTableName } from "../src/excel/validate";
import { SNAPSHOT_MAX, sortUndoPlan } from "../src/excel/guards";

describe("validateTableName", () => {
  it("accepts letters, underscores, CJK, digits after the first char", () => {
    expect(validateTableName("SalesTable").ok).toBe(true);
    expect(validateTableName("_t1").ok).toBe(true);
    expect(validateTableName("销量表").ok).toBe(true);
  });
  it("rejects spaces, cell-reference lookalikes, and empty names", () => {
    expect(validateTableName("my table").ok).toBe(false);
    expect(validateTableName("A1").ok).toBe(false);
    expect(validateTableName("XFD1048576").ok).toBe(false);
    expect(validateTableName("").ok).toBe(false);
    expect(validateTableName("1st").ok).toBe(false);
  });
});

describe("validateTableArgs", () => {
  it("create needs a valid range; name and style optional", () => {
    expect(validateTableArgs({ action: "create", range: "A1:H100" }).ok).toBe(true);
    expect(validateTableArgs({ action: "create", range: "A1:H100", name: "销量表" }).ok).toBe(true);
    expect(validateTableArgs({ action: "create", range: "nope" }).ok).toBe(false);
    expect(validateTableArgs({ action: "create", range: "A1:H100", name: "bad name" }).ok).toBe(false);
  });
  it("rename needs name + valid new_name; set_totals needs name + on; unlist needs name", () => {
    expect(validateTableArgs({ action: "rename", name: "T1", new_name: "Sales_2" }).ok).toBe(true);
    expect(validateTableArgs({ action: "rename", name: "T1", new_name: "A1" }).ok).toBe(false);
    expect(validateTableArgs({ action: "rename", new_name: "Sales_2" }).ok).toBe(false);
    expect(validateTableArgs({ action: "set_totals", name: "T1", on: true }).ok).toBe(true);
    expect(validateTableArgs({ action: "set_totals", name: "T1" }).ok).toBe(false);
    expect(validateTableArgs({ action: "unlist", name: "T1" }).ok).toBe(true);
    expect(validateTableArgs({ action: "list" }).ok).toBe(true);
    expect(validateTableArgs({ action: "explode" }).ok).toBe(false);
  });
  it("is wired into deepValidate", () => {
    expect(deepValidate("manage_table", { action: "list" }).ok).toBe(true);
    expect(deepValidate("manage_table", { action: "create", range: "??" }).ok).toBe(false);
  });
});

describe("validateSortFilterArgs", () => {
  it("sort needs exactly one target and non-empty keys", () => {
    expect(validateSortFilterArgs({ action: "sort", range: "A1:H100", keys: [{ column: "B" }] }).ok).toBe(true);
    expect(
      validateSortFilterArgs({ action: "sort", table: "T1", keys: [{ column: "销量", direction: "desc" }] }).ok
    ).toBe(true);
    expect(validateSortFilterArgs({ action: "sort", keys: [{ column: "B" }] }).ok).toBe(false);
    expect(validateSortFilterArgs({ action: "sort", range: "A1:B2", table: "T1", keys: [{ column: "B" }] }).ok).toBe(false);
    expect(validateSortFilterArgs({ action: "sort", range: "A1:B2", keys: [] }).ok).toBe(false);
    expect(validateSortFilterArgs({ action: "sort", range: "A1:B2", keys: [{ column: "B", direction: "up" }] }).ok).toBe(false);
  });
  it("auto_filter needs range + column + values or criterion; table_filter needs table + column", () => {
    expect(
      validateSortFilterArgs({ action: "auto_filter", range: "A1:H100", column: "品牌", values: ["BYD"] }).ok
    ).toBe(true);
    expect(
      validateSortFilterArgs({ action: "auto_filter", range: "A1:H100", column: "B", criterion: ">100" }).ok
    ).toBe(true);
    expect(validateSortFilterArgs({ action: "auto_filter", range: "A1:H100", column: "B" }).ok).toBe(false);
    expect(validateSortFilterArgs({ action: "auto_filter", column: "B", values: ["x"] }).ok).toBe(false);
    expect(validateSortFilterArgs({ action: "table_filter", table: "T1", column: "品牌", values: ["BYD"] }).ok).toBe(true);
    expect(validateSortFilterArgs({ action: "table_filter", column: "品牌", values: ["BYD"] }).ok).toBe(false);
  });
  it("clear_filters accepts a table or nothing (active sheet)", () => {
    expect(validateSortFilterArgs({ action: "clear_filters" }).ok).toBe(true);
    expect(validateSortFilterArgs({ action: "clear_filters", table: "T1" }).ok).toBe(true);
  });
});

describe("sortUndoPlan", () => {
  it("snapshots and stays soft up to the cap, escalates to hard with no snapshot above it", () => {
    expect(sortUndoPlan(SNAPSHOT_MAX)).toEqual({ mut: "soft", snapshot: true });
    expect(sortUndoPlan(SNAPSHOT_MAX + 1)).toEqual({ mut: "hard", snapshot: false });
    expect(sortUndoPlan(10)).toEqual({ mut: "soft", snapshot: true });
  });
});
