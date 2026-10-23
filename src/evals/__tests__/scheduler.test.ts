import { afterEach, describe, expect, it, vi } from 'vitest';
import { GatewayError } from '../../model/errors';
import { ModelCallScheduler } from '../scheduler';
import type { SchedulerOptions } from '../scheduler';

/** A scheduler on a fake clock: `sleep` advances `now` and records each wait. */
function fakeScheduler(over: Partial<SchedulerOptions> = {}) {
  let clock = 0;
  const waits: number[] = [];
  const scheduler = new ModelCallScheduler({
    minIntervalMs: 1_000,
    maxRetries: 2,
    baseBackoffMs: 100,
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
    now: () => clock,
    ...over,
  });
  return { scheduler, waits };
}

const gwError = (code: ConstructorParameters<typeof GatewayError>[0], retryAfterMs?: number) => {
  const err = new GatewayError(code, 500, code);
  err.retryAfterMs = retryAfterMs;
  return err;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ModelCallScheduler', () => {
  it('starts calls at least minIntervalMs apart', async () => {
    const { scheduler, waits } = fakeScheduler();
    await scheduler.run(async () => 1);
    await scheduler.run(async () => 2);
    expect(waits).toEqual([1_000]);
    expect(scheduler.calls).toBe(2);
  });

  it('retries a transient error with exponential backoff, then succeeds', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { scheduler, waits } = fakeScheduler({ minIntervalMs: 0 });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(gwError('model_unavailable'))
      .mockRejectedValueOnce(gwError('model_timeout'))
      .mockResolvedValue('ok');
    await expect(scheduler.run(fn)).resolves.toBe('ok');
    expect(waits).toEqual([100, 200]);
  });

  it("waits the provider's retryAfterMs on a rate limit when it gave one", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { scheduler, waits } = fakeScheduler({ minIntervalMs: 0 });
    const fn = vi.fn().mockRejectedValueOnce(gwError('model_rate_limited', 33_000)).mockResolvedValue('ok');
    await scheduler.run(fn);
    expect(waits).toEqual([33_000]);
  });

  it('gives up after maxRetries and throws the last error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { scheduler } = fakeScheduler({ minIntervalMs: 0 });
    const fn = vi.fn().mockRejectedValue(gwError('model_rate_limited'));
    await expect(scheduler.run(fn)).rejects.toMatchObject({ code: 'model_rate_limited' });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-transient error', async () => {
    const { scheduler } = fakeScheduler();
    const fn = vi.fn().mockRejectedValue(gwError('model_parse_error'));
    await expect(scheduler.run(fn)).rejects.toMatchObject({ code: 'model_parse_error' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('opens the circuit on a daily-quota error: later calls fail fast without being sent', async () => {
    const { scheduler } = fakeScheduler();
    await expect(scheduler.run(async () => Promise.reject(gwError('model_quota_exhausted')))).rejects.toMatchObject({
      code: 'model_quota_exhausted',
    });
    const next = vi.fn().mockResolvedValue('never');
    await expect(scheduler.run(next)).rejects.toMatchObject({ code: 'model_quota_exhausted' });
    expect(next).not.toHaveBeenCalled();
    expect(scheduler.quotaExhausted?.code).toBe('model_quota_exhausted');
  });

  it('shared() runs once per key', async () => {
    const { scheduler } = fakeScheduler({ minIntervalMs: 0 });
    const fn = vi.fn().mockResolvedValue('out');
    const [a, b] = await Promise.all([scheduler.shared('k', fn), scheduler.shared('k', fn)]);
    expect([a, b]).toEqual(['out', 'out']);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
