# Client Success Journey — plan and build notes

Branch: `feature/client-success-journey` · Status: implemented (portal + journey map); Salesforce live sync is a follow-up, honestly scoped in §4–§5. Updated 2026-11-24: the previously planned final "membership offer" step was **removed at the client's direction** — the journey now ends at Hackathon Ready.

## 1. The goal

Our first pro bono nonprofit clients can:

1. **Create an account themselves** — Google sign-in, or any email + password.
2. **Be saved reliably** — in Supabase today (auth, profile, organization, journey progress), and linked to **Salesforce** as the relationship system of record (see §4 for what is and is not possible yet).
3. **See their whole journey the moment they log in** — a single mapped path from *Initial Meeting* to *Hackathon Ready*, always showing where they are, what they do next, and what DSSG does.

## 2. Two doors, kept apart

The login page already has two tabs (`src/lib/loginIntent.ts`, `src/components/auth/Login.tsx`). This build makes the distinction explicit in the client UI (`ClientJourneyPage`) and never mixes the two journeys:

| | Nonprofit Client (this build) | Data Diplomat / Volunteer (not this build) |
|---|---|---|
| Login tab | **For Nonprofits** | For Data Diplomats |
| Who | A nonprofit / small-business client of DSSG NYC | DSSG & Data Diplomats team / volunteers |
| Sign-in | Google, **or email + password** (`supabase.auth.signUp`) | Google only |
| Email rule | Any email | Must be `@datadiplomats.org` (`TEAM_EMAIL_DOMAIN`) |
| Profile role | `client` (provisioned by the `on_auth_user_created` trigger; a signup can never self-promote) | `admin` (granted by DSSG only; the door refuses non-admin profiles) |
| Lands on | Dashboard → **`/journey`** (this build) | Staff / team surfaces (`/admin`, `/projects`, Architect) |
| Their tools | Journey map, business portal, notes on stages | Their own project-management tools — a separate surface, **not required for the client journey** and not built here |

Rule of thumb enforced by the existing code and kept here: a client never lands in volunteer tools, and a volunteer login never advances a client's steps. Stage movement is staff-side only, via `/api/engagement-transition`.

## 3. The journey map

Implemented as data + pure derivation in `src/lib/clientJourney.ts` (`CLIENT_JOURNEY_STEPS`, `buildClientJourney`), rendered by `src/components/client/ClientJourney.tsx` at **`/journey`**.

| # | Step | Client does | DSSG does | Done when |
|---|---|---|---|---|
| 1 | Create your account | Signs up (Google or email + password) on the For Nonprofits door | Trigger provisions a `client` profile in Supabase | Client can sign in |
| 2 | Validate your nonprofit | Enters org name + EIN in `/onboarding` | 501(c)(3) check against IRS / ProPublica data; result recorded (`Business.certified`) | Org shows validated |
| 3 | Application & review | Completes the first-time applicant survey (`/apply`) | Scout triages; a DSSG reviewer approves / redirects / declines | Approved; engagement opened |
| 4 | **Initial Meeting** | Meets DSSG; shares context, data, names a decision-maker | Structured notes; outcome recorded | Meeting held; problem worth scoping |
| 5 | **Budget Check** | Confirms budget, tools, data access, staff time | Records budget on the engagement; flags gaps | Budget recorded & accepted |
| 6 | **Data Ethics Committee** | Describes the data, who it's about, consent / sensitivity | Committee approves, conditions, or stops the data use | Committee approval |
| 7 | **Scoping** | Reviews assessment + draft charter / 90-day plan; confirms priorities | Architect assessment; charter & 90-day plan drafted | Charter + plan confirmed |
| 8 | **Hackathon Ready** | Confirms project summary; available during the build | Project brief finalized; matched to a Data Diplomats team (in the volunteers' own tools) | Project marked hackathon-ready — **pro bono journey complete** |

Steps 4–8 are five of the existing six lifecycle stages (`src/lib/lifecycle.ts`). The sixth, `membership`, is staff-side bookkeeping after the journey and is **not** a client step — the journey ends at Hackathon Ready. `buildClientJourney` derives each step's status from facts already stored (session, `Business.certified`, engagement rows via `deriveCurrentStage`) and guarantees one current step (or none, when the journey is complete).

Known pre-existing gap (unchanged by this branch, flagged in the README): converting an *approved* Scout intake into the client's Business + first Engagement is not yet automated — staff open the first engagement today. The journey handles this honestly: step 3 stays current until an engagement exists.

## 4. Salesforce: what is possible, and the Supabase fallback

**Saving a new client directly into real Salesforce is not possible with the codebase as it stands — and this branch does not pretend otherwise:**

- `api/_salesforce.ts` is explicit: Salesforce is the intended owner of relationship data, but the other side today is a **local-only stand-in** (a `salesforce` schema inside Supabase, `supabase/migrations/reference/salesforce/`). The hosted Supabase project has no such schema, so hosted calls return `unavailable`.
- There are **no Salesforce credentials or endpoints in `.env.example`** (no org URL, client id/secret, or integration user). A live sync needs DSSG to provision a Salesforce integration user / Connected App — an admin action outside this repo.
- The integration seam is already designed: when it lands, only the bodies of the functions in `api/_salesforce.ts` switch to the Salesforce REST API; signatures and callers stay. `upsertApplicant()` (Account by EIN + primary Contact, idempotent) is the function a client registration should call, storing the returned ids on `Business.salesforceAccountId` / `UserProfile.salesforceContactId`.

**Until then, Supabase is the working system of record for the portal — by design, not as a workaround:**

- **Auth**: Supabase Auth (Google + email/password) — already live in `Login.tsx`.
- **Profile**: `public.users` row created by trigger with role `client`.
- **Organization & journey**: `businesses` + `engagements` rows; the journey page reads them under RLS (a client only ever sees their own).
- **Salesforce link state is shown, not hidden**: `/journey` tells the client plainly whether their record is linked to Salesforce or *pending* (no `salesforceAccountId` yet), and that no action is needed from them. DSSG completes links in bulk once the integration lands, using EIN as the match key — the same key `upsertApplicant` upserts on.
- **Keeping Supabase awake**: already handled — `api/keepalive.ts` is called by Vercel Cron twice a week (`vercel.json`) and reads through PostgREST specifically so the free-tier database does work and does not pause. No manual wake-up step is needed; if the project ever *does* pause (e.g. cron env missing), restoring it is a Supabase dashboard action for DSSG staff, and clients' accounts/journey data are unaffected.

## 5. What this branch adds

- `docs/client-success-journey.md` — this plan.
- `src/lib/clientJourney.ts` — the journey map as data + pure status derivation (no React/Supabase imports, per `lib/` convention).
- `src/lib/clientJourney.test.ts` — Vitest coverage: new client, onboarding order, in-progress stage, journey ending at Hackathon Ready, and regression checks that no membership step exists.
- `src/components/client/ClientJourney.tsx` — timeline UI: progress, "You are here", per-step client action / DSSG action / exit criteria.
- `src/components/client/ClientJourneyPage.tsx` — `/journey` page: door delineation banner, journey, Salesforce link status; works in Demo Mode from the shared demo store and live from Supabase.
- `src/app/App.tsx` — one new route: `/journey` (login required).

## 6. Follow-ups (in priority order)

1. **Salesforce integration user** (DSSG admin): provision Connected App + credentials, add `SALESFORCE_*` envs, implement the REST bodies in `api/_salesforce.ts`, backfill links by EIN.
2. **Automate approved-intake → engagement conversion** so step 3 completes without staff action.
3. **Nav**: link `/journey` from SiteHeader / Dashboard for signed-in clients.
