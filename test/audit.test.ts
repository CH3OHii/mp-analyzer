import { describe, expect, it } from "vitest";
import { dedupeRanges, formatAuditForModel, type AuditReport, type MutatedRange } from "../src/agent/audit";

const mr = (sheet: string, address: string, tool = "write_range"): MutatedRange => ({ sheet, address, tool });

describe("dedupeRanges", () => {
  it("drops exact duplicates, keeping the most recent", () => {
    const out = dedupeRanges([mr("S", "A1:B2"), mr("S", "A1:B2")]);
    expect(out).toHaveLength(1);
  });

  it("drops ranges contained in an already-kept (newer) range on the same sheet", () => {
    const out = dedupeRanges([mr("S", "A1"), mr("S", "A1:D20")]);
    expect(out).toEqual([mr("S", "A1:D20")]);
  });

  it("keeps same-address ranges on different sheets separate", () => {
    const out = dedupeRanges([mr("S1", "A1:B2"), mr("S2", "A1:B2")]);
    expect(out).toHaveLength(2);
  });

  it("keeps an older larger range that contains a newer smaller one", () => {
    // Most-recent-first: the small one is kept, the big one is NOT contained in it.
    const out = dedupeRanges([mr("S", "A1:D20"), mr("S", "B2")]);
    expect(out.map((r) => r.address).sort()).toEqual(["A1:D20", "B2"]);
  });

  it("applies the range-count cap most-recent-first", () => {
    const many = Array.from({ length: 20 }, (_, i) => mr("S", `A${i + 1}`));
    const out = dedupeRanges(many, { maxRanges: 3 });
    expect(out.map((r) => r.address)).toEqual(["A20", "A19", "A18"]);
  });

  it("skips over-budget ranges but still admits smaller older ones", () => {
    const out = dedupeRanges([mr("S", "C1"), mr("S", "A1:Z1000")], { maxCells: 100 });
    expect(out.map((r) => r.address)).toEqual(["C1"]);
  });

  it("ignores unparseable addresses", () => {
    expect(dedupeRanges([mr("S", "not-a-range")])).toEqual([]);
  });
});

describe("formatAuditForModel", () => {
  it("lists error cells and empty ranges with sheet-qualified addresses", () => {
    const report: AuditReport = {
      checkedRanges: 2,
      checkedCells: 40,
      errorCellCount: 2,
      issues: [
        { sheet: "Sales", address: "B2:B10", errors: [{ cell: "B4", error: "#NAME?" }, { cell: "B7", error: "#REF!" }] },
        { sheet: "Summary", address: "D1:D5", errors: [], all_empty: true },
      ],
    };
    const msg = formatAuditForModel(report);
    expect(msg).toContain("[automated audit]");
    expect(msg).toContain("Sales!B2:B10");
    expect(msg).toContain("B4=#NAME?");
    expect(msg).toContain("Summary!D1:D5");
    expect(msg).toContain("empty");
  });

  it("stays bounded for huge reports", () => {
    const report: AuditReport = {
      checkedRanges: 1,
      checkedCells: 1,
      errorCellCount: 5000,
      issues: Array.from({ length: 500 }, (_, i) => ({
        sheet: `Sheet${i}`,
        address: "A1:Z100",
        errors: Array.from({ length: 20 }, (_, j) => ({ cell: `A${j}`, error: "#REF!" })),
      })),
    };
    expect(formatAuditForModel(report).length).toBeLessThanOrEqual(12_100);
  });
});
