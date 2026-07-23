// manage_table + sort_filter: Excel Tables (ListObjects), range/table sorting,
// and filtering. All core APIs are ≤ ExcelApi 1.9. Undo: tables get precise
// inverse ops (create↔unlist, rename↔rename, totals↔totals); sorts snapshot the
// grid up to SNAPSHOT_MAX and escalate to hard-with-no-undo above it (the same
// policy as big formula fills); filter inverses clear criteria (the previous
// criteria are not restored — disclosed in results).

import { resolveColumns } from "./aggregate";
import { getSheet, runExcel } from "./env";
import {
  AGG_SCAN_MAX,
  SNAPSHOT_MAX,
  colToIndex,
  parseA1,
  rectCells,
  rectCols,
  rectToA1,
  sheetOf,
  sortUndoPlan,
  stripSheet,
} from "./guards";

/** Sorts move whole cells, styling included — capture the visible styling for
 *  revert. Borders are excluded (too heavy to hold on the undo stack for 20k
 *  cells) and that limit is disclosed in every snapshotted-sort result. */
const SORT_CELL_PROPS = {
  format: {
    fill: { color: true },
    font: { bold: true, italic: true, name: true, size: true, color: true },
    horizontalAlignment: true,
    verticalAlignment: true,
    wrapText: true,
  },
} as const;
const SORT_REVERT_NOTE = "Revert restores contents, number formats and cell styling (borders excepted).";
import { pushStep } from "./snapshot";
import type { ExcelToolSpec } from "./tools";

const sheetParam = { type: "string", description: "Sheet name; omit for the active sheet" };
const LETTER_RE = /^[A-Za-z]{1,3}$/;

/** Resolve sort/filter column selectors to 0-based offsets within a range:
 *  header text when a header row is available, letters always. */
async function resolveRangeColumns(
  ctx: Excel.RequestContext,
  ws: Excel.Worksheet,
  rect: { r0: number; c0: number; r1: number; c1: number },
  selectors: string[],
  hasHeaders: boolean
): Promise<{ idxs: number[] } | { error: { code: string; message: string } }> {
  if (hasHeaders) {
    const hr = ws.getRangeByIndexes(rect.r0 - 1, rect.c0 - 1, 1, rectCols(rect));
    hr.load("values");
    await ctx.sync();
    const r = resolveColumns(hr.values[0] ?? [], rect.c0, selectors);
    if ("error" in r) return r;
    return { idxs: r.cols.map((c) => c.idx) };
  }
  const idxs: number[] = [];
  for (const sel of selectors) {
    if (!LETTER_RE.test(sel)) {
      return { error: { code: "bad_args", message: `Without has_headers, sort keys must be column letters, got "${sel}"` } };
    }
    const idx = colToIndex(sel) - rect.c0;
    if (idx < 0 || idx >= rectCols(rect)) {
      return { error: { code: "bad_args", message: `Column ${sel} is outside the range` } };
    }
    idxs.push(idx);
  }
  return { idxs };
}

