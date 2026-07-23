// Shared pivot-table config: the serializable description used by manage_pivot
// (create/describe) AND by the undo store (restore/delete inverses). Lives in
// its own module so snapshot.ts and pivotTools.ts can both import it without a
// cycle. The pure parts (agg map, preview note) are unit-tested.

export type PivotAgg = "sum" | "count" | "average" | "min" | "max" | "product";

/** Office AggregationFunction enum STRINGS — literals, not the Excel.* enum
 *  object, so importing this module never touches the Office global. */
export const PIVOT_AGG: Record<PivotAgg, string> = {
  sum: "Sum",
  count: "Count",
  average: "Average",
  min: "Min",
  max: "Max",
  product: "Product",
};

/** Reverse of PIVOT_AGG for describe/read-back. Unknown Office aggregations
 *  (Automatic, CountNumbers, StandardDeviation, …) pass through VERBATIM —
 *  coercing them would make a restore silently change a user pivot's math. */
export function aggFromOffice(v: string): PivotAgg | string {
  const hit = (Object.entries(PIVOT_AGG) as [PivotAgg, string][]).find(([, s]) => s === v);
  return hit ? hit[0] : v;
}

/** Office enum string for a tool-level agg OR a passed-through Office name. */
export function aggToOffice(agg: PivotAgg | string): string {
  return PIVOT_AGG[agg as PivotAgg] ?? agg;
}

export interface PivotConfig {
  name: string;
  /** Sheet-qualified A1 range of the source data (incl. headers), or an Excel Table name. */
  source: string;
  destSheet: string;
  /** Local cell, e.g. "A3". */
  destCell: string;
  rows: string[];
  columns: string[];
  /** agg: a tool-level PivotAgg, or a verbatim Office aggregation name captured
   *  from a user-built pivot (kept as-is for faithful restore). */
  values: { field: string; agg: PivotAgg | string }[];
  layout?: "compact" | "tabular" | "outline";
}

const LAYOUT_MAP: Record<NonNullable<PivotConfig["layout"]>, string> = {
  compact: "Compact",
  tabular: "Tabular",
  outline: "Outline",
};

/** Queue the creation of a pivot from a config inside an open Excel.run.
 *  Throws ItemNotFound (surfaced by the caller) when a field name does not
 *  match a source header exactly. */
export function applyPivotConfig(ctx: Excel.RequestContext, cfg: PivotConfig): Excel.PivotTable {
  const ws = ctx.workbook.worksheets.getItem(cfg.destSheet);
  const pivot = ws.pivotTables.add(cfg.name, cfg.source, ws.getRange(cfg.destCell));
  for (const f of cfg.rows) pivot.rowHierarchies.add(pivot.hierarchies.getItem(f));
  for (const f of cfg.columns) pivot.columnHierarchies.add(pivot.hierarchies.getItem(f));
  for (const v of cfg.values) {
    const dh = pivot.dataHierarchies.add(pivot.hierarchies.getItem(v.field));
    dh.summarizeBy = aggToOffice(v.agg) as Excel.AggregationFunction;
  }
  if (cfg.layout) pivot.layout.layoutType = LAYOUT_MAP[cfg.layout] as Excel.PivotLayoutType;
  return pivot;
}

/** Find the data hierarchy whose UNDERLYING FIELD is `field` (data hierarchies
 *  are display-named "Sum of X", so getItem(field) would miss). */
export async function findDataHierarchy(
  ctx: Excel.RequestContext,
  pivot: Excel.PivotTable,
  field: string
): Promise<Excel.DataPivotHierarchy | null> {
  // summarizeBy is loaded too: callers read it for describe/undo capture, and
  // an unloaded scalar throws PropertyNotLoaded.
  pivot.dataHierarchies.load("items/name,items/summarizeBy,items/field/name");
  await ctx.sync();
  return pivot.dataHierarchies.items.find((d) => d.field.name === field) ?? null;
}

/** Approval-gate one-liner. Pure — unit-tested. */
export function pivotPreviewNote(args: Record<string, unknown>): string {
  const action = String(args.action ?? "");
  const name = args.name ? ` "${args.name}"` : "";
  switch (action) {
    case "create": {
      const rows = ((args.rows as string[]) ?? []).join(", ");
      const cols = ((args.columns as string[]) ?? []).join(", ");
      const vals = (((args.values as { field: string; agg?: string }[]) ?? []) || [])
        .map((v) => `${v.agg ?? "sum"}(${v.field})`)
        .join(", ");
      const dest = args.dest_sheet ? `'${args.dest_sheet}'!${args.dest_cell ?? "A3"}` : "a new sheet";
      return (
        `manage_pivot: create${name} from ${args.source} → ${dest}` +
        (rows ? ` — rows: ${rows}` : "") +
        (cols ? ` — columns: ${cols}` : "") +
        (vals ? ` — values: ${vals}` : "")
      );
    }
    case "add_field":
      return `manage_pivot: add_field${name} — "${args.field}" → ${args.area}${args.agg ? ` (${args.agg})` : ""}`;
    case "remove_field":
      return `manage_pivot: remove_field${name} — "${args.field}"`;
    case "set_aggregation":
      return `manage_pivot: set_aggregation${name} — "${args.field}" → ${args.agg}`;
    case "refresh":
      return `manage_pivot: refresh${name} (refresh is not revertable)`;
    case "delete":
      return `manage_pivot: delete${name} — deleting a pivot table cannot be reverted on this Excel version unless the host supports source read-back.`;
    default:
      return `manage_pivot: ${action}${name}`;
  }
}
