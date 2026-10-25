import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScoutIntakeRequest, ScoutRegistry, ScoutResult } from '../../src/types';

// Three seams are replaced: Supabase (auth + the user-scoped client's rpc), the agent's
// model path, and global fetch (ProPublica — a 404 by default, so the registry lookup is
// `not_found` unless a test says otherwise). The deterministic heuristic
// (`routeScoutIntake`) stays real, so a fallback response is what the handler would
// really file. No key, no network, no recorder.
type Result = { data: unknown; error: { code?: string; status?: number } | null };
const db = vi.hoisted(() => ({
  user: { data: { user: { id: 'anon-user-1' } }, error: null } as Result,
  rpcResults: {} as Record<string, Result>,
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
}));
vi.mock('@supabase/supabase-js', () => {
  const rpc = (schema: string) => async (fn: string, args: Record<string, unknown>) => {
    const name = schema === 'public' ? fn : `${schema}.${fn}`;
    db.rpcCalls.push({ fn: name, args });
    return db.rpcResults[name] ?? { data: null, error: null };
  };
  return {
    createClient: () => ({
      auth: { getUser: async () => db.user },
      rpc: rpc('public'),
      // The Salesforce stand-in (`_salesforce.ts`) is reached through its own schema.
      schema: (name: string) => ({ rpc: rpc(name) }),
    }),
  };
});

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

