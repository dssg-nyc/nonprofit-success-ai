import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AgentRunPayload, RecordResult } from '../../observability/recorder';

// The gateway's only seams: the provider factories and the recorder. All are replaced,
// so no test needs a key, a network, or a database. `providers` records which factory
// each call went through, and with which model id.
const model = vi.hoisted(() => ({ current: null as unknown }));
const providers = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('@ai-sdk/google', () => ({
  google: (id: string) => {
    providers.calls.push(`google:${id}`);
    return model.current;
  },
}));
vi.mock('@ai-sdk/openai', () => ({
  openai: (id: string) => {
    providers.calls.push(`openai:${id}`);
    return model.current;
  },
}));

const recorder = vi.hoisted(() => ({
  calls: [] as AgentRunPayload[],
  result: { recorded: true, runId: 'run-1' } as RecordResult,
  /** When true the write never resolves — a stalled Supabase connection. */
  hang: false,
}));
vi.mock('../../observability/recorder', () => ({
  recordRun: async (payload: AgentRunPayload) => {
    recorder.calls.push(payload);
    if (recorder.hang) return new Promise<RecordResult>(() => {});
    return recorder.result;
  },
}));

const { callModel, DEFAULT_MAX_OUTPUT_TOKENS, RATE_LIMIT_BACKOFF_MS, RECORD_TIMEOUT_MS, providerOf } =
  await import('../gateway');
const { GatewayError } = await import('../errors');

const schema = z.object({ answer: z.number() });
type Generate = MockLanguageModelV4['doGenerate'];

function ok(text: string): Awaited<ReturnType<Generate>> {
  return {
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: 'STOP' },
    usage: {
      inputTokens: { total: 42, noCache: 42, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 7, text: 7, reasoning: 0 },
    },
    warnings: [],
  };
}

function rateLimited(): APICallError {
  return new APICallError({
    message: 'Resource has been exhausted',
    url: 'https://example.invalid',
    requestBodyValues: {},
    statusCode: 429,
    isRetryable: true,
  });
}

/** A Google API 429 body: a QuotaFailure naming `quotaId`, plus a RetryInfo delay. */
function quotaError(quotaId: string, retryDelay = '33s'): APICallError {
  return new APICallError({
    message: 'You exceeded your current quota',
    url: 'https://example.invalid',
    requestBodyValues: {},
    statusCode: 429,
    isRetryable: true,
    responseBody: JSON.stringify({
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        details: [
          { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId }] },
          { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay },
        ],
      },
    }),
  });
}

/** An OpenAI 429: `error.code` in the body, the wait in `retry-after-ms` / `retry-after` headers. */
function openAiError(code: string, headers: Record<string, string> = {}): APICallError {
  return new APICallError({
    message: code,
    url: 'https://example.invalid',
    requestBodyValues: {},
    statusCode: 429,
    isRetryable: true,
    responseHeaders: headers,
    responseBody: JSON.stringify({ error: { message: code, type: code, code } }),
  });
}

function useModel(...steps: Array<() => Promise<Awaited<ReturnType<Generate>>>>): MockLanguageModelV4 {
  let i = 0;
  const mock = new MockLanguageModelV4({
    doGenerate: async () => {
      const step = steps[Math.min(i, steps.length - 1)];
      i += 1;
      return step();
    },
  });
  model.current = mock;
  return mock;
}

const request = { agent: 'scout' as const, schema, prompt: 'p', promptVersion: 'test@v1' };

