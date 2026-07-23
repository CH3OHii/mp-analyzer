# Manual E2E checklist

Fixture: `fixtures/nev-sample.xlsx` — sheet `RawMonthly` with columns
月份 (2024-01 … 2025-12), PV零售, NEV零售, NEV批发, 出口, BEV, PHEV (~24 rows) and
planted dirt: one number stored as text ("1,234"), one blank cell, one duplicated
month, one full-width digit string (１２３４); sheet `Notes` with free text.
(Building this workbook *via the agent* is itself a Phase-3 test.)

★ = rerun on Windows.

1. ★ **Overview (ZH)** — ask 这个工作簿里有什么？ → correct sheet names, shapes, headers.
2. ★ **Penetration column** — "add a monthly NEV penetration column, format 0.0%" →
   real formulas (`=NEV/PV` style), not pasted constants; preview shown before write.
3. **Analysis preset** — with a `skills/*.md` framework selected in the picker (or a
   custom preset pasted in Settings): the framework's structure visibly drives the
   output — e.g. a decomposition written into a new sheet as formulas, with ZH labels.
   Also verify the picker degrades cleanly when `skills/` is empty (shows None + custom
   presets only, and the styling toggle is hidden).
4. **Scenario grid** — 3-scenario penetration sensitivity table; with a styling skill
   present and its layer toggled on, input cells are visibly highlighted per its rules.
5. ★ **Cleaning + revert** — "find and fix numbers stored as text" → fixes applied;
   Revert restores the dirty state *exactly* (text-number back as text).
6. ★ **Chart + revert** — "line chart of NEV零售" → chart appears; Revert deletes it.
7. **Reject feedback** — Reject a pending write with a reason → model's next attempt
   visibly incorporates the reason.
8. ★ **Scaffold + revert-all** — multi-step model build (several writes + formats),
   then Revert all → values, formulas, and number formats restored.
9. **Failure modes** — wrong API key → readable ZH error, no stuck spinner; kill the
   dev server mid-stream → graceful abort; Stop button mid-stream keeps partial text.
10. **Long session** — 30+ turns → no context-overflow 400s; token meter grows sanely;
    old tool results get elided (visible in payload sizes, not in UI).
11. **Windows-only** — ribbon icon renders at 16/32/80; IME guard: typing Chinese and
    pressing Enter to confirm composition does NOT send; certs trusted; pane runs in
    WebView2 (Edge DevTools attach works).

## Verification layer (legendary update)

12. ★ **Post-op read-back** — ask for a formula column but nudge the model into a bad
    function name (or hand-edit a formula to `=SUMM(...)` first and ask the agent to
    copy the pattern) → the write's tool card result shows `verified.errors` with
    `#NAME?`, and the model fixes it within the same turn without being asked.
13. ★ **Turn-end audit + green card** — normal multi-step build → after the model's
    final answer a green "Verification passed" card appears. Then set verifyMode to
    `off` in Settings → no audit, no card, old behavior.
14. **AI review (full mode)** — ask for something the deterministic audit can't catch
    (e.g. "sum column B" but the model sums the wrong column — force by rejecting its
    first read) → the AI review card lists the issue and the model repairs; bounded:
    at most ~3 extra steps, never loops.
15. ★ **expect preconditions** — after the model reads headers, edit a header cell
    manually mid-turn (before approving the pending write) → `precondition_failed`
    with the actual value; nothing was written; model re-reads.
16. **unknown_sheet suggestion** — ask to write to a slightly-misspelled sheet name
    ("Sumary") → tool errors with did-you-mean suggestion; no Office exception; model
    self-corrects to the real name.
17. ★ **Ragged write rejection** — coax a jagged 2D write (rare naturally; can test by
    temporarily lowering temperature and asking for uneven rows) → `ragged_values`
    teaching error, model pads with null and retries.
18. ★ **Border revert** — "add thin borders to A1:D5" → Revert removes the borders
    (pre-update this left them behind).
19. **Failed-write stack integrity** — trigger a write onto a protected sheet →
    error card, and the Revert stack does NOT contain a phantom step for it
    (StatusBar count unchanged).
20. **HTTP retry** — briefly cut network, send a message → notice appears only after
    ~3 backoff attempts fail; restore network mid-backoff → the turn proceeds.
21. **Stop during verification** — hit Stop while the "AI review" call is in flight →
    turn aborts cleanly ("Stopped."), no verify card, no stuck spinner.

## Upgrade round 2 (queue, slash picker, web search, builtin skills, dark UI)

22. ★ **Queue during a multi-tool turn** — while the agent is mid-turn, send two more
    messages (Enter) → they appear as dashed chips above the composer; when the turn
    ends normally they dispatch FIFO, one turn each. × on a chip removes only it.
