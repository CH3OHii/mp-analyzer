// Turn-end deterministic audit: re-read every range the model wrote this turn
// and scan for error cells / unexpectedly empty ranges. The dedupe/format logic
// is pure and unit-tested; only runAudit touches Excel (via inspect.ts).

import { readBackRange, type ReadBack } from "../excel/inspect";
import { parseA1, rectCells, rectContains, type Rect } from "../excel/guards";
import { clipResultString } from "../excel/summarize";
import type { MutatedInfo } from "../excel/tools";

export interface MutatedRange extends MutatedInfo {
  tool: string;
}

export const AUDIT_MAX_RANGES = 12;
export const AUDIT_MAX_CELLS = 20_000;

/** Most-recent-first: drop exact duplicates and ranges fully contained in an
 *  already-kept range on the same sheet, then cap count and total cells. */
export function dedupeRanges(
  ranges: MutatedRange[],
  caps: { maxRanges?: number; maxCells?: number } = {}
): MutatedRange[] {
  const maxRanges = caps.maxRanges ?? AUDIT_MAX_RANGES;
  const maxCells = caps.maxCells ?? AUDIT_MAX_CELLS;
  const kept: { mr: MutatedRange; rect: Rect }[] = [];
  let cells = 0;
  for (let i = ranges.length - 1; i >= 0; i--) {
    const mr = ranges[i];
    const rect = parseA1(mr.address);
    if (!rect) continue;
    if (kept.some((k) => k.mr.sheet === mr.sheet && rectContains(k.rect, rect))) continue;
    if (kept.length >= maxRanges) break;
    const c = rectCells(rect);
    if (cells + c > maxCells) continue; // skip this one, smaller older ranges may still fit
    kept.push({ mr, rect });
    cells += c;
  }
  return kept.map((k) => k.mr);
}

export interface AuditIssue {
  sheet: string;
  address: string;
  errors: { cell: string; error: string }[];
  all_empty?: boolean;
}

export interface AuditReport {
  checkedRanges: number;
  checkedCells: number;
  issues: AuditIssue[];
  errorCellCount: number;
}

export interface AuditRun {
  report: AuditReport;
  /** Fresh read-backs of ALL audited ranges (clean ones included) — reused as
   *  the LLM verifier's evidence so it judges what actually landed. */
  readbacks: ReadBack[];
}

export async function runAudit(ranges: MutatedRange[]): Promise<AuditRun> {
  const issues: AuditIssue[] = [];
  const readbacks: ReadBack[] = [];
  let checkedRanges = 0;
  let checkedCells = 0;
  let errorCellCount = 0;
  for (const r of ranges) {
    let rb: ReadBack;
    try {
      rb = await readBackRange(r.sheet, r.address);
    } catch {
      continue; // sheet renamed/deleted since the write — nothing to audit
    }
    checkedRanges++;
    checkedCells += rb.cells_checked;
    readbacks.push(rb);
    const emptyProblem = rb.all_empty && r.nonEmptyWrite !== false;
    if (rb.errors.length || emptyProblem) {
      issues.push({
        sheet: r.sheet,
        address: r.address,
        errors: rb.errors,
        ...(emptyProblem ? { all_empty: true } : {}),
      });
      errorCellCount += rb.errors.length;
    }
  }
  return { report: { checkedRanges, checkedCells, issues, errorCellCount }, readbacks };
}

/** The repair prompt injected as a role:"user" message (providers reject
 *  orphan role:"tool" messages, so audit findings ride the user role). */
export function formatAuditForModel(report: AuditReport): string {
  const lines = report.issues.map((i) => {
    const parts: string[] = [];
    if (i.errors.length) parts.push(`error cells: ${i.errors.map((e) => `${e.cell}=${e.error}`).join(", ")}`);
    if (i.all_empty) parts.push("the whole range is empty");
    return `- ${i.sheet}!${i.address}: ${parts.join("; ")}`;
  });
  return clipResultString(
    `[automated audit] Post-edit verification re-read the ranges you wrote this turn and found problems:\n` +
      `${lines.join("\n")}\n` +
      `Fix these now (correct the formulas/values with tools). If something is intentional — e.g. a deliberately empty range — briefly say so instead of editing. Then stop.`
  );
}