beforeEach(() => {
  vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'test-key');
  vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
  providers.calls = [];
  recorder.calls = [];
  recorder.result = { recorded: true, runId: 'run-1' };
  recorder.hang = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

/** Every structured line the gateway wrote this test, parsed. */
function logged(): Array<Record<string, unknown>> {
  return (['info', 'warn', 'error'] as const).flatMap((level) =>
    vi.mocked(console[level]).mock.calls.map(([text]) => JSON.parse(String(text)) as Record<string, unknown>),
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('callModel', () => {
  it('returns the validated object and records token usage on success', async () => {
    const mock = useModel(async () => ok('{"answer":3}'));

    const res = await callModel({ ...request, recordTier: () => 'L2' });

    expect(res).toEqual({
      object: { answer: 3 },
      runId: 'run-1',
      model: 'gemini-3.5-flash-lite',
      usage: { inputTokens: 42, outputTokens: 7 },
      retried: false,
    });
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0]).toMatchObject({
      agent: 'scout',
      status: 'success',
      inputTokens: 42,
      outputTokens: 7,
      hitlTier: 'L2',
      promptVersion: 'test@v1',
      // gemini-3.5-flash-lite list price: 42 × $0.30/M + 7 × $2.50/M = $0.0000301 = 0.0030¢
      costCents: 0.003,
    });
    expect(mock.doGenerateCalls[0].maxOutputTokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
  });

  it('passes a per-request maxOutputTokens override to the model', async () => {
    const mock = useModel(async () => ok('{"answer":1}'));
    await callModel({ ...request, maxOutputTokens: 64 });
    expect(mock.doGenerateCalls[0].maxOutputTokens).toBe(64);
  });

  it('retries exactly once on 429, then succeeds', async () => {
    vi.useFakeTimers();
    const mock = useModel(
      async () => {
        throw rateLimited();
      },
      async () => ok('{"answer":5}'),
    );

    const pending = callModel(request);
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_BACKOFF_MS);
    const res = await pending;

    expect(res.object).toEqual({ answer: 5 });
    expect(res.retried).toBe(true);
    expect(mock.doGenerateCalls).toHaveLength(2);
    expect(recorder.calls.map((c) => c.status)).toEqual(['success']);
  });

  it('a second 429 throws model_rate_limited without a third attempt', async () => {
    vi.useFakeTimers();
    const mock = useModel(async () => {
      throw rateLimited();
    });

    const pending = callModel(request).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_BACKOFF_MS);
    const err = await pending;

    expect(err).toBeInstanceOf(GatewayError);
    expect((err as InstanceType<typeof GatewayError>).code).toBe('model_rate_limited');
    expect(mock.doGenerateCalls).toHaveLength(2);
    expect(recorder.calls[0]).toMatchObject({ status: 'error', errorCode: 'model_rate_limited' });
  });

  it('a per-day quota 429 is model_quota_exhausted, with no retry', async () => {
    const mock = useModel(async () => {
      throw quotaError('GenerateRequestsPerDayPerProjectPerModel-FreeTier');
    });
    await expect(callModel(request)).rejects.toMatchObject({ code: 'model_quota_exhausted', httpStatus: 429 });
    expect(mock.doGenerateCalls).toHaveLength(1);
  });

  it("a per-minute 429 stays model_rate_limited and carries the provider's retry delay", async () => {
    vi.useFakeTimers();
    useModel(async () => {
      throw quotaError('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '1.5s');
    });
    const pending = callModel(request).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_BACKOFF_MS);
    expect(await pending).toMatchObject({ code: 'model_rate_limited', retryAfterMs: 1_500 });
  });

  it('a provider 503 (overloaded) is model_unavailable, keeps its message, and is not retried', async () => {
    const mock = useModel(async () => {
      throw new APICallError({
        message: 'This model is currently experiencing high demand.',
        url: 'https://example.invalid',
        requestBodyValues: {},
        statusCode: 503,
        isRetryable: true,
      });
    });
    const err = await callModel(request).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'model_unavailable', httpStatus: 503 });
    expect((err as Error).message).toContain('high demand');
    expect(mock.doGenerateCalls).toHaveLength(1);
  });

  it('caps thinking at the configured level (default low)', async () => {
    const mock = useModel(async () => ok('{"answer":1}'));
    await callModel(request);
    vi.stubEnv('GATEWAY_THINKING_LEVEL', 'minimal');
    await callModel(request);
    expect(mock.doGenerateCalls.map((c) => c.providerOptions?.google)).toEqual([
      { thinkingConfig: { thinkingLevel: 'low' } },
      { thinkingConfig: { thinkingLevel: 'minimal' } },
    ]);
  });

  it('does not retry a non-429 provider error', async () => {
    const mock = useModel(async () => {
      throw new APICallError({
        message: 'internal',
        url: 'https://example.invalid',
        requestBodyValues: {},
        statusCode: 500,
        isRetryable: true,
      });
    });

    await expect(callModel(request)).rejects.toMatchObject({ code: 'model_call_failed' });
    expect(mock.doGenerateCalls).toHaveLength(1);
  });

  it('aborts at the deadline and classifies it as model_timeout', async () => {
    useModel(
      () =>
        new Promise((_, reject) => {
          const signal = (model.current as MockLanguageModelV4).doGenerateCalls.at(-1)?.abortSignal;
          signal?.addEventListener('abort', () => reject(signal.reason));
        }),
    );

    const err = await callModel({ ...request, timeoutMs: 20 }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GatewayError);
    expect((err as InstanceType<typeof GatewayError>).code).toBe('model_timeout');
    expect((err as InstanceType<typeof GatewayError>).httpStatus).toBe(504);
    expect(recorder.calls[0]).toMatchObject({ status: 'error', errorCode: 'model_timeout' });
  });

  it('classifies a schema mismatch as model_parse_error, without retrying', async () => {
    const mock = useModel(async () => ok('{"answer":"three"}'));
    await expect(callModel(request)).rejects.toMatchObject({ code: 'model_parse_error' });
    expect(mock.doGenerateCalls).toHaveLength(1);
    // The failed parse still spent tokens; the row says so.
    expect(recorder.calls[0]).toMatchObject({ inputTokens: 42, outputTokens: 7 });
  });

  it('returns runId null, and does not throw, when the recorder did not write', async () => {
    useModel(async () => ok('{"answer":1}'));
    recorder.result = { recorded: false, reason: 'not_configured' };

    const res = await callModel(request);

    expect(res.runId).toBeNull();
    expect(res.object).toEqual({ answer: 1 });
  });

  it('sets runId null on the thrown error when the recorder did not write', async () => {
    useModel(async () => ok('not json'));
    recorder.result = { recorded: false, reason: 'write_failed' };

    const err = await callModel(request).catch((e: unknown) => e);
    expect((err as InstanceType<typeof GatewayError>).runId).toBeNull();
  });

  // The model deadline covers generateText only; a stalled agent_runs insert after it must
  // not hold the response past the handler's maxDuration (review finding, 2026-10-08).
  it('abandons a stalled recorder write after RECORD_TIMEOUT_MS and still returns the object', async () => {
    vi.useFakeTimers();
    useModel(async () => ok('{"answer": 1}'));
    recorder.hang = true;

    const pending = callModel(request);
    await vi.advanceTimersByTimeAsync(RECORD_TIMEOUT_MS);
    const res = await pending;

    expect(res.object).toEqual({ answer: 1 });
    expect(res.runId).toBeNull();
    expect(logged()).toContainEqual(
      expect.objectContaining({ event: 'recorder_write_failed', code: 'recorder_timeout', agent: 'scout' }),
    );
  });

  it('a stalled recorder write on the failure path still surfaces the gateway error in time', async () => {
    vi.useFakeTimers();
    useModel(async () => ok('not json'));
    recorder.hang = true;

    const pending = callModel(request).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(RECORD_TIMEOUT_MS);
    const err = (await pending) as InstanceType<typeof GatewayError>;

    expect(err.code).toBe('model_parse_error');
    expect(err.runId).toBeNull();
  });

  it('throws model_key_missing at call time when the key is unset', async () => {
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', '');
    await expect(callModel(request)).rejects.toMatchObject({ code: 'model_key_missing' });
    expect(recorder.calls).toHaveLength(0);
  });

  // failureStatus 'fallback': the caller serves its template server-side, so the one row
  // for the call says so — never an `error` row plus a second `fallback` row.
  it("records a failed call as one 'fallback' row, error code kept, when asked", async () => {
    useModel(async () => ok('not json'));
    recorder.result = { recorded: true, runId: 'run-fb' };

    const err = await callModel({ ...request, failureStatus: 'fallback' }).catch((e: unknown) => e);

    expect(err).toMatchObject({ code: 'model_parse_error', runId: 'run-fb' });
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0]).toMatchObject({ status: 'fallback', errorCode: 'model_parse_error' });
  });

  it("records a missing key as a 'fallback' run when the caller falls back", async () => {
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', '');
    recorder.result = { recorded: true, runId: 'run-nokey' };

    const err = await callModel({ ...request, failureStatus: 'fallback' }).catch((e: unknown) => e);

    expect(err).toMatchObject({ code: 'model_key_missing', runId: 'run-nokey' });
    expect(recorder.calls).toEqual([
      expect.objectContaining({ status: 'fallback', errorCode: 'model_key_missing', durationMs: 0 }),
    ]);
  });
});

