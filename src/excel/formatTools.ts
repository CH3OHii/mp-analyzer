import { getSheet, runExcel } from "./env";
import { SNAPSHOT_MAX, parseA1, rectCells, rectCols, rectRows, rectToA1 } from "./guards";
import { pushStep } from "./snapshot";
import type { InverseOp, RangeSnapshot } from "./snapshot";
import type { ExcelToolSpec } from "./tools";

const sheetParam = { type: "string", description: "Sheet name; omit for the active sheet" };

const H_ALIGN: Record<string, string> = {
  left: "Left",
  center: "Center",
  right: "Right",
  general: "General",
  fill: "Fill",
  justify: "Justify",
};
const V_ALIGN: Record<string, string> = { top: "Top", center: "Center", bottom: "Bottom" };
const EDGE: Record<string, string> = {
  top: "EdgeTop",
  bottom: "EdgeBottom",
  left: "EdgeLeft",
  right: "EdgeRight",
  inner_h: "InsideHorizontal",
  inner_v: "InsideVertical",
};
const CF_OP: Record<string, string> = {
  greater_than: "GreaterThan",
  greater_equal: "GreaterThanOrEqual",
  less_than: "LessThan",
  less_equal: "LessThanOrEqual",
  equal_to: "EqualTo",
  not_equal: "NotEqualTo",
  between: "Between",
  not_between: "NotBetween",
};
const CHART_TYPE: Record<string, string> = {
  column: "ColumnClustered",
  column_stacked: "ColumnStacked",
  bar: "BarClustered",
  line: "Line",
  line_markers: "LineMarkers",
  pie: "Pie",
  doughnut: "Doughnut",
  scatter: "XYScatter",
  area: "Area",
};

