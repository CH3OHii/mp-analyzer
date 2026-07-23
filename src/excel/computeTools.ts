// aggregate_range: in-engine analysis over ranges far too big to show the
// model. Reads the range in chunks (narrow strips of only the needed columns,
// AGG_CHUNK_CELLS per sync) and feeds the pure aggregator/profiler from
// aggregate.ts — only a compact summary ever reaches the model.

import {
  compileFilters,
  createAggregator,
  createProfiler,
  resolveColumns,
  rowPasses,
  type AggFn,
  type FilterOp,
  type ResolvedCol,
} from "./aggregate";
import { getSheet, runExcel } from "./env";
import {
  AGG_CHUNK_CELLS,
  AGG_SCAN_MAX,
  AGG_TOP_N_MAX,
  indexToCol,
  parseA1,
  rectCells,
  rectCols,
  rectRows,
  rectToA1,
} from "./guards";
import type { ExcelToolSpec } from "./tools";

const sheetParam = { type: "string", description: "Sheet name; omit for the active sheet" };

/** Merge sorted unique column offsets into contiguous strips so a 15-column
 *  sheet where 3 columns matter reads 3 narrow ranges, not the full width. */
function contiguousRuns(idxs: number[]): { start: number; len: number }[] {
  const runs: { start: number; len: number }[] = [];
  for (const i of [...new Set(idxs)].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && i === last.start + last.len) last.len++;
    else runs.push({ start: i, len: 1 });
  }
  return runs;
}

const label = (c: ResolvedCol) => c.header || c.letter;

