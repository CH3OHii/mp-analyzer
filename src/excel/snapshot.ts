import { useSyncExternalStore } from "react";
import { runExcel } from "./env";
import { indexToCol } from "./guards";

export type StepKind = "range" | "format" | "structure" | "chart" | "cf" | "sheet";

export interface RangeSnapshot {
  sheet: string;
  /** Local address, no sheet prefix (e.g. "B4:E20"). */
  address: string;
  /** range.formulas returns the VALUE for non-formula cells, so restoring this
   *  one matrix restores values AND formulas together. */
  formulas?: any[][];
  numberFormats?: any[][];
  cellProps?: Excel.SettableCellProperties[][];
  colWidths?: (number | null)[];
  rowHeights?: (number | null)[];
}

export type InverseOp =
  | { op: "delete_chart"; sheet: string; name: string }
  | { op: "delete_cf"; sheet: string; address: string; ids: string[] }
  | { op: "delete_sheet"; name: string }
  | { op: "restore_sheet"; name: string; position: number; content: RangeSnapshot | null }
  | { op: "rename_sheet"; from: string; to: string }
  | { op: "delete_inserted"; sheet: string; kind: "rows" | "cols"; index: number; count: number }
  | {
      op: "reinsert_removed";
      sheet: string;
      kind: "rows" | "cols";
      index: number;
      count: number;
      content: RangeSnapshot | null;
    }
  | { op: "unmerge"; sheet: string; address: string };

export interface StepSnapshot {
  id: string;
  toolName: string;
  label: string;
  ts: number;
  kind: StepKind;
  snapshots: RangeSnapshot[];
  inverses: InverseOp[];
  cellCount: number;
}

export const MAX_STEPS = 30;
export const MAX_TOTAL_CELLS = 200_000;

export interface SnapState {
  steps: StepSnapshot[];
  evicted: number;
}

let state: SnapState = { steps: [], evicted: 0 };
const listeners = new Set<() => void>();
let seq = 0;

function notify() {
  listeners.forEach((l) => l());
}

export function getSnapState(): SnapState {
  return state;
}

export function useSnapshots(): SnapState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state
  );
}

/** Record an applied mutation. Bounded LIFO stack with FIFO eviction. */
export function pushStep(step: Omit<StepSnapshot, "id" | "ts">): StepSnapshot {
  const full: StepSnapshot = { ...step, id: `step_${++seq}`, ts: Date.now() };
  const steps = [...state.steps, full];
  let evicted = state.evicted;
  const total = () => steps.reduce((s, x) => s + x.cellCount, 0);
  while (steps.length > MAX_STEPS || (total() > MAX_TOTAL_CELLS && steps.length > 1)) {
    steps.shift();
    evicted++;
  }
  state = { steps, evicted };
  notify();
  return full;
}

export function topStep(): StepSnapshot | null {
  return state.steps[state.steps.length - 1] ?? null;
}

export function clearSteps(): void {
  state = { steps: [], evicted: 0 };
  notify();
}

/** LIFO revert of the most recent step. Returns the reverted step. */
export async function revertTop(): Promise<StepSnapshot> {
  const step = topStep();
  if (!step) throw new Error("Nothing to revert");
  await restoreStep(step);
  state = { ...state, steps: state.steps.slice(0, -1) };
  notify();
  return step;
}

export async function revertAll(): Promise<StepSnapshot[]> {
  const done: StepSnapshot[] = [];
  while (topStep()) done.push(await revertTop());
  return done;
}

async function restoreStep(step: StepSnapshot): Promise<void> {
  await runExcel(async (ctx) => {
    for (const inv of step.inverses) {
      await applyInverse(ctx, inv);
    }
    for (let i = step.snapshots.length - 1; i >= 0; i--) {
      restoreRange(ctx, step.snapshots[i]);
    }
    await ctx.sync();
  });
}

function restoreRange(ctx: Excel.RequestContext, snap: RangeSnapshot): void {
  const ws = ctx.workbook.worksheets.getItem(snap.sheet);
  const range = ws.getRange(snap.address);
  if (snap.formulas) range.formulas = snap.formulas;
  if (snap.numberFormats) range.numberFormat = snap.numberFormats;
  if (snap.cellProps) range.setCellProperties(snap.cellProps);
  snap.colWidths?.forEach((w, i) => {
    if (typeof w === "number") range.getColumn(i).format.columnWidth = w;
  });
  snap.rowHeights?.forEach((h, i) => {
    if (typeof h === "number") range.getRow(i).format.rowHeight = h;
  });
}

async function applyInverse(ctx: Excel.RequestContext, inv: InverseOp): Promise<void> {
  const wb = ctx.workbook;
  switch (inv.op) {
    case "delete_chart": {
      const ch = wb.worksheets.getItem(inv.sheet).charts.getItemOrNullObject(inv.name);
      await ctx.sync();
      if (!ch.isNullObject) ch.delete();
      break;
    }
    case "delete_cf": {
      const range = wb.worksheets.getItem(inv.sheet).getRange(inv.address);
      for (const id of inv.ids) {
        const cf = range.conditionalFormats.getItemOrNullObject(id);
        await ctx.sync();
        if (!cf.isNullObject) cf.delete();
      }
      break;
    }
    case "delete_sheet": {
      const ws = wb.worksheets.getItemOrNullObject(inv.name);
      await ctx.sync();
      if (!ws.isNullObject) ws.delete();
      break;
    }
    case "restore_sheet": {
      const ws = wb.worksheets.add(inv.name);
      ws.position = inv.position;
      if (inv.content) {
        const r = ws.getRange(inv.content.address);
        if (inv.content.formulas) r.formulas = inv.content.formulas;
        if (inv.content.numberFormats) r.numberFormat = inv.content.numberFormats;
      }
      break;
    }
    case "rename_sheet": {
      const ws = wb.worksheets.getItemOrNullObject(inv.from);
      await ctx.sync();
      if (!ws.isNullObject) ws.name = inv.to;
      break;
    }
    case "delete_inserted": {
      const ws = wb.worksheets.getItem(inv.sheet);
      const addr =
        inv.kind === "rows"
          ? `${inv.index}:${inv.index + inv.count - 1}`
          : `${indexToCol(inv.index)}:${indexToCol(inv.index + inv.count - 1)}`;
      ws.getRange(addr).delete(
        inv.kind === "rows" ? Excel.DeleteShiftDirection.up : Excel.DeleteShiftDirection.left
      );
      break;
    }
    case "reinsert_removed": {
      const ws = wb.worksheets.getItem(inv.sheet);
      const addr =
        inv.kind === "rows"
          ? `${inv.index}:${inv.index + inv.count - 1}`
          : `${indexToCol(inv.index)}:${indexToCol(inv.index + inv.count - 1)}`;
      ws.getRange(addr).insert(
        inv.kind === "rows" ? Excel.InsertShiftDirection.down : Excel.InsertShiftDirection.right
      );
      if (inv.content) {
        const r = ws.getRange(inv.content.address);
        if (inv.content.formulas) r.formulas = inv.content.formulas;
        if (inv.content.numberFormats) r.numberFormat = inv.content.numberFormats;
      }
      break;
    }
    case "unmerge": {
      wb.worksheets.getItem(inv.sheet).getRange(inv.address).unmerge();
      break;
    }
  }
}
