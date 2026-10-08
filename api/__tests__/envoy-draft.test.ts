import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnvoyDraft, EnvoyDraftRequest, EnvoyInput } from '../../src/types';

// Two seams are replaced: Supabase (auth + the user-scoped client) and the Envoy model
// path. The occasion template (`generateEnvoyDraft`) stays real, so a fallback response
// is the template the handler would really save. No key, network or database.
type Result = { data: unknown; error: { code?: string; message?: string; status?: number } | null };
const db = vi.hoisted(() => ({
  user: { data: { user: { id: 'staff-1' } }, error: null } as Result,
  tables: {} as Record<string, Result>,
  rpc: { data: null, error: null } as Result,
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  budget: { data: 19, error: null } as Result,
  budgetCalls: [] as Array<Record<string, unknown>>,
  queries: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => db.user },
    from: (table: string) => {
      const query = { table, filters: [] as Array<[string, unknown]> };
      db.queries.push(query);
      const builder = {
        select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.head) query.filters.push(['__count', true]);
          return builder;
        },
        eq: (col: string, value: unknown) => {
          query.filters.push([col, value]);
          return builder;
        },
        in: (col: string, value: unknown) => {
          query.filters.push([col, value]);
          return builder;
        },
        limit: () => builder,
        maybeSingle: async () => {
          const isStage = query.filters.some(([c, v]) => c === 'stage' && v === 'membership');
          return db.tables[isStage ? `${table}:membership` : table] ?? { data: null, error: null };
        },
        // A head count query resolves the builder itself (`await client.from(...).select(..., {head})`).
        then: (resolve: (r: Result & { count: number | null }) => void) => {
          const seed = db.tables[`${table}:count`] ?? { data: null, error: null };
          resolve({ ...seed, count: typeof seed.data === 'number' ? seed.data : null });
        },
      };
      return builder;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      // The budget check is its own seam: `rpcCalls` stays the submit calls alone.
      if (fn === 'check_model_budget') {
        db.budgetCalls.push(args);
        return db.budget;
      }
      db.rpcCalls.push({ fn, args });
      return db.rpc;
    },
  }),
}));

const agent = vi.hoisted(() => ({
  calls: [] as unknown[],
  respond: (async () => {
    throw new Error('respond not set');
  }) as (input: unknown) => Promise<{ draft: unknown; runId: string | null; model?: string | null }>,
}));
vi.mock('../../src/agents/envoy/model', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/agents/envoy/model')>();
  return {
    ...real,
    draftEnvoyWithModel: async (input: unknown) => {
      agent.calls.push(input);
      return agent.respond(input);
    },
  };
});

const { POST } = await import('../envoy-draft');
const { GatewayError } = await import('../../src/model/errors');
const { envoyDraftResponseSchema } = await import('../../src/schemas');
const { generateEnvoyDraft } = await import('../../src/agents/envoy/draft');

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzdGFmZi0xIn0.c2lnbmF0dXJl';
const ENGAGEMENT_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const APPROVAL_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const DRAFT_ID = 'aaaaaaaa-0000-0000-0000-000000000002';
const RUN_ID = 'aaaaaaaa-0000-0000-0000-000000000003';

const BODY: EnvoyDraftRequest = {
  engagementId: ENGAGEMENT_ID,
  idempotencyKey: 'envoy-submit-0001',
  occasion: 'kickoff',
};
/** What the handler builds from the seeded rows (`_engagement.ts`) plus the body's occasion. */
const INPUT: EnvoyInput = {
  engagementId: ENGAGEMENT_ID,
  occasion: 'kickoff',
  orgName: 'Borough Food Bank',
  planTitle: 'Demand forecasting pilot',
  cadence: 'fortnightly',
};

const DRAFT: EnvoyDraft = {
  engagementId: ENGAGEMENT_ID,
  occasion: 'kickoff',
  subject: 'Kicking off our work together',
  body: 'Dear Borough Food Bank team, we are glad to begin.',
  hitlTier: 'L3',
};

