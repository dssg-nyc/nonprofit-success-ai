import { NonprofitLookupResult, NonprofitSearchQuery } from '../types';

const PROPUBLICA_API = 'https://projects.propublica.org/nonprofits/api/v2';

export async function searchNonprofit(query: NonprofitSearchQuery): Promise<NonprofitLookupResult | null> {
  try {
    if (query.name) {
      const result = await searchProPublica(query.name);
      if (result) return result;
    }

    if (query.ein) {
      const result = await searchProPublicaByEin(query.ein);
      if (result) return result;
    }

    if (query.url) {
      const domain = extractDomain(query.url);
      const name = domainToOrgName(domain);
      const result = await searchProPublica(name);
      if (result) return result;
    }

    return null;
  } catch (err) {
    console.error('Nonprofit lookup error:', err);
    return null;
  }
}

async function searchProPublica(name: string): Promise<NonprofitLookupResult | null> {
  try {
    const response = await fetch(`${PROPUBLICA_API}/organizations.json?q=${encodeURIComponent(name)}`);

    if (!response.ok) return null;

    const data: any = await response.json();

    if (!data.organizations || data.organizations.length === 0) return null;

    const org = data.organizations[0];

    return {
      orgName: org.name || name,
      ein: org.tax_id,
      orgType: 'nonprofit',
      website: org.website,
      mission: org.mission_statement,
      source: 'propublica',
      confidence: 'high',
    };
  } catch (err) {
    console.error('ProPublica search failed:', err);
    return null;
  }
}

async function searchProPublicaByEin(ein: string): Promise<NonprofitLookupResult | null> {
  try {
    const cleanEin = ein.replace(/[^\d]/g, '');
    const response = await fetch(`${PROPUBLICA_API}/organizations/${cleanEin}.json`);

    if (!response.ok) return null;

    const data: any = await response.json();

    if (!data.organization) return null;

    const org = data.organization;

    return {
      orgName: org.name,
      ein: org.tax_id,
      orgType: 'nonprofit',
      website: org.website,
      mission: org.mission_statement,
      source: 'propublica',
      confidence: 'high',
    };
  } catch (err) {
    console.error('ProPublica EIN search failed:', err);
    return null;
  }
}

function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function domainToOrgName(domain: string): string {
  const name = domain.replace(/\.(org|com|net|info|us|gov)$/, '');
  return name
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function isValidEin(ein: string): boolean {
  const cleanEin = ein.replace(/[^\d]/g, '');
  return cleanEin.length === 9;
}

export function formatEin(ein: string): string {
  const cleanEin = ein.replace(/[^\d]/g, '');
  if (cleanEin.length !== 9) return ein;
  return `${cleanEin.slice(0, 2)}-${cleanEin.slice(2)}`;
}
