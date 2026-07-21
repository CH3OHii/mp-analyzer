// LLM verifier pass: one extra temperature-0 call that reviews the finished
// turn (user request + ops executed + read-backs of written ranges) and
// returns a strict JSON verdict. Fail-open by design — a flaky verifier can
// degrade to a notice but never break a turn. Message-building and verdict
// parsing are pure and unit-tested.

import { streamChat } from "../llm/client";
import { repairToolArgs } from "../llm/toolcallRepair";
import type { ChatMessage, LlmSettings, ProviderQuirks } from "../llm/types";
import { clipResultString } from "../excel/summarize";
import type { ReadBack } from "../excel/inspect";
import type { VerifyIssue } from "../store/chatStore";

export interface Verdict {
  verdict: "pass" | "issues";
  issues: VerifyIssue[];
}

export const OPS_LOG_MAX = 40;
export const READBACK_JSON_MAX = 6_000;
export const VERIFIER_MAX_ISSUES = 10;

export function summarizeOps(opsLog: string[]): string {
  const shown = opsLog.slice(-OPS_LOG_MAX);
  const skipped = opsLog.length - shown.length;
  return (skipped > 0 ? `…(${skipped} earlier ops)\n` : "") + shown.join("\n");
}

export function buildVerifierMessages(opts: {
  userText: string;
  opsLog: string[];
  readbacks: ReadBack[];
  lang: "en" | "zh";
}): ChatMessage[] {
  const descLang = opts.lang === "zh" ? "Chinese" : "English";
  const system = `You are a strict verification auditor for an AI agent that edits Excel workbooks. Given the user's request, the operations the agent executed, and read-backs of the ranges it wrote, judge whether the result plausibly fulfills the request.

Look for: results in the wrong place or wrong columns; values that are obviously wrong (impossible magnitudes, percentages far above 100%, negative counts); formula error cells; ranges left empty that should have content; a mismatch between what was asked and what was done.

Respond with ONLY one JSON object — no prose, no code fences:
{"verdict":"pass"}
or
{"verdict":"issues","issues":[{"severity":"high","description":"...","cells":"Sheet1!B4:B10"}]}

severity is "high" | "medium" | "low". Write descriptions in ${descLang}. Report at most 5 issues, and only problems you can point to in the provided data — uncertainty alone is not an issue.`;

  let rb: string;
  try {
    rb = JSON.stringify(opts.readbacks);
  } catch {
    rb = "[]";
  }
  if (rb.length > READBACK_JSON_MAX) rb = rb.slice(0, READBACK_JSON_MAX) + "…";
  const user = clipResultString(
    `User request:\n${opts.userText}\n\n` +
      `Operations the agent executed:\n${summarizeOps(opts.opsLog)}\n\n` +
      `Current contents of the written ranges (read back AFTER the edits; "sample" is the top-left corner):\n${rb}`
  );
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** Parse the verifier's reply. Reuses the tool-call JSON repair chain (built
 *  for exactly these providers' failure modes). Returns null on garbage —
 *  the caller fails open. */
export function parseVerdict(text: string): Verdict | null {
  const parsed = repairToolArgs(text);
  if (!parsed.ok) return null;
  const v = parsed.value;
  const vRaw = String(v.verdict ?? "").trim().toLowerCase();
  const verdict = vRaw === "issues" ? "issues" : vRaw === "pass" ? "pass" : null;
  if (!verdict) return null;
  const issues: VerifyIssue[] = [];
  for (const it of Array.isArray(v.issues) ? v.issues : []) {
    if (it === null || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const description = typeof o.description === "string" ? o.description.trim() : "";
    if (!description) continue;
    const sevRaw = String(o.severity ?? "").toLowerCase();
    const severity: VerifyIssue["severity"] = sevRaw === "high" ? "high" : sevRaw === "low" ? "low" : "medium";
    const entry: VerifyIssue = { severity, description };
    if (typeof o.cells === "string" && o.cells.trim()) entry.cells = o.cells.trim();
    issues.push(entry);
    if (issues.length >= VERIFIER_MAX_ISSUES) break;
  }
  if (verdict === "issues" && issues.length === 0) return { verdict: "pass", issues: [] };
  return { verdict, issues };
}

/** The bounded-repair prompt injected as a role:"user" message. */
export function buildRepairMessage(v: Verdict): string {
  const lines = v.issues.map((i) => `- [${i.severity}] ${i.description}${i.cells ? ` (${i.cells})` : ""}`);
  return (
    `[verification] An automated review of the result found possible issues:\n${lines.join("\n")}\n` +
    `Fix the real ones with tools now. If one is a false positive, briefly say why instead of editing. Then stop.`
  );
}

/** One non-tool, temperature-0 call through the normal client (inherits HTTP
 *  retry). Abort propagates; every other failure returns null (fail open). */
export async function runVerifierPass(opts: {
  llm: LlmSettings;
  quirks: ProviderQuirks;
  signal: AbortSignal;
  userText: string;
  opsLog: string[];
  readbacks: ReadBack[];
  lang: "en" | "zh";
}): Promise<Verdict | null> {
  try {
    const res = await streamChat({
      settings: { ...opts.llm, temperature: 0, maxTokens: 1024 },
      quirks: opts.quirks,
      messages: buildVerifierMessages(opts),
      signal: opts.signal,
    });
    return parseVerdict(res.text);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return null;
  }
}
