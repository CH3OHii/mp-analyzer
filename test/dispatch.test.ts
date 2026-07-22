import { describe, expect, it } from "vitest";
import { createDispatcher } from "../src/agent/dispatch";
import type { TurnOutcome } from "../src/agent/loop";
import { dequeue, enqueue, getChat, removeQueuedAt, resetChat } from "../src/store/chatStore";

/** Dispatcher harness over a plain-array queue with scriptable outcomes. */
function harness(outcomes: TurnOutcome[]) {
  const queue: string[] = [];
  const ran: string[] = [];
  let release: (() => void) | null = null;
  let gated = false;
  const d = createDispatcher({
    run: async (text) => {
      ran.push(text);
      if (gated) await new Promise<void>((r) => (release = r));
      return outcomes[ran.length - 1] ?? "done";
    },
    enqueue: (t) => queue.push(t),
    dequeue: () => queue.shift(),
  });
  return {
    d,
    queue,
    ran,
    gate: () => (gated = true),
    ungate: () => (gated = false),
    release: () => release?.(),
    tick: () => new Promise<void>((r) => setTimeout(r, 0)),
  };
}

describe("createDispatcher", () => {
  it("drains FIFO across consecutive done turns", async () => {
    const h = harness(["done", "done", "done"]);
    h.d.sendOrQueue("a");
    h.d.sendOrQueue("b");
    h.d.sendOrQueue("c");
    await h.tick();
    expect(h.ran).toEqual(["a", "b", "c"]);
    expect(h.queue).toEqual([]);
    expect(h.d.isActive()).toBe(false);
  });

  it("halts on stopped and preserves the remaining queue", async () => {
    const h = harness(["stopped"]);
    h.d.sendOrQueue("a");
    h.d.sendOrQueue("b");
    h.d.sendOrQueue("c");
    await h.tick();
    expect(h.ran).toEqual(["a"]);
    expect(h.queue).toEqual(["b", "c"]);
    expect(h.d.isActive()).toBe(false);
  });

  it("halts on error and preserves the remaining queue", async () => {
    const h = harness(["error"]);
    h.d.sendOrQueue("a");
    h.d.sendOrQueue("b");
    await h.tick();
    expect(h.ran).toEqual(["a"]);
    expect(h.queue).toEqual(["b"]);
  });

  it("a send during an active drain is picked up by the same drain", async () => {
    const h = harness(["done", "done"]);
    h.gate();
    h.d.sendOrQueue("a"); // starts drain, run("a") now gated
    expect(h.d.isActive()).toBe(true);
    h.ungate();
    h.d.sendOrQueue("b"); // enqueued while active — no second drain
    expect(h.ran).toEqual(["a"]);
    h.release(); // finish "a" → drain continues to "b"
    await h.tick();
    expect(h.ran).toEqual(["a", "b"]);
    expect(h.d.isActive()).toBe(false);
  });

  it("a send after a halted drain resumes with the older queued items first", async () => {
    const h = harness(["stopped", "done", "done", "done"]);
    h.d.sendOrQueue("a");
    h.d.sendOrQueue("b");
    await h.tick();
    expect(h.queue).toEqual(["b"]);
    h.d.sendOrQueue("c"); // resumes: b (older) then c
    await h.tick();
    expect(h.ran).toEqual(["a", "b", "c"]);
  });
});

describe("chatStore queue ops", () => {
  it("enqueue/dequeue are FIFO and removeQueuedAt hits the right index", () => {
    resetChat();
    enqueue("one");
    enqueue("two");
    enqueue("three");
    expect(getChat().queued).toEqual(["one", "two", "three"]);
    removeQueuedAt(1);
    expect(getChat().queued).toEqual(["one", "three"]);
    expect(dequeue()).toBe("one");
    expect(getChat().queued).toEqual(["three"]);
    expect(dequeue()).toBe("three");
    expect(dequeue()).toBeUndefined();
  });

  it("resetChat clears the queue", () => {
    resetChat();
    enqueue("stale");
    resetChat();
    expect(getChat().queued).toEqual([]);
  });
});
