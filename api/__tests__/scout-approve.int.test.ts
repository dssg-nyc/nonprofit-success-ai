import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as transition } from '../engagement-transition';
import { POST } from '../scout-approve';
import { Cleanup, intake, jsonRequest, stack, staffSession } from './_stack';
import type { Stack } from './_stack';

/**
 * `POST /api/scout-approve` against the running local stack (`make api-test`): the real
 * `approve_scout_intake()` (0008) reviewing a real intake filed by `submit_scout_intake()`
 * as the public form does, creating the business the trigger lets only it link, and
 * opening `initial_meeting` through `transition_engagement()` — the first transition,
 * reached from `/api` as a real staff session.
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

describe('POST /api/scout-approve (integration)', () => {
  it('reviews a pending intake, creates the linked business, opens initial_meeting, and replays on the same key', async () => {
    const filed = await intake(s);
    cleanup.user(filed.userId);
    cleanup.intake(filed.intakeId);
    const idempotencyKey = key();
    const body = { intakeId: filed.intakeId, idempotencyKey, reviewNotes: 'Approved in the integration suite' };

    const res = await POST(jsonRequest('/api/scout-approve', body, staff.token));
    expect(res.status).toBe(201);
    const first = await res.json();
    expect(first).toMatchObject({ intakeId: filed.intakeId, businessCreated: true, reviewAction: 'approved', replayed: false });

    const { data: row } = await s.service
      .from('scout_intakes')
      .select('review_status, review_action, final_bucket, reviewed_by, organization_id, review_notes')
      .eq('id', filed.intakeId)
      .single();
    expect(row).toMatchObject({
      review_status: 'reviewed',
      review_action: 'approved',
      final_bucket: first.finalBucket,
      reviewed_by: staff.userId,
      organization_id: staff.organizationId,
      review_notes: 'Approved in the integration suite',
    });
    const { data: business } = await s.service
      .from('businesses')
      .select('scout_intake_id, owner_id, organization_id, type')
      .eq('id', first.businessId)
      .single();
    expect(business).toEqual({ scout_intake_id: filed.intakeId, owner_id: staff.userId, organization_id: staff.organizationId, type: 'nonprofit' });
    const { data: engagement } = await s.service
      .from('engagements')
      .select('business_id, stage, status')
      .eq('id', first.engagementId)
      .single();
    expect(engagement).toEqual({ business_id: first.businessId, stage: 'initial_meeting', status: 'in_progress' });
    const { data: event } = await s.service.from('engagement_events').select('kind, idempotency_key, detail').eq('id', first.eventId).single();
    expect(event).toMatchObject({ kind: 'stage_advanced', idempotency_key: idempotencyKey });
    expect(event?.detail).toMatchObject({ to: 'initial_meeting', evidence: { scout_intake_id: filed.intakeId } });

    const again = await POST(jsonRequest('/api/scout-approve', body, staff.token));
    expect(again.status).toBe(201);
    expect(await again.json()).toMatchObject({ businessId: first.businessId, engagementId: first.engagementId, eventId: first.eventId, businessCreated: false, replayed: true });

    const fresh = await POST(jsonRequest('/api/scout-approve', { intakeId: filed.intakeId, idempotencyKey: key() }, staff.token));
    expect(fresh.status).toBe(422);
    expect(await fresh.json()).toEqual({ error: 'already_approved' });
  });

  it('the business it opened can then advance through /api/engagement-transition', async () => {
    const filed = await intake(s);
    cleanup.user(filed.userId);
    cleanup.intake(filed.intakeId);
    const approved = await (await POST(jsonRequest('/api/scout-approve', { intakeId: filed.intakeId, idempotencyKey: key(), finalBucket: 'ML / Predictive' }, staff.token))).json();
    expect(approved).toMatchObject({ reviewAction: 'edited', finalBucket: 'ML / Predictive' });

    const res = await transition(jsonRequest('/api/engagement-transition', { businessId: approved.businessId, toStage: 'budget_check', reason: 'Contract signed (attested)', idempotencyKey: key() }, staff.token));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ fromStage: 'initial_meeting', toStage: 'budget_check', replayed: false });
  });

  it('refuses an intake the review queue redirected: 422 guard_unmet, no business created', async () => {
    const filed = await intake(s);
    cleanup.user(filed.userId);
    cleanup.intake(filed.intakeId);
    const { error } = await s.service
      .from('scout_intakes')
      .update({ review_status: 'reviewed', review_action: 'redirected', final_bucket: 'Advisory / Strategy', reviewed_at: new Date().toISOString(), organization_id: staff.organizationId })
      .eq('id', filed.intakeId);
    expect(error).toBeNull();

    const res = await POST(jsonRequest('/api/scout-approve', { intakeId: filed.intakeId, idempotencyKey: key() }, staff.token));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'guard_unmet', condition: 'intake_approved' });
    const { count } = await s.service.from('businesses').select('id', { count: 'exact', head: true }).eq('scout_intake_id', filed.intakeId);
    expect(count).toBe(0);
  });

  it('is a 404 for the anonymous session that filed the intake (RLS hides the row), and a 401 with no token', async () => {
    const filed = await intake(s);
    cleanup.user(filed.userId);
    cleanup.intake(filed.intakeId);
    const body = { intakeId: filed.intakeId, idempotencyKey: key() };
    // scout_intakes is admin-only through RLS, so the submitter cannot even see the row.
    const res = await POST(jsonRequest('/api/scout-approve', body, filed.token));
    expect(res.status).toBe(404);
    expect((await POST(jsonRequest('/api/scout-approve', body))).status).toBe(401);
  });

  it('is a 404 for an intake filed under another organization', async () => {
    const other = await staffSession(s);
    cleanup.user(other.userId);
    cleanup.organization(other.organizationId);
    const filed = await intake(s);
    cleanup.user(filed.userId);
    cleanup.intake(filed.intakeId);
    await s.service.from('scout_intakes').update({ organization_id: other.organizationId }).eq('id', filed.intakeId);

    const res = await POST(jsonRequest('/api/scout-approve', { intakeId: filed.intakeId, idempotencyKey: key() }, staff.token));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'intake_not_found' });
  });
});
