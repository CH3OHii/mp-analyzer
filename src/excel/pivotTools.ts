// manage_pivot: create/inspect/edit/refresh/delete PivotTables. Everything
// core is inside the manifest's ExcelApi 1.9 baseline; source read-back for
// delete-undo is gated on 1.15 at runtime. Undo strategy: create → delete (or
// drop the sheet we created); edits → targeted field-level inverses that keep
// user styling; delete → restore-from-config only when the host can read the
// source, otherwise honestly not revertable.

import { apiSupportedAtLeast, getSheet, runExcel } from "./env";
import { parseA1, quoteSheetName, stripSheet } from "./guards";
import {
  aggFromOffice,
  applyPivotConfig,
  findDataHierarchy,
  PIVOT_AGG,
  pivotPreviewNote,
  type PivotAgg,
  type PivotConfig,
} from "./pivotConfig";
import { pushStep } from "./snapshot";
import type { ExcelToolSpec } from "./tools";
import type { InverseOp } from "./snapshot";

/** One batched round-trip across every sheet, not one sync per sheet — the
 *  auto-naming loop in `create` calls this repeatedly (PivotTable1, 2, 3, …),
 *  which would otherwise multiply into a sync per sheet per candidate name. */
async function getPivot(
  ctx: Excel.RequestContext,
  name: string
): Promise<{ pivot: Excel.PivotTable; sheet: string } | null> {
  const sheets = ctx.workbook.worksheets;
  sheets.load("items/name");
  await ctx.sync(); // need real worksheet handles before queuing per-sheet loads
  const loads = sheets.items.map((ws) => {
    const coll = ws.pivotTables;
    coll.load("items/name");
    return { ws, coll };
  });
  await ctx.sync(); // ONE more round trip covers every sheet, not one per sheet
  for (const { ws, coll } of loads) {
    if (coll.items.some((p) => p.name === name)) {
      return { pivot: ws.pivotTables.getItem(name), sheet: ws.name };
    }
  }
  return null;
}

/** Field names must equal source header text EXACTLY — on miss, teach with the
 *  real list instead of a bare ItemNotFound. */
async function fieldError(ctx: Excel.RequestContext, pivot: Excel.PivotTable, field: string) {
  pivot.hierarchies.load("items/name");
  await ctx.sync();
  return {
    error: {
      code: "unknown_field",
      message: `No source field "${field}". Fields are the source header texts: ${pivot.hierarchies.items
        .map((h) => `"${h.name}"`)
        .join(", ")}`,
    },
  };
}

async function pivotOutputRange(ctx: Excel.RequestContext, pivot: Excel.PivotTable): Promise<string | null> {
  try {
    const r = pivot.layout.getRange();
    r.load("address");
    await ctx.sync();
    return r.address;
  } catch {
    return null;
  }
}

async function describePivot(ctx: Excel.RequestContext, pivot: Excel.PivotTable, sheet: string) {
  pivot.load("name");
  pivot.rowHierarchies.load("items/name");
  pivot.columnHierarchies.load("items/name");
  pivot.dataHierarchies.load("items/name,items/summarizeBy,items/field/name");
  pivot.hierarchies.load("items/name");
  await ctx.sync();
  const address = await pivotOutputRange(ctx, pivot);
  return {
    name: pivot.name,
    sheet,
    ...(address ? { address } : {}),
    rows: pivot.rowHierarchies.items.map((h) => h.name),
    columns: pivot.columnHierarchies.items.map((h) => h.name),
    values: pivot.dataHierarchies.items.map((d) => ({ field: d.field.name, agg: aggFromOffice(String(d.summarizeBy)) })),
    available_fields: pivot.hierarchies.items.map((h) => h.name),
  };
}

