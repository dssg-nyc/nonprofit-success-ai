import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/database.types';
import { errorName, log } from '../src/observability/log';
import { supabasePublicConfig } from './_env';

/**
 * Caller authentication for handlers that write on a user's behalf.
 *
 * The client returned here is USER-SCOPED: the anon key plus the caller's own access
 * token as its `Authorization` header, so every query and RPC runs as `authenticated`
 * with `auth.uid()` = the caller. RLS, the author triggers and `is_admin()` inside
 * SECURITY DEFINER functions all see the real actor. A handler never escalates to the
 * service role to write domain rows — that key exists only in the recorder.
 *
 * The token is verified by Supabase Auth (`auth.getUser(token)`), not decoded locally:
 * a decode-only check would accept a signed-out (revoked) session until it expired, and
 * would put the JWT secret in this function's env. PostgREST verifies it again on every
 * query, so a forged token fails twice.
 */

export type UserClient = SupabaseClient<Database>;

export type AuthResult =
  | { ok: true; userId: string; client: UserClient }
  | { ok: false; response: Response };

/** A JWT is three base64url segments. Anything else is not worth a round trip. */
const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
/** Supabase access tokens are ~1KB; the cap stops a header from being a payload. */
const MAX_TOKEN_LENGTH = 8_192;

const unauthorized = () =>
  Response.json(
    { error: 'unauthorized' },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
  );

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header || header.length > MAX_TOKEN_LENGTH + 7) return null;
  return BEARER.exec(header.trim())?.[1] ?? null;
}

export async function authenticate(request: Request): Promise<AuthResult> {
  const token = bearerToken(request);
  if (!token) return { ok: false, response: unauthorized() };

  const config = supabasePublicConfig();
  if (!config) {
    log('error', 'route_failure', { step: 'auth', code: 'auth_not_configured' });
    return {
      ok: false,
      response: Response.json({ error: 'auth_not_configured' }, { status: 503 }),
    };
  }

  const client = createClient<Database>(config.url, config.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    // Server-side and per-request: no session to persist, refresh or read from a URL.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  try {
    const { data, error } = await client.auth.getUser(token);
    if (data?.user?.id && !error) {
      return { ok: true, userId: data.user.id, client };
    }
    // A 5xx (or no status / 0: the request never completed) is Auth being down, not the
    // caller being wrong — say so, rather than signing a valid user out.
    const status = (error as { status?: number } | null)?.status;
    if (error && (!status || status >= 500)) {
      log('error', 'route_failure', { step: 'auth', code: 'auth_verification_unavailable', providerStatus: status });
      return {
        ok: false,
        response: Response.json({ error: 'auth_unavailable' }, { status: 503 }),
      };
    }
    return { ok: false, response: unauthorized() };
  } catch (err) {
    log('error', 'route_failure', { step: 'auth', code: 'auth_verification_threw', errorName: errorName(err) });
    return {
      ok: false,
      response: Response.json({ error: 'auth_unavailable' }, { status: 503 }),
    };
  }
}
