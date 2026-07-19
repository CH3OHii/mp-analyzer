// Thin wrapper around the Office host — the only module that touches globals,
// so everything above it stays testable and browser-preview keeps working.

export function hasExcel(): boolean {
  return typeof Excel !== "undefined" && typeof Office !== "undefined" && !!Office.context;
}

export function apiSupported(): boolean {
  try {
    return Office.context.requirements.isSetSupported("ExcelApi", "1.9");
  } catch {
    return false;
  }
}

export async function runExcel<T>(fn: (ctx: Excel.RequestContext) => Promise<T>): Promise<T> {
  if (!hasExcel()) {
    throw new Error("Excel is not available (browser preview) — workbook tools are disabled.");
  }
  return Excel.run(fn);
}

export function getSheet(ctx: Excel.RequestContext, sheet?: string): Excel.Worksheet {
  return sheet
    ? ctx.workbook.worksheets.getItem(sheet)
    : ctx.workbook.worksheets.getActiveWorksheet();
}

/** Normalize any thrown error into the {error:{code,message}} tool-result shape
 *  the model can read and self-correct from. */
export function toErrorResult(e: unknown): { error: { code: string; message: string } } {
  if (typeof OfficeExtension !== "undefined" && e instanceof OfficeExtension.Error) {
    return { error: { code: e.code, message: e.message } };
  }
  if (e instanceof Error) return { error: { code: e.name || "Error", message: e.message } };
  return { error: { code: "Unknown", message: String(e) } };
}
