# DSSG Success Portal

A customer success portal for NYC small businesses and nonprofits to track their engagement lifecycle with **DSSG NYC** (Data Science for Social Good), from initial meeting through membership close.

Client organizations register their business/nonprofit profile, then move it through a six-stage engagement roadmap while DSSG staff and the client collaborate on notes, budget, and hackathon deliverables in real time.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 19 + Vite 6 + TypeScript |
| Routing | React Router 7 (`BrowserRouter`) |
| Styling | Tailwind CSS 4 (via `@tailwindcss/vite`) — design tokens in the `@theme` block of [src/app/index.css](src/app/index.css) |
| Animation | Motion (Framer Motion successor) |
| Icons | lucide-react |
| Auth & Database | Supabase — Postgres, Auth (Email/Password + Google), RLS, Realtime |
| Server | Vercel Functions under [`api/`](api/) — every route but `health` requires a Supabase bearer token |
| Agents | Vercel AI SDK (Gemini), called only through [`src/model/gateway.ts`](src/model/gateway.ts) |
| Hosting | Vercel — https://nonprofit-success-ai-chi.vercel.app (deployed by `.github/workflows/cd.yml`) |

## Architecture

### Routing & Pages (`src/app/App.tsx`)

`App.tsx` owns the top-level router, navbar, footer, and auth-state listener (`onAuthChange`). It also implements a client-side **Demo Mode** that fakes a signed-in user and routes all database reads/writes in child components to static mock data, so the product can be explored without a real account or live database writes.

| Route | Component | Guard |
|---|---|---|
| `/login` | [Login](src/components/auth/Login.tsx) | redirects to `/dashboard` if already signed in |
| `/dashboard` | [Dashboard](src/components/dashboard/Dashboard.tsx) | requires `user` |
| `/business/:id` | [BusinessPortal](src/components/business/BusinessPortal.tsx) | requires `user` |
| `/apply` | [ScoutIntakeForm](src/components/scout/ScoutIntakeForm.tsx) | none — public, no account required |
| `/scout/review` | [ScoutReviewQueue](src/components/scout/ScoutReviewQueue.tsx) | requires `user` and `role === 'admin'` |
| `/architect/assess/:intakeId` | [ArchitectAssessment](src/components/architect/ArchitectAssessment.tsx) | requires `user` and `role === 'admin'` |
| `/architect/plan/:intakeId` | [ArchitectPlan](src/components/architect/ArchitectPlan.tsx) | requires `user` and `role === 'admin'` |
| `/` | — | redirects to `/dashboard` or `/login` |

`App.tsx` fetches the signed-in user's `role` from `public.users` on auth-state change to gate the admin-only route. The read goes through RLS, so it returns the caller's own row and nothing else; a null role fails closed. Demo Mode grants `admin` locally so the review queue is explorable without a database.

### Components (`src/components`)

