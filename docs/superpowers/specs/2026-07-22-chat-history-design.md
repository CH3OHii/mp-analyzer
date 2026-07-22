# Chat history — design

**Date:** 2026-07-22
**Status:** approved

## Problem

Chat state in MP Analyzer is in-memory only (`src/store/chatStore.ts` — `state.items` plus
the module-level `llmHistory` array). Reloading the pane, switching workbooks, or pressing
**New chat** destroys the conversation permanently. An analyst who built a model last week
has no way to see what the agent did, or to pick the thread back up.

## Decisions

| Question | Choice |
| --- | --- |
| Open a past chat and…? | **Resume** — restore the transcript *and* the model-side context so the conversation continues |
| Which chats are listed? | **All chats**, each labeled with the workbook it was started against |
| How much detail is kept? | **Everything** (messages + tool cards + results), capped at **50 chats** |

Out of scope for v1: search, rename, export, cross-device sync.

## Architecture

New module `src/store/chatHistory.ts` — named to avoid confusion with `src/agent/history.ts`,
which trims context for requests and is unrelated. It is a **pure core with a thin
localStorage shell**: title derivation, eviction, size reduction and restore-sanitizing are
exported pure functions; only `loadAll` / `persist` touch the browser.

### Record shape

```ts
interface SavedChat {
  id: string;                 // "chat_<createdAt>_<counter>"
  title: string;              // first user message, whitespace-collapsed, ≤40 chars
  workbook: string | null;    // Excel workbook name at save time (null outside Excel)
  createdAt: number;
  updatedAt: number;
  usage: { prompt: number; completion: number };
  items: ChatItem[];          // UI transcript, including tool cards
  llmHistory: ChatMessage[];  // provider-shaped context — what makes resume work
}
```

Persisted under localStorage key `mp-analyzer-chats-v1`, independent of the settings key so
a corrupt history can never take settings (and API keys) down with it.

### Save points

Autosave runs where turn outcomes already land — `src/agent/dispatch.ts`, after each
`runTurn` settles, covering **done, stopped, and error** alike. It also runs from the
New-chat handler so the outgoing conversation is captured before `resetChat()` wipes it.
Saves upsert by id, so a chat updates in place across turns rather than duplicating.

`chatStore.ts` gains no history import: the New-chat path calls a `newChatWithSave()` helper
exported from `chatHistory.ts`. Dependencies point one way — `chatHistory → chatStore` — so
there is no import cycle.

### Size and quota discipline

Reads are size-capped but tool results and read-backs still add up, and localStorage offers
roughly 5 MB per origin. Three bounded mechanisms, applied in order:

1. **At save time**, per chat: `preview` blocks (before/after grids) are dropped entirely —
   they are transient approval UI with no value in a transcript — and `argsRaw` /
   `resultSummary` are clipped to 2,000 chars, matching what `ToolCard` already displays.
2. **If a chat still exceeds ~150 KB**, oldest `role:"tool"` bodies in its `llmHistory` are
   replaced with `ELIDED_RESULT`, imported from `src/agent/history.ts`. This is free in
   fidelity: `trimHistory` already elides those same old bodies *before sending them to the
   model*, so a resumed chat sends exactly what a live one would.
3. **On `QuotaExceededError`**, the oldest chat is evicted and the write retried, down to a
   single chat, rather than letting the save fail silently.

Steady-state cap: 50 chats, oldest by `updatedAt` evicted first.

### Restore, and the revert-safety fix

`chatStore.restoreChat()` replaces `items`, `llmHistory` and `usage`, and clears
`streaming` / `pendingCardId`.

**Every restored tool card has its `stepId` stripped.** This is load-bearing, not cosmetic.
The undo stack in `src/excel/snapshot.ts` is in-memory with a counter-based `seq`, so ids
restart at `step_1` on every pane reload. `ToolCard` shows a Revert button when
`card.stepId === snaps.steps.at(-1)?.id` — a restored card carrying `step_3` would therefore
offer to revert an unrelated edit from the *current* session. Stripping the id disables
Revert on historical cards while leaving the live revert stack fully functional, and
`markStepsReverted` (which matches on `stepId`) simply never matches them.

Restoring is blocked while a turn is streaming.

### UI

A history icon in `TopBar`, next to New chat, opens `HistoryPanel` — a full-screen overlay
reusing the existing `.panel` styles, like Settings. Each row shows title, workbook badge,
relative date and message count; clicking opens the chat, a trash icon deletes it behind a
two-step confirm. Plus **Clear all** and an empty state. All strings bilingual.

## Testing

`test/chatHistory.test.ts` covers the pure core without a browser: title derivation
(including CJK and whitespace collapse), eviction ordering and cap, `preview` dropping and
field clipping, progressive `ELIDED_RESULT` elision, `stepId` stripping on restore, and a
save→load round trip through an injected in-memory storage stub.

## Files

New: `src/store/chatHistory.ts`, `src/components/HistoryPanel.tsx`, `test/chatHistory.test.ts`.
Modified: `chatStore.ts` (`restoreChat`), `dispatch.ts` (autosave), `TopBar.tsx`, `App.tsx`,
`excel/env.ts` (`getWorkbookName`), both i18n dicts, `styles.css`, `README.md`,
`docs/e2e-checklist.md`.
