// Pure aggregation core for aggregate_range. Fed chunk-by-chunk so the Office
// shell can stream a huge range through it while memory stays O(groups), never
// O(rows). Unit-tested without Office.

import { AGG_DISTINCT_TRACK_MAX, AGG_GROUPS_TRACK_MAX, colToIndex, indexToCol } from "./guards";
import { EXCEL_ERROR_LITERALS } from "./verify";

export type AggFn = "sum" | "count" | "avg" | "min" | "max" | "distinct";

export interface ResolvedCol {
  /** 0-based offset within the fed rows (range-relative). */
  idx: number;
  letter: string;
  header: string;
}

const LETTER_RE = /^[A-Za-z]{1,3}$/;

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/** Numeric view of a cell: real numbers pass through; numeric text coerces
 *  (exports often carry numbers-as-text); everything else is null. */
function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Map selectors (column letters or exact header text) to range-relative
 *  columns. A selector that parses as an in-range letter IS a letter — headers
 *  win only outside that. Matches the letter-annotated workbook overview. */
export function resolveColumns(
  headers: unknown[],
  startCol: number,
  selectors: string[]
): { cols: ResolvedCol[] } | { error: { code: string; message: string } } {
  const list = headers.map((h, i) => ({
    idx: i,
    letter: indexToCol(startCol + i),
    header: String(h ?? "").trim(),
  }));
  const available = () => list.filter((c) => c.header !== "").map((c) => `${c.letter}:"${c.header}"`).join(", ");
  const cols: ResolvedCol[] = [];
  for (const raw of selectors) {
    const sel = String(raw ?? "").trim();
    if (LETTER_RE.test(sel)) {
      const abs = colToIndex(sel);
      if (abs >= startCol && abs < startCol + headers.length) {
        cols.push(list[abs - startCol]);
        continue;
      }
    }
    const hits = list.filter((c) => c.header === sel);
    if (hits.length === 1) {
      cols.push(hits[0]);
    } else if (hits.length > 1) {
      return {
        error: {
          code: "ambiguous_column",
          message: `Header "${sel}" appears in columns ${hits.map((h) => h.letter).join(", ")} — target it by letter.`,
        },
      };
    } else {
      return {
        error: {
          code: "unknown_column",
          message: `No column "${sel}" in the range. Available: ${available()}`,
        },
      };
    }
  }
  return { cols };
}

// ---------------------------------------------------------------------------
// Filters

export type FilterOp = "eq" | "ne" | "gt" | "ge" | "lt" | "le" | "contains" | "in" | "blank" | "not_blank";

export interface FilterSpec {
  idx: number;
  op: FilterOp;
  value?: unknown;
  values?: unknown[];
}

export interface CompiledFilter extends FilterSpec {
  num: number | null;
  needle: string;
}

export function compileFilters(filters: FilterSpec[]): CompiledFilter[] {
  return filters.map((f) => ({ ...f, num: toNum(f.value), needle: String(f.value ?? "").toLowerCase() }));
}

function eq(cell: unknown, value: unknown): boolean {
  const a = toNum(cell);
  const b = toNum(value);
  if (a !== null && b !== null) return a === b;
  return String(cell ?? "") === String(value ?? "");
}

