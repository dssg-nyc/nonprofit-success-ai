import { afterEach, describe, expect, it, vi } from 'vitest';

import { addLogSink, log } from '../../src/observability/log';
import type { LogLine } from '../../src/observability/log';
import { handler } from '../_request';

afterEach(() => {
  vi.restoreAllMocks();
});

const call = (fn: (request: Request) => Response | Promise<Response>, headers: Record<string, string> = {}) =>
  handler('test-route', fn)(new Request('http://localhost/api/test', { headers }));

describe('handler()', () => {
  it('stamps requestId and route on every line logged inside the handler', async () => {
    const lines: LogLine[] = [];
    const remove = addLogSink((line) => lines.push(line));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await call(
        async () => {
          await Promise.resolve();
          log('error', 'route_failure', { step: 'lookup', code: 'PGRST116' });
          return Response.json({ ok: true });
        },
        { 'x-vercel-id': 'sfo1::req-1' },
      );
    } finally {
      remove();
    }
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ requestId: 'sfo1::req-1', route: 'test-route', step: 'lookup', code: 'PGRST116' });
  });

  it('keeps each concurrent request\'s id to itself', async () => {
    const seen: string[] = [];
    const fn = async (request: Request) => {
      await new Promise((r) => setTimeout(r, request.headers.get('x-vercel-id') === 'a' ? 5 : 0));
      return Response.json({});
    };
    const [a, b] = await Promise.all([call(fn, { 'x-vercel-id': 'a' }), call(fn, { 'x-vercel-id': 'b' })]);
    seen.push(a.headers.get('x-request-id')!, b.headers.get('x-request-id')!);
    expect(seen).toEqual(['a', 'b']);
  });

  it('turns an escaped throw into a logged 500 internal_error with the id, never the message', async () => {
    const lines: LogLine[] = [];
    const remove = addLogSink((line) => lines.push(line));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let res: Response;
    try {
      res = await call(() => {
        throw new TypeError('secret intake text');
      }, { 'x-vercel-id': 'x' });
    } finally {
      remove();
    }
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal_error' });
    expect(res.headers.get('x-request-id')).toBe('x');
    expect(lines[0]).toMatchObject({ event: 'route_failure', step: 'unhandled', errorName: 'TypeError', requestId: 'x' });
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secret intake text');
  });

  it('preserves the handler\'s status, body and headers', async () => {
    const res = await call(() => Response.json({ error: 'nope' }, { status: 409, headers: { 'WWW-Authenticate': 'Bearer' } }));
    expect(res.status).toBe(409);
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer');
    expect(await res.json()).toEqual({ error: 'nope' });
  });
});
