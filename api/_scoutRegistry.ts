import { log } from '../src/observability/log.js';
import type { ScoutRegistry, ScoutRegistryLookup } from '../src/types/index.js';
import { PROPUBLICA_BASE, fetchUpstream, toDetail, upstreamOrganization, upstreamSearch } from './_propublica.js';

/**
 * Scout's registry enrichment: the applicant's IRS record from ProPublica, looked up
 * server-side from the intake's org name (or its optional EIN) before routing. The
 * nonprofits routes stay the service layer; this calls the same upstream in-process so
 * the form needs no second request and the browser still never talks to ProPublica.
 *
 * Never throws and never delays past `fetchUpstream`'s timeout per call (two calls at
 * most: a search, then the organization record of the one match). Any failure is an
 * `unavailable` lookup and the intake routes without the record, exactly as before.
 */

export type ScoutRegistryResult =
  | { status: 'matched'; registry: ScoutRegistry }
  | { status: Exclude<ScoutRegistryLookup, 'matched'>; registry: null };

/** Words that vary between how an applicant writes a name and how the IRS files it. */
const NAME_NOISE = /\b(inc|incorporated|corp|corporation|the)\b/g;

/** Lower-case, punctuation and filler words gone, whitespace collapsed. */
export function normaliseOrgName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(NAME_NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const lookupFailed = (code: string): ScoutRegistryResult => {
  log('warn', 'route_failure', { agent: 'scout', step: 'registry_lookup', code });
  return { status: 'unavailable', registry: null };
};

/** Fetch one organization record and reduce it to what Scout reads. */
async function organization(ein: string): Promise<ScoutRegistryResult> {
  const upstream = await fetchUpstream(`${PROPUBLICA_BASE}/organizations/${ein}.json`, upstreamOrganization);
  if (upstream.kind === 'error') return lookupFailed('organization_unavailable');
  if (upstream.kind === 'not_found') return { status: 'not_found', registry: null };
  const detail = toDetail(upstream.data);
  return {
    status: 'matched',
    registry: {
      ein: detail.ein,
      name: detail.name,
      city: detail.city,
      state: detail.state,
      nteeCode: detail.nteeCode,
      subsectionCode: detail.subsectionCode,
      // The newest extracted filing is more current than the master file; fall back to
      // the master-file amount when ProPublica has no extracted filing.
      revenue: detail.latestFiling?.totalRevenue ?? detail.irs.revenueAmount,
      assets: detail.latestFiling?.totalAssets ?? detail.irs.assetAmount,
      latestFilingYear: detail.latestFiling?.taxYear ?? detail.latestPdfFiling?.taxYear ?? null,
      source: 'propublica',
    },
  };
}

/**
 * With an EIN: the organization record, no search. Without: a name search, and a match
 * only when there is a single hit or one hit's normalised name equals the applicant's.
 * Several hits and no such name is `ambiguous` — a wrong match would enrich the intake
 * with another org's numbers, so the rule errs toward no record.
 */
export async function lookupScoutRegistry(orgName: string, ein?: string): Promise<ScoutRegistryResult> {
  try {
    if (ein) return await organization(ein);

    const wanted = normaliseOrgName(orgName);
    if (!wanted) return { status: 'not_found', registry: null };
    const search = await fetchUpstream(
      `${PROPUBLICA_BASE}/search.json?q=${encodeURIComponent(orgName.trim())}`,
      upstreamSearch,
    );
    if (search.kind === 'error') return lookupFailed('search_unavailable');
    if (search.kind === 'not_found') return { status: 'not_found', registry: null };

    const hits = search.data.organizations;
    if (hits.length === 0) return { status: 'not_found', registry: null };
    const hit = hits.length === 1 ? hits[0] : hits.find((h) => normaliseOrgName(h.name) === wanted);
    if (!hit) return { status: 'ambiguous', registry: null };
    return await organization(String(hit.ein).replace(/\D/g, '').padStart(9, '0'));
  } catch {
    // `fetchUpstream` already catches transport and shape errors; this is the last line.
    return lookupFailed('lookup_threw');
  }
}
