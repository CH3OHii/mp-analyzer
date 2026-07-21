// Deep argument validation — pure, unit-tested. Runs in the agent loop BEFORE
// the approval gate, so the user is never asked to approve a call that would
// fail, and the model gets teaching error messages it can self-correct from.

import { parseA1, parseCellRef, rectCols, rectRows } from "./guards";

export type DeepResult = { ok: true } | { ok: false; code: string; message: string };

const OK: DeepResult = { ok: true };
const fail = (code: string, message: string): DeepResult => ({ ok: false, code, message });

function isPrimitive(v: unknown): boolean {
  return v === null || v === undefined || ["string", "number", "boolean"].includes(typeof v);
}

/** values must be a non-empty, strictly rectangular 2D array of primitives.
 *  Ragged input is rejected (not padded): silent padding used to preserve
 *  stale pre-state in the gaps — exactly the imprecision this layer removes. */
export function validateRectMatrix(values: unknown, name = "values"): DeepResult {
  if (!Array.isArray(values) || values.length === 0) {
    return fail("bad_values", `${name} must be a non-empty 2D array (array of row arrays)`);
  }
  const first = values[0];
  if (!Array.isArray(first) || first.length === 0) {
    return fail("bad_values", `${name}: each row must be a non-empty array`);
  }
  const cols = first.length;
  for (let r = 0; r < values.length; r++) {
    const row = values[r];
    if (!Array.isArray(row)) return fail("bad_values", `${name}: row ${r + 1} is not an array`);
    if (row.length !== cols) {
      return fail(
        "ragged_values",
        `${name}: row ${r + 1} has ${row.length} cells but row 1 has ${cols} — rows must all be the same length; pad with null to keep cells unchanged`
      );
    }
    for (let c = 0; c < cols; c++) {
      if (!isPrimitive(row[c])) {
        return fail(
          "bad_cell",
          `${name}: cell at row ${r + 1}, col ${c + 1} is ${Array.isArray(row[c]) ? "an array" : "an object"} — cells must be string/number/boolean/null`
        );
      }
    }
  }
  return OK;
}

/** A 2D number_format must match the target range's shape exactly. */
export function validateNumberFormatShape(nf: unknown, rows: number, cols: number): DeepResult {
  if (!Array.isArray(nf)) return OK; // scalar — broadcast by the tool
  if (nf.length !== rows || nf.some((r) => !Array.isArray(r) || r.length !== cols)) {
    return fail("shape_mismatch", `number_format must be a scalar string or exactly ${rows}x${cols} to match the range`);
  }
  for (const row of nf as unknown[][]) {
    for (const v of row) {
      if (typeof v !== "string") return fail("bad_args", "number_format entries must be strings");
    }
  }
  return OK;
}

// --- expect preconditions ------------------------------------------------

export const EXPECT_MAX = 20;

export interface ExpectEntry {
  cell: string;
  value: unknown;
}

export function validateExpect(expect: unknown): DeepResult {
  if (expect == null) return OK;
  if (!Array.isArray(expect)) return fail("bad_expect", "expect must be an array of {cell, value}");
  if (expect.length > EXPECT_MAX) return fail("bad_expect", `expect supports at most ${EXPECT_MAX} entries`);
  for (const e of expect) {
    if (e === null || typeof e !== "object" || Array.isArray(e)) {
      return fail("bad_expect", "each expect entry must be an object {cell, value}");
    }
    const cell = (e as Record<string, unknown>).cell;
    // No sheet prefix: expect cells are read from the SAME sheet being written,
    // so a "Other!A1" ref would silently check the wrong sheet if allowed.
    if (typeof cell !== "string" || cell.includes("!") || !parseCellRef(cell)) {
      return fail(
        "bad_expect",
        `expect entry has invalid cell "${String(cell)}" — use a single unqualified cell on the target sheet, like "B4"`
      );
    }
    if (!isPrimitive((e as Record<string, unknown>).value)) {
      return fail("bad_expect", "expect value must be string/number/boolean/null");
    }
  }
  return OK;
}

export function parseExpectList(expect: unknown): ExpectEntry[] {
  return Array.isArray(expect)
    ? expect
        .filter((e): e is Record<string, unknown> => e !== null && typeof e === "object")
        .map((e) => ({ cell: String(e.cell ?? ""), value: e.value }))
    : [];
}

export interface ExpectMismatch {
  cell: string;
  expected: unknown;
  actual: unknown;
}

/** Numbers compare numerically (so 3 matches "3.0"), everything else as
 *  trimmed strings. `actuals` is aligned by index with `expects`. */
export function checkExpectations(expects: ExpectEntry[], actuals: unknown[]): ExpectMismatch[] {
  const mismatches: ExpectMismatch[] = [];
  for (let i = 0; i < expects.length; i++) {
    const expected = expects[i].value;
    const actual = actuals[i];
    if (!valuesMatch(expected, actual)) mismatches.push({ cell: expects[i].cell, expected, actual });
  }
  return mismatches;
}

function valuesMatch(expected: unknown, actual: unknown): boolean {
  // Blank only ever matches blank: Number("")/Number(null) coerce to 0, which
  // would make "cell is empty" pass a guard expecting 0 (and vice versa) — the
  // precondition exists precisely to catch that kind of sheet drift.
  const isBlank = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "");
  if (isBlank(expected) || isBlank(actual)) return isBlank(expected) && isBlank(actual);
  if (typeof expected === "boolean" || typeof actual === "boolean") return expected === actual;
  if (typeof expected === "number" || typeof actual === "number") {
    const en = Number(typeof expected === "string" ? expected.trim() : expected);
    const an = Number(typeof actual === "string" ? actual.trim() : actual);
    if (Number.isFinite(en) && Number.isFinite(an)) return Math.abs(en - an) < 1e-9;
  }
  return String(expected ?? "").trim() === String(actual ?? "").trim();
}

