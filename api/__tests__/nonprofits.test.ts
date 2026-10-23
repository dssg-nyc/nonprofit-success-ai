import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Supabase auth and global fetch (ProPublica) are the only seams replaced. Upstream
// bodies are trimmed copies of live responses (fixtures/, captured 2026-10-08).

const db = vi.hoisted(() => ({
  user: { data: { user: { id: 'user-1' } }, error: null } as {
    data: { user: { id: string } } | null;
    error: { status?: number } | null;
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: async () => db.user } }),
}));

const { GET: search } = await import('../nonprofits/search');
const { GET: detail } = await import('../nonprofits/[ein]');
const { nonprofitDetailResponseSchema, nonprofitSearchResponseSchema } = await import(
  '../../src/schemas'
);
const { addLogSink } = await import('../../src/observability/log');
import type { LogLine } from '../../src/observability/log';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJl';
const BASE = 'https://projects.propublica.org/nonprofits/api/v2';

const request = (path: string, token: string | null = TOKEN) =>
  new Request(`http://localhost${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
const getSearch = (query: string, token?: string | null) =>
  search(request(`/api/nonprofits/search${query}`, token));
const getDetail = (ein: string, token?: string | null) =>
  detail(request(`/api/nonprofits/${ein}`, token));

let fetchFn: ReturnType<typeof vi.fn>;
let lines: LogLine[];
let removeSink: () => void;

const stubFetch = (impl: (url: string, init: RequestInit) => Promise<Response>) => {
  fetchFn = vi.fn(impl);
  vi.stubGlobal('fetch', fetchFn);
};
const respondWith = (body: unknown, status = 200) =>
  stubFetch(async () => Response.json(body, { status }));
const upstreamUrl = () => new URL((fetchFn.mock.calls[0] as [string])[0]);

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('LOG_LEVEL', 'silent');
  db.user = { data: { user: { id: 'user-1' } }, error: null };
  lines = [];
  removeSink = addLogSink((line) => lines.push(line));
  stubFetch(async () => Response.json({}));
});

afterEach(() => {
  removeSink();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /api/nonprofits/search', () => {
  it('401 without a bearer token, before any upstream call', async () => {
    const res = await getSearch('?q=harlem', null);
    expect(res.status).toBe(401);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('400 for no criterion, a malformed value, an unknown or repeated key', async () => {
    for (const query of [
      '',
      '?page=2',
      '?q=',
      '?q=%20%20',
      `?q=${'a'.repeat(101)}`,
      '?q=food&state=NYC',
      '?ntee=0',
      '?ntee=11',
      '?cCode=1',
      '?cCode=29',
      '?q=food&page=-1',
      '?q=food&page=100',
      '?q=food&page=1.5',
      '?q=food&page=two',
      '?q=food&ein=131624100',
      '?q=food&q=drink',
    ]) {
      const res = await getSearch(query);
      expect(res.status, query).toBe(400);
      expect(await res.json(), query).toEqual({ error: 'invalid_input' });
      expect(res.headers.get('Cache-Control'), query).toBe('no-store');
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('maps a live search response; sends q, state[id], page, User-Agent and a timeout', async () => {
    respondWith(fixture('search-harlem-ny'));
    const res = await getSearch('?q=harlem&state=ny');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
    expect(res.headers.get('x-request-id')).toBeTruthy();
    const body = nonprofitSearchResponseSchema.parse(await res.json());
    expect(body).toMatchObject({ total: 289, page: 0, numPages: 12 });
    expect(body.results).toEqual([
      {
        ein: '133294041',
        strein: '13-3294041',
        name: 'Harlem Tabernacle',
        city: 'Harlem',
        state: 'NY',
        nteeCode: null,
        subsectionCode: 3,
        source: 'propublica',
      },
      expect.objectContaining({ ein: '920434461', nteeCode: 'A25', subsectionCode: 3 }),
    ]);

    const url = upstreamUrl();
    expect(url.origin + url.pathname).toBe(`${BASE}/search.json`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'harlem', 'state[id]': 'NY', page: '0' });
    const init = fetchFn.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get('User-Agent')).toBe('nonprofit-success-ai');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('forwards the NTEE, subsection and page filters, with no q', async () => {
    respondWith(fixture('search-harlem-ny'));
    const res = await getSearch('?state=zz&ntee=2&cCode=92&page=3');
    expect(res.status).toBe(200);
    expect((await res.json()).page).toBe(3);
    expect(Object.fromEntries(upstreamUrl().searchParams)).toEqual({
      'state[id]': 'ZZ',
      'ntee[id]': '2',
      'c_code[id]': '92',
      page: '3',
    });
  });

  it('pads an EIN whose leading zeros ProPublica stripped', async () => {
    respondWith({
      total_results: 1,
      num_pages: 1,
      organizations: [{ ein: 53630355, name: 'X', city: null, state: null, subseccd: null }],
    });
    const body = nonprofitSearchResponseSchema.parse(await (await getSearch('?q=x')).json());
    expect(body.results[0]).toMatchObject({
      ein: '053630355',
      strein: '05-3630355',
      city: '',
      state: '',
      subsectionCode: null,
    });
  });

  it("ProPublica's 404 for no hits is an empty 200, cached briefly", async () => {
    respondWith(fixture('search-empty'), 404);
    const res = await getSearch('?q=zzzxqqnotreal&page=2');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=300');
    expect(await res.json()).toEqual({ results: [], total: 0, page: 2, numPages: 0 });
  });
});

describe('GET /api/nonprofits/:ein', () => {
  it('401 without a bearer token, before any upstream call', async () => {
    const res = await getDetail('131624100', null);
    expect(res.status).toBe(401);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('400 for a malformed EIN or any query parameter', async () => {
    for (const ein of ['12345', 'abcdefghi', '1234567890', '13-16241', '131624100?x=1']) {
      const res = await getDetail(ein);
      expect(res.status, ein).toBe(400);
      expect(await res.json(), ein).toEqual({ error: 'invalid_input' });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('maps a live record with filings: newest of each kind, subsection_code, IRS amounts', async () => {
    respondWith(fixture('org-moma'));
    const res = await getDetail('13-1624100');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
    const { result } = nonprofitDetailResponseSchema.parse(await res.json());
    expect(result).toEqual({
      ein: '131624100',
      strein: '13-1624100',
      name: 'Museum Of Modern Art',
      city: 'New York',
      state: 'NY',
      nteeCode: 'A510',
      // The organization endpoint says `subsection_code`, not search's `subseccd`.
      subsectionCode: 3,
      source: 'propublica',
      irs: { revenueAmount: 362023464, assetAmount: 2670935041, taxPeriod: '2025-06-01' },
      latestFiling: {
        taxYear: 2023,
        formType: '990',
        totalRevenue: 236680721,
        totalExpenses: 280669509,
        totalAssets: 2490307043,
        totalLiabilities: 376132235,
        pdfUrl: null,
      },
      latestPdfFiling: {
        taxYear: 2024,
        formType: '990',
        pdfUrl: expect.stringContaining('131624100_202406_990'),
      },
      filingCount: { withData: 2, pdfOnly: 1 },
    });
    expect(upstreamUrl().toString()).toBe(`${BASE}/organizations/131624100.json`);
  });

  it('a known EIN with no filings is a 200 with null filings (#14 example 932161095)', async () => {
    respondWith(fixture('org-no-filings'));
    const res = await getDetail('932161095');
    expect(res.status).toBe(200);
    const { result } = nonprofitDetailResponseSchema.parse(await res.json());
    expect(result).toMatchObject({
      name: 'Harlem Literacy Project',
      subsectionCode: 3,
      irs: { revenueAmount: 0, assetAmount: 0, taxPeriod: '2024-12-01' },
      latestFiling: null,
      latestPdfFiling: null,
      filingCount: { withData: 0, pdfOnly: 0 },
    });
  });

  it('sorts filings newest first and maps form types, unknown codes to null', async () => {
    respondWith({
      organization: { ein: 1, name: 'PF' },
      filings_with_data: [
        { tax_prd_yr: 2019, formtype: 0 },
        { tax_prd_yr: 2021, formtype: 2, totrevenue: 9 },
        { tax_prd_yr: 2020, formtype: 1 },
      ],
      filings_without_data: [{ tax_prd_yr: 2022, formtype: 7 }],
    });
    const { result } = nonprofitDetailResponseSchema.parse(await (await getDetail('000000001')).json());
    expect(result.latestFiling).toMatchObject({ taxYear: 2021, formType: '990PF', totalRevenue: 9, totalAssets: null });
    expect(result.latestPdfFiling).toEqual({ taxYear: 2022, formType: null, pdfUrl: null });
    expect(result).toMatchObject({ nteeCode: null, subsectionCode: null, irs: { revenueAmount: null } });
  });

  it('an unknown EIN is 404 not_found, cached briefly', async () => {
    respondWith(fixture('org-unknown'), 404);
    const res = await getDetail('000000001');
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=300');
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});

describe('upstream failures (both routes)', () => {
  const both = () => [getSearch('?q=food'), getDetail('131624100')];

  it('upstream 500 and 429 are 502 upstream_unavailable, never cached', async () => {
    for (const status of [500, 429]) {
      stubFetch(async () => new Response('{}', { status }));
      for (const res of await Promise.all(both())) {
        expect(res.status).toBe(502);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        expect(await res.json()).toEqual({ error: 'upstream_unavailable' });
      }
    }
  });

  it('a timeout or network failure is 502 upstream_unavailable', async () => {
    stubFetch(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    for (const res of await Promise.all(both())) {
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'upstream_unavailable' });
    }
    expect(lines.map((l) => l.code)).toEqual(['upstream_unreachable', 'upstream_unreachable']);
  });

  it('shape drift (renamed field, non-JSON) is 502 upstream_shape, logged as an outage', async () => {
    respondWith({ total: 1, orgs: [] });
    const drifted = await getSearch('?q=food');
    expect(drifted.status).toBe(502);
    expect(await drifted.json()).toEqual({ error: 'upstream_shape' });

    stubFetch(async () => new Response('<html>', { status: 200 }));
    const html = await getDetail('131624100');
    expect(html.status).toBe(502);
    expect(await html.json()).toEqual({ error: 'upstream_shape' });

    expect(lines).toEqual([
      expect.objectContaining({ event: 'route_failure', route: 'nonprofits-search', step: 'upstream', code: 'upstream_shape', providerStatus: 200 }),
      expect.objectContaining({ event: 'route_failure', route: 'nonprofit-detail', step: 'upstream', code: 'upstream_shape', providerStatus: 200 }),
    ]);
  });

  it('never logs the search text', async () => {
    stubFetch(async () => new Response('{}', { status: 503 }));
    await getSearch(`?q=${encodeURIComponent('Secret Org Name')}`);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ route: 'nonprofits-search', providerStatus: 503, code: 'upstream_503' });
    expect(JSON.stringify(lines).toLowerCase()).not.toContain('secret');
  });
});
