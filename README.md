# MP Analyzer

A "Claude for Excel"-style AI copilot that lives in a task pane inside **desktop Excel**
(Windows **and** Mac), powered by Chinese LLM providers — DeepSeek, Kimi (Moonshot),
GLM (Zhipu), Qwen (DashScope), MiniMax — through their OpenAI-compatible APIs.

The agent **reads and edits the open workbook**: values, formulas, model scaffolds,
scenario tables, formatting, conditional formats, charts. Every mutation is
**previewed before it is applied**, **verified after it lands**, and **snapshotted for
one-click revert** — programmatic edits bypass Excel's own Ctrl+Z, so the add-in
brings its own undo stack.

**An analyst skill ships built-in** ([skills/builtin/](skills/builtin)): a senior China
NEV industry analyst that layers policy changes, launch calendars, pricing moves, and
registration data into one tier-tagged monthly attribution — using web search when the
provider supports it. Activate it by typing **`/`** in the composer (Claude Code-style
picker; the active skill shows as a removable pill above the input, and clearing the pill
returns to the plain assistant).

**Your own skills stay private.** Drop any `*.md` framework into the top-level `skills/`
folder and it becomes a selectable preset too (bundled at build time, gitignored, and it
overrides a shipped skill with the same filename); or paste one into
**Settings → Custom analysis presets** for no-rebuild use. See
[skills/README.md](skills/README.md).

**Queue while it works.** Sending a message while the agent is mid-turn queues it
(chips above the composer, removable); queued messages dispatch in order when the turn
finishes cleanly, and stay put after a Stop or an error.

**Chat history.** Conversations save automatically after every turn — including turns you
stopped or that errored — and the clock icon in the top bar lists the last 50, each tagged
with the workbook it was started against. Open one to read it *and continue it*: the
model-side context is restored too. History lives in this pane's localStorage; restored
tool cards are deliberately not revertable, since the undo stack belongs to the live
Excel session.

**Prompt library** (book button next to Send): save reusable prompts with `{变量}`
placeholders — e.g. `分析{月份}的NEV销量，对比{品牌}` — and picking one opens a quick
fill-in form, then drops the finished text into the composer for review before sending.

**Web search** (Settings → Provider → 联网搜索) uses each provider's native mechanism —
Kimi `$web_search`, GLM `web_search`, Qwen `enable_search` — entirely from the pane, no
extra keys. DeepSeek and MiniMax have no native search, so the toggle is disabled there.
On Qwen, search works best with `qwen-plus` (on `qwen3-max` it may require thinking
mode). The UI follows your OS light/dark appearance.

### Verification pipeline

The agent does not just claim it wrote something — it checks:

| Layer | What it does | Cost |
| --- | --- | --- |
| **Read-back** | After every write, re-reads the range and reports what actually landed, including `#NAME?` / `#REF!` / `#VALUE!` and 14 other Excel error literals | Free (same Excel batch) |
| **Turn-end audit** | When the agent finishes, re-scans every range it wrote this turn for error cells and empty results; hands problems back for a bounded repair round | Free (local reads) |
| **AI review** | One extra temperature-0 model call reviews *your request* against *what was actually done*, and flags results that are wrong rather than merely broken | ~1 small call per editing turn |

Controlled by **Settings → Result verification**: `Off` / `Basic` (read-back + audit) /
`Full` (adds the AI review, **default**).

---

## Requirements

