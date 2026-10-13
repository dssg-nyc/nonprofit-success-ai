import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST } from '../engagement-transition';
import { Cleanup, business, engagement, jsonRequest, stack, staffSession } from './_stack';
import type { Stack } from './_stack';

/**
 * `POST /api/engagement-transition` against the running local stack (`make api-test`):
 * the real `transition_engagement()` (0005) with its guards, idempotency and audit
 * trail, called as a real staff session.
 *
 * The advance exercised is initial_meeting -> budget_check, whose guard is an
 * attestation (a reason). The FIRST transition is driven by `/api/scout-approve`
 * (`scout-approve.int.test.ts`), the one path that may set `businesses.scout_intake_id`;
 * here it is pinned by its 422 on a business with no intake.
 */

let s: Stack;
let cleanup: Cleanup;
let staff: { userId: string; token: string; organizationId: string };

beforeAll(async () => {
  s = stack();
  cleanup = new Cleanup(s);
  staff = await staffSession(s);
  cleanup.user(staff.userId);
  cleanup.organization(staff.organizationId);
});

afterAll(async () => {
  await cleanup.run_all();
});

const key = () => `int-${crypto.randomUUID()}`;

describe('POST /api/engagement-transition (integration)', () => {
  it('advances an open engagement with an attested guard, writes the event, and replays on the same key', async () => {
    const businessId = await business(s, staff.userId, staff.organizationId);
    const openId = await engagement(s, businessId, staff.userId, staff.organizationId, 'initial_meeting');
    const idempotencyKey = key();
    const body = { businessId, toStage: 'budget_check', reason: 'Contract signed 2026-10-01 (attested)', idempotencyKey };

    const res = await POST(jsonRequest('/api/engagement-transition', body, staff.token));
    expect(res.status).toBe(201);
    const first = await res.json();
    expect(first).toMatchObject({ fromStage: 'initial_meeting', toStage: 'budget_check', replayed: false, approvalId: null });
    expect(first.engagementId).not.toBe(openId);

    const { data: source } = await s.service.from('engagements').select('status').eq('id', openId).single();
    expect(source?.status).toBe('completed');
    const { data: target } = await s.service.from('engagements').select('stage, status').eq('id', first.engagementId).single();
    expect(target).toEqual({ stage: 'budget_check', status: 'in_progress' });
    const { data: event } = await s.service.from('engagement_events').select('kind, detail').eq('id', first.eventId).single();
    expect(event?.detail).toMatchObject({ from: 'initial_meeting', to: 'budget_check', guard_deferred: 'contract' });

    const again = await POST(jsonRequest('/api/engagement-transition', body, staff.token));
    expect(again.status).toBe(201);
    expect(await again.json()).toMatchObject({ engagementId: first.engagementId, eventId: first.eventId, replayed: true });
  });

  it('refuses the advance when the attestation is missing: 422 guard_unmet, nothing written', async () => {
    const businessId = await business(s, staff.userId, staff.organizationId);
    await engagement(s, businessId, staff.userId, staff.organizationId, 'initial_meeting');
    const res = await POST(jsonRequest('/api/engagement-transition', { businessId, toStage: 'budget_check', idempotencyKey: key() }, staff.token));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'guard_unmet', condition: 'contract_signed' });
    const { count } = await s.service.from('engagements').select('id', { count: 'exact', head: true }).eq('business_id', businessId);
    expect(count).toBe(1);
  });

  it('refuses the first transition on a business with no intake: 422 guard_unmet (scout-approve is the way in)', async () => {
    const businessId = await business(s, staff.userId, staff.organizationId);
    const res = await POST(jsonRequest('/api/engagement-transition', { businessId, toStage: 'initial_meeting', idempotencyKey: key() }, staff.token));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'guard_unmet', condition: 'intake_approved' });
  });

  it('is a 404 for a business outside the caller\'s organization', async () => {
    const other = await staffSession(s);
    cleanup.user(other.userId);
    cleanup.organization(other.organizationId);
    const businessId = await business(s, other.userId, other.organizationId);
    const res = await POST(jsonRequest('/api/engagement-transition', { businessId, toStage: 'initial_meeting', idempotencyKey: key() }, staff.token));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'business_not_found' });
  });
});
