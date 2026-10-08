import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchitectPlanRequest } from '../../src/types';

// Two seams are replaced: Supabase (auth + the user-scoped client) and the Architect
// model path. The deterministic template (`buildTemplate`) stays real, so a fallback
// response is the template the handler would really save. No key, network or database.

type Result = { data: unknown; error: { code?: string; message?: string; status?: number } | null };

const db = vi.hoisted(() => ({
  user: { data: { user: { id: 'user-1' } }, error: null } as Result,
  tables: {} as Record<string, Result>,
  rpc: { data: 'aaaaaaaa-0000-0000-0000-000000000001', error: null } as Result,
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  budget: { data: 19, error: null } as Result,
  budgetCalls: [] as Array<Record<string, unknown>>,
  queries: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
  clientOptions: [] as unknown[],
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, _key: string, options: unknown) => {
    db.clientOptions.push(options);
    return {
      auth: { getUser: async () => db.user },
      from: (table: string) => {
        const query = { table, filters: [] as Array<[string, unknown]> };
        db.queries.push(query);
        const builder = {
          select: () => builder,
          eq: (col: string, value: unknown) => {
            query.filters.push([col, value]);
            return builder;
          },
          maybeSingle: async () => db.tables[table] ?? { data: null, error: null },
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
    };
  },
}));

const agent = vi.hoisted(() => ({
  calls: [] as unknown[],
  respond: (async () => {
    throw new Error('respond not set');
  }) as (input: unknown) => Promise<unknown>,
}));
vi.mock('../../src/agents/architect/model', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/agents/architect/model')>();
  return {
    ...real,
    enrichWithModel: async (input: unknown) => {
      agent.calls.push(input);
      return agent.respond(input);
    },
  };
});

const { POST } = await import('../architect-plan');
const { GatewayError } = await import('../../src/model/errors');
const { buildTemplate } = await import('../../src/agents/architect/model');
const { scoreAssessment } = await import('../../src/agents/architect/scoring');
const { architectPlanResponseSchema } = await import('../../src/schemas');

const INTAKE_ID = 'cccccccc-0000-0000-0000-000000000001';
const APPROVAL_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJl';

const ANSWERS: ArchitectPlanRequest['answers'] = {
  q1_org_context: 'Food bank serving three boroughs.',
  q2_org_size: '25 staff',
  q3_poc: 'Dana, Ops Director',
  q4_collection_scope: 'partial',
  q5_data_locations: 'Salesforce and spreadsheets',
  q6_system_integration: 'some_share',
  q7_integration_familiarity: 'somewhat_familiar',
  q8_quality_confidence: 'mixed',
  q9_current_decisions: 'Delivery routes',
  q10_wished_decisions: 'Where demand will spike',
  q11_decision_empowerment: 'leadership_managers',
  q12_reporting_to: 'Board, city funders',
  q13_reporting_automation: 'semi_automated',
  q14_tools: ['crm_case_tool', 'spreadsheets'],
  q15_staff_confidence: 'some_adhoc',
  q16_budget_speed: 'requires_approval',
  q17a_wish_list: 'A demand forecast',
  q17b_biggest_worry: 'Data quality',
  q18_past_blockers: 'No analyst',
};

const BODY: ArchitectPlanRequest = {
  scoutIntakeId: INTAKE_ID,
  idempotencyKey: 'submit-0001-abcdef',
  answers: ANSWERS,
};

const INTAKE = {
  org_name: 'Borough Food Bank',
  final_bucket: 'Data Infrastructure',
  review_status: 'reviewed',
  organization_id: 'dddddddd-0000-0000-0000-000000000001',
};

