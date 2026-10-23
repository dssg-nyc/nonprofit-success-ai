import { supabasePublicConfig } from './_env.js';
import { handler } from './_request.js';

/**
 * Liveness plus the dependency every other route needs: a reachable Supabase Auth.
 * `ok` is the function running; `supabase` is a real probe of the Auth health endpoint
 * (`auth/v1/health`, anon key, 3s cap), so an uptime check on this route notices an
 * Auth outage before a visitor's intake 503s on it. No token is needed, and no database
 * row is read.
 *
 * The body says nothing about the model key: the route is unauthenticated, and whether
 * a deployment can call a model is not a fact to hand to anyone who asks. Routes log it.
 */

const PROBE_TIMEOUT_MS = 3_000;

type Probe = 'ok' | 'unreachable' | 'unconfigured';

async function probeSupabase(): Promise<Probe> {
  const config = supabasePublicConfig();
  if (!config) return 'unconfigured';
  try {
    const res = await fetch(`${config.url.replace(/\/$/, '')}/auth/v1/health`, {
      headers: { apikey: config.anonKey },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return res.ok ? 'ok' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

export const GET = handler('health', async () => {
  const supabase = await probeSupabase();
  return Response.json(
    { ok: true, supabase },
    // A monitor keys on status, not body: degraded dependencies are a 503 it will page on.
    { status: supabase === 'ok' ? 200 : 503 },
  );
});
