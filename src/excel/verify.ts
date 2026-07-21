// Post-write verification scanning. Pure functions over already-fetched value
// matrices — unit-tested without Office.

import { indexToCol, type Rect } from "./guards";

/** Every literal Excel renders for an error cell in range.values — classic
 *  errors plus the linked-data / rich-value / Python-in-Excel families. */
export const EXCEL_ERROR_LITERALS = new Set([
  "#NAME?",
  "#REF!",
  "#VALUE!",
  "#DIV/0!",
  "#N/A",
  "#NUM!",
  "#NULL!",
  "#SPILL!",
  "#CALC!",
  "#FIELD!",
  "#BLOCKED!",
  "#CONNECT!",
  "#BUSY!",
  "#UNKNOWN!",
  "#GETTING_DATA",
  "#PYTHON!",
  "#EXTERNAL!",
]);

export interface ErrorCell {
  cell: string;
  error: string;
}

export interface ScanResult {
  errorCells: ErrorCell[];
  nonEmpty: number;
  cells: number;
}

/** Scan a values matrix for error literals. `origin` maps matrix indices back
 *  to real cell addresses (the matrix's [0][0] sits at origin.r0/c0). */
export function scanMatrix(values: unknown[][], origin: Rect): ScanResult {
  const errorCells: ErrorCell[] = [];
  let nonEmpty = 0;
  let cells = 0;
  for (let r = 0; r < values.length; r++) {
    const row = values[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      cells++;
      const v = row[c];
      if (v !== "" && v !== null && v !== undefined) nonEmpty++;
      if (typeof v === "string" && EXCEL_ERROR_LITERALS.has(v)) {
        errorCells.push({ cell: `${indexToCol(origin.c0 + c)}${origin.r0 + r}`, error: v });
      }
    }
  }
  return { errorCells, nonEmpty, cells };
}

export const SAMPLE_MAX_ROWS = 3;
export const SAMPLE_MAX_COLS = 8;

/** Bounded top-left corner of a matrix — enough signal to show what landed. */
export function sampleMatrix(values: unknown[][], maxRows = SAMPLE_MAX_ROWS, maxCols = SAMPLE_MAX_COLS): unknown[][] {
  return values.slice(0, maxRows).map((row) => row.slice(0, maxCols));
}