const post = (body: unknown, token: string | null = TOKEN) =>
  POST(
    new Request('http://localhost/api/architect-plan', {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

const genInput = () => {
  const maturity = scoreAssessment(ANSWERS, 'Data Infrastructure');
  return {
    orgName: INTAKE.org_name,
    bucket: 'Data Infrastructure' as const,
    maturity,
    q1_org_context: ANSWERS.q1_org_context,
    q9_current_decisions: ANSWERS.q9_current_decisions,
    q10_wished_decisions: ANSWERS.q10_wished_decisions,
    q17a_wish_list: ANSWERS.q17a_wish_list,
    q17b_biggest_worry: ANSWERS.q17b_biggest_worry,
    q18_past_blockers: ANSWERS.q18_past_blockers,
  };
};

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key');
  db.user = { data: { user: { id: 'user-1' } }, error: null };
  db.tables = { scout_intakes: { data: INTAKE, error: null } };
  db.rpc = { data: APPROVAL_ID, error: null };
  db.rpcCalls = [];
  db.budget = { data: 19, error: null };
  db.budgetCalls = [];
  db.queries = [];
  db.clientOptions = [];
  agent.calls = [];
  agent.respond = async () => {
    const t = buildTemplate(genInput());
    return { charter: { ...t.charter, background: 'Model-written background.' }, plan: t.plan, runId: 'bbbbbbbb-0000-0000-0000-000000000001' };
  };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/architect-plan — auth', () => {
  it('401 with no bearer token, before anything else runs', async () => {
    const res = await post(BODY, null);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(db.clientOptions).toHaveLength(0);
    expect(agent.calls).toHaveLength(0);
  });

  it('401 for a header that is not a JWT', async () => {
    const res = await post(BODY, 'not-a-jwt');
    expect(res.status).toBe(401);
    expect(db.clientOptions).toHaveLength(0);
  });

  it('401 when Supabase Auth rejects the token', async () => {
    db.user = { data: { user: null }, error: { status: 403, message: 'invalid JWT' } };
    const res = await post(BODY);
    expect(res.status).toBe(401);
    expect(agent.calls).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('503, not 401, when Auth itself is unreachable', async () => {
    db.user = { data: { user: null }, error: { status: 0, message: 'fetch failed' } };
    const res = await post(BODY);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'auth_unavailable' });
  });

  it("builds a user-scoped client from the caller's own token", async () => {
    await post(BODY);
    expect(db.clientOptions[0]).toMatchObject({
      global: { headers: { Authorization: `Bearer ${TOKEN}` } },
      auth: { persistSession: false },
    });
  });
});

describe('POST /api/architect-plan — input', () => {
  it('400 invalid_json for a body that is not JSON', async () => {
    const res = await post('{not json');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_json' });
  });

  it('400 invalid_input for a bad answer, with no lookup and no model call', async () => {
    const res = await post({ ...BODY, answers: { ...ANSWERS, q4_collection_scope: 'always' } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_input' });
    expect(db.queries).toHaveLength(0);
    expect(agent.calls).toHaveLength(0);
  });

  it('400 invalid_input for a short idempotency key', async () => {
    const res = await post({ ...BODY, idempotencyKey: 'short' });
    expect(res.status).toBe(400);
  });

  it('404 when the intake is missing or hidden by RLS, with no model call', async () => {
    db.tables.scout_intakes = { data: null, error: null };
    const res = await post(BODY);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'intake_not_found' });
    expect(agent.calls).toHaveLength(0);
  });

  it('422 when the intake has not been reviewed, with no model call', async () => {
    db.tables.scout_intakes = { data: { ...INTAKE, review_status: 'pending', final_bucket: null }, error: null };
    const res = await post(BODY);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'intake_not_reviewed' });
    expect(agent.calls).toHaveLength(0);
  });
});

describe('POST /api/architect-plan — draft', () => {
  it("200 source 'model' with the model's draft, scored against the reviewer's bucket", async () => {
    const res = await post(BODY);
    expect(res.status).toBe(200);
    const body = architectPlanResponseSchema.parse(await res.json());
    expect(body).toMatchObject({
      source: 'model',
      hitlTier: 'L3',
      approvalId: APPROVAL_ID,
      runId: 'bbbbbbbb-0000-0000-0000-000000000001',
    });
    expect(body.charter.background).toBe('Model-written background.');
    expect(body.maturity).toEqual(scoreAssessment(ANSWERS, 'Data Infrastructure'));

    const [call] = db.rpcCalls;
    expect(call.fn).toBe('submit_architect_draft');
    expect(call.args).toMatchObject({
      p_idempotency_key: BODY.idempotencyKey,
      p_agent_run_id: 'bbbbbbbb-0000-0000-0000-000000000001',
      p_payload: {
        scout_intake_id: INTAKE_ID,
        q4_collection_scope: 'partial',
        composite_level: body.maturity.compositeLevel,
        flagged_dimensions: body.maturity.flaggedDimensions,
        source: 'model',
      },
    });
  });

  it("gateway error → 200 source 'fallback': the template is saved, linked to the gateway's one run", async () => {
    const err = new GatewayError('model_timeout', 504, 'timed out');
    err.runId = 'bbbbbbbb-0000-0000-0000-00000000000f';
    agent.respond = async () => {
      throw err;
    };

    const res = await post(BODY);
    expect(res.status).toBe(200);
    const body = architectPlanResponseSchema.parse(await res.json());
    expect(body).toMatchObject({ source: 'fallback', runId: err.runId });
    expect({ charter: body.charter, plan: body.plan }).toEqual(buildTemplate(genInput()));

    // The handler records nothing itself: the gateway's row (status 'fallback',
    // failureStatus) is the only one, and the approval points at it.
    expect(db.rpcCalls).toHaveLength(1);
    expect(db.rpcCalls[0].args).toMatchObject({
      p_agent_run_id: err.runId,
      p_payload: { source: 'fallback' },
    });
  });

  it('a missing model key is a fallback, not a 503', async () => {
    agent.respond = async () => {
      throw new GatewayError('model_key_missing', 503, 'No model key configured');
    };
    const res = await post(BODY);
    expect(res.status).toBe(200);
    expect((await res.json()).source).toBe('fallback');
    // The gateway recorded no run (runId null) → no run id is sent to the RPC.
    expect(db.rpcCalls[0].args).not.toHaveProperty('p_agent_run_id');
  });

  it('a non-gateway throw still falls back, with no run to link', async () => {
    agent.respond = async () => {
      throw new TypeError('merge bug');
    };
    const res = await post(BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ source: 'fallback', runId: null });
  });
});

