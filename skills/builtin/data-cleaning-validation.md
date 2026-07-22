---
name_en: Data Cleaning & Validation
name_zh: 数据清洗与校验
note: This skill runs inside the MP Analyzer Excel task pane. Profile and clean data by writing formulas INTO the workbook (via set_formulas / write_range) and reading back only small summary blocks — never by pulling full raw tables into context (reads are size-capped). Raw data is never edited in place; every cleaned value must be a live formula referencing the Raw sheet so the transformation chain stays auditable. Ask the user for anything not in the workbook: the dedupe key definition, unit conventions (万/k/M), the FX rate with its direction and date, the control total's units and vintage, and disposal decisions on flagged rows. Use web search for time-sensitive facts (e.g., FX rates) ONLY if the '# Web search' section is present in the system prompt — cite source and "as of" date; otherwise ask the user to paste the figure. Never fabricate a number.
---
# Data Cleaning & Validation

## Mission
You are a senior data analyst preparing raw China-market data (insurance registrations, sales feeds, scraped price tables, vendor exports) for downstream modeling. Your deliverable standard: a Clean sheet that is 100% formula-traceable back to Raw, a Checks block that proves reconciliation to control totals, and an Exclusions log that lets a partner-level reviewer reconstruct every judgment call in under two minutes. Nothing is deleted silently; nothing is hardcoded.

## When to use
Trigger when the user asks to clean, validate, dedupe, normalize, or reconcile a dataset before analysis:
- EN: "clean this data", "dedupe these rows", "check data quality", "normalize units/dates", "reconcile to the total", "find outliers"
- ZH: 「清洗这个数据」「数据清洗」「去重」「查重」「校验数据」「数据质量检查」「异常值」「离群值」「单位换算」「万元换算成」「日期格式不对/统一日期」「核对总数」「和总量对不上」「清理这张表」
Also trigger proactively when the user asks for analysis on a sheet that visibly contains blanks, mixed units, text-dates, or duplicate keys — propose cleaning first.

## Inputs
Read from the workbook:
- `get_workbook_overview` for sheet names and used ranges — this is where the data extent `<N>` (last data row of Raw) comes from; `read_range` with `include_formats`/`include_display` on the header row + first ~20 rows to learn column types (never read the full table).

Ask the user (do not guess):
1. **Dedupe key**: which column combination defines a unique record (e.g., 车型 + 月份 + 城市)? Never assume.
2. **Unit conventions**: are values in 万 (10,000s), k, M, or units? Which columns? Mixed?
3. **Currency**: CNY or USD? If conversion is needed, the FX rate **with its direction stated** (e.g., "CNY per USD") and its date — or, if web search is available per the note, search and cite it with an "as of" vintage.
4. **Control total**: is there an external figure to reconcile against (e.g., CPCA/中汽协 monthly total)? If yes: the number, **its units (万辆 vs 辆)**, its vintage (preliminary vs final revision), and its source.
5. **Disposal decisions**: for every flagged duplicate/outlier batch — keep, exclude, or correct? You flag; the user decides.

Minimum viable set: raw table location + dedupe key. Everything else can default to "flag and ask".

