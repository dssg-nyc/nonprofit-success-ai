import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { AgentRunPayload, RecordResult } from '../recorder';

// The recorder builds its client at module load, so each test sets env, installs the
// mock, and imports a fresh copy of the module.

const single = vi.fn();
const createClient = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}));

function fakeClient() {
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));
  return { from, insert, select };
}

const PAYLOAD: AgentRunPayload = {
  agent: 'scout',
  engagementId: null,
  model: 'gemini-3.8-flash',
  promptVersion: 'scout@1',
  status: 'success',
  inputTokens: 120,
  outputTokens: 40,
  hitlTier: 'L3',
  durationMs: 150,
};

async function loadRecorder(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) vi.stubEnv(key, '');
    else vi.stubEnv(key, value);
  }
  vi.resetModules();
  return import('../recorder');
}

const CONFIGURED = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
};

describe('recordRun', () => {
  beforeEach(() => {
    single.mockReset();
    createClient.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('reports not_configured when the service-role key is missing', async () => {
    const { recordRun } = await loadRecorder({
      SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_URL: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
    });

    await expect(recordRun(PAYLOAD)).resolves.toEqual({
      recorded: false,
      reason: 'not_configured',
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('creates the client once at module load, not per call', async () => {
    const client = fakeClient();
    createClient.mockReturnValue(client);
    single.mockResolvedValue({ data: { id: 'run-1' }, error: null });

    const { recordRun } = await loadRecorder(CONFIGURED);
    await recordRun(PAYLOAD);
    await recordRun(PAYLOAD);

    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it('returns the written row id on success, with snake_case telemetry columns', async () => {
    const client = fakeClient();
    createClient.mockReturnValue(client);
    single.mockResolvedValue({ data: { id: 'run-1' }, error: null });

    const { recordRun } = await loadRecorder(CONFIGURED);
    const result = await recordRun(PAYLOAD);

    expect(result).toEqual({ recorded: true, runId: 'run-1' });
    expect(client.from).toHaveBeenCalledWith('agent_runs');
    expect(client.insert).toHaveBeenCalledWith({
      agent: 'scout',
      organization_id: null,
      engagement_id: null,
      model: 'gemini-3.8-flash',
      prompt_version: 'scout@1',
      status: 'success',
      error_code: null,
      input_tokens: 120,
      output_tokens: 40,
      hitl_tier: 'L3',
      duration_ms: 150,
      cost_cents: null,
    });
  });

  it('writes costCents to cost_cents when the gateway priced the call', async () => {
    const client = fakeClient();
    createClient.mockReturnValue(client);
    single.mockResolvedValue({ data: { id: 'run-2' }, error: null });

    const { recordRun } = await loadRecorder(CONFIGURED);
    await recordRun({ ...PAYLOAD, costCents: 0.155 });

    expect(client.insert).toHaveBeenCalledWith(expect.objectContaining({ cost_cents: 0.155 }));
  });

  it('reports write_failed on an insert error, without throwing', async () => {
    createClient.mockReturnValue(fakeClient());
    single.mockResolvedValue({ data: null, error: { message: 'permission denied' } });

    const { recordRun } = await loadRecorder(CONFIGURED);

    await expect(recordRun(PAYLOAD)).resolves.toEqual({
      recorded: false,
      reason: 'write_failed',
    });
    expect(console.error).toHaveBeenCalled();
  });

  it('retries without the links when the engagement id is not a uuid, and says so', async () => {
    const client = fakeClient();
    createClient.mockReturnValue(client);
    single
      .mockResolvedValueOnce({ data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' } })
      .mockResolvedValueOnce({ data: { id: 'run-3' }, error: null });

    const { recordRun } = await loadRecorder(CONFIGURED);
    const result = await recordRun({ ...PAYLOAD, engagementId: 'e-101', organizationId: 'org-1' });

    expect(result).toEqual({ recorded: true, runId: 'run-3' });
    expect(client.insert).toHaveBeenCalledTimes(2);
    expect(client.insert).toHaveBeenNthCalledWith(1, expect.objectContaining({ engagement_id: 'e-101', organization_id: 'org-1' }));
    expect(client.insert).toHaveBeenNthCalledWith(2, expect.objectContaining({ engagement_id: null, organization_id: null }));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"event":"recorder_unlinked"'));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"code":"22P02"'));
    expect(console.error).not.toHaveBeenCalled();
  });

  it('retries without the links when the engagement no longer exists (foreign key)', async () => {
    const client = fakeClient();
    createClient.mockReturnValue(client);
    single
      .mockResolvedValueOnce({ data: null, error: { code: '23503', message: 'violates foreign key constraint' } })
      .mockResolvedValueOnce({ data: { id: 'run-4' }, error: null });

    const { recordRun } = await loadRecorder(CONFIGURED);
    const result = await recordRun({ ...PAYLOAD, engagementId: '6f1c2a2e-0000-4000-8000-000000000001' });

    expect(result).toEqual({ recorded: true, runId: 'run-4' });
    expect(client.insert).toHaveBeenCalledTimes(2);
  });

  it('does not retry a link error on a row that had no links, nor any other error', async () => {
    const client = fakeClient();
    createClient.mockReturnValue(client);
    single.mockResolvedValue({ data: null, error: { code: '23503', message: 'violates foreign key constraint' } });

    const { recordRun } = await loadRecorder(CONFIGURED);
    await expect(recordRun(PAYLOAD)).resolves.toEqual({ recorded: false, reason: 'write_failed' });
    expect(client.insert).toHaveBeenCalledTimes(1);

    single.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(recordRun({ ...PAYLOAD, engagementId: 'e-101' })).resolves.toEqual({ recorded: false, reason: 'write_failed' });
    expect(client.insert).toHaveBeenCalledTimes(2);
  });

  it('reports write_failed when the client throws, without throwing', async () => {
    createClient.mockReturnValue(fakeClient());
    single.mockRejectedValue(new Error('network down'));

    const { recordRun } = await loadRecorder(CONFIGURED);

    await expect(recordRun(PAYLOAD)).resolves.toEqual({
      recorded: false,
      reason: 'write_failed',
    });
  });

  it('reports not_configured when client creation itself throws', async () => {
    createClient.mockImplementation(() => {
      throw new Error('Invalid supabaseUrl');
    });

    const { recordRun } = await loadRecorder(CONFIGURED);

    await expect(recordRun(PAYLOAD)).resolves.toEqual({
      recorded: false,
      reason: 'not_configured',
    });
  });
});

describe('AgentRunPayload', () => {
  it('carries no raw model I/O (observability.md Rules)', () => {
    type Keys = keyof AgentRunPayload;
    expectTypeOf<Extract<Keys, 'rawPrompt'>>().toBeNever();
    expectTypeOf<Extract<Keys, 'rawOutput'>>().toBeNever();
    expectTypeOf<Extract<Keys, 'input'>>().toBeNever();
    expectTypeOf<Extract<Keys, 'output'>>().toBeNever();
    expectTypeOf<Extract<Keys, 'prompt'>>().toBeNever();
  });

  it('never fabricates a run id for an unwritten run', () => {
    expectTypeOf<Extract<RecordResult, { recorded: false }>>().not.toHaveProperty('runId');
  });
});
