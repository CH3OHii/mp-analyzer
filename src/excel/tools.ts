import type { MutKind, ToolDef } from "../llm/types";
import type { PendingPreview } from "../store/chatStore";
import { toErrorResult } from "./env";
import { formatTools } from "./formatTools";
import { readTools } from "./readTools";
import { writeTools } from "./writeTools";

export interface ExcelToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Static kind, or per-call (e.g. manage_sheet: delete is hard, add is soft). */
  mutating: MutKind | ((args: Record<string, unknown>) => MutKind);
  run(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  preview?(args: Record<string, unknown>): Promise<PendingPreview>;
}

export const allTools: ExcelToolSpec[] = [...readTools, ...writeTools, ...formatTools];

export function getTool(name: string): ExcelToolSpec | undefined {
  return allTools.find((t) => t.name === name);
}

export function toolDefs(): ToolDef[] {
  return allTools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export function mutKind(tool: ExcelToolSpec, args: Record<string, unknown>): MutKind {
  return typeof tool.mutating === "function" ? tool.mutating(args) : tool.mutating;
}

/** Run a tool; mutations record their snapshot internally and surface it as stepId. */
export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ result: Record<string, unknown>; stepId?: string }> {
  const tool = getTool(name);
  if (!tool) return { result: { error: { code: "unknown_tool", message: `No tool named "${name}"` } } };
  try {
    const r = await tool.run(args);
    const stepId = (r as { __stepId?: string }).__stepId;
    if (stepId) delete (r as { __stepId?: string }).__stepId;
    return { result: r, stepId };
  } catch (e) {
    return { result: toErrorResult(e) };
  }
}

export async function buildPreview(name: string, args: Record<string, unknown>): Promise<PendingPreview | undefined> {
  const tool = getTool(name);
  if (!tool?.preview) return undefined;
  try {
    return await tool.preview(args);
  } catch {
    return undefined;
  }
}
