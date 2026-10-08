import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import { generateText, NoObjectGeneratedError, Output } from 'ai';
import type { JSONValue, LanguageModel, LanguageModelUsage } from 'ai';
import { errorName, log } from '../observability/log';
import type { LogLevel } from '../observability/log';
import { recordRun } from '../observability/recorder';
import type { AgentRunPayload, RecordResult } from '../observability/recorder';
import { GatewayError, classifyModelError, isRateLimited, providerStatusCode } from './errors';
import { costCents } from './pricing';
import type { GatewayErrorCode } from './errors';
import type { GatewayRequest, GatewayResponse, GatewayUsage, ModelProvider } from './types';

/**
 * Each provider reads its own server-only key (never `VITE_`-prefixed). The agents run
 * on Google; the eval judges run on OpenAI, so a judge is a different vendor from the
 * agent it grades and its calls do not spend the Gemini quota.
 */
export const PROVIDER_KEYS: Record<ModelProvider, string> = {
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  openai: 'OPENAI_API_KEY',
};

/** The provider a model id belongs to: OpenAI ids start `gpt-` or `o<digit>`; everything else is Gemini. */
export function providerOf(modelId: string): ModelProvider {
  return /^(gpt-|o\d)/.test(modelId) ? 'openai' : 'google';
}

/** The model a request without `model` uses: env GATEWAY_MODEL, else DEFAULT_MODEL. */
export function defaultModel(): string {
  return process.env.GATEWAY_MODEL || DEFAULT_MODEL;
}

// gemini-2.5-flash was retired for new API keys (every call returned "no longer available
// to new users", 2026-10-07). gemini-3.8-flash's free tier is 20 requests/day, which a
// single eval run exceeds; 3.5 Flash-Lite is the free-tier-workable default.
// GATEWAY_MODEL overrides this without a code change.
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
/**
 * Every gateway call is a structured extraction or a short draft, not open-ended
 * reasoning, and the whole call must land inside DEFAULT_TIMEOUT_MS. Unbounded thinking
 * is what pushed calls past the deadline (`model_timeout`, 2026-10-07).
 * GATEWAY_THINKING_LEVEL overrides it.
 */
const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'low';
// Faster, for agents whose call is closer to classification than reasoning (Scout
// routing). Not the default until an eval run shows routing and judge scores hold.
// const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'minimal';
const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];

function thinkingLevel(): ThinkingLevel {
  const value = process.env.GATEWAY_THINKING_LEVEL;
  return THINKING_LEVELS.find((level) => level === value) ?? DEFAULT_THINKING_LEVEL;
}

/** Total budget per call, retry included — under the /api handlers' 30s maxDuration. */
export const DEFAULT_TIMEOUT_MS = 25_000;
/** Enough for every current agent schema (a routing object, a draft) with headroom. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 2_048;
/** model-gateway.md: one retry on 429 after 2^attempt * 500ms, attempt = 1. */
export const RATE_LIMIT_BACKOFF_MS = 1_000;

