import { getSheet, runExcel } from "./env";
import {
  PREVIEW_MAX_COLS,
  PREVIEW_MAX_ROWS,
  SNAPSHOT_MAX,
  WRITE_MAX,
  expandFromStart,
  indexToCol,
  normalizeMatrix,
  parseA1,
  rectCells,
  rectCols,
  rectRows,
  rectToA1,
  stripSheet,
} from "./guards";
import { hasAnyFormula } from "./inspect";
import { pushStep } from "./snapshot";
import { clipMatrix } from "./summarize";
import { checkExpectations, parseExpectList, validateRectMatrix } from "./validate";
import { sampleMatrix, scanMatrix } from "./verify";
import type { PendingPreview } from "../store/chatStore";
import type { ExcelToolSpec } from "./tools";

const sheetParam = { type: "string", description: "Sheet name; omit for the active sheet" };

const expectParam = {
  type: "array",
  items: {
    type: "object",
    properties: {
      cell: { type: "string", description: 'Single cell, e.g. "B4"' },
      value: { description: "The value that cell must currently contain" },
    },
    required: ["cell", "value"],
  },
  description:
    "Optional preconditions: each cell's CURRENT value must equal value (e.g. a header you read earlier), or nothing is written and precondition_failed is returned. Use to anchor consequential writes.",
};

/** Load expect cells' current values inside an open Excel.run (call before the
 *  first sync); returns a closure that checks them after the sync. */
function loadExpects(ws: Excel.Worksheet, expect: unknown) {
  const expects = parseExpectList(expect);
  const handles = expects.map((e) => {
    const r = ws.getRange(stripSheet(e.cell));
    r.load("values");
    return r;
  });
  return () => {
    const actuals = handles.map((r) => r.values?.[0]?.[0]);
    return checkExpectations(expects, actuals);
  };
}

/** Post-apply read-back: reload what actually landed and scan for #-errors.
 *  Non-fatal by design — a failed verification read never fails a landed write. */
async function readBackVerified(
  ctx: Excel.RequestContext,
  range: Excel.Range,
  addr: string
): Promise<{ verified: Record<string, unknown>; hadErrors: boolean } | null> {
  try {
    range.load("values,formulas");
    await ctx.sync();
    const scan = scanMatrix(range.values, parseA1(addr)!);
    const verified: Record<string, unknown> = { cells_checked: scan.cells };
    if (scan.errorCells.length) {
      verified.error_count = scan.errorCells.length;
      verified.errors = scan.errorCells.slice(0, 20);
    }
    // Formulas evaluating to "" are content, not a missing write.
    if (scan.nonEmpty === 0 && !hasAnyFormula(range.formulas)) verified.all_empty = true;
    verified.sample = clipMatrix(sampleMatrix(range.values));
    return { verified, hadErrors: scan.errorCells.length > 0 };
  } catch {
    return null;
  }
}

/** null/undefined cells keep their captured pre-state (values or formulas). Pure — unit-tested. */
export function buildWriteMatrix(values: unknown[][], captured: any[][]): any[][] {
  return values.map((row, r) => row.map((v, c) => (v === null || v === undefined ? captured[r]?.[c] ?? "" : v)));
}

function clone2d<T>(m: T[][]): T[][] {
  return m.map((r) => [...r]);
}

/** Bounded read of current values for the before-grid of a preview. */
async function previewRead(sheet: string | undefined, addr: string | null): Promise<unknown[][] | undefined> {
  if (!addr) return undefined;
  try {
    return await runExcel(async (ctx) => {
      const ws = getSheet(ctx, sheet);
      const rect = parseA1(addr)!;
      const clipped = {
        r0: rect.r0,
        c0: rect.c0,
        r1: Math.min(rect.r1, rect.r0 + PREVIEW_MAX_ROWS - 1),
        c1: Math.min(rect.c1, rect.c0 + PREVIEW_MAX_COLS - 1),
      };
      const r = ws.getRange(rectToA1(clipped));
      r.load("values");
      await ctx.sync();
      return r.values;
    });
  } catch {
    return undefined;
  }
}

