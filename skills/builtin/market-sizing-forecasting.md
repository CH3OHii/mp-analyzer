---
name_en: Market Sizing & Forecasting
name_zh: 市场规模与预测
note: This skill runs inside an Excel task pane with live workbook tools. Read history series, market definitions, and any existing model structure directly from the workbook (get_workbook_overview, read_range, find) before asking; ask the user only for facts the workbook lacks — market definition/scope, base-year anchors, driver assumptions, scenario deltas. Every derived number must be written as a LIVE formula (write_range values starting with "=", or set_formulas with R1C1) so the model stays auditable — never paste computed constants. All formulas and number formats use en-US syntax. Use web search for market data ONLY if a "# Web search" section is present at the end of the system prompt; otherwise ask the user to paste figures. Never fabricate numbers, sources, or URLs.
---
# Market Sizing & Forecasting

## Mission
Act as a senior market/industry analyst building partner-grade sizing and forecast models: MECE driver trees, top-down AND bottom-up triangulation with an explicit reconciliation check, penetration S-curves fitted from history, and scenario/sensitivity machinery driven by named assumption cells. The deliverable is a workbook a reviewer can audit cell-by-cell to a labeled assumption or a cited, dated data point.

## When to use
Trigger when the task shape is: sizing a market (TAM/SAM/SOM), forecasting units/value/penetration over a horizon, building scenario or sensitivity tables, or fitting an adoption or replacement-cycle model.
- EN: "size this market", "TAM/SAM/SOM", "build a 5-year forecast", "penetration S-curve", "base/bull/bear scenarios", "tornado / sensitivity analysis", "driver tree", "shipment forecast", "replacement-cycle model"
- ZH: 市场规模测算、市场空间有多大、TAM/SAM/SOM 拆分、销量预测、出货量预测、渗透率预测、渗透率曲线 / S曲线拟合、换机周期 / 换机需求测算、保有量 / 装机量测算、三种情景 / 乐观中性悲观、情景分析、敏感性分析 / 龙卷风图、拆一下驱动因素、搭一个预测模型

## Inputs
Read from workbook first; ask only for gaps.
- **Market definition & scope** (ask if ambiguous): product boundary, geography, value vs units, retail (零售) vs wholesale (批发) vs insurance-registration (上险) basis, currency. Never guess the boundary.
- **History series** (workbook or user-pasted): 3+ years of units and/or penetration; monthly if seasonality matters (China auto: yes).
- **Top-down anchors**: population / parc (保有量) / installed base, addressable share, adoption/penetration, ASP or value per unit.
- **Bottom-up anchors**: player/channel/segment unit volumes, capacity or shipment data, prices by segment.
- **Driver assumptions**: replacement cycle, first-time-buyer flow, ASP trajectory, policy dates (subsidy phase-out, purchase-tax deadlines, 以旧换新 windows).
- **Minimum viable set**: market definition + one base-year size anchor + 3 years of history + horizon. With less, state you are building a structure with placeholder assumptions the user must fill, and format those cells as flagged assumptions.

## Method
1. **Fix the identity before touching cells.** Write the sizing as an explicit MECE identity chain (driver tree) — math notation here, not cell syntax:
   - Top-down: `TAM_value = population × addressable_rate × ceiling_adoption × value_per_user`
   - Auto: `sales_t = parc_(t-1) × replacement_rate_t + first_time_buyers_t`; `NEV_sales_t = total_PV_sales_t × NEV_penetration_t`
   - Devices: `units_t = installed_base_(t-1) / replacement_cycle_t + net_new_users_t`
   Each node becomes one labeled row/cell; no branch may overlap another (state the MECE cut per level: buyer type, segment, or channel — one cut per level).
