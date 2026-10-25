import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addLogSink } from '../../src/observability/log';
import type { LogLine } from '../../src/observability/log';
import { lookupScoutRegistry, normaliseOrgName } from '../_scoutRegistry';

// Only global fetch (ProPublica) is replaced; bodies are the trimmed live fixtures.

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

const BASE = 'https://projects.propublica.org/nonprofits/api/v2';

let fetchFn: ReturnType<typeof vi.fn>;
let lines: LogLine[];
let removeSink: () => void;

/** Route each upstream URL to a body (or a status) by its path. */
const stubFetch = (routes: Record<string, unknown | (() => Promise<Response>)>) => {
  fetchFn = vi.fn(async (url: string) => {
    const path = url.slice(BASE.length);
    for (const [prefix, body] of Object.entries(routes)) {
      if (path.startsWith(prefix)) {
        return typeof body === 'function' ? (body as () => Promise<Response>)() : Response.json(body);
      }
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchFn);
};
const urls = () => fetchFn.mock.calls.map((c) => String((c as [string])[0]));

beforeEach(() => {
  vi.stubEnv('LOG_LEVEL', 'silent');
  lines = [];
  removeSink = addLogSink((line) => lines.push(line));
  stubFetch({});
});

afterEach(() => {
  removeSink();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('normaliseOrgName', () => {
  it('drops case, punctuation and filler words', () => {
    expect(normaliseOrgName('The Museum of Modern Art, Inc.')).toBe('museum of modern art');
    expect(normaliseOrgName('MUSEUM OF MODERN ART')).toBe('museum of modern art');
    expect(normaliseOrgName('Harlem Art Corp')).toBe('harlem art');
  });

  it('drops an apostrophe instead of splitting the word, and reads & as and', () => {
    expect(normaliseOrgName("Harlem Children's Zone")).toBe(normaliseOrgName('Harlem Childrens Zone Inc'));
    expect(normaliseOrgName('Harlem Children\u2019s Zone')).toBe('harlem childrens zone');
    expect(normaliseOrgName('Boys & Girls Club')).toBe(normaliseOrgName('Boys And Girls Club'));
  });
});

describe('lookupScoutRegistry', () => {
  it('with an EIN fetches the organization record and skips the search', async () => {
    stubFetch({ '/organizations/131624100.json': fixture('org-moma') });
    const result = await lookupScoutRegistry('whatever the form said', '131624100');
    expect(result).toEqual({
      status: 'matched',
      registry: {
        ein: '131624100',
        name: 'Museum Of Modern Art',
        city: 'New York',
        state: 'NY',
        nteeCode: 'A510',
        subsectionCode: 3,
        revenue: expect.any(Number),
        assets: expect.any(Number),
        latestFilingYear: 2023,
        source: 'propublica',
      },
    });
    expect(urls()).toHaveLength(1);
    expect(urls()[0]).not.toContain('search');
  });

  it('prefers the newest extracted filing over the master file for revenue and assets', async () => {
    const moma = fixture('org-moma') as { filings_with_data: Array<{ tax_prd_yr: number; totrevenue: number; totassetsend: number }>; organization: { revenue_amount: number } };
    const newest = [...moma.filings_with_data].sort((a, b) => b.tax_prd_yr - a.tax_prd_yr)[0];
    stubFetch({ '/organizations/131624100.json': moma });
    const result = await lookupScoutRegistry('x', '131624100');
    expect(result.registry?.revenue).toBe(newest.totrevenue);
    expect(result.registry?.assets).toBe(newest.totassetsend);
    expect(result.registry?.revenue).not.toBe(moma.organization.revenue_amount);
  });

  it('falls back to the master-file amount when there is no extracted filing', async () => {
    const org = fixture('org-no-filings') as { organization: { ein: number; revenue_amount: number } };
    const ein = String(org.organization.ein).padStart(9, '0');
    stubFetch({ [`/organizations/${ein}.json`]: org });
    const result = await lookupScoutRegistry('x', ein);
    expect(result.status).toBe('matched');
    expect(result.registry?.revenue).toBe(org.organization.revenue_amount);
    expect(result.registry?.latestFilingYear).toBeNull();
  });

  it('an unknown EIN is not_found, with no log line', async () => {
    const result = await lookupScoutRegistry('x', '000000000');
    expect(result).toEqual({ status: 'not_found', registry: null });
    expect(lines).toEqual([]);
  });

  it('without an EIN searches by name and matches the hit whose normalised name is equal', async () => {
    stubFetch({
      '/search.json': fixture('search-harlem-ny'),
      '/organizations/920434461.json': {
        organization: { ein: 920434461, name: 'Harlem Art', city: 'New York', state: 'NY', subsection_code: 3 },
      },
    });
    const result = await lookupScoutRegistry('The Harlem Art, Inc.');
    expect(result.status).toBe('matched');
    expect(result.registry?.ein).toBe('920434461');
    expect(urls()[0]).toContain('/search.json?q=The%20Harlem%20Art%2C%20Inc.');
    expect(urls()[1]).toContain('/organizations/920434461.json');
  });

  it('a single hit matches whatever its name', async () => {
    stubFetch({
      '/search.json': { total_results: 1, num_pages: 1, organizations: [{ ein: 12345, name: 'Something Else Entirely' }] },
      '/organizations/000012345.json': {
        organization: { ein: 12345, name: 'Something Else Entirely' },
      },
    });
    const result = await lookupScoutRegistry('Bronx Literacy Fund');
    expect(result.status).toBe('matched');
    expect(result.registry?.ein).toBe('000012345');
  });

  it('several hits and no name match is ambiguous, with no organization call', async () => {
    stubFetch({ '/search.json': fixture('search-harlem-ny') });
    const result = await lookupScoutRegistry('Harlem');
    expect(result).toEqual({ status: 'ambiguous', registry: null });
    expect(urls()).toHaveLength(1);
  });

  it('no hits (upstream 404 or an empty page) is not_found', async () => {
    expect(await lookupScoutRegistry('Nobody At All')).toEqual({ status: 'not_found', registry: null });
    stubFetch({ '/search.json': fixture('search-empty') });
    expect(await lookupScoutRegistry('Nobody At All')).toEqual({ status: 'not_found', registry: null });
  });

  it('a name that normalises to nothing is not_found without any upstream call', async () => {
    expect(await lookupScoutRegistry('The Inc.')).toEqual({ status: 'not_found', registry: null });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('an upstream 5xx, a timeout or a shape change is unavailable, logged with a code only', async () => {
    for (const impl of [
      () => Promise.resolve(new Response('down', { status: 503 })),
      () => Promise.reject(new DOMException('timeout', 'TimeoutError')),
      () => Promise.resolve(Response.json({ organizations: 'nope' })),
    ]) {
      lines = [];
      stubFetch({ '/search.json': impl });
      expect(await lookupScoutRegistry('Bronx Literacy Fund')).toEqual({ status: 'unavailable', registry: null });
      const mine = lines.find((l) => l.step === 'registry_lookup');
      expect(mine).toMatchObject({ event: 'route_failure', agent: 'scout', code: 'search_unavailable' });
      expect(JSON.stringify(lines)).not.toContain('Bronx');
    }
  });

  it('a failing organization fetch after a matched search is unavailable too', async () => {
    stubFetch({
      '/search.json': { total_results: 1, num_pages: 1, organizations: [{ ein: 12345, name: 'X' }] },
      '/organizations/000012345.json': () => Promise.resolve(new Response('', { status: 502 })),
    });
    expect(await lookupScoutRegistry('X')).toEqual({ status: 'unavailable', registry: null });
    expect(lines.find((l) => l.step === 'registry_lookup')?.code).toBe('organization_unavailable');
  });

  it('never throws', async () => {
    vi.stubGlobal('fetch', () => {
      throw new TypeError('fetch is not a function');
    });
    await expect(lookupScoutRegistry('X')).resolves.toEqual({ status: 'unavailable', registry: null });
  });
});