describe('provider routing', () => {
  it('maps model ids to providers', () => {
    expect(providerOf('gemini-3.5-flash-lite')).toBe('google');
    expect(providerOf('gpt-5.4-nano')).toBe('openai');
    expect(providerOf('o4-mini')).toBe('openai');
  });

  it('sends a gpt-* model through OpenAI with reasoningEffort, and the default through Google', async () => {
    const mock = useModel(async () => ok('{"answer":1}'));
    await callModel({ ...request, model: 'gpt-5.4-nano' });
    await callModel(request);

    expect(providers.calls).toEqual(['openai:gpt-5.4-nano', 'google:gemini-3.5-flash-lite']);
    expect(mock.doGenerateCalls[0].providerOptions).toEqual({ openai: { reasoningEffort: 'low' } });
    expect(recorder.calls[0]).toMatchObject({ model: 'gpt-5.4-nano', status: 'success' });
  });

  it("checks the model's own provider key", async () => {
    useModel(async () => ok('{"answer":1}'));
    vi.stubEnv('OPENAI_API_KEY', '');

    await expect(callModel({ ...request, model: 'gpt-5.4-nano' })).rejects.toMatchObject({
      code: 'model_key_missing',
      message: expect.stringContaining('OPENAI_API_KEY'),
    });
    // The Google key is still set, so a Gemini call goes through.
    await expect(callModel(request)).resolves.toMatchObject({ object: { answer: 1 } });
  });

  it('classifies OpenAI insufficient_quota as model_quota_exhausted, without retrying', async () => {
    const mock = useModel(async () => {
      throw openAiError('insufficient_quota');
    });
    const err = await callModel({ ...request, model: 'gpt-5.4-nano' }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'model_quota_exhausted', message: expect.stringContaining('OpenAI') });
    expect(mock.doGenerateCalls).toHaveLength(1);
  });

  it("reads an OpenAI rate limit's wait from retry-after-ms, else retry-after", async () => {
    useModel(async () => {
      throw openAiError('rate_limit_exceeded', { 'retry-after-ms': '750' });
    });
    expect(await callModel({ ...request, model: 'gpt-5.4-nano' }).catch((e: unknown) => e)).toMatchObject({
      code: 'model_rate_limited',
      retryAfterMs: 750,
    });

    useModel(async () => {
      throw openAiError('rate_limit_exceeded', { 'retry-after': '2' });
    });
    expect(await callModel({ ...request, model: 'gpt-5.4-nano' }).catch((e: unknown) => e)).toMatchObject({
      code: 'model_rate_limited',
      retryAfterMs: 2000,
    });
  });
});

