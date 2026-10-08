import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// One seam is replaced: Supabase (auth + the user-scoped client). The wire schemas stay
// real, so the shape a caller gets is what the handler really gives. No key, network or
// database — the function's own rules are pinned by pgTAP (rpcs.test.sql, 0008).
type Result = { data: unknown; error: { code?: string; message?: string; status?: number } | null };
const db = vi.hoisted(() => ({
  user: { data: { user: { id: 'staff-1' } }, error: null } as Result,
  tables: {} as Record<string, Result>,
  rpc: { data: null, error: null } as Result,
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  queries: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => db.user },
    from: (table: string) => {
      const query = { table, filters: [] as Array<[string, unknown]> };
      db.queries.push(query);
      const result = () => db.tables[table] ?? { data: null, error: null };
      const builder = {
        select: () => builder,
        eq: (col: string, value: unknown) => {
          query.filters.push([col, value]);
          return builder;
        },
        in: (col: string, value: unknown) => {
          query.filters.push([col, value]);
          return builder;
        },
        limit: () => builder,
        maybeSingle: async () => result(),
        // The membership list read is awaited directly.
        then: (resolve: (value: Result) => unknown) => resolve(result()),
      };
      return builder;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      db.rpcCalls.push({ fn, args });
      return db.rpc;
    },
  }),
}));

const { POST } = await import('../scout-approve');
const { scoutApproveResponseSchema } = await import('../../src/schemas');

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzdGFmZi0xIn0.c2lnbmF0dXJl';
const INTAKE_ID = 'abcd0008-0000-0000-0000-0000000000a1';
const ORG_ID = 'dddddddd-0000-0000-0000-000000000001';
const BUSINESS_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const ENGAGEMENT_ID = 'aaaaaaaa-0000-0000-0000-000000000002';
const EVENT_ID = 'aaaaaaaa-0000-0000-0000-000000000003';

const BODY = { intakeId: INTAKE_ID, idempotencyKey: 'approve-0001' };

const RPC_RESULT = {
  intake_id: INTAKE_ID,
  business_id: BUSINESS_ID,
  business_created: true,
  review_action: 'approved',
  final_bucket: 'Analytics & Insight',
  engagement_id: ENGAGEMENT_ID,
  event_id: EVENT_ID,
  transitioned_at: '2026-10-08T12:00:00.123456+00:00',
  replayed: false,
};

const post = (body: unknown, token: string | null = TOKEN) =>
  POST(
    new Request('http://localhost/api/scout-approve', {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  db.user = { data: { user: { id: 'staff-1' } }, error: null };
  db.tables = {
    scout_intakes: { data: { id: INTAKE_ID, organization_id: null }, error: null },
    organization_members: { data: [{ role: 'owner' }], error: null },
  };
  db.rpc = { data: RPC_RESULT, error: null };
  db.rpcCalls = [];
  db.queries = [];
  vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/scout-approve — auth and input', () => {
  it('401 unauthorized without a bearer token', async () => {
    const res = await post(BODY, null);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('400 invalid_input for a short idempotency key or an unknown bucket, with no lookup', async () => {
    expect((await post({ ...BODY, idempotencyKey: 'short' })).status).toBe(400);
    const res = await post({ ...BODY, finalBucket: 'Blockchain' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_input' });
    expect(db.queries).toHaveLength(0);
  });

  it('400 invalid_json for a body that is not JSON', async () => {
    const res = await post('{not json');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_json' });
  });

  it('404 intake_not_found when the intake is missing or hidden by RLS', async () => {
    db.tables.scout_intakes = { data: null, error: null };
    const res = await post(BODY);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'intake_not_found' });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('403 forbidden for a non-admin, and no RPC call', async () => {
    db.tables.organization_members = { data: [], error: null };
    const res = await post(BODY);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("scopes the membership check to the intake's organization when it has one", async () => {
    db.tables.scout_intakes = { data: { id: INTAKE_ID, organization_id: ORG_ID }, error: null };
    await post(BODY);
    const membership = db.queries.find((q) => q.table === 'organization_members');
    expect(membership?.filters).toContainEqual(['organization_id', ORG_ID]);
  });

  it('502 when the membership lookup fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.tables.organization_members = { data: null, error: { code: '08006' } };
    const res = await post(BODY);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'approve_failed' });
  });
});

describe('POST /api/scout-approve — the RPC', () => {
  it('201 with the wire shape, passing only the fields the caller sent', async () => {
    const res = await post({ ...BODY, finalBucket: 'ML / Predictive', reviewNotes: 'Strong data.' });
    expect(res.status).toBe(201);
    const body = scoutApproveResponseSchema.parse(await res.json());
    expect(body).toEqual({
      intakeId: INTAKE_ID,
      businessId: BUSINESS_ID,
      businessCreated: true,
      reviewAction: 'approved',
      finalBucket: 'Analytics & Insight',
      engagementId: ENGAGEMENT_ID,
      eventId: EVENT_ID,
      transitionedAt: '2026-10-08T12:00:00.123456+00:00',
      replayed: false,
    });
    expect(db.rpcCalls).toEqual([
      {
        fn: 'approve_scout_intake',
        args: {
          p_intake_id: INTAKE_ID,
          p_idempotency_key: 'approve-0001',
          p_final_bucket: 'ML / Predictive',
          p_review_notes: 'Strong data.',
        },
      },
    ]);
  });

  it.each([
    ['42501', 'admin only', 403, { error: 'forbidden' }],
    ['P0002', 'no intake', 404, { error: 'intake_not_found' }],
    ['55000', 'guard:intake_approved', 422, { error: 'guard_unmet', condition: 'intake_approved' }],
    ['22023', 'already_approved', 422, { error: 'already_approved' }],
    ['22023', 'bucket_required', 422, { error: 'bucket_required' }],
    ['22023', 'organization_required', 422, { error: 'organization_required' }],
    ['22023', 'idempotency key must be 8-128 characters', 400, { error: 'invalid_input' }],
    ['23505', 'duplicate key', 409, { error: 'conflict' }],
    ['08006', 'connection lost', 502, { error: 'approve_failed' }],
  ])('maps SQLSTATE %s (%s) to %s', async (code, message, status, body) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.rpc = { data: null, error: { code, message } };
    const res = await post(BODY);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
  });

  it('502 approve_failed when the RPC returns a shape the schema rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.rpc = { data: { ...RPC_RESULT, review_action: 'redirected' }, error: null };
    const res = await post(BODY);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'approve_failed' });
  });
});
