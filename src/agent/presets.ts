// Analysis skills are OPTIONAL and local. Any `skills/*.md` present at build
// time is bundled verbatim (the task pane has no filesystem) and offered as a
// built-in preset; with no files present — the default for a fresh clone — the
// picker simply shows your custom presets. Keep private frameworks out of the
// repo: skills/*.md is gitignored.
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

/** Skills were written for a different runtime (Claude Code with web search,
 *  openpyxl, subagents), so each gets a load-bearing adaptation preamble. */
const GENERIC_NOTE =
  "Adaptation for this Excel runtime: any reference files, web search, subagents, or file-writing this skill assumes are NOT available. Ask the user to paste data you cannot find, or read it from the open workbook. Deliver analysis into the workbook (formulas, not constants) and summarize in chat.";

const NOTES: Record<string, string> = {
  "nev-sales-diagnostic":
    "Adaptation for this Excel runtime: the reference files this skill mentions (references/policy-calendar.md, references/data-sources.md) are NOT available, and you have NO web search. Where the skill says to search or consult references, instead ask the user to paste the data, or read it from the open workbook. Deliver analysis into the workbook (formulas, not constants) and summarize in chat.",
  "business-analysis":
    "Adaptation for this Excel runtime: the references/ files this skill mentions are NOT available. You have no AskUserQuestion tool and no subagents — ask questions as plain chat messages, skip any subagent-review phase, and deliver output in chat or into the workbook instead of writing files.",
  "excel-report-style":
    "Adaptation for this Excel runtime: this skill's code samples are Python/openpyxl. IGNORE the code specifics and apply the design rules — themes, number-format discipline, data-block borders, layout, typography, KEY INSIGHTS sections, live formulas for adjustable scenarios — using your format_range / conditional_formatting / create_chart / set_formulas tools. Prefer widely available fonts (Calibri, 微软雅黑).",
};

/** Display names for the skills this project was built against; anything else
 *  falls back to a title derived from its filename. */
const NAMES: Record<string, { en: string; zh: string }> = {
  "nev-sales-diagnostic": { en: "NEV Sales Diagnostic", zh: "NEV月度销量诊断" },
  "business-analysis": { en: "Business Analysis", zh: "商业分析框架" },
  "excel-report-style": { en: "Excel Report Styling", zh: "报表美化" },
};

/** The styling skill is a LAYER (toggle), not an analysis preset. */
const STYLE_SLUG = "excel-report-style";

const rawSkills = import.meta.glob("../../skills/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function slugOf(path: string): string {
  return path.split("/").pop()!.replace(/\.md$/, "");
}

function titleFromSlug(slug: string): string {
  return slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function mk(slug: string, body: string): Preset {
  const name = NAMES[slug] ?? { en: titleFromSlug(slug), zh: titleFromSlug(slug) };
  const adaptationNote = NOTES[slug] ?? GENERIC_NOTE;
  return {
    id: slug,
    nameEn: name.en,
    nameZh: name.zh,
    source: "builtin",
    body,
    adaptationNote,
    approxTokens: estimateTokens(adaptationNote) + estimateTokens(body),
  };
}

const bundled = Object.entries(rawSkills)
  .map(([path, body]) => ({ slug: slugOf(path), body }))
  .sort((a, b) => a.slug.localeCompare(b.slug));

export const builtinAnalysisPresets: Preset[] = bundled
  .filter((s) => s.slug !== STYLE_SLUG)
  .map((s) => mk(s.slug, s.body));

/** Null when no styling skill is bundled — the UI hides the toggle. */
export const styleLayerPreset: Preset | null = (() => {
  const style = bundled.find((s) => s.slug === STYLE_SLUG);
  return style ? mk(style.slug, style.body) : null;
})();

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