| | Minimum |
| --- | --- |
| **Excel** | Microsoft 365 **desktop** Excel (Windows or Mac) with ExcelApi 1.9+. Excel 2019/2021 perpetual and Excel on the web are not supported. |
| **Node.js** | 18 LTS or newer — [nodejs.org](https://nodejs.org) |
| **Git** | Any recent version |
| **An API key** | From at least one of: DeepSeek, Moonshot/Kimi, Zhipu/GLM, DashScope/Qwen, MiniMax |

Everything runs locally on your machine. There is no backend, no telemetry, and the
add-in only talks to the LLM provider you select.

> **Port 3000 is fixed.** `manifest.xml` points Excel at `https://localhost:3000`.
> If something else on your machine owns that port, stop it before launching.

> **Do not put the project inside iCloud Drive, OneDrive, or Dropbox.** `node_modules`
> and file-sync clients corrupt each other. Use a plain local folder.

---

## Mac — step by step

### One-time setup

**1. Clone the repo** (plain local path, e.g. your Desktop or `~/dev`):

```bash
cd ~/Desktop
git clone https://github.com/CH3OHii/mp-analyzer.git "MP Analyzer"
cd "MP Analyzer"
```

**2. Install dependencies:**

```bash
npm install
```

**3. Install the local HTTPS certificate.** Office refuses to load a task pane over
plain HTTP, so a trusted `localhost` certificate is required:

```bash
npm run certs
```

macOS will prompt for your **admin password** to add the certificate to the keychain.
This is the standard Microsoft `office-addin-dev-certs` tool.

**4. Register the add-in with Excel** (copies `manifest.xml` into Excel's `wef` folder):

```bash
npm run sideload:mac
```

**5. Fully quit Excel with ⌘Q and reopen it.** This matters — Excel only reads add-in
registrations at startup, and closing the window is not the same as quitting.

**6. Start the server and open the pane:**

```bash
npm run dev
```

In Excel, look at the **right end of the Home ribbon** for the **MP Analyzer** button.
Click it and the task pane opens on the right.

**7. Add your API key:** click the **gear icon** in the pane → pick your **Provider** →
paste the **API key** → the key is saved per-provider in the pane's local storage.
Click **Test connection** to confirm it works.

You are done. Ask it something in the pane, e.g. `这个工作簿里有什么？`

### Daily use (no terminal)

Double-click **`MP Analyzer.app`** in the project folder. It silently starts the local
server (building `dist/` automatically on first use) and brings Excel to the front —
then just click the ribbon button.

- Drag the app to your **Dock** for quick access.
- To start it automatically at login: **System Settings → General → Login Items → +**
  and select `MP Analyzer.app`.
- If you **move the project folder**, regenerate the launcher: `npm run launcher:mac`.

The launcher serves the frozen production build (instant, zero dependencies). For
active development with hot reload use `npm run dev` instead — both use port 3000, so
quit one before starting the other.

### Updating on Mac

```bash
cd "~/Desktop/MP Analyzer"
git pull
npm install          # only if package.json changed
npm run build        # so the .app launcher serves the new version
```

If `manifest.xml` changed, also rerun `npm run sideload:mac` and restart Excel with ⌘Q.

---

## Windows — step by step

The Windows path is designed so you **never need a terminal**. A single `.vbs`
launcher bootstraps everything on first run.

### One-time setup

**1. Install prerequisites:**

- [Node.js LTS](https://nodejs.org) — accept the defaults
- [Git for Windows](https://git-scm.com/download/win) — accept the defaults

**2. Clone the repo** to a plain local folder (Command Prompt or PowerShell, once):

```powershell
cd %USERPROFILE%\Documents
git clone https://github.com/CH3OHii/mp-analyzer.git "MP Analyzer"
```

Again: **not** inside OneDrive. If your Documents folder is OneDrive-synced, use
`C:\dev\MP Analyzer` instead.

**3. Double-click `Start MP Analyzer.vbs`** in the project folder.

On the **first run only**, a console window appears and it bootstraps itself:

1. `npm install` — installs dependencies (takes a minute)
2. Installs the localhost certificate — **Windows shows a "Do you want to install this
   certificate?" dialog. Click Yes.** The pane will not load if you decline.
3. Registers the add-in in the Windows registry so the ribbon button appears

Then it starts the server hidden and launches Excel.

**4. If Excel was already running, fully EXIT it** — right-click the Excel taskbar icon
→ close all windows — **and reopen.** Registrations are only read at startup.

**5. Click the MP Analyzer button** at the right end of the **Home** ribbon, then the
**gear icon** → select your **Provider** → paste your **API key** → **Test connection**.

### Daily use

Double-click **`Start MP Analyzer.vbs`**. No console window appears after the first
run — it starts the server silently and opens Excel.

To start it automatically at login: press **Win+R**, type `shell:startup`, press Enter,
and place a **shortcut** to the `.vbs` file in that folder (a shortcut, not a copy).

### Manual setup, if you prefer the terminal

```powershell
cd "MP Analyzer"
npm install
npm run certs         # NOT `npx office-addin-dev-certs` — see note below
npm run sideload:win
npm run dev
```

> Use `npm run certs` / `npm run sideload:win`, which invoke the tools already installed
> in `node_modules`. Avoid the `npx …` form: npx re-downloads each tool into its
> `%LOCALAPPDATA%\npm-cache\_npx` cache and then deletes it, which frequently fails on
> Windows with `EPERM: operation not permitted, rmdir …\_npx\…` when antivirus is
> holding a lock on the freshly-extracted files.

If the registry-based sideload misbehaves, use the classic shared-folder fallback:

1. Put `manifest.xml` in a folder and share it (right-click → Properties → Sharing).
2. Excel → **File → Options → Trust Center → Trust Center Settings → Trusted Add-in
   Catalogs** → paste the share path (`\\MACHINE\share`) → **Add catalog** → tick
   **Show in Menu** → OK.
3. Restart Excel → **Insert → My Add-ins → Shared Folder** → MP Analyzer.

### Updating on Windows

```powershell
cd "MP Analyzer"
git pull
npm install
npm run build
```

Then relaunch the `.vbs`. If `manifest.xml` changed, delete the `.sideloaded` marker
file in the project folder before relaunching so it re-registers, and fully exit Excel.

---

## Using the pane

**Ask in Chinese or English** — the agent replies in the language you write in.

**Approval flow.** When the agent wants to change the workbook, a pinned bar appears
above the composer with a before/after preview:

- **Apply** — apply this one change
- **Apply rest of turn** — stop asking for the remainder of this request
- **Reject** — optionally give a reason, which is fed back to the model so its next
  attempt takes your objection into account

Destructive operations (sheet delete/clear, row/column delete) **always** ask, even
with auto-apply enabled.

**Revert.** Every applied step is snapshotted. Use **Revert** on the most recent tool
card, or **Revert all** in the status bar. Honest limits: revert restores contents and
number formats, but `#REF!` errors that a structural delete created in *other* cells do
not heal, and restoring a deleted sheet loses rich styling beyond number formats.

**Settings worth knowing:**

| Setting | Meaning |
| --- | --- |
| **Result verification** | `Off` / `Basic` / `Full` (default) — see the table at the top |
| **Auto-apply changes** | Skip approval for normal writes; destructive ops still ask |
| **Max agent steps per turn** | Default 15; raise for long multi-step builds |
| **Context budget (tokens)** | Default 32000; old tool results are elided before whole exchanges are dropped |
| **Analysis skill** (type `/` in the composer) | Injects a shipped `skills/builtin/*.md` skill, your own `skills/*.md` framework, or a custom preset into the system prompt |

**API keys** are stored per-provider in the pane's **localStorage only**. They are never
written into the repo and never into workbook files — a deliberate choice, because
`Office.context.document.settings` travels inside shared `.xlsx` files and would leak
your key to anyone you send the workbook to.

---

## Safety model

- **Preview-first** — mutating calls pause with a before/after grid before applying.
- **Validated before you are asked** — ragged data, malformed rules, and unknown sheet
  names are rejected with a corrective message *before* the approval prompt, so you are
  never asked to approve a call that was always going to fail.
- **Preconditions** — the agent can anchor a write to cells it previously read; if the
  sheet drifted underneath it, the write is refused rather than misapplied.
- **Verified after** — see the verification pipeline above.
- **Bounded** — reads clipped at 5k cells per call (paginated), writes/snapshots at
  10k/20k cells, tool results at 12k chars, repair rounds structurally capped.

---

## Development

```bash
npm test         # 117 unit tests — SSE parsing, JSON repair, A1 guards, validation,
                 # error scanning, audit dedupe, retry/backoff, verifier parsing
npm run build    # tsc --noEmit + vite production build
npm run icons    # regenerate ribbon icons
npm run proxy    # optional local CORS fallback proxy (see below)
```

Architecture — pure client-side, no backend:

```
src/llm        — provider presets/quirks, SSE client, tool-call JSON repair, HTTP retry
src/excel      — Office.js wrapper, A1 guards, 11 agent tools, validation, verification,
                 snapshot/revert stack
src/agent      — agent loop (stream → tools → approval → verify), audit, AI verifier,
                 system prompt, presets, history trimming
src/store      — settings (localStorage) + chat store (approval gating lives here)
src/components — task-pane UI (React 19, no UI framework)
skills/        — your own SKILL.md frameworks, bundled at build time (gitignored)
skills/builtin — five shipped analyst skills (committed; same-name private file wins)
proxy/         — optional zero-dep CORS fallback proxy
docs/          — CORS matrix + manual E2E checklist
```

All Office.js access is quarantined behind `src/excel/env.ts`, which keeps the rest of
the codebase pure and unit-testable without mocking Excel.

### CORS

A 2026-07-19 reference test found all five providers return readable responses to
cross-origin browser calls, so direct calls should just work. Confirm inside Excel via
**Settings → Run CORS diagnostics** and record results in
[docs/cors-matrix.md](docs/cors-matrix.md). If a provider ever blocks direct calls, run
`npm run proxy` (a ~100-line local HTTPS forwarder, host-whitelisted, bound to
127.0.0.1) and enable **Use local CORS proxy** in Settings.

### Deferred to v1.1

`copy_range`, `sort_range`, `create_table` (native tables/autofilter), pivot tables,
out-of-order revert, streaming tool-argument preview.

---

## Troubleshooting

**Windows: the launcher says Node.js was not found**
- Install [Node.js LTS](https://nodejs.org), then **sign out of Windows and back in**
  before relaunching. A program started from Explorer keeps the `PATH` that Explorer had
  at login, so a Node installed mid-session is invisible to the launcher even though
  `where npm` works fine in a new Command Prompt.
- The launcher also searches the standard install locations (official MSI, per-user
  install, nvm-windows, Volta, Scoop, Chocolatey), so this dialog usually means Node
  really is absent.
- If you saw the raw `npm is not recognized` / `npm 不是内部或外部命令` console error
  instead of that dialog, you are on an old launcher — `git pull` — **and** you should
  delete the `.sideloaded` marker file, because the old launcher could write it after a
  failed bootstrap and then skip certificate install and add-in registration forever.

**Windows: launcher says a step "failed with exit code 0"**
- That combination is a contradiction (exit code 0 means success) and was a bug in the
  launcher's own error reporting, not in `npm`/the certificate tool/the sideload tool.
  `git pull` for the fix — the launcher now runs each bootstrap step through a small
  temp `.bat` file instead of one packed `cmd.exe` line, which removes the timing
  quirk that produced the false "failed" report.

**Windows: `EPERM: operation not permitted, rmdir …\npm-cache\_npx\…`**
- The launcher no longer uses `npx` for setup, so `git pull` and relaunch fixes this. If
  you hit it running commands by hand, use `npm run certs` and `npm run sideload:win`
  instead of the `npx …` forms — they run the locally installed tools and never touch the
  `_npx` cache.
- The lock is almost always real-time antivirus scanning the npm cache. If it persists,
  add an exclusion for `%LOCALAPPDATA%\npm-cache` in Windows Security → Virus & threat
  protection → Manage settings → Exclusions, then delete the stale cache once:
  `rmdir /s /q "%LOCALAPPDATA%\npm-cache\_npx"`.

**Ribbon button is missing**
- Mac: rerun `npm run sideload:mac`, then quit Excel with **⌘Q** (not just the red dot) and reopen.
- Windows: delete the `.sideloaded` marker file, relaunch the `.vbs`, then fully **exit**
  Excel from the taskbar and reopen.

**Pane is blank or shows a certificate warning**
- Rerun `npm run certs` (Mac) or `npx office-addin-dev-certs install` (Windows) — the
  development certificate expires roughly monthly — then restart Excel.
- Confirm the server is actually running: open `https://localhost:3000` in a browser.
- Windows only: verify WebView2 is installed (Microsoft 365 current channel installs it
  automatically; Edge DevTools should be able to attach to the pane).

**"No API key set for this provider"**
- Settings → paste the key for the **currently selected** provider. Keys are stored per
  provider, so switching providers requires a key for that one too.

**Provider returns 4xx on tool calls**
- Model IDs drift quarterly and the model field is free text — update it.
- Kimi K2 and GLM-4.6 are the strongest tool-callers; try one of those first.

**Server won't start / port in use**
- Something else owns port 3000. Find and stop it: `lsof -i :3000` (Mac) or
  `netstat -ano | findstr :3000` (Windows). The port is fixed by `manifest.xml`.

**Changes to the code don't show up**
- The `.app` / `.vbs` launchers serve the frozen `dist/` build. Run `npm run build`
  after pulling, or use `npm run dev` for hot reload during development.

**The agent edited the wrong thing**
- Use **Revert** on the tool card, or **Revert all** in the status bar, and tell it what
  went wrong — rejection reasons and corrections are fed back into the conversation.
