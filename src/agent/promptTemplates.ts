// Prompt templates: user-authored reusable prompts with {placeholder} tokens.
// Pure helpers — storage lives in settings (promptTemplates), UI in
// PromptLibraryPanel.

export interface PromptTemplate {
  id: string;
  name: string;
  /** May contain {variable} tokens, e.g. "分析{月份}的NEV销量". */
  body: string;
}

/** {token} — up to 30 chars, no braces or newlines inside. Non-greedy so
 *  "{a}{b}" is two tokens, and a stray "{" without a match stays literal. */
const PLACEHOLDER_RE = /\{([^{}\n]{1,30}?)\}/g;

/** Unique placeholder names, in first-appearance order. */
export function extractPlaceholders(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of body.matchAll(PLACEHOLDER_RE)) {
    const key = m[1].trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/** Substitute values; a blank/missing value leaves the literal {token} in
 *  place so an unfilled hole stays visible in the composer. */
export function fillTemplate(body: string, values: Record<string, string>): string {
  return body.replace(PLACEHOLDER_RE, (whole, raw: string) => {
    const v = values[raw.trim()];
    return v && v.trim() ? v : whole;
  });
}
