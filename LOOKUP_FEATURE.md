# Nonprofit Data Lookup Feature

## Overview

Users enter nonprofit homepage URL, organization name, or tax ID (EIN) to auto-populate organization details. Uses **ProPublica Nonprofit Explorer API** (free, no key required).

## Flow

```
/onboard
  ↓
[LookupSection] ← NEW STEP 1
  Enter: URL, org name, or EIN → Search ProPublica
  Results: org name, EIN, website, mission
  Skip: "Skip Lookup • Enter Manually"
  ↓ (confirmed)
[AuthSection] (new step 2)
  Google OAuth or email/password
  ↓
[ProfileSection]
  Name, role, phone
  ↓
[OrganizationSection] ← AUTO-FILLED
  Lookup data pre-fills: orgName, orgType, orgEin, orgWebsite
  All fields editable with "Auto-filled from ProPublica" badge
  ↓
[ProgramSection]
  Interest, funding, timeline
  ↓
[IntakeSection]
  Scout assessment
  ↓
[Success]
```

## Components Built

### LookupSection.tsx
Input modes: Homepage URL, Organization Name, EIN (tabs to switch)
- Calls searchNonprofit() from nonprofitLookup.ts
- Shows result card with org name, EIN, website, mission
- Buttons: "Use This Info" (prefill form), "Search Again", "Skip Lookup"

### OrganizationSection.tsx (Updated)
- Accepts lookupResult prop
- useEffect pre-fills fields from lookup
- Shows "Auto-filled from ProPublica" info badge
- All fields remain editable (user can override)

### nonprofitLookup.ts (New Service)
Functions:
- `searchNonprofit(query)` - main entry point
- `searchProPublica(name)` - query by org name
- `searchProPublicaByEin(ein)` - query by tax ID
- `extractDomain(url)` - parse homepage URL
- `domainToOrgName(domain)` - heuristic domain→name
- `formatEin(ein)` - normalize to XX-XXXXXXX
- `isValidEin(ein)` - validate format

## API: ProPublica

No auth required (free public data).

**Endpoints:**
- `GET https://projects.propublica.org/nonprofits/api/v2/organizations.json?q={name}`
- `GET https://projects.propublica.org/nonprofits/api/v2/organizations/{ein}.json`

**Returns:**
- organization.name
- organization.tax_id
- organization.website
- organization.mission_statement

## Data Types

```typescript
interface NonprofitLookupResult {
  orgName: string
  ein?: string
  orgType: 'nonprofit' | 'small_business' | 'other'
  website?: string
  mission?: string
  source: 'propublica' | 'goodstack' | 'manual'
  confidence: 'high' | 'medium' | 'low'
}

interface NonprofitSearchQuery {
  url?: string
  name?: string
  ein?: string
}
```

## Error Handling

- **No match**: "No organization found. Please verify and try again."
- **API error**: "Search failed. Please try again."
- **User can always**: Skip lookup and enter manually (form doesn't block)

## Testing Checklist

- [ ] ProPublica API accessible
- [ ] URL parsing works (various formats)
- [ ] EIN formatting correct
- [ ] Lookup → pre-fills OrganizationSection
- [ ] User can edit pre-filled fields
- [ ] Skip lookup button works
- [ ] No results → error handling
- [ ] Mobile responsive

## Files Modified

- `src/types.ts` - NonprofitLookupResult, NonprofitSearchQuery
- `src/lib/nonprofitLookup.ts` - NEW service
- `src/components/onboarding/sections/LookupSection.tsx` - NEW component
- `src/components/onboarding/sections/OrganizationSection.tsx` - Accept lookupResult, useEffect pre-fill
- `src/components/onboarding/OnboardingFlow.tsx` - Add 'lookup' step, stepOrder=['lookup','auth',...], handleLookupComplete

## Future Add-Ons

- GoodStack API (when credentials available)
- Candid/Foundation Center integration
- Local business registry fallback
- Confidence score display
- Multiple results (let user pick one)
- Lookup history/cache

## Performance

- ProPublica response: ~500-1000ms
- Client-side only (no backend)
- Optional (user can skip)
- API called on-demand (no polling)
