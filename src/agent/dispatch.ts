// Queue dispatcher: every send goes through the queue, and a single drain loop
// feeds runTurn one message at a time. Draining continues only across turns
// that end "done" — a Stop or an error leaves the rest of the queue visible
// and intact, so the user decides whether to resume (any new send resumes).
import * as chat from "../store/chatStore";
import type { TurnOutcome } from "./loop";

export interface DispatcherDeps {
  run(text: string): Promise<TurnOutcome>;
  enqueue(text: string): void;
  dequeue(): string | undefined;
}

export function createDispatcher(deps: DispatcherDeps) {
  // The busy guard is this flag, NOT isStreaming(): streaming flips off in
  // runTurn's finally before the drain loop advances, which would let a
  // concurrent send start a second overlapping drain in that gap.
  let active = false;

  async function drain(): Promise<void> {
    if (active) return;
    active = true;
    try {
      for (;;) {
        const next = deps.dequeue();
        if (next === undefined) return;
        const outcome = await deps.run(next);
        if (outcome !== "done") return; // stopped/error — keep remaining queue
      }
    } finally {
      active = false;
    }
  }

  return {
    /** Enqueue-then-drain: when idle this dequeues synchronously in the same
     *  tick (no chip flash); when busy the running drain picks it up. */
    sendOrQueue(text: string): void {
      deps.enqueue(text);
      void drain();
    },
    isActive: () => active,
  };
}

const dispatcher = createDispatcher({
  // Lazy import keeps this module free of the loop's Office-typed import
  // chain until the first real send.
  run: (text) => import("./loop").then((m) => m.runTurn(text)),
  enqueue: chat.enqueue,
  dequeue: chat.dequeue,
});

export const sendOrQueue = dispatcher.sendOrQueue;
