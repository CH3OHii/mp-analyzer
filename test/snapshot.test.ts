// Stack semantics of the snapshot store (pure) + the null-preserving write merge.
// The Office.js capture/restore side can't run headless — it is exercised by the
// manual E2E checklist (docs/e2e-checklist.md) inside real Excel.
import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_STEPS,
  clearSteps,
  getSnapState,
  pushStep,
  revertTop,
  topStep,
} from "../src/excel/snapshot";
import { buildWriteMatrix } from "../src/excel/writeTools";

function step(cells: number, label = "s") {
  return {
    toolName: "write_range",
    kind: "range" as const,
    label,
    cellCount: cells,
    snapshots: [],
    inverses: [],
  };
}

describe("snapshot stack", () => {
  beforeEach(() => clearSteps());

  it("pushes with unique ids and LIFO top", () => {
    const a = pushStep(step(10, "a"));
    const b = pushStep(step(10, "b"));
    expect(a.id).not.toBe(b.id);
    expect(topStep()?.id).toBe(b.id);
    expect(getSnapState().steps).toHaveLength(2);
  });

  it("evicts FIFO beyond MAX_STEPS", () => {
    for (let i = 0; i < MAX_STEPS + 5; i++) pushStep(step(1, `s${i}`));
    const st = getSnapState();
    expect(st.steps).toHaveLength(MAX_STEPS);
    expect(st.evicted).toBe(5);
    expect(st.steps[0].label).toBe("s5");
  });

  it("evicts by total cell budget", () => {
    for (let i = 0; i < 10; i++) pushStep(step(20_000, `big${i}`)); // exactly 200k
    expect(getSnapState().steps).toHaveLength(10);
    pushStep(step(20_000, "big10"));
    const st = getSnapState();
    expect(st.steps.reduce((s, x) => s + x.cellCount, 0)).toBeLessThanOrEqual(200_000);
    expect(st.steps[0].label).toBe("big1");
    expect(st.evicted).toBe(1);
  });

  it("revertTop without Excel throws and leaves the stack intact", async () => {
    pushStep(step(5, "keep"));
    await expect(revertTop()).rejects.toThrow(/Excel is not available/);
    expect(getSnapState().steps).toHaveLength(1);
  });

  it("revertTop with empty stack throws", async () => {
    await expect(revertTop()).rejects.toThrow(/Nothing to revert/);
  });
});

describe("buildWriteMatrix (null preserves captured pre-state)", () => {
  it("passes values through and fills null/undefined from the capture", () => {
    const captured = [
      ["old1", "=SUM(A1:A2)"],
      [42, "old4"],
    ];
    const out = buildWriteMatrix(
      [
        ["new1", null],
        [undefined as unknown as null, ""],
      ],
      captured
    );
    expect(out).toEqual([
      ["new1", "=SUM(A1:A2)"],
      [42, ""],
    ]);
  });

  it("defaults to empty string when capture is missing a cell", () => {
    expect(buildWriteMatrix([[null]], [[]])).toEqual([[""]]);
  });
});