const ASSESSMENT_ID = 'cccccccc-0000-0000-0000-000000000001';
const ENGAGEMENT = {
  id: ENGAGEMENT_ID,
  organization_id: 'dddddddd-0000-0000-0000-000000000001',
  business_id: 'eeeeeeee-0000-0000-0000-000000000001',
  stage: 'initial_meeting',
  status: 'in_progress',
  assessment_id: ASSESSMENT_ID,
};
const CHARTER = { title: INPUT.planTitle, objectives: [], successCriteria: [], cadence: INPUT.cadence, workstreams: [] };

const post = (body: unknown, token: string | null = TOKEN) =>
  POST(
    new Request('http://localhost/api/envoy-draft', {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  agent.calls = [];
  agent.respond = async () => ({ draft: DRAFT, runId: RUN_ID, model: 'gemini-test' });
  db.user = { data: { user: { id: 'staff-1' } }, error: null };
  db.tables = {
    engagements: { data: ENGAGEMENT, error: null },
    organization_members: { data: { role: 'admin' }, error: null },
    'engagements:membership': { data: { id: 'ffffffff-0000-0000-0000-000000000001' }, error: null },
    businesses: { data: { name: INPUT.orgName }, error: null },
    'engagement_events:count': { data: 3, error: null },
    architect_assessments: { data: { charter: CHARTER }, error: null },
  };
  db.rpc = { data: { approval_id: APPROVAL_ID, draft_id: DRAFT_ID }, error: null };
  db.rpcCalls = [];
  db.budget = { data: 19, error: null };
  db.budgetCalls = [];
  db.queries = [];
  vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'test-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/envoy-draft — auth and input', () => {
  it('401 unauthorized without a bearer token, and no model call', async () => {
    const res = await post(BODY, null);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(agent.calls).toHaveLength(0);
  });

  it('401 unauthorized when Auth rejects the token', async () => {
    db.user = { data: { user: null }, error: { status: 401 } };
    expect((await post(BODY)).status).toBe(401);
    expect(agent.calls).toHaveLength(0);
  });

  it('400 invalid_input for an unknown occasion', async () => {
    const res = await post({ ...BODY, occasion: 'birthday' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_input' });
    expect(agent.calls).toHaveLength(0);
  });

  // orgName, planTitle and cadence are rows, not request fields: a body that names another
  // organisation or plan changes nothing (the review finding of 2026-10-08).
  it('ignores orgName, planTitle and cadence sent in the body — they come from the rows', async () => {
    await post({ ...BODY, orgName: 'Someone Else', planTitle: 'Other plan', cadence: 'daily' });
    expect(agent.calls).toEqual([INPUT]);
  });

  it('passes concerns from the body and leaves plan fields out when there is no assessment', async () => {
    db.tables.engagements = { data: { ...ENGAGEMENT, assessment_id: null }, error: null };
    await post({ ...BODY, occasion: 'at_risk_follow_up', concerns: ['No session logged in 21 days'] });
    expect(agent.calls).toEqual([
      {
        engagementId: ENGAGEMENT_ID,
        occasion: 'at_risk_follow_up',
        orgName: INPUT.orgName,
        concerns: ['No session logged in 21 days'],
      },
    ]);
    expect(db.queries.some((q) => q.table === 'architect_assessments')).toBe(false);
  });

  it('502 engagement_lookup_failed when the business row is missing, before the model call', async () => {
    db.tables.businesses = { data: null, error: null };
    const res = await post(BODY);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'engagement_lookup_failed' });
    expect(agent.calls).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('400 invalid_input for a missing idempotencyKey, with no lookup and no model call', async () => {
    const noKey: Record<string, unknown> = { ...BODY };
    delete noKey.idempotencyKey;
    const res = await post(noKey);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_input' });
    expect(db.queries).toHaveLength(0);
    expect(agent.calls).toHaveLength(0);
  });

  it('400 invalid_json for a body that is not JSON', async () => {
    const res = await post('{not json');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_json' });
  });

  it('404 when the engagement is missing or hidden by RLS, with no model call', async () => {
    db.tables.engagements = { data: null, error: null };
    const res = await post(BODY);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'engagement_not_found' });
    expect(agent.calls).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('502 when the engagement lookup fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.tables.engagements = { data: null, error: { code: '08006' } };
    const res = await post(BODY);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'engagement_lookup_failed' });
  });
});

describe('POST /api/envoy-draft — draft', () => {
  it("200 source 'model' with the saved ids; the RPC payload says 'model' and links the run", async () => {
    const res = await post(BODY);
    expect(res.status).toBe(200);
    const body = envoyDraftResponseSchema.parse(await res.json());
    expect(body).toEqual({ ...DRAFT, source: 'model', approvalId: APPROVAL_ID, draftId: DRAFT_ID, runId: RUN_ID });
    expect(agent.calls).toEqual([INPUT]);

    const [call] = db.rpcCalls;
    expect(call.fn).toBe('submit_envoy_draft');
    expect(call.args).toMatchObject({
      p_idempotency_key: BODY.idempotencyKey,
      p_agent_run_id: RUN_ID,
      p_payload: {
        engagement_id: ENGAGEMENT_ID,
        occasion: 'kickoff',
        subject: DRAFT.subject,
        body: DRAFT.body,
        source: 'model',
      },
    });
  });

  // The fallback contract (design-system.md §2): a model failure is a 200 carrying the
  // occasion template, saved, with `source: 'fallback'`.
  it("a GatewayError saves the template as source 'fallback', linked to the gateway's run", async () => {
    const err = new GatewayError('model_rate_limited', 429, 'slow down');
    err.runId = RUN_ID;
    agent.respond = async () => {
      throw err;
    };
    const res = await post(BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ...generateEnvoyDraft(INPUT),
      source: 'fallback',
      approvalId: APPROVAL_ID,
      draftId: DRAFT_ID,
      runId: RUN_ID,
    });
    expect(db.rpcCalls[0].args).toMatchObject({
      p_agent_run_id: RUN_ID,
      p_payload: { source: 'fallback', subject: generateEnvoyDraft(INPUT).subject },
    });
  });

  it('a missing key is a fallback too, not a 503, and sends no run id when none was recorded', async () => {
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', '');
    agent.respond = async () => {
      throw new GatewayError('model_key_missing', 503, 'no key');
    };
    const res = await post(BODY);
    expect(res.status).toBe(200);
    expect((await res.json()).source).toBe('fallback');
    expect(db.rpcCalls[0].args).not.toHaveProperty('p_agent_run_id');
  });

  it('any other error still falls back, and is logged as a bug', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    agent.respond = async () => {
      throw new Error('boom');
    };
    const res = await post(BODY);
    expect(res.status).toBe(200);
    expect((await res.json()).source).toBe('fallback');
    expect(log).toHaveBeenCalled();
  });

  it("the payload's source is 'model' only when the model path succeeded", async () => {
    await post(BODY);
    agent.respond = async () => {
      throw new GatewayError('model_timeout', 504, 'timed out');
    };
    await post({ ...BODY, idempotencyKey: 'envoy-submit-0002' });
    expect(db.rpcCalls.map((c) => (c.args.p_payload as { source: string }).source)).toEqual(['model', 'fallback']);
  });
});

