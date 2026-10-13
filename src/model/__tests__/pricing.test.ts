import { afterEach, describe, expect, it, vi } from 'vitest';
import { costCents, priceOf } from '../pricing';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('costCents', () => {
  it('prices a listed model from its token counts, in cents to four decimals', () => {
    // gemini-3.5-flash-lite: $0.30 / $2.50 per million → 1000 in + 500 out = $0.00155 = 0.155¢
    expect(costCents('gemini-3.5-flash-lite', { inputTokens: 1_000, outputTokens: 500 })).toBe(0.155);
  });

  it('is null for an unlisted model, never 0', () => {
    expect(priceOf('made-up-model')).toBeUndefined();
    expect(costCents('made-up-model', { inputTokens: 10, outputTokens: 10 })).toBeNull();
  });

  it('is null when the provider reported no usage at all', () => {
    expect(costCents('gemini-3.5-flash-lite', {})).toBeNull();
  });

  it('treats one missing count as zero tokens of that kind', () => {
    expect(costCents('gemini-3.5-flash-lite', { inputTokens: 1_000_000 })).toBe(30);
  });

  it('GATEWAY_PRICING overrides and extends the list, ignoring malformed entries', () => {
    vi.stubEnv('GATEWAY_PRICING', JSON.stringify({ 'gemini-3.5-flash-lite': [1, 1], 'new-model': [2, 4], bad: ['x'] }));
    expect(costCents('gemini-3.5-flash-lite', { inputTokens: 1_000_000, outputTokens: 0 })).toBe(100);
    expect(priceOf('new-model')).toEqual([2, 4]);
    expect(priceOf('bad')).toBeUndefined();
  });

  it('ignores a GATEWAY_PRICING that is not JSON', () => {
    vi.stubEnv('GATEWAY_PRICING', '{nope');
    expect(priceOf('gemini-3.5-flash-lite')).toEqual([0.3, 2.5]);
  });
});
