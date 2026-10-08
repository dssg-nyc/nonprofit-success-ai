import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayError } from '../../src/model/errors';
import type { ScoutIntakeRequest, ScoutResult } from '../../src/types';
import { Cleanup, anonymousSession, jsonRequest, stack } from './_stack';
import type { Stack } from './_stack';

/**
 * `POST /api/route-intake` against the running local stack (`make api-test`): real
 * anonymous sessions, the real `submit_scout_intake()` and `check_model_budget()` RPCs,
 * rows read back with the service role. The model is the one thing mocked — a run is
 * seeded in `agent_runs` the way the recorder would write it, so the RPC's provenance
 * check (tier from the run, not the payload) is exercised for real.
 */

vi.mock('../../src/agents/scout/model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/agents/scout/model')>();
  return { ...actual, routeScoutIntakeWithModel: vi.fn() };
});

import { routeScoutIntakeWithModel } from '../../src/agents/scout/model';
import { POST } from '../route-intake';

const modelMock = vi.mocked(routeScoutIntakeWithModel);

const ORG = 'Integration Intake Org';

const intake = (): ScoutIntakeRequest => ({
  org_name: ORG,
  contact_name_role: 'Sam Lee, ED',
  contact_email: 'sam@example.test',
  mission: 'We help families keep stable housing across the five boroughs.',
  scale: '400 households a year',
  primary_need: 'analyze_data',
  problem_description:
    'We collect outcome surveys in spreadsheets and cannot report trends to funders; we want an analysis of what predicts a stable placement.',
  current_systems: 'Google Sheets, Salesforce NPSP',
  timeline: 'Next quarter',
  referral_source: 'Word of mouth',
});

const highReady = (): ScoutResult => ({
  bucket: 'Analytics & Insight',
  confidence: 'High',
  rationale: 'Clear analytical need with existing data.',
  poc_score: 3,
  clarity_score: 3,
  foothold_score: 3,
  composite_signal: 'Ready',
  flags: [],
  hitlTier: 'L2',
});

let s: Stack;
let cleanup: Cleanup;
const envBefore = { key: process.env.GOOGLE_GENERATIVE_AI_API_KEY, budget: process.env.MODEL_CALLS_PER_HOUR };

beforeAll(() => {
  s = stack();
  cleanup = new Cleanup(s);
});

afterAll(async () => {
  await cleanup.run_all();
});