/** Whether the key for `modelId`'s provider is set. Read at call time, never at import. */
export function hasModelKey(modelId: string = defaultModel()): boolean {
  const value = process.env[PROVIDER_KEYS[providerOf(modelId)]];
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * The SDK model and the provider's reasoning cap. Both caps come from one setting
 * (GATEWAY_THINKING_LEVEL): Gemini's `thinkingLevel` and OpenAI's `reasoningEffort`
 * take the same level names.
 */
function resolveModel(modelId: string): { model: LanguageModel; providerOptions: Record<string, Record<string, JSONValue>> } {
  const level = thinkingLevel();
  return providerOf(modelId) === 'openai'
    ? { model: openai(modelId), providerOptions: { openai: { reasoningEffort: level } } }
    : { model: google(modelId), providerOptions: { google: { thinkingConfig: { thinkingLevel: level } } } };
}

/** The identifying fields every `model_call` line carries. */
function logBase(
  base: { agent: GatewayRequest['agent']; organizationId?: string; engagementId?: string; promptVersion?: string },
  modelId: string,
) {
  return {
    agent: base.agent,
    model: modelId,
    provider: providerOf(modelId),
    promptVersion: base.promptVersion,
    organizationId: base.organizationId,
    engagementId: base.engagementId,
  };
}

const NO_USAGE: GatewayUsage = { inputTokens: undefined, outputTokens: undefined };

function toUsage(usage: LanguageModelUsage | undefined): GatewayUsage {
  if (!usage) return NO_USAGE;
  return { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
}

/** A parse failure still consumed tokens; the SDK error carries the count. */
function usageFromError(err: unknown): GatewayUsage {
  return NoObjectGeneratedError.isInstance(err) ? toUsage(err.usage) : NO_USAGE;
}

/**
 * The most a telemetry write may add to a call. The model deadline (DEFAULT_TIMEOUT_MS)
 * covers only `generateText`; the `agent_runs` insert that follows has to fit in what is
 * left of the handler's 30s `maxDuration`, or Vercel kills the request before the draft
 * RPC runs and the caller gets nothing instead of the fallback.
 */
export const RECORD_TIMEOUT_MS = 2_000;

/**
 * recordRun() returns rather than throws by contract, but telemetry must never break a
 * model response (model-gateway.md Rules), so a throw is downgraded here too, and a
 * stalled write is abandoned after RECORD_TIMEOUT_MS (the insert may still land; its id
 * is simply not known to this response).
 */
async function safeRecord(payload: AgentRunPayload): Promise<RecordResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<RecordResult>((resolve) => {
    timer = setTimeout(() => {
      log('error', 'recorder_write_failed', { agent: payload.agent, code: 'recorder_timeout' });
      resolve({ recorded: false, reason: 'write_failed' });
    }, RECORD_TIMEOUT_MS);
  });
  try {
    return await Promise.race([recordRun(payload), expiry]);
  } catch (err) {
    log('error', 'recorder_write_failed', { agent: payload.agent, code: 'recorder_threw', errorName: errorName(err) });
    return { recorded: false, reason: 'write_failed' };
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * A failure the system is built to absorb (the caller falls back, the eval scheduler
 * retries) is `warn`; one that needs a human (bad config, an unclassified provider
 * error) is `error`.
 */
const FAILURE_LEVEL: Record<GatewayErrorCode, LogLevel> = {
  model_key_missing: 'error',
  model_call_failed: 'error',
  model_timeout: 'warn',
  model_rate_limited: 'warn',
  model_quota_exhausted: 'warn',
  model_unavailable: 'warn',
  model_parse_error: 'warn',
};

export async function callModel<T>(
  request: GatewayRequest<T>,
): Promise<GatewayResponse<T>> {
  const modelId = request.model ?? defaultModel();
  const failureStatus = request.failureStatus ?? 'error';
  const base = {
    agent: request.agent,
    organizationId: request.organizationId,
    engagementId: request.engagementId,
    model: modelId,
    promptVersion: request.promptVersion,
  };

  if (!hasModelKey(modelId)) {
    const gwErr = new GatewayError(
      'model_key_missing',
      503,
      `No model key configured (${PROVIDER_KEYS[providerOf(modelId)]})`,
    );
    // An `error` caller turns this into a 503 and nothing ran, so there is nothing to
    // record. A `fallback` caller still produces a result, and that result needs its run.
    if (failureStatus === 'fallback') {
      const run = await safeRecord({ ...base, status: 'fallback', errorCode: gwErr.code, durationMs: 0 });
      gwErr.runId = run.recorded ? run.runId : null;
    }
    log('error', 'model_call', {
      ...logBase(base, modelId),
      status: failureStatus,
      code: gwErr.code,
      durationMs: 0,
      runId: gwErr.runId,
    });
    throw gwErr;
  }

  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputTokens = request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  let retried = false;
  const { model, providerOptions } = resolveModel(modelId);

  const attempt = () =>
    generateText({
      model,
      output: Output.object({ schema: request.schema }),
      system: request.system,
      prompt: request.prompt,
      maxOutputTokens,
      providerOptions,
      // Retries are the gateway's decision, not the SDK's: its default (2, on any
      // retryable error) would retry 5xx and timeouts too and spend the time budget.
      maxRetries: 0,
      abortSignal: controller.signal,
    });

  try {
    let result: Awaited<ReturnType<typeof attempt>>;
    try {
      result = await attempt();
    } catch (err) {
      if (!isRateLimited(err)) throw err;
      retried = true;
      await sleep(RATE_LIMIT_BACKOFF_MS, controller.signal);
      result = await attempt();
    }

    if (result.finishReason === 'length' || result.finishReason === 'content-filter') {
      // Refusal and truncation are hard failures (model-gateway.md): never return a
      // partial object even if it happened to validate.
      throw new GatewayError(
        result.finishReason === 'length' ? 'model_parse_error' : 'model_call_failed',
        502,
        `Model stopped early: ${result.finishReason}`,
      );
    }

    const object = result.output as T;
    const usage = toUsage(result.usage);
    // Measured before the recorder write, so it is the model's latency, not Supabase's.
    const durationMs = Date.now() - start;
    const run = await safeRecord({
      ...base,
      status: 'success',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      hitlTier: request.recordTier?.(object),
      durationMs,
      costCents: costCents(modelId, usage),
    });

    const runId = run.recorded ? run.runId : null;
    log('info', 'model_call', {
      ...logBase(base, modelId),
      status: 'success',
      durationMs,
      retried,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      runId,
    });
    return { object, runId, model: modelId, usage, retried };
  } catch (err) {
    const gwErr = classifyModelError(err, controller.signal.aborted);
    const usage = usageFromError(err);
    const durationMs = Date.now() - start;
    const run = await safeRecord({
      ...base,
      status: failureStatus,
      errorCode: gwErr.code,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      durationMs,
      costCents: costCents(modelId, usage),
    });

    gwErr.runId = run.recorded ? run.runId : null;
    // Never the error object: an APICallError carries the full request, prompt included.
    log(FAILURE_LEVEL[gwErr.code], 'model_call', {
      ...logBase(base, modelId),
      status: failureStatus,
      code: gwErr.code,
      providerStatus: providerStatusCode(err),
      durationMs,
      retried,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      runId: gwErr.runId,
      errorName: errorName(gwErr.cause ?? err),
      detail: gwErr.code === 'model_call_failed' || gwErr.code === 'model_unavailable' ? gwErr.message : undefined,
    });
    throw gwErr;
  } finally {
    clearTimeout(deadline);
  }
}
