import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, approveScoutIntake, postJson, withFallback } from '../api';

// `fetch` is stubbed per test: these check the client's contract (what counts as a
// result, what counts as "fall back"), not the server.
const stubFetch = (impl: (url: string, init: RequestInit) => Promise<Response>) => {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const shape = z.object({ n: z.number() });

describe('postJson', () => {
  it('POSTs the body as JSON and returns the validated response', async () => {
    const fetchFn = stubFetch(async () => Response.json({ n: 1 }));
    await expect(postJson('/api/x', { a: 1 }, shape)).resolves.toEqual({ n: 1 });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/api/x');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('sends extra headers (a bearer token) without letting them replace Content-Type', async () => {
    const fetchFn = stubFetch(async () => Response.json({ n: 1 }));
    await postJson('/api/x', {}, shape, {
      headers: { Authorization: 'Bearer t.o.k', 'Content-Type': 'text/plain' },
    });

    const headers = new Headers(fetchFn.mock.calls[0][1].headers);
    expect(headers.get('Authorization')).toBe('Bearer t.o.k');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it("a non-2xx throws ApiError carrying the handler's error code", async () => {
    stubFetch(async () => Response.json({ error: 'model_timeout' }, { status: 504 }));
    await expect(postJson('/api/x', {}, shape)).rejects.toMatchObject({ code: 'model_timeout', status: 504 });
  });

  it('carries the handler\'s x-request-id so the UI can show it', async () => {
    stubFetch(async () => Response.json({ error: 'internal_error' }, { status: 500, headers: { 'x-request-id': 'sfo1::abc' } }));
    await expect(postJson('/api/x', {}, shape)).rejects.toMatchObject({ code: 'internal_error', status: 500, requestId: 'sfo1::abc' });
  });

  it('has no request id when no response arrived', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(postJson('/api/x', {}, shape)).rejects.toMatchObject({ code: 'network_error', requestId: null });
  });

  it('a non-2xx with no JSON error code falls back to http_<status>', async () => {
    stubFetch(async () => new Response('Bad gateway', { status: 502 }));
    await expect(postJson('/api/x', {}, shape)).rejects.toMatchObject({ code: 'http_502', status: 502 });
  });

  it('a network failure throws network_error with no status', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(postJson('/api/x', {}, shape)).rejects.toMatchObject({ code: 'network_error', status: null });
  });

  it('a 200 that fails the schema throws invalid_response — never a mistyped value', async () => {
    stubFetch(async () => Response.json({ n: 'one' }));
    await expect(postJson('/api/x', {}, shape)).rejects.toMatchObject({ code: 'invalid_response', status: 200 });
  });

  it('a 200 that is not JSON throws invalid_response', async () => {
    stubFetch(async () => new Response('<html>', { status: 200 }));
    await expect(postJson('/api/x', {}, shape)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('withFallback', () => {
  it('uses the primary result when it succeeds', async () => {
    const fallback = vi.fn(() => 0);
    await expect(withFallback(async () => 1, fallback)).resolves.toEqual({ data: 1, source: 'api' });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('runs the fallback on an ApiError and reports why', async () => {
    const r = await withFallback(async () => {
      throw new ApiError('model_key_missing', 503);
    }, () => 0);
    expect(r).toMatchObject({ data: 0, source: 'fallback', error: { code: 'model_key_missing' } });
  });

  it('runs the fallback on any other error too, as client_error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await withFallback(async () => {
      throw new Error('bug');
    }, () => 0);
    expect(r).toMatchObject({ source: 'fallback', error: { code: 'client_error', status: null } });
  });
});

describe('approveScoutIntake', () => {
  const reply = {
    intakeId: '11111111-1111-4111-8111-111111111111',
    businessId: '22222222-2222-4222-8222-222222222222',
    businessCreated: true,
    reviewAction: 'approved',
    finalBucket: 'Analytics & Insight',
    engagementId: '33333333-3333-4333-8333-333333333333',
    eventId: '44444444-4444-4444-8444-444444444444',
    transitionedAt: '2026-10-08T12:00:00.000Z',
    replayed: false,
  };

  it('POSTs the command with the bearer token and returns the validated reply', async () => {
    const fetchFn = stubFetch(async () => Response.json(reply, { status: 201 }));
    const body = { intakeId: reply.intakeId, idempotencyKey: 'click-0001-abcd' };
    await expect(approveScoutIntake(body, { headers: { Authorization: 'Bearer t.o.k' } })).resolves.toEqual(reply);

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/api/scout-approve');
    expect(init.body).toBe(JSON.stringify(body));
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer t.o.k');
  });

  it("surfaces the handler's 422 token so the queue can say why", async () => {
    stubFetch(async () => Response.json({ error: 'already_approved' }, { status: 422, headers: { 'x-request-id': 'r-1' } }));
    await expect(approveScoutIntake({ intakeId: reply.intakeId, idempotencyKey: 'click-0001-abcd' }))
      .rejects.toMatchObject({ code: 'already_approved', status: 422, requestId: 'r-1' });
  });

  it('rejects a 2xx whose body is not the wire shape', async () => {
    stubFetch(async () => Response.json({ ...reply, finalBucket: 'Not a bucket' }, { status: 201 }));
    await expect(approveScoutIntake({ intakeId: reply.intakeId, idempotencyKey: 'click-0001-abcd' }))
      .rejects.toMatchObject({ code: 'invalid_response' });
  });
});