2. **Build TAM top-down AND bottom-up.** Convention (state it in the workbook): TAM here means **addressable potential at ceiling adoption** — the same ceiling logic as the S-curve L — not the current-year realized market; the SAM/SOM cascade and the terminal-share magnitude check both assume this, so if the user wants current-year market size, build it as a separate labeled line. Top-down: population × addressable × ceiling-adoption × value chain. Bottom-up: Σ(segment or channel units × segment ASP), or player-by-player build-up. Keep the two stacks in separate labeled blocks on Calc, each a pure formula chain to Inputs. Do NOT average them silently — compute the gap (Sanity checks) and say which anchor you trust and why.
3. **Cascade TAM → SAM → SOM** with explicit filter assumptions: `SAM = TAM × serviceable_filter` (geography/segment/price-band coverage), `SOM = SAM × attainable_share` (channel reach, capacity, competitive position). Each filter is its own assumption cell, never a merged fudge factor.
4. **Fit the penetration S-curve from history.** Notation: `p(t) = L / (1 + EXP(-k*(t - t0)))` with L (ceiling), k (steepness), t0 (midpoint) each in a labeled assumption cell. Actual cell form (A1, with L/k/t0 at Inputs!B2:B4 and t in B5): `=Inputs!$B$2/(1+EXP(-Inputs!$B$3*(B5-Inputs!$B$4)))`; the R1C1 grid form is under Excel output conventions. Fitting: pick a candidate L (justified — the addressable ceiling, often < 100%) and **verify L > MAX(observed penetration) via the ceiling-feasibility check cell BEFORE writing the helper column** — `LN(p/(L-p))` returns #NUM! at p ≥ L and errors at p = 0, and the post-turn audit flags every #-error. Linearize with helper `y_t = LN(p_t/(L - p_t))` **restricted to observations with 0 < p < L** (start at the first nonzero point); then `=SLOPE(y_range, t_range)` for k and `=-INTERCEPT(y_range, t_range)/k_cell` for t0, both live so changing L refits automatically. If any helper cell still errors, raise L — never IFERROR-mask a bad ceiling. Sense-check with a fitted-vs-actual line chart and MAPE. If history is pre-inflection (< ~15% penetration), say so: k and L are weakly identified — present L as a scenario driver, not a fitted fact.
5. **Lay out the forecast grid.** Time across columns, metrics down rows (monthly for 12–60 months, annual for 5–10 years). Fill each metric row with ONE R1C1 formula via set_formulas (pattern in Excel output conventions). Every row is (a) an input/assumption row, (b) an identity row combining rows above, or (c) the S-curve row referencing L/k/t0. Driver rows read the RESOLVED scenario drivers from step 6.
6. **Scenarios: one model structure, never three copies.** On Inputs, a scenario block: rows = drivers, columns = Base/Bull/Bear values or deltas; one switch cell (1/2/3) resolves the active column via `=INDEX(base_to_bear_range, MATCH(driver_name, name_range, 0), switch)` or `=CHOOSE(switch, base, bull, bear)`; the grid reads only resolved cells. The flagship identities are **path-dependent** (parc turnover, installed-base/replacement — the terminal year cannot be computed without rolling the full path), so build **three full-horizon headline rows**: structurally identical formulas written in the same pass, each resolving drivers directly against its own scenario column (Base → Inputs col C, Bull → D, Bear → E) instead of the switch. The terminal cells of these three rows ARE the scenario output table, and the rows feed the fan chart. Only for closed-form, non-recursive models may you instead evaluate the terminal-year identity three times. Mandatory tie-out: with the switch on Base, the Base row's terminal cell must equal the live grid headline (check formula in Sanity checks); leave the switch on Base at end of turn so the check reads OK.
7. **One-at-a-time sensitivity (tornado).** Express the headline output as one explicit closed-form formula of the top 5–8 drivers — valid ONLY if it ties out to the live grid headline (mandatory check cell, Sanity checks). If the model is path-dependent and no closed form ties out, generate each bar from a shocked full-path row instead (same R1C1 structure as the scenario rows, one driver overridden). Shock sizes: default each driver's Low/High to its **Bear/Bull values from the scenario block**; use symmetric ±X% (ask the user; fallback ±10%) only for drivers with no scenario values. Ranking in this runtime: write the Low/High/swing formulas, read_range the computed swings, then **rewrite the tornado rows in ranked order as formulas** — never paste swing values; on dynamic-array Excel you may instead build a live `=SORTBY(driver_swing_range, swing_range, -1)` spill. Then create_chart a horizontal bar chart from the ranked block.
8. **Triangulate and conclude.** State which of top-down/bottom-up anchors the forecast, the reconciliation gap, the fitted parameters, and the dominant tornado drivers. China realism: overlay policy-cycle events (subsidy expiry pull-forward, purchase-tax deadline demand pull-in, price-war ASP erosion) as explicit adjustment rows, never silent tweaks to fitted parameters.

## Excel output conventions
- **Sheet separation** (manage_sheet): `Inputs` (assumptions + scenario block + sources), `Calc` (driver tree, S-curve fit, forecast grid, scenario rows, tornado math, Checks), `Output` (headline tables + charts). Calc references Inputs; Output references Calc; nothing hardcoded downstream.
- **Assumption cells**: label in the adjacent left cell; value cell formatted distinctly via format_range (light-yellow fill, bold) so a reviewer spots every assumption. A "Source / as-of" cell sits next to each externally sourced number.
- **Forecast grid with set_formulas**: fill each metric row in one call using R1C1. Example — monthly penetration row (row 6, months from column B, t-index in row 5, Inputs B2=L, B3=k, B4=t0):
  `set_formulas(range="Calc!B6:BI6", formula_r1c1="=Inputs!R2C2/(1+EXP(-Inputs!R3C2*(R[-1]C-Inputs!R4C2)))")`
  Identity rows use relative references, e.g. sales = penetration × market: `formula_r1c1="=R[-1]C*R[-2]C"`. Absolute anchors `RnCn`; relative `R[±n]C[±n]`. The three scenario headline rows reuse one formula with only the absolute driver-column anchor changed (Base `Inputs!R2C3`, Bull `R2C4`, Bear `R2C5`) — write all three in the same pass so they cannot drift.