describe('logging', () => {
  it('logs a successful call as one info model_call line with latency and tokens', async () => {
    useModel(async () => ok('{"answer":1}'));
    await callModel(request);

    expect(logged()).toEqual([
      expect.objectContaining({
        level: 'info',
        event: 'model_call',
        agent: 'scout',
        model: 'gemini-3.5-flash-lite',
        provider: 'google',
        promptVersion: 'test@v1',
        status: 'success',
        durationMs: expect.any(Number),
        retried: false,
        inputTokens: 42,
        outputTokens: 7,
        runId: 'run-1',
      }),
    ]);
  });

  it('logs an expected failure as warn, with code and provider status', async () => {
    useModel(async () => {
      throw quotaError('GenerateRequestsPerDayPerProjectPerModel-FreeTier');
    });
    await callModel(request).catch(() => {});

    expect(logged()).toEqual([
      expect.objectContaining({ level: 'warn', code: 'model_quota_exhausted', providerStatus: 429, errorName: 'AI_APICallError' }),
    ]);
  });

  it('never logs the prompt or request body of a failed call', async () => {
    const intake = 'INTAKE Jane Doe jane@example.org';
    useModel(async () => {
      throw new APICallError({
        message: 'internal',
        url: 'https://example.invalid',
        requestBodyValues: { contents: [{ parts: [{ text: intake }] }], flat: intake },
        statusCode: 500,
        isRetryable: true,
        responseBody: JSON.stringify({ echoed: intake }),
      });
    });
    await callModel({ ...request, prompt: intake }).catch(() => {});

    const written = (['info', 'warn', 'error'] as const)
      .flatMap((level) => vi.mocked(console[level]).mock.calls.flat())
      .map(String)
      .join('\n');
    expect(written).toContain('model_call_failed');
    expect(written).not.toContain('Jane Doe');
  });
});
