// Minimal, dependency-free frontmatter parser for bundled skill files.
// Recognizes a leading `---` block of flat `key: value` lines — no nesting,
// no arrays. Anything malformed degrades to "the whole file is the body",
// which is exactly the pre-frontmatter behavior.
export interface ParsedSkillFile {
  meta: Record<string, string>;
  body: string;
}

const KEY_LINE = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/;

export function parseFrontmatter(raw: string): ParsedSkillFile {
  const text = raw.replace(/^﻿/, ""); // strip BOM
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { meta: {}, body: text };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) return { meta: {}, body: text }; // unclosed fence

  const meta: Record<string, string> = {};
  let lastKey: string | null = null;
  for (const line of lines.slice(1, end)) {
    const m = KEY_LINE.exec(line);
    if (m) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      meta[m[1]] = v;
      lastKey = m[1];
    } else if (lastKey && line.trim()) {
      // soft-wrapped value continues the previous key
      meta[lastKey] += ` ${line.trim()}`;
    }
  }
  const body = lines
    .slice(end + 1)
    .join("\n")
    .replace(/^\n+/, "");
  return { meta, body };
}