- **`auth/Login.tsx`** — email/password sign-in and registration, Google OAuth sign-in (a redirect, via `signInWithOAuth`), and a "Demo Mode" entry point. Registration does **not** write a profile row — the `on_auth_user_created` trigger (`supabase/migrations/0008_user_provisioning.sql`) creates it with `role: 'client'`, so no signup path can skip it.
- **`dashboard/Dashboard.tsx`** — lists the signed-in user's registered businesses/nonprofits (live query via `liveQuery`; scoping to the owner is enforced by RLS, not by a client-side filter), shows portfolio stats, and lets the user register a new business via a modal form.
- **`business/BusinessPortal.tsx`** — the per-business workspace. Renders a bento-grid layout showing the business profile, a 6-stage engagement roadmap (`initial_meeting → budget_check → data_ethics_committee → scoping → hackathon_ready → membership`), a live activity feed of engagement records, and a notes box. Partners cannot write `engagements` (revoked in `0014`): a note is an append-only `note_added` row in `engagement_events`, and stages move only through `/api/engagement-transition` → `transition_engagement()` (`0013`).
- **`scout/ScoutIntakeForm.tsx`** — a public, unauthenticated 10-question intake form for prospective nonprofits/small businesses (org info, mission, primary need, problem description, systems, timeline). On submit it posts to `/api/route-intake` (signing the visitor in anonymously for a bearer token), falls back to [`routeScoutIntake`](src/agents/scout/routing.ts) through `withFallback` if the route fails, and inserts one `scout_intakes` row with both the raw answers and the computed routing result; the applicant only ever sees a generic confirmation screen.
- **`scout/ScoutReviewQueue.tsx`** — admin-only queue (Pending/Reviewed tabs) showing each intake's assigned bucket, confidence, rationale, readiness scores, and flags, with **Approve / Edit / Reject & Redirect** actions that finalize a bucket and mark the intake reviewed. Reviewed cards hand off to Architect: "Architect Assessment →" (no assessment yet) or "View 90-Day Plan" (assessment exists).
- **`architect/ArchitectAssessment.tsx`** — admin-only, staff-conducted 18-question Current-State Assessment for an approved intake (recorded during the kickoff call). On submit it POSTs `/api/architect-plan`, which scores the maturity model, drafts the charter + 90-day plan, and saves them through `submit_architect_draft()` (`0009`) beside a pending L3 `charter` approval — direct writes to `architect_assessments` are revoked (`0010`). Re-opening an assessed org pre-fills the form for re-conducting.
- **`architect/ArchitectPlan.tsx`** — the engagement blueprint view: 5-dimension maturity scorecard (with override/flag/remediation/cross-check warning banners), then tabbed documents — **90-Day Plan** (phase timeline + workstreams), **Charter**, and labeled placeholders for MOU and Kickoff Deck (their templates are open items in the spec).

### Data Access (`src/lib/supabase.ts`)

