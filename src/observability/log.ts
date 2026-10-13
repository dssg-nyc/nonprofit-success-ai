import { AsyncLocalStorage } from 'node:async_hooks';

import type { AgentName, ModelProvider } from '../model/types';

/**
 * Structured server logs: one JSON object per line, so Vercel's log search can filter
 * on `event`, `code` or `agent` instead of grepping prose.
 *
 * **The field set is closed.** `LogFields` lists every field a line can carry, and
 * every one is an id, a code, a number or a model name — there is no `error`, `cause`,
 * `payload` or free-form object. That is the leak guard: a provider error carries the
 * whole request (`APICallError.requestBodyValues`, i.e. the prompt with the intake
 * text), and passing it to `console.error` printed whatever Node's inspect depth
 * happened to reach. Here nothing can reach a log line that was not named below.
 *
 * `detail` is the one string that comes from outside: a provider's error message,
 * capped at DETAIL_MAX. Provider messages describe the request's structure ("Invalid
 * JSON payload", "schema not supported"), not its content; the cap bounds the damage if
 * one ever quotes it. Never put a prompt, intake field, model output or Supabase row in it.
 *
 * Level: `LOG_LEVEL` (`info` default, `warn`, `error`, `silent`). It gates the console
 * only: a sink added with `addLogSink()` receives every line, so an eval run can capture
 * all `model_call` latencies while keeping the terminal quiet.
 */

export type LogLevel = 'info' | 'warn' | 'error';

/** What happened. One name per kind of line, so a filter on `event` is exact. */
export type LogEvent =
  /** One per gateway call, success or failure: latency, tokens, outcome. */
  | 'model_call'
  /** The recorder has no service-role config — logged once per process, not per call. */
  | 'recorder_unconfigured'
  | 'recorder_client_failed'
  | 'recorder_write_failed'
  /** An `engagement_id` / `organization_id` the database refused; the run was written without it. */
  | 'recorder_unlinked'
  /** An `/api` handler step that failed outside the gateway (lookup, RPC, auth). */
  | 'route_failure';

export interface LogFields {
  /**
   * The request this line belongs to: Vercel's `x-vercel-id` when present, else a
   * UUID minted by `api/_request.ts`. Set once per request via `withRequestContext()`
   * and stamped on every line logged inside it, so one failed call can be followed
   * from the auth step to the recorder write without a shared field in each call site.
   */
  requestId?: string;
  agent?: AgentName;
  /** The `/api` route, e.g. `architect-plan`. */
  route?: string;
  /** Which step of a route failed, e.g. `intake_lookup`. snake_case, not prose. */
  step?: string;
  model?: string;
  provider?: ModelProvider;
  promptVersion?: string;
  status?: 'success' | 'fallback' | 'error';
  /** A machine code: a GatewayErrorCode, a Postgres/PostgREST code, an HTTP status name. */
  code?: string;
  /** The provider's HTTP status, when the failure came from the provider. */
  providerStatus?: number;
  durationMs?: number;
  retried?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  runId?: string | null;
  engagementId?: string;
  organizationId?: string;
  /** A `scout_intakes.id` — an id, never intake content. */
  intakeId?: string;
  /** The thrown value's class name (`APICallError`, `TypeError`), never the value. */
  errorName?: string;
  /** A short provider/library error message — see the module comment. */
  detail?: string;
}

const DETAIL_MAX = 200;
const RANK: Record<LogLevel | 'silent', number> = { info: 0, warn: 1, error: 2, silent: 3 };

function threshold(): number {
  const value = process.env.LOG_LEVEL as keyof typeof RANK | undefined;
  return value && value in RANK ? RANK[value] : RANK.info;
}

/** A built log line: `ts`, `level`, `event`, then the defined `LogFields`. */
export type LogLine = { ts: string; level: LogLevel; event: LogEvent } & LogFields;

const sinks = new Set<(line: LogLine) => void>();

/** Per-request fields every line inside the request carries. Only ids live here. */
interface RequestContext {
  requestId: string;
  route?: string;
}

const requestContext = new AsyncLocalStorage<RequestContext>();

/**
 * Run `fn` with `context` stamped onto every log line it (or anything it awaits)
 * produces. Vercel runs one request per invocation, but AsyncLocalStorage keeps the
 * stamp correct in the dev server and in tests, where requests overlap in one process.
 */
export function withRequestContext<T>(context: RequestContext, fn: () => T): T {
  return requestContext.run(context, fn);
}

/** The current request's id, for echoing back to the caller; undefined outside a request. */
export function currentRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

/**
 * Also deliver every line to `sink` (the eval harness writes them to `calls.jsonl`).
 * A sink sees exactly what the console would — the same closed field set — so it cannot
 * widen what a log line may carry. Returns a function that removes the sink.
 */
export function addLogSink(sink: (line: LogLine) => void): () => void {
  sinks.add(sink);
  return () => sinks.delete(sink);
}

export function log(level: LogLevel, event: LogEvent, fields: LogFields = {}): void {
  const defined = Object.entries(fields).filter(([, value]) => value !== undefined);
  const context = requestContext.getStore();
  const line: LogLine = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(context ? { requestId: context.requestId, route: context.route } : {}),
    ...Object.fromEntries(defined),
  };
  if (line.detail) line.detail = line.detail.slice(0, DETAIL_MAX);
  for (const sink of sinks) sink(line);
  if (RANK[level] < threshold()) return;
  console[level](JSON.stringify(line));
}

/** The class name of a thrown value, for `errorName` — never its message or properties. */
export function errorName(err: unknown): string {
  if (err instanceof Error) return err.name;
  return typeof err;
}
