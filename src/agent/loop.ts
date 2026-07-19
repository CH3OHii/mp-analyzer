import { hasExcel, runExcel } from "../excel/env";
import { toToolResultString } from "../excel/summarize";
import { buildPreview, executeTool, getTool, mutKind, toolDefs } from "../excel/tools";
import { dict } from "../i18n";
import { streamChat } from "../llm/client";
import { getPreset } from "../llm/providers";
import { repairToolArgs, validateArgs } from "../llm/toolcallRepair";
import type { ChatMessage } from "../llm/types";
import * as chat from "../store/chatStore";
import { effectiveLlm, getSettings } from "../store/settings";
import { estimateTokens, trimHistory } from "./history";
import { composeSystemPrompt } from "./systemPrompt";

function targetOf(args: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  if (typeof args.sheet === "string") parts.push(args.sheet);
  const r = args.range ?? args.start_cell ?? args.data_range ?? args.name ?? args.query;
  if (r != null) parts.push(String(r));
  return parts.length ? parts.join("!") : undefined;
}

/** One line of live workbook context appended to the user message. Cheap, and it
 *  keeps the static system prompt untouched for provider prefix caching. */
async function ephemeralContext(): Promise<string> {
  if (!hasExcel()) return "";
  try {
    return await runExcel(async (ctx) => {
      const ws = ctx.workbook.worksheets.getActiveWorksheet();
      ws.load("name");
      const sel = ctx.workbook.getSelectedRange();
      sel.load("address");
      await ctx.sync();
      return `\n\n[context: active sheet "${ws.name}", selection ${sel.address}]`;
    });
  } catch {
    return "";
  }
}

export async function runTurn(userText: string): Promise<void> {
  const settings = getSettings();
  const t = dict(settings.language);
  const llm = effectiveLlm(settings);

  chat.addUser(userText);
  if (!llm.apiKey) {
    chat.addError(t.noKeyError);
    return;
  }

  const controller = new AbortController();
  chat.setStreaming(true, controller);
  let turnAutoApply = settings.autoApply;
  const quirks = getPreset(llm.providerId).quirks;
  const tools = hasExcel() ? toolDefs() : undefined; // browser preview = plain chat

  chat.llmHistory.push({ role: "user", content: userText + (await ephemeralContext()) });

  try {
    for (let iter = 0; iter < settings.maxIters; iter++) {
      const system: ChatMessage = { role: "system", content: composeSystemPrompt(settings) };
      const budget = Math.max(4000, settings.contextBudgetTokens - estimateTokens(system.content ?? ""));
      const messages = [system, ...trimHistory(chat.llmHistory, budget)];

      const aid = chat.beginAssistant();
      let res;
      try {
        res = await streamChat({
          settings: llm,
          quirks,
          messages,
          tools,
          signal: controller.signal,
          onEvent: (ev) => {
            if (ev.type === "text") chat.appendAssistant(aid, { text: ev.delta });
            else if (ev.type === "reasoning") chat.appendAssistant(aid, { reasoning: ev.delta });
          },
        });
      } finally {
        chat.finishAssistant(aid);
      }
      if (res.usage) chat.addUsage(res.usage.prompt, res.usage.completion);
      chat.llmHistory.push({
        role: "assistant",
        content: res.text || null,
        ...(res.toolCalls.length ? { tool_calls: res.toolCalls } : {}),
      });
      if (!res.text) chat.dropAssistantIfEmpty(aid);
      if (!res.toolCalls.length) return; // final answer

      for (const tc of res.toolCalls) {
        const tool = getTool(tc.function.name);
        const parsed = repairToolArgs(tc.function.arguments);
        const args = parsed.ok ? parsed.value : {};
        const kind = tool ? mutKind(tool, args) : "no";
        const cardId = chat.addToolCard({
          callId: tc.id,
          name: tc.function.name,
          argsRaw: tc.function.arguments,
          args: parsed.ok ? args : undefined,
          status: "running",
          target: targetOf(args),
          mutating: kind,
        });
        const pushToolResult = (obj: unknown) =>
          chat.llmHistory.push({ role: "tool", tool_call_id: tc.id, content: toToolResultString(obj) });

        if (!tool) {
          const err = { error: { code: "unknown_tool", message: `No tool named "${tc.function.name}"` } };
          chat.patchToolCard(cardId, { status: "error", error: err.error.message });
          pushToolResult(err);
          continue;
        }
        if (!parsed.ok) {
          const err = { error: { code: "bad_json", message: `${parsed.error} — re-issue the call with valid JSON arguments.` } };
          chat.patchToolCard(cardId, { status: "error", error: parsed.error });
          pushToolResult(err);
          continue;
        }
        const valid = validateArgs(tool.parameters, args);
        if (!valid.ok) {
          const err = { error: { code: "bad_args", message: valid.error } };
          chat.patchToolCard(cardId, { status: "error", error: valid.error });
          pushToolResult(err);
          continue;
        }

        // Approval gate: hard ops ALWAYS ask; soft ops ask unless auto-apply.
        if (kind !== "no" && (kind === "hard" || !turnAutoApply)) {
          const preview = await buildPreview(tc.function.name, args);
          chat.patchToolCard(cardId, { status: "pending", preview });
          let decision: chat.Decision;
          try {
            decision = await chat.awaitDecision(cardId, controller.signal);
          } catch (e) {
            chat.patchToolCard(cardId, { status: "rejected" });
            throw e; // abort — handled below
          }
          if (decision.action === "apply-turn") turnAutoApply = true;
          if (decision.action === "reject") {
            chat.patchToolCard(cardId, { status: "rejected", error: decision.reason });
            pushToolResult({
              error: {
                code: "user_rejected",
                message: `The user rejected this change${decision.reason ? `: ${decision.reason}` : ""}. Adjust your approach; do not retry the identical call.`,
              },
            });
            continue;
          }
          chat.patchToolCard(cardId, { status: "running" });
        }

        const { result, stepId } = await executeTool(tc.function.name, args);
        const isErr = !!(result as { error?: unknown }).error;
        chat.patchToolCard(cardId, {
          status: isErr ? "error" : kind === "no" ? "done" : "applied",
          stepId,
          error: isErr ? String((result as { error?: { message?: string } }).error?.message ?? "") : undefined,
          resultSummary: toToolResultString(result),
        });
        pushToolResult(result);
      }
    }
    chat.addNotice(t.maxItersReached);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      chat.addNotice(t.stopped);
    } else {
      chat.addError(e instanceof Error ? e.message : String(e));
    }
  } finally {
    chat.setStreaming(false);
  }
}
