import { describe, expect, it } from "vitest";
import {
  READ_FULL_MAX,
  clipForRead,
  colToIndex,
  expandFromStart,
  indexToCol,
  normalizeMatrix,
  parseA1,
  rectCells,
  rectToA1,
  sheetOf,
  stripSheet,
} from "../src/excel/guards";

describe("column math", () => {
  it("roundtrips column letters", () => {
    expect(colToIndex("A")).toBe(1);
    expect(colToIndex("Z")).toBe(26);
    expect(colToIndex("AA")).toBe(27);
    expect(colToIndex("XFD")).toBe(16384);
    for (const n of [1, 26, 27, 52, 703, 16384]) expect(colToIndex(indexToCol(n))).toBe(n);
  });
});

describe("parseA1", () => {
  it("parses single cells and ranges (order-normalized)", () => {
    expect(parseA1("B4")).toEqual({ r0: 4, c0: 2, r1: 4, c1: 2 });
    expect(parseA1("A1:D20")).toEqual({ r0: 1, c0: 1, r1: 20, c1: 4 });
    expect(parseA1("D20:A1")).toEqual({ r0: 1, c0: 1, r1: 20, c1: 4 });
  });
  it("handles absolute refs and sheet qualifiers", () => {
    expect(parseA1("$B$4")).toEqual(parseA1("B4"));
    expect(parseA1("Sales!A1:B2")).toEqual(parseA1("A1:B2"));
    expect(parseA1("'My Sheet'!C3")).toEqual(parseA1("C3"));
  });
  it("rejects invalid refs", () => {
    expect(parseA1("1A")).toBeNull();
    expect(parseA1("A1:B2:C3")).toBeNull();
    expect(parseA1("")).toBeNull();
    expect(parseA1("A0")).toBeNull();
  });
});

describe("rect helpers", () => {
  it("computes cells and A1 roundtrip", () => {
    const r = parseA1("B4:E20")!;
    expect(rectCells(r)).toBe(17 * 4);
    expect(rectToA1(r)).toBe("B4:E20");
    expect(rectToA1(parseA1("B4")!)).toBe("B4");
  });
  it("expands from a start cell", () => {
    expect(expandFromStart("B4", 3, 2)).toBe("B4:C6");
    expect(expandFromStart("B4", 1, 1)).toBe("B4");
    expect(expandFromStart("bogus", 2, 2)).toBeNull();
  });
});

describe("sheet name helpers", () => {
  it("strips and extracts sheet names, including quoted ones", () => {
    expect(stripSheet("Sales!A1:B2")).toBe("A1:B2");
    expect(sheetOf("Sales!A1:B2")).toBe("Sales");
    expect(sheetOf("'My Sheet'!A1")).toBe("My Sheet");
    expect(sheetOf("A1")).toBeNull();
  });
});

describe("clipForRead", () => {
  it("defaults to 50 rows and flags truncation", () => {
    const clip = clipForRead(parseA1("A1:J200")!);
    expect(clip.rect).toEqual(parseA1("A1:J50"));
    expect(clip.truncated).toBe(true);
    expect(clip.totalRows).toBe(200);
  });
  it("honors start_row windows", () => {
    const clip = clipForRead(parseA1("A1:J200")!, 51, 50);
    expect(clip.rect).toEqual(parseA1("A51:J100"));
    expect(clip.truncated).toBe(true);
  });
  it("clips columns at 100 and shrinks rows to fit the cell cap", () => {
    const wide = clipForRead(parseA1("A1:GR1000")!, 1, 200); // 200 cols requested window
    expect(wide.colsTruncated).toBe(true);
    const cells = rectCells(wide.rect);
    expect(cells).toBeLessThanOrEqual(READ_FULL_MAX);
  });
  it("returns everything when the window covers the range", () => {
    const clip = clipForRead(parseA1("A1:D10")!, 1, 50);
    expect(clip.rect).toEqual(parseA1("A1:D10"));
    expect(clip.truncated).toBe(false);
    expect(clip.colsTruncated).toBe(false);
  });
});

describe("normalizeMatrix", () => {
  it("pads ragged rows with null", () => {
    const { rows, cols, matrix } = normalizeMatrix([[1, 2, 3], [4], [5, 6]]);
    expect(rows).toBe(3);
    expect(cols).toBe(3);
    expect(matrix[1]).toEqual([4, null, null]);
  });
});
