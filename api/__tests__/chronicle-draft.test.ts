import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChronicleDraft, ChronicleDraftRequest, ChronicleInput } from '../../src/types';

// Two seams are replaced: Supabase (auth + the user-scoped client) and the Chronicle model
// path. The deterministic draft (`generateChronicleDraft`) stays real, so a fallback response
// is the draft the handler would really save. No key, network or database.
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
vi.mock('../../src/agents/chronicle/model', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/agents/chronicle/model')>();
  return {
    ...real,
    draftChronicleWithModel: async (input: unknown) => {
      agent.calls.push(input);
      return agent.respond(input);
    },
  };
});

const { POST } = await import('../chronicle-draft');
const { GatewayError } = await import('../../src/model/errors');
const { chronicleDraftResponseSchema } = await import('../../src/schemas');
const { generateChronicleDraft } = await import('../../src/agents/chronicle/draft');

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzdGFmZi0xIn0.c2lnbmF0dXJl';
const ENGAGEMENT_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const APPROVAL_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const DRAFT_ID = 'aaaaaaaa-0000-0000-0000-000000000002';
const RUN_ID = 'aaaaaaaa-0000-0000-0000-000000000003';

const BODY: ChronicleDraftRequest = {
  engagementId: ENGAGEMENT_ID,
  idempotencyKey: 'chronicle-submit-0001',
};
/** What the handler builds from the seeded rows (`_engagement.ts`), never from the body. */
const INPUT: ChronicleInput = {
  engagementId: ENGAGEMENT_ID,
  orgName: 'Borough Food Bank',
  status: 'completed',
  hasPlan: true,
  eventCount: 6,
  objectives: ['Forecast weekly demand per site'],
  successCriteria: ['Forecast error under 15%'],
};

const DRAFT: ChronicleDraft = {
  engagementId: ENGAGEMENT_ID,
  readiness: 'ready',
  headline: 'Forecasting demand with Borough Food Bank',
  narrative: 'Borough Food Bank completed an engagement with the programme.',
  outcomes: ['Forecast error under 15%'],
  successFactors: ['Measurable success criterion'],
  failureFactors: [],
  hitlTier: 'L3',
};

const LESSON_ID = 'aaaaaaaa-0000-0000-0000-000000000004';

const ASSESSMENT_ID = 'cccccccc-0000-0000-0000-000000000001';
const ENGAGEMENT = {
  id: ENGAGEMENT_ID,
  organization_id: 'dddddddd-0000-0000-0000-000000000001',
  business_id: 'eeeeeeee-0000-0000-0000-000000000001',
  stage: 'membership',
  status: 'completed',
  assessment_id: ASSESSMENT_ID,
};
const CHARTER = {
  title: 'Demand forecasting pilot',
  objectives: INPUT.objectives,
  successCriteria: INPUT.successCriteria,
  cadence: 'fortnightly',
  workstreams: [],
};

