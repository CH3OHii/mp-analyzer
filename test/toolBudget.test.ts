import { describe, expect, it } from "vitest";
import { estimateTokens } from "../src/agent/history";
import { allTools, toolDefs } from "../src/excel/tools";

/** Every tool schema rides in EVERY request — schema creep silently eats the
 *  32k default context budget. Growing past this needs a deliberate decision
 *  (raise it here WITH a compensating contextBudgetTokens default review). */
const TOOLDEF_TOKEN_BUDGET = 9_000;

describe("tool definition budget", () => {
  it(`serialized tool schemas stay under ${TOOLDEF_TOKEN_BUDGET} estimated tokens`, () => {
    const tokens = estimateTokens(JSON.stringify(toolDefs()));
    expect(tokens).toBeLessThan(TOOLDEF_TOKEN_BUDGET);
  });

  it("tool names are unique", () => {
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("ships the expected 15 tools", () => {
    expect(allTools.map((t) => t.name).sort()).toEqual(
      [
        "aggregate_range",
        "conditional_formatting",
        "create_chart",
        "find",
        "format_range",
        "get_selection",
        "get_workbook_overview",
        "insert_delete",
        "manage_pivot",
        "manage_sheet",
        "manage_table",
        "read_range",
        "set_formulas",
        "sort_filter",
        "write_range",
      ].sort()
    );
  });
});
