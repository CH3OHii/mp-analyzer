// Small live reads used by the agent loop. Impure — all Office access stays
// behind env.ts (this module is exercised by the manual E2E checklist, not
// unit tests, per the project's testing pattern).

import { hasExcel, runExcel } from "./env";
import { parseA1 } from "./guards";
import { clipMatrix } from "./summarize";
import { sampleMatrix, scanMatrix } from "./verify";

export interface LiveContext {
  text: string;
  sheetNames: string[];
}

/** One cheap Excel.run: active sheet + selection + the real sheet-name list.
 *  Refreshed every loop iteration so the model never plans against a stale
 *  active sheet, and so sheet args can be validated before Office throws. */
export async function getLiveContext(): Promise<LiveContext | null> {
  if (!hasExcel()) return null;
  const read = (withSelection: boolean) =>
    runExcel(async (ctx) => {
      const ws = ctx.workbook.worksheets.getActiveWorksheet();
      ws.load("name");
      const sheets = ctx.workbook.worksheets;
      sheets.load("items/name");
      const sel = withSelection ? ctx.workbook.getSelectedRange() : null;
      sel?.load("address");
      await ctx.sync();
      return {
        text: `[context: active sheet "${ws.name}"${sel ? `, selection ${sel.address}` : ""}]`,
        sheetNames: sheets.items.map((s) => s.name),
      };
    });
  try {
    return await read(true);
  } catch {
    /* chart or multi-area selection breaks getSelectedRange — retry without it */
  }
  try {
    return await read(false);
  } catch {
    return null;
  }
}

export interface ReadBack {
  sheet: string;
  address: string;
  cells_checked: number;
  errors: { cell: string; error: string }[];
  all_empty: boolean;
  sample: unknown[][];
}

export const READBACK_ERROR_MAX = 20;

/** A formula whose result is "" reads back as an empty value — the formulas
 *  matrix is the only way to tell "nothing landed" from "evaluates to empty". */
export function hasAnyFormula(formulas: unknown[][]): boolean {
  return formulas.some((row) => row.some((f) => typeof f === "string" && f.startsWith("=")));
}

/** Re-read a previously written range and scan what is actually there now. */
export async function readBackRange(sheet: string, address: string): Promise<ReadBack> {
  return runExcel(async (ctx) => {
    const ws = ctx.workbook.worksheets.getItem(sheet);
    const range = ws.getRange(address);
    range.load("values,formulas");
    await ctx.sync();
    const rect = parseA1(address) ?? { r0: 1, c0: 1, r1: 1, c1: 1 };
    const scan = scanMatrix(range.values, rect);
    return {
      sheet,
      address,
      cells_checked: scan.cells,
      errors: scan.errorCells.slice(0, READBACK_ERROR_MAX),
      all_empty: scan.nonEmpty === 0 && !hasAnyFormula(range.formulas),
      sample: clipMatrix(sampleMatrix(range.values)) ?? [],
    };
  });
}