Initializes the Supabase client from `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see [.env.example](.env.example)); startup fails with a named error listing every missing variable. Also exports:

- `onAuthChange` / `fetchRole` / `signOut` — the auth surface `App.tsx` consumes.
- `liveQuery` — the `onSnapshot` replacement. Realtime streams only *changes*, so it fetches once then subscribes, and re-runs the query on any change rather than splicing individual events.
- `toColumns` / `fromColumns` / `rowToDomain` — camelCase↔snake_case mapping at the query edge, plus conversion of Postgres timestamps into the `{ seconds }` shape the domain types already use.
- `handleSupabaseError` — structured error logging, the port of the former `handleFirestoreError`.

### Domain Model (`src/types/`)

- **`Business`** — `{ id, name, type: 'small_business' | 'nonprofit', ein?, industry?, ownerId, certified, address?, createdAt }`
- **`Engagement`** — `{ id, businessId, ownerId, stage, status, notes?, budget_amount?, hackathon_project?, updatedAt }`, where `stage` is one of the six roadmap stages and `status` is `pending | in_progress | completed`
- **`UserProfile`** — `{ id, email, displayName?, role: 'client' | 'admin', createdAt }`
- **`ScoutIntake`** — intake answers + Scout's routing output + review decision in one row; see the Scout section below for the full shape
- **`ArchitectAssessment`** — Scout handoff + 18 CSA answers + maturity scores + generated charter/90-day plan in one row; see the Architect section below

Import them from the barrel, [`src/types/index.ts`](src/types/index.ts); a wire shape with a zod schema in `src/schemas/` has its type inferred from that schema. The tables are created across [supabase/migrations/](supabase/migrations/) (see [supabase/README.md](supabase/README.md)); the superseded Firestore JSON Schema is kept as port provenance in [supabase/migrations/reference/](supabase/migrations/reference/).

### Scout — intake & routing agent (`src/agents/scout/`, `src/components/scout/`)

Scout is a triage agent: prospective nonprofits/small businesses apply via a public form, and Scout assigns each application a **bucket** (`Data Infrastructure`, `Analytics & Insight`, `ML / Predictive`, `Tooling & Automation`, `Advisory / Strategy`), a **confidence** level, and an independent **engagement readiness** signal (point-of-contact availability, problem clarity, data foothold — each 1–3, rolled into `Ready | Conditional | Not Ready`), before routing to a human-review queue. The contract is [.claude/specs/platform/agents/scout.md](.claude/specs/platform/agents/scout.md).

`/api/route-intake` routes with Gemini through the model gateway. `routeScoutIntake()` in [`src/agents/scout/routing.ts`](src/agents/scout/routing.ts) is its **deterministic fallback**, used whenever the route fails — it implements the same Q6-default → Q7-cross-check → Q5/Q8-tiebreaker bucketing logic and the same 8-field output shape (`bucket`, `confidence`, `rationale`, `poc_score`, `clarity_score`, `foothold_score`, `composite_signal`, `flags`), plus one derived routing field, `hitlTier: 'L2' | 'L3'` (high confidence + Ready → `L2`, everything else → `L3`), derived server-side by `deriveHitlTier()` (`src/guardrails/hitl.ts`) so a model cannot grant itself `L2`. A fallback-routed intake carries a flag saying so for the reviewer.

Everything (raw answers + Scout's output + the eventual human review decision) lives in one table, `scout_intakes` — see [`ScoutIntake`](src/types/scout.ts) for the full field list. This intentionally does not create a `Business`/`Engagement` record automatically; converting an approved application into an onboarded client account would need an invite/claim flow, which isn't built here.

### Architect — assessment & 90-day plan agent (`src/agents/architect/`, `src/components/architect/`)

Architect follows Scout in the pipeline (contract: [.claude/specs/platform/agents/architect.md](.claude/specs/platform/agents/architect.md)): it takes an **approved** Scout intake's handoff (bucket, confidence, readiness) and runs the deeper, staff-conducted **18-question Current-State Assessment** (~30 min, recorded by an admin during the kickoff call — distinct from Scout's 5–7-minute public triage).

The CSA feeds a **5-dimension maturity model** — Data Infrastructure (×2), Governance (×2), Tooling, Decision Culture, Team Capacity (each scored Foundational 1 / Developing 2 / Established 3 per the spec's rubric). Implemented in [`src/agents/architect/scoring.ts`](src/agents/architect/scoring.ts) as *Points-Primary with Targeted Override + Flag*:

1. **Weighted composite** — `2·DI + 2·Gov + Tooling + DC + TC`, max 21; bands 7–11 Foundational, 12–16 Developing, 17–21 Established.
2. **Override (DI only)** — a Foundational Data Infrastructure score caps the composite at Developing regardless of points ("you can't run a project on data that doesn't exist"). Governance deliberately gets no override.
3. **Mandatory flags** — DI or Governance at Foundational becomes a **required, named workstream** ("Data Integration & Hygiene" / "Reporting Automation"), never generic improvement language.
4. **Remediation scoping** — one flag: the workstream runs alongside a scoped deliverable; two flags: the 90-day plan is **remediation-only** and the stretch project defers to Phase 2, contingent on the flags clearing.
5. **Scout cross-check** — a Foundational-maturity org holding an ML/Predictive bucket raises a "redirect before chartering" warning.

Unlike Scout's routing, this scoring is *not* an LLM stand-in — the spec defines it as a mechanical rubric, so the deterministic implementation is the real thing. [`src/agents/architect/plan.ts`](src/agents/architect/plan.ts) generates the **project charter** and **90-day engagement plan** (four plan shapes by composite level: build-basics / ship-one-deliverable / remediation-only / accelerate, each with Days 1–30/31–60/61–90 phases and milestones) from deterministic templates. `/api/architect-plan` drafts the narrative with the model and saves the template instead when the model is unavailable. MOU and kickoff deck render as placeholders (templates were open items in the spec).

Everything lives in one admin-only table, `architect_assessments`, where the **primary key IS the source `scout_intakes` id** (1:1). The spec's four validated edge-case profiles (including the override and remediation-only cases) are the verification vectors for the scoring engine.

### Envoy, Chronicle, Pulse

Three more agents have logic in `src/agents/` and a route in `api/`, but no screens yet:

- **Envoy** (`/api/envoy-draft`) — drafts a partner-facing message, saved through `submit_envoy_draft()` (`0012`) beside a pending L3 approval. Nothing is sent.
- **Chronicle** (`/api/chronicle-draft`) — drafts an impact story, saved through `submit_chronicle_draft()` (`0012`) beside a pending L3 approval, plus the engagement's lesson candidate (`0015`).
- **Pulse** (`/api/pulse-health`) — a read-only, model-free engagement health signal.

Envoy and Chronicle fall back to a deterministic draft when the model fails. Each agent's contract is in [.claude/specs/platform/agents/](.claude/specs/platform/agents/), and each has at least one eval metric in [src/evals/](src/evals/README.md).

### Access control — RLS (`supabase/migrations/`)

Access control is Postgres row-level security, enabled and forced on every table, ported from the superseded `firestore.rules` (kept in `supabase/migrations/reference/` as provenance). Agent writes that need an approval go through `SECURITY DEFINER` functions (`submit_*_draft()`, `transition_engagement()`) with direct table writes revoked. The migration-by-migration summary is in [supabase/README.md](supabase/README.md); the invariants and threat model are in [.claude/specs/db/security.md](.claude/specs/db/security.md).

## Project Structure

```
├── api/                               # Vercel Functions: health, route-intake, architect-plan, envoy-draft,
│   │                                  #   chronicle-draft, pulse-health, engagement-transition
│   ├── _auth.ts / _env.ts / _http.ts  # Shared helpers (bearer auth, server env, body parsing)
│   └── __tests__/
├── src/
│   ├── app/                           # App.tsx (router, auth state, role, demo mode), main.tsx, index.css (@theme tokens)
│   ├── components/                    # One subdir per feature: auth, dashboard, business, scout, architect
│   ├── agents/                        # scout, architect, envoy, chronicle, pulse — pure agent logic + fallbacks
│   ├── model/gateway.ts               # The only place an agent calls a model
│   ├── guardrails/hitl.ts             # Server-side HITL tier derivation
│   ├── observability/                 # agent_runs recorder (service role, server-only), structured logs
│   ├── evals/                         # Grading harness — see src/evals/README.md
│   ├── lib/                           # supabase.ts, api.ts (postJson, withFallback), demoStore.ts, session.ts, …
│   ├── schemas/                       # Versioned zod wire contracts crossing /api
│   └── types/                         # Shared types, re-exported from index.ts
├── supabase/
│   ├── config.toml                    # Supabase CLI config (local stack)
│   ├── migrations/                    # 0001–0019: schema, RLS, agent write functions
│   │   └── reference/                 # Firebase port sources (firestore.rules, firebase-blueprint.json)
│   └── tests/rls.test.sql             # pgTAP RLS suite
├── docs/                              # PRD + system-design exports
├── vite.config.ts
└── tsconfig.json
```

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies and the git hooks:
   ```
   npm install
   make hooks      # one-time; requires `brew install pre-commit`
   ```

   `make hooks` wires up [.pre-commit-config.yaml](.pre-commit-config.yaml) — secret
   detection (gitleaks), an eslint pass over staged `.ts`/`.tsx`, and guards against
   committing `.env` or a server-only key behind a `VITE_` prefix. Nothing autofixes, so
   the hooks never rewrite what you staged. The full gate (`type-check lint test build`)
   runs at push via `make ship`, and again in CI on every PR.
2. Start the database and copy its credentials into `.env`:

   ```bash
   make db-start   # requires Docker; prints API_URL and ANON_KEY
   ```

   Copy [.env.example](.env.example) to `.env` and set `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` from that output. Both are required — the app throws on startup
   naming whichever is missing. The agent routes read `GOOGLE_GENERATIVE_AI_API_KEY`
   (server-only — never `VITE_`); without it every model path falls back to its deterministic one.
3. Run the app:
   ```
   npm run dev
   ```

Other scripts: `npm run build` (production build), `npm run preview` (preview the build), `npm run lint` (eslint), `npm run type-check` (`tsc --noEmit`), `npm run test` (Vitest).

If you don't want to sign in with a real Supabase account, use **Enter Demo Mode** on the login screen — it populates the dashboard and business portal with static sample data and disables live database writes.
