import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../src/agent/frontmatter";

describe("parseFrontmatter", () => {
  it("parses keys and strips the block from the body", () => {
    const { meta, body } = parseFrontmatter(
      "---\nname_en: Market Sizing\nname_zh: 市场规模\nnote: Ask for data.\n---\n# Title\nBody text"
    );
    expect(meta).toEqual({ name_en: "Market Sizing", name_zh: "市场规模", note: "Ask for data." });
    expect(body).toBe("# Title\nBody text");
    expect(body).not.toContain("---");
  });

  it("returns the whole file as body when there is no frontmatter", () => {
    const raw = "# Just a skill\nNo fences here.";
    expect(parseFrontmatter(raw)).toEqual({ meta: {}, body: raw });
  });

  it("treats an unclosed fence as plain body", () => {
    const raw = "---\nname_en: Broken\n# no closing fence";
    expect(parseFrontmatter(raw)).toEqual({ meta: {}, body: raw });
  });

  it("handles CRLF line endings", () => {
    const { meta, body } = parseFrontmatter("---\r\nname_en: X\r\n---\r\nBody");
    expect(meta.name_en).toBe("X");
    expect(body).toBe("Body");
  });

  it("joins soft-wrapped values onto the previous key", () => {
    const { meta } = parseFrontmatter("---\nnote: first part\n  second part\n---\nB");
    expect(meta.note).toBe("first part second part");
  });

  it("strips matching surrounding quotes", () => {
    const { meta } = parseFrontmatter('---\nname_en: "Quoted Name"\n---\nB');
    expect(meta.name_en).toBe("Quoted Name");
  });

  it("ignores junk lines inside the block", () => {
    const { meta } = parseFrontmatter("---\n: nokey\nname_en: Ok\n---\nB");
    expect(meta).toEqual({ name_en: "Ok" });
  });
});
