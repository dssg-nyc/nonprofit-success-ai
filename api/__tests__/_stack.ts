import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../src/lib/database.types';

/**
 * Fixtures for the integration suite (`*.int.test.ts`, `make api-test`): the local
 * Supabase stack reached the way production is — anon key + a real session for the
 * handler under test, and the service role only here, to seed and to read back what the
 * handler filed. No handler ever sees the service client.
 *
 * Every row a test creates is registered with `cleanup()` and removed in `afterAll`, so
 * the suite leaves the database as it found it. Ids are random, never fixed, so a
 * crashed run cannot collide with the next one.
 */

export type ServiceClient = SupabaseClient<Database>;

export interface Stack {
  url: string;
  anonKey: string;
  service: ServiceClient;
}

/**
 * The stack from the environment `make api-test` exports (`supabase status -o env`).
 * Throws rather than skipping: a suite that silently ran zero assertions is the failure
 * mode `db-test`'s zero-tests guard exists to prevent.
 */
export function stack(): Stack {
  const url = process.env.SUPABASE_URL?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anonKey || !serviceKey) {
    throw new Error(
      'integration: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must point at the local stack — run `make api-test`',
    );
  }
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url)) {
    throw new Error(`integration: refusing to run against a non-local SUPABASE_URL (${url})`);
  }
  const service = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { url, anonKey, service };
}

/** A fresh anonymous session, as the public intake form opens one. */
export async function anonymousSession(s: Stack): Promise<{ userId: string; token: string }> {
  const client = createClient<Database>(s.url, s.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.session || !data.user) throw new Error(`integration: anonymous sign-in failed: ${error?.message}`);
  return { userId: data.user.id, token: data.session.access_token };
}

/**
 * A staff account: a confirmed email+password user (profile row via `handle_new_user`),
 * owner of a fresh organization, signed in. `is_admin()` is true for it.
 */
export async function staffSession(s: Stack): Promise<{ userId: string; token: string; organizationId: string }> {
  const email = `staff-${crypto.randomUUID()}@example.test`;
  const password = crypto.randomUUID();
  const { data: created, error: createErr } = await s.service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) throw new Error(`integration: createUser failed: ${createErr?.message}`);
  const userId = created.user.id;

  const { data: org, error: orgErr } = await s.service
    .from('organizations')
    .insert({ name: `Integration Org ${userId.slice(0, 8)}` })
    .select('id')
    .single();
  if (orgErr || !org) throw new Error(`integration: organization insert failed: ${orgErr?.message}`);
  const { error: memberErr } = await s.service
    .from('organization_members')
    .insert({ organization_id: org.id, user_id: userId, role: 'owner' });
  if (memberErr) throw new Error(`integration: membership insert failed: ${memberErr.message}`);

  const client = createClient<Database>(s.url, s.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`integration: sign-in failed: ${error?.message}`);
  return { userId, token: data.session.access_token, organizationId: org.id };
}

/**
 * A pending intake, filed the way the public form files it: an anonymous session calling
 * `submit_scout_intake()` (0007). Returns the session too, so a test can act as the
 * submitter. The routing result is the deterministic shape, so the row files as L3.
 */
