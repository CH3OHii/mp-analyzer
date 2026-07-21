// Transient-failure retry for provider calls. The backoff math is pure and
// unit-tested; fetchWithRetry only retries BEFORE a response body is consumed,
// so a stream that already started is never silently restarted.

export const RETRY_MAX_ATTEMPTS = 3;
export const RETRY_BASE_MS = 500;
export const RETRY_JITTER_MS = 250;

export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Delay before the retry that follows failed attempt `attempt` (1-based). */
export function backoffDelay(attempt: number, jitterFn: () => number = Math.random): number {
  return RETRY_BASE_MS * 2 ** (attempt - 1) + Math.floor(jitterFn() * RETRY_JITTER_MS);
}

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const onAbort = () => {
      clearTimeout(id);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Run doFetch, retrying on network errors and 429/5xx responses with
 *  exponential backoff. Non-retryable responses (400/401/…) are returned
 *  as-is for the caller's own error handling. Abort is honored immediately,
 *  including mid-backoff. */
export async function fetchWithRetry(
  doFetch: () => Promise<Response>,
  opts: {
    maxAttempts?: number;
    signal?: AbortSignal;
    jitterFn?: () => number;
    /** Injectable for tests; defaults to an abort-aware setTimeout sleep. */
    sleep?: (ms: number) => Promise<void>;
  } = {}
): Promise<Response> {
  const max = Math.max(1, opts.maxAttempts ?? RETRY_MAX_ATTEMPTS);
  const sleep = opts.sleep ?? ((ms: number) => abortableSleep(ms, opts.signal));
  let lastErr: unknown = new Error("fetch failed");
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      const res = await doFetch();
      if (!isRetryableStatus(res.status) || attempt === max) return res;
      lastErr = new Error(`HTTP ${res.status}`);
      try {
        void res.body?.cancel();
      } catch {
        /* body already consumed/locked — ignore */
      }
    } catch (e) {
      if (isAbortError(e) || attempt === max) throw e;
      lastErr = e;
    }
    await sleep(backoffDelay(attempt, opts.jitterFn));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