export function rowPasses(row: unknown[], filters: CompiledFilter[]): boolean {
  for (const f of filters) {
    const cell = row[f.idx];
    switch (f.op) {
      case "eq":
        if (!eq(cell, f.value)) return false;
        break;
      case "ne":
        if (eq(cell, f.value)) return false;
        break;
      case "gt":
      case "ge":
      case "lt":
      case "le": {
        const n = toNum(cell);
        if (n === null || f.num === null) return false;
        if (f.op === "gt" && !(n > f.num)) return false;
        if (f.op === "ge" && !(n >= f.num)) return false;
        if (f.op === "lt" && !(n < f.num)) return false;
        if (f.op === "le" && !(n <= f.num)) return false;
        break;
      }
      case "contains":
        if (!String(cell ?? "").toLowerCase().includes(f.needle)) return false;
        break;
      case "in":
        if (!(f.values ?? []).some((v) => eq(cell, v))) return false;
        break;
      case "blank":
        if (!isBlank(cell)) return false;
        break;
      case "not_blank":
        if (isBlank(cell)) return false;
        break;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Group-by aggregator

export interface AggSpec {
  groups: { idx: number; label: string }[];
  values: { idx: number; agg: AggFn; label: string }[];
  topN: number;
  sort: "desc" | "asc" | "group";
  groupsTrackMax?: number;
  distinctTrackMax?: number;
}

interface Acc {
  display: unknown[];
  rows: number;
  vals: {
    sum: number;
    numCnt: number;
    cnt: number;
    min: number | null;
    max: number | null;
    distinct: Set<string>;
    distinctOverflow: boolean;
  }[];
}

export interface AggResult {
  columns: string[];
  groups: unknown[][];
  groups_total: number;
  rows_scanned: number;
  other?: { group_count: number; values: (number | string | null)[] };
  skipped_non_numeric?: Record<string, number>;
  truncated: boolean;
}

export interface AggError {
  error: { code: string; message: string };
}

const KEY_SEP = "\u0000";
/** Key sentinel for a truly blank cell — distinct from the literal text "(blank)". */
const BLANK_KEY = "\u0001";

export function createAggregator(spec: AggSpec): {
  feed(rows: unknown[][]): void;
  result(): AggResult | AggError;
} {
  const groupsMax = spec.groupsTrackMax ?? AGG_GROUPS_TRACK_MAX;
  const distinctMax = spec.distinctTrackMax ?? AGG_DISTINCT_TRACK_MAX;
  const map = new Map<string, Acc>();
  const skipped: Record<string, number> = {};
  let rowsScanned = 0;
  let overflowed = false;

  const NUMERIC_AGGS: AggFn[] = ["sum", "avg", "min", "max"];

  function feed(rows: unknown[][]): void {
    for (const row of rows) {
      rowsScanned++;
      const display = spec.groups.map((g) => (isBlank(row[g.idx]) ? "(blank)" : row[g.idx]));
      const key = spec.groups.map((g) => (isBlank(row[g.idx]) ? BLANK_KEY : String(row[g.idx]))).join(KEY_SEP);
      let acc = map.get(key);
      if (!acc) {
        if (map.size >= groupsMax) {
          overflowed = true;
          continue;
        }
        acc = {
          display,
          rows: 0,
          vals: spec.values.map(() => ({
            sum: 0,
            numCnt: 0,
            cnt: 0,
            min: null,
            max: null,
            distinct: new Set<string>(),
            distinctOverflow: false,
          })),
        };
        map.set(key, acc);
      }
      acc.rows++;
      for (let i = 0; i < spec.values.length; i++) {
        const vspec = spec.values[i];
        const cell = row[vspec.idx];
        const a = acc.vals[i];
        if (!isBlank(cell)) {
          a.cnt++;
          if (vspec.agg === "distinct") {
            if (a.distinct.size < distinctMax) a.distinct.add(String(cell));
            else if (!a.distinct.has(String(cell))) a.distinctOverflow = true;
          }
        }
        const n = toNum(cell);
        if (n !== null) {
          a.numCnt++;
          a.sum += n;
          a.min = a.min === null ? n : Math.min(a.min, n);
          a.max = a.max === null ? n : Math.max(a.max, n);
        } else if (!isBlank(cell) && NUMERIC_AGGS.includes(vspec.agg)) {
          skipped[vspec.label] = (skipped[vspec.label] ?? 0) + 1;
        }
      }
    }
  }

  function outValue(a: Acc["vals"][number], agg: AggFn, cap: number): number | string | null {
    switch (agg) {
      case "sum":
        return a.sum;
      case "count":
        return a.cnt;
      case "avg":
        return a.numCnt ? a.sum / a.numCnt : null;
      case "min":
        return a.min;
      case "max":
        return a.max;
      case "distinct":
        return a.distinctOverflow ? `>${cap}` : a.distinct.size;
    }
  }

  function result(): AggResult | AggError {
    if (overflowed) {
      return {
        error: {
          code: "too_many_groups",
          message: `More than ${groupsMax} distinct groups — narrow group_by (or filter first), or build a pivot table instead.`,
        },
      };
    }
    const entries = [...map.entries()];
    const sortValue = (acc: Acc): number => {
      if (!spec.values.length) return acc.rows;
      const a = acc.vals[0];
      switch (spec.values[0].agg) {
        case "sum":
          return a.sum;
        case "count":
          return a.cnt;
        case "avg":
          return a.numCnt ? a.sum / a.numCnt : Number.NEGATIVE_INFINITY;
        case "min":
          return a.min ?? Number.NEGATIVE_INFINITY;
        case "max":
          return a.max ?? Number.NEGATIVE_INFINITY;
        case "distinct":
          // Over-cap sets still rank by tracked size, never as -Infinity.
          return a.distinct.size;
      }
    };
    if (spec.sort === "group") entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    else {
      const sign = spec.sort === "asc" ? 1 : -1;
      entries.sort((a, b) => sign * (sortValue(a[1]) - sortValue(b[1])));
    }

    const shown = entries.slice(0, spec.topN);
    const rest = entries.slice(spec.topN);
    const rows = shown.map(([, acc]) => [
      ...acc.display,
      ...spec.values.map((v, i) => outValue(acc.vals[i], v.agg, distinctMax)),
      acc.rows,
    ]);

    const out: AggResult = {
      columns: [...spec.groups.map((g) => g.label), ...spec.values.map((v) => v.label), "rows"],
      groups: rows,
      groups_total: map.size,
      rows_scanned: rowsScanned,
      truncated: rest.length > 0,
    };
    if (rest.length) {
      // Mergeable aggregates roll up exactly; distinct cannot merge across groups.
      const values: (number | string | null)[] = spec.values.map((v, i) => {
        if (v.agg === "distinct") return null;
        if (v.agg === "sum") return rest.reduce((s, [, a]) => s + a.vals[i].sum, 0);
        if (v.agg === "count") return rest.reduce((s, [, a]) => s + a.vals[i].cnt, 0);
        if (v.agg === "avg") {
          const num = rest.reduce((s, [, a]) => s + a.vals[i].sum, 0);
          const den = rest.reduce((s, [, a]) => s + a.vals[i].numCnt, 0);
          return den ? num / den : null;
        }
        if (v.agg === "min")
          return rest.reduce<number | null>((m, [, a]) => {
            const x = a.vals[i].min;
            return x === null ? m : m === null ? x : Math.min(m, x);
          }, null);
        return rest.reduce<number | null>((m, [, a]) => {
          const x = a.vals[i].max;
          return x === null ? m : m === null ? x : Math.max(m, x);
        }, null);
      });
      values.push(rest.reduce((s, [, a]) => s + a.rows, 0));
      out.other = { group_count: rest.length, values };
    }
    if (Object.keys(skipped).length) out.skipped_non_numeric = skipped;
    return out;
  }

  return { feed, result };
}

// ---------------------------------------------------------------------------
// Column profiler

export interface ColumnProfile {
  column: string;
  header: string;
  types: { number: number; string: number; boolean: number; blank: number; error: number };
  min: number | null;
  max: number | null;
  distinct: number | string;
  top_values: { v: unknown; n: number }[];
}

export function createProfiler(
  cols: ResolvedCol[],
  opts: { distinctTrackMax?: number } = {}
): { feed(rows: unknown[][]): void; result(): { columns: ColumnProfile[] } } {
  const cap = opts.distinctTrackMax ?? AGG_DISTINCT_TRACK_MAX;
  const state = cols.map(() => ({
    types: { number: 0, string: 0, boolean: 0, blank: 0, error: 0 },
    min: null as number | null,
    max: null as number | null,
    counts: new Map<string, { v: unknown; n: number }>(),
    overflow: false,
  }));

  function feed(rows: unknown[][]): void {
    for (const row of rows) {
      for (let i = 0; i < cols.length; i++) {
        const v = row[cols[i].idx];
        const s = state[i];
        if (isBlank(v)) {
          s.types.blank++;
          continue;
        }
        if (typeof v === "number") {
          s.types.number++;
          if (Number.isFinite(v)) {
            s.min = s.min === null ? v : Math.min(s.min, v);
            s.max = s.max === null ? v : Math.max(s.max, v);
          }
        } else if (typeof v === "boolean") {
          s.types.boolean++;
        } else if (typeof v === "string" && EXCEL_ERROR_LITERALS.has(v)) {
          s.types.error++;
          continue; // error literals are noise, not values
        } else {
          s.types.string++;
        }
        const key = String(v);
        const entry = s.counts.get(key);
        if (entry) entry.n++;
        else if (s.counts.size < cap) s.counts.set(key, { v, n: 1 });
        else s.overflow = true;
      }
    }
  }

  function result(): { columns: ColumnProfile[] } {
    return {
      columns: cols.map((c, i) => {
        const s = state[i];
        const top = [...s.counts.values()].sort((a, b) => b.n - a.n).slice(0, 5);
        return {
          column: c.letter,
          header: c.header,
          types: s.types,
          min: s.min,
          max: s.max,
          distinct: s.overflow ? `>${cap}` : s.counts.size,
          top_values: top,
        };
      }),
    };
  }

  return { feed, result };
}
