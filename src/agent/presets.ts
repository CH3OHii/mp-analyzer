// The user's real analysis skills, bundled verbatim at build time via Vite ?raw
// imports (the task pane has no filesystem). Each gets a load-bearing adaptation
// preamble because the skills were written for a different runtime (Claude Code
// with web search / openpyxl / subagents).
import baRaw from "../../skills/business-analysis.md?raw";
import styleRaw from "../../skills/excel-report-style.md?raw";
import nevRaw from "../../skills/nev-sales-diagnostic.md?raw";
import type { CustomPreset } from "../store/settings";
import { estimateTokens } from "./history";

export interface Preset {
  id: string;
  nameEn: string;
  nameZh: string;
  source: "builtin" | "custom";
  body: string;
  adaptationNote: string;
  approxTokens: number;
}

const NEV_NOTE =
  "Adaptation for this Excel runtime: the reference files this skill mentions (references/policy-calendar.md, references/data-sources.md) are NOT available, and you have NO web search. Where the skill says to search or consult references, instead ask the user to paste the data, or read it from the open workbook. Deliver analysis into the workbook (formulas, not constants) and summarize in chat.";

const BA_NOTE =
  "Adaptation for this Excel runtime: the references/ files this skill mentions are NOT available. You have no AskUserQuestion tool and no subagents — ask questions as plain chat messages, skip any subagent-review phase, and deliver output in chat or into the workbook instead of writing files.";

const STYLE_NOTE =
  "Adaptation for this Excel runtime: this skill's code samples are Python/openpyxl. IGNORE the code specifics and apply the design rules — themes, number-format discipline, data-block borders, layout, typography, KEY INSIGHTS sections, live formulas for adjustable scenarios — using your format_range / conditional_formatting / create_chart / set_formulas tools. Prefer widely available fonts (Calibri, 微软雅黑).";

function mk(id: string, nameEn: string, nameZh: string, body: string, adaptationNote: string): Preset {
  return {
    id,
    nameEn,
    nameZh,
    source: "builtin",
    body,
    adaptationNote,
    approxTokens: estimateTokens(adaptationNote) + estimateTokens(body),
  };
}

export const builtinAnalysisPresets: Preset[] = [
  mk("nev", "NEV Sales Diagnostic", "NEV月度销量诊断", nevRaw, NEV_NOTE),
  mk("ba", "Business Analysis", "商业分析框架", baRaw, BA_NOTE),
];

export const styleLayerPreset: Preset = mk("style", "Excel Report Styling", "报表美化", styleRaw, STYLE_NOTE);

export function resolveAnalysisPresets(custom: CustomPreset[]): Preset[] {
  return [
    ...builtinAnalysisPresets,
    ...custom.map((c) => ({
      id: c.id,
      nameEn: c.nameEn || "Custom",
      nameZh: c.nameZh || c.nameEn || "自定义",
      source: "custom" as const,
      body: c.body,
      adaptationNote: "",
      approxTokens: estimateTokens(c.body),
    })),
  ];
}
