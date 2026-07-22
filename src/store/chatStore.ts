import { useSyncExternalStore } from "react";
import type { ChatMessage, MutKind } from "../llm/types";

export type ToolCardStatus = "pending" | "running" | "applied" | "rejected" | "error" | "reverted" | "done";

export interface PendingPreview {
  address?: string;
  cells?: number;
  before?: unknown[][];
  after?: unknown[][];
  moreRows?: number;
  note?: string;
}

export interface ToolCardModel {
  id: number;
  callId: string;
  name: string;
  argsRaw: string;
  args?: Record<string, unknown>;
  status: ToolCardStatus;
  target?: string;
  resultSummary?: string;
  error?: string;
  mutating: MutKind;
  stepId?: string;
  preview?: PendingPreview;
}

export interface VerifyIssue {
  severity: "high" | "medium" | "low";
  description: string;
  cells?: string;
}

export type ChatItem =
  | { kind: "user"; id: number; text: string }
  | { kind: "assistant"; id: number; text: string; reasoning: string; streaming: boolean }
  | { kind: "tool"; id: number; card: ToolCardModel }
  | { kind: "verify"; id: number; verdict: "pass" | "issues"; issues: VerifyIssue[] }
  | { kind: "notice"; id: number; text: string }
  | { kind: "error"; id: number; text: string };

export type Decision = { action: "apply" } | { action: "apply-turn" } | { action: "reject"; reason?: string };

export interface ChatState {
  items: ChatItem[];
  streaming: boolean;
  usage: { prompt: number; completion: number };
  pendingCardId: number | null;
  /** Messages submitted while a turn is running — dispatched FIFO at turn end.
   *  Kept OUT of llmHistory until dispatch (trimHistory tail protection). */
  queued: string[];
}

let state: ChatState = {
  items: [],
  streaming: false,
  usage: { prompt: 0, completion: 0 },
  pendingCardId: null,
  queued: [],
};

/** The LLM-side conversation (system message composed separately per request). */
export const llmHistory: ChatMessage[] = [];

let nextId = 1;
let pendingResolver: ((d: Decision) => void) | null = null;
let abortController: AbortController | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export function getChat(): ChatState {
  return state;
}

export function useChat(): ChatState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state
  );
}

export function resetChat(): void {
  stopTurn();
  llmHistory.length = 0;
  state = { items: [], streaming: false, usage: { prompt: 0, completion: 0 }, pendingCardId: null, queued: [] };
  notify();
}

export function enqueue(text: string): void {
  state = { ...state, queued: [...state.queued, text] };
  notify();
}

export function removeQueuedAt(index: number): void {
  state = { ...state, queued: state.queued.filter((_, i) => i !== index) };
  notify();
}

export function dequeue(): string | undefined {
  if (!state.queued.length) return undefined;
  const [head, ...rest] = state.queued;
  state = { ...state, queued: rest };
  notify();
  return head;
}

export function addUser(text: string): number {
  const id = nextId++;
  state = { ...state, items: [...state.items, { kind: "user", id, text }] };
  notify();
  return id;
}

export function beginAssistant(): number {
  const id = nextId++;
  state = { ...state, items: [...state.items, { kind: "assistant", id, text: "", reasoning: "", streaming: true }] };
  notify();
  return id;
}

export function appendAssistant(id: number, patch: { text?: string; reasoning?: string }): void {
  state = {
    ...state,
    items: state.items.map((it) =>
      it.kind === "assistant" && it.id === id
        ? { ...it, text: it.text + (patch.text ?? ""), reasoning: it.reasoning + (patch.reasoning ?? "") }
        : it
    ),
  };
  notify();
}

export function finishAssistant(id: number): void {
  state = {
    ...state,
    items: state.items.map((it) => (it.kind === "assistant" && it.id === id ? { ...it, streaming: false } : it)),
  };
  notify();
}

/** Drop an assistant bubble that ended with no visible text (pure tool-call turns). */
export function dropAssistantIfEmpty(id: number): void {
  state = {
    ...state,
    items: state.items.filter((it) => !(it.kind === "assistant" && it.id === id && it.text === "" && it.reasoning === "")),
  };
  notify();
}

export function addNotice(text: string): void {
  state = { ...state, items: [...state.items, { kind: "notice", id: nextId++, text }] };
  notify();
}

export function addVerify(verdict: "pass" | "issues", issues: VerifyIssue[]): void {
  state = { ...state, items: [...state.items, { kind: "verify", id: nextId++, verdict, issues }] };
  notify();
}

export function addError(text: string): void {
  state = { ...state, items: [...state.items, { kind: "error", id: nextId++, text }] };
  notify();
}

export function addToolCard(card: Omit<ToolCardModel, "id">): number {
  const id = nextId++;
  state = { ...state, items: [...state.items, { kind: "tool", id, card: { ...card, id } }] };
  notify();
  return id;
}

export function patchToolCard(id: number, patch: Partial<ToolCardModel>): void {
  state = {
    ...state,
    items: state.items.map((it) => (it.kind === "tool" && it.id === id ? { ...it, card: { ...it.card, ...patch } } : it)),
  };
  notify();
}

export function patchToolCardByStepId(stepId: string, patch: Partial<ToolCardModel>): void {
  state = {
    ...state,
    items: state.items.map((it) =>
      it.kind === "tool" && it.card.stepId === stepId ? { ...it, card: { ...it.card, ...patch } } : it
    ),
  };
  notify();
}

export function markStepsReverted(stepIds: string[]): void {
  const set = new Set(stepIds);
  state = {
    ...state,
    items: state.items.map((it) =>
      it.kind === "tool" && it.card.stepId && set.has(it.card.stepId)
        ? { ...it, card: { ...it.card, status: "reverted" } }
        : it
    ),
  };
  notify();
}

/** Pause the agent loop until the user clicks Apply / Reject on the card. */
export function awaitDecision(cardId: number, signal: AbortSignal): Promise<Decision> {
  return new Promise<Decision>((resolve, reject) => {
    const settle = (d: Decision) => {
      pendingResolver = null;
      state = { ...state, pendingCardId: null };
      notify();
      resolve(d);
    };
    pendingResolver = settle;
    state = { ...state, pendingCardId: cardId };
    notify();
    const onAbort = () => {
      if (pendingResolver === settle) {
        pendingResolver = null;
        state = { ...state, pendingCardId: null };
        notify();
      }
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function resolveDecision(d: Decision): void {
  pendingResolver?.(d);
}

export function setStreaming(on: boolean, controller: AbortController | null = null): void {
  abortController = on ? controller : null;
  state = { ...state, streaming: on };
  notify();
}

export function isStreaming(): boolean {
  return state.streaming;
}

export function stopTurn(): void {
  abortController?.abort();
  abortController = null;
  if (state.streaming || state.pendingCardId !== null) {
    state = { ...state, streaming: false, pendingCardId: null };
    notify();
  }
}

export function addUsage(prompt: number, completion: number): void {
  state = { ...state, usage: { prompt: state.usage.prompt + prompt, completion: state.usage.completion + completion } };
  notify();
}
