import { z } from 'zod';
import {
  CACHE_HIT,
  CACHE_MISS,
  PROPUBLICA_BASE,
  fetchUpstream,
  invalid,
  json,
  toSummary,
  upstreamSearch,
} from '../_propublica';
import { authenticate } from '../_auth';
import { handler } from '../_request';

export const maxDuration = 10;

/** ProPublica pages are 25 rows; 100 pages is deeper than any lookup UI scrolls. */
const MAX_PAGE = 99;

const intParam = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

const querySchema = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    state: z
      .string()
      .regex(/^[A-Za-z]{2}$/)
      .transform((s) => s.toUpperCase())
      .optional(),
    ntee: intParam(1, 10).optional(),
    cCode: intParam(2, 92)
      .refine((n) => n <= 28 || n === 92)
      .optional(),
    page: intParam(0, MAX_PAGE).default(0),
  })
  .strict()
  // No criterion at all would page through the whole IRS registry.
  .refine((v) => v.q || v.state || v.ntee || v.cCode);

/**
 * GET /api/nonprofits/search?q=&state=&ntee=&cCode=&page= — ProPublica search proxy.
 * Not an agent path: no model, no `agent_runs`, no fallback heuristic. `q` may be an
 * org name, so it is never logged.
 */
export const GET = handler('nonprofits-search', async (request: Request) => {
  const auth = await authenticate(request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const raw: Record<string, string> = {};
  for (const [key, value] of params) {
    // A repeated key is ambiguous, not "last one wins".
    if (key in raw) return invalid();
    raw[key] = value;
  }
  const query = querySchema.safeParse(raw);
  if (!query.success) return invalid();
  const { q, state, ntee, cCode, page } = query.data;

  const url = new URL(`${PROPUBLICA_BASE}/search.json`);
  if (q) url.searchParams.set('q', q);
  if (state) url.searchParams.set('state[id]', state);
  if (ntee) url.searchParams.set('ntee[id]', String(ntee));
  if (cCode) url.searchParams.set('c_code[id]', String(cCode));
  url.searchParams.set('page', String(page));

  const upstream = await fetchUpstream(url.toString(), upstreamSearch);
  if (upstream.kind === 'error') return upstream.response;
  // ProPublica answers a search with no hits (or a page past the end) with a 404.
  if (upstream.kind === 'not_found') {
    return json({ results: [], total: 0, page, numPages: 0 }, 200, CACHE_MISS);
  }
  const { organizations, total_results, num_pages } = upstream.data;
  return json(
    { results: organizations.map(toSummary), total: total_results, page, numPages: num_pages },
    200,
    organizations.length > 0 ? CACHE_HIT : CACHE_MISS,
  );
});
