import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GET } from '../pulse-health';
import { Cleanup, anonymousSession, business, engagement, getRequest, stack, staffSession } from './_stack';
import type { Stack } from './_stack';

/**
 * `GET /api/pulse-health` against the running local stack (`make api-test`): the
 * handler reads as the caller, so RLS decides who sees the engagement. No model.
 */

let s: Stack;
let cleanup: Cleanup;
let staffToken: string;
let engagementId: string;

beforeAll(async () => {
  s = stack();
  cleanup = new Cleanup(s);
  const staff = await staffSession(s);
  cleanup.user(staff.userId);
  cleanup.organization(staff.organizationId);
  staffToken = staff.token;

  const businessId = await business(s, staff.userId, staff.organizationId);
  engagementId = await engagement(s, businessId, staff.userId, staff.organizationId);
});

afterAll(async () => {
  await cleanup.run_all();
});

describe('GET /api/pulse-health (integration)', () => {
  it('computes the signal for an engagement the caller can see', async () => {
    const res = await GET(getRequest(`/api/pulse-health?engagementId=${engagementId}`, staffToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ engagementId, hasPlan: false, daysSinceLastEvent: null });
    expect(['on_track', 'at_risk', 'stalled']).toContain(body.status);
    expect(body.reasons.length).toBeGreaterThan(0);
  });

  it('is a 404 for a session RLS does not let see the engagement', async () => {
    const anon = await anonymousSession(s);
    cleanup.user(anon.userId);
    const res = await GET(getRequest(`/api/pulse-health?engagementId=${engagementId}`, anon.token));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('is a 401 with no session', async () => {
    const res = await GET(getRequest(`/api/pulse-health?engagementId=${engagementId}`));
    expect(res.status).toBe(401);
  });
});
