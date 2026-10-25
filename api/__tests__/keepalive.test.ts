import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { GET } = await import('../keepalive');

const get = (authorization?: string) =>
  GET(
    new Request('http://localhost/api/keepalive', {
      headers: authorization ? { authorization } : {},
    }),
  );

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('CRON_SECRET', 'cron-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/keepalive', () => {
  it('503 when CRON_SECRET is not configured, so the route cannot be called open', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await get('Bearer anything');
    expect(res.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('401 without the cron secret, and does not touch the database', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect((await get()).status).toBe(401);
    expect((await get('Bearer wrong')).status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('200 with the secret, reading one row through PostgREST as the anon role', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
    const res = await get('Bearer cron-secret');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:54321/rest/v1/users?select=id&limit=1');
    expect((init.headers as Record<string, string>).apikey).toBe('anon-key');
  });

  it('503 when the database read fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await get('Bearer cron-secret');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
  });
});
