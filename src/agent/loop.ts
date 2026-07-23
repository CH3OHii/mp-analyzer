import { hasExcel } from "../excel/env";
import { getLiveContext } from "../excel/inspect";
import { toToolResultString } from "../excel/summarize";
import { buildPreview, executeTool, getTool, mutKind, toolDefs } from "../excel/tools";
import { deepValidate, suggestSheet } from "../excel/validate";
import { dict } from "../i18n";
import { streamChat } from "../llm/client";
import { getPreset } from "../llm/providers";
import { repairToolArgs, validateArgs } from "../llm/toolcallRepair";
import type { ChatMessage } from "../llm/types";
import * as chat from "../store/chatStore";
import { effectiveLlm, getSettings, resolveVerifier } from "../store/settings";
import { dedupeRanges, formatAuditForModel, runAudit, type AuditRun, type MutatedRange } from "./audit";
import { estimateTokens, trimHistory } from "./history";
import { composeSystemPrompt, webSearchAvailable } from "./systemPrompt";
import { buildRepairMessage, runVerifierPass } from "./verifier";
import { buildWebSearchEcho, displayQuery, isWebSearchCall } from "./webSearch";

function targetOf(args: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  if (typeof args.sheet === "string") parts.push(args.sheet);
  const r = args.range ?? args.start_cell ?? args.data_range ?? args.name ?? args.query;
  if (r != null) parts.push(String(r));
  return parts.length ? parts.join("!") : undefined;
}

/** Extra iterations granted for a bounded repair round after audit/verifier findings. */
const REPAIR_CREDITS = 3;

/** How a turn ended — the queue dispatcher drains only after "done". */
export type TurnOutcome = "done" | "stopped" | "error";

