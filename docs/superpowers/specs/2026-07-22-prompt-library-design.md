# Prompt library — design

**Date:** 2026-07-22
**Status:** approved

## Problem

Analysts re-type the same prompts monthly with only a few values changed ("分析{月份}的
NEV销量…"). There is no way to save a reusable prompt. Separately, the composer's globe
button is being reclaimed: the user wants a Prompt Library button in its place.

## Decisions

- The composer's globe button is **replaced** by a Prompt Library button (book icon).
- Web search is NOT removed: its toggle moves to **Settings → Provider** as a checkbox,
  disabled with the existing hint on providers without native search. No plumbing changes.
- Templates are `{id, name, body}` stored in the settings localStorage payload
  (`promptTemplates`, spread-migration-safe), like custom presets. Single free-text name —
  no EN/ZH pair; users name their own templates.
- Placeholder syntax: any `{variable}` token in the body (≤30 chars, no braces/newlines
  inside). Using a template with placeholders opens a fill-in form (one input per unique
  variable); **Insert** substitutes and puts the result in the composer — never auto-sends.
  Blank variables stay as literal `{variable}` so an unfilled hole is visible.

## Components

- `src/agent/promptTemplates.ts` — `PromptTemplate`, `extractPlaceholders`, `fillTemplate`
  (pure, tested).
- `src/components/PromptLibraryPanel.tsx` — full-screen panel (like Settings/History)
  with three modes: list (use / edit / two-step delete / new), editor (name + body +
  syntax hint), fill (inputs per variable → Insert).
- `Composer.tsx` — library button where the globe was; `onInsert` sets the textarea text
  and refocuses. `SettingsPanel.tsx` — web-search checkbox. i18n, styles, README, E2E.