23. ★ **Queue survives Stop / error** — queue a message, hit Stop → "Stopped." and the
    chip STAYS queued (nothing auto-dispatches). Same after an API error. Sending a
    new message afterwards resumes the queue in order (older first).
24. **Queue + approval gate** — queue a message while a PendingBar approval is showing
    → approving/rejecting proceeds normally; the queued message dispatches only after
    the whole turn (including audit/verify) finishes.
25. ★ **Slash picker, both hosts** — type "/" as the first character → menu opens above
    the composer listing None + five built-in skills (+ private/custom ones); filter
    by typing (EN substring, 中文子串, or slug); ArrowUp/Down wrap, Enter/Tab pick,
    Esc dismisses. Selection shows a teal pill; × clears it.
26. ★ **Slash picker with Chinese IME** (Windows WebView2 AND Mac WKWebView) — with
    pinyin composition open, Enter confirms the composition and does NOT pick/send;
    arrows navigate IME candidates, not menu rows. "/" typed mid-composition does not
    open the menu.
27. **New-chat clears the queue** — queue two messages, press + (new chat) → chips
    gone, nothing dispatches.
28. ★ **Web search per provider** (toggle now in Settings → Provider → 联网搜索):
    - Kimi: ask "今天新能源购置税政策有什么新变化" with globe ON → a 联网搜索 tool
      card appears with the query; final answer cites source names + dates. Round-trip
      completes (no dangling tool call), audit/verify still run on Excel edits.
    - GLM: same question → no tool card (server-side), but the answer reflects fresh
      info. No HTTP 400 (tool_choice guard).
    - Qwen: test on qwen-plus; on qwen3-max note whether search fires (thinking-mode
      caveat) — record result here.
    - DeepSeek/MiniMax: the Settings checkbox is disabled with an explanatory hint.
    - Toggle OFF: system prompt has no "# Web search" section; model asks for data
      instead of claiming to search.
29. **Built-in skills** — activate each of the five via "/" and run a small real task
    → skill conventions hold: Inputs/Calc/Output separation, live formulas (no pasted
    constants), assumption cells highlighted, KEY INSIGHTS block, checks block; the
    turn-end audit and AI review still pass; Revert All is still LIFO-clean.
30. **Private-skill override** — drop a local skills/ev-industry-analyst.md → the
    picker shows YOUR version (not the shipped one); delete it → shipped one returns.
    `git status` stays clean both times.
31. ★ **Dark mode in Excel** — set OS dark appearance (Windows AND Mac) → pane follows:
    dark surfaces, readable user bubble, markdown tables/code blocks, tool cards +
    status pills, verify pass/issues cards, preview diff grid, pending bar, error
    banner, settings inputs. Toggle back to light live.
32. **Personality-menu clearance** — with the restyle, Excel's ⓘ button still doesn't
    overlap the top-bar icons or the Settings ✕ on either host.

## Chat history

33. ★ **Autosave and resume** — run a turn, press + (new chat), open the clock icon → the
    old chat is listed with its title, workbook badge, relative date and message count.
    Open it: the transcript returns AND a follow-up message continues the same
    conversation (the model remembers the earlier context). The record updates in place —
    the list must not grow a duplicate.
34. **Saved on stop and on error** — Stop a turn mid-stream, then trigger an API error
    (wrong key). Both conversations appear in history; neither is lost.
35. ★ **Restored cards cannot revert live edits** — in one session make a real edit
    (Revert available), press + , reopen the old chat from history → its tool cards show
    NO Revert button, and the StatusBar revert count for the current session is unchanged.
    This is the stepId-stripping guard; a Revert button here would undo an unrelated edit.
36. **Streaming guard** — open history while a turn is running → rows are disabled with a
    hint; clicking one does nothing.
37. **Delete and clear** — trash icon asks to confirm, then removes only that chat;
    Clear all empties the list and shows the empty state.
38. **Workbook labels** — start chats in two different workbooks → each row is badged with
    the workbook it came from.
39. **Storage bounds** — after heavy use (many long turns) the pane still starts fast and
    Settings/API keys are unaffected; history caps at 50 chats, oldest dropped first.
40. **Prompt library** — book button next to Send opens the library. Create a template
    with two placeholders (e.g. 分析{月份}的NEV销量，对比{品牌}); using it shows one
    input per variable; 插入 puts the substituted text in the composer WITHOUT sending;
    a blank variable stays as a literal {月份} token. Edit and two-step delete work;
    templates survive a pane reload (settings localStorage).

## Capability expansion (aggregate / pivots / tables / cross-verifier)

