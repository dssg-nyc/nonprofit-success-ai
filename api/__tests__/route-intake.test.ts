import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScoutIntakeRequest, ScoutResult } from '../../src/types';

// Two seams are replaced: Supabase (auth + the user-scoped client's rpc) and the agent's
// model path. The deterministic heuristic (`routeScoutIntake`) stays real, so a fallback
// response is what the handler would really file. No key, no network, no recorder.
type Result = { data: unknown; error: { code?: string; status?: number } | null };
const db = vi.hoisted(() => ({
  user: { data: { user: { id: 'anon-user-1' } }, error: null } as Result,
  rpcResults: {} as Record<string, Result>,
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => db.user },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      db.rpcCalls.push({ fn, args });
      return db.rpcResults[fn] ?? { data: null, error: null };
    },
  }),
}));

const agent = vi.hoisted(() => ({
  calls: [] as unknown[],
  respond: (async () => {
    throw new Error('respond not set');
  }) as (input: unknown) => Promise<{ result: unknown; runId: string | null }>,
}));
vi.mock('../../src/agents/scout/model', () => ({
  routeScoutIntakeWithModel: async (input: unknown) => {
    agent.calls.push(input);
    return agent.respond(input);
  },
}));

const { POST } = await import('../route-intake');
const { GatewayError } = await import('../../src/model/errors');
const { scoutIntakeResponseSchema } = await import('../../src/schemas');
const { routeScoutIntake } = await import('../../src/agents/scout/routing');

const INTAKE: ScoutIntakeRequest = {
  org_name: 'Bronx Literacy Fund',
  contact_name_role: 'Maria Lopez, Program Director',
  contact_email: 'maria@example.org',
  mission: 'Adult literacy programs across the Bronx.',
  scale: 'staff of 30',
  primary_need: 'ml_predictive',
  problem_description:
    'We want to build a predictive model that forecasts which clients are at risk of dropping out of our program so case managers can intervene early.',
  current_systems: 'Salesforce and a Postgres data warehouse',
  timeline: 'this quarter',
  referral_source: 'A partner org',
};

const RESULT: ScoutResult = {
  bucket: 'ML / Predictive',
  confidence: 'High',
  rationale: 'Predictive need with a named owner and real systems.',
  poc_score: 3,
  clarity_score: 3,
  foothold_score: 3,
  composite_signal: 'Ready',
  flags: [],
  hitlTier: 'L2',
};

const INTAKE_ID = 'dddddddd-0000-0000-0000-000000000001';
const filed = (hitl_tier: 'L2' | 'L3', routing_source: 'ai' | 'derived') => ({
  data: { intake_id: INTAKE_ID, hitl_tier, routing_source },
  error: null,
});

// An anonymous sign-in's token: the public form has no account, so this is what it sends.
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbm9uLXVzZXItMSIsImlzX2Fub255bW91cyI6dHJ1ZX0.c2ln';

const post = (body: string, token: string | null = TOKEN) =>
  POST(
    new Request('http://localhost/api/route-intake', {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body,
    }),
  );

const submitCalls = () => db.rpcCalls.filter((c) => c.fn === 'submit_scout_intake');
/** Every structured log line written to stderr this test, parsed. */
const logged = () =>
  (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
    (c) => JSON.parse(String(c[0])) as Record<string, unknown>,
  );
const budgetCalls = () => db.rpcCalls.filter((c) => c.fn === 'check_model_budget');