export async function intake(s: Stack): Promise<{ intakeId: string; userId: string; token: string }> {
  const session = await anonymousSession(s);
  const client = createClient<Database>(s.url, s.anonKey, {
    global: { headers: { Authorization: `Bearer ${session.token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.rpc('submit_scout_intake', {
    p_intake: {
      org_name: `Integration Intake ${session.userId.slice(0, 8)}`,
      contact_name_role: 'Sam Lee, ED',
      contact_email: 'sam@example.test',
      mission: 'Food access.',
      scale: '12 sites',
      primary_need: 'analyze_data',
      problem_description: 'Cannot see shortages.',
      current_systems: 'Spreadsheets',
      timeline: 'Next quarter',
      referral_source: 'Referral',
      bucket: 'Analytics & Insight',
      confidence: 'High',
      rationale: 'Clear need.',
      poc_score: 3,
      clarity_score: 3,
      foothold_score: 3,
      composite_signal: 'Ready',
      flags: [],
    },
  });
  const intakeId = (data as { intake_id?: string } | null)?.intake_id;
  if (error || !intakeId) throw new Error(`integration: submit_scout_intake failed: ${error?.message}`);
  return { intakeId, ...session };
}

/**
 * A business owned by `ownerId` in `organizationId`, with no intake. The link
 * (`businesses.scout_intake_id`) is writable only by a non-API role (0001_core trigger):
 * a test that needs a business in the pipeline opens it through `/api/scout-approve`
 * (`scout-approve.int.test.ts`) rather than inserting one.
 */
export async function business(s: Stack, ownerId: string, organizationId: string): Promise<string> {
  const { data, error } = await s.service
    .from('businesses')
    .insert({
      name: 'Integration Business',
      type: 'nonprofit',
      owner_id: ownerId,
      organization_id: organizationId,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`integration: business insert failed: ${error?.message}`);
  return data.id;
}

/** An open engagement at `stage` on `businessId`, as the lifecycle command would leave it. */
export async function engagement(
  s: Stack,
  businessId: string,
  ownerId: string,
  organizationId: string,
  stage: Database['public']['Enums']['engagement_stage'] = 'initial_meeting',
): Promise<string> {
  const { data, error } = await s.service
    .from('engagements')
    .insert({ business_id: businessId, owner_id: ownerId, organization_id: organizationId, stage, status: 'in_progress' })
    .select('id')
    .single();
  if (error || !data) throw new Error(`integration: engagement insert failed: ${error?.message}`);
  return data.id;
}

/**
 * Tears down what a file created, in dependency order: the organization's businesses
 * (engagements and events cascade), then intakes, then the organization, then the auth
 * users (profiles and memberships cascade). Never throws: a cleanup failure must not
 * mask the test's own result, but it is printed so a leak is noticed.
 *
 * What stays behind, on purpose, because no API role may delete it: `agent_runs` is
 * append-only (observability.md) — the runs a file seeds stay, tagged model
 * `integration-model`, as an eval run's do; `model_call_budget` is pruned by
 * `check_model_budget()` itself after a day; and `audit_events` pins the organization
 * and user of any file that made a lifecycle transition. Every leftover is scoped by a
 * fresh id, so it cannot change a later result; `make db-reset` clears them all.
 */
export class Cleanup {
  private userIds: string[] = [];
  private organizationIds: string[] = [];
  private intakeIds: string[] = [];
  constructor(private readonly s: Stack) {}

  user(id: string): void { this.userIds.push(id); }
  organization(id: string): void { this.organizationIds.push(id); }
  intake(id: string): void { this.intakeIds.push(id); }

  async run_all(): Promise<void> {
    const { service } = this.s;
    const none = { error: null };
    const steps: Array<() => Promise<{ error: { message: string } | null }>> = [
      async () => (this.organizationIds.length ? await service.from('businesses').delete().in('organization_id', this.organizationIds) : none),
      async () => (this.intakeIds.length ? await service.from('scout_intakes').delete().in('id', this.intakeIds) : none),
      async () => (this.organizationIds.length ? await service.from('organizations').delete().in('id', this.organizationIds) : none),
    ];
    let pinned = false;
    for (const step of steps) {
      const { error } = await step();
      if (!error) continue;
      if (error.message.includes('audit_events')) pinned = true;
      else console.error('integration cleanup:', error.message);
    }
    for (const id of this.userIds) {
      const { error } = await this.s.service.auth.admin.deleteUser(id);
      if (!error) continue;
      if (pinned) continue; // the same audit rows reference the actor
      console.error('integration cleanup: deleteUser', error.message);
    }
    if (pinned) console.info('integration cleanup: an organization and its staff user stay, pinned by the append-only audit trail (make db-reset clears them)');
  }
}

export const jsonRequest = (path: string, body: unknown, token?: string, method = 'POST'): Request =>
  new Request(`http://localhost${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

export const getRequest = (path: string, token?: string): Request =>
  new Request(`http://localhost${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