// --- sheet-name suggestion -----------------------------------------------

/** NFKC folds full-width forms (ｓｈｅｅｔ１ → sheet1) — common in CJK input. */
function normName(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Closest real sheet name for a near-miss (case/width/typo ≤ 2 edits, or
 *  containment), or undefined when nothing is plausibly close. */
export function suggestSheet(name: string, actualNames: string[]): string | undefined {
  const n = normName(name);
  if (!n) return undefined;
  let best: string | undefined;
  let bestScore = 3;
  for (const a of actualNames) {
    const an = normName(a);
    if (!an) continue; // a sheet named " " normalizes to "" and would match everything via containment
    if (an === n) return a;
    let score: number;
    if (an.includes(n) || n.includes(an)) score = 1;
    else score = levenshtein(n, an);
    if (score < bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return bestScore <= 2 ? best : undefined;
}

// --- per-tool deep validation --------------------------------------------

const BORDER_EDGES = new Set(["top", "bottom", "left", "right", "inner_h", "inner_v"]);
const BORDER_STYLES = new Set(["thin", "medium", "none"]);
const CF_TYPES = new Set(["color_scale", "data_bar", "cell_value", "top_bottom", "custom_formula"]);
const CF_OPERATORS = new Set([
  "greater_than",
  "greater_equal",
  "less_than",
  "less_equal",
  "equal_to",
  "not_equal",
  "between",
  "not_between",
]);

export function validateFormatArgs(args: Record<string, unknown>): DeepResult {
  if (args.number_format != null && Array.isArray(args.number_format)) {
    const rect = parseA1(String(args.range ?? ""));
    if (!rect) return fail("bad_range", `Invalid A1 range: "${args.range}"`);
    const shape = validateNumberFormatShape(args.number_format, rectRows(rect), rectCols(rect));
    if (!shape.ok) return shape;
  }
  if (args.font != null) {
    if (typeof args.font !== "object" || Array.isArray(args.font)) return fail("bad_args", "font must be an object");
    const f = args.font as Record<string, unknown>;
    if (f.size != null && typeof f.size !== "number") return fail("bad_args", "font.size must be a number");
    if (f.bold != null && typeof f.bold !== "boolean") return fail("bad_args", "font.bold must be a boolean");
    if (f.italic != null && typeof f.italic !== "boolean") return fail("bad_args", "font.italic must be a boolean");
  }
  if (args.borders != null) {
    if (typeof args.borders !== "object" || Array.isArray(args.borders)) {
      return fail("bad_args", "borders must be an object {edges, style, color?}");
    }
    const b = args.borders as Record<string, unknown>;
    if (!Array.isArray(b.edges) || b.edges.length === 0 || b.edges.some((e) => !BORDER_EDGES.has(String(e)))) {
      return fail("bad_args", `borders.edges must be a non-empty array from ${[...BORDER_EDGES].join("/")}`);
    }
    if (!BORDER_STYLES.has(String(b.style))) {
      return fail("bad_args", `borders.style must be one of ${[...BORDER_STYLES].join("/")}`);
    }
  }
  return OK;
}

export function validateCfRule(rule: unknown): DeepResult {
  if (rule === null || typeof rule !== "object" || Array.isArray(rule)) {
    return fail("bad_args", "rule must be an object with a type");
  }
  const r = rule as Record<string, unknown>;
  const type = String(r.type ?? "");
  if (!CF_TYPES.has(type)) return fail("bad_args", `Unknown rule.type "${type}" — use ${[...CF_TYPES].join("/")}`);
  if (type === "cell_value") {
    if (!CF_OPERATORS.has(String(r.operator ?? ""))) {
      return fail("bad_args", `cell_value needs rule.operator (one of ${[...CF_OPERATORS].join("/")})`);
    }
    if (r.value1 == null) return fail("bad_args", "cell_value needs rule.value1");
    if ((r.operator === "between" || r.operator === "not_between") && r.value2 == null) {
      return fail("bad_args", `${r.operator} needs rule.value2`);
    }
  }
  if (type === "custom_formula" && (typeof r.formula !== "string" || !r.formula.trim())) {
    return fail("bad_args", 'custom_formula needs rule.formula (e.g. "=$C2>0.5")');
  }
  if (type === "top_bottom" && r.rank != null && (!Number.isInteger(r.rank) || Number(r.rank) < 1)) {
    return fail("bad_args", "top_bottom rule.rank must be a positive integer");
  }
  return OK;
}

/** Tool-specific deep checks, dispatched by name. Unknown tools pass. */
export function deepValidate(toolName: string, args: Record<string, unknown>): DeepResult {
  switch (toolName) {
    case "write_range": {
      const rect = validateRectMatrix(args.values);
      if (!rect.ok) return rect;
      return validateExpect(args.expect);
    }
    case "set_formulas": {
      if (args.formulas != null) {
        const rect = validateRectMatrix(args.formulas, "formulas");
        if (!rect.ok) return rect;
      }
      return validateExpect(args.expect);
    }
    case "format_range":
      return validateFormatArgs(args);
    case "conditional_formatting":
      return validateCfRule(args.rule);
    default:
      return OK;
  }
}
