import { errorName, log } from '../src/observability/log.js';
import type { UserClient } from './_auth.js';

/**
 * The per-user model-call budget (0007 `check_model_budget`): one row per caller per
 * clock hour, incremented before every gateway call a handler makes on the caller's
 * behalf. Supabase Auth bounds how many sessions an IP can open; this bounds how many
 * paid calls one session can make, so a looped intake form or draft button cannot run
 * up the model bill.
 *
 * The limit is a deployment setting (`MODEL_CALLS_PER_HOUR`, default 20), passed to the
 * function so the policy lives in one place. A client calling the RPC directly can only
 * spend its own budget faster.
 *
 * Three outcomes. 53400 is the limit: the caller gets 429 with `Retry-After` (or, on the
 * public intake, the deterministic fallback). 42501 is a caller the database cannot
 * identify — the token verified but `auth.uid()` is null — which is an auth failure, not
 * a budget one, so it is 401 like `_auth.ts` would give. Everything else fails open: a
 * database that cannot count calls is logged (`step: budget`) and the request continues,
 * because the same outage breaks the write at the end of the route anyway and a budget
 * must never be the reason an otherwise healthy request is refused. The log level says
 * which kind of "else" it was: 42883 (function missing — 0007 not applied) is an `error`
 * on every call, since that deployment has no budget at all; a transient failure is a
 * `warn`.
 */

const DEFAULT_LIMIT = 20;

export function modelCallsPerHour(): number {
  const raw = Number(process.env.MODEL_CALLS_PER_HOUR);
  return Number.isInteger(raw) && raw >= 1 && raw <= 1000 ? raw : DEFAULT_LIMIT;
}

export type BudgetResult =
  | { ok: true; remaining: number | null }
  /** `status` lets a route treat the limit (429) and an unidentified caller (401) apart. */
  | { ok: false; status: 401 | 429; response: Response };

/** The function does not exist (0007 not applied) or is not callable: a deployment fault. */
const MISCONFIGURED = new Set(['42883', '42P01']);

export async function checkModelBudget(client: UserClient): Promise<BudgetResult> {
  try {
    const { data, error } = await client.rpc('check_model_budget', { p_limit: modelCallsPerHour() });
    if (!error) return { ok: true, remaining: typeof data === 'number' ? data : null };
    if (error.code === '53400') {
      const secondsLeft = 3600 - (Math.floor(Date.now() / 1000) % 3600);
      return {
        ok: false,
        status: 429,
        response: Response.json(
          { error: 'model_budget_exceeded' },
          { status: 429, headers: { 'Retry-After': String(secondsLeft) } },
        ),
      };
    }
    if (error.code === '42501') {
      log('warn', 'route_failure', { step: 'budget', code: '42501' });
      return {
        ok: false,
        status: 401,
        response: Response.json(
          { error: 'unauthorized' },
          { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
        ),
      };
    }
    const code = error.code ?? 'rpc_failed';
    log(MISCONFIGURED.has(code) ? 'error' : 'warn', 'route_failure', {
      step: 'budget',
      code,
      ...(MISCONFIGURED.has(code) ? { detail: 'check_model_budget missing: migration 0007 not applied' } : {}),
    });
    return { ok: true, remaining: null };
  } catch (err) {
    log('error', 'route_failure', { step: 'budget', code: 'budget_threw', errorName: errorName(err) });
    return { ok: true, remaining: null };
  }
}