beforeEach(() => {
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.MODEL_CALLS_PER_HOUR;
  modelMock.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (envBefore.key === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  else process.env.GOOGLE_GENERATIVE_AI_API_KEY = envBefore.key;
  if (envBefore.budget === undefined) delete process.env.MODEL_CALLS_PER_HOUR;
  else process.env.MODEL_CALLS_PER_HOUR = envBefore.budget;
});

async function session() {
  const anon = await anonymousSession(s);
  cleanup.user(anon.userId);
  return anon;
}

async function seedRun(fields: { status: 'success' | 'fallback'; hitl_tier: 'L2' | 'L3' }) {
  const { data, error } = await s.service
    .from('agent_runs')
    .insert({
      agent: 'scout',
      model: 'integration-model',
      prompt_version: 'scout-routing-int',
      status: fields.status,
      hitl_tier: fields.hitl_tier,
      duration_ms: 1,
      input_tokens: 10,
      output_tokens: 5,
      cost_cents: 0.001,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seedRun: ${error?.message}`);
  return data.id;
}

async function filedRow(intakeId: string) {
  cleanup.intake(intakeId);
  const { data, error } = await s.service
    .from('scout_intakes')
    .select('hitl_tier, routing_source, routing_run_id, routing_model, routing_prompt_version, bucket, confidence, flags')
    .eq('id', intakeId)
    .single();
  if (error || !data) throw new Error(`filedRow: ${error?.message}`);
  return data;
}

async function countFiled(orgName: string) {
  const { count, error } = await s.service
    .from('scout_intakes')
    .select('id', { count: 'exact', head: true })
    .eq('org_name', orgName);
  if (error) throw new Error(`countFiled: ${error.message}`);
  return count ?? 0;
}

describe('POST /api/route-intake (integration)', () => {
  it('refuses a request with no session: nothing is filed', async () => {
    const res = await POST(jsonRequest('/api/route-intake', intake()));
    expect(res.status).toBe(401);
    expect(modelMock).not.toHaveBeenCalled();
  });

  it('files a fallback-routed intake as L3 / derived when no model key is configured', async () => {
    const { token } = await session();
    const res = await POST(jsonRequest('/api/route-intake', intake(), token));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBeTruthy();
    const body = await res.json();
    expect(body).toMatchObject({ hitlTier: 'L3', routingSource: 'derived', bucket: 'Analytics & Insight' });
    expect(body.flags.some((f: string) => f.includes('model_key_missing'))).toBe(true);
    expect(modelMock).not.toHaveBeenCalled();

    const row = await filedRow(body.intakeId);
    expect(row).toMatchObject({ hitl_tier: 'L3', routing_source: 'derived', routing_run_id: null });
  });

  it('files a model result as L2 / ai only through a successful L2 run the recorder wrote', async () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'integration-test-key';
    const runId = await seedRun({ status: 'success', hitl_tier: 'L2' });
    modelMock.mockResolvedValue({ result: highReady(), runId });
    const { token } = await session();

    const res = await POST(jsonRequest('/api/route-intake', intake(), token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ hitlTier: 'L2', routingSource: 'ai', bucket: 'Analytics & Insight', confidence: 'High' });

    const row = await filedRow(body.intakeId);
    expect(row).toMatchObject({
      hitl_tier: 'L2',
      routing_source: 'ai',
      routing_run_id: runId,
      routing_model: 'integration-model',
      routing_prompt_version: 'scout-routing-int',
    });
  });

  it('the database, not the result, decides the tier: a run recorded as L3 files as L3 even for High + Ready', async () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'integration-test-key';
    const runId = await seedRun({ status: 'success', hitl_tier: 'L3' });
    modelMock.mockResolvedValue({ result: highReady(), runId });
    const { token } = await session();

    const res = await POST(jsonRequest('/api/route-intake', intake(), token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hitlTier).toBe('L3');
    expect((await filedRow(body.intakeId)).hitl_tier).toBe('L3');
  });

  it('a run that did not succeed is refused by the RPC: 400 invalid_intake, nothing filed', async () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'integration-test-key';
    const runId = await seedRun({ status: 'fallback', hitl_tier: 'L3' });
    modelMock.mockResolvedValue({ result: highReady(), runId });
    const { token } = await session();
    const org = `${ORG} refused-run`;

    const res = await POST(jsonRequest('/api/route-intake', { ...intake(), org_name: org }, token));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_intake' });
    expect(await countFiled(org)).toBe(0);
  });

  it('a gateway failure files the heuristic result as L3 with no run linked', async () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'integration-test-key';
    modelMock.mockRejectedValue(new GatewayError('model_timeout', 504, 'timed out'));
    const { token } = await session();

    const res = await POST(jsonRequest('/api/route-intake', intake(), token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ hitlTier: 'L3', routingSource: 'derived' });
    expect(body.flags.some((f: string) => f.includes('model_timeout'))).toBe(true);
    expect((await filedRow(body.intakeId)).routing_run_id).toBeNull();
  });

  it('spends the per-user hourly budget on the real counter and answers 429 once it is gone', async () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'integration-test-key';
    process.env.MODEL_CALLS_PER_HOUR = '1';
    const runId = await seedRun({ status: 'success', hitl_tier: 'L2' });
    modelMock.mockResolvedValue({ result: highReady(), runId });
    const { token } = await session();
    const org = `${ORG} budget`;

    const first = await POST(jsonRequest('/api/route-intake', { ...intake(), org_name: org }, token));
    expect(first.status).toBe(200);
    cleanup.intake((await first.json()).intakeId);

    const second = await POST(jsonRequest('/api/route-intake', { ...intake(), org_name: org }, token));
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({ error: 'model_budget_exceeded' });
    expect(Number(second.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(modelMock).toHaveBeenCalledTimes(1);
    expect(await countFiled(org)).toBe(1);
  });

  it('rejects an invalid body before any session, model or database work', async () => {
    const { token } = await session();
    const org = `${ORG} invalid`;
    const res = await POST(jsonRequest('/api/route-intake', { ...intake(), org_name: org, contact_email: '' }, token));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_input' });
    expect(await countFiled(org)).toBe(0);
  });
});