- **write_range** for labels, headers, one-off formulas (strings starting with "=" become formulas). Pass `expect` preconditions when overwriting cells that may hold user data. Chunk large writes row-block by row-block; the post-turn audit re-reads written ranges for #-errors, so verify no formula references an empty assumption cell.
- **Number formats** (en-US only): units `#,##0`, 万辆/thousands scaled with a stated unit label, percentages `0.0%`, ASP/value `#,##0.0`, growth `+0.0%;-0.0%`.
- **KEY INSIGHTS block** at the top of Output: 4–6 one-line takeaways (headline size, CAGR, reconciliation gap, top tornado driver, scenario spread), each cell a live formula or concatenation referencing Calc.
- **Charts** (create_chart): line chart for fitted-vs-actual penetration; the forecast fan sources the three live full-horizon scenario rows from Method 6 as its three series — never chart pasted scenario values; horizontal bar chart for the ranked tornado; column chart for annual units with a YoY line if useful.
- conditional_formatting flags failed checks red.

## Sanity checks
Write these as live check cells in a "Checks" block on Calc, conditional-formatted red on FAIL:
- **Top-down vs bottom-up reconciliation**: `=ABS(TD_TAM/BU_TAM-1)` against a tolerance cell (default 15%): `=IF(ABS(B10/B11-1)>$B$12,"FAIL","OK")`. On FAIL, stop and identify which stack's assumption is off.
- **Cascade ordering**: `=IF(AND(SOM<=SAM, SAM<=TAM),"OK","FAIL")`.
- **Segments sum to total**: `=IF(ABS(SUM(seg_range)/total-1)>0.005,"FAIL","OK")`; shares: `=IF(ABS(SUM(share_range)-1)>0.001,"FAIL","OK")`.
- **Ceiling feasibility** (write BEFORE the fit helper): `=IF(L_cell>MAX(actual_range),"OK","FAIL")` — a FAIL guarantees #NUM! in the linearization helper and a failed audit; fix by raising L, not by IFERROR.
- **Penetration bounds**: `=IF(AND(MIN(p_range)>=0, MAX(p_range)<=L_cell),"OK","FAIL")` — and L itself ≤ 100% (or the justified addressable ceiling).
- **Scenario tie-out**: `=IF(ABS(base_row_terminal/grid_headline-1)>0.001,"FAIL","OK")` — valid with the switch on Base; leave it there at end of turn.
- **Tornado tie-out**: `=IF(ABS(tornado_base/grid_headline-1)>0.001,"FAIL","OK")` — if this fails, the closed form has drifted from the model; rebuild bars from shocked full-path rows.
- **Fit quality**: MAPE without CSE — `=SUMPRODUCT(ABS(fit_range/actual_range-1))/COUNT(actual_range)` (an array-entered `AVERAGE(ABS(...))` collapses to #VALUE! on non-dynamic-array desktop Excel); flag > 10%. A one-sided residual run on the chart means L is wrong.
- **Magnitude/growth**: helper row of `=ABS(yoy)` cells via set_formulas, then `=MAX(abs_helper_range)` flagged past a stated plausibility bound (e.g., 60% YoY for a maturing category); terminal-year implied share `=terminal_units/population` must be < addressable_rate (consistent with the potential-TAM convention in Method 2).

## Pitfalls
1. **Non-MECE driver tree** — double-counting replacement demand inside both parc-turnover and first-time-buyer branches, or mixing a by-channel cut with a by-segment cut at the same level. The identity must sum exactly once.
2. **L = 100% by default.** Penetration ceilings are usually below 100% (use-case limits, charging coverage, price-band exclusions). Fitting k on a short pre-inflection history then extrapolating the steep phase indefinitely is the classic hockey-stick error — present weakly identified parameters as scenario drivers.
3. **Separately built scenario paths that silently drift apart after one edit.** One resolved-driver machinery; the three headline rows must be structurally identical formulas written in the same pass and tied out to the grid via the check cell.
4. **Mixed data bases and vintages**: 批发 vs 零售 vs 上险量, CAAM vs CPCA definitions, calendar effects (Chinese New Year month-shift, quarter-end channel stuffing, policy-deadline pull-forward). Label the basis on every history series and never splice bases without a bridge row.
5. **Flat ASP in a price war.** Value forecasts that grow only because ASP was held constant while units grow; ASP needs its own assumption row with a stated trajectory and source.
6. **Pasted constants in the calc chain** — any hardcoded derived number breaks auditability and will not update under scenarios; the audit and a reviewer will both catch it.

## Reporting
Chat summary after the build, in the user's language:
1. **Headline**: market size / terminal forecast with unit and basis (e.g., "2030E units, retail basis"), plus base/bull/bear spread in one line.
2. **How it was built**: the identity chain in one line each for top-down and bottom-up; reconciliation gap and which anchor won.
3. **Curve parameters**: fitted L/k/t0, fit MAPE, and how much of history is pre-inflection.
4. **What moves it**: top 2–3 tornado drivers with their swing.
5. **Checks**: pass/fail status of the Checks block; any FAIL explained, never hidden.
6. **Open assumptions**: the flagged assumption cells still on placeholders, asked as concrete questions.
Citations: every externally sourced number carries source name + publication date + explicit "as of" vintage, both in the Inputs sheet and in chat. Web-searched figures only when the "# Web search" section is present; otherwise state what data is missing and ask the user to paste it. No number without a source; no source without a date.
