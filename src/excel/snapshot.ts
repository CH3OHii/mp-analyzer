import { useSyncExternalStore } from "react";
import { runExcel } from "./env";
import { indexToCol } from "./guards";
import { aggToOffice, applyPivotConfig, findDataHierarchy, type PivotAgg, type PivotConfig } from "./pivotConfig";

export type StepKind = "range" | "format" | "structure" | "chart" | "cf" | "sheet" | "pivot";

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
  | { op: "unmerge"; sheet: string; address: string }
  | { op: "delete_pivot"; sheet: string; name: string }
  | { op: "restore_pivot"; config: PivotConfig }
  | {
      /** Targeted pivot-edit inverse — preserves user styling, unlike a
       *  delete-and-recreate, and needs no source address. */
      op: "pivot_field";
      sheet: string;
      pivot: string;
      action: "add" | "remove" | "set_agg";
      field: string;
      area: "rows" | "columns" | "values";
      /** Tool-level agg, or a verbatim Office aggregation name (faithful restore). */
      agg?: PivotAgg | string;
    }
  | { op: "unlist_table"; name: string }
  | { op: "recreate_table"; sheet: string; address: string; name: string; showHeaders: boolean; style: string | null }
  | { op: "rename_table"; from: string; to: string }
  | { op: "set_table_totals"; name: string; on: boolean }
  | { op: "clear_autofilter"; sheet: string }
  | { op: "clear_table_filter"; name: string; column: string };

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
  // Each inverse/snapshot restores independently: one dead object (a pivot,
  // table, or sheet the user already deleted) must not wedge the whole undo
  // stack — the remaining pieces still restore and the step still pops.
  await runExcel(async (ctx) => {
    for (const inv of step.inverses) {
      try {
        await applyInverse(ctx, inv);
        await ctx.sync();
      } catch (e) {
        console.warn(`revert: inverse "${inv.op}" failed — continuing`, e);
      }
    }
    for (let i = step.snapshots.length - 1; i >= 0; i--) {
      try {
        await restoreRange(ctx, step.snapshots[i]);
        await ctx.sync();
      } catch (e) {
        console.warn(`revert: range restore ${step.snapshots[i].sheet}!${step.snapshots[i].address} failed`, e);
      }
    }
  });
}

/** Resolve a worksheet by name for a REVERT target. The sheet may have been
 *  renamed or deleted since the step was recorded — that's not an error,
 *  there's nothing sane to invert against a gone sheet. Returns null instead
 *  of throwing, so one missing target doesn't abort (or get silently eaten
 *  by) the rest of the revert. */
async function findSheet(ctx: Excel.RequestContext, name: string): Promise<Excel.Worksheet | null> {
  const ws = ctx.workbook.worksheets.getItemOrNullObject(name);
  await ctx.sync();
  return ws.isNullObject ? null : ws;
}

