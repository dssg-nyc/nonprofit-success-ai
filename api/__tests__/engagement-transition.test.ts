import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// One seam is replaced: Supabase (auth + the user-scoped client). The lifecycle derivation
// and the wire schemas stay real, so a pre-check answer is what the handler really gives.
// No key, network or database.
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
        maybeSingle: async () => result(),
        // A list read (`engagements`) is awaited directly.
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

const { POST } = await import('../engagement-transition');
const { engagementTransitionResponseSchema } = await import('../../src/schemas');

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzdGFmZi0xIn0.c2lnbmF0dXJl';
const BUSINESS_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const ORG_ID = 'dddddddd-0000-0000-0000-000000000001';
const TARGET_ROW = 'aaaaaaaa-0000-0000-0000-000000000002';
const EVENT_ID = 'aaaaaaaa-0000-0000-0000-000000000003';
const APPROVAL_ID = 'aaaaaaaa-0000-0000-0000-000000000004';

const BODY = {
  businessId: BUSINESS_ID,
  toStage: 'data_ethics_committee',
  idempotencyKey: 'transition-0001',
};

const ROWS = [
  { id: 'r1', stage: 'initial_meeting', status: 'completed' },
  { id: 'r2', stage: 'budget_check', status: 'in_progress' },
];

const RPC_RESULT = {
  engagement_id: TARGET_ROW,
  from_stage: 'budget_check',
  to_stage: 'data_ethics_committee',
  transitioned_at: '2026-10-07T12:00:00.123456+00:00',
  event_id: EVENT_ID,
  approval_id: null,
  replayed: false,
};

