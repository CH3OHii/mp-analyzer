import { describe, expect, it } from "vitest";
import { backoffDelay, fetchWithRetry, isRetryableStatus, RETRY_BASE_MS } from "../src/llm/retry";

describe("isRetryableStatus", () => {
  it("retries 429 and 5xx only", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(200)).toBe(false);
  });
});

describe("backoffDelay", () => {
  it("doubles per attempt with injected jitter", () => {
    expect(backoffDelay(1, () => 0)).toBe(RETRY_BASE_MS);
    expect(backoffDelay(2, () => 0)).toBe(RETRY_BASE_MS * 2);
    expect(backoffDelay(3, () => 0)).toBe(RETRY_BASE_MS * 4);
    expect(backoffDelay(1, () => 1)).toBe(RETRY_BASE_MS + 250);
  });
});

describe("fetchWithRetry", () => {
  const instantSleep = async () => {};

  it("returns after transient failures recover", async () => {
    let calls = 0;
    const res = await fetchWithRetry(
      async () => {
        calls++;
        if (calls < 3) throw new TypeError("network down");
        return new Response("ok", { status: 200 });
      },
      { sleep: instantSleep }
    );
    expect(calls).toBe(3);
    expect(res.status).toBe(200);
  });

  it("retries retryable statuses and returns the final response", async () => {
    let calls = 0;
    const res = await fetchWithRetry(
      async () => {
        calls++;
        return new Response("slow down", { status: calls < 2 ? 429 : 200 });
      },
      { sleep: instantSleep }
    );
    expect(calls).toBe(2);
    expect(res.status).toBe(200);
  });

  it("returns non-retryable responses immediately", async () => {
    let calls = 0;
    const res = await fetchWithRetry(
      async () => {
        calls++;
        return new Response("bad key", { status: 401 });
      },
      { sleep: instantSleep }
    );
    expect(calls).toBe(1);
    expect(res.status).toBe(401);
  });

  it("throws the last error on exhaustion", async () => {
    let calls = 0;
    await expect(
      fetchWithRetry(
        async () => {
          calls++;
          throw new TypeError(`down ${calls}`);
        },
        { sleep: instantSleep, maxAttempts: 3 }
      )
    ).rejects.toThrow("down 3");
    expect(calls).toBe(3);
  });

  it("returns the last retryable response when attempts run out", async () => {
    const res = await fetchWithRetry(async () => new Response("nope", { status: 503 }), {
      sleep: instantSleep,
      maxAttempts: 2,
    });
    expect(res.status).toBe(503);
  });

  it("rethrows AbortError immediately without retrying", async () => {
    let calls = 0;
    await expect(
      fetchWithRetry(
        async () => {
          calls++;
          throw new DOMException("Aborted", "AbortError");
        },
        { sleep: instantSleep }
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
  });

  it("aborts promptly during backoff via the default abort-aware sleep", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await expect(
      fetchWithRetry(
        async () => {
          calls++;
          throw new TypeError("network down");
        },
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1); // aborted in the first backoff, no second attempt
  });
});
