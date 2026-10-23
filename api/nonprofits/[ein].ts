import { z } from 'zod';
import {
  CACHE_HIT,
  CACHE_MISS,
  PROPUBLICA_BASE,
  fetchUpstream,
  invalid,
  json,
  toDetail,
  upstreamOrganization,
} from '../_propublica';
import { authenticate } from '../_auth';
import { handler } from '../_request';

export const maxDuration = 10;

/** Dashes allowed (`13-1624100`), stripped before the check. */
const einSchema = z
  .string()
  .transform((s) => s.replace(/-/g, ''))
  .pipe(z.string().regex(/^\d{9}$/));

/**
 * GET /api/nonprofits/:ein — one organization from ProPublica, with its newest filing.
 * Not an agent path: no model, no `agent_runs`, no fallback heuristic.
 *
 * An organization with no extracted filings is a 200 (`latestFiling: null`), not a 404:
 * ProPublica still returns its IRS master-file record. 404 means the EIN is unknown.
 */
export const GET = handler('nonprofit-detail', async (request: Request) => {
  const auth = await authenticate(request);
  if (!auth.ok) return auth.response;

  // Vercel routes `[ein]` by filesystem; the segment is read from the path. Query
  // parameters are refused so the URL is the whole cache key.
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].length > 0) return invalid();
  const segment = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? '');
  const ein = einSchema.safeParse(segment.replace(/\.json$/, ''));
  if (!ein.success) return invalid();

  const upstream = await fetchUpstream(
    `${PROPUBLICA_BASE}/organizations/${ein.data}.json`,
    upstreamOrganization,
  );
  if (upstream.kind === 'error') return upstream.response;
  if (upstream.kind === 'not_found') return json({ error: 'not_found' }, 404, CACHE_MISS);
  return json({ result: toDetail(upstream.data) }, 200, CACHE_HIT);
});
