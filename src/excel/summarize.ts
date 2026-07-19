import { CELL_STR_MAX, RESULT_MAX_CHARS } from "./guards";

export function clipCell(v: unknown): unknown {
  if (typeof v === "string" && v.length > CELL_STR_MAX) {
    return v.slice(0, CELL_STR_MAX) + `…[+${v.length - CELL_STR_MAX}]`;
  }
  return v;
}

export function clipMatrix(m: unknown[][] | undefined): unknown[][] | undefined {
  return m?.map((row) => row.map(clipCell));
}

/** Middle-out clip so both the head and the tail of a long result survive. */
export function clipResultString(s: string): string {
  if (s.length <= RESULT_MAX_CHARS) return s;
  const head = Math.floor(RESULT_MAX_CHARS * 0.62);
  const tail = RESULT_MAX_CHARS - head;
  const dropped = s.length - head - tail;
  return s.slice(0, head) + `\n…[truncated ${dropped} chars]…\n` + s.slice(s.length - tail);
}

/** Serialize a tool result for the model: compact JSON, bounded size. */
export function toToolResultString(obj: unknown): string {
  let s: string;
  try {
    s = JSON.stringify(obj);
  } catch {
    s = String(obj);
  }
  return clipResultString(s ?? "null");
}
