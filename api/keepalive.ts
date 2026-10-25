import { supabasePublicConfig } from './_env.js';
import { handler } from './_request.js';

/**
 * Keeps a free-tier Supabase project from pausing after a week without activity. Vercel
 * Cron calls it twice a week (vercel.json). Unlike `health`, which probes Auth only, this
 * reads a row through PostgREST, so the database itself does work. The read runs as the
 * anon role, so RLS returns no rows and nothing is exposed.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET` on cron calls when that env var is
 * set. Any other caller is refused, so the route cannot be used as a public trigger.
 */

const PROBE_TIMEOUT_MS = 5_000;

export const GET = handler('keepalive', async (request) => {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return Response.json({ error: 'cron_not_configured' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const config = supabasePublicConfig();
  if (!config) return Response.json({ error: 'supabase_not_configured' }, { status: 503 });

  try {
    const res = await fetch(`${config.url.replace(/\/$/, '')}/rest/v1/users?select=id&limit=1`, {
      headers: { apikey: config.anonKey, authorization: `Bearer ${config.anonKey}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return Response.json({ ok: res.ok }, { status: res.ok ? 200 : 503 });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
});
