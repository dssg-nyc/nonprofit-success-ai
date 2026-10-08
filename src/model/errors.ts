import {
  APICallError,
  JSONParseError,
  LoadAPIKeyError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  RetryError,
  TypeValidationError,
} from 'ai';

export type GatewayErrorCode =
  | 'model_key_missing'
  | 'model_call_failed'
  | 'model_timeout'
  | 'model_rate_limited'
  | 'model_quota_exhausted'
  | 'model_unavailable'
  | 'model_parse_error';

export class GatewayError extends Error {
  /** The `agent_runs` row for the failed call; null when the run was not recorded. */
  runId: string | null = null;
  /** How long the provider asked the caller to wait before retrying, when it said (429 `RetryInfo`). */
  retryAfterMs?: number;

  constructor(
    public readonly code: GatewayErrorCode,
    public readonly httpStatus: number,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'GatewayError';
  }

  toResponse(): Response {
    return Response.json({ error: this.code }, { status: this.httpStatus });
  }
}

/** HTTP status of a provider error, unwrapping the SDK's RetryError if present. */
export function providerStatusCode(err: unknown): number | undefined {
  const inner = RetryError.isInstance(err) ? err.lastError : err;
  return APICallError.isInstance(inner) ? inner.statusCode : undefined;
}

interface ProviderErrorDetail {
  '@type'?: string;
  retryDelay?: string;
  violations?: Array<{ quotaId?: string }>;
}

interface ProviderErrorBody {
  /** Google: `QuotaFailure` / `RetryInfo` entries. */
  details?: ProviderErrorDetail[];
  /** OpenAI: `insufficient_quota`, `rate_limit_exceeded`, ... */
  code?: string | null;
  type?: string | null;
}

function providerApiError(err: unknown): APICallError | undefined {
  const inner = RetryError.isInstance(err) ? err.lastError : err;
  return APICallError.isInstance(inner) ? inner : undefined;
}

/** The `error` object of a provider error body, or {} when the body is absent or not JSON. */
function providerErrorBody(err: unknown): ProviderErrorBody {
  const body = providerApiError(err)?.responseBody;
  if (!body) return {};
  try {
    const parsed = JSON.parse(body) as { error?: ProviderErrorBody };
    return typeof parsed.error === 'object' && parsed.error !== null ? parsed.error : {};
  } catch {
    return {};
  }
}

function providerErrorDetails(err: unknown): ProviderErrorDetail[] {
  const details = providerErrorBody(err).details;
  return Array.isArray(details) ? details : [];
}

/** OpenAI's out-of-credits 429: the account has no quota left until billing changes. */
function isOpenAiQuotaExhausted(err: unknown): boolean {
  const body = providerErrorBody(err);
  return body.code === 'insufficient_quota' || body.type === 'insufficient_quota';
}

/**
 * A 429 retrying cannot clear within a run, so it is its own code, not a rate limit:
 * Google's `QuotaFailure` naming a per-day quota (resets midnight Pacific), or OpenAI's
 * `insufficient_quota` (out of credits). Read from the structured body, not the message.
 */
export function isQuotaExhausted(err: unknown): boolean {
  if (providerStatusCode(err) !== 429) return false;
  if (isOpenAiQuotaExhausted(err)) return true;
  return providerErrorDetails(err).some((detail) =>
    detail.violations?.some((violation) => /PerDay/i.test(violation.quotaId ?? '')),
  );
}

/**
 * How long a 429 asked the caller to wait, in milliseconds, when it said: Google's
 * `RetryInfo.retryDelay` (`"33s"`, `"1.5s"`), else the `retry-after-ms` / `retry-after`
 * (seconds) response headers OpenAI sends.
 */
export function retryAfterMs(err: unknown): number | undefined {
  for (const detail of providerErrorDetails(err)) {
    const match = /^(\d+(?:\.\d+)?)s$/.exec(detail.retryDelay ?? '');
    if (match) return Math.round(Number(match[1]) * 1000);
  }
  const headers = providerApiError(err)?.responseHeaders ?? {};
  const ms = Number(headers['retry-after-ms']);
  if (headers['retry-after-ms'] && Number.isFinite(ms) && ms >= 0) return Math.round(ms);
  const seconds = Number(headers['retry-after']);
  if (headers['retry-after'] && Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  return undefined;
}

/** A per-minute rate limit — retryable. A per-day quota is not (`isQuotaExhausted`). */
export function isRateLimited(err: unknown): boolean {
  return providerStatusCode(err) === 429 && !isQuotaExhausted(err);
}

/**
 * Classify by error type and status code, never by message text. `timedOut` is the
 * gateway's own deadline state: when its abort signal fired, the thrown error is an
 * AbortError whatever the provider would have said, so the deadline is the fact.
 */
export function classifyModelError(err: unknown, timedOut = false): GatewayError {
  if (err instanceof GatewayError) return err;
  if (timedOut) {
    return new GatewayError('model_timeout', 504, 'Model call timed out', err);
  }

  const inner = RetryError.isInstance(err) ? err.lastError : err;
  const status = providerStatusCode(inner);

  if (status === 429) {
    if (isQuotaExhausted(err)) {
      return new GatewayError(
        'model_quota_exhausted',
        429,
        isOpenAiQuotaExhausted(err)
          ? 'OpenAI quota exhausted (insufficient_quota: add credits or raise the limit)'
          : 'Daily model quota exhausted (resets at midnight Pacific)',
        err,
      );
    }
    const gwErr = new GatewayError('model_rate_limited', 429, 'Model rate limited', err);
    gwErr.retryAfterMs = retryAfterMs(err);
    return gwErr;
  }
  if (status === 503) {
    // Provider overload ("high demand"): transient, and not the caller's fault.
    const detail = inner instanceof Error && inner.message ? `: ${inner.message}` : '';
    return new GatewayError('model_unavailable', 503, `Model temporarily unavailable${detail}`, err);
  }
  if (status === 408 || status === 504) {
    return new GatewayError('model_timeout', 504, 'Model call timed out', err);
  }
  if (
    NoObjectGeneratedError.isInstance(inner) ||
    NoOutputGeneratedError.isInstance(inner) ||
    TypeValidationError.isInstance(inner) ||
    JSONParseError.isInstance(inner)
  ) {
    return new GatewayError('model_parse_error', 502, 'Model returned unparseable response', err);
  }
  if (LoadAPIKeyError.isInstance(inner)) {
    return new GatewayError('model_key_missing', 503, 'No model key configured', err);
  }

  const message = inner instanceof Error ? inner.message : String(inner);
  return new GatewayError('model_call_failed', 502, message, err);
}