export const formatTools: ExcelToolSpec[] = [
  {
    name: "format_range",
    description:
      "Apply formatting to a range in one batched call: number_format (en-US codes, scalar or 2D), fill_color/font, alignment, wrap, borders, merge, column_width/row_height (points), autofit. Set only the properties you need.",
    parameters: {
      type: "object",
      properties: {
        sheet: sheetParam,
        range: { type: "string" },
        number_format: { type: ["string", "array"], description: 'e.g. "0.0%", "#,##0", "yyyy-mm"' },
        fill_color: { type: "string", description: '"#RRGGBB" or "none"' },
        font: {
          type: "object",
          properties: {
            bold: { type: "boolean" },
            italic: { type: "boolean" },
            size: { type: "number" },
            color: { type: "string" },
            name: { type: "string" },
          },
        },
        h_align: { type: "string", enum: Object.keys(H_ALIGN) },
        v_align: { type: "string", enum: Object.keys(V_ALIGN) },
        wrap: { type: "boolean" },
        merge: { type: "string", enum: ["merge", "unmerge"] },
        borders: {
          type: "object",
          properties: {
            edges: { type: "array", items: { type: "string", enum: Object.keys(EDGE) } },
            style: { type: "string", enum: ["thin", "medium", "none"] },
            color: { type: "string" },
          },
          required: ["edges", "style"],
        },
        column_width: { type: "number" },
        row_height: { type: "number" },
        autofit: { type: "string", enum: ["columns", "rows", "both"] },
      },
      required: ["range"],
    },
    mutating: "soft",
    async run(args) {
      const rect = parseA1(String(args.range ?? ""));
      if (!rect) return { error: { code: "bad_range", message: `Invalid A1 range: "${args.range}"` } };
      const cells = rectCells(rect);
      const rows = rectRows(rect);
      const cols = rectCols(rect);
      const wantsCellFmt =
        args.number_format != null ||
        args.fill_color != null ||
        args.font != null ||
        args.h_align != null ||
        args.v_align != null ||
        args.wrap != null ||
        args.borders != null ||
        args.merge != null;
      if (wantsCellFmt && cells > SNAPSHOT_MAX) {
        return {
          error: {
            code: "too_large",
            message: `${cells} cells is above the formatting snapshot cap — split the range (widths/autofit alone are allowed on big ranges).`,
          },
        };
      }
      const addr = rectToA1(rect);
      const applied: string[] = [];
      return runExcel(async (ctx) => {
        const ws = getSheet(ctx, args.sheet as string | undefined);
        ws.load("name");
        const range = ws.getRange(addr);

        // ---- capture pre-state
        let cellPropsRes: OfficeExtension.ClientResult<Excel.CellProperties[][]> | null = null;
        if (wantsCellFmt) {
          cellPropsRes = range.getCellProperties({
            format: {
              fill: { color: true },
              font: { bold: true, italic: true, name: true, size: true, color: true },
              horizontalAlignment: true,
              verticalAlignment: true,
              wrapText: true,
              // Border payloads are heavy (~4 objects/cell) — capture them only
              // when this call actually edits borders, so revert can undo them.
              ...(args.borders != null ? { borders: { color: true, style: true, weight: true } } : {}),
            },
          });
          if (args.number_format != null) range.load("numberFormat");
        }
        const wantsColSizes = args.column_width != null || args.autofit === "columns" || args.autofit === "both";
        const wantsRowSizes = args.row_height != null || args.autofit === "rows" || args.autofit === "both";
        const colFmtHandles: Excel.RangeFormat[] = [];
        const rowFmtHandles: Excel.RangeFormat[] = [];
        if (wantsColSizes) {
          for (let c = 0; c < cols; c++) {
            const f = range.getColumn(c).format;
            f.load("columnWidth");
            colFmtHandles.push(f);
          }
        }
        if (wantsRowSizes) {
          for (let r = 0; r < rows; r++) {
            const f = range.getRow(r).format;
            f.load("rowHeight");
            rowFmtHandles.push(f);
          }
        }
        await ctx.sync();

        const snap: RangeSnapshot = { sheet: ws.name, address: addr };
        if (cellPropsRes) snap.cellProps = cellPropsRes.value as unknown as Excel.SettableCellProperties[][];
        if (wantsCellFmt && args.number_format != null) snap.numberFormats = range.numberFormat.map((r: any[]) => [...r]);
        if (wantsColSizes) snap.colWidths = colFmtHandles.map((f) => f.columnWidth);
        if (wantsRowSizes) snap.rowHeights = rowFmtHandles.map((f) => f.rowHeight);
        const inverses: InverseOp[] = args.merge === "merge" ? [{ op: "unmerge", sheet: ws.name, address: addr }] : [];

        // ---- apply
        if (args.number_format != null) {
          const nf = args.number_format;
          range.numberFormat = Array.isArray(nf)
            ? (nf as any[][])
            : Array.from({ length: rows }, () => Array(cols).fill(String(nf)));
          applied.push("number_format");
        }
        if (args.fill_color != null) {
          if (String(args.fill_color) === "none") range.format.fill.clear();
          else range.format.fill.color = String(args.fill_color);
          applied.push("fill");
        }
        if (args.font != null && typeof args.font === "object") {
          const f = args.font as Record<string, unknown>;
          if (f.bold != null) range.format.font.bold = !!f.bold;
          if (f.italic != null) range.format.font.italic = !!f.italic;
          if (f.size != null) range.format.font.size = Number(f.size);
          if (f.color != null) range.format.font.color = String(f.color);
          if (f.name != null) range.format.font.name = String(f.name);
          applied.push("font");
        }
        if (args.h_align != null) {
          range.format.horizontalAlignment = (H_ALIGN[String(args.h_align)] ?? "General") as Excel.HorizontalAlignment;
          applied.push("h_align");
        }
        if (args.v_align != null) {
          range.format.verticalAlignment = (V_ALIGN[String(args.v_align)] ?? "Center") as Excel.VerticalAlignment;
          applied.push("v_align");
        }
        if (args.wrap != null) {
          range.format.wrapText = !!args.wrap;
          applied.push("wrap");
        }
        if (args.borders != null && typeof args.borders === "object") {
          const b = args.borders as { edges?: string[]; style?: string; color?: string };
          for (const edge of b.edges ?? []) {
            const idx = EDGE[edge];
            if (!idx) continue;
            const border = range.format.borders.getItem(idx as Excel.BorderIndex);
            if (b.style === "none") {
              border.style = "None" as Excel.BorderLineStyle;
            } else {
              border.style = "Continuous" as Excel.BorderLineStyle;
              border.weight = (b.style === "medium" ? "Medium" : "Thin") as Excel.BorderWeight;
              if (b.color) border.color = b.color;
            }
          }
          applied.push("borders");
        }
        if (args.merge === "merge") {
          range.merge(false);
          applied.push("merge");
        } else if (args.merge === "unmerge") {
          range.unmerge();
          applied.push("unmerge");
        }
        if (args.column_width != null) {
          range.format.columnWidth = Number(args.column_width);
          applied.push("column_width");
        }
        if (args.row_height != null) {
          range.format.rowHeight = Number(args.row_height);
          applied.push("row_height");
        }
        if (args.autofit === "columns" || args.autofit === "both") {
          range.format.autofitColumns();
          applied.push("autofit_columns");
        }
        if (args.autofit === "rows" || args.autofit === "both") {
          range.format.autofitRows();
          applied.push("autofit_rows");
        }
        await ctx.sync();
        // Push the undo step only after the apply sync succeeded (no phantom steps).
        const step = pushStep({
          toolName: "format_range",
          kind: "format",
          label: `${ws.name}!${addr}`,
          cellCount: wantsCellFmt ? cells : 0,
          snapshots: [snap],
          inverses,
        });
        return { ok: true, address: `${ws.name}!${addr}`, applied, __stepId: step.id };
      });
    },
    async preview(args) {
      const keys = Object.keys(args).filter((k) => k !== "sheet" && k !== "range");
      return { address: String(args.range ?? ""), note: `format_range: ${keys.join(", ")}` };
    },
  },

  {
    name: "conditional_formatting",
    description:
      "Add a conditional-formatting rule to a range: color_scale (min/mid/max_color), data_bar (bar_color), cell_value (operator + value1/value2 + fill_color), top_bottom (rank + direction + fill_color), custom_formula (formula relative to top-left cell + fill_color).",
    parameters: {
      type: "object",
      properties: {
        sheet: sheetParam,
        range: { type: "string" },
        rule: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["color_scale", "data_bar", "cell_value", "top_bottom", "custom_formula"] },
            min_color: { type: "string" },
            mid_color: { type: "string" },
            max_color: { type: "string" },
            bar_color: { type: "string" },
            operator: { type: "string", enum: Object.keys(CF_OP) },
            value1: { type: ["number", "string"] },
            value2: { type: ["number", "string"] },
            rank: { type: "integer" },
            direction: { type: "string", enum: ["top", "bottom"] },
            formula: { type: "string", description: 'For custom_formula, e.g. "=$C2>0.5"' },
            fill_color: { type: "string" },
            font_color: { type: "string" },
          },
          required: ["type"],
        },
        clear_existing: { type: "boolean", description: "Remove existing rules on the range first (not revertable)" },
      },
      required: ["range", "rule"],
    },
    mutating: "soft",
    async run(args) {
      const rect = parseA1(String(args.range ?? ""));
      if (!rect) return { error: { code: "bad_range", message: `Invalid A1 range: "${args.range}"` } };
      const rule = (args.rule ?? {}) as Record<string, any>;
      const addr = rectToA1(rect);
      return runExcel(async (ctx) => {
        const ws = getSheet(ctx, args.sheet as string | undefined);
        ws.load("name");
        const range = ws.getRange(addr);
        if (args.clear_existing) range.conditionalFormats.clearAll();

        let cf: Excel.ConditionalFormat;
        switch (String(rule.type)) {
          case "color_scale": {
            cf = range.conditionalFormats.add("ColorScale" as Excel.ConditionalFormatType);
            const criteria: any = {
              minimum: { type: "LowestValue", color: rule.min_color ?? "#F8696B" },
              maximum: { type: "HighestValue", color: rule.max_color ?? "#63BE7B" },
            };
            if (rule.mid_color) criteria.midpoint = { type: "Percentile", formula: "50", color: rule.mid_color };
            cf.colorScale.criteria = criteria;
            break;
          }
          case "data_bar": {
            cf = range.conditionalFormats.add("DataBar" as Excel.ConditionalFormatType);
            cf.dataBar.positiveFormat.fillColor = rule.bar_color ?? "#638EC6";
            break;
          }
          case "cell_value": {
            cf = range.conditionalFormats.add("CellValue" as Excel.ConditionalFormatType);
            cf.cellValue.format.fill.color = rule.fill_color ?? "#FFC7CE";
            if (rule.font_color) cf.cellValue.format.font.color = rule.font_color;
            const r: any = {
              operator: CF_OP[String(rule.operator)] ?? "GreaterThan",
              formula1: String(rule.value1 ?? 0),
            };
            if (rule.value2 != null) r.formula2 = String(rule.value2);
            cf.cellValue.rule = r;
            break;
          }
          case "top_bottom": {
            cf = range.conditionalFormats.add("TopBottom" as Excel.ConditionalFormatType);
            cf.topBottom.format.fill.color = rule.fill_color ?? "#FFEB9C";
            cf.topBottom.rule = {
              rank: Number(rule.rank ?? 10),
              type: (rule.direction === "bottom" ? "BottomItems" : "TopItems") as Excel.ConditionalTopBottomCriterionType,
            };
            break;
          }
          case "custom_formula": {
            if (!rule.formula) return { error: { code: "bad_args", message: "custom_formula needs rule.formula" } };
            cf = range.conditionalFormats.add("Custom" as Excel.ConditionalFormatType);
            cf.custom.rule.formula = String(rule.formula);
            cf.custom.format.fill.color = rule.fill_color ?? "#FFEB9C";
            if (rule.font_color) cf.custom.format.font.color = rule.font_color;
            break;
          }
          default:
            return { error: { code: "bad_args", message: `Unknown rule.type "${rule.type}"` } };
        }
        cf.load("id");
        await ctx.sync();
        const step = pushStep({
          toolName: "conditional_formatting",
          kind: "cf",
          label: `${ws.name}!${addr} ${rule.type}`,
          cellCount: 0,
          snapshots: [],
          inverses: [{ op: "delete_cf", sheet: ws.name, address: addr, ids: [cf.id] }],
        });
        return { ok: true, address: `${ws.name}!${addr}`, rule_id: cf.id, __stepId: step.id };
      });
    },
    async preview(args) {
      const rule = (args.rule ?? {}) as Record<string, unknown>;
      return { address: String(args.range ?? ""), note: `conditional_formatting: ${rule.type}` };
    },
  },

  {
    name: "create_chart",
    description:
      "Create a chart from a data range (include the header row/column — Excel uses them for series names and axis labels). anchor_cell positions the top-left corner; width/height in points.",
    parameters: {
      type: "object",
      properties: {
        sheet: sheetParam,
        data_range: { type: "string" },
        chart_type: { type: "string", enum: Object.keys(CHART_TYPE) },
        series_by: { type: "string", enum: ["auto", "rows", "columns"] },
        title: { type: "string" },
        x_axis_title: { type: "string" },
        y_axis_title: { type: "string" },
        anchor_cell: { type: "string" },
        width_pt: { type: "number" },
        height_pt: { type: "number" },
      },
      required: ["data_range", "chart_type"],
    },
    mutating: "soft",
    async run(args) {
      const type = CHART_TYPE[String(args.chart_type)];
      if (!type) return { error: { code: "bad_args", message: `Unknown chart_type "${args.chart_type}"` } };
      if (!parseA1(String(args.data_range ?? ""))) {
        return { error: { code: "bad_range", message: `Invalid data_range: "${args.data_range}"` } };
      }
      return runExcel(async (ctx) => {
        const ws = getSheet(ctx, args.sheet as string | undefined);
        ws.load("name");
        const data = ws.getRange(String(args.data_range));
        const seriesBy = (args.series_by === "rows" ? "Rows" : args.series_by === "columns" ? "Columns" : "Auto") as Excel.ChartSeriesBy;
        const chart = ws.charts.add(type as Excel.ChartType, data, seriesBy);
        if (args.title) chart.title.text = String(args.title);
        const noAxes = args.chart_type === "pie" || args.chart_type === "doughnut";
        if (!noAxes && args.x_axis_title) chart.axes.categoryAxis.title.text = String(args.x_axis_title);
        if (!noAxes && args.y_axis_title) chart.axes.valueAxis.title.text = String(args.y_axis_title);
        if (args.anchor_cell) chart.setPosition(String(args.anchor_cell));
        if (args.width_pt) chart.width = Number(args.width_pt);
        if (args.height_pt) chart.height = Number(args.height_pt);
        chart.load("name");
        await ctx.sync();
        const step = pushStep({
          toolName: "create_chart",
          kind: "chart",
          label: `${ws.name}: ${chart.name}`,
          cellCount: 0,
          snapshots: [],
          inverses: [{ op: "delete_chart", sheet: ws.name, name: chart.name }],
        });
        return { ok: true, chart_name: chart.name, sheet: ws.name, __stepId: step.id };
      });
    },
    async preview(args) {
      return { note: `create_chart: ${args.chart_type} from ${args.data_range}${args.title ? ` — "${args.title}"` : ""}` };
    },
  },
];
