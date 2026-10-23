# Nonprofit lookup — ProPublica proxy (D49)

Answers GitHub #14. Not an agent: no model, no `agent_runs`, no HITL tier, no local
fallback heuristic (design-system.md §2's fallback rule governs agent paths; an external
registry has nothing to substitute, so the UI shows "lookup unavailable, enter manually").

**Routes.** Vercel Functions — #14's "Express proxy" on this deploy. Both `handler()`
wrapped, bearer token required via `_auth.ts`; anonymous sign-in sessions count, so a
pre-sign-in onboarding step can call them. Upstream is ProPublica Nonprofit Explorer v2,
keyless, 5 s timeout, shared code in `api/_propublica.ts`.

- `GET /api/nonprofits/search` — `q` (1–100 chars), `state` (2 letters, `ZZ` =
  international), `ntee` (1–10), `cCode` (2–28 or 92), `page` (0–99, 25 per page). At least
  one of the first four. Unknown or repeated keys are a 400. Sent upstream as `q`,
  `state[id]`, `ntee[id]`, `c_code[id]`, `page`.
- `GET /api/nonprofits/:ein` — 9 digits, dashes stripped. No query parameters.

**#14's three questions.**

1. *Trigger?* Today, Scout: `api/route-intake` enriches every public intake with the
   applicant's record before routing (D50, below). Next, the `/onboard` lookup step
   (`feat/login`) and "Add org" in the dashboard (T2); later, the HubSpot contact push (D35).
2. *Browser or server?* Server-side GET only. The browser never calls ProPublica: one origin,
   one place for caching, a key, or a provider swap.
3. *No data available?* An EIN ProPublica knows but has no extracted filings for (e.g.
   932161095) is a **200** with `latestFiling: null`; `irs` may still carry a master-file
   revenue figure. Only an unknown EIN is `404 not_found`. A search with no hits is a 200 with
   `results: []`. The UI says "no filings on record" and lets the user continue manually.

**Wire contract.** `src/schemas/nonprofit.ts`; `SCHEMA_VERSIONS['nonprofits-search']` and
`['nonprofit-detail']` = `v1`. Search returns `{ results: NonprofitSummary[], total, page,
numPages }`. Detail returns `{ result: NonprofitDetail }`: the summary plus `irs`
(`revenueAmount`, `assetAmount`, `taxPeriod`), `latestFiling` (newest by tax year: form type,
revenue, expenses, assets, liabilities, PDF), `latestPdfFiling` (newest PDF-only filing, often a
year ahead), `filingCount`. EINs are 9-digit strings with leading zeros restored, plus `strein`.
Upstream bodies are parsed leniently (only mapped fields named); a rename is `502
upstream_shape`, never a crash. Note the upstream asymmetry: search says `subseccd`, the
organization endpoint `subsection_code`.

**Status map.** 400 `invalid_input`; 401/503 from auth; 404 `not_found` (unknown EIN); 502
`upstream_unavailable` (upstream 429/5xx, timeout, network); 502 `upstream_shape`.

**Caching.** `Cache-Control: private, max-age=3600` on a hit, `max-age=300` on a miss,
`no-store` on any error. Browser-only by design: a shared CDN cache would serve an
authenticated response to unauthenticated callers. Open: drop auth for `public, s-maxage`?

**Logging.** `route_failure` with route, step, code, upstream status and duration only. The
search text may be an org name and is never logged.

**Client.** `searchNonprofits()` and `getNonprofit()` in `src/lib/api.ts` (`getJson`, no
`withFallback`).

**Consumers.** Scout (D50, `platform/agents/scout.md` §"The IRS registry record"):
`api/_scoutRegistry.ts` calls `fetchUpstream` / `upstreamSearch` / `upstreamOrganization`
directly — same process, no hop through these routes, so the intake form makes one request
and the browser still never calls ProPublica. `lookupScoutRegistry(orgName, ein?)` reduces
the detail to `ScoutRegistry` (`src/schemas/scout.ts`) and reports `matched` / `not_found`
/ `ambiguous` / `unavailable`; it never throws, and logs `route_failure` with
`step: 'registry_lookup'` and a code only. The match rule is deliberately narrow (EIN; a
single hit; a normalised-name-equal hit) so a wrong org's numbers do not enrich an intake,
and the intake card shows the matched name and EIN beside the form's org name.

**Tests.** `api/__tests__/nonprofits.test.ts` stubs `fetch` with trimmed live responses
(`fixtures/`, captured 2026-10-08). `nonprofits.live.test.ts` hits the real API only with
`PROPUBLICA_LIVE=1` — run it when touching the upstream schemas.
