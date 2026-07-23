import { describe, expect, it } from "vitest";
import {
  compileFilters,
  createAggregator,
  createProfiler,
  resolveColumns,
  rowPasses,
} from "../src/excel/aggregate";

// A small sales table: headers in Chinese (the user's real shape).
// Range starts at sheet column B (startCol = 2).
const HEADERS = ["品牌", "车型", "NEV零售", "月份"];

describe("resolveColumns", () => {
  it("resolves exact header text to range-relative indices", () => {
    const r = resolveColumns(HEADERS, 2, ["NEV零售", "品牌"]);
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.cols).toEqual([
      { idx: 2, letter: "D", header: "NEV零售" },
      { idx: 0, letter: "B", header: "品牌" },
    ]);
  });

  it("interprets an in-range column letter as a letter, not a header", () => {
    const r = resolveColumns(HEADERS, 2, ["C"]);
    if ("error" in r) throw new Error(r.error.message);
    expect(r.cols[0]).toEqual({ idx: 1, letter: "C", header: "车型" });
  });

  it("falls back to header match when the letter is outside the range", () => {
    // Range spans B..E; "Z" is not in range, so it must be treated as header text and fail.
    const r = resolveColumns(HEADERS, 2, ["Z"]);
    expect("error" in r && r.error.code === "unknown_column").toBe(true);
  });

  it("lists available headers with letters on an unknown selector", () => {
    const r = resolveColumns(HEADERS, 2, ["销量"]);
    if (!("error" in r)) throw new Error("expected error");
    expect(r.error.message).toContain('B:"品牌"');
    expect(r.error.message).toContain('D:"NEV零售"');
  });

  it("errors on duplicate header text, listing the candidate letters", () => {
    const r = resolveColumns(["销量", "销量", "月份"], 1, ["销量"]);
    if (!("error" in r)) throw new Error("expected error");
    expect(r.error.code).toBe("ambiguous_column");
    expect(r.error.message).toContain("A");
    expect(r.error.message).toContain("B");
  });
});

const ROWS = [
  ["BYD", "汉", 100, "2026-01"],
  ["BYD", "秦", 200, "2026-01"],
  ["Tesla", "M3", 50, "2026-01"],
  ["NIO", "ET5", 30, "2026-01"],
  ["Tesla", "MY", 70, "2026-01"],
];

function brandSum(topN = 50, sort: "desc" | "asc" | "group" = "desc") {
  const agg = createAggregator({
    groups: [{ idx: 0, label: "品牌" }],
    values: [{ idx: 2, agg: "sum", label: "sum(NEV零售)" }],
    topN,
    sort,
  });
  agg.feed(ROWS);
  return agg.result();
}

describe("createAggregator", () => {
  it("groups, sums, counts rows, sorts desc by the first value", () => {
    const r = brandSum();
    if ("error" in r) throw new Error("unexpected error");
    expect(r.columns).toEqual(["品牌", "sum(NEV零售)", "rows"]);
    expect(r.groups).toEqual([
      ["BYD", 300, 2],
      ["Tesla", 120, 2],
      ["NIO", 30, 1],
    ]);
    expect(r.groups_total).toBe(3);
    expect(r.rows_scanned).toBe(5);
    expect(r.truncated).toBe(false);
    expect(r.other).toBeUndefined();
  });

  it("rolls up beyond-topN groups into `other` with exact arithmetic", () => {
    const r = brandSum(2);
    if ("error" in r) throw new Error("unexpected error");
    expect(r.groups).toHaveLength(2);
    expect(r.other).toEqual({ group_count: 1, values: [30, 1] });
    const shownSum = r.groups.reduce((s, g) => s + (g[1] as number), 0);
    expect(shownSum + (r.other!.values[0] as number)).toBe(450); // grand total
    expect(r.truncated).toBe(true);
  });

  it("sorts by group key when asked", () => {
    const r = brandSum(50, "group");
    if ("error" in r) throw new Error("unexpected error");
    expect(r.groups.map((g) => g[0])).toEqual(["BYD", "NIO", "Tesla"]);
  });

  it("multi-chunk feeding equals single-shot feeding", () => {
    const a = createAggregator({
      groups: [{ idx: 0, label: "品牌" }],
      values: [{ idx: 2, agg: "sum", label: "sum(NEV零售)" }],
      topN: 50,
      sort: "desc",
    });
    a.feed(ROWS.slice(0, 2));
    a.feed(ROWS.slice(2));
    expect(a.result()).toEqual(brandSum());
  });

  it("computes avg/min/max/count/distinct and skips non-numeric with a counter", () => {
    const a = createAggregator({
      groups: [],
      values: [
        { idx: 2, agg: "avg", label: "avg" },
        { idx: 2, agg: "min", label: "min" },
        { idx: 2, agg: "max", label: "max" },
        { idx: 2, agg: "count", label: "count" },
        { idx: 0, agg: "distinct", label: "distinct" },
      ],
      topN: 50,
      sort: "desc",
    });
    a.feed([...ROWS, ["BYD", "唐", "N/A", "2026-01"], ["BYD", "宋", "", "2026-01"]]);
    const r = a.result();
    if ("error" in r) throw new Error("unexpected error");
    // avg over 5 numerics; count = 6 non-blank; 3 distinct brands; 7 rows total
    expect(r.groups).toEqual([[90, 30, 200, 6, 3, 7]]);
    expect(r.skipped_non_numeric).toEqual({ avg: 1, min: 1, max: 1 });
    expect(r.rows_scanned).toBe(7);
  });

  it("labels blank group values", () => {
    const a = createAggregator({ groups: [{ idx: 0, label: "品牌" }], values: [], topN: 50, sort: "desc" });
    a.feed([["", "x", 1, "m"], [null, "y", 2, "m"]]);
    const r = a.result();
    if ("error" in r) throw new Error("unexpected error");
    expect(r.groups).toEqual([["(blank)", 2]]);
  });

  it("errors when the group map exceeds its tracking cap", () => {
    const a = createAggregator({
      groups: [{ idx: 0, label: "id" }],
      values: [],
      topN: 50,
      sort: "desc",
      groupsTrackMax: 3,
    });
    a.feed([["a", 0, 0, 0], ["b", 0, 0, 0], ["c", 0, 0, 0], ["d", 0, 0, 0]]);
    const r = a.result();
    expect("error" in r && r.error.code === "too_many_groups").toBe(true);
  });

  it("caps distinct tracking and reports an over-cap marker", () => {
    const a = createAggregator({
      groups: [],
      values: [{ idx: 0, agg: "distinct", label: "d" }],
      topN: 50,
      sort: "desc",
      distinctTrackMax: 2,
    });
    a.feed([["a", 0, 0, 0], ["b", 0, 0, 0], ["c", 0, 0, 0]]);
    const r = a.result();
    if ("error" in r) throw new Error("unexpected error");
    expect(r.groups[0][0]).toBe(">2");
  });
});

