// Size caps + A1 math. Pure functions — unit-tested without Office.

export const READ_FULL_MAX = 5_000; // cells returned whole
export const READ_SCAN_MAX = 100_000; // beyond this, refuse and ask to paginate
export const READ_COL_MAX = 100; // columns returned per read
export const WRITE_MAX = 10_000;
export const SNAPSHOT_MAX = 20_000; // refuse mutations bigger than this
export const RESULT_MAX_CHARS = 12_000;
export const CELL_STR_MAX = 200;
export const PREVIEW_MAX_ROWS = 10;
export const PREVIEW_MAX_COLS = 8;
export const HEADER_MAX_COLS = 30;
export const FIND_MAX_DEFAULT = 50;
export const DEFAULT_READ_ROWS = 50;

// aggregate_range: in-engine aggregation reads far more cells than read_range
// because only compact summaries reach the model.
export const AGG_SCAN_MAX = 10_000_000; // ~1M rows × 10 cols — Excel's full grid height
export const AGG_CHUNK_CELLS = 100_000; // cells loaded per ctx.sync()
export const AGG_TOP_N_MAX = 200; // groups returned to the model
export const AGG_GROUPS_TRACK_MAX = 50_000; // memory ceiling for the group map
export const AGG_DISTINCT_TRACK_MAX = 10_000; // per-column/group distinct-set cap
/** formula_r1c1 fills above SNAPSHOT_MAX escalate to hard approval with NO undo
 *  step (too big to snapshot); refused only above this. ≈ one full column. */
export const FILL_MAX = 1_050_000;

/** Undo policy for sorts (same rule as big formula fills): snapshot-and-soft
 *  up to SNAPSHOT_MAX, hard-approval-with-no-undo above it. */
export function sortUndoPlan(cells: number): { mut: "soft" | "hard"; snapshot: boolean } {
  return cells <= SNAPSHOT_MAX ? { mut: "soft", snapshot: true } : { mut: "hard", snapshot: false };
}

/** Quote a sheet name for use in an address string (`'Q1 Data'!A1:B5`).
 *  Conservative: quotes anything beyond plain identifier characters AND names
 *  that would misparse as a cell reference (a sheet literally named "A1"). */
export function quoteSheetName(name: string): string {
  const plain = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !parseCellRef(name);
  return plain ? name : `'${name.replace(/'/g, "''")}'`;
}

/** 1-based inclusive rectangle. */
export interface Rect {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export function colToIndex(col: string): number {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function indexToCol(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Strip a leading `Sheet!` / `'My Sheet'!` qualifier, returning the local ref. */
export function stripSheet(a1: string): string {
  const i = a1.lastIndexOf("!");
  return i === -1 ? a1 : a1.slice(i + 1);
}

/** Extract the sheet name from a qualified address, or null. */
export function sheetOf(a1: string): string | null {
  const i = a1.lastIndexOf("!");
  if (i === -1) return null;
  return a1.slice(0, i).replace(/^'(.*)'$/, "$1").replace(/''/g, "'");
}

const CELL_RE = /^\$?([A-Za-z]{1,3})\$?(\d+)$/;

export function parseCellRef(ref: string): { row: number; col: number } | null {
  const m = CELL_RE.exec(ref.trim());
  if (!m) return null;
  const row = Number(m[2]);
  const col = colToIndex(m[1]);
  if (row < 1 || row > 1_048_576 || col < 1 || col > 16_384) return null;
  return { row, col };
}

/** Parse "A1" or "A1:D20" (optionally sheet-qualified) into a normalized Rect. */
export function parseA1(a1: string): Rect | null {
  const local = stripSheet(a1).trim();
  const parts = local.split(":");
  if (parts.length > 2) return null;
  const a = parseCellRef(parts[0]);
  if (!a) return null;
  const b = parts.length === 2 ? parseCellRef(parts[1]) : a;
  if (!b) return null;
  return {
    r0: Math.min(a.row, b.row),
    c0: Math.min(a.col, b.col),
    r1: Math.max(a.row, b.row),
    c1: Math.max(a.col, b.col),
  };
}

export function rectRows(r: Rect): number {
  return r.r1 - r.r0 + 1;
}
export function rectCols(r: Rect): number {
  return r.c1 - r.c0 + 1;
}
export function rectCells(r: Rect): number {
  return rectRows(r) * rectCols(r);
}

export function rectsEqual(a: Rect, b: Rect): boolean {
  return a.r0 === b.r0 && a.c0 === b.c0 && a.r1 === b.r1 && a.c1 === b.c1;
}

/** True when `outer` fully contains `inner`. */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return outer.r0 <= inner.r0 && outer.c0 <= inner.c0 && outer.r1 >= inner.r1 && outer.c1 >= inner.c1;
}

export function rectToA1(r: Rect): string {
  const a = `${indexToCol(r.c0)}${r.r0}`;
  const b = `${indexToCol(r.c1)}${r.r1}`;
  return a === b ? a : `${a}:${b}`;
}

/** Address of a rows×cols block anchored at startCell. */
export function expandFromStart(startCell: string, rows: number, cols: number): string | null {
  const start = parseCellRef(stripSheet(startCell));
  if (!start || rows < 1 || cols < 1) return null;
  return rectToA1({ r0: start.row, c0: start.col, r1: start.row + rows - 1, c1: start.col + cols - 1 });
}

export interface ClipResult {
  rect: Rect;
  truncated: boolean;
  colsTruncated: boolean;
  totalRows: number;
  totalCols: number;
}

/**
 * Clip a read window: honor start_row/max_rows (1-based within the range), cap
 * columns at READ_COL_MAX, then shrink rows further so cells ≤ READ_FULL_MAX.
 */
export function clipForRead(full: Rect, startRow?: number, maxRows?: number): ClipResult {
  const totalRows = rectRows(full);
  const totalCols = rectCols(full);
  const from = Math.min(Math.max(startRow ?? 1, 1), totalRows);
  let rows = Math.min(maxRows ?? DEFAULT_READ_ROWS, totalRows - from + 1);
  const cols = Math.min(totalCols, READ_COL_MAX);
  if (rows * cols > READ_FULL_MAX) rows = Math.max(1, Math.floor(READ_FULL_MAX / cols));
  const rect: Rect = {
    r0: full.r0 + from - 1,
    c0: full.c0,
    r1: full.r0 + from - 1 + rows - 1,
    c1: full.c0 + cols - 1,
  };
  return {
    rect,
    truncated: rows < totalRows - from + 1 || from > 1,
    colsTruncated: cols < totalCols,
    totalRows,
    totalCols,
  };
}

/** Normalize a possibly-ragged 2D array to rows×cols, padding with null. */
export function normalizeMatrix(values: unknown[][]): { rows: number; cols: number; matrix: unknown[][] } {
  const rows = values.length;
  const cols = values.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);
  const matrix = values.map((r) => {
    const row = Array.isArray(r) ? [...r] : [];
    while (row.length < cols) row.push(null);
    return row;
  });
  return { rows, cols, matrix };
}
