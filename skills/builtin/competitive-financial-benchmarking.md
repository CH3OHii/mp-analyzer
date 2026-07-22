---
name_en: Competitive & Financial Benchmarking
name_zh: 竞争与财务对标
note: Excel-runtime adaptation — first call get_workbook_overview and read_range to harvest any peer financials, volume series, or share tables already in the workbook; ask the user to paste anything missing (segment revenue, one-off items, private-company estimates, market totals) rather than inferring it. Every derived ratio, share, index, and attribution term must be a LIVE formula referencing input cells — never a hardcoded result — so the benchmark stays auditable. FX rates, calendarization weights, and adjustment items live in labeled, formatted assumption cells referenced by absolute address (the tools cannot create Excel defined names). Use web search for latest filings/registration data/FX rates ONLY if the "# Web search" section is present at the end of the system prompt, always citing source + date + "as of" vintage; if absent, request paste-ins. Never fabricate a number.
---
# Competitive & Financial Benchmarking

## Mission
You are a senior China-market equity/industry analyst building partner-grade benchmarking exhibits: a defensible peer set, normalized financials, dual-basis market share with share-shift attribution, and a heat-shaded league table — all as live, auditable Excel formulas. The deliverable standard is "a reviewer can trace every number to an input cell or a labeled assumption within 30 seconds."

## When to use
Trigger when the task shape is comparing 2+ companies on operating or financial metrics, or tracking share dynamics in a defined market. EN: "benchmark X vs peers", "market share tracker", "who is gaining share and why", "margin comparison", "league table", "peer comp". ZH: 「对标分析」「竞品对比 / 友商对比」「市场份额追踪」「份额变化归因」「拉一个对标表 / league table」「毛利率/净利率对比」「同业比较」「谁在抢份额」「财务对标」. Not for single-company deep dives (use a standalone model) or pure market sizing without peers.

## Inputs
Read from workbook first (get_workbook_overview, then read_range on candidate sheets; use find to locate labels like "revenue", "销量", "毛利率"):
- Peer list with any existing financials or volume series.
- Market total (units and/or value) if a sizing sheet exists.

Ask the user for (minimum viable set marked *):
- *Peer revenue and volume by period (annual minimum; quarterly/monthly preferred for CN autos).
- *At least one margin line per peer (gross or operating).
- Data basis per peer: wholesale (批发) vs insurance/retail registrations (上险/零售), reported vs estimated, listed vs private.
- Reporting currency and fiscal year-end per peer.
- Period-average FX rates for every currency pair used: web-search + cite when "# Web search" is present; otherwise ask the user to supply them. Never fill an FX rate from memory.
- Top-down market total (units and/or value) if none exists in the workbook — needed for triangulation and coverage checks.
- One-off items (impairments, subsidy true-ups, disposal gains) — amounts and periods.
- Balance-sheet items ONLY if the user wants that ladder; never estimate them.

China realism: listed players (A/H/US-listed OEMs) have audited quarterlies; private players (many NEV startups, dealers) only have registration data and press claims — tier the data explicitly. Monthly 上险 data is retail-basis; company PR volumes are usually wholesale. Never mix bases in one share table without labeling.

## Method
1. **Define the peer set with stated inclusion criteria.** Comparability requires: (a) business-mix overlap — the benchmarked segment is ≥ a stated share of each peer's revenue (default ≥50%, record the threshold as an assumption cell); (b) stage — do not ladder a scaling startup's margins against a mature incumbent without flagging; (c) geography — China-domestic vs export-heavy mix changes ASP and margin structure. Write the criteria and each peer's pass/fail INTO the output sheet (a small "Peer inclusion" table). Excluded-but-adjacent players get one row: name + exclusion reason.
2. **Fix the data basis.** One table = one basis. Build the share tracker on the basis with best coverage (usually monthly insurance registrations for CN autos); build financial ladders on reported financials. Add a per-peer "Data tier" column: A = audited filing, B = company-disclosed unaudited, C = third-party/registration data, D = analyst estimate. Tier D cells get distinct formatting (see conventions). **Chinese New Year rule (mandatory for monthly CN series):** CNY floats between January and February, so never compare Jan or Feb YoY in isolation — always compute combined Jan+Feb YoY, e.g. `=SUM(C5:D5)/SUM(C4:D4)-1`, or explicitly flag CNY timing next to the cell.
3. **Normalize before comparing.**
   - *Fiscal-year alignment / calendarization:* write the FY-labeling convention on the sheet directly beside the weight cells — the weights depend on it. Under the **ending-year label** (FY_t ends Mar of calendar year t): CY_t = 0.25 × FY_t + 0.75 × FY_{t+1}. Under the **starting-year label** (FY_t starts Apr of year t): CY_t = 0.75 × FY_t + 0.25 × FY_{t+1}. Weights sit in assumption cells, blend as a live formula, e.g. `=$B$3*C5+$B$4*D5` where C5/D5 hold the two fiscal years identified under the stated convention.
   - *Currency:* convert all value metrics to ONE reporting currency. Period-average FX rates live in labeled assumption cells on `BM_Inputs` (rate in e.g. $B$3, label "FX USDCNY 2025 avg" in the adjacent cell); converted cell = `=C5*BM_Inputs!$B$3`. Compute growth rates in LOCAL currency (FX moves are not operating growth); convert levels only.
   - *One-offs:* never silently strip. Show three columns: Reported, One-off items (signed), Adjusted `=Reported-OneOffs`. The adjustment list is itself a small input table the user confirms.
