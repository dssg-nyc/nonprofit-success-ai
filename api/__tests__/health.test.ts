import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { GET } = await import('../health');

const get = (headers: Record<string, string> = {}) =>
  GET(new Request('http://localhost/api/health', { headers }));

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'test-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/health', () => {
  it('200 when Auth answers its health endpoint, with the anon key as apikey', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, modelKeyConfigured: true, supabase: 'ok' });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:54321/auth/v1/health');
    expect((init.headers as Record<string, string>).apikey).toBe('anon-key');
  });

  it('503 supabase unreachable when the probe fails or times out', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await get();
    expect(res.status).toBe(503);
    expect((await res.json()).supabase).toBe('unreachable');
  });

  it('503 supabase unreachable on a non-2xx from Auth', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 502 }));
    expect((await get()).status).toBe(503);
  });

  it('503 supabase unconfigured without a URL, and reports the missing model key', async () => {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', '');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await get();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: true, modelKeyConfigured: false, supabase: 'unconfigured' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('echoes the request id: x-vercel-id when Vercel sent one, else a minted UUID', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const vercel = await get({ 'x-vercel-id': 'iad1::abc123' });
    expect(vercel.headers.get('x-request-id')).toBe('iad1::abc123');

    const minted = await get();
    expect(minted.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });
});
