import type { ChatMessage } from "../llm/types";

// CJK ≈ 1 token per char; everything else ≈ 4 chars per token.
const CJK_RE = /[⺀-鿿豈-﫿＀-￯　-〿]/;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (CJK_RE.test(ch)) cjk++;
    else other++;
  }
  return cjk + Math.ceil(other / 4);
}

export function estimateMessageTokens(m: ChatMessage): number {
  let n = 4; // per-message overhead
  if (m.content) n += estimateTokens(m.content);
  if (m.tool_calls) {
    for (const tc of m.tool_calls) {
      n += estimateTokens(tc.function.name) + estimateTokens(tc.function.arguments);
    }
  }
  return n;
}

export function estimateHistoryTokens(msgs: ChatMessage[]): number {
  return msgs.reduce((s, m) => s + estimateMessageTokens(m), 0);
}

export const ELIDED_RESULT = '{"note":"[old result elided to save context]"}';
const KEEP_TAIL = 6;

/**
 * Fit history into a token budget without ever orphaning a tool_calls stub:
 * pass 1 elides old tool-result BODIES (the tool message itself stays so every
 * assistant tool_calls keeps its paired tool response — several providers 400
 * otherwise); pass 2 drops whole user→…→assistant exchanges, keeping the first
 * user message (session anchor) and the last `protectTailUserBlocks` blocks.
 *
 * protectTailUserBlocks exists because the agent loop can inject synthetic
 * role:"user" repair prompts ([automated audit]/[verification]) AFTER the real
 * current exchange — with the default of 1, those injections would become the
 * only protected block and the actual current turn could be spliced away.
 */
export function trimHistory(history: ChatMessage[], budget: number, protectTailUserBlocks = 1): ChatMessage[] {
  const msgs = history.map((m) => ({ ...m }));
  const total = () => estimateHistoryTokens(msgs);
  if (total() <= budget) return msgs;

  for (let i = 0; i < msgs.length - KEEP_TAIL && total() > budget; i++) {
    const m = msgs[i];
    if (m.role === "tool" && m.content && m.content !== ELIDED_RESULT) {
      m.content = ELIDED_RESULT;
    }
  }
  if (total() <= budget) return msgs;

  const userIndexes = () => msgs.reduce<number[]>((acc, m, i) => (m.role === "user" ? [...acc, i] : acc), []);
  let idx = userIndexes();
  // Drop middle blocks: never block 0 (first user msg), never the protected tail.
  const keepTail = Math.max(1, protectTailUserBlocks);
  while (total() > budget && idx.length > 1 + keepTail) {
    msgs.splice(idx[1], idx[2] - idx[1]);
    idx = userIndexes();
  }
  return msgs;
}
