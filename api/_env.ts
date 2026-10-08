const MODEL_KEY = 'GOOGLE_GENERATIVE_AI_API_KEY';

export function requireModelKey(): string | null {
  const value = process.env[MODEL_KEY];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function modelKeyConfigured(): boolean {
  return requireModelKey() !== null;
}

/**
 * The Supabase project URL and anon key, for building a USER-SCOPED client in
 * `_auth.ts`. Both are public identifiers (the SPA ships them as `VITE_*`), so reading
 * the `VITE_` names server-side publishes nothing new; the unprefixed names win when a
 * deployment sets them. The service-role key is deliberately not read here: it lives
 * only in `src/observability/recorder.ts`, and no handler may act with it.
 */
export function supabasePublicConfig(): { url: string; anonKey: string } | null {
  const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  return url && anonKey ? { url, anonKey } : null;
}