async function restoreRange(ctx: Excel.RequestContext, snap: RangeSnapshot): Promise<void> {
  const ws = await findSheet(ctx, snap.sheet);
  if (!ws) return;
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
      const ws = await findSheet(ctx, inv.sheet);
      if (!ws) break;
      const ch = ws.charts.getItemOrNullObject(inv.name);
      await ctx.sync();
      if (!ch.isNullObject) ch.delete();
      break;
    }
    case "delete_cf": {
      const ws = await findSheet(ctx, inv.sheet);
      if (!ws) break;
      const range = ws.getRange(inv.address);
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
      const ws = await findSheet(ctx, inv.sheet);
      if (!ws) break;
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
      const ws = await findSheet(ctx, inv.sheet);
      if (!ws) break;
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
      const ws = await findSheet(ctx, inv.sheet);
      if (!ws) break;
      ws.getRange(inv.address).unmerge();
      break;
    }
    case "delete_pivot": {
      const ws = await findSheet(ctx, inv.sheet);
      if (!ws) break;
      const pt = ws.pivotTables.getItemOrNullObject(inv.name);
      await ctx.sync();
      if (!pt.isNullObject) pt.delete();
      break;
    }
    case "restore_pivot": {
      // Mirror manage_pivot's own create(): if the recreate fails partway
      // (e.g. a field renamed since delete), clean up the half-built artifact
      // instead of leaving an orphan pivot behind.
      try {
        applyPivotConfig(ctx, inv.config);
        await ctx.sync();
      } catch (e) {
        try {
          const ws = await findSheet(ctx, inv.config.destSheet);
          if (ws) {
            const orphan = ws.pivotTables.getItemOrNullObject(inv.config.name);
            await ctx.sync();
            if (!orphan.isNullObject) orphan.delete();
            await ctx.sync();
          }
        } catch {
          /* best-effort cleanup */
        }
        throw e;
      }
      break;
    }
    case "unlist_table": {
      const t = wb.tables.getItemOrNullObject(inv.name);
      await ctx.sync();
      if (!t.isNullObject) t.convertToRange();
      break;
    }
    case "recreate_table": {
      const ws = await findSheet(ctx, inv.sheet);
      if (!ws) break;
      // unlist left the original header text in the grid, so hasHeaders is
      // ALWAYS true here — passing false would generate a new header row and
      // shift the data down. The display flag is restored separately.
      const t = ws.tables.add(inv.address, true);
      t.name = inv.name;
      if (inv.style) t.style = inv.style;
      if (!inv.showHeaders) t.showHeaders = false;
      break;
    }
    case "rename_table": {
      const t = wb.tables.getItemOrNullObject(inv.from);
      await ctx.sync();
      if (!t.isNullObject) t.name = inv.to;
      break;
    }
    case "set_table_totals": {
      const t = wb.tables.getItemOrNullObject(inv.name);
      await ctx.sync();
      if (!t.isNullObject) t.showTotals = inv.on;
      break;
    }
    case "clear_autofilter": {
      const ws = await findSheet(ctx, inv.sheet);
      if (!ws) break;
      ws.autoFilter.remove();
      break;
    }
    case "clear_table_filter": {
      const t = wb.tables.getItemOrNullObject(inv.name);
      await ctx.sync();
      if (t.isNullObject) break;
      const col = t.columns.getItemOrNullObject(inv.column);
      await ctx.sync();
      if (!col.isNullObject) col.filter.clear();
      break;
    }
    case "pivot_field": {
      const psheet = await findSheet(ctx, inv.sheet);
      if (!psheet) break;
      const pt = psheet.pivotTables.getItemOrNullObject(inv.pivot);
      await ctx.sync();
      if (pt.isNullObject) break; // pivot gone since the edit — nothing to invert
      if (inv.action === "add") {
        const h = pt.hierarchies.getItemOrNullObject(inv.field);
        await ctx.sync();
        if (h.isNullObject) break; // field gone from the source — nothing to re-add
        if (inv.area === "rows") pt.rowHierarchies.add(h);
        else if (inv.area === "columns") pt.columnHierarchies.add(h);
        else {
          const dh = pt.dataHierarchies.add(h);
          if (inv.agg) dh.summarizeBy = aggToOffice(inv.agg) as Excel.AggregationFunction;
        }
      } else if (inv.action === "remove") {
        if (inv.area === "rows" || inv.area === "columns") {
          const coll = inv.area === "rows" ? pt.rowHierarchies : pt.columnHierarchies;
          const h = coll.getItemOrNullObject(inv.field);
          await ctx.sync();
          if (!h.isNullObject) coll.remove(h);
        } else {
          const dh = await findDataHierarchy(ctx, pt, inv.field);
          if (dh) pt.dataHierarchies.remove(dh);
        }
      } else {
        const dh = await findDataHierarchy(ctx, pt, inv.field);
        if (dh && inv.agg) dh.summarizeBy = aggToOffice(inv.agg) as Excel.AggregationFunction;
      }
      break;
    }
  }
}
