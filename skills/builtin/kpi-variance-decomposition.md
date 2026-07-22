---
name_en: KPI Variance Decomposition (Bridge Analysis)
name_zh: KPI差异分解（桥接分析）
note: Excel-runtime adaptation — read the actual segment data from the workbook (get_workbook_overview, then read_range on the identified block, or get_selection if the user pointed at it) instead of asking the user to retype numbers; ask the user only for what the workbook cannot tell you (comparison basis YoY/MoM, segment dimension, currency/unit, data vintage such as wholesale vs retail). Every derived cell — effects, cumulative bars, contributions, checks — must be a LIVE formula written via set_formulas (R1C1) or write_range strings starting with "=", never pasted constants, so the bridge recomputes when inputs change and survives the post-turn audit. Use web search only if a "# Web search" section is present in this system prompt (cite source + date + "as of" vintage); when absent, ask the user to paste external figures. Never fabricate numbers or URLs.
---
# KPI Variance Decomposition (Bridge Analysis)

## Mission
Act as a senior sell-side/industry analyst who explains *why* a KPI moved, not just that it moved. Deliver a fully auditable Excel bridge — an explicit MECE identity, named conventions, a residual gate plus an independent top-down tie-out, and a waterfall a partner could present unedited.

## When to use
Trigger when the user asks to explain a period-over-period change in an aggregate KPI (revenue, unit sales, gross margin, ASP, GMV) by driver or segment:
- EN: "bridge this", "waterfall the YoY change", "decompose the revenue delta", "price vs volume vs mix", "what drove the drop", "contribution to growth by segment".
- ZH: “桥接分析”、“瀑布图拆解”、“同比/环比差异分解”、“量价拆分”、“价格效应还是销量效应”、“结构（mix）影响”、“各细分对增长的贡献”、“为什么收入下滑，拆一下”。
Do NOT use for single-series forecasting or company-specific diagnostic playbooks the user maintains separately — this skill is KPI-generic (value, units, margin, share); hand off to the user's own domain framework for domain-specific root-causing.

