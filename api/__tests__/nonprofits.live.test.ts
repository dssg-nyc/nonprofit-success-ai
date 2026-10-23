import { describe, expect, it } from 'vitest';
import { PROPUBLICA_BASE, toDetail, toSummary, upstreamOrganization, upstreamSearch } from '../_propublica';

// Shape-drift check against the real ProPublica API. Skipped unless PROPUBLICA_LIVE=1,
// so `npm test` and CI never touch the network:
//   PROPUBLICA_LIVE=1 npx vitest run api/__tests__/nonprofits.live.test.ts
// A failure here means ProPublica renamed or retyped a field the routes map; refresh
// fixtures/ and the upstream schemas in `_propublica.ts` together.

const get = async (path: string) => {
  const res = await fetch(`${PROPUBLICA_BASE}${path}`, { signal: AbortSignal.timeout(15_000) });
  return { status: res.status, body: (await res.json()) as unknown };
};

describe.skipIf(!process.env.PROPUBLICA_LIVE)('ProPublica live shapes', () => {
  it('search.json still parses and maps', async () => {
    const { status, body } = await get('/search.json?q=harlem&state%5Bid%5D=NY');
    expect(status).toBe(200);
    const parsed = upstreamSearch.parse(body);
    expect(parsed.organizations.length).toBeGreaterThan(0);
    expect(parsed.organizations.map(toSummary)[0].ein).toMatch(/^\d{9}$/);
  });

  it('organizations/:ein.json still parses, with subsection_code and filings', async () => {
    const { status, body } = await get('/organizations/131624100.json');
    expect(status).toBe(200);
    const detail = toDetail(upstreamOrganization.parse(body));
    expect(detail.subsectionCode).toBe(3);
    expect(detail.latestFiling?.totalRevenue).toEqual(expect.any(Number));
  });

  it('a no-data EIN is still a 200 and an unknown EIN still a 404', async () => {
    expect((await get('/organizations/932161095.json')).status).toBe(200);
    expect((await get('/organizations/000000001.json')).status).toBe(404);
    expect((await get('/search.json?q=zzzxqqnotreal')).status).toBe(404);
  });
});