const PROPUBLICA = 'https://projects.propublica.org/nonprofits/api/v2';
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
let fetchFn: ReturnType<typeof vi.fn>;
/** ProPublica by path prefix; anything unrouted is its 404. */
const stubProPublica = (routes: Record<string, unknown | (() => Promise<Response>)> = {}) => {
  fetchFn = vi.fn(async (url: string) => {
    const path = url.slice(PROPUBLICA.length);
    for (const [prefix, body] of Object.entries(routes)) {
      if (path.startsWith(prefix)) {
        return typeof body === 'function' ? (body as () => Promise<Response>)() : Response.json(body);
      }
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchFn);
};
const propublicaUrls = () => fetchFn.mock.calls.map((c) => String((c as [string])[0]));
/** The MoMA fixture as Scout stores it. */
const MOMA: ScoutRegistry = {
  ein: '131624100',
  name: 'Museum Of Modern Art',
  city: 'New York',
  state: 'NY',
  nteeCode: 'A510',
  subsectionCode: 3,
  revenue: expect.any(Number) as unknown as number,
  assets: expect.any(Number) as unknown as number,
  latestFilingYear: 2023,
  source: 'propublica',
};

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

const INTAKE_ID = '1e238853-fb3e-52a8-bed4-954ab17a8a5d';
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
const salesforceCalls = () => db.rpcCalls.filter((c) => c.fn === 'salesforce.upsert_applicant');
const SF_ACCOUNT = '001DS0000000002AAA';
const SF_CONTACT = '003DS0000000002AAA';

beforeEach(() => {
  agent.calls = [];
  db.rpcCalls = [];
  db.user = { data: { user: { id: 'anon-user-1' } }, error: null };
  db.rpcResults = {
    'salesforce.upsert_applicant': { data: { account_id: SF_ACCOUNT, contact_id: SF_CONTACT }, error: null },
    check_model_budget: { data: 19, error: null },
    submit_scout_intake: filed('L2', 'ai'),
  };
  vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'test-key');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  stubProPublica();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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
    expect(body).toEqual({
      ...RESULT,
      intakeId: INTAKE_ID,
      routingSource: 'ai',
      registry: null,
      registryLookup: 'not_found',
    });
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
        registry: null,
      },
    ]);
  });

  describe('the registry lookup (R19)', () => {
    beforeEach(() => {
      agent.respond = async () => ({ result: RESULT, runId: 'run-1' });
    });

    it('searches ProPublica by org name before routing, and hands the match to the model, the row and the response', async () => {
      stubProPublica({
        '/search.json': {
          total_results: 1,
          num_pages: 1,
          organizations: [{ ein: 131624100, name: 'Museum Of Modern Art', city: 'New York', state: 'NY', subseccd: 3 }],
        },
        '/organizations/131624100.json': fixture('org-moma'),
      });
      const res = await post(JSON.stringify(INTAKE));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.registryLookup).toBe('matched');
      expect(body.registry).toEqual(MOMA);
      expect(scoutIntakeResponseSchema.safeParse(body).success).toBe(true);
      expect(propublicaUrls()[0]).toContain(`/search.json?q=${encodeURIComponent(INTAKE.org_name)}`);
      expect(agent.calls[0]).toMatchObject({ registry: MOMA });
      expect(submitCalls()[0].args.p_intake).toMatchObject({ registry: MOMA, registry_lookup: 'matched' });
    });

    it('with an EIN on the form fetches that organization and never searches; the hint is not filed as a column', async () => {
      stubProPublica({ '/organizations/131624100.json': fixture('org-moma') });
      const res = await post(JSON.stringify({ ...INTAKE, ein: '13-1624100' }));
      expect(res.status).toBe(200);
      expect((await res.json()).registryLookup).toBe('matched');
      expect(propublicaUrls()).toEqual([`${PROPUBLICA}/organizations/131624100.json`]);
      expect(submitCalls()[0].args.p_intake).not.toHaveProperty('ein');
    });

    it('400 invalid_input for a malformed EIN, before any lookup', async () => {
      const res = await post(JSON.stringify({ ...INTAKE, ein: '12-34' }));
      expect(res.status).toBe(400);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('no record: the router sees null and flags it, the row says not_found', async () => {
      agent.respond = async () => {
        throw new GatewayError('model_timeout', 504, 'timed out');
      };
      db.rpcResults.submit_scout_intake = filed('L3', 'derived');
      const body = await (await post(JSON.stringify(INTAKE))).json();
      expect(body.registryLookup).toBe('not_found');
      expect(body.registry).toBeNull();
      expect(body.flags).toContain('Registry: no IRS record matched the org name — verify nonprofit status');
      expect(submitCalls()[0].args.p_intake).toMatchObject({ registry: null, registry_lookup: 'not_found' });
    });

    it('several hits and no name match is ambiguous: no record, no flag, the router is told nothing', async () => {
      stubProPublica({ '/search.json': fixture('search-harlem-ny') });
      const body = await (await post(JSON.stringify({ ...INTAKE, org_name: 'Harlem' }))).json();
      expect(body.registryLookup).toBe('ambiguous');
      expect(agent.calls[0]).toMatchObject({ registry: undefined });
      expect(submitCalls()[0].args.p_intake).toMatchObject({ registry: null, registry_lookup: 'ambiguous' });
    });

    it('ProPublica down: the intake is still filed and routed, lookup unavailable, with no org name in any log line', async () => {
      stubProPublica({ '/search.json': () => Promise.resolve(new Response('', { status: 503 })) });
      const res = await post(JSON.stringify(INTAKE));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ registryLookup: 'unavailable', registry: null, bucket: RESULT.bucket });
      expect(body.flags).not.toContainEqual(expect.stringContaining('Registry:'));
      expect(agent.calls[0]).toMatchObject({ registry: undefined });
      expect(submitCalls()).toHaveLength(1);
      const warned = (console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
      expect(warned.some((l) => l.includes('registry_lookup'))).toBe(true);
      expect(JSON.stringify([...warned, ...logged()])).not.toContain('Bronx');
    });
  });

  it('files the row through submit_scout_intake with the form, the result and the run — never a tier', async () => {
    agent.respond = async () => ({ result: RESULT, runId: 'run-1' });
    await post(JSON.stringify(INTAKE));

    const [call] = submitCalls();
    expect(call.args.p_agent_run_id).toBe('run-1');
    expect(call.args.p_intake).toMatchObject({
      org_name: INTAKE.org_name,
      salesforce_account_id: SF_ACCOUNT,
      salesforce_contact_id: SF_CONTACT,
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

  // NPS #28: the row keeps Salesforce ids only — the name and email go to Salesforce.
  describe('the applicant contact (Salesforce)', () => {
    beforeEach(() => {
      agent.respond = async () => ({ result: RESULT, runId: 'run-1' });
    });

    it('upserts the applicant in Salesforce first, and files only the ids', async () => {
      await post(JSON.stringify({ ...INTAKE, ein: '13-1624100' }));
      expect(salesforceCalls()).toEqual([
        {
          fn: 'salesforce.upsert_applicant',
          args: {
            p_org_name: INTAKE.org_name,
            p_ein: '131624100',
            p_contact_name_role: INTAKE.contact_name_role,
            p_contact_email: INTAKE.contact_email,
          },
        },
      ]);
      const filedIntake = submitCalls()[0].args.p_intake as Record<string, unknown>;
      expect(filedIntake).not.toHaveProperty('contact_name_role');
      expect(filedIntake).not.toHaveProperty('contact_email');
      expect(JSON.stringify(filedIntake)).not.toContain(INTAKE.contact_email);
    });

    it('502 salesforce_unavailable when Salesforce refuses, before any model call or write, with no PII logged', async () => {
      db.rpcResults['salesforce.upsert_applicant'] = { data: null, error: { code: 'PGRST106' } };
      const res = await post(JSON.stringify(INTAKE));
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'salesforce_unavailable' });
      expect(agent.calls).toHaveLength(0);
      expect(submitCalls()).toHaveLength(0);
      expect(JSON.stringify(logged())).not.toContain(INTAKE.contact_email);
    });

    it('502 salesforce_unavailable when Salesforce answers ids of the wrong shape', async () => {
      db.rpcResults['salesforce.upsert_applicant'] = { data: { account_id: 'nope', contact_id: SF_CONTACT }, error: null };
      const res = await post(JSON.stringify(INTAKE));
      expect(res.status).toBe(502);
      expect(submitCalls()).toHaveLength(0);
    });
  });

  // The tier in the response is the tier the RPC filed. The RPC derives it from the run,
  // so a result the handler computed as L2 that the database filed as L3 answers L3.
  it('answers with the tier the database filed, not the one the model path computed', async () => {
    agent.respond = async () => ({ result: RESULT, runId: 'run-1' });
    db.rpcResults.submit_scout_intake = filed('L3', 'ai');
    const body = await (await post(JSON.stringify(INTAKE))).json();
    expect(body.hitlTier).toBe('L3');
  });

  it('keeps primary_need_other only for something_else, and the model sees the same value as the row', async () => {
    agent.respond = async () => ({ result: RESULT, runId: 'run-1' });
    await post(JSON.stringify({ ...INTAKE, primary_need: 'something_else', primary_need_other: ' A chatbot ' }));
    expect(submitCalls()[0].args.p_intake).toMatchObject({ primary_need_other: 'A chatbot' });
    expect(agent.calls[0]).toMatchObject({ primary_need: 'something_else', primary_need_other: 'A chatbot' });

    agent.calls = [];
    db.rpcCalls = [];
    await post(JSON.stringify({ ...INTAKE, primary_need_other: 'stray text under a fixed need' }));
    expect(submitCalls()[0].args.p_intake).toMatchObject({ primary_need_other: '' });
    expect(agent.calls[0]).toMatchObject({ primary_need_other: undefined });
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
      // The default ProPublica stub is a 404, so the heuristic ran with `registry: null`.
      const heuristic = routeScoutIntake({ ...INTAKE, primary_need: 'ml_predictive', registry: null });
      expect(body).toEqual({
        ...heuristic,
        hitlTier: 'L3',
        flags: [...heuristic.flags, 'Routed by the deterministic fallback — model unavailable (model_timeout)'],
        intakeId: INTAKE_ID,
        routingSource: 'derived',
        registry: null,
        registryLookup: 'not_found',
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
      expect(budgetCalls()[0]).toEqual({ fn: 'check_model_budget', args: { p_limit: 5 } });
    });

    // The public form never refuses an applicant over quota: the hour spent, the intake
    // is still filed, routed by the heuristic, flagged for the reviewer, with no run id.
    it('once the hour is spent files the heuristic result (model_budget_exceeded), no model call', async () => {
      db.rpcResults.check_model_budget = { data: null, error: { code: '53400' } };
      db.rpcResults.submit_scout_intake = filed('L3', 'derived');
      agent.respond = async () => ({ result: RESULT, runId: 'run-1' });
      const res = await post(JSON.stringify(INTAKE));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.hitlTier).toBe('L3');
      expect(body.flags.at(-1)).toContain('model_budget_exceeded');
      expect(agent.calls).toHaveLength(0);
      const [call] = submitCalls();
      expect(call.args).not.toHaveProperty('p_agent_run_id');
    });

    it('401 unauthorized when the budget RPC cannot identify the caller (42501); nothing filed', async () => {
      db.rpcResults.check_model_budget = { data: null, error: { code: '42501' } };
      agent.respond = async () => ({ result: RESULT, runId: 'run-1' });
      const res = await post(JSON.stringify(INTAKE));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthorized' });
      expect(agent.calls).toHaveLength(0);
      expect(submitCalls()).toHaveLength(0);
    });

    it('fails open, logged as an error, when the budget function is missing (42883)', async () => {
      db.rpcResults.check_model_budget = { data: null, error: { code: '42883' } };
      agent.respond = async () => ({ result: RESULT, runId: 'run-1' });
      const res = await post(JSON.stringify(INTAKE));
      expect(res.status).toBe(200);
      expect(logged()).toContainEqual(
        expect.objectContaining({ level: 'error', event: 'route_failure', step: 'budget', code: '42883' }),
      );
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
