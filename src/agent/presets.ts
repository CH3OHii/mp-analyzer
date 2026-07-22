// Two skill tiers, one mechanism (the task pane has no filesystem, so both are
// bundled at build time):
//   skills/*.md         — the user's PRIVATE frameworks, gitignored, optional.
//   skills/builtin/*.md — committed, generic analyst skills shipped with the repo.
// A private file with the same slug overrides the committed one. Optional
// frontmatter (name_en / name_zh / note) names the skill and sets its
// adaptation preamble; files without it fall back to the tables below.
import type { CustomPreset } from "../store/settings";
import { parseFrontmatter } from "./frontmatter";
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
  "Adaptation for this Excel runtime: any reference files, subagents, or file-writing this skill assumes are NOT available. Web search is available ONLY when a '# Web search' section appears at the end of this prompt — otherwise ask the user to paste data you cannot find, or read it from the open workbook. Deliver analysis into the workbook (formulas, not constants) and summarize in chat.";

const NOTES: Record<string, string> = {
  "nev-sales-diagnostic":
    "Adaptation for this Excel runtime: the reference files this skill mentions (references/policy-calendar.md, references/data-sources.md) are NOT available. Web search is available ONLY when a '# Web search' section appears at the end of this prompt; where it is absent and the skill says to search or consult references, ask the user to paste the data, or read it from the open workbook. Deliver analysis into the workbook (formulas, not constants) and summarize in chat.",
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

const rawUserSkills = import.meta.glob("../../skills/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const rawBuiltinDirSkills = import.meta.glob("../../skills/builtin/*.md", {
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

function mk(slug: string, raw: string): Preset {
  const { meta, body } = parseFrontmatter(raw);
  const table = NAMES[slug];
  const nameEn = meta.name_en || table?.en || titleFromSlug(slug);
  const nameZh = meta.name_zh || table?.zh || nameEn;
  const adaptationNote = meta.note || NOTES[slug] || GENERIC_NOTE;
  return {
    id: slug,
    nameEn,
    nameZh,
    source: "builtin",
    body,
    adaptationNote,
    approxTokens: estimateTokens(adaptationNote) + estimateTokens(body),
  };
}

export interface SkillSource {
  slug: string;
  raw: string;
}

function toSources(globbed: Record<string, string>): SkillSource[] {
  return Object.entries(globbed)
    .map(([path, raw]) => ({ slug: slugOf(path), raw }))
    // README.md files are committed documentation, not skills — they match the
    // globs because gitignore whitelists them.
    .filter((s) => s.slug.toLowerCase() !== "readme")
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/** User's private skills first, then committed built-ins; on a slug collision
 *  the user's local file wins (lets them fork a shipped skill privately). */
export function mergeSkillSources(user: SkillSource[], builtinDir: SkillSource[]): SkillSource[] {
  const taken = new Set(user.map((s) => s.slug));
  return [...user, ...builtinDir.filter((b) => !taken.has(b.slug))];
}

const userSkills = toSources(rawUserSkills);
const bundled = mergeSkillSources(userSkills, toSources(rawBuiltinDirSkills));

export const builtinAnalysisPresets: Preset[] = bundled
  .filter((s) => s.slug !== STYLE_SLUG)
  .map((s) => mk(s.slug, s.raw));

/** Null when no styling skill is bundled — the UI hides the toggle.
 *  Deliberately matched in the user's top-level dir only. */
export const styleLayerPreset: Preset | null = (() => {
  const style = userSkills.find((s) => s.slug === STYLE_SLUG);
  return style ? mk(style.slug, style.raw) : null;
})();

/** Slash-menu filter: case-insensitive substring over EN name, ZH name, and slug. */
export function filterPresets(query: string, presets: Preset[]): Preset[] {
  const q = query.trim().toLowerCase();
  if (!q) return presets;
  return presets.filter(
    (p) => p.nameEn.toLowerCase().includes(q) || p.nameZh.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
  );
}

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