export const tableTools: ExcelToolSpec[] = [
  {
    name: "manage_table",
    description:
      "Excel Tables (ListObjects): create one from a range (headers in row 1), rename, toggle the totals row, unlist (convert back to a plain range — data kept), or list all tables with their ranges.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "rename", "set_totals", "unlist", "list"] },
        sheet: sheetParam,
        range: { type: "string", description: 'create: A1 range INCLUDING the header row, e.g. "A1:H100"' },
        name: { type: "string", description: "Table name (create: optional; other actions: required)" },
        new_name: { type: "string", description: "rename: the new table name" },
        style: { type: "string", description: 'create: style name, e.g. "TableStyleMedium2"' },
        has_headers: { type: "boolean", description: "create: row 1 of the range is a header row (default true)" },
        on: { type: "boolean", description: "set_totals: show (true) or hide (false) the totals row" },
      },
      required: ["action"],
    },
    mutating(args) {
      return String(args.action) === "list" ? "no" : "soft";
    },
    async run(args) {
      const action = String(args.action ?? "");

      if (action === "list") {
        return runExcel(async (ctx) => {
          const tables = ctx.workbook.tables;
          tables.load("items/name");
          await ctx.sync();
          const handles = tables.items.map((t) => {
            const r = t.getRange();
            r.load("address");
            return { t, r };
          });
          await ctx.sync();
          return { tables: handles.map((h) => ({ name: h.t.name, address: h.r.address })) };
        });
      }

      if (action === "create") {
        const rect = parseA1(String(args.range ?? ""));
        if (!rect) return { error: { code: "bad_range", message: `Invalid A1 range: "${args.range}"` } };
        return runExcel(async (ctx) => {
          const ws = getSheet(ctx, args.sheet as string | undefined);
          ws.load("name");
          const t = ws.tables.add(rectToA1(rect), (args.has_headers as boolean) ?? true);
          if (args.name) t.name = String(args.name);
          if (args.style) t.style = String(args.style);
          t.load("name");
          try {
            await ctx.sync();
          } catch (e) {
            // The add may have committed under an auto-name before the rename/
            // style failed — delete by OBJECT HANDLE (it can only ever be the
            // table this call created), so no orphan survives an error result.
            try {
              t.delete();
              await ctx.sync();
            } catch {
              /* nothing was created */
            }
            throw e;
          }
          const step = pushStep({
            toolName: "manage_table",
            kind: "structure",
            label: `table "${t.name}" @ ${ws.name}!${rectToA1(rect)}`,
            cellCount: 0,
            inverses: [{ op: "unlist_table", name: t.name }],
            snapshots: [],
          });
          return {
            ok: true,
            name: t.name,
            address: `${ws.name}!${rectToA1(rect)}`,
            note: "Revert converts the table back to a plain range (data kept).",
            __stepId: step.id,
          };
        });
      }

      // rename / set_totals / unlist target an existing table by name.
      const name = String(args.name ?? "");
      return runExcel(async (ctx) => {
        const t = ctx.workbook.tables.getItemOrNullObject(name);
        await ctx.sync();
        if (t.isNullObject) {
          return { error: { code: "unknown_table", message: `No table named "${name}" — use manage_table list.` } };
        }

        if (action === "rename") {
          const newName = String(args.new_name);
          t.name = newName;
          await ctx.sync();
          const step = pushStep({
            toolName: "manage_table",
            kind: "structure",
            label: `table "${name}" → "${newName}"`,
            cellCount: 0,
            inverses: [{ op: "rename_table", from: newName, to: name }],
            snapshots: [],
          });
          return { ok: true, renamed: name, to: newName, __stepId: step.id };
        }

        if (action === "set_totals") {
          t.load("showTotals");
          t.worksheet.load("name");
          await ctx.sync();
          const prev = t.showTotals;
          const turningOn = !!args.on;
          t.showTotals = turningOn;
          // Turning totals ON computes new SUM/COUNT/etc formulas — audit that
          // row for errors, same as any other write. Turning off leaves nothing
          // new to check (the row just goes blank).
          let totalsAddr: string | null = null;
          if (turningOn) {
            const tr = t.getTotalRowRange();
            tr.load("address");
            await ctx.sync();
            totalsAddr = stripSheet(tr.address);
          } else {
            await ctx.sync();
          }
          const step = pushStep({
            toolName: "manage_table",
            kind: "structure",
            label: `table "${name}" totals ${args.on ? "on" : "off"}`,
            cellCount: 0,
            inverses: [{ op: "set_table_totals", name, on: prev }],
            snapshots: [],
          });
          return {
            ok: true,
            totals: turningOn,
            __stepId: step.id,
            ...(totalsAddr ? { __mutated: { sheet: t.worksheet.name, address: totalsAddr, nonEmptyWrite: true } } : {}),
          };
        }

        // unlist
        t.load("name,style,showHeaders");
        t.worksheet.load("name");
        const r = t.getRange();
        r.load("address");
        await ctx.sync();
        const sheet = t.worksheet.name;
        const address = stripSheet(r.address);
        const style = t.style ?? null;
        const showHeaders = t.showHeaders;
        t.convertToRange();
        await ctx.sync();
        const step = pushStep({
          toolName: "manage_table",
          kind: "structure",
          label: `unlist table "${name}"`,
          cellCount: 0,
          inverses: [{ op: "recreate_table", sheet, address, name, showHeaders, style }],
          snapshots: [],
        });
        return {
          ok: true,
          unlisted: name,
          address: `${sheet}!${address}`,
          note: "Revert recreates the table; filter state and totals-row config are lost.",
          __stepId: step.id,
        };
      });
    },
    async preview(args) {
      const a = String(args.action ?? "");
      if (a === "create") return { address: String(args.range ?? ""), note: `manage_table: create "${args.name ?? "(auto)"}"` };
      return { note: `manage_table: ${a} "${args.name ?? ""}"${args.new_name ? ` → "${args.new_name}"` : ""}` };
    },
  },

  {
    name: "sort_filter",
    description:
      "Sort a range or table (keys by column letter or header), or filter: auto_filter puts criteria on a range, table_filter on a table column, clear_filters removes them. Sorts above the snapshot cap ask for approval and cannot be reverted; reverting a filter clears criteria rather than restoring old ones.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["sort", "auto_filter", "table_filter", "clear_filters"] },
        sheet: sheetParam,
        range: { type: "string", description: "sort/auto_filter: A1 range (include the header row)" },
        table: { type: "string", description: "sort/table_filter/clear_filters: table name" },
        keys: {
          type: "array",
          items: {
            type: "object",
            properties: {
              column: { type: "string" },
              direction: { type: "string", enum: ["asc", "desc"] },
            },
            required: ["column"],
          },
          description: "sort: order matters; column = letter or header text",
        },
        has_headers: { type: "boolean", description: "sort on a range: row 1 is headers (default true)" },
        column: { type: "string", description: "auto_filter/table_filter: target column (letter or header)" },
        values: { type: "array", description: "filter: keep rows matching these values" },
        criterion: { type: "string", description: 'filter: custom criterion like ">100" or "<>0"' },
      },
      required: ["action"],
    },
    mutating(args) {
      if (String(args.action) !== "sort") return "soft";
      const rect = typeof args.range === "string" ? parseA1(args.range) : null;
      return rect ? sortUndoPlan(rectCells(rect)).mut : "soft";
    },
    async run(args) {
      const action = String(args.action ?? "");

      if (action === "sort") {
        const keys = (args.keys as { column: string; direction?: string }[]) ?? [];
        const hasHeaders = (args.has_headers as boolean) ?? true;

        if (args.table) {
          return runExcel(async (ctx) => {
            const t = ctx.workbook.tables.getItemOrNullObject(String(args.table));
            await ctx.sync();
            if (t.isNullObject) {
              return { error: { code: "unknown_table", message: `No table named "${args.table}" — use manage_table list.` } };
            }
            t.worksheet.load("name");
            t.load("showTotals");
            const r = t.getRange();
            r.load("address,rowCount,columnCount");
            await ctx.sync();
            const cells = r.rowCount * r.columnCount;
            if (cells > SNAPSHOT_MAX) {
              // Advise a re-issuable call: explicit sheet (the range path would
              // otherwise target the ACTIVE sheet) and the totals row excluded
              // (a range sort would shuffle it into the data).
              const full = parseA1(stripSheet(r.address))!;
              const data = t.showTotals ? { ...full, r1: full.r1 - 1 } : full;
              return {
                error: {
                  code: "too_large_to_snapshot",
                  message:
                    `Table is ${cells} cells — sort it as a range instead: sort with sheet "${t.worksheet.name}" ` +
                    `and range "${rectToA1(data)}" (asks for approval; not revertable).`,
                },
              };
            }
            const rect = parseA1(stripSheet(r.address))!;
            const hr = t.getHeaderRowRange();
            hr.load("values");
            r.load("formulas,numberFormat");
            const propsRes = r.getCellProperties(SORT_CELL_PROPS as unknown as Excel.CellPropertiesLoadOptions);
            await ctx.sync();
            const res = resolveColumns(hr.values[0] ?? [], rect.c0, keys.map((k) => k.column));
            if ("error" in res) return res;
            const pre = {
              formulas: r.formulas.map((x) => [...x]),
              formats: r.numberFormat.map((x) => [...x]),
              cellProps: propsRes.value as unknown as Excel.SettableCellProperties[][],
            };
            t.sort.apply(
              res.cols.map((c, i) => ({ key: c.idx, ascending: keys[i].direction !== "desc" })),
              false
            );
            await ctx.sync();
            const sheet = t.worksheet.name;
            const step = pushStep({
              toolName: "sort_filter",
              kind: "range",
              label: `sort table "${args.table}"`,
              cellCount: cells,
              inverses: [],
              snapshots: [
                {
                  sheet,
                  address: stripSheet(r.address),
                  formulas: pre.formulas,
                  numberFormats: pre.formats,
                  cellProps: pre.cellProps,
                },
              ],
            });
            return {
              ok: true,
              sorted: args.table,
              note: SORT_REVERT_NOTE,
              __stepId: step.id,
              __mutated: { sheet, address: stripSheet(r.address), nonEmptyWrite: true },
            };
          });
        }

        const rect = parseA1(String(args.range ?? ""));
        if (!rect) return { error: { code: "bad_range", message: `Invalid A1 range: "${args.range}"` } };
        const cells = rectCells(rect);
        if (cells > AGG_SCAN_MAX) {
          return { error: { code: "too_large", message: `${cells} cells exceeds the ${AGG_SCAN_MAX}-cell sort cap.` } };
        }
        const plan = sortUndoPlan(cells);
        return runExcel(async (ctx) => {
          // A sheet-qualified range ("Data!A1:H99") targets that sheet even
          // without the sheet param — the model often echoes qualified addresses.
          const ws = getSheet(ctx, (args.sheet as string | undefined) ?? sheetOf(String(args.range ?? "")) ?? undefined);
          ws.load("name");
          const res = await resolveRangeColumns(ctx, ws, rect, keys.map((k) => k.column), hasHeaders);
          if ("error" in res) return res;
          const addr = rectToA1(rect);
          const range = ws.getRange(addr);
          let pre: {
            formulas: unknown[][];
            formats: unknown[][];
            cellProps: Excel.SettableCellProperties[][];
          } | null = null;
          if (plan.snapshot) {
            range.load("formulas,numberFormat");
            const propsRes = range.getCellProperties(SORT_CELL_PROPS as unknown as Excel.CellPropertiesLoadOptions);
            await ctx.sync();
            pre = {
              formulas: range.formulas.map((x) => [...x]),
              formats: range.numberFormat.map((x) => [...x]),
              cellProps: propsRes.value as unknown as Excel.SettableCellProperties[][],
            };
          }
          range.sort.apply(
            res.idxs.map((idx, i) => ({ key: idx, ascending: keys[i].direction !== "desc" })),
            false,
            hasHeaders
          );
          await ctx.sync();
          if (pre) {
            const step = pushStep({
              toolName: "sort_filter",
              kind: "range",
              label: `sort ${ws.name}!${addr}`,
              cellCount: cells,
              inverses: [],
              snapshots: [
                {
                  sheet: ws.name,
                  address: addr,
                  formulas: pre.formulas as any[][],
                  numberFormats: pre.formats as any[][],
                  cellProps: pre.cellProps,
                },
              ],
            });
            return {
              ok: true,
              sorted: `${ws.name}!${addr}`,
              note: SORT_REVERT_NOTE,
              __stepId: step.id,
              __mutated: { sheet: ws.name, address: addr, nonEmptyWrite: true },
            };
          }
          // Too big to snapshot: audit a bounded top slice (the full range would
          // be dropped by the audit's cell budget).
          const rbRows = Math.max(1, Math.floor(SNAPSHOT_MAX / rectCols(rect)));
          const subAddr = rectToA1({ r0: rect.r0, c0: rect.c0, r1: Math.min(rect.r1, rect.r0 + rbRows - 1), c1: rect.c1 });
          return {
            ok: true,
            sorted: `${ws.name}!${addr}`,
            not_revertable: true,
            __mutated: { sheet: ws.name, address: subAddr, nonEmptyWrite: true },
          };
        });
      }

      if (action === "auto_filter") {
        const rect = parseA1(String(args.range ?? ""));
        if (!rect) return { error: { code: "bad_range", message: `Invalid A1 range: "${args.range}"` } };
        return runExcel(async (ctx) => {
          const ws = getSheet(ctx, (args.sheet as string | undefined) ?? sheetOf(String(args.range ?? "")) ?? undefined);
          ws.load("name");
          const res = await resolveRangeColumns(ctx, ws, rect, [String(args.column)], true);
          if ("error" in res) return res;
          // A present-but-empty values array must not shadow a valid criterion
          // (deepValidate guarantees at least one of the two is usable).
          const criteria: Excel.FilterCriteria =
            Array.isArray(args.values) && (args.values as unknown[]).length
              ? { filterOn: "Values" as Excel.FilterOn, values: (args.values as unknown[]).map((v) => String(v)) }
              : { filterOn: "Custom" as Excel.FilterOn, criterion1: String(args.criterion) };
          ws.autoFilter.apply(rectToA1(rect), res.idxs[0], criteria);
          await ctx.sync();
          const step = pushStep({
            toolName: "sort_filter",
            kind: "structure",
            label: `filter ${ws.name}!${rectToA1(rect)}`,
            cellCount: 0,
            inverses: [{ op: "clear_autofilter", sheet: ws.name }],
            snapshots: [],
          });
          return {
            ok: true,
            filtered: `${ws.name}!${rectToA1(rect)}`,
            note: "Revert removes the filter; a pre-existing filter's criteria are not restored.",
            __stepId: step.id,
          };
        });
      }

      if (action === "table_filter") {
        return runExcel(async (ctx) => {
          const t = ctx.workbook.tables.getItemOrNullObject(String(args.table));
          await ctx.sync();
          if (t.isNullObject) {
            return { error: { code: "unknown_table", message: `No table named "${args.table}" — use manage_table list.` } };
          }
          const col = t.columns.getItemOrNullObject(String(args.column));
          await ctx.sync();
          if (col.isNullObject) {
            t.columns.load("items/name");
            await ctx.sync();
            return {
              error: {
                code: "unknown_column",
                message: `No column "${args.column}" in table. Columns: ${t.columns.items.map((c) => `"${c.name}"`).join(", ")}`,
              },
            };
          }
          if (Array.isArray(args.values) && (args.values as unknown[]).length) {
            col.filter.applyValuesFilter((args.values as unknown[]).map((v) => String(v)));
          } else {
            col.filter.applyCustomFilter(String(args.criterion));
          }
          await ctx.sync();
          const step = pushStep({
            toolName: "sort_filter",
            kind: "structure",
            label: `filter table "${args.table}" [${args.column}]`,
            cellCount: 0,
            inverses: [{ op: "clear_table_filter", name: String(args.table), column: String(args.column) }],
            snapshots: [],
          });
          return { ok: true, filtered: args.table, column: args.column, __stepId: step.id };
        });
      }

      // clear_filters
      return runExcel(async (ctx) => {
        if (args.table) {
          const t = ctx.workbook.tables.getItemOrNullObject(String(args.table));
          await ctx.sync();
          if (t.isNullObject) {
            return { error: { code: "unknown_table", message: `No table named "${args.table}" — use manage_table list.` } };
          }
          t.clearFilters();
          await ctx.sync();
          return { ok: true, cleared: args.table, note: "Previous filter criteria are not restorable." };
        }
        const ws = getSheet(ctx, args.sheet as string | undefined);
        ws.load("name");
        ws.autoFilter.clearCriteria();
        await ctx.sync();
        return { ok: true, cleared: ws.name, note: "Previous filter criteria are not restorable." };
      });
    },
    async preview(args) {
      const a = String(args.action ?? "");
      if (a === "sort") {
        const target = args.table ? `table "${args.table}"` : String(args.range ?? "");
        const keys = ((args.keys as { column: string; direction?: string }[]) ?? [])
          .map((k) => `${k.column} ${k.direction ?? "asc"}`)
          .join(", ");
        const rect = typeof args.range === "string" ? parseA1(args.range) : null;
        const big = rect && rectCells(rect) > SNAPSHOT_MAX;
        return {
          address: args.range ? String(args.range) : undefined,
          cells: rect ? rectCells(rect) : undefined,
          note: `sort_filter: sort ${target} by ${keys}${big ? " — too large to snapshot; this sort cannot be reverted." : ""}`,
        };
      }
      return { note: `sort_filter: ${a} ${args.table ?? args.range ?? ""} ${args.column ? `[${args.column}]` : ""}`.trim() };
    },
  },
];