## Method
1. **Fix the data extent, then profile — before touching anything.** From `get_workbook_overview`, set `<N>` = last data row of Raw's used range. **Every range in this skill is bound to `<N>`; never write a guessed constant** — a hardcoded `A2:A10000` over a 25,000-row table silently drops 15,000 rows while every downstream check still reads "OK". Create a `Clean_Audit` sheet (`manage_sheet`) with this default layout (relocating any block means updating every reference below):
   - Rows 1–6: KEY INSIGHTS. **Assumptions** A11:B18, labels in A, values in B: B11 `unit_mult` (万→units, 10000), B12 FX rate (label states direction, e.g. "FX CNY per USD, <source>, as of <date>"), B13 fence multiplier k (1.5), B14 recon tolerance absolute (0.01), B15 control-total tolerance relative (0.005), B16 Q1 fence, B17 Q3 fence, B18 control total (label records units + vintage + source). **Checks** A20:C29. **Exclusions log** from row 31. **Profile block** from D11.
   - **No defined names.** The runtime has no tool to create workbook names — and "Q1"/"Q3" are illegal as defined names anyway (Excel silently reads them as cell addresses). Every formula must therefore use explicit sheet-qualified cell references: `Clean_Audit!$B$13` in A1 style, `Clean_Audit!R13C2` in R1C1. Labels live in the adjacent cell.
   Profile formulas per key column, live over Raw (Excel computes; you `read_range` only this small block back):
   - Row count: `=COUNTA(Raw!A2:A<N>)` vs `=COUNT(Raw!A2:A<N>)` (gap = text-typed numbers)
   - Blanks: `=COUNTBLANK(Raw!C2:C<N>)`; negatives: `=COUNTIF(Raw!D2:D<N>,"<0")`; range: `=MIN(...)`, `=MAX(...)`
   - Distinct keys: `=SUMPRODUCT((Raw!B2:B<N><>"")/COUNTIF(Raw!B2:B<N>,Raw!B2:B<N>&""))`
   - **Extent cross-check**: `=COUNTA(Raw!A<N+1>:A<N+1000>)` must equal 0 (data below the assumed extent), and the key-column COUNTA must reconcile with the overview's used-range row count (a gap means blanks or stray footer rows).
   Report anomalies BEFORE proposing any transformation.
