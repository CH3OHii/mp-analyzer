import { describe, expect, it } from "vitest";
import { repairToolArgs, validateArgs } from "../src/llm/toolcallRepair";

describe("repairToolArgs", () => {
  it("parses clean JSON", () => {
    expect(repairToolArgs('{"range":"A1:B2"}')).toEqual({ ok: true, value: { range: "A1:B2" } });
  });

  it("treats empty/null arguments as {}", () => {
    expect(repairToolArgs("")).toEqual({ ok: true, value: {} });
    expect(repairToolArgs(null)).toEqual({ ok: true, value: {} });
  });

  it("strips markdown fences", () => {
    expect(repairToolArgs('```json\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } });
  });

  it("extracts the object out of surrounding prose", () => {
    const r = repairToolArgs('I will now call the tool with {"sheet":"Sales","range":"A1"} as requested.');
    expect(r).toEqual({ ok: true, value: { sheet: "Sales", range: "A1" } });
  });

  it("takes the first of two concatenated duplicate objects", () => {
    expect(repairToolArgs('{"a":1}{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it("normalizes full-width punctuation", () => {
    expect(repairToolArgs('{"sheet"："销量"，"range"："A1:B2"}')).toEqual({
      ok: true,
      value: { sheet: "销量", range: "A1:B2" },
    });
  });

  it("normalizes full-width curly quotes", () => {
    expect(repairToolArgs("{“query”: “NEV”}")).toEqual({ ok: true, value: { query: "NEV" } });
  });

  it("removes trailing commas", () => {
    expect(repairToolArgs('{"a": 1, "b": [1, 2,], }')).toEqual({ ok: true, value: { a: 1, b: [1, 2] } });
  });

  it("converts single quotes when no double quotes present", () => {
    expect(repairToolArgs("{'query': 'nev', 'max_results': 5}")).toEqual({
      ok: true,
      value: { query: "nev", max_results: 5 },
    });
  });

  it("escapes raw newlines inside strings", () => {
    expect(repairToolArgs('{"text": "line1\nline2"}')).toEqual({ ok: true, value: { text: "line1\nline2" } });
  });

  it("preserves escaped quotes while extracting balanced objects", () => {
    expect(repairToolArgs('{"formula": "=IF(A1=\\"x\\",1,{2})"}')).toEqual({
      ok: true,
      value: { formula: '=IF(A1="x",1,{2})' },
    });
  });

  it("gives up on hopeless garbage with a clipped error", () => {
    const r = repairToolArgs("not json at all, no braces");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("unparseable");
  });
});

describe("validateArgs", () => {
  const schema = {
    type: "object",
    properties: {
      range: { type: "string" },
      max_rows: { type: "integer" },
      action: { type: "string", enum: ["add", "delete"] },
      values: { type: "array" },
    },
    required: ["range"],
  };

  it("accepts valid args (integer satisfied by number)", () => {
    expect(validateArgs(schema, { range: "A1", max_rows: 50 })).toEqual({ ok: true });
  });

  it("reports missing required keys", () => {
    const r = validateArgs(schema, { max_rows: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('missing required "range"');
  });

  it("reports type mismatches and enum violations", () => {
    const r = validateArgs(schema, { range: 5, action: "rename" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('"range" should be string');
      expect(r.error).toContain('"action" must be one of');
    }
  });

  it("ignores extra keys not in the schema", () => {
    expect(validateArgs(schema, { range: "A1", extra: true })).toEqual({ ok: true });
  });
});
