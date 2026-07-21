import { describe, expect, it } from "vitest";
import { buildRepairMessage, buildVerifierMessages, parseVerdict, summarizeOps } from "../src/agent/verifier";

describe("parseVerdict", () => {
  it("parses a clean pass", () => {
    expect(parseVerdict('{"verdict":"pass"}')).toEqual({ verdict: "pass", issues: [] });
  });

  it("parses issues with severity coercion and cells", () => {
    const v = parseVerdict(
      '{"verdict":"issues","issues":[{"severity":"HIGH","description":"wrong column","cells":"Sales!B2:B9"},{"severity":"weird","description":"minor"}]}'
    );
    expect(v).toEqual({
      verdict: "issues",
      issues: [
        { severity: "high", description: "wrong column", cells: "Sales!B2:B9" },
        { severity: "medium", description: "minor" },
      ],
    });
  });

  it("is case/whitespace tolerant on the verdict value", () => {
    expect(parseVerdict('{"verdict":"Pass"}')).toEqual({ verdict: "pass", issues: [] });
    expect(parseVerdict('{"verdict":" ISSUES ","issues":[{"severity":"high","description":"x"}]}')?.verdict).toBe(
      "issues"
    );
  });

  it("strips code fences", () => {
    expect(parseVerdict('```json\n{"verdict":"pass"}\n```')).toEqual({ verdict: "pass", issues: [] });
  });

  it("extracts JSON out of surrounding prose", () => {
    const v = parseVerdict('Looking at the data, my verdict is:\n{"verdict":"pass"}\nHope that helps!');
    expect(v?.verdict).toBe("pass");
  });

  it("repairs full-width punctuation and trailing commas", () => {
    const v = parseVerdict('{"verdict"："issues"，"issues":[{"description":"总和写错了",},]}');
    expect(v).toEqual({ verdict: "issues", issues: [{ severity: "medium", description: "总和写错了" }] });
  });

  it("degrades an issues verdict with no valid issues to pass", () => {
    const v = parseVerdict('{"verdict":"issues","issues":[{"severity":"high"}]}');
    expect(v).toEqual({ verdict: "pass", issues: [] });
  });

  it("returns null on garbage (fail open)", () => {
    expect(parseVerdict("I could not check this, sorry!")).toBeNull();
    expect(parseVerdict('{"something":"else"}')).toBeNull();
    expect(parseVerdict("")).toBeNull();
  });

  it("drops malformed issue entries and caps the list", () => {
    const many = Array.from({ length: 30 }, (_, i) => `{"severity":"low","description":"issue ${i}"}`).join(",");
    const v = parseVerdict(`{"verdict":"issues","issues":[null,"text",{"severity":"low"},${many}]}`);
    expect(v?.issues.length).toBe(10);
  });
});

describe("summarizeOps", () => {
  it("keeps the most recent ops and notes how many were dropped", () => {
    const log = Array.from({ length: 50 }, (_, i) => `op${i} → ok`);
    const s = summarizeOps(log);
    expect(s).toContain("(10 earlier ops)");
    expect(s).toContain("op49 → ok");
    expect(s).not.toContain("op9 → ok\n");
  });
});

describe("buildVerifierMessages", () => {
  it("bounds the read-back payload and includes the request + ops", () => {
    const readbacks = Array.from({ length: 50 }, (_, i) => ({
      sheet: "S",
      address: `A${i + 1}:Z${i + 100}`,
      cells_checked: 2600,
      errors: [],
      all_empty: false,
      sample: Array.from({ length: 3 }, () => Array.from({ length: 8 }, () => "x".repeat(50))),
    }));
    const msgs = buildVerifierMessages({ userText: "sum the sales column", opsLog: ["write_range Sales!B2 → ok"], readbacks, lang: "en" });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain('"verdict"');
    expect(msgs[1].content).toContain("sum the sales column");
    expect(msgs[1].content).toContain("write_range Sales!B2 → ok");
    expect((msgs[1].content ?? "").length).toBeLessThanOrEqual(12_100);
  });

  it("asks for descriptions in the UI language", () => {
    const msgs = buildVerifierMessages({ userText: "x", opsLog: [], readbacks: [], lang: "zh" });
    expect(msgs[0].content).toContain("Chinese");
  });
});

describe("buildRepairMessage", () => {
  it("lists issues with severity and cells", () => {
    const msg = buildRepairMessage({
      verdict: "issues",
      issues: [{ severity: "high", description: "sum hits the wrong column", cells: "S!B2:B9" }],
    });
    expect(msg).toContain("[verification]");
    expect(msg).toContain("[high]");
    expect(msg).toContain("S!B2:B9");
  });
});