export async function runTurn(userText: string): Promise<TurnOutcome> {
  const settings = getSettings();
  const t = dict(settings.language);
  const llm = effectiveLlm(settings);

  chat.addUser(userText);
  if (!llm.apiKey) {
    chat.addError(t.noKeyError);
    return "error";
  }

  const controller = new AbortController();
  chat.setStreaming(true, controller);
  let turnAutoApply = settings.autoApply;
  const quirks = getPreset(llm.providerId).quirks;
  const tools = hasExcel() ? toolDefs() : undefined; // browser preview = plain chat
  const webSearch = webSearchAvailable(settings); // search works even tool-less (server-side)

  // Live workbook context (active sheet + selection + sheet list) — refreshed
  // EVERY iteration, because the model itself activates/adds sheets mid-turn.
  // It rides the user message (iter 0) or the tail of the latest tool message
  // (later iters), keeping the static system-prompt prefix cache intact.
  let live = await getLiveContext();
  let sheetNames: string[] | null = live?.sheetNames ?? null;
  let lastCtxText = live?.text ?? "";
  chat.llmHistory.push({ role: "user", content: userText + (live ? `\n\n${live.text}` : "") });

  const mutated: MutatedRange[] = [];
  const opsLog: string[] = [];
  let credits = settings.maxIters;
  let audits = 0;
  let verifierRan = false;
  let firstIter = true;
  // Injected [automated audit]/[verification] user messages sit AFTER the real
  // current exchange — trimHistory must protect that many extra tail blocks or
  // it would splice away the actual turn and keep only the tiny repair prompt.
  let injectedUserMsgs = 0;
  const assertNotAborted = () => {
    if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
  };

  try {
    while (credits > 0) {
      credits--;
      if (!firstIter) {
        live = await getLiveContext();
        if (live) {
          sheetNames = live.sheetNames;
          if (live.text !== lastCtxText) {
            // Ride the tail message (tool result, or an injected repair prompt);
            // only mark the context delivered when it was actually attached.
            const last = chat.llmHistory[chat.llmHistory.length - 1];
            if (last && (last.role === "tool" || last.role === "user")) {
              last.content = `${last.content ?? ""}\n${live.text}`;
              lastCtxText = live.text;
            }
          }
        }
      }
      firstIter = false;

      const system: ChatMessage = { role: "system", content: composeSystemPrompt(settings) };
      const budget = Math.max(4000, settings.contextBudgetTokens - estimateTokens(system.content ?? ""));
      const messages = [system, ...trimHistory(chat.llmHistory, budget, 1 + injectedUserMsgs)];

      const aid = chat.beginAssistant();
      let res;
      try {
        res = await streamChat({
          settings: llm,
          quirks,
          messages,
          tools,
          webSearch,
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

      if (!res.toolCalls.length) {
        // ---- turn-end verification: deterministic audit, then LLM review ----
        if (settings.verifyMode !== "off" && mutated.length && hasExcel()) {
          let auditRun: AuditRun | null = null;
          if (audits < 2) {
            audits++;
            auditRun = await runAudit(dedupeRanges(mutated));
            assertNotAborted(); // Stop/New-chat during the read-backs must not inject a stale repair prompt
            if (auditRun.report.issues.length) {
              chat.addNotice(t.auditFoundIssues(auditRun.report.issues.length));
              chat.llmHistory.push({ role: "user", content: formatAuditForModel(auditRun.report) });
              injectedUserMsgs++;
              credits = Math.max(credits, REPAIR_CREDITS);
              continue; // bounded repair round — audits/verifierRan keep this finite
            }
          }
          if (settings.verifyMode === "full" && !verifierRan) {
            verifierRan = true;
            // When the audit budget is exhausted (audits==2 with issues both
            // times), re-read purely for EVIDENCE — the verifier must never
            // judge on an empty readback set, or it green-lights known-bad cells.
            const evidence = auditRun ?? (await runAudit(dedupeRanges(mutated)));
            assertNotAborted();
            // Independent reviewer model when configured (falls back to the
            // primary; a configured-but-keyless reviewer gets a notice).
            const verifier = resolveVerifier(settings);
            if (verifier.fellBackNoKey) chat.addNotice(t.verifierKeyMissing);
            const verifiedBy = verifier.isCross ? verifier.llm.model : undefined;
            const verdict = await runVerifierPass({
              llm: verifier.llm,
              quirks: getPreset(verifier.providerId).quirks,
              signal: controller.signal,
              userText,
              opsLog,
              readbacks: evidence.readbacks,
              lang: settings.language,
            });
            if (!verdict) {
              chat.addNotice(t.verifierUnavailable);
              // The deterministic audit DID pass — full mode must not report
              // less than basic mode when only the AI layer is unavailable.
              // No reviewer label here: the reviewer model never actually reviewed.
              if (auditRun) chat.addVerify("pass", []);
            } else if (verdict.verdict === "issues" && verdict.issues.length) {
              chat.addVerify("issues", verdict.issues, verifiedBy);
              chat.llmHistory.push({ role: "user", content: buildRepairMessage(verdict) });
              injectedUserMsgs++;
              credits = Math.max(credits, REPAIR_CREDITS);
              continue;
            } else {
              chat.addVerify("pass", [], verifiedBy);
            }
          } else if (settings.verifyMode === "basic" && auditRun) {
            chat.addVerify("pass", []);
          }
        }
        return "done"; // final answer
      }

      for (const tc of res.toolCalls) {
        // Kimi $web_search: echo the arguments back VERBATIM (no repair, no
        // validation, no clipping — the provider parses its own payload) and
        // let the next iteration deliver the server-side search results.
        if (isWebSearchCall(tc.function.name)) {
          const query = displayQuery(tc.function.arguments);
          const cardId = chat.addToolCard({
            callId: tc.id,
            name: tc.function.name,
            argsRaw: tc.function.arguments,
            status: "running",
            target: query,
            mutating: "no",
          });
          chat.llmHistory.push(buildWebSearchEcho(tc));
          chat.patchToolCard(cardId, { status: "done" });
          opsLog.push(`$web_search${query ? ` "${query}"` : ""} → ok`);
          continue;
        }
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
        const failCard = (code: string, message: string) => {
          chat.patchToolCard(cardId, { status: "error", error: message });
          pushToolResult({ error: { code, message } });
          opsLog.push(`${tc.function.name}${targetOf(args) ? ` ${targetOf(args)}` : ""} → error(${code})`);
        };

        if (!tool) {
          failCard("unknown_tool", `No tool named "${tc.function.name}"`);
          continue;
        }
        if (!parsed.ok) {
          failCard("bad_json", `${parsed.error} — re-issue the call with valid JSON arguments.`);
          continue;
        }
        const valid = validateArgs(tool.parameters, args);
        if (!valid.ok) {
          failCard("bad_args", valid.error);
          continue;
        }
        // Deep validation runs BEFORE the approval gate — never ask the user
        // to approve a call that is already known to fail.
        const deep = deepValidate(tc.function.name, args);
        if (!deep.ok) {
          failCard(deep.code, deep.message);
          continue;
        }
        // manage_pivot create names its destination via dest_sheet, not sheet —
        // when given, it must already exist (the tool only creates a NEW sheet
        // when dest_sheet is omitted) — check both so it gets the same teaching
        // error as every other tool instead of a raw ItemNotFound.
        const targetSheet =
          typeof args.sheet === "string" && args.sheet !== ""
            ? args.sheet
            : tc.function.name === "manage_pivot" && typeof args.dest_sheet === "string" && args.dest_sheet !== ""
              ? args.dest_sheet
              : null;
        if (sheetNames && targetSheet && tc.function.name !== "manage_sheet" && !sheetNames.includes(targetSheet)) {
          const sug = suggestSheet(targetSheet, sheetNames);
          failCard(
            "unknown_sheet",
            `No sheet named "${targetSheet}"${sug ? ` — did you mean "${sug}"?` : ""}. Sheets: ${sheetNames.join(", ")}`
          );
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
            opsLog.push(`${tc.function.name}${targetOf(args) ? ` ${targetOf(args)}` : ""} → rejected by user`);
            continue;
          }
          chat.patchToolCard(cardId, { status: "running" });
        }

        const { result, stepId, mutated: mut } = await executeTool(tc.function.name, args);
        const isErr = !!(result as { error?: unknown }).error;
        if (!isErr && mut) mutated.push({ ...mut, tool: tc.function.name });
        if (!isErr && tc.function.name === "manage_sheet" && sheetNames) {
          // Keep the cached sheet list honest within the same iteration.
          const action = String(args.action ?? "");
          const name = String(args.name ?? "");
          if (action === "add") sheetNames = [...sheetNames, name];
          else if (action === "delete") sheetNames = sheetNames.filter((s) => s !== name);
          else if (action === "rename") sheetNames = sheetNames.map((s) => (s === name ? String(args.new_name ?? s) : s));
        }
        const errCode = isErr ? String((result as { error?: { code?: string } }).error?.code ?? "error") : "";
        opsLog.push(`${tc.function.name}${targetOf(args) ? ` ${targetOf(args)}` : ""} → ${isErr ? `error(${errCode})` : "ok"}`);
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
    // Max-iters is a soft stop ("send another message to continue") — treat as
    // "done" so a queued follow-up dispatches, which is exactly continuing.
    return "done";
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      // An abort mid-repair can leave a trailing injected repair prompt in
      // llmHistory; drop it so it can't ride the user's NEXT (unrelated) turn.
      const last = chat.llmHistory[chat.llmHistory.length - 1];
      if (
        last?.role === "user" &&
        typeof last.content === "string" &&
        (last.content.startsWith("[automated audit]") || last.content.startsWith("[verification]"))
      ) {
        chat.llmHistory.pop();
      }
      chat.addNotice(t.stopped);
      return "stopped";
    }
    chat.addError(e instanceof Error ? e.message : String(e));
    return "error";
  } finally {
    chat.setStreaming(false);
  }
}