describe('POST /api/envoy-draft — authority and unrecorded runs', () => {
  it('403 forbidden for a caller who is not an org admin, before the model call', async () => {
    db.tables.organization_members = { data: null, error: null };
    const res = await post(BODY);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(agent.calls).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('502 when the membership lookup fails, before the model call', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.tables.organization_members = { data: null, error: { code: '08006' } };
    expect((await post(BODY)).status).toBe(502);
    expect(agent.calls).toHaveLength(0);
  });

  it("model succeeded with runId null: 200, the RPC gets source 'model' and the model, no run id", async () => {
    agent.respond = async () => ({ draft: DRAFT, runId: null, model: 'gemini-test' });
    const res = await post(BODY);
    expect(res.status).toBe(200);
    expect((await res.json()).source).toBe('model');
    const [call] = db.rpcCalls;
    expect(call.args).not.toHaveProperty('p_agent_run_id');
    expect(call.args).toMatchObject({
      p_payload: { source: 'model', model: 'gemini-test', prompt_version: 'envoy-draft-0.04' },
    });
  });
});

describe('POST /api/envoy-draft — replay', () => {
  const prior = (over: Record<string, unknown> = {}) => ({
    data: {
      id: APPROVAL_ID,
      agent: 'envoy',
      entity_type: 'communication',
      entity_id: ENGAGEMENT_ID,
      status: 'pending',
      agent_run_id: RUN_ID,
      draft_id: DRAFT_ID,
      ...over,
    },
    error: null,
  });

  it('returns the stored draft without calling the model or the RPC', async () => {
    db.tables.approvals = prior();
    db.tables.communications = {
      data: {
        engagement_id: ENGAGEMENT_ID,
        occasion: 'kickoff',
        subject: DRAFT.subject,
        body: DRAFT.body,
        source_type: 'ai',
      },
      error: null,
    };
    const res = await post(BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...DRAFT, source: 'model', approvalId: APPROVAL_ID, draftId: DRAFT_ID, runId: RUN_ID });
    expect(agent.calls).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("reads a derived row back as source 'fallback'", async () => {
    db.tables.approvals = prior();
    db.tables.communications = {
      data: { engagement_id: ENGAGEMENT_ID, occasion: 'kickoff', subject: 's', body: 'b', source_type: 'derived' },
      error: null,
    };
    expect((await (await post(BODY)).json()).source).toBe('fallback');
  });

  it('409 draft_superseded when the key\'s approval has expired', async () => {
    db.tables.approvals = prior({ status: 'expired' });
    const res = await post(BODY);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'draft_superseded' });
    expect(agent.calls).toHaveLength(0);
  });

  it('400 invalid_draft when the key was used for a different draft', async () => {
    db.tables.approvals = prior({ agent: 'chronicle', entity_type: 'story' });
    const res = await post(BODY);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_draft' });
    expect(agent.calls).toHaveLength(0);
  });
});