## Inputs
Minimum viable set — a two-period segment panel:
- Segments i = 1..n on one MECE dimension (product line, region, channel, price band).
- Per segment, both periods: quantity Q0, Q1 and either price P0, P1 or revenue Rev0, Rev1 (derive P = Rev/Q; never accept a P that contradicts Rev/Q).
Read from workbook: locate the data with get_workbook_overview + find (headers like "2024", "YoY", segment names), then read_range with include_display to catch percent-vs-decimal formatting traps. Chunk reads if the block is large.
Ask the user: (1) comparison basis — YoY, MoM, or vs plan; (2) which segment dimension if several exist; (3) currency/unit and scale (RMB mn vs bn; units vs '000 units); (4) data lineage/vintage — e.g. for China monthly series, wholesale (批发) vs retail/insurance-registration (上险/零售) numbers differ and must not be mixed across periods.
For margin bridges additionally: gross profit or COGS by segment, both periods. For share bridges: segment market sizes and own volumes, both periods.

## Method
1. **Choose the bridge type.**
   - *Value bridge* (revenue/GMV): both price and quantity move — price wars, mix shift. Full P×Q×mix decomposition (steps 3–6).
   - *Volume bridge* (units): the KPI is a quantity; price is irrelevant. Bridge = segment contributions only (step 7); effects are ΔQᵢ directly.
   - *Share bridge* (market share) and *margin bridge* (GM%): both are weighted averages — use the exact weighted-average decomposition in step 8; report in percentage points (pp), never "%".
2. **Fix the comparison basis.** YoY for structural stories; MoM only with seasonality caveats. China realism: merge Jan+Feb before any YoY on Chinese monthly data (Lunar New Year timing), and flag policy boundaries (subsidy expiry, trade-in program starts) that pull demand across the comparison line — these belong in caveats, not silently in the "volume effect".
3. **Assemble the panel on a Calc sheet — fixed layout.** Anchor block above the panel: B2 (R2C2) = base weighted ASP P̄0 = `=SUM(Rev0 col)/SUM(Q0 col)` — revenue-weighted, never AVERAGE of a price column; B3 (R3C2) = ΣRev0; B4 (R4C2) = ΣRev1, each labeled in column A. Panel headers in row 5, data from row 6: Segment | Q0 | Rev0 | P0 | Q1 | Rev1 | P1 (columns 1–7). Prices are live, guarded, and always numeric — never "" (a text blank propagates #VALUE! into every effect column and fails the post-turn audit):
   - P0 (col 4): `=IF(RC2>0,RC3/RC2,IF(RC5>0,RC6/RC5,0))`
   - P1 (col 7): `=IF(RC5>0,RC6/RC5,IF(RC2>0,RC3/RC2,0))`
   This encodes the **carry convention for entries/exits**: a segment missing in one period inherits its observed-period price, forcing its price effect to zero so entry/exit flows through volume + mix (an entry's premium/discount vs P̄0 lands in mix — the standard treatment). The identity in step 4 closes exactly under any price assigned to a zero-quantity period (that price only reallocates between mix and price bars), so this is a labeling convention, not an approximation. If new/exited business exceeds ~10% of |ΔRev|, subtotal those rows into a dedicated "New/exited" waterfall bar and say so on-sheet.
4. **State the identity and convention — in a labeled cell on the sheet, not just in chat.**
   ΔRev = Volume effect + Mix effect + Price effect + Residual
   Convention used (state it verbatim): **volume at base prices, price at current volumes**:
   - Volume effect = (ΣQ1 − ΣQ0) × P̄0
   - Mix effect = Σᵢ (Q1ᵢ − Q0ᵢ) × (P0ᵢ − P̄0) — growth concentrated in above/below-average-price segments
   - Price effect = Σᵢ (P1ᵢ − P0ᵢ) × Q1ᵢ
   - Residual = ΔRev − (Volume + Mix + Price)
   Under this convention the interaction term ΔP×ΔQ is absorbed into the price effect, and — **be honest about what follows** — when P is derived on-sheet as Rev/Q, Volume + Mix + Price ≡ ΔRev *algebraically*, so the residual is zero by construction (floating-point aside). See step 6 for what the residual can and cannot detect. Alternative Laspeyres convention (Price = ΣΔPᵢ×Q0ᵢ) leaves the interaction ΣΔPᵢΔQᵢ as an explicit term — acceptable, but it must be shown as its own bar, never silently folded; in price-war periods interaction can be material. Whichever convention, name it once and keep it constant across all bridges being compared.
5. **Compute effects as live formulas.** Effect columns 8–11 (Volume_i | Mix_i | Price_i | ΔRev_i), each filled in one set_formulas call with formula_r1c1, assuming the step-3 layout (adjust addresses if the layout differs — the absolute anchor must point at the dedicated P̄0 cell, NOT at any per-segment price cell):
   - Volume_i (col 8): `=(RC5-RC2)*R2C2`
   - Mix_i (col 9): `=(RC5-RC2)*(RC4-R2C2)`
   - Price_i (col 10): `=(RC7-RC4)*RC5`
   - ΔRev_i (col 11): `=RC6-RC3`
   Because step 3 guarantees numeric prices, zero-quantity rows produce numeric zeros here, not propagated errors. Sum each column with =SUM(...).
6. **Residual gate — a formula-integrity check, not a data check.** Gate: if ABS(Residual) > 1% × ABS(ΔRev), stop — do not present. Since the identity closes by construction, a failing residual means the *sheet* is broken: wrong anchor reference, misaligned effect columns, a row dropped from a SUM, or effects pasted as constants. The residual CANNOT detect coverage gaps, stale prices, mixed vintages, or calendar mismatch — those produce internally consistent panels with zero residual and are caught only by the independent top-down tie-out (step 9), which is therefore mandatory, not optional. (The residual regains data-detection power only when P, Q, and Rev are all independently sourced rather than derived; then it flags P≠Rev/Q rows, as does the row-identity sanity check.)
7. **Contribution to growth.** For each segment: Cᵢ = w0ᵢ × gᵢ where w0ᵢ = Rev0ᵢ/ΣRev0 and gᵢ = Rev1ᵢ/Rev0ᵢ − 1; identically Cᵢ = ΔRevᵢ/ΣRev0, so ΣCᵢ = aggregate growth exactly. Column 12: `=RC11/R3C2`. New segments (Rev0ᵢ=0): growth is "n.m." but contribution is still defined as Rev1ᵢ/ΣRev0. Store contributions as decimals formatted "0.0%" (see output conventions); call them pp when speaking.
8. **Weighted-average bridges (margin, share).** Both KPIs have the form X = Σᵢ wᵢxᵢ; use the exact weighted-average bridge — **within/rate at current weights, mix at base rates**:
   ΔX = Σᵢ w1ᵢ·(x1ᵢ − x0ᵢ)  [rate/within effect] + Σᵢ (x0ᵢ − X0)·(w1ᵢ − w0ᵢ)  [mix effect]
   Exact identity: the anchor X0 cancels in the total because Σᵢ Δwᵢ = 0, but centering makes each segment's mix contribution readable. State this convention on-sheet exactly as step 4 does.
   - *Margin bridge*: wᵗᵢ = Revᵗᵢ/ΣRevᵗ (revenue weight), xᵗᵢ = gmᵗᵢ = GPᵗᵢ/Revᵗᵢ (segment GM%), X0 = GM0 = ΣGP0/ΣRev0. ΔGM% = Σ w1ᵢ·Δgmᵢ + Σ (gm0ᵢ−GM0)·Δwᵢ. The revenue-denominator movement is inside the weights — no separate denominator term, and never "bridge gross profit then divide" (that is not an identity for ΔGM% under any divisor). To split the rate effect into price vs cost, run a separate P×Q value bridge on gross profit, presented as a GP bridge, clearly labeled as such.
   - *Share bridge*: wᵗᵢ = segment i market size ÷ total market size in period t, xᵗᵢ = sᵗᵢ = own volume in segment i ÷ segment i market size, X0 = S0 = aggregate base share. ΔS = Σ w1ᵢ·Δsᵢ (within-segment share) + Σ (s0ᵢ−S0)·Δwᵢ (market-mix).
   All bars in pp (stored as decimals, formatted "0.0%").
9. **Triangulate top-down — the real data-integrity gate.** Bottom-up Σ segment Rev must tie to an independent top-down total (reported total, or ASP×units) for BOTH periods, tolerance ≤0.5%. On failure, work the checklist: (a) segment coverage gaps ("Other" missing or double-counted), (b) P ≠ Rev/Q somewhere (pasted stale prices), (c) mixed data vintages or currencies across periods, (d) calendar mismatch. If a fresh external total is needed and the "# Web search" section is present, search and cite it with source + date + "as of"; otherwise ask the user to paste it.
10. **Build the waterfall and insights** per the conventions below; write large blocks in chunks.

## Excel output conventions
- **Three-sheet separation** (manage_sheet to create): `Inputs` — raw panel + assumption cells only; `Calc` — effects, contributions, checks, waterfall helper table; `Output` — waterfall chart, bridge summary table, KEY INSIGHTS block. Output references Calc by formula; nothing on Output is hand-typed data.
- **Formulas, not constants.** Every derived value is a formula (write_range strings beginning with "=" or set_formulas R1C1). Use expect preconditions on write_range when overwriting cells previously read, so stale-sheet races fail loudly.
- **en-US everything**: English function names; "#,##0.0" for values (state unit in the header, e.g. "RMB bn"); "0.0%" for growth rates. Contributions and all percentage-point quantities (margin/share bars) are **stored as decimals and formatted "0.0%"** — one storage convention everywhere, so check formulas compare like with like; label columns "(pp)" and say pp in text.
- **Assumption cells**: anything the user supplied verbally (tolerance, FX rate, entry/exit bar threshold) goes in a dedicated Inputs block, format_range with light-yellow fill (#FFF2CC) + bold, labeled "ASSUMPTION". The convention statement cell (steps 4/8) sits at the top of Output.
- **Waterfall via stacked floating columns** (create_chart has no native waterfall): build a helper table on Calc — rows: Start (period-0 total), Volume, Mix, Price, [Interaction if Laspeyres], [New/exited if split out], End (period-1 total); columns: Label | Base | Visible. Formulas: cumₖ = Start + running SUM of effects; Base = MIN(cumₖ₋₁, cumₖ) for effect bars, 0 for Start/End; Visible = ABS(effect), or the total for Start/End — all live. create_chart a **stacked column** on Label/Base/Visible. Then make the Base series invisible (no fill); if the chart tooling cannot clear a series fill, tell the user the one manual click required (select Base series → Fill → No Fill) in the chat summary. Optional: conditional_formatting on the helper's effect column (green ≥0, red <0) so the table itself reads as a mini-bridge.
- **Second chart**: contribution-to-growth as a sorted bar chart (create_chart, clustered bar) — segments descending by Cᵢ.
- **KEY INSIGHTS block** on Output: 3–5 one-line takeaways in the user's language, each tied to a number on the sheet. Causal attributions (a discounting round, a launch, a policy change) may be asserted ONLY if the event comes from the workbook, the user, or a web search result cited this session; otherwise phrase as a hypothesis to confirm — e.g. "Price effect −X, ~Y% of the decline — pattern consistent with a discounting round; can you confirm timing?" format_range with a border + bold header "KEY INSIGHTS / 核心结论".

## Sanity checks
Write these as live flag cells on Calc; the post-turn audit re-reads written ranges, so none may error. **The angle-bracketed identifiers below are placeholders, not defined names — this runtime has no name-manager tool, and writing them literally yields #NAME? and a failed audit. Substitute the actual A1/R1C1 addresses from the layout you built (e.g. residual cell, B3 for ΣRev0) before every write.**
- Bridge closes: `=IF(ABS(<ResidualCell>)<=0.01*MAX(ABS(<DeltaTotalCell>),1E-9),"OK","RE-EXAMINE")`
- Waterfall end-bar tie-out: `=ROUND(<EndBarCell>-<Total1Cell>,6)=0` must be TRUE.
- Contributions sum to growth (both sides stored as decimals per the storage convention): `=ABS(SUM(<ContribRange>)-<GrowthCell>)<=0.0005`
- Price identity holds row-by-row: `=SUMPRODUCT(--(ABS(<P0Range>*<Q0Range>-<Rev0Range>)>0.005*ABS(<Rev0Range>)))=0` (repeat for period 1; carried prices on zero-quantity rows pass trivially since Q and Rev are both 0).
- Coverage tie-out: `=ABS(SUM(<Rev1Range>)-<ReportedTotal1Cell>)<=0.005*<ReportedTotal1Cell>` when an independent total exists — this, not the residual, is the data-integrity check.
- Magnitude smell test (judgment, in chat): implied aggregate price move = PriceEffect/Rev0 — a double-digit one-quarter ASP swing needs a verifiable explanation or it's probably a data artifact.

## Pitfalls
1. **Simple-average ASP.** Using AVERAGE(prices) instead of ΣRev/ΣQ corrupts the mix effect — mix is *defined* against the weighted ASP. Equally: anchoring the mix formula on a per-segment price cell instead of the dedicated P̄0 cell gives a silently wrong bridge that still passes the #-error audit.
2. **Convention drift.** Comparing this quarter's bridge (price at Q1) with last quarter's (price at Q0) makes trends in "price effect" meaningless. Convention is stated on-sheet and held constant.
3. **Silent interaction.** Under Laspeyres, ΔP×ΔQ can rival the price effect in a volume-boom-plus-discounting period; folding it invisibly into another bar is how bridges lie.
4. **Non-MECE segments.** Overlapping segments or a shrinking "Other" bucket double-count or leak — and the residual will NOT catch it, because the identity closes on whatever panel it is fed. Only the top-down tie-out against an independent total (step 9) catches it; that is why step 9 is mandatory.
5. **pp vs % confusion.** Margin and share bridges are in percentage points; "margin fell 2%" and "fell 2pp" differ by an order of magnitude at 10% margin. And "bridge GP then divide by revenue" is not a margin bridge — use the weighted-average identity of step 8.
6. **Calendar and vintage traps (China data rhythm).** Jan/Feb YoY without CNY merging, mixing wholesale with insurance-registration series across periods, or bridging across a subsidy deadline and attributing the pull-forward to "volume" — all produce clean-looking, wrong bridges.

## Reporting
Chat summary, in the user's language, in this order:
1. **Headline**: ΔKPI, direction, and the single dominant driver with its share of the move ("收入同比下滑X，其中约Y%来自价格效应").
2. **Bridge table**: effect | value | % of Δ, plus gate status ("residual 0.0% — formulas intact; bottom-up ties to reported total within 0.2%").
3. **Top 3 segment contributions** in pp.
4. **Convention + caveats**: state the convention used (including entry/exit carry handling if any segment was new or discontinued), data vintage ("wholesale, as of <date>"), calendar adjustments, and any assumption cells the conclusion is sensitive to.
5. **Pointers**: name the sheets/ranges written and the one manual step if the waterfall base series needs its fill cleared.
Citation rules: every externally sourced **number, and every external fact, event, or date** (policy change, model launch, price cut, subsidy deadline) carries source name + publication date + explicit "as of" vintage, and only when it came from the user, the workbook, or web search results actually returned this session. Anything else is presented as a hypothesis for the user to confirm — never asserted from memory. If a number is not in the workbook, not user-supplied, and not searchable right now — say so and ask; never invent it.