function clipAfter(m: unknown[][]): unknown[][] {
  return m.slice(0, PREVIEW_MAX_ROWS).map((row) => row.slice(0, PREVIEW_MAX_COLS));
}

export const writeTools: ExcelToolSpec[] = [
  {
    name: "write_range",
    description:
      'Write a 2D array of values anchored at start_cell. null leaves a cell unchanged, "" clears it. String values beginning with "=" are written as formulas. For filling one formula across a range prefer set_formulas.',
    parameters: {
      type: "object",
      properties: {
        sheet: sheetParam,
        start_cell: { type: "string", description: 'Top-left cell, e.g. "B4"' },
        values: { type: "array", items: { type: "array" }, description: "Row-major 2D array — strictly rectangular" },
        expect: expectParam,
      },
      required: ["start_cell", "values"],
    },
    mutating: "soft",
    async run(args) {
      const shape = validateRectMatrix(args.values);
      if (!shape.ok) return { error: { code: shape.code, message: shape.message } };
      const matrix = args.values as unknown[][];
      const rows = matrix.length;
      const cols = matrix[0].length;
      const cells = rows * cols;
      if (cells > WRITE_MAX || cells > SNAPSHOT_MAX) {
        return { error: { code: "too_large", message: `${cells} cells exceeds the per-write cap — split the operation.` } };
      }
      const addr = expandFromStart(String(args.start_cell ?? ""), rows, cols);
      if (!addr) return { error: { code: "bad_start_cell", message: `Invalid start_cell: "${args.start_cell}"` } };
      return runExcel(async (ctx) => {
        const ws = getSheet(ctx, args.sheet as string | undefined);
        ws.load("name");
        const range = ws.getRange(addr);
        range.load("formulas,numberFormat");
        const checkExpects = loadExpects(ws, args.expect);
        await ctx.sync();

        const mismatches = checkExpects();
        if (mismatches.length) {
          return {
            error: {
              code: "precondition_failed",
              message: "expect preconditions failed — the sheet differs from what you assumed. Re-read before writing.",
              mismatches,
            },
          };
        }

        const preFormulas = clone2d(range.formulas);
        const preFormats = clone2d(range.numberFormat);
        range.formulas = buildWriteMatrix(matrix, preFormulas);
        await ctx.sync();

        // Only record the undo step once the apply sync succeeded — a failed
        // write must not leave a phantom entry on the revert stack.
        const step = pushStep({
          toolName: "write_range",
          kind: "range",
          label: `${ws.name}!${addr}`,
          cellCount: cells,
          inverses: [],
          snapshots: [{ sheet: ws.name, address: addr, formulas: preFormulas, numberFormats: preFormats }],
        });

        const rb = await readBackVerified(ctx, range, addr);
        const hasContent = matrix.some((row) => row.some((v) => v !== null && v !== undefined && v !== ""));
        return {
          ok: true,
          address: `${ws.name}!${addr}`,
          cells,
          ...(rb ? { verified: rb.verified } : {}),
          __stepId: step.id,
          __mutated: { sheet: ws.name, address: addr, nonEmptyWrite: hasContent },
        };
      });
    },
    async preview(args) {
      const { rows, cols, matrix } = normalizeMatrix((args.values as unknown[][]) ?? []);
      const addr = expandFromStart(String(args.start_cell ?? ""), Math.max(rows, 1), Math.max(cols, 1));
      const before = await previewRead(args.sheet as string | undefined, addr);
      const preview: PendingPreview = {
        address: addr ?? undefined,
        cells: rows * cols,
        before,
        after: clipAfter(matrix),
        moreRows: Math.max(0, rows - PREVIEW_MAX_ROWS),
      };
      return preview;
    },
  },

  {
    name: "set_formulas",
    description:
      "Set formulas on a range. Either pass `formulas` (2D array matching the range shape, en-US syntax, A1 refs) or `formula_r1c1` (ONE R1C1-style formula filled across the whole range — the reliable fill-down: relative refs adjust per cell, e.g. \"=RC[-2]/RC[-1]\").",
    parameters: {
      type: "object",
      properties: {
        sheet: sheetParam,
        range: { type: "string" },
        formulas: { type: "array", items: { type: "array" } },
        formula_r1c1: { type: "string" },
        expect: expectParam,
      },
      required: ["range"],
    },
    mutating: "soft",
    async run(args) {
      const rect = parseA1(String(args.range ?? ""));
      if (!rect) return { error: { code: "bad_range", message: `Invalid A1 range: "${args.range}"` } };
      const cells = rectCells(rect);
      if (cells > WRITE_MAX || cells > SNAPSHOT_MAX) {
        return { error: { code: "too_large", message: `${cells} cells exceeds the per-write cap — split the operation.` } };
      }
      const hasMatrix = Array.isArray(args.formulas);
      const hasR1 = typeof args.formula_r1c1 === "string" && args.formula_r1c1 !== "";
      if (hasMatrix === hasR1) {
        return { error: { code: "bad_args", message: "Provide exactly one of `formulas` or `formula_r1c1`." } };
      }
      const rows = rectRows(rect);
      const cols = rectCols(rect);
      if (hasMatrix) {
        const m = args.formulas as unknown[][];
        if (m.length !== rows || m.some((r) => !Array.isArray(r) || r.length !== cols)) {
          return { error: { code: "shape_mismatch", message: `formulas must be exactly ${rows}x${cols} for range ${args.range}` } };
        }
      }
      const addr = rectToA1(rect);
      return runExcel(async (ctx) => {
        const ws = getSheet(ctx, args.sheet as string | undefined);
        ws.load("name");
        const range = ws.getRange(addr);
        range.load("formulas,numberFormat");
        const checkExpects = loadExpects(ws, args.expect);
        await ctx.sync();

        const mismatches = checkExpects();
        if (mismatches.length) {
          return {
            error: {
              code: "precondition_failed",
              message: "expect preconditions failed — the sheet differs from what you assumed. Re-read before writing.",
              mismatches,
            },
          };
        }

        const preFormulas = clone2d(range.formulas);
        const preFormats = clone2d(range.numberFormat);
        if (hasMatrix) {
          range.formulas = args.formulas as any[][];
        } else {
          const fill = String(args.formula_r1c1);
          range.formulasR1C1 = Array.from({ length: rows }, () => Array(cols).fill(fill));
        }
        await ctx.sync();

        // Push the undo step only after the apply sync succeeded (no phantom steps).
        const step = pushStep({
          toolName: "set_formulas",
          kind: "range",
          label: `${ws.name}!${addr}`,
          cellCount: cells,
          inverses: [],
          snapshots: [{ sheet: ws.name, address: addr, formulas: preFormulas, numberFormats: preFormats }],
        });

        const rb = await readBackVerified(ctx, range, addr);
        return {
          ok: true,
          address: `${ws.name}!${addr}`,
          cells,
          ...(rb ? { verified: rb.verified } : {}),
          __stepId: step.id,
          __mutated: { sheet: ws.name, address: addr, nonEmptyWrite: true },
        };
      });
    },
    async preview(args) {
      const rect = parseA1(String(args.range ?? ""));
      const addr = rect ? rectToA1(rect) : undefined;
      const before = await previewRead(args.sheet as string | undefined, addr ?? null);
      let after: unknown[][] | undefined;
      if (Array.isArray(args.formulas)) after = clipAfter(args.formulas as unknown[][]);
      else if (rect && typeof args.formula_r1c1 === "string") {
        after = clipAfter(
          Array.from({ length: rectRows(rect) }, () => Array(rectCols(rect)).fill(args.formula_r1c1))
        );
      }
      return {
        address: addr,
        cells: rect ? rectCells(rect) : undefined,
        before,
        after,
        moreRows: rect ? Math.max(0, rectRows(rect) - PREVIEW_MAX_ROWS) : 0,
      };
    },
  },

  {
    name: "manage_sheet",
    description:
      "Sheet operations: add, rename, activate, clear (contents+formats of used range), delete. clear/delete are destructive and always require user confirmation.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "rename", "activate", "clear", "delete"] },
        name: { type: "string", description: "Target sheet name (for add: the new sheet's name)" },
        new_name: { type: "string", description: "For rename" },
        position: { type: "integer", description: "For add: 0-based position" },
      },
      required: ["action", "name"],
    },
    mutating: (args) => {
      const a = String(args?.action ?? "");
      if (a === "delete" || a === "clear") return "hard";
      if (a === "activate") return "no";
      return "soft";
    },
    async run(args) {
      const action = String(args.action ?? "");
      const name = String(args.name ?? "");
      if (!name) return { error: { code: "bad_args", message: "name is required" } };

      if (action === "add") {
        return runExcel(async (ctx) => {
          const ws = ctx.workbook.worksheets.add(name);
          if (args.position != null) ws.position = Number(args.position);
          await ctx.sync();
          const step = pushStep({
            toolName: "manage_sheet",
            kind: "sheet",
            label: `+ ${name}`,
            cellCount: 0,
            snapshots: [],
            inverses: [{ op: "delete_sheet", name }],
          });
          return { ok: true, added: name, __stepId: step.id };
        });
      }
      if (action === "rename") {
        const newName = String(args.new_name ?? "");
        if (!newName) return { error: { code: "bad_args", message: "new_name is required for rename" } };
        return runExcel(async (ctx) => {
          const ws = ctx.workbook.worksheets.getItem(name);
          ws.name = newName;
          await ctx.sync();
          const step = pushStep({
            toolName: "manage_sheet",
            kind: "sheet",
            label: `${name} → ${newName}`,
            cellCount: 0,
            snapshots: [],
            inverses: [{ op: "rename_sheet", from: newName, to: name }],
          });
          return { ok: true, renamed: newName, __stepId: step.id };
        });
      }
      if (action === "activate") {
        return runExcel(async (ctx) => {
          ctx.workbook.worksheets.getItem(name).activate();
          await ctx.sync();
          return { ok: true, activated: name };
        });
      }
      if (action === "clear" || action === "delete") {
        return runExcel(async (ctx) => {
          const ws = ctx.workbook.worksheets.getItem(name);
          ws.load("name,position");
          const used = ws.getUsedRangeOrNullObject();
          used.load("address,rowCount,columnCount,formulas,numberFormat");
          await ctx.sync();

          const cells = used.isNullObject ? 0 : used.rowCount * used.columnCount;
          if (cells > SNAPSHOT_MAX) {
            return {
              error: {
                code: "too_large",
                message: `Sheet "${name}" has ${cells} used cells — too large to snapshot. Do this manually in Excel if intended.`,
              },
            };
          }
          const content = used.isNullObject
            ? null
            : {
                sheet: name,
                address: stripSheet(used.address),
                formulas: clone2d(used.formulas),
                numberFormats: clone2d(used.numberFormat),
              };
          if (action === "clear") {
            if (!used.isNullObject) used.clear(Excel.ClearApplyTo.all);
            await ctx.sync();
            const step = pushStep({
              toolName: "manage_sheet",
              kind: "range",
              label: `clear ${name}`,
              cellCount: cells,
              snapshots: content ? [content] : [],
              inverses: [],
            });
            return { ok: true, cleared: name, note: "Revert restores contents and number formats, not rich styling.", __stepId: step.id };
          }
          const position = ws.position;
          ws.delete();
          await ctx.sync();
          const step = pushStep({
            toolName: "manage_sheet",
            kind: "structure",
            label: `- ${name}`,
            cellCount: cells,
            snapshots: [],
            inverses: [{ op: "restore_sheet", name, position, content }],
          });
          return { ok: true, deleted: name, note: "Revert restores contents; formulas elsewhere referencing this sheet keep #REF!.", __stepId: step.id };
        });
      }
      return { error: { code: "bad_action", message: `Unknown action "${action}"` } };
    },
    async preview(args) {
      const action = String(args.action ?? "");
      const name = String(args.name ?? "");
      return { note: `manage_sheet: ${action} "${name}"${args.new_name ? ` → "${args.new_name}"` : ""}` };
    },
  },

  {
    name: "insert_delete",
    description:
      "Insert or delete whole rows/columns. index is 1-based (rows) or the column number (1=A). Deletions are destructive: content is snapshotted, but #REF! created in other cells does not heal on revert.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["insert_rows", "delete_rows", "insert_cols", "delete_cols"] },
        sheet: sheetParam,
        index: { type: "integer" },
        count: { type: "integer", description: "Default 1" },
      },
      required: ["action", "index"],
    },
    mutating: (args) => (String(args?.action ?? "").startsWith("delete") ? "hard" : "soft"),
    async run(args) {
      const action = String(args.action ?? "");
      const index = Number(args.index);
      const count = Math.max(1, Number(args.count ?? 1));
      if (!Number.isInteger(index) || index < 1) {
        return { error: { code: "bad_args", message: "index must be a positive integer" } };
      }
      const isRows = action.endsWith("rows");
      const addr = isRows ? `${index}:${index + count - 1}` : `${indexToCol(index)}:${indexToCol(index + count - 1)}`;
      const kind = isRows ? ("rows" as const) : ("cols" as const);

      if (action.startsWith("insert")) {
        return runExcel(async (ctx) => {
          const ws = getSheet(ctx, args.sheet as string | undefined);
          ws.load("name");
          await ctx.sync();
          ws.getRange(addr).insert(isRows ? Excel.InsertShiftDirection.down : Excel.InsertShiftDirection.right);
          await ctx.sync();
          const step = pushStep({
            toolName: "insert_delete",
            kind: "structure",
            label: `${ws.name}: +${count} ${kind} @${index}`,
            cellCount: 0,
            snapshots: [],
            inverses: [{ op: "delete_inserted", sheet: ws.name, kind, index, count }],
          });
          return { ok: true, inserted: addr, sheet: ws.name, __stepId: step.id };
        });
      }
      if (action.startsWith("delete")) {
        return runExcel(async (ctx) => {
          const ws = getSheet(ctx, args.sheet as string | undefined);
          ws.load("name");
          const target = ws.getRange(addr);
          const used = ws.getUsedRangeOrNullObject();
          const inter = target.getIntersectionOrNullObject(used);
          inter.load("address,rowCount,columnCount,formulas,numberFormat");
          await ctx.sync();

          const cells = inter.isNullObject ? 0 : inter.rowCount * inter.columnCount;
          if (cells > SNAPSHOT_MAX) {
            return { error: { code: "too_large", message: `${cells} used cells in the deleted ${kind} — too large to snapshot.` } };
          }
          const content = inter.isNullObject
            ? null
            : {
                sheet: ws.name,
                address: stripSheet(inter.address),
                formulas: clone2d(inter.formulas),
                numberFormats: clone2d(inter.numberFormat),
              };
          target.delete(isRows ? Excel.DeleteShiftDirection.up : Excel.DeleteShiftDirection.left);
          await ctx.sync();
          const step = pushStep({
            toolName: "insert_delete",
            kind: "structure",
            label: `${ws.name}: -${count} ${kind} @${index}`,
            cellCount: cells,
            snapshots: [],
            inverses: [{ op: "reinsert_removed", sheet: ws.name, kind, index, count, content }],
          });
          return { ok: true, deleted: addr, sheet: ws.name, __stepId: step.id };
        });
      }
      return { error: { code: "bad_action", message: `Unknown action "${action}"` } };
    },
    async preview(args) {
      return { note: `insert_delete: ${args.action} @${args.index} ×${args.count ?? 1}` };
    },
  },
];
