export type RepairResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

function tryParse(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function stripFences(s: string): string {
  const m = /^```[a-zA-Z]*\s*([\s\S]*?)\s*```\s*$/.exec(s.trim());
  return m ? m[1] : s;
}

/** Extract the first balanced {...} object, string-aware. Handles leading/trailing
 *  prose and models that emit two concatenated copies of the same object. */
function extractBalanced(s: string): string {
  const start = s.indexOf("{");
  if (start === -1) return s;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return s.slice(start);
}

function normalizeFullWidth(s: string): string {
  return s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/，/g, ",")
    .replace(/：/g, ":");
}

function stripTrailingCommas(s: string): string {
  return s.replace(/,\s*([}\]])/g, "$1");
}

/** Only when the text contains no double quotes at all (else too risky). */
function singleToDouble(s: string): string {
  if (s.includes('"')) return s;
  return s.replace(/'/g, '"');
}

/** Escape raw newlines that appear inside double-quoted strings. */
function escapeNewlinesInStrings(s: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      else if (ch === "\n") {
        out += "\\n";
        continue;
      } else if (ch === "\r") continue;
    } else if (ch === '"') {
      inStr = true;
    }
    out += ch;
  }
  return out;
}

/** Progressive repair of malformed tool-call argument JSON. Each step transforms
 *  the text further; we reparse after every step and stop at first success. */
export function repairToolArgs(raw: string | null | undefined): RepairResult {
  if (raw == null) return { ok: true, value: {} };
  const original = String(raw).trim();
  if (original === "" || original === "{}") return { ok: true, value: {} };

  const steps: ((x: string) => string)[] = [
    (x) => x,
    stripFences,
    extractBalanced,
    normalizeFullWidth,
    stripTrailingCommas,
    singleToDouble,
    escapeNewlinesInStrings,
  ];
  let cur = original;
  for (const step of steps) {
    cur = step(cur);
    const v = tryParse(cur);
    if (v) return { ok: true, value: v };
  }
  return { ok: false, error: `unparseable JSON arguments: ${original.slice(0, 200)}` };
}

/** Shallow validation against our tool JSON schemas: required keys + rough types. */
export function validateArgs(
  schema: Record<string, unknown>,
  value: Record<string, unknown>
): { ok: true } | { ok: false; error: string } {
  const problems: string[] = [];
  const required = (schema.required as string[] | undefined) ?? [];
  const props = (schema.properties as Record<string, any> | undefined) ?? {};
  for (const key of required) {
    if (value[key] === undefined || value[key] === null) problems.push(`missing required "${key}"`);
  }
  for (const [key, v] of Object.entries(value)) {
    const spec = props[key];
    if (!spec || v === null || v === undefined) continue;
    const t = spec.type as string | string[] | undefined;
    if (!t) continue;
    const types = Array.isArray(t) ? t : [t];
    const actual = Array.isArray(v) ? "array" : typeof v;
    const okType = types.some((want) => {
      if (want === "integer" || want === "number") return actual === "number";
      return want === actual;
    });
    if (!okType) problems.push(`"${key}" should be ${types.join("|")}, got ${actual}`);
    if (spec.enum && !spec.enum.includes(v)) problems.push(`"${key}" must be one of ${JSON.stringify(spec.enum)}`);
  }
  return problems.length ? { ok: false, error: problems.join("; ") } : { ok: true };
}