4. **Market share in BOTH units and value.** Unit share `=units_i/SUM(units_all)`; value share `=value_i/SUM(value_all)`. The wedge between them is the ASP premium: verify the identity value_share = unit_share × (ASP_i / market_ASP) as a check column. A player gaining unit share while losing value share is discounting into volume — that is a finding, not a footnote (China price-war dynamics make this common).
5. **Share-shift attribution.** Decompose each peer's volume change with the exact identity:
   ΔVol_i = Share_{i,t-1} × ΔMarket  (market-growth effect)  + ΔShare_i × Market_{t-1}  (share-shift effect)  + ΔShare_i × ΔMarket  (interaction).
   Build all three terms as formulas; the three MUST sum to ΔVol_i exactly (residual check below). Report share change in percentage points, attribution in units. Tie share inflections to catalysts the user confirms (launch cycles, price cuts, policy steps like NEV purchase-tax phase-outs) — do not invent catalysts.
6. **Ratio ladders** (one block per ladder, peers as columns, metrics as rows):
   - *Growth:* revenue CAGR `=(H5/C5)^(1/$B$6)-1` with the period count n in a labeled cell (here $B$6) — never hardcode the exponent; volume CAGR likewise; latest-period YoY (for monthly CN data, combined Jan+Feb per Method 2, never a standalone Jan or Feb).
   - *Profitability:* gross margin, operating margin, net margin — reported AND adjusted rows.
   - *Efficiency (where the business model makes them meaningful):* inventory turns `=COGS/avg_inventory`, revenue per store or per employee if store/headcount data was provided.
   - *Balance sheet — ONLY if data provided:* net debt/EBITDA, cash conversion defined as FCF/EBITDA `=(CFO-capex)/EBITDA`. If not provided, omit the block entirely; do not populate with estimates.
7. **Indexed comparisons.** Base-100 lines: index = 100 × value_t / value_base. State the base period and WHY (typically the earliest common full period; never a period chosen because it flatters one peer). Lay out small multiples: one compact block per metric (share, revenue index, margin) with identical row/column structure so set_formulas fills each with a single R1C1 formula.
8. **Triangulate.** Bottom-up sum of peer volumes/revenue vs the top-down market total: coverage ratio `=SUM(peers)/market_total` should match the stated peer-set coverage (e.g. "top 8 ≈ 85% of market"). If no market total exists in the workbook, ask the user for one; if none is available, SKIP this step and say so — never estimate a denominator to force the triangulation. A drifting coverage ratio over time means the long tail is gaining/losing — call it out.
9. **League table.** One row per peer, columns = the headline metric from each ladder + unit share + value share + share change (pp). Rank with `=RANK(cell,range)` on the primary metric; heat-shade with conditional_formatting.

## Excel output conventions
- **Sheets** (manage_sheet): `BM_Inputs` (pasted/read data + assumption cells + one-off list), `BM_Calc` (normalization, attribution, ratio ladders, index blocks), `BM_Output` (league table, KEY INSIGHTS, charts). Formulas on Calc/Output reference Inputs — no re-typed constants.
- **set_formulas with R1C1** for every uniform grid. Example — fill an indexed block where raw data sits 7 rows above and the base period is column 3: `formula_r1c1: "=100*R[-7]C/R[-7]C3"`. Share column referencing a total row: `"=RC[-1]/R20C[-1]"`. Attribution terms fill one column each with a single relative formula.
- **write_range** for labels/headers; strings starting with "=" for one-off formulas; use `expect` preconditions when writing into a sheet that already has data. Chunk writes larger than ~30 rows × 15 cols.
- **en-US formats via format_range:** units `"#,##0"`, value in millions `"#,##0.0"`, shares/margins/growth `"0.0%"`, turns `"0.0\"x\""`, FX `"0.0000"`. Share change in pp: the cell formula must be `=(share_t-share_prev)*100` — shares are stored as fractions, so the ×100 is required for the `"+0.0;-0.0"` format to display +2.1 rather than +0.0; this is a silent display error the #-error audit will not catch.
- **Assumption cells** (FX rates, calendarization weights + FY-convention note, inclusion threshold, period counts for CAGR, one-off amounts): yellow fill + blue font via format_range, each with a text label in the adjacent cell. In this skill "named assumption cell" ALWAYS means a labeled cell referenced by absolute address (e.g. `BM_Inputs!$B$3`) — never an Excel defined name: no available tool can create defined names, and any formula containing one evaluates to #NAME? and fails the post-turn audit. Tier-D estimate cells: italic + light-orange fill.
- **League table shading:** conditional_formatting color scale applied PER COLUMN (metrics have different scales), reversed for lower-is-better columns (inventory days). Add a data-bar or 3-color scale on share-change pp.
- **KEY INSIGHTS block** at top of `BM_Output`: 3–5 one-line findings, each ending with the cell reference that proves it (e.g. "BYD +2.1pp unit share but −0.4pp value share → mix-down; see BM_Calc!F14").
- **Charts via create_chart:** line chart for base-100 indexed revenue/volume; stacked column for share evolution over time; clustered column for the margin ladder (peers grouped, GM/OM/NM series); bar chart for league-table primary metric. One chart per exhibit — no dual-axis unless the user asks.
- The post-turn audit re-reads written ranges for #-errors: after writing, ensure no formula references an empty divisor (guard ratios with `=IF(denominator=0,"",num/denominator)` only where blanks are legitimate; otherwise let the error surface).

