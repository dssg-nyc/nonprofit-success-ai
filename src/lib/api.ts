import type { z } from 'zod';
import { pulseSignalSchema } from '../schemas/pulse';
import { scoutApproveResponseSchema } from '../schemas/scout';
import type { PulseSignal, ScoutApproveRequest, ScoutApproveResponse } from '../types';

/**
 * The SPA's client for `/api/*`. No React and no agent code (shared layer): the caller
 * supplies the agent's deterministic fallback, so this module never decides what a
 * fallback result is — only when one is needed.
 *
 * The contract (stack/react-vite.md "API calls from the SPA"): a non-2xx is "no result",
 * never a result. Its body is read for the error code alone, so the UI can say why it
 * fell back; nothing in it is ever treated as data.
 */

/** Why an `/api` call produced no usable result. `code` is the handler's `error` field when it sent one. */
export class ApiError extends Error {
  constructor(
    /** Handler error code (`model_timeout`, `invalid_input`, ...), or `network_error` / `invalid_response` / `http_<status>`. */
    public readonly code: string,
    /** HTTP status, or null when no response arrived. */
    public readonly status: number | null,
    /**
     * The handler's `x-request-id`, when a response arrived: the key to its log lines
     * (`api/_request.ts`). Shown to the user so a report can quote it.
     */
    public readonly requestId: string | null = null,
  ) {
    super(`api: ${code}${status !== null ? ` (${status})` : ''}`);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  /**
   * Extra request headers — e.g. `Authorization: Bearer <access token>` for a handler
   * that acts as the signed-in user. On a POST, `Content-Type` is always JSON and cannot
   * be overridden here.
   */
  headers?: Record<string, string>;
}

/**
 * POST `body` as JSON and validate the 2xx response with `schema`. Throws `ApiError` on
 * a network failure, a non-2xx, or a body that fails the schema — a 200 with the wrong
 * shape is as unusable as a 500, and must not reach the UI as a typed value.
 */
export async function postJson<T>(
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { ...options.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network_error', null);
  }
  return parseResponse(response, schema);
}

/**
 * GET `path` and validate the 2xx response with `schema`. Same error contract as
 * `postJson`: `network_error`, the handler's code on a non-2xx, `invalid_response`.
 */
export async function getJson<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method: 'GET', headers: { ...options.headers } });
  } catch {
    throw new ApiError('network_error', null);
  }
  return parseResponse(response, schema);
}

async function parseResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const requestId = response.headers.get('x-request-id');
  if (!response.ok) {
    throw new ApiError(await errorCode(response), response.status, requestId);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiError('invalid_response', response.status, requestId);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ApiError('invalid_response', response.status, requestId);
  return parsed.data;
}

/** Pulse's health signal for one engagement (`GET /api/pulse-health`, staff bearer token). */
export function fetchPulse(engagementId: string, options?: RequestOptions): Promise<PulseSignal> {
  return getJson(
    `/api/pulse-health?engagementId=${encodeURIComponent(engagementId)}`,
    pulseSignalSchema,
    options,
  );
}

/**
 * The Scout-approve command (`POST /api/scout-approve`, staff bearer token): review the
 * intake, create its business and open `initial_meeting` in one transaction. The
 * `idempotencyKey` is minted per user action, so a retry of the same click replays the
 * original result instead of refusing with `already_approved`.
 */
export function approveScoutIntake(
  body: ScoutApproveRequest,
  options?: RequestOptions,
): Promise<ScoutApproveResponse> {
  return postJson('/api/scout-approve', body, scoutApproveResponseSchema, options);
}

async function errorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body?.error === 'string' && body.error.length > 0) return body.error;
  } catch {
    // Not JSON — fall through to the status.
  }
  return `http_${response.status}`;
}

export type WithFallback<T> =
  | { data: T; source: 'api' }
  | { data: T; source: 'fallback'; error: ApiError };

/**
 * Run `primary`; on any failure, run the deterministic `fallback` instead (fallback
 * contract: the agent path always produces a result). `source` says which one did, so
 * the UI can show that a result is the heuristic's, not the model's.
 */
export async function withFallback<T>(
  primary: () => Promise<T>,
  fallback: () => T,
): Promise<WithFallback<T>> {
  try {
    return { data: await primary(), source: 'api' };
  } catch (err) {
    const error = err instanceof ApiError ? err : new ApiError('client_error', null);
    if (!(err instanceof ApiError)) console.error('api: unexpected client error', err);
    return { data: fallback(), source: 'fallback', error };
  }
}
