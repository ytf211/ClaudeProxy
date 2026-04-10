import { logger } from "./logger";

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Return true if this error should trigger a retry */
  shouldRetry?: (err: unknown) => boolean;
}

const DEFAULT_OPTS: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
  shouldRetry: defaultShouldRetry,
};

function defaultShouldRetry(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // Retry on network errors
    if (["econnreset", "econnrefused", "etimedout", "socket hang up", "network"].some(k => msg.includes(k))) return true;
    // Retry on 5xx errors from provider SDKs
    if (msg.includes("500") || msg.includes("502") || msg.includes("503") || msg.includes("529")) return true;
  }
  // SDK status codes (Anthropic/OpenAI SDK errors carry .status)
  const status = (err as Record<string, unknown>).status as number | undefined;
  if (status && status >= 500) return true;
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry fn with exponential backoff (1s → 2s → 4s).
 * Only retries on 5xx / network errors, never on 4xx.
 * Non-streaming only — do not wrap SSE generators.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
  label = "request",
): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs, shouldRetry } = { ...DEFAULT_OPTS, ...opts };

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !shouldRetry(err)) throw err;

      const backoff = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      logger.warn({ label, attempt, backoff, err: err instanceof Error ? err.message : String(err) },
        `Retrying ${label} in ${backoff}ms (attempt ${attempt}/${maxAttempts})`);
      await delay(backoff);
    }
  }
  throw lastErr;
}