describe("filters", () => {
  const compiled = (f: Parameters<typeof compileFilters>[0]) => compileFilters(f);

  it("eq compares numerically when both sides are numeric", () => {
    const c = compiled([{ idx: 2, op: "eq", value: "100" }]);
    expect(rowPasses(ROWS[0], c)).toBe(true);
    expect(rowPasses(ROWS[1], c)).toBe(false);
  });

  it("contains is case-insensitive; in matches any listed value", () => {
    expect(rowPasses(ROWS[2], compiled([{ idx: 0, op: "contains", value: "tes" }]))).toBe(true);
    const c = compiled([{ idx: 0, op: "in", values: ["NIO", "Tesla"] }]);
    expect(rowPasses(ROWS[2], c)).toBe(true);
    expect(rowPasses(ROWS[0], c)).toBe(false);
  });

  it("gt/le are numeric-only; blank/not_blank test emptiness; multiple filters AND", () => {
    expect(rowPasses(ROWS[0], compiled([{ idx: 2, op: "gt", value: 99 }]))).toBe(true);
    expect(rowPasses(["x", "y", "n/a", "m"], compiled([{ idx: 2, op: "gt", value: 0 }]))).toBe(false);
    expect(rowPasses(["", "y", 1, "m"], compiled([{ idx: 0, op: "blank" }]))).toBe(true);
    expect(rowPasses(ROWS[0], compiled([{ idx: 0, op: "not_blank" }, { idx: 2, op: "le", value: 100 }]))).toBe(true);
    expect(rowPasses(ROWS[1], compiled([{ idx: 0, op: "not_blank" }, { idx: 2, op: "le", value: 100 }]))).toBe(false);
  });
});

describe("createProfiler", () => {
  it("profiles types, min/max, distinct, and top values per column", () => {
    const p = createProfiler([
      { idx: 0, letter: "B", header: "品牌" },
      { idx: 2, letter: "D", header: "NEV零售" },
    ]);
    p.feed([...ROWS, ["BYD", "唐", "#DIV/0!", "2026-01"], ["", "宋", null, "2026-01"]]);
    const r = p.result();
    const brand = r.columns[0];
    expect(brand).toMatchObject({ column: "B", header: "品牌", distinct: 3 });
    expect(brand.types).toEqual({ number: 0, string: 6, boolean: 0, blank: 1, error: 0 });
    expect(brand.top_values[0]).toEqual({ v: "BYD", n: 3 });
    const sales = r.columns[1];
    expect(sales.types).toEqual({ number: 5, string: 0, boolean: 0, blank: 1, error: 1 });
    expect(sales.min).toBe(30);
    expect(sales.max).toBe(200);
  });

  it("caps distinct tracking with an over-cap marker", () => {
    const p = createProfiler([{ idx: 0, letter: "A", header: "id" }], { distinctTrackMax: 2 });
    p.feed([["a"], ["b"], ["c"]]);
    expect(p.result().columns[0].distinct).toBe(">2");
  });
});

describe("group-key integrity", () => {
  it("does not merge distinct tuples whose parts contain the separator", () => {
    const a = createAggregator({
      groups: [{ idx: 0, label: "x" }, { idx: 1, label: "y" }],
      values: [],
      topN: 50,
      sort: "group",
    });
    a.feed([["a b", "c"], ["a", "b c"]]);
    const r = a.result();
    if ("error" in r) throw new Error("unexpected error");
    expect(r.groups_total).toBe(2);
  });

  it("keeps cells whose literal text is \"(blank)\" separate from real blanks", () => {
    const a = createAggregator({ groups: [{ idx: 0, label: "x" }], values: [], topN: 50, sort: "group" });
    a.feed([["(blank)"], [""]]);
    const r = a.result();
    if ("error" in r) throw new Error("unexpected error");
    expect(r.groups_total).toBe(2);
  });

  it("sorts an over-cap distinct group by its tracked size, not as minus infinity", () => {
    const a = createAggregator({
      groups: [{ idx: 0, label: "g" }],
      values: [{ idx: 1, agg: "distinct", label: "d" }],
      topN: 1,
      sort: "desc",
      distinctTrackMax: 2,
    });
    a.feed([
      ["big", "v1"], ["big", "v2"], ["big", "v3"], // 3 distinct → overflows the cap of 2
      ["small", "w1"],
    ]);
    const r = a.result();
    if ("error" in r) throw new Error("unexpected error");
    expect(r.groups[0][0]).toBe("big"); // the overflowed group still ranks highest
    expect(r.groups[0][1]).toBe(">2");
  });
});
