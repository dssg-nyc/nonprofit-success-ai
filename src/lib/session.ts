/**
 * The access token a `/api` call sends as its bearer. Shared layer: no React, no agent
 * code — it only knows how to turn a Supabase Auth client into a token or `null`.
 *
 * `anonymous: true` is for the public Scout intake form: the visitor has no account, but
 * `/api/route-intake` still requires a session Supabase Auth issued (and rate-limited per
 * IP, `config.toml` `auth.rate_limit.anonymous_users`). An anonymous user has no
 * `public.users` profile (0001_core), so RLS grants it only what `anon` had, and
 * `toAppUser` in `lib/supabase.ts` treats the session as signed out. Any failure returns
 * `null`: the caller then rejects the API call and the agent's deterministic fallback runs.
 */

export interface SessionAuth {
  getSession(): Promise<{ data: { session: { access_token: string } | null } }>;
  signInAnonymously(): Promise<{
    data: { session: { access_token: string } | null };
    error: { message: string } | null;
  }>;
}

export async function accessToken(
  auth: SessionAuth,
  options: { anonymous?: boolean } = {},
): Promise<string | null> {
  try {
    const existing = (await auth.getSession()).data.session?.access_token;
    if (existing) return existing;
    if (!options.anonymous) return null;

    const { data, error } = await auth.signInAnonymously();
    if (error) {
      // Typically anonymous sign-ins disabled on the project, or the per-IP limit hit.
      console.error('session: anonymous sign-in failed', error.message);
      return null;
    }
    return data.session?.access_token ?? null;
  } catch (err) {
    console.error('session: could not obtain a token', err instanceof Error ? err.name : 'unknown');
    return null;
  }
}
