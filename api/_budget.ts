import { errorName, log } from '../src/observability/log';
import type { UserClient } from './_auth';

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
 * Fails open on anything but 53400: a database that cannot count calls is logged as a
 * route failure (`step: budget`) and the request continues, because the same outage
 * breaks the write at the end of the route anyway and a budget must never be the reason
 * an otherwise healthy request is refused. A deployment that has not applied 0007 shows
 * up in the logs as code 42883 on every call, not as a silent no-op.
 */

const DEFAULT_LIMIT = 20;

export function modelCallsPerHour(): number {
  const raw = Number(process.env.MODEL_CALLS_PER_HOUR);
  return Number.isInteger(raw) && raw >= 1 && raw <= 1000 ? raw : DEFAULT_LIMIT;
}

export type BudgetResult = { ok: true; remaining: number | null } | { ok: false; response: Response };

export async function checkModelBudget(client: UserClient): Promise<BudgetResult> {
  try {
    const { data, error } = await client.rpc('check_model_budget', { p_limit: modelCallsPerHour() });
    if (!error) return { ok: true, remaining: typeof data === 'number' ? data : null };
    if (error.code === '53400') {
      const secondsLeft = 3600 - (Math.floor(Date.now() / 1000) % 3600);
      return {
        ok: false,
        response: Response.json(
          { error: 'model_budget_exceeded' },
          { status: 429, headers: { 'Retry-After': String(secondsLeft) } },
        ),
      };
    }
    log('error', 'route_failure', { step: 'budget', code: error.code ?? 'rpc_failed' });
    return { ok: true, remaining: null };
  } catch (err) {
    log('error', 'route_failure', { step: 'budget', code: 'budget_threw', errorName: errorName(err) });
    return { ok: true, remaining: null };
  }
}
