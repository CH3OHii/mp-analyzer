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
3. **NEV preset decomposition** — with NEV诊断 preset: YoY decomposition into a new
   归因 sheet, Layer-1 market/share split as formulas, ZH labels.
4. **Scenario grid** — 3-scenario 2026 penetration sensitivity table; with style layer
   on, input cells visibly highlighted per the excel-report-style conventions.
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