describe('POST /api/architect-plan — RPC errors', () => {
  it.each([
    ['42501', 403, 'forbidden'],
    ['P0002', 404, 'intake_not_found'],
    ['55000', 422, 'intake_not_reviewed'],
    ['22023', 400, 'invalid_draft'],
    ['23514', 400, 'invalid_draft'],
  ])('SQLSTATE %s → %i %s', async (code, status, error) => {
    db.rpc = { data: null, error: { code, message: `detail for ${INTAKE_ID}` } };
    const res = await post(BODY);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
  });

  it('an unexpected RPC error is a generic 502 that leaks neither the draft nor the message', async () => {
    db.rpc = { data: null, error: { code: 'XX000', message: `internal failure on ${INTAKE_ID}` } };
    const res = await post(BODY);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'draft_save_failed' });
    expect(text).not.toContain(INTAKE_ID);
    expect(text).not.toContain('charter');
  });

  it('an intake lookup error is a 502 with no model call', async () => {
    db.tables.scout_intakes = { data: null, error: { code: '08006', message: 'connection lost' } };
    const res = await post(BODY);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'intake_lookup_failed' });
    expect(agent.calls).toHaveLength(0);
  });
});

describe('POST /api/architect-plan — idempotent replay', () => {
  const template = () => buildTemplate(genInput());
  const storedRow = () => {
    const m = scoreAssessment(ANSWERS, 'Data Infrastructure');
    return {
      di_score: m.di_score,
      gov_score: m.gov_score,
      tooling_score: m.tooling_score,
      dc_score: m.dc_score,
      tc_score: m.tc_score,
      points: m.points,
      composite_level: m.compositeLevel,
      override_applied: m.overrideApplied,
      flagged_dimensions: m.flaggedDimensions,
      remediation_only: m.remediationOnly,
      cross_check_flag: m.crossCheckFlag,
      charter: template().charter,
      ninety_day_plan: template().plan,
    };
  };
  const prior = (over: Record<string, unknown> = {}) => ({
    data: {
      id: APPROVAL_ID,
      entity_id: INTAKE_ID,
      agent: 'architect',
      entity_type: 'charter',
      agent_run_id: 'bbbbbbbb-0000-0000-0000-000000000002',
      status: 'pending',
      ...over,
    },
    error: null,
  });

  it('returns the stored result with no model call and no second write', async () => {
    db.tables.approvals = prior();
    db.tables.architect_assessments = { data: storedRow(), error: null };
    db.tables.audit_events = { data: { detail: { source: 'model' } }, error: null };

    const res = await post(BODY);
    expect(res.status).toBe(200);
    const body = architectPlanResponseSchema.parse(await res.json());
    expect(body).toMatchObject({
      approvalId: APPROVAL_ID,
      source: 'model',
      runId: 'bbbbbbbb-0000-0000-0000-000000000002',
    });
    expect(agent.calls).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
    const approvalsQuery = db.queries.find((q) => q.table === 'approvals');
    expect(approvalsQuery?.filters).toEqual([['idempotency_key', BODY.idempotencyKey]]);
  });

  it('409 for a key whose draft was since superseded', async () => {
    db.tables.approvals = prior({ status: 'expired' });
    const res = await post(BODY);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'draft_superseded' });
    expect(agent.calls).toHaveLength(0);
  });

  it('400 for a key already used for a different draft', async () => {
    db.tables.approvals = prior({ entity_id: 'cccccccc-0000-0000-0000-000000000099' });
    const res = await post(BODY);
    expect(res.status).toBe(400);
    expect(agent.calls).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
  });
});

describe('POST /api/architect-plan — model-call budget', () => {
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
    expect(db.rpcCalls.map((c) => c.fn)).toEqual(['submit_architect_draft']);
  });

  it('skips the budget when no model key is configured — the template costs nothing', async () => {
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', '');
    await post(BODY);
    expect(db.budgetCalls).toHaveLength(0);
  });
});