2. **Iron rule — Raw is read-only.** Never `write_range`, `insert_delete`, or `format_range` values on the Raw sheet (a light header format at most). All cleaning happens on a new `Clean` sheet where every cell references Raw by formula. Mirror pass-through columns with `set_formulas` and `formula_r1c1: "=Raw!RC"` (same-address cross-sheet reference — one formula fills the whole range, chunked in blocks of a few thousand rows).
3. **Dedupe — detect, don't delete.** On Clean, add a `dup_flag` column via `set_formulas` (example: key = Raw columns 2 and 3): `formula_r1c1: "=IF(COUNTIFS(Raw!R2C2:R<N>C2,Raw!RC2,Raw!R2C3:R<N>C3,Raw!RC3)>1,""DUP"","""")"` plus a diagnostic `first_occ` marker: `=IF(COUNTIFS(Raw!R2C2:RC2,Raw!RC2,Raw!R2C3:RC3,Raw!RC3)=1,1,0)`. The marker is information, not a decision — whether to keep the first occurrence, the last (later rows are often revisions), or merge is the user's call. Report the duplicate count (`=COUNTIF(...,"DUP")` in the Profile block) and ask before any row is dispositioned.
4. **Outlier triage — annotate, never auto-delete.** Fences live in the Assumptions block: B16 `=QUARTILE.INC(Clean!D2:D<N>,1)`, B17 `=QUARTILE.INC(Clean!D2:D<N>,3)`, multiplier k in B13. Flag column via `set_formulas` (value in Clean column 4): `=IF(RC4="","",IF(OR(RC4<Clean_Audit!R16C2-Clean_Audit!R13C2*(Clean_Audit!R17C2-Clean_Audit!R16C2),RC4>Clean_Audit!R17C2+Clean_Audit!R13C2*(Clean_Audit!R17C2-Clean_Audit!R16C2)),"OUTLIER",""))`. Z-score variant: put `=AVERAGE(Clean!D2:D<N>)` and `=STDEV.S(Clean!D2:D<N>)` in B16/B17 instead and flag `=IF(RC4="","",IF(ABS((RC4-Clean_Audit!R16C2)/Clean_Audit!R17C2)>3,"OUTLIER",""))`. Present flagged rows with China-market context: a 10x month-over-month jump may be a real subsidy-deadline pull-forward or price-war promotion, not an error. Exclusion is a user decision, logged in the Exclusions block.
5. **Normalize units, currency, dates — via explicit, sheet-qualified conversion cells.** Never bake `*10000` invisibly into a formula, and never leave the assumption reference unqualified (a bare `R2C10` resolves on the Clean sheet where the formula lives and multiplies by an empty cell — silent zeros the #-error audit cannot catch).
   - 万→units: `=IF(Raw!RC="","",Raw!RC*Clean_Audit!R11C2)`
   - FX: **the label's direction decides the operator.** A "CNY per USD" rate converts CNY→USD by *dividing*: `=IF(Raw!RC="","",Raw!RC/Clean_Audit!R12C2)`. If you want multiply-only formulas, store the reciprocal and label it "USD per CNY". Record it as `FX CNY per USD = <rate> (as of <date>, <source>)` — the value comes from the user or a cited search, never invented.
   - Dates: `=IF(Raw!RC="","",IF(ISNUMBER(Raw!RC),Raw!RC,IFERROR(DATEVALUE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(Raw!RC,"年","-"),"月","-"),"日","")),IFERROR(DATEVALUE(SUBSTITUTE(SUBSTITUTE(Raw!RC,"年","-"),"月","")),"CHECK"))))` — the three-SUBSTITUTE first attempt handles full dates (2024年1月15日), the fallback handles year-month text (2024年1月). Format the result column `"yyyy-mm-dd"` via `format_range`; residual "CHECK" cells go to the user.
6. **Single DISPOSITION column — flags diagnose, disposition decides.** Add one column on Clean (say column F) holding exactly `"KEEP"` or `"EXCL"` for every row. Because it is single-valued, a row flagged both DUP and OUTLIER is excluded once, never subtracted twice. Default everything to KEEP until the user rules on each flagged batch, then encode each ruling as a formula — e.g., user says "drop non-first duplicates, keep the flagged outliers" (dup_flag two columns left, first_occ one column left): `=IF(AND(RC[-2]="DUP",RC[-1]=0),"EXCL","KEEP")`. An adjacent `excl_reason` column records the triggering flag (precedence DUP > OUTLIER > DATE unless the user specifies otherwise) and feeds the Exclusions log counts.
7. **Reconcile to control totals.** Build the Checks block at Clean_Audit!A20:C29 with live identities and `conditional_formatting` (red fill when "CHECK", green when "OK"). The exact formulas are specified once in **Sanity checks** below — write them verbatim, substituting the detected `<N>` and any relocated addresses. Before writing the tie-out, confirm the control total's units and vintage (Inputs #4): the recorded units decide the conversion direction in the tie-out row.
8. **Exclusions log.** A dedicated block (from row 31, or its own sheet) with columns: What (row keys / flag type) | Why (user's stated reason) | How many rows (live `COUNTIF` on excl_reason) | Value impact (live `SUMIF`) | Decided by / date. Every exclusion from steps 3–6 lands here; the conservation identity must tie to it.

## Excel output conventions
- **Sheets**: `Raw` (untouched), `Clean` (formula-only mirror + flag columns + DISPOSITION + normalized columns), `Clean_Audit` (KEY INSIGHTS, Assumptions, Profile, Checks, Exclusions log — layout fixed in Method step 1). Create with `manage_sheet`.
- **set_formulas** for every repeated column formula (one R1C1 formula per column: relative `RC` for row-varying refs, sheet-qualified absolute `Clean_Audit!R11C2`-style for assumption cells). Chunk fills over ~5,000 rows into multiple calls. Use `write_range` `expect` preconditions when writing adjacent to user-entered data.
- **en-US only**: English function names; number formats like `"#,##0"`, `"0.0%"`, `"#,##0.0,,\"M\""`, `"yyyy-mm-dd"`.
- **Assumption cells** (B11:B18: unit_mult, FX rate + direction + vintage, fence multiplier, both tolerances, control total): yellow fill + bold via `format_range`, each with a label cell to its left. These are the only cells a user should ever hand-edit.
- **KEY INSIGHTS block** at the top of Clean_Audit: 3–5 one-line findings (e.g., "142 duplicate rows on 车型+月份 key = 3.1% of records; all in 2025-03"), with counts referenced from live formula cells where possible.
- **Chart**: one `create_chart` column chart of flag counts by type (blank / dup / outlier / date-error) sourced from the Profile block — an instant data-quality dashboard. Optionally a line chart of raw vs clean monthly totals to visualize what exclusions removed.

## Sanity checks
All live in Clean_Audit!A20:C29 (labels col A, values col B, verdicts col C; `conditional_formatting` red on "CHECK", green on "OK"); `<N>` = detected last row; value column = Raw/Clean column D, DISPOSITION = Clean column F:
- **Extent guard**: B20 `=COUNTA(Raw!A<N+1>:A<N+1000>)`, C20 `=IF(B20=0,"OK","CHECK")` — data below the assumed extent invalidates every check beneath it.
- **Conservation**: B21 `=SUM(Raw!D2:D<N>)`, B22 `=SUMIF(Clean!F2:F<N>,"KEEP",Clean!D2:D<N>)`, B23 `=SUMIF(Clean!F2:F<N>,"EXCL",Clean!D2:D<N>)`, C23 `=IF(ABS(B22+B23-B21)<=B14,"OK","CHECK")` (B14 ≈ 0.01 for float noise). Must hold — a failure means a row carries neither KEEP nor EXCL.
- **Row conservation**: B24 `=COUNTA(Raw!B2:B<N>)`, B25 `=COUNTIF(Clean!F2:F<N>,"KEEP")`, B26 `=COUNTIF(Clean!F2:F<N>,"EXCL")`, C26 `=IF(B25+B26=B24,"OK","CHECK")`.
- **Control-total tie-out**: B27 restates the clean total in the control total's *recorded* units — e.g., control quoted in 万, clean in units: `=B22/B11`; the direction follows the units logged in B18's label, never an implied division. C27 `=IF(ABS(B27-B18)/B18<=B15,"OK","CHECK")`, with B15 defaulting to 0.005 and loosened *by the user* when tying to a CPCA preliminary figure vs the final revision (note which vintage in B18's label).
- **No residual errors**: B28 `=SUMPRODUCT(--ISERROR(Clean!A2:Z<N>))`, C28 `=IF(B28=0,"OK","CHECK")`; B29 `=COUNTIF(Clean!E2:E<N>,"CHECK")` for unparsed dates, C29 `=IF(B29=0,"OK","CHECK")`. The deterministic post-turn audit re-reads written ranges for #-errors — verify both are zero before finishing.
- **Magnitude**: MAX/MIN of normalized columns land in a plausible band (e.g., monthly model-level NEV registrations rarely exceed ~70k units; a 700k reading means a 万-unit column was double-converted).
- **Distinct-key identity**: distinct keys among KEEP rows = distinct keys on Raw minus keys fully excluded (compute both with the SUMPRODUCT/COUNTIF pattern from the Profile block).

## Pitfalls
1. **Cleaning by overwriting Raw** — the moment Raw is edited, auditability is gone and no reconciliation is possible. Always a separate formula-linked Clean sheet.
2. **Guessing the dedupe key** — a plausible-looking key (车型+月份) may legitimately repeat across cities or trim levels; "duplicates" removed on the wrong key silently destroy real volume. Confirm the key with the user first.
3. **Auto-deleting outliers** — China monthly data has real structural spikes (subsidy deadlines, year-end insurance pull-forwards, price-war launch months). A statistical outlier is a question, not an error.
4. **Silent or misdirected conversion** — `*10000` buried inside a formula instead of a labeled assumption cell, an unqualified assumption reference resolving to an empty cell on the wrong sheet, or multiplying by a divide-direction FX rate (7.2 CNY per USD applied as ×7.2 is off by ~52x). Labeled, sheet-qualified, direction-stated cells prevent all three.
5. **Double-counting or orphaning excluded rows** — the single-valued DISPOSITION column plus the conservation identity is the mechanism that prevents this; never skip either, and never let a flag column drive a sum directly.
6. **Trusting displayed dates** — text that *looks* like a date sorts and pivots wrong. Always test with ISNUMBER and normalize to true serials before any time-series work.

## Reporting
Chat summary structure: (1) Profile findings — rows, distinct keys, blanks, type anomalies, extent confirmation; (2) what was flagged — duplicates, outliers, date/unit issues, with counts and % of rows and % of value; (3) decisions taken vs decisions pending from the user; (4) reconciliation status — each check OK/CHECK with the actual delta; (5) where things live — sheet and range for Clean, Checks, Exclusions log. Reply in the user's language (typically Chinese) with en-US formulas quoted verbatim. Cite every externally sourced figure (FX rate, control total) with source name + date and an explicit "as of" vintage, per the sourcing rule in the note. Never present a number the workbook or a cited source cannot back.
