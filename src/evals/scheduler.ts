import { GatewayError } from '../model/errors';

/**
 * Every model call an eval run makes — agent model paths and judge batches — goes
 * through one scheduler, because a run is ~75 calls against a free-tier quota and the
 * gateway's own policy (one 1s retry, sized for a live /api request) is the wrong one
 * for a batch job:
 *
 * - **Pacing.** Calls start at least `minIntervalMs` apart, so a run stays under the
 *   per-minute limit instead of burning it in the first seconds and 429ing the rest.
 * - **Retry.** `model_rate_limited`, `model_unavailable` and `model_timeout` are
 *   transient; they are retried with exponential backoff, honouring the provider's
 *   `retryAfterMs` when it gave one.
 * - **Circuit breaker.** `model_quota_exhausted` (a per-day quota) cannot clear within a
 *   run. The first one opens the circuit: every later call fails fast with the same
 *   code instead of spending the rest of the run collecting identical errors.
 * - **Sharing.** `shared(key, fn)` runs `fn` once per key. scoutRouting and
 *   scoutRationale both need Scout's model output for the same case, as do
 *   architectPlanStructure and architectCharter; each case is produced once and graded
 *   by both.
 *
 * The gateway stays as it is: a live request has a 30s budget and must fall back fast.
 */

const RETRYABLE = new Set(['model_rate_limited', 'model_unavailable', 'model_timeout']);

export interface SchedulerOptions {
  /** Minimum gap between call starts. */
  minIntervalMs: number;
  /** Retries after the first attempt, for retryable codes only. */
  maxRetries: number;
  /** Backoff before retry n (1-based) is `baseBackoffMs * 2^(n-1)`, unless the provider said. */
  baseBackoffMs: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const envNumber = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

export function defaultSchedulerOptions(): SchedulerOptions {
  return {
    // ~13 requests/minute: under the Gemini free tier's per-minute limit.
    minIntervalMs: envNumber('EVAL_MIN_INTERVAL_MS', 4_500),
    maxRetries: envNumber('EVAL_MAX_RETRIES', 3),
    baseBackoffMs: envNumber('EVAL_BACKOFF_MS', 5_000),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  };
}

export class ModelCallScheduler {
  private lastStart = Number.NEGATIVE_INFINITY;
  private exhausted: GatewayError | null = null;
  private readonly cache = new Map<string, Promise<unknown>>();
  /** Calls actually sent to the provider, retries included. */
  calls = 0;

  constructor(private readonly options: SchedulerOptions = defaultSchedulerOptions()) {}

  /** The error that opened the circuit, or null while calls are still being made. */
  get quotaExhausted(): GatewayError | null {
    return this.exhausted;
  }

  /** Run `fn` paced and retried. Throws what `fn` threw once retries are spent. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      if (this.exhausted) throw this.exhausted;
      await this.pace();
      try {
        return await fn();
      } catch (err) {
        if (!(err instanceof GatewayError)) throw err;
        if (err.code === 'model_quota_exhausted') {
          this.exhausted = err;
          throw err;
        }
        if (!RETRYABLE.has(err.code) || attempt >= this.options.maxRetries) throw err;
        const backoff = err.retryAfterMs ?? this.options.baseBackoffMs * 2 ** attempt;
        console.error(`eval scheduler: ${err.code}, retry ${attempt + 1}/${this.options.maxRetries} in ${backoff}ms`);
        await this.options.sleep(backoff);
      }
    }
  }

  /** `run(fn)` once per key; later callers with the same key get the same result or error. */
  shared<T>(key: string, fn: () => Promise<T>): Promise<T> {
    let pending = this.cache.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = this.run(fn);
      this.cache.set(key, pending);
    }
    return pending;
  }

  private async pace(): Promise<void> {
    const wait = this.lastStart + this.options.minIntervalMs - this.options.now();
    if (wait > 0) await this.options.sleep(wait);
    this.lastStart = this.options.now();
    this.calls += 1;
  }
}

/** The run's scheduler. grade.ts is one process per run; tests replace it with `resetScheduler()`. */
let current = new ModelCallScheduler();

export function scheduler(): ModelCallScheduler {
  return current;
}

export function resetScheduler(options?: SchedulerOptions): ModelCallScheduler {
  current = new ModelCallScheduler(options);
  return current;
}