export const pivotTools: ExcelToolSpec[] = [
  {
    name: "manage_pivot",
    description:
      "Create, inspect, edit, refresh, or delete PivotTables. Field names = source header text exactly; source must include the header row. No date grouping — add a month/year helper column to the source first. describe returns current fields; delete cannot always be reverted.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "describe", "list", "add_field", "remove_field", "set_aggregation", "refresh", "delete"],
        },
        name: { type: "string", description: "Pivot table name (all actions except list; optional for create)" },
        source: { type: "string", description: 'create: A1 range INCL. headers ("Sheet1!A1:H99") or a table name' },
        dest_sheet: { type: "string", description: "create: target sheet; omit to create a new sheet" },
        dest_cell: { type: "string", description: 'create: top-left cell, default "A3"' },
        rows: { type: "array", items: { type: "string" }, description: "create: row fields" },
        columns: { type: "array", items: { type: "string" }, description: "create: column fields" },
        values: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field: { type: "string" },
              agg: { type: "string", enum: ["sum", "count", "average", "min", "max", "product"] },
            },
            required: ["field"],
          },
          description: "create: aggregated fields (agg defaults to sum)",
        },
        field: { type: "string", description: "add_field/remove_field/set_aggregation: target field" },
        area: { type: "string", enum: ["rows", "columns", "values"], description: "add_field (and remove_field when a field sits in several areas)" },
        agg: { type: "string", enum: ["sum", "count", "average", "min", "max", "product"] },
        layout: { type: "string", enum: ["compact", "tabular", "outline"] },
      },
      required: ["action"],
    },
    mutating(args) {
      const a = String(args.action ?? "");
      if (a === "describe" || a === "list") return "no";
      if (a === "delete") return "hard";
      return "soft";
    },
    async run(args) {
      const action = String(args.action ?? "");

      if (action === "list") {
        return runExcel(async (ctx) => {
          const sheets = ctx.workbook.worksheets;
          sheets.load("items/name");
          await ctx.sync();
          const loads = sheets.items.map((ws) => {
            const coll = ws.pivotTables;
            coll.load("items/name");
            return { ws, coll };
          });
          await ctx.sync();
          const pivots = loads.flatMap((l) => l.coll.items.map((p) => ({ sheet: l.ws.name, name: p.name })));
          return { pivots };
        });
      }

      if (action === "describe") {
        return runExcel(async (ctx) => {
          const found = await getPivot(ctx, String(args.name));
          if (!found) return { error: { code: "unknown_pivot", message: `No pivot table named "${args.name}" — use manage_pivot list.` } };
          return describePivot(ctx, found.pivot, found.sheet);
        });
      }

      if (action === "create") {
        return runExcel(async (ctx) => {
          // Qualify an unqualified A1 source with its sheet (active or `sheet`-param-free:
          // the source lives where the data is, which create must know explicitly).
          let source = String(args.source);
          if (parseA1(source) && !source.includes("!")) {
            const srcWs = getSheet(ctx, undefined);
            srcWs.load("name");
            await ctx.sync();
            source = `${quoteSheetName(srcWs.name)}!${stripSheet(source)}`;
          }

          // Name FIRST, before creating anything: pivot names are workbook-
          // unique, and checking up front means the failure-cleanup below can
          // never mistake a pre-existing same-named pivot for our half-built one.
          let name = args.name ? String(args.name) : "";
          if (name) {
            const existing = await getPivot(ctx, name);
            if (existing) {
              return {
                error: {
                  code: "duplicate_pivot",
                  message: `A pivot named "${name}" already exists on sheet "${existing.sheet}" — pick another name or delete it first.`,
                },
              };
            }
          } else {
            let n = 1;
            while (await getPivot(ctx, `PivotTable${n}`)) n++;
            name = `PivotTable${n}`;
          }

          // Destination: named sheet, or a fresh one.
          let destSheet: string;
          let createdSheet = false;
          if (args.dest_sheet) {
            destSheet = String(args.dest_sheet);
          } else {
            const sheets = ctx.workbook.worksheets;
            sheets.load("items/name");
            await ctx.sync();
            const names = new Set(sheets.items.map((w) => w.name));
            let n = 1;
            while (names.has(`Pivot${n}`)) n++;
            destSheet = `Pivot${n}`;
            ctx.workbook.worksheets.add(destSheet);
            createdSheet = true;
          }

          const cfg: PivotConfig = {
            name,
            source,
            destSheet,
            destCell: String(args.dest_cell ?? "A3"),
            rows: (args.rows as string[]) ?? [],
            columns: (args.columns as string[]) ?? [],
            values: ((args.values as { field: string; agg?: PivotAgg }[]) ?? []).map((v) => ({
              field: v.field,
              agg: v.agg ?? "sum",
            })),
            ...(args.layout ? { layout: args.layout as PivotConfig["layout"] } : {}),
          };

          let pivot: Excel.PivotTable;
          try {
            pivot = applyPivotConfig(ctx, cfg);
            await ctx.sync();
          } catch (e) {
            // Clean up the half-built artifact, then teach: bad field names are
            // by far the most common failure (must equal header text exactly).
            try {
              if (createdSheet) {
                ctx.workbook.worksheets.getItem(destSheet).delete();
              } else {
                const pt = ctx.workbook.worksheets.getItem(destSheet).pivotTables.getItemOrNullObject(name);
                await ctx.sync();
                if (!pt.isNullObject) pt.delete();
              }
              await ctx.sync();
            } catch {
              /* best-effort cleanup */
            }
            throw e;
          }

          const inverses: InverseOp[] = createdSheet
            ? [{ op: "delete_sheet", name: destSheet }]
            : [{ op: "delete_pivot", sheet: destSheet, name }];
          const step = pushStep({
            toolName: "manage_pivot",
            kind: "pivot",
            label: `pivot "${name}" → ${destSheet}`,
            cellCount: 0,
            inverses,
            snapshots: [],
          });

          const address = await pivotOutputRange(ctx, pivot);
          return {
            ok: true,
            name,
            sheet: destSheet,
            ...(address ? { address } : {}),
            ...(createdSheet ? { created_sheet: destSheet } : {}),
            __stepId: step.id,
            ...(address
              ? { __mutated: { sheet: destSheet, address: stripSheet(address), nonEmptyWrite: true } }
              : {}),
          };
        });
      }

      // Remaining actions target an existing pivot by name.
      return runExcel(async (ctx) => {
        const found = await getPivot(ctx, String(args.name));
        if (!found) return { error: { code: "unknown_pivot", message: `No pivot table named "${args.name}" — use manage_pivot list.` } };
        const { pivot, sheet } = found;
        const field = String(args.field ?? "");

        if (action === "refresh") {
          pivot.refresh();
          await ctx.sync();
          const address = await pivotOutputRange(ctx, pivot);
          return {
            ok: true,
            note: "refresh is not revertable",
            ...(address ? { address, __mutated: { sheet, address: stripSheet(address), nonEmptyWrite: true } } : {}),
          };
        }

        if (action === "delete") {
          // Restore-from-config needs the source range — readable only on 1.15+.
          let restore: PivotConfig | null = null;
          if (apiSupportedAtLeast("1.15")) {
            try {
              const desc = await describePivot(ctx, pivot, sheet);
              // getDataSourceString (1.15) — getDataSourceRange does not exist in Office.js.
              const src = (
                pivot as unknown as { getDataSourceString(): OfficeExtension.ClientResult<string> }
              ).getDataSourceString();
              const out = pivot.layout.getRange();
              out.load("address");
              await ctx.sync();
              restore = {
                name: desc.name,
                source: src.value,
                destSheet: sheet,
                destCell: stripSheet(out.address).split(":")[0],
                rows: desc.rows,
                columns: desc.columns,
                values: desc.values,
              };
            } catch {
              restore = null;
            }
          }
          pivot.delete();
          await ctx.sync();
          if (restore) {
            const step = pushStep({
              toolName: "manage_pivot",
              kind: "pivot",
              label: `delete pivot "${args.name}"`,
              cellCount: 0,
              inverses: [{ op: "restore_pivot", config: restore }],
              snapshots: [],
            });
            return { ok: true, deleted: args.name, note: "Revert recreates the pivot from its definition; manual styling is lost.", __stepId: step.id };
          }
          return { ok: true, deleted: args.name, not_revertable: true, note: "This Excel version cannot read a pivot's source, so the deletion cannot be reverted." };
        }

        if (action === "add_field") {
          const area = String(args.area) as "rows" | "columns" | "values";
          try {
            if (area === "rows") pivot.rowHierarchies.add(pivot.hierarchies.getItem(field));
            else if (area === "columns") pivot.columnHierarchies.add(pivot.hierarchies.getItem(field));
            else {
              const dh = pivot.dataHierarchies.add(pivot.hierarchies.getItem(field));
              if (args.agg) dh.summarizeBy = PIVOT_AGG[args.agg as PivotAgg] as Excel.AggregationFunction;
            }
            await ctx.sync();
          } catch {
            return fieldError(ctx, pivot, field);
          }
          const step = pushStep({
            toolName: "manage_pivot",
            kind: "pivot",
            label: `pivot "${args.name}" + ${field}`,
            cellCount: 0,
            inverses: [{ op: "pivot_field", sheet, pivot: String(args.name), action: "remove", field, area }],
            snapshots: [],
          });
          return { ok: true, added: field, area, __stepId: step.id };
        }

        if (action === "remove_field") {
          // Locate the field: explicit area wins, otherwise search all three.
          pivot.rowHierarchies.load("items/name");
          pivot.columnHierarchies.load("items/name");
          await ctx.sync();
          const inRows = pivot.rowHierarchies.items.some((h) => h.name === field);
          const inCols = pivot.columnHierarchies.items.some((h) => h.name === field);
          const dh = await findDataHierarchy(ctx, pivot, field);
          const explicit = args.area ? String(args.area) : null;
          const area = (explicit ?? (inRows ? "rows" : inCols ? "columns" : dh ? "values" : null)) as
            | "rows"
            | "columns"
            | "values"
            | null;
          if (!area || (area === "rows" && !inRows) || (area === "columns" && !inCols) || (area === "values" && !dh)) {
            return { error: { code: "field_not_in_pivot", message: `"${field}" is not in this pivot — describe it first.` } };
          }
          let prevAgg: PivotAgg | string | undefined;
          if (area === "rows") pivot.rowHierarchies.remove(pivot.rowHierarchies.getItem(field));
          else if (area === "columns") pivot.columnHierarchies.remove(pivot.columnHierarchies.getItem(field));
          else {
            prevAgg = aggFromOffice(String(dh!.summarizeBy));
            pivot.dataHierarchies.remove(dh!);
          }
          await ctx.sync();
          const step = pushStep({
            toolName: "manage_pivot",
            kind: "pivot",
            label: `pivot "${args.name}" − ${field}`,
            cellCount: 0,
            inverses: [{ op: "pivot_field", sheet, pivot: String(args.name), action: "add", field, area, agg: prevAgg }],
            snapshots: [],
          });
          return { ok: true, removed: field, area, __stepId: step.id, note: "Revert re-adds the field; its position within the area is not preserved." };
        }

        // set_aggregation
        const dh = await findDataHierarchy(ctx, pivot, field);
        if (!dh) return { error: { code: "field_not_in_pivot", message: `"${field}" is not a values field of this pivot.` } };
        const prev = aggFromOffice(String(dh.summarizeBy));
        dh.summarizeBy = PIVOT_AGG[args.agg as PivotAgg] as Excel.AggregationFunction;
        await ctx.sync();
        const step = pushStep({
          toolName: "manage_pivot",
          kind: "pivot",
          label: `pivot "${args.name}" ${field}: ${prev}→${args.agg}`,
          cellCount: 0,
          inverses: [{ op: "pivot_field", sheet, pivot: String(args.name), action: "set_agg", field, area: "values", agg: prev }],
          snapshots: [],
        });
        return { ok: true, field, agg: args.agg, previous: prev, __stepId: step.id };
      });
    },
    async preview(args) {
      return { note: pivotPreviewNote(args) };
    },
  },
];