const post = (body: unknown, token: string | null = TOKEN) =>
  POST(
    new Request('http://localhost/api/chronicle-draft', {
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
    'engagement_events:count': { data: INPUT.eventCount, error: null },
    architect_assessments: { data: { charter: CHARTER }, error: null },
  };
  db.rpc = { data: { approval_id: APPROVAL_ID, draft_id: DRAFT_ID, lesson_id: LESSON_ID }, error: null };
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

describe('POST /api/chronicle-draft — auth and input', () => {
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

  it('400 invalid_input when engagementId is missing or not a guid', async () => {
    for (const body of [{ idempotencyKey: BODY.idempotencyKey }, { ...BODY, engagementId: 'not-a-guid' }]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_input' });
    }
    expect(agent.calls).toHaveLength(0);
  });

  // The facts a story is written from are rows, not request fields: a body that claims a
  // completed, event-rich engagement changes nothing (the review finding of 2026-10-08).
  it('ignores engagement facts sent in the body — readiness comes from the rows', async () => {
    db.tables.engagements = { data: { ...ENGAGEMENT, status: 'in_progress' }, error: null };
    const res = await post({ ...BODY, status: 'completed', hasPlan: true, eventCount: 50, orgName: 'Anything' });
    expect(res.status).toBe(200);
    expect((await res.json()).readiness).toBe('not_ready');
    expect(agent.calls).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('builds the input from the business name, the event count and the linked charter', async () => {
    await post(BODY);
    expect(agent.calls).toEqual([INPUT]);
    expect(db.queries.find((q) => q.table === 'businesses')?.filters).toEqual([['id', ENGAGEMENT.business_id]]);
    expect(db.queries.find((q) => q.table === 'engagement_events')?.filters).toEqual([
      ['__count', true],
      ['engagement_id', ENGAGEMENT_ID],
    ]);
    expect(db.queries.find((q) => q.table === 'architect_assessments')?.filters).toEqual([['id', ASSESSMENT_ID]]);
  });

  it('no linked assessment reads as hasPlan false with no charter facts, and no charter query', async () => {
    db.tables.engagements = { data: { ...ENGAGEMENT, assessment_id: null }, error: null };
    db.tables['engagement_events:count'] = { data: 2, error: null };
    await post(BODY);
    expect(agent.calls).toEqual([
      { engagementId: ENGAGEMENT_ID, orgName: INPUT.orgName, status: 'completed', hasPlan: false, eventCount: 2 },
    ]);
    expect(db.queries.some((q) => q.table === 'architect_assessments')).toBe(false);
  });

  it('a charter the caller cannot see, or that does not parse, still counts as a plan', async () => {
    db.tables.architect_assessments = { data: null, error: null };
    await post(BODY);
    expect(agent.calls[0]).toMatchObject({ hasPlan: true });
    expect(agent.calls[0]).not.toHaveProperty('objectives');
  });

  it('502 engagement_lookup_failed when a facts read errors, before the model call', async () => {
    db.tables['engagement_events:count'] = { data: null, error: { code: '42501' } };
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
});

describe('POST /api/chronicle-draft — draft', () => {
  it("200 source 'model' with the saved ids; the RPC payload says 'model' and links the run", async () => {
    const res = await post(BODY);
    expect(res.status).toBe(200);
    const body = chronicleDraftResponseSchema.parse(await res.json());
    expect(body).toEqual({
      ...DRAFT,
      source: 'model',
      approvalId: APPROVAL_ID,
      draftId: DRAFT_ID,
      lessonId: LESSON_ID,
      runId: RUN_ID,
    });
    expect(agent.calls).toEqual([INPUT]);

    const [call] = db.rpcCalls;
    expect(call.fn).toBe('submit_chronicle_draft');
    expect(call.args).toMatchObject({
      p_idempotency_key: BODY.idempotencyKey,
      p_agent_run_id: RUN_ID,
      p_payload: {
        engagement_id: ENGAGEMENT_ID,
        readiness: 'ready',
        headline: DRAFT.headline,
        narrative: DRAFT.narrative,
        outcomes: DRAFT.outcomes,
        success_factors: DRAFT.successFactors,
        failure_factors: DRAFT.failureFactors,
        source: 'model',
      },
    });
  });

  it('not_ready is a 200 with null ids: no model call, no RPC, nothing saved', async () => {
    db.tables.engagements = { data: { ...ENGAGEMENT, status: 'in_progress' }, error: null };
    const res = await post(BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ...generateChronicleDraft({ ...INPUT, status: 'in_progress' }),
      source: 'fallback',
      approvalId: null,
      draftId: null,
      lessonId: null,
      runId: null,
    });
    expect(agent.calls).toHaveLength(0);
    expect(db.rpcCalls.length).toBe(0);
  });

  // The fallback contract (design-system.md §2): a model failure is a 200 carrying the
  // deterministic draft, saved, with `source: 'fallback'`.
  it("a GatewayError saves the deterministic draft as source 'fallback', linked to the gateway's run", async () => {
    const err = new GatewayError('model_rate_limited', 429, 'slow down');
    err.runId = RUN_ID;
    agent.respond = async () => {
      throw err;
    };
    const res = await post(BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ...generateChronicleDraft(INPUT),
      source: 'fallback',
      approvalId: APPROVAL_ID,
      draftId: DRAFT_ID,
      lessonId: LESSON_ID,
      runId: RUN_ID,
    });
    expect(db.rpcCalls[0].args).toMatchObject({
      p_agent_run_id: RUN_ID,
      p_payload: { source: 'fallback', success_factors: [], failure_factors: [] },
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
    await post({ ...BODY, idempotencyKey: 'chronicle-submit-0002' });
    expect(db.rpcCalls.map((c) => (c.args.p_payload as { source: string }).source)).toEqual(['model', 'fallback']);
  });
});

describe('POST /api/chronicle-draft — authority and unrecorded runs', () => {
  it('403 forbidden for a caller who is not an org admin, before the model call', async () => {
    db.tables.organization_members = { data: null, error: null };
    const res = await post(BODY);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(agent.calls).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('422 membership_stage_required when the business has no membership row, before the model call', async () => {
    db.tables['engagements:membership'] = { data: null, error: null };
    const res = await post(BODY);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'membership_stage_required' });
    expect(agent.calls).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("model succeeded with runId null: 200, the RPC gets source 'model' and the model, no run id", async () => {
    agent.respond = async () => ({ draft: DRAFT, runId: null, model: 'gemini-test' });
    const res = await post(BODY);
    expect(res.status).toBe(200);
    expect((await res.json()).source).toBe('model');
    const [call] = db.rpcCalls;
    expect(call.args).not.toHaveProperty('p_agent_run_id');
    expect(call.args).toMatchObject({
      p_payload: { source: 'model', model: 'gemini-test', prompt_version: 'chronicle-draft-0.06' },
    });
  });
});

describe('POST /api/chronicle-draft — replay', () => {
  const prior = (over: Record<string, unknown> = {}) => ({
    data: {
      id: APPROVAL_ID,
      agent: 'chronicle',
      entity_type: 'story',
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
    db.tables.chronicle_drafts = {
      data: {
        engagement_id: ENGAGEMENT_ID,
        readiness: 'ready',
        headline: DRAFT.headline,
        narrative: DRAFT.narrative,
        outcomes: DRAFT.outcomes,
        source_type: 'ai',
        success_factors: DRAFT.successFactors,
        failure_factors: DRAFT.failureFactors,
      },
      error: null,
    };
    db.tables.lessons = { data: { id: LESSON_ID }, error: null };
    const res = await post(BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ...DRAFT,
      source: 'model',
      approvalId: APPROVAL_ID,
      draftId: DRAFT_ID,
      lessonId: LESSON_ID,
      runId: RUN_ID,
    });
    expect(agent.calls).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
    expect(db.queries.find((q) => q.table === 'lessons')?.filters).toEqual([['engagement_id', ENGAGEMENT_ID]]);
  });

  it('a replay with no visible lesson answers lessonId null, not an error', async () => {
    db.tables.approvals = prior();
    db.tables.chronicle_drafts = {
      data: {
        engagement_id: ENGAGEMENT_ID,
        readiness: 'ready',
        headline: DRAFT.headline,
        narrative: DRAFT.narrative,
        outcomes: DRAFT.outcomes,
        source_type: 'derived',
        success_factors: [],
        failure_factors: [],
      },
      error: null,
    };
    const res = await post(BODY);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lessonId).toBeNull();
    expect(body.source).toBe('fallback');
  });

  it('409 draft_superseded when the key\'s approval has expired', async () => {
    db.tables.approvals = prior({ status: 'expired' });
    const res = await post(BODY);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'draft_superseded' });
    expect(agent.calls).toHaveLength(0);
  });

  it('400 invalid_draft when the key was used for a different draft', async () => {
    db.tables.approvals = prior({ agent: 'envoy', entity_type: 'communication' });
    const res = await post(BODY);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_draft' });
    expect(agent.calls).toHaveLength(0);
  });
});

describe('POST /api/chronicle-draft — RPC errors', () => {
  it.each([
    ['42501', 403, 'forbidden'],
    ['P0002', 404, 'engagement_not_found'],
    ['55000', 422, 'membership_stage_required'],
    ['22023', 400, 'invalid_draft'],
    ['23514', 400, 'invalid_draft'],
    ['XX000', 502, 'draft_save_failed'],
  ])('SQLSTATE %s -> %i %s, without leaking the message', async (code, status, error) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.rpc = { data: null, error: { code, message: 'secret detail' } };
    const res = await post(BODY);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
  });

  it('a null lesson_id from the RPC is surfaced as lessonId null', async () => {
    db.rpc = { data: { approval_id: APPROVAL_ID, draft_id: DRAFT_ID, lesson_id: null }, error: null };
    const res = await post(BODY);
    expect(res.status).toBe(200);
    expect((await res.json()).lessonId).toBeNull();
  });

  it('502 when the RPC answers with something other than the id pair', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.rpc = { data: 'not-an-object', error: null };
    const res = await post(BODY);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'draft_save_failed' });
  });
});

describe('POST /api/chronicle-draft — model-call budget', () => {
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
    expect(db.rpcCalls.map((c) => c.fn)).toEqual(['submit_chronicle_draft']);
  });

  it('skips the budget when no model key is configured — the template costs nothing', async () => {
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', '');
    await post(BODY);
    expect(db.budgetCalls).toHaveLength(0);
  });
});
