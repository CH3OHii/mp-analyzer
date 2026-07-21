import { describe, expect, it } from "vitest";
import { EXCEL_ERROR_LITERALS, sampleMatrix, scanMatrix } from "../src/excel/verify";
import { parseA1 } from "../src/excel/guards";

const at = (a1: string) => parseA1(a1)!;

describe("scanMatrix", () => {
  it("detects every Excel error literal (classic + rich-value families)", () => {
    const literals = [...EXCEL_ERROR_LITERALS];
    expect(literals).toHaveLength(17);
    for (const rich of ["#FIELD!", "#BLOCKED!", "#BUSY!", "#GETTING_DATA", "#PYTHON!"]) {
      expect(EXCEL_ERROR_LITERALS.has(rich)).toBe(true);
    }
    const matrix = [literals];
    const scan = scanMatrix(matrix, at(`A1:${"ABCDEFGHIJKLMNOPQRSTUVWXYZ"[literals.length - 1]}1`));
    expect(scan.errorCells).toHaveLength(literals.length);
    expect(scan.errorCells.map((e) => e.error)).toEqual(literals);
  });

  it("does not flag near-misses or ordinary values", () => {
    const scan = scanMatrix([["#NAME", "REF!", "#ref!", 42, "", null, "=SUM(A1)"]], at("A1:G1"));
    expect(scan.errorCells).toEqual([]);
  });

  it("maps matrix indices back to real addresses from a non-A1 origin", () => {
    const scan = scanMatrix(
      [
        ["ok", "#REF!"],
        ["#NAME?", "ok"],
      ],
      at("C10:D11")
    );
    expect(scan.errorCells).toEqual([
      { cell: "D10", error: "#REF!" },
      { cell: "C11", error: "#NAME?" },
    ]);
  });

  it("counts cells and non-empty cells", () => {
    const scan = scanMatrix(
      [
        ["", null, 0],
        ["x", "", undefined],
      ],
      at("A1:C2")
    );
    expect(scan.cells).toBe(6);
    expect(scan.nonEmpty).toBe(2); // 0 counts as content; ""/null/undefined do not
  });

  it("reports all-empty via nonEmpty === 0", () => {
    expect(scanMatrix([["", ""]], at("A1:B1")).nonEmpty).toBe(0);
  });
});

describe("sampleMatrix", () => {
  it("clips to the top-left corner", () => {
    const big = Array.from({ length: 100 }, (_, r) => Array.from({ length: 30 }, (_, c) => `${r},${c}`));
    const s = sampleMatrix(big);
    expect(s).toHaveLength(3);
    expect(s[0]).toHaveLength(8);
    expect(s[2][7]).toBe("2,7");
  });

  it("passes small matrices through", () => {
    expect(sampleMatrix([[1]])).toEqual([[1]]);
  });
});