41. ★ **200k-row aggregate** — build a fixture sheet with ~200k rows × 8 cols (ZH headers:
    品牌/车型/月份/NEV零售…) and ask for 零售 by 品牌 for one month → the agent uses
    aggregate_range (NOT paged read_range), the numbers match a hand-built pivot of the
    same data, and the whole scan finishes in seconds (watch for ~1 min on full-sheet
    10M-cell scans — acceptable, but note the wall time on Mac).
42. **Aggregate ↔ pivot routing** — ask "why did BEV share drop in June?" (analysis →
    aggregate_range in conversation) vs "build me a pivot of retail by brand" (artifact →
    manage_pivot). The model should route correctly without being told the tool name.
43. ★ **Pivot lifecycle** — create (new sheet auto-added, appears in overview as
    `pivots:`), describe, add_field, set_aggregation (sum→average), remove_field,
    refresh after source edit, delete. Revert each editing step LIFO: field edits restore
    the prior state WITHOUT losing manual styling; create-revert removes the pivot (and
    the sheet if it was auto-created); delete on a <1.15 host reports not_revertable.
44. **Pivot teaching errors** — create with a wrong field name → error lists the real
    header texts; create sourced from a table name works; dest_sheet that doesn't exist
    reports ItemNotFound (no half-built pivot left behind).
45. ★ **Big fill honesty** — set_formulas with formula_r1c1 over >20k cells → ALWAYS asks
    (even with auto-apply on), the preview says it cannot be reverted, the result carries
    not_revertable, and the step is absent from the revert stack; the audit still checks
    the top slice. A >1.05M-cell fill is refused. Small fills keep full undo.
46. **Excel Tables** — manage_table create (headers, style), rename, set_totals on/off,
    unlist; each reverts (create-revert unlists, unlist-revert recreates minus filter
    state — disclosed). list shows name (Sheet!Range); overview shows the same.
47. **Sort both sides of the cap** — sort a <20k-cell range by two keys (asc+desc) →
    revert restores contents, number formats, and cell styling (fills/fonts; borders
    excepted — disclosed in the result). Sort a >20k-cell range → hard approval +
    "cannot be reverted" note, then verify order landed. Table sort within cap works by
    header name; oversized table sort refuses with a suggestion naming the sheet and the
    data range (totals row excluded) — following it must sort the RIGHT sheet.
48. **Filters** — auto_filter values + criterion styles land and revert (criteria
    cleared); table_filter with a wrong column lists the real columns; clear_filters
    works for both targets.
49. ★ **#NAME? fallback loop** — force an unavailable function (e.g. misspell XLOOKUP or
    test on a host without it) → read-back/audit reports #NAME?, and the repair round
    rewrites with a compatible alternative instead of retrying the same name.
50. ★ **Cross-model reviewer** — Settings → verification Full → AI reviewer = a DIFFERENT
    provider with a saved key (e.g. DeepSeek over Kimi) → after an editing turn the
    VerifyCard shows "reviewed by <model>"; remove the reviewer's key → notice appears
    and the review falls back to the primary model (no crash, no silent skip); reviewer
    settings survive a pane reload. When the reviewer CALL fails (bad base URL), the
    pass card must NOT carry a "reviewed by" label.
51. **Duplicate pivot name** — create a pivot named "P1", then ask for another pivot
    named "P1" on the same sheet → clean duplicate_pivot error, and the ORIGINAL pivot
    is untouched (still renders, still in manage_pivot list).
52. **Spaced sheet names** — on a sheet named "Q1 Data": a >20k-cell formula_r1c1 fill
    completes (no partial first-row write), and a pivot created from an unqualified
    source range on that sheet resolves correctly (quoted address).
53. **Revert honesty after a rename** — create a pivot on an auto-created sheet, rename
    that sheet via manage_sheet, then revert the pivot-creation step. The pivot's host
    sheet no longer has the recorded name, so the inverse must cleanly no-op (skip) —
    not throw, and not silently claim success while leaving stray state. Repeat for a
    conditional-format / merged-range / row-insert step on a since-renamed sheet.
54. **Pivot restore cleanup parity** — delete a pivot (undo-capturable, i.e. host
    supports 1.15 source read-back), rename one of its source fields, then revert the
    delete. The restore-from-config recreate fails on the renamed field; verify no
    orphan half-built pivot is left on the destination sheet (matches manage_pivot
    create's own failure cleanup).
55. **Totals-row audit** — manage_table set_totals on for a table with an error-prone
    column (e.g. text where a sum is expected) → the turn-end audit/verifier must see
    and flag the new totals-row error, not silently skip it.
