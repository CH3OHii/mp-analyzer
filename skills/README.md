# Analysis skills

Drop any `*.md` file in this folder and it becomes a **built-in analysis preset**,
selectable from the preset picker in the task pane. Files here are bundled into the
build (`import.meta.glob(... ?raw)` in [`src/agent/presets.ts`](../src/agent/presets.ts))
because an Office task pane has no filesystem at runtime.

**This folder ships empty on purpose.** Analysis frameworks tend to be personal or
proprietary, so `skills/*.md` is gitignored — your files stay on your machine and are
never committed. Nothing breaks when the folder is empty: the picker just shows
**None** plus whatever you add under **Settings → Custom analysis presets**.

## Adding a skill

1. Save your framework as e.g. `skills/my-framework.md`.
2. Rebuild (`npm run build`, or restart `npm run dev`).
3. Pick it in the preset picker. The name shown is derived from the filename
   (`my-framework` → "My Framework"); the token cost is displayed next to it.

Each bundled skill is injected into the system prompt with an **adaptation preamble**,
because most skills are written for a different runtime and assume tools this add-in
does not have. The default preamble tells the model that web search, reference files,
subagents, and file-writing are unavailable, and that output belongs in the workbook as
formulas. To give a specific file a tailored preamble or a bilingual display name, add
an entry to `NOTES` / `NAMES` in `src/agent/presets.ts`, keyed by filename slug.

## The styling layer

A file named exactly `excel-report-style.md` is treated specially: instead of becoming
an analysis preset, it powers the **report styling** toggle in the picker, so it can be
layered on top of whichever analysis skill is active. If that file is absent, the
toggle is hidden.

## Custom presets without a rebuild

For one-off or frequently-changed frameworks, skip this folder entirely: paste the text
into **Settings → Custom analysis presets**. Those live in the pane's localStorage, need
no rebuild, and are equally private.
