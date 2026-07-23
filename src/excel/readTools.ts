import { getSheet, runExcel } from "./env";
import {
  DEFAULT_READ_ROWS,
  FIND_MAX_DEFAULT,
  HEADER_MAX_COLS,
  READ_FULL_MAX,
  READ_SCAN_MAX,
  clipForRead,
  indexToCol,
  parseA1,
  rectToA1,
  sheetOf,
  stripSheet,
} from "./guards";
import { clipCell, clipMatrix } from "./summarize";
import type { ExcelToolSpec } from "./tools";

const sheetParam = { type: "string", description: "Sheet name; omit for the active sheet" };

export const readTools: ExcelToolSpec[] = [
  {
    name: "get_workbook_overview",
    description:
      "Map the whole workbook: every sheet with its used range, size, header row, chart count, pivot table names, plus table names and the user's current selection. Call this first when the workbook is unknown.",
    parameters: { type: "object", properties: {}, required: [] },
    mutating: "no",
    async run() {
      let selection = "";
      try {
        selection = await runExcel(async (ctx) => {
          const sel = ctx.workbook.getSelectedRange();
          sel.load("address");
          await ctx.sync();
          return sel.address;
        });
      } catch {
        /* chart or multi-area selection — leave blank */
      }
      return runExcel(async (ctx) => {
        const sheets = ctx.workbook.worksheets;
        sheets.load("items/name,items/visibility");
        const tables = ctx.workbook.tables;
        tables.load("items/name");
        await ctx.sync();

        const entries = sheets.items.map((ws) => ({
          ws,
          name: ws.name,
          visibility: ws.visibility,
          used: ws.getUsedRangeOrNullObject(),
          chartCount: ws.charts.getCount(),
          pivots: ws.pivotTables,
        }));
        entries.forEach((e) => {
          e.used.load("address,rowCount,columnCount,rowIndex,columnIndex");
          e.pivots.load("items/name");
        });
        const tableHandles = tables.items.map((t) => {
          const r = t.getRange();
          r.load("address");
          return { t, r };
        });
        await ctx.sync();

        const headerReads = entries
          .filter((e) => !e.used.isNullObject)
          .map((e) => {
            const cols = Math.min(e.used.columnCount, HEADER_MAX_COLS);
            const hr = e.ws.getRangeByIndexes(e.used.rowIndex, e.used.columnIndex, 1, cols);
            hr.load("values");
            return { name: e.name, hr };
          });
        await ctx.sync();

        const headerMap = new Map(headerReads.map((h) => [h.name, h.hr.values[0] ?? []]));
        const sheetLines = entries.map((e) => {
          const vis = e.visibility !== "Visible" ? ` | ${e.visibility}` : "";
          if (e.used.isNullObject) return `${e.name} | (empty)${vis}`;
          // Letter-annotated headers (B:"Sales") make the header→column mapping
          // explicit, so the model targets columns by letter instead of guessing.
          const hdr = (headerMap.get(e.name) ?? [])
            .map((v, i) => ({ s: String(v ?? ""), col: indexToCol(e.used.columnIndex + 1 + i) }))
            .filter((x) => x.s !== "")
            .map((x) => `${x.col}:"${x.s}"`)
            .join(", ");
          const charts = e.chartCount.value ? ` | ${e.chartCount.value} chart(s)` : "";
          const pivots = e.pivots.items.length ? ` | pivots: ${e.pivots.items.map((p) => p.name).join(", ")}` : "";
          return (
            `${e.name} | ${stripSheet(e.used.address)} | ${e.used.rowCount}x${e.used.columnCount}` +
            `${charts}${pivots}${vis}` +
            (hdr ? ` | headers: ${hdr}` : "")
          );
        });
        return { sheets: sheetLines, tables: tableHandles.map((h) => `${h.t.name} (${h.r.address})`), selection };
      });
    },
  },

  {
    name: "read_range",
    description:
      "Read values from a range (A1 notation). Large ranges are clipped (default 50 rows, 100 cols) — paginate with start_row/max_rows. Dates/times come back as Excel serial numbers; pass include_formats to see number formats, include_formulas to see formulas, include_display to see text as displayed (dates, percentages).",
    parameters: {
      type: "object",
      properties: {
        sheet: sheetParam,
        range: { type: "string", description: 'A1 range, e.g. "A1:H26"' },
        include_formulas: { type: "boolean" },
        include_formats: { type: "boolean" },
        include_display: { type: "boolean", description: "Also return text as displayed (formatted dates, %, etc.)" },
        start_row: { type: "integer", description: "1-based row offset within the range for pagination" },
        max_rows: { type: "integer", description: `Rows to return (default ${DEFAULT_READ_ROWS})` },
      },
      required: ["range"],
    },
    mutating: "no",
    async run(args) {
      const rangeA1 = String(args.range ?? "");
      if (!parseA1(rangeA1)) {
        return { error: { code: "bad_range", message: `Invalid A1 range: "${rangeA1}"` } };
      }
      return runExcel(async (ctx) => {
        const ws = getSheet(ctx, args.sheet as string | undefined);
        ws.load("name");
        const range = ws.getRange(rangeA1);
        range.load("address,rowCount,columnCount");
        await ctx.sync();

        const total = range.rowCount * range.columnCount;
        const paged = args.start_row != null || args.max_rows != null;
        if (total > READ_SCAN_MAX && !paged) {
          return {
            error: {
              code: "too_large",
              message: `Range is ${range.rowCount}x${range.columnCount} (${total} cells). For analysis this size, use aggregate_range (group-by/profile — scans in-engine). To inspect raw cells, narrow the range or paginate with start_row/max_rows.`,
            },
          };
        }
        const fullRect = parseA1(stripSheet(range.address))!;
        let target: Excel.Range = range;
        let clip = null;
        if (total > READ_FULL_MAX || paged) {
          clip = clipForRead(
            fullRect,
            args.start_row == null ? undefined : Number(args.start_row),
            args.max_rows == null ? undefined : Number(args.max_rows)
          );
          target = ws.getRange(rectToA1(clip.rect));
        }
        const props = ["values"];
        if (args.include_formulas) props.push("formulas");
        if (args.include_formats) props.push("numberFormat");
        if (args.include_display) props.push("text");
        target.load(props.join(","));
        await ctx.sync();

        const out: Record<string, unknown> = {
          address: `${ws.name}!${clip ? rectToA1(clip.rect) : stripSheet(range.address)}`,
          total_rows: range.rowCount,
          total_cols: range.columnCount,
          values: clipMatrix(target.values),
        };
        if (args.include_formulas) out.formulas = clipMatrix(target.formulas);
        if (args.include_formats) out.number_formats = target.numberFormat;
        if (args.include_display) out.display = clipMatrix(target.text);
        if (clip && (clip.truncated || clip.colsTruncated)) {
          out.truncated = true;
          out.hint = "Re-request with start_row/max_rows to page through; narrow the range for more columns.";
        }
        return out;
      });
    },
  },

  {
    name: "get_selection",
    description: "Read the user's currently selected range — use when the user says \"this\", \"here\", or \"what I selected\".",
    parameters: { type: "object", properties: {}, required: [] },
    mutating: "no",
    async run() {
      return runExcel(async (ctx) => {
        const sel = ctx.workbook.getSelectedRange();
        sel.load("address,rowCount,columnCount");
        await ctx.sync();
        const total = sel.rowCount * sel.columnCount;
        if (total <= READ_FULL_MAX) {
          sel.load("values");
          await ctx.sync();
          return { address: sel.address, values: clipMatrix(sel.values) };
        }
        const sheet = sheetOf(sel.address);
        const rect = parseA1(stripSheet(sel.address))!;
        const clip = clipForRead(rect);
        const ws = sheet ? ctx.workbook.worksheets.getItem(sheet) : ctx.workbook.worksheets.getActiveWorksheet();
        const sub = ws.getRange(rectToA1(clip.rect));
        sub.load("values");
        await ctx.sync();
        return {
          address: sel.address,
          total_rows: sel.rowCount,
          total_cols: sel.columnCount,
          values: clipMatrix(sub.values),
          truncated: true,
        };
      });
    },
  },

  {
    name: "find",
    description:
      "Search cell values for a string. Searches all sheets unless one is given. Returns matching cell addresses with values.",
    parameters: {
      type: "object",
      properties: {
        sheet: sheetParam,
        query: { type: "string" },
        match_case: { type: "boolean" },
        match_entire_cell: { type: "boolean" },
        max_results: { type: "integer", description: `Default ${FIND_MAX_DEFAULT}, max 200` },
      },
      required: ["query"],
    },
    mutating: "no",
    async run(args) {
      const query = String(args.query ?? "");
      if (!query) return { error: { code: "bad_query", message: "query must be non-empty" } };
      const maxResults = Math.min(Number(args.max_results) || FIND_MAX_DEFAULT, 200);
      return runExcel(async (ctx) => {
        let sheetObjs: Excel.Worksheet[];
        if (args.sheet) {
          sheetObjs = [ctx.workbook.worksheets.getItem(String(args.sheet))];
        } else {
          const coll = ctx.workbook.worksheets;
          coll.load("items/name");
          await ctx.sync();
          sheetObjs = coll.items;
        }
        const finds = sheetObjs.map((ws) => {
          ws.load("name");
          return {
            ws,
            ra: ws.findAllOrNullObject(query, {
              completeMatch: !!args.match_entire_cell,
              matchCase: !!args.match_case,
            }),
          };
        });
        finds.forEach((f) =>
          f.ra.load("areas/items/address,areas/items/values,areas/items/rowCount,areas/items/columnCount")
        );
        await ctx.sync();

        const matches: { sheet: string; address: string; value: unknown }[] = [];
        let total = 0;
        for (const f of finds) {
          if (f.ra.isNullObject) continue;
          for (const area of f.ra.areas.items) {
            const rect = parseA1(stripSheet(area.address));
            for (let r = 0; r < area.rowCount; r++) {
              for (let c = 0; c < area.columnCount; c++) {
                total++;
                if (matches.length < maxResults && rect) {
                  matches.push({
                    sheet: f.ws.name,
                    address: rectToA1({ r0: rect.r0 + r, c0: rect.c0 + c, r1: rect.r0 + r, c1: rect.c0 + c }),
                    value: clipCell(area.values[r][c]),
                  });
                }
              }
            }
          }
        }
        return { total, matches, truncated: total > matches.length };
      });
    },
  },
];
