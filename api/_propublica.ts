import { z } from 'zod';
import { log } from '../src/observability/log.js';
import type { NonprofitDetail, NonprofitSummary } from '../src/types/index.js';

/**
 * ProPublica Nonprofit Explorer v2 — the shared upstream of `nonprofits/search` and
 * `nonprofits/[ein]`. Keyless, GET only. The browser never calls it; these routes are
 * the one origin, so caching, a key or a provider swap changes here and nowhere else.
 *
 * Shapes below were checked against the live API on 2026-10-08 (fixtures in
 * `__tests__/fixtures/`). They are lenient: only mapped fields are named, everything
 * else passes through, and a renamed field fails the parse and becomes a 502.
 */

export const PROPUBLICA_BASE = 'https://projects.propublica.org/nonprofits/api/v2';
const TIMEOUT_MS = 5_000;
const USER_AGENT = 'nonprofit-success-ai';

/**
 * Cache policy. `private`: these routes require a bearer token, and a shared (CDN)
 * cache would serve an authenticated response to callers with no token. The data is
 * public and changes monthly at most, so the browser keeps a hit for an hour.
 */
export const CACHE_HIT = 'private, max-age=3600';
/** A miss may be a typo the user is about to correct; keep it briefly. */
export const CACHE_MISS = 'private, max-age=300';
export const NO_STORE = 'no-store';

export const json = (body: unknown, status: number, cacheControl: string) =>
  Response.json(body, { status, headers: { 'Cache-Control': cacheControl } });

export const invalid = () => json({ error: 'invalid_input' }, 400, NO_STORE);
const unavailable = () => json({ error: 'upstream_unavailable' }, 502, NO_STORE);

// ---- upstream shapes -------------------------------------------------------

const ein = z.union([z.number(), z.string()]);

/** A search hit. Search uses `subseccd`; the organization endpoint does not. */
export const upstreamSearch = z
  .object({
    total_results: z.number(),
    num_pages: z.number(),
    organizations: z.array(
      z
        .object({
          ein,
          name: z.string(),
          city: z.string().nullish(),
          state: z.string().nullish(),
          ntee_code: z.string().nullish(),
          subseccd: z.number().nullish(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const upstreamFiling = z
  .object({
    tax_prd_yr: z.number(),
    formtype: z.number().nullish(),
    pdf_url: z.string().nullish(),
    totrevenue: z.number().nullish(),
    totfuncexpns: z.number().nullish(),
    totassetsend: z.number().nullish(),
    totliabend: z.number().nullish(),
  })
  .passthrough();

const upstreamPdfFiling = z
  .object({
    tax_prd_yr: z.number(),
    formtype: z.number().nullish(),
    pdf_url: z.string().nullish(),
  })
  .passthrough();

/** One organization. Uses `subsection_code`, and carries the IRS master-file amounts. */
export const upstreamOrganization = z
  .object({
    organization: z
      .object({
        ein,
        name: z.string(),
        city: z.string().nullish(),
        state: z.string().nullish(),
        ntee_code: z.string().nullish(),
        subsection_code: z.number().nullish(),
        revenue_amount: z.number().nullish(),
        asset_amount: z.number().nullish(),
        tax_period: z.string().nullish(),
      })
      .passthrough(),
    filings_with_data: z.array(upstreamFiling).optional(),
    filings_without_data: z.array(upstreamPdfFiling).optional(),
  })
  .passthrough();

// ---- mapping ---------------------------------------------------------------

const FORM_TYPES = ['990', '990EZ', '990PF'] as const;
const formType = (code: number | null | undefined) =>
  code !== null && code !== undefined ? (FORM_TYPES[code] ?? null) : null;

/** ProPublica returns EINs as integers, leading zeros stripped. */
const einOf = (raw: number | string) => String(raw).replace(/\D/g, '').padStart(9, '0');

type SearchHit = z.infer<typeof upstreamSearch>['organizations'][number];
type Organization = z.infer<typeof upstreamOrganization>;

function base(raw: number | string, name: string, city?: string | null, state?: string | null) {
  const id = einOf(raw);
  return {
    ein: id,
    strein: `${id.slice(0, 2)}-${id.slice(2)}`,
    name,
    city: city ?? '',
    state: state ?? '',
  };
}

export function toSummary(hit: SearchHit): NonprofitSummary {
  return {
    ...base(hit.ein, hit.name, hit.city, hit.state),
    nteeCode: hit.ntee_code ?? null,
    subsectionCode: hit.subseccd ?? null,
    source: 'propublica',
  };
}

const newestFirst = <T extends { tax_prd_yr: number }>(rows: T[] | undefined): T[] =>
  [...(rows ?? [])].sort((a, b) => b.tax_prd_yr - a.tax_prd_yr);

export function toDetail(body: Organization): NonprofitDetail {
  const org = body.organization;
  const filing = newestFirst(body.filings_with_data)[0];
  const pdf = newestFirst(body.filings_without_data)[0];
  return {
    ...base(org.ein, org.name, org.city, org.state),
    nteeCode: org.ntee_code ?? null,
    subsectionCode: org.subsection_code ?? null,
    source: 'propublica',
    irs: {
      revenueAmount: org.revenue_amount ?? null,
      assetAmount: org.asset_amount ?? null,
      taxPeriod: org.tax_period ?? null,
    },
    latestFiling: filing
      ? {
          taxYear: filing.tax_prd_yr,
          formType: formType(filing.formtype),
          totalRevenue: filing.totrevenue ?? null,
          totalExpenses: filing.totfuncexpns ?? null,
          totalAssets: filing.totassetsend ?? null,
          totalLiabilities: filing.totliabend ?? null,
          pdfUrl: filing.pdf_url ?? null,
        }
      : null,
    latestPdfFiling: pdf
      ? { taxYear: pdf.tax_prd_yr, formType: formType(pdf.formtype), pdfUrl: pdf.pdf_url ?? null }
      : null,
    filingCount: {
      withData: body.filings_with_data?.length ?? 0,
      pdfOnly: body.filings_without_data?.length ?? 0,
    },
  };
}

// ---- transport -------------------------------------------------------------

/**
 * GET `url` and parse it with `schema`. `not_found` is ProPublica's 404, which it sends
 * for an unknown EIN and for a search with no hits; each route decides what it means.
 * Every other failure is already a 502 `Response`, logged with only step, code, status
 * and duration — never the URL, which carries the search text.
 */
export async function fetchUpstream<T>(
  url: string,
  schema: z.ZodType<T>,
): Promise<{ kind: 'ok'; data: T } | { kind: 'not_found' } | { kind: 'error'; response: Response }> {
  const started = Date.now();
  const fail = (code: string, status: number | undefined, response: Response) => {
    log('error', 'route_failure', {
      step: 'upstream',
      code,
      providerStatus: status,
      durationMs: Date.now() - started,
    });
    return { kind: 'error' as const, response };
  };

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return fail('upstream_unreachable', undefined, unavailable());
  }
  if (res.status === 404) return { kind: 'not_found' };
  if (!res.ok) return fail(`upstream_${res.status}`, res.status, unavailable());

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // Shape drift is an outage from the caller's side, so it is logged like one.
    return fail('upstream_shape', res.status, json({ error: 'upstream_shape' }, 502, NO_STORE));
  }
  return { kind: 'ok', data: parsed.data };
}