beforeEach(() => {
  agent.calls = [];
  db.rpcCalls = [];
  db.user = { data: { user: { id: 'anon-user-1' } }, error: null };
  db.rpcResults = {
    check_model_budget: { data: 19, error: null },
    submit_scout_intake: filed('L2', 'ai'),
  };
  vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'test-key');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/route-intake', () => {
  // The form is public; the route is not. Without a session Supabase Auth issued (the
  // form's anonymous sign-in) nothing is read, no model call is made and no row is written.
  it('401 unauthorized without a bearer token, before the body, the model or the write', async () => {
    const res = await post(JSON.stringify(INTAKE), null);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer');
    expect(agent.calls).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('401 unauthorized when Auth rejects the token', async () => {
    db.user = { data: { user: null }, error: { status: 401 } };
    const res = await post(JSON.stringify(INTAKE));
    expect(res.status).toBe(401);
    expect(agent.calls).toHaveLength(0);
  });

  it('400 invalid_input for a body missing form fields, and no model call', async () => {
    const res = await post(JSON.stringify({ scale: 'small', primary_need: 'build_tool' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_input' });
    expect(agent.calls).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('400 invalid_input for a field over its column limit, before the RPC can 23514', async () => {
    const res = await post(JSON.stringify({ ...INTAKE, org_name: 'x'.repeat(257) }));
    expect(res.status).toBe(400);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('400 invalid_json for a body that is not JSON', async () => {
    const res = await post('{not json');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_json' });
  });

  it('200 with the model result as filed, which satisfies the wire schema', async () => {
    agent.respond = async () => ({ result: RESULT, runId: 'run-1' });
    const res = await post(JSON.stringify(INTAKE));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ...RESULT, intakeId: INTAKE_ID, routingSource: 'ai' });
    expect(scoutIntakeResponseSchema.safeParse(body).success).toBe(true);
    expect(agent.calls).toEqual([
      {
        scale: INTAKE.scale,
        primary_need: INTAKE.primary_need,
        primary_need_other: undefined,
        problem_description: INTAKE.problem_description,
        current_systems: INTAKE.current_systems,
        contact_name_role: INTAKE.contact_name_role,
        timeline: INTAKE.timeline,
      },
    ]);
  });

  it('files the row through submit_scout_intake with the form, the result and the run — never a tier', async () => {
    agent.respond = async () => ({ result: RESULT, runId: 'run-1' });
    await post(JSON.stringify(INTAKE));

    const [call] = submitCalls();
    expect(call.args.p_agent_run_id).toBe('run-1');
    expect(call.args.p_intake).toMatchObject({
      org_name: INTAKE.org_name,
      contact_email: INTAKE.contact_email,
      primary_need: 'ml_predictive',
      primary_need_other: '',
      bucket: 'ML / Predictive',
      confidence: 'High',
      composite_signal: 'Ready',
      flags: [],
    });
    expect(call.args.p_intake).not.toHaveProperty('hitlTier');
    expect(call.args.p_intake).not.toHaveProperty('hitl_tier');
    expect(call.args.p_intake).not.toHaveProperty('review_status');
  });

  // The tier in the response is the tier the RPC filed. The RPC derives it from the run,
  // so a result the handler computed as L2 that the database filed as L3 answers L3.
  it('answers with the tier the database filed, not the one the model path computed', async () => {
    agent.respond = async () => ({ result: RESULT, runId: 'run-1' });
    db.rpcResults.submit_scout_intake = filed('L3', 'ai');
    const body = await (await post(JSON.stringify(INTAKE))).json();
    expect(body.hitlTier).toBe('L3');
  });

  it('keeps primary_need_other only for something_else', async () => {
    agent.respond = async () => ({ result: RESULT, runId: 'run-1' });
    await post(JSON.stringify({ ...INTAKE, primary_need: 'something_else', primary_need_other: 'A chatbot' }));
    expect(submitCalls()[0].args.p_intake).toMatchObject({ primary_need_other: 'A chatbot' });
  });

  describe('the deterministic fallback', () => {
    it('on a GatewayError files the heuristic result as L3 with a flag, and no run id', async () => {
      agent.respond = async () => {
        throw new GatewayError('model_timeout', 504, 'timed out');
      };
      db.rpcResults.submit_scout_intake = filed('L3', 'derived');
      const res = await post(JSON.stringify(INTAKE));

      expect(res.status).toBe(200);
      const body = await res.json();
      const heuristic = routeScoutIntake({ ...INTAKE, primary_need: 'ml_predictive' });
      expect(body).toEqual({
        ...heuristic,
        hitlTier: 'L3',
        flags: [...heuristic.flags, 'Routed by the deterministic fallback — model unavailable (model_timeout)'],
        intakeId: INTAKE_ID,
        routingSource: 'derived',
      });
      const [call] = submitCalls();
      expect(call.args).not.toHaveProperty('p_agent_run_id');
      expect(call.args.p_intake).toMatchObject({ bucket: heuristic.bucket, flags: expect.arrayContaining([expect.stringContaining('model_timeout')]) });
    });

    it('on any other error files the heuristic result with model_call_failed, and logs the class name', async () => {
      agent.respond = async () => {
        throw new Error('boom');
      };
      db.rpcResults.submit_scout_intake = filed('L3', 'derived');
      const res = await post(JSON.stringify(INTAKE));
      expect(res.status).toBe(200);
      expect((await res.json()).flags.at(-1)).toContain('model_call_failed');
      expect(logged()).toContainEqual(expect.objectContaining({ event: 'route_failure', step: 'routing', errorName: 'Error' }));
    });

    it('without a model key skips the model and the budget, and still files the intake', async () => {
      vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', '');
      db.rpcResults.submit_scout_intake = filed('L3', 'derived');
      const res = await post(JSON.stringify(INTAKE));
      expect(res.status).toBe(200);
      expect((await res.json()).flags.at(-1)).toContain('model_key_missing');
      expect(agent.calls).toHaveLength(0);
      expect(budgetCalls()).toHaveLength(0);
      expect(submitCalls()).toHaveLength(1);
    });
  });

  describe('the model-call budget', () => {
    it('is checked before the model call, with the deployment limit', async () => {
      vi.stubEnv('MODEL_CALLS_PER_HOUR', '5');
      agent.respond = async () => ({ result: RESULT, runId: 'run-1' });
      await post(JSON.stringify(INTAKE));
      expect(db.rpcCalls[0]).toEqual({ fn: 'check_model_budget', args: { p_limit: 5 } });
    });

    it('429 model_budget_exceeded with Retry-After once the hour is spent; no model call, no row', async () => {
      db.rpcResults.check_model_budget = { data: null, error: { code: '53400' } };
      agent.respond = async () => ({ result: RESULT, runId: 'run-1' });
      const res = await post(JSON.stringify(INTAKE));
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({ error: 'model_budget_exceeded' });
      expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
      expect(agent.calls).toHaveLength(0);
      expect(submitCalls()).toHaveLength(0);
    });

    it('fails open, logged, when the budget RPC itself errors', async () => {
      db.rpcResults.check_model_budget = { data: null, error: { code: '42883' } };
      agent.respond = async () => ({ result: RESULT, runId: 'run-1' });
      const res = await post(JSON.stringify(INTAKE));
      expect(res.status).toBe(200);
      expect(logged()).toContainEqual(expect.objectContaining({ event: 'route_failure', step: 'budget' }));
    });
  });

  describe('the write', () => {
    it('400 invalid_intake when the RPC rejects the payload (22023 / 23xxx)', async () => {
      agent.respond = async () => ({ result: RESULT, runId: 'run-1' });
      db.rpcResults.submit_scout_intake = { data: null, error: { code: '23514' } };
      const res = await post(JSON.stringify(INTAKE));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_intake' });
    });

    it('502 intake_write_failed on any other RPC error, or a malformed result', async () => {
      agent.respond = async () => ({ result: RESULT, runId: 'run-1' });
      db.rpcResults.submit_scout_intake = { data: null, error: { code: '57P01' } };
      expect((await post(JSON.stringify(INTAKE))).status).toBe(502);

      db.rpcResults.submit_scout_intake = { data: { nope: true }, error: null };
      const res = await post(JSON.stringify(INTAKE));
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'intake_write_failed' });
    });
  });
});