const post = (body: unknown, token: string | null = TOKEN) =>
  POST(
    new Request('http://localhost/api/engagement-transition', {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  db.user = { data: { user: { id: 'staff-1' } }, error: null };
  db.tables = {
    businesses: { data: { id: BUSINESS_ID, organization_id: ORG_ID }, error: null },
    organization_members: { data: { role: 'admin' }, error: null },
    engagement_events: { data: null, error: null },
    engagements: { data: ROWS, error: null },
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

describe('POST /api/engagement-transition — auth and input', () => {
  it('401 unauthorized without a bearer token', async () => {
    const res = await post(BODY, null);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('400 invalid_input for an unknown stage, with no lookup', async () => {
    const res = await post({ ...BODY, toStage: 'kickoff' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_input' });
    expect(db.queries).toHaveLength(0);
  });

  it('400 invalid_json for a body that is not JSON', async () => {
    const res = await post('{not json');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_json' });
  });

  it('404 business_not_found when the business is missing or hidden by RLS', async () => {
    db.tables.businesses = { data: null, error: null };
    const res = await post(BODY);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'business_not_found' });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('403 forbidden for a non-admin (a partner), and no RPC call', async () => {
    db.tables.organization_members = { data: null, error: null };
    const res = await post(BODY);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('502 when the membership lookup fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.tables.organization_members = { data: null, error: { code: '08006' } };
    const res = await post(BODY);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'transition_failed' });
  });
});

describe('POST /api/engagement-transition — pre-checks (no RPC)', () => {
  it('422 stage_skipped when the target is not the immediate successor', async () => {
    const res = await post({ ...BODY, toStage: 'scoping' });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'stage_skipped' });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('422 invalid_transition when the target is the current stage', async () => {
    const res = await post({ ...BODY, toStage: 'budget_check' });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'invalid_transition' });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('422 reason_required for a reversal without a reason', async () => {
    const res = await post({ ...BODY, toStage: 'initial_meeting' });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'reason_required' });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('422 reason_required for a whitespace-only reason (trimmed by the schema)', async () => {
    const res = await post({ ...BODY, toStage: 'initial_meeting', reason: '   ' });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'reason_required' });
  });

  it('409 terminal_stage when the engagement is at membership', async () => {
    db.tables.engagements = { data: [{ id: 'r6', stage: 'membership', status: 'in_progress' }], error: null };
    const res = await post({ ...BODY, toStage: 'scoping', reason: 'reopen' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'terminal_stage' });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('422 stage_skipped for any first move other than initial_meeting', async () => {
    db.tables.engagements = { data: [], error: null };
    const res = await post({ ...BODY, toStage: 'budget_check' });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'stage_skipped' });
  });

  it('502 when the engagements read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.tables.engagements = { data: null, error: { code: '08006' } };
    const res = await post(BODY);
    expect(res.status).toBe(502);
    expect(db.rpcCalls).toHaveLength(0);
  });
});

describe('POST /api/engagement-transition — the RPC', () => {
  it('201 with a body that validates; the RPC gets exactly the caller-supplied args', async () => {
    const res = await post({ ...BODY, reason: 'Budget confirmed with the board', evidence: { note: 'minutes' } });
    expect(res.status).toBe(201);
    const body = engagementTransitionResponseSchema.parse(await res.json());
    expect(body).toEqual({
      engagementId: TARGET_ROW,
      fromStage: 'budget_check',
      toStage: 'data_ethics_committee',
      transitionedAt: '2026-10-07T12:00:00.123456+00:00',
      eventId: EVENT_ID,
      approvalId: null,
      replayed: false,
    });
    expect(db.rpcCalls).toEqual([
      {
        fn: 'transition_engagement',
        args: {
          p_business_id: BUSINESS_ID,
          p_to_stage: 'data_ethics_committee',
          p_reason: 'Budget confirmed with the board',
          p_idempotency_key: 'transition-0001',
          p_evidence: { note: 'minutes' },
        },
      },
    ]);
  });

  it('sends an empty reason and empty evidence when the body has none', async () => {
    await post(BODY);
    expect(db.rpcCalls[0].args).toMatchObject({ p_reason: '', p_evidence: {} });
  });

  it('a first transition has a null fromStage', async () => {
    db.tables.engagements = { data: [], error: null };
    db.rpc = {
      data: { ...RPC_RESULT, from_stage: null, to_stage: 'initial_meeting' },
      error: null,
    };
    const res = await post({ ...BODY, toStage: 'initial_meeting' });
    expect(res.status).toBe(201);
    expect(engagementTransitionResponseSchema.parse(await res.json()).fromStage).toBeNull();
  });

  it('passes a replayed result through as 201 with replayed true, skipping the pre-check', async () => {
    // The key exists, and the stage has since moved on: the pre-check would call this a
    // skip. It must not run.
    db.tables.engagement_events = { data: { id: EVENT_ID }, error: null };
    db.tables.engagements = { data: [{ id: 'r3', stage: 'scoping', status: 'in_progress' }], error: null };
    db.rpc = { data: { ...RPC_RESULT, approval_id: APPROVAL_ID, replayed: true }, error: null };
    const res = await post(BODY);
    expect(res.status).toBe(201);
    const body = engagementTransitionResponseSchema.parse(await res.json());
    expect(body.replayed).toBe(true);
    expect(body.approvalId).toBe(APPROVAL_ID);
    expect(db.queries.some((q) => q.table === 'engagements')).toBe(false);
    expect(db.rpcCalls).toHaveLength(1);
  });

  it('RPC 55000 guard:budget_confirmed -> 422 guard_unmet with the condition', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.rpc = { data: null, error: { code: '55000', message: 'guard:budget_confirmed' } };
    const res = await post(BODY);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'guard_unmet', condition: 'budget_confirmed' });
  });

  it('RPC 55000 terminal -> 409 terminal_stage', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.rpc = { data: null, error: { code: '55000', message: 'terminal' } };
    const res = await post(BODY);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'terminal_stage' });
  });

  it('RPC 42501 -> 403 forbidden', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.rpc = { data: null, error: { code: '42501', message: 'transition_engagement: admin only' } };
    const res = await post(BODY);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('RPC P0002 -> 404 business_not_found', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.rpc = { data: null, error: { code: 'P0002', message: 'no business' } };
    expect((await post(BODY)).status).toBe(404);
  });

  it('RPC 22023 with a known token -> 422; with any other message -> 400 invalid_transition', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.rpc = { data: null, error: { code: '22023', message: 'stage_skipped' } };
    const skipped = await post(BODY);
    expect(skipped.status).toBe(422);
    expect(await skipped.json()).toEqual({ error: 'stage_skipped' });

    db.rpc = { data: null, error: { code: '22023', message: 'transition_engagement: idempotency key already used' } };
    const other = await post(BODY);
    expect(other.status).toBe(400);
    expect(await other.json()).toEqual({ error: 'invalid_transition' });
  });

  it('RPC 23505 -> 409 conflict', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.rpc = { data: null, error: { code: '23505', message: 'duplicate key' } };
    const res = await post(BODY);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'conflict' });
  });

  it('any other RPC failure -> 502 transition_failed, logging the code and nothing else', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.rpc = { data: null, error: { code: 'XX000', message: 'secret row detail for abc' } };
    const res = await post(BODY);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'transition_failed' });
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).toContain('"code":"XX000"');
    expect(line).not.toContain('secret row detail');
  });

  it('502 when the RPC result is not the documented shape', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.rpc = { data: { engagement_id: 'nope' }, error: null };
    expect((await post(BODY)).status).toBe(502);
  });
});
