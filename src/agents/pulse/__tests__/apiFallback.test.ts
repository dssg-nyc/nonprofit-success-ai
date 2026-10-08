import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPulse, withFallback } from '../../../lib/api';
import type { PulseInput } from '../../../types/pulse';
import { computePulseSignal } from '../health';

// Pulse through `/api/pulse-health` with the heuristic fallback. Lives with Pulse because
// `lib/` may not import agent code. `fetch` is stubbed; the handler half is
// api/__tests__/pulse-health.test.ts.
const stubFetch = (impl: (url: string, init?: RequestInit) => Promise<Response>) => {
  const mock = vi.fn(impl);
  vi.stubGlobal('fetch', mock);
  return mock;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const ID = 'eeeeeeee-0000-4000-8000-000000000001';
const INPUT: PulseInput = {
  engagementId: ID,
  stage: 'scoping',
  daysSinceLastEvent: 3,
  daysInStage: 10,
  lastEventWasBlocker: false,
  hasPlan: true,
};
const pulse = () =>
  withFallback(
    () => fetchPulse(ID),
    () => computePulseSignal(INPUT),
  );

describe('Pulse through /api with the heuristic fallback', () => {
  it('takes the API result when it validates', async () => {
    const signal = { ...computePulseSignal(INPUT), reasons: ['from the api'] };
    stubFetch(async () => Response.json(signal));
    await expect(pulse()).resolves.toEqual({ data: signal, source: 'api' });
  });

  it('falls back to computePulseSignal() on 404 with the handler code', async () => {
    stubFetch(async () => Response.json({ error: 'not_found' }, { status: 404 }));
    const r = await pulse();
    expect(r).toMatchObject({ source: 'fallback', error: { code: 'not_found', status: 404 } });
    expect(r.data).toMatchObject({ ...computePulseSignal(INPUT), computedAt: expect.any(String) });
  });

  it('rejects a 200 body missing computedAt as invalid_response', async () => {
    const partial: Partial<ReturnType<typeof computePulseSignal>> = computePulseSignal(INPUT);
    delete partial.computedAt;
    stubFetch(async () => Response.json(partial));
    const r = await pulse();
    expect(r).toMatchObject({ source: 'fallback', error: { code: 'invalid_response' } });
  });

  it('GETs a URL with the id encoded and no body', async () => {
    const mock = stubFetch(async () => Response.json(computePulseSignal(INPUT)));
    await fetchPulse('a b/c');
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/pulse-health?engagementId=a%20b%2Fc');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.headers).not.toHaveProperty('Content-Type');
  });
});