export const computeTools: ExcelToolSpec[] = [
  {
    name: "aggregate_range",
    description:
      "Analyze a large range in-engine — scans up to 10M cells but returns only a compact summary. Group-by mode: group_by + values (sum/count/avg/min/max/distinct) + filters + top_n. Profile mode: per-column types, min/max, top values. Row 1 of the range must be headers. Use this instead of paging read_range.",
    parameters: {
      type: "object",
      properties: {
        sheet: sheetParam,
        range: { type: "string", description: 'A1 range INCLUDING the header row, e.g. "A1:H180000"' },
        group_by: {
          type: "array",
          items: { type: "string" },
          description: "Column letters or exact header text; omit for whole-range totals",
        },
        values: {
          type: "array",
          items: {
            type: "object",
            properties: {
              column: { type: "string" },
              agg: { type: "string", enum: ["sum", "count", "avg", "min", "max", "distinct"] },
            },
            required: ["column", "agg"],
          },
          description: "Aggregations per column; default: row count per group",
        },
        filters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              column: { type: "string" },
              op: { type: "string", enum: ["eq", "ne", "gt", "ge", "lt", "le", "contains", "in", "blank", "not_blank"] },
              value: {},
              values: { type: "array" },
            },
            required: ["column", "op"],
          },
        },
        top_n: { type: "integer", description: `Groups returned (default 50, max ${AGG_TOP_N_MAX}); the rest roll into "other"` },
        sort: { type: "string", enum: ["desc", "asc", "group"] },
        profile: { type: "boolean", description: "Profile mode instead of aggregation" },
        columns: { type: "array", items: { type: "string" }, description: "Profile mode: columns to profile (default all)" },
      },
      required: ["range"],
    },
    mutating: "no",
    async run(args) {
      const rect = parseA1(String(args.range ?? ""));
      if (!rect) return { error: { code: "bad_range", message: `Invalid A1 range: "${args.range}"` } };
      const cells = rectCells(rect);
      if (cells > AGG_SCAN_MAX) {
        return {
          error: {
            code: "too_large",
            message: `Range is ${cells} cells — the aggregate scan cap is ${AGG_SCAN_MAX}. Narrow the range.`,
          },
        };
      }
      const totalCols = rectCols(rect);
      const dataRows = rectRows(rect) - 1; // row 1 = headers
      const profile = !!args.profile;

      return runExcel(async (ctx) => {
        const ws = getSheet(ctx, args.sheet as string | undefined);
        ws.load("name");
        const headerRange = ws.getRangeByIndexes(rect.r0 - 1, rect.c0 - 1, 1, totalCols);
        headerRange.load("values");
        await ctx.sync();
        const headers = headerRange.values[0] ?? [];
        const address = `${ws.name}!${rectToA1(rect)}`;

        // Resolve every selector against the header row.
        const resolve = (sel: string[]) => resolveColumns(headers, rect.c0, sel);
        const groupSel = (args.group_by as string[]) ?? [];
        const valueSel = ((args.values as { column: string; agg: AggFn }[]) ?? []).map((v) => v ?? { column: "", agg: "sum" });
        const filterSel =
          ((args.filters as { column: string; op: FilterOp; value?: unknown; values?: unknown[] }[]) ?? []) || [];

        const groupR = resolve(groupSel);
        if ("error" in groupR) return groupR;
        const valueR = resolve(valueSel.map((v) => v.column));
        if ("error" in valueR) return valueR;
        const filterR = resolve(filterSel.map((f) => f.column));
        if ("error" in filterR) return filterR;
        const allCols: ResolvedCol[] = headers.map((h, i) => ({
          idx: i,
          letter: indexToCol(rect.c0 + i),
          header: String(h ?? "").trim(),
        }));
        const profileR = profile
          ? args.columns
            ? resolve(args.columns as string[])
            : { cols: allCols }
          : { cols: [] as ResolvedCol[] };
        if ("error" in profileR) return profileR;

        const consumer = profile
          ? createProfiler(profileR.cols)
          : createAggregator({
              groups: groupR.cols.map((c) => ({ idx: c.idx, label: label(c) })),
              values: valueR.cols.map((c, i) => ({ idx: c.idx, agg: valueSel[i].agg, label: `${valueSel[i].agg}(${label(c)})` })),
              topN: Math.min(Number(args.top_n) || 50, AGG_TOP_N_MAX),
              sort: (args.sort as "desc" | "asc" | "group") ?? "desc",
            });
        const compiled = compileFilters(filterSel.map((f, i) => ({ idx: filterR.cols[i].idx, op: f.op, value: f.value, values: f.values })));

        const needed = [
          ...groupR.cols.map((c) => c.idx),
          ...valueR.cols.map((c) => c.idx),
          ...filterR.cols.map((c) => c.idx),
          ...profileR.cols.map((c) => c.idx),
        ];
        // Whole-range totals with no columns named still needs rows fed —
        // read the first column so the row count comes back real, not zero.
        if (!profile && needed.length === 0) needed.push(0);
        const runs = contiguousRuns(needed);
        const neededCount = runs.reduce((s, r) => s + r.len, 0);
        let matched = 0;

        if (dataRows > 0 && neededCount > 0) {
          const chunkRows = Math.max(1, Math.floor(AGG_CHUNK_CELLS / neededCount));
          for (let off = 0; off < dataRows; off += chunkRows) {
            const n = Math.min(chunkRows, dataRows - off);
            const handles = runs.map((run) => {
              const rg = ws.getRangeByIndexes(rect.r0 + off, rect.c0 - 1 + run.start, n, run.len);
              rg.load("values");
              return { run, rg };
            });
            await ctx.sync();
            const batch: unknown[][] = [];
            for (let i = 0; i < n; i++) {
              const row: unknown[] = [];
              for (const h of handles) {
                const vals = h.rg.values[i];
                for (let j = 0; j < h.run.len; j++) row[h.run.start + j] = vals[j];
              }
              if (compiled.length && !rowPasses(row, compiled)) continue;
              batch.push(row);
            }
            matched += batch.length;
            consumer.feed(batch);
            // handles go out of scope here — memory stays O(groups), not O(rows)
          }
        }

        const res = consumer.result();
        if ("error" in res) return res;
        return {
          mode: profile ? "profile" : "aggregate",
          address,
          total_data_rows: Math.max(0, dataRows),
          ...(compiled.length ? { rows_matched: matched } : {}),
          ...res,
          // The aggregator only sees post-filter rows; report rows EXAMINED.
          rows_scanned: Math.max(0, dataRows),
        };
      });
    },
  },
];
