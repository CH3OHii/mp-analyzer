# Analysis skills

Two tiers, one mechanism — both are bundled into the build (`import.meta.glob(... ?raw)`
in [`src/agent/presets.ts`](../src/agent/presets.ts)), because an Office task pane has no
filesystem at runtime. Pick a skill by typing **`/`** in the composer.

## Built-in skills (committed)

[`builtin/`](builtin) ships one generic, public-safe analyst skill:

| File | Skill |
| --- | --- |
| `ev-industry-analyst.md` | **分析师 / Analyst** — China NEV monthly attribution: policy × launches × pricing × channel data, tier-tagged evidence, web search when available |

There is no "None" entry in the `/` menu: running without a skill is the default, and
clearing the active-skill pill returns to it.

## Your own skills (private, top level)

Anything else you save as `skills/my-framework.md` is **gitignored** — your files stay on
this machine and are never committed. A private file with the **same filename as a
built-in overrides it**, so you can fork a shipped skill locally. Nothing breaks when the
folder has no private files.

1. Save your framework as e.g. `skills/my-framework.md`.
2. Rebuild (`npm run build`, or restart `npm run dev`).
3. Type `/` in the composer and pick it. The token cost is shown next to the name.

## Frontmatter (optional but recommended)

```markdown
---
name_en: My Framework
name_zh: 我的分析框架
note: One-paragraph adaptation preamble injected above the skill body.
---
# My Framework
...
```

Files without frontmatter fall back to a name derived from the filename and a generic
adaptation preamble (the `NAMES` / `NOTES` tables in `src/agent/presets.ts` still work as
a second fallback). The preamble matters because many skills are written for other
runtimes: here there are no reference files and no subagents, output belongs in the
workbook as live formulas, and **web search is available only when the pane's globe
toggle is on and the provider supports it** (Kimi / GLM / Qwen).

## The styling layer

A **top-level** file named exactly `excel-report-style.md` is treated specially: instead
of becoming an analysis preset, it powers the **report styling** toggle in the `/` menu,
so it can be layered on top of whichever analysis skill is active. If that file is
absent, the toggle is hidden.

## Custom presets without a rebuild

For one-off or frequently-changed frameworks, skip files entirely: paste the text into
**Settings → Custom analysis presets**. Those live in the pane's localStorage, need no
rebuild, and are equally private.
