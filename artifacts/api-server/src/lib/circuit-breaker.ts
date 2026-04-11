import { logger } from "./logger";

type CBState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  successThreshold?: number;
  recoveryTimeoutMs?: number;
}

export class CircuitBreaker {
  private state: CBState = "CLOSED";
  private failures = 0;
  private successes = 0;
  private openedAt = 0;
  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly recoveryTimeoutMs: number;

  constructor(
    private readonly name: string,
    opts: CircuitBreakerOptions = {},
  ) {
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.successThreshold = opts.successThreshold ?? 1;
    this.recoveryTimeoutMs = opts.recoveryTimeoutMs ?? 30_000;
  }

  get isOpen(): boolean {
    return this.state === "OPEN" && Date.now() - this.openedAt < this.recoveryTimeoutMs;
  }

  private transition(to: CBState) {
    logger.info({ provider: this.name, from: this.state, to }, "Circuit breaker state change");
    this.state = to;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.openedAt >= this.recoveryTimeoutMs) {
        this.transition("HALF_OPEN");
        this.successes = 0;
      } else {
        throw new CircuitOpenError(this.name);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      throw err;
    }
  }

  private onSuccess() {
    this.failures = 0;
    if (this.state === "HALF_OPEN") {
      this.successes++;
      if (this.successes >= this.successThreshold) {
        this.transition("CLOSED");
      }
    }
  }

  private onFailure(err: unknown) {
    const status = (err as Record<string, unknown>).status as number | undefined;
    if (status && status >= 400 && status < 500) return;

    this.failures++;
    if (this.state === "HALF_OPEN" || this.failures >= this.failureThreshold) {
      this.openedAt = Date.now();
      this.failures = 0;
      this.transition("OPEN");
    }
  }

  getState(): CBState { return this.state; }
  getFailures(): number { return this.failures; }
}

export class CircuitOpenError extends Error {
  readonly status = 503;
  constructor(provider: string) {
    super(`Provider "${provider}" is temporarily unavailable (circuit open). Please retry shortly.`);
    this.name = "CircuitOpenError";
  }
}

export const breakers = {
  anthropic: new CircuitBreaker("anthropic", { failureThreshold: 5, recoveryTimeoutMs: 30_000 }),
  openai:    new CircuitBreaker("openai",    { failureThreshold: 5, recoveryTimeoutMs: 30_000 }),
  gemini:    new CircuitBreaker("gemini",    { failureThreshold: 5, recoveryTimeoutMs: 30_000 }),
};