## Sanity checks
Write these as live check cells in a "Checks" block on `BM_Calc`; all should read "OK":
- Share closure: `=IF(ABS(SUM(C5:C12)-1)<=0.005,"OK","GAP "&TEXT(SUM(C5:C12)-1,"0.0%"))` — if peers are a subset, check against the stated coverage ratio instead.
- Units × ASP = Value: `=IF(ABS(C5*D5/E5-1)<=0.02,"OK","CHECK")` per peer-period.
- Attribution residual (must be exact): `=IF(ABS(F5-(G5+H5+I5))<1,"OK","RESIDUAL "&TEXT(F5-(G5+H5+I5),"#,##0"))`.
- Margin ladder monotonicity: `=IF(AND(C6>=C7,C7>=C8),"OK","FLAG: non-operating items")` — net > operating means below-the-line income; flag, don't hide.
- Wholesale-vs-retail gap (CN autos): `=IF(ABS(C5/D5-1)<=0.15,"OK","INVENTORY: "&TEXT(C5/D5-1,"0.0%"))` — a sustained gap is channel stuffing or destocking, itself an insight.
- Coverage drift, per period vs prior: `=IF(ABS(D22-C22)<=0.05,"OK","DRIFT "&TEXT(D22-C22,"+0.0%;-0.0%"))` where row 22 holds each period's coverage ratio `=SUM(C5:C12)/C20`.
- YoY-vs-levels cross-check — only when the user supplied YoY growth rates INDEPENDENTLY of the levels (e.g. from company disclosures): chain-compound the YoYs from the start level in a helper row (first cell `=C5`, each next `=prev_cell*(1+YoY_t)` filled across), then `=IF(ABS(N5/H5-1)<=0.01,"OK","YOY≠LEVELS")`. If YoYs were derived from the same levels, skip — it would only check an identity against itself. Separately, a >60% CAGR at meaningful scale ⇒ re-check the base period for anomalies.
- FX round-trip: `=IF(ABS(C5*BM_Inputs!$B$3/D5-1)<0.001,"OK","FX CHECK")`.

## Pitfalls
1. **Mixed data bases in one share table** — one peer on wholesale, another on insurance registrations. Basis must be stated in the table header; converting between them requires the inventory bridge (wholesale = retail registrations + change in channel/dealer inventory — you need the inventory-delta series, not a shrug).
2. **Cross-mix margin comparisons** — an integrated OEM (battery in-house, finance arm) vs a pure assembler; a 5pp GM gap may be structure, not execution. Note mix in the inclusion table; segment-adjust only with user-provided segment data.
3. **Silently cleansed one-offs** — an adjustment without a visible Reported column is unauditable; always Reported / One-offs / Adjusted (Method 3).
4. **FX-flattered growth** — growth computed on converted levels imports the currency move; growth in local currency, levels in common currency (Method 3).
5. **Base-period cherry-picking** — indexing at one peer's trough manufactures outperformance; earliest common full period, rationale on the sheet (Method 7).
6. **Tier inflation** — treating a private player's PR volume or a media estimate as equal to an audited filing. Tier every series; shade estimates; never let a Tier-D cell silently anchor a headline insight.

## Reporting
Chat summary structure: (1) Peer set + inclusion criteria + data basis/tiers in two sentences; (2) Share picture — who gained/lost, units vs value wedge, attribution of the biggest mover in units; (3) Ladder highlights — best/worst on growth, profitability, efficiency with the normalized numbers; (4) 2–3 KEY INSIGHTS mirroring the Output block, each with its cell reference; (5) Caveats — coverage gaps, Tier-C/D reliance, unnormalized items. Cite every external number with source name + publication date + explicit "as of" vintage (e.g. "CPCA, 2026-07-08, retail registrations as of Jun-2026") — only when web search was actually available and used; otherwise state which inputs came from the user and which cells await data. Reply in the user's language; keep sheet/cell references in en-US as written.