describe('POST /api/envoy-draft — RPC errors', () => {
  const rpcError = (code: string) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.rpc = { data: null, error: { code, message: 'secret detail' } };
  };

  it.each([
    ['42501', 403, 'forbidden'],
    ['P0002', 404, 'engagement_not_found'],
    ['22023', 400, 'invalid_draft'],
    ['23514', 400, 'invalid_draft'],
    ['XX000', 502, 'draft_save_failed'],
  ])('SQLSTATE %s -> %i %s, without leaking the message', async (code, status, error) => {
    rpcError(code);
    const res = await post(BODY);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
  });

  it('502 when the RPC answers with something other than the id pair', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.rpc = { data: 'not-an-object', error: null };
    const res = await post(BODY);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'draft_save_failed' });
  });
});

describe('POST /api/envoy-draft — model-call budget', () => {
  beforeEach(() => {
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'test-key');
  });

  it('checks the budget once, after the lookups and before the model call, with the deployment limit', async () => {
    vi.stubEnv('MODEL_CALLS_PER_HOUR', '7');
    await post(BODY);
    expect(db.budgetCalls).toEqual([{ p_limit: 7 }]);
    expect(agent.calls).toHaveLength(1);
  });

  it('429 model_budget_exceeded with Retry-After once the hour is spent: no model call, nothing saved', async () => {
    db.budget = { data: null, error: { code: '53400' } };
    const res = await post(BODY);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'model_budget_exceeded' });
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(agent.calls).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('fails open when the budget RPC itself errors, so an unapplied 0007 cannot block drafts', async () => {
    db.budget = { data: null, error: { code: '42883' } };
    const res = await post(BODY);
    expect(res.status).toBe(200);
    expect(agent.calls).toHaveLength(1);
    expect(db.rpcCalls.map((c) => c.fn)).toEqual(['submit_envoy_draft']);
  });

  it('skips the budget when no model key is configured — the template costs nothing', async () => {
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', '');
    await post(BODY);
    expect(db.budgetCalls).toHaveLength(0);
  });
});
