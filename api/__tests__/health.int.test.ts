import { describe, expect, it } from 'vitest';

import { GET } from '../health';
import { getRequest, stack } from './_stack';

/** `GET /api/health` against the running local stack (`make api-test`). */
describe('GET /api/health (integration)', () => {
  stack();

  it('answers 200 with supabase: ok and a request id when Auth is reachable', async () => {
    const res = await GET(getRequest('/api/health'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, supabase: 'ok' });
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });
});
