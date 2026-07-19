# MP Analyzer

A "Claude for Excel"-style AI copilot that lives in a task pane inside desktop Excel
(Windows **and** Mac), powered by Chinese LLM providers — DeepSeek, Kimi (Moonshot),
GLM (Zhipu), Qwen (DashScope), MiniMax — via their OpenAI-compatible APIs.

The agent **reads and edits the open workbook**: values, formulas, model scaffolds,
scenario tables, formatting, conditional formats, charts. Every mutation is
**previewed before applying** (unless you enable auto-apply) and **snapshotted for
one-click revert** — programmatic edits bypass Excel's own Ctrl+Z.

Built-in analysis skills (selectable in the preset picker):
- **NEV月度销量诊断** — the NEV sales attribution/decomposition framework
- **商业分析框架** — the business-analysis framework
- **报表美化** toggle — excel-generator styling rules applied live in the workbook

---

## One-time setup — Mac (this machine)

```bash
cd "/Users/a./Desktop/MP analyzer"
npm install
npm run certs          # installs the Office dev localhost certificate (asks for admin password once)
npm run sideload:mac   # copies manifest.xml into Excel's wef folder
npm run dev            # starts https://localhost:3000
```

Then **fully quit Excel (⌘Q) and reopen it**. The **MP Analyzer** button appears at
the right end of the **Home** ribbon. Click it → the pane opens → gear icon →
paste your API key(s).

## One-time setup — Windows

```powershell
git clone <your-private-remote> mp-analyzer   # sync via git, NOT iCloud (node_modules)
cd mp-analyzer
npm install
npx office-addin-dev-certs install
npx office-addin-dev-settings sideload manifest.xml
npm run dev
```

If the registry sideload misbehaves, use the classic fallback: share a folder
containing `manifest.xml`, add it under File → Options → Trust Center → Trusted
Add-in Catalogs (check "Show in Menu"), restart Excel, Insert → My Add-ins →
Shared Folder.

## Every work session — no terminal needed

**Mac:** double-click **`MP Analyzer.app`** in the project folder. It silently starts
the local server (building `dist/` automatically the first time) and brings Excel to
the front — then just click the ribbon button. Drag the app to your Dock, or add it
to System Settings → General → **Login Items** to make the server start at login.
If you move the project folder, regenerate the app with `npm run launcher:mac`.

**Windows:** double-click **`Start MP Analyzer.vbs`** in the project folder — same
behavior, no console window. For auto-start at login: Win+R → `shell:startup` →
place a *shortcut* to the .vbs there.

The launchers serve the frozen production build via `scripts/serve.mjs` (zero-dep,
instant). Two things to know:
- After pulling code changes, run `npm run build` once (or delete `dist/`) so the
  launcher serves the new version.
- For active development with hot reload, `npm run dev` in a terminal still works
  and uses the same port — quit one before starting the other.
- The localhost certificate expires roughly monthly; if the pane stops loading,
  run `npm run certs` once and relaunch.

## API keys & CORS

- Keys are entered in **Settings** in the pane, stored per-provider in the pane's
  localStorage only, and sent only to the provider you selected. They are **never**
  written to the repo or into workbook files.
- 2026-07-19 reference test: all five providers returned readable responses to
  cross-origin browser calls (permissive CORS) — direct calls should just work.
  Confirm inside Excel via **Settings → Run CORS diagnostics** and record results
  in [docs/cors-matrix.md](docs/cors-matrix.md).
- If a provider ever blocks direct calls: `npm run proxy` (a ~100-line local HTTPS
  forwarder, host-whitelisted, binds 127.0.0.1) and flip **Use proxy** in Settings.

## Safety model

- **Preview-first**: mutating tool calls pause with a before/after preview; Apply /
  Apply-rest-of-turn / Reject-with-reason (the reason is fed back to the model).
- **Hard ops** (sheet delete/clear, row/col delete) always ask, even in auto-apply.
- **Revert**: each applied step snapshots the overwritten formulas + number formats
  (and cell formats for formatting ops). LIFO revert per step, or Revert-all in the
  status bar. Honest limits: revert restores content, but `#REF!` errors created in
  *other* cells by a structural delete don't heal, and sheet restore loses rich
  styling beyond number formats.
- Caps: reads clipped at 5k cells/call (paginated), writes/snapshots at 10k/20k
  cells, tool results at 12k chars — the model is told to split bigger work.

## Development

```bash
npm test         # 50 unit tests: SSE parser, JSON repair, A1 guards, history trim, snapshot stack
npm run build    # tsc + vite production build
npm run icons    # regenerate ribbon icons (replace assets/*.png with real art anytime)
```

Architecture (pure client-side, no backend):

```
src/llm     — provider presets/quirks, raw-fetch SSE client, tool-call JSON repair
src/excel   — env wrapper, A1 guards, 11 agent tools, snapshot/revert stack
src/agent   — loop (stream → tools → approval → results), system prompt, presets, history trim
src/store   — settings (localStorage) + chat store (approval gating lives here)
src/components — task-pane UI (React, no UI framework)
skills/     — your SKILL.md files bundled verbatim at build time (?raw imports)
proxy/      — optional zero-dep CORS fallback proxy
```

## Deferred to v1.1

`copy_range`, `sort_range`, `create_table` (native tables/autofilter), pivot tables
(ExcelApi 1.8 PivotTable API), out-of-order revert, streaming tool-arg preview.

## Troubleshooting

- **Pane doesn't load / cert warning** → rerun `npm run certs`, fully restart Excel.
- **Button missing on ribbon** → rerun sideload script, fully quit Excel (⌘Q / taskbar exit).
- **"No API key set"** → Settings → paste the key for the *currently selected* provider.
- **Provider 4xx on tool calls** → try Kimi K2 or GLM-4.6 (strongest tool-callers);
  model ids drift — the model field is free text, update it.
- **Windows: blank pane** → verify WebView2 is installed (M365 current channel does
  this automatically; Edge DevTools should attach to the pane).
