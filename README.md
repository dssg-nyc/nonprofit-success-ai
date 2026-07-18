# DSSG Success Portal

A customer success portal for NYC small businesses and nonprofits to track their engagement lifecycle with **DSSG NYC** (Data Science for Social Good), from initial meeting through membership close.

Client organizations register their business/nonprofit profile, then move it through a six-stage engagement roadmap while DSSG staff and the client collaborate on notes, budget, and hackathon deliverables in real time.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 19 + Vite 6 + TypeScript |
| Routing | React Router 7 (`BrowserRouter`) |
| Styling | Tailwind CSS 4 (via `@tailwindcss/vite`) — see [design.md](design.md) for the full design system |
| Animation | Motion (Framer Motion successor) |
| Icons | lucide-react |
| Auth & Database | Firebase Auth (Email/Password + Google) and Cloud Firestore |
| Hosting target | Google AI Studio / Cloud Run applet |

## Architecture

### Routing & Pages (`src/App.tsx`)

`App.tsx` owns the top-level router, navbar, footer, and auth-state listener (`onAuthStateChanged`). It also implements a client-side **Demo Mode** that fakes a signed-in user and routes all Firestore reads/writes in child components to static mock data, so the product can be explored without a real account or live database writes.

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

`App.tsx` fetches the signed-in user's `role` from `users/{uid}` on auth-state change to gate the admin-only route (Demo Mode grants `admin` automatically so the review queue is explorable without a real Firebase project).

### Components (`src/components`)

- **`auth/Login.tsx`** — email/password sign-in and registration, Google OAuth popup sign-in, and a "Demo Mode" entry point. New registrations write a `users/{uid}` profile document with `role: 'client'`.
- **`dashboard/Dashboard.tsx`** — lists the signed-in user's registered businesses/nonprofits (live Firestore `onSnapshot` query filtered by `ownerId`), shows portfolio stats, and lets the user register a new business via a modal form.
- **`business/BusinessPortal.tsx`** — the per-business workspace. Renders a bento-grid layout showing the business profile, a 6-stage engagement roadmap (`initial_meeting → budget_check → data_ethics_committee → scoping → hackathon_ready → membership`), a live activity feed of engagement records, and stage-management controls (status toggle + notes) that upsert an `engagements/{businessId}_{stage}` document per stage.
- **`scout/ScoutIntakeForm.tsx`** — a public, unauthenticated 10-question intake form for prospective nonprofits/small businesses (org info, mission, primary need, problem description, systems, timeline). On submit it runs [`routeScoutIntake`](src/lib/scoutRouting.ts) and writes one `scoutIntakes/{id}` document with both the raw answers and the computed routing result; the applicant only ever sees a generic confirmation screen.
- **`scout/ScoutReviewQueue.tsx`** — admin-only queue (Pending/Reviewed tabs) showing each intake's assigned bucket, confidence, rationale, readiness scores, and flags, with **Approve / Edit / Reject & Redirect** actions that finalize a bucket and mark the intake reviewed. Reviewed cards hand off to Architect: "Architect Assessment →" (no assessment yet) or "View 90-Day Plan" (assessment exists).
- **`architect/ArchitectAssessment.tsx`** — admin-only, staff-conducted 18-question Current-State Assessment for an approved intake (recorded during the kickoff call). On submit it scores the maturity model, generates the charter + 90-day plan, and writes one `architectAssessments/{intakeId}` document. Re-opening an assessed org pre-fills the form for re-conducting.
- **`architect/ArchitectPlan.tsx`** — the engagement blueprint view: 5-dimension maturity scorecard (with override/flag/remediation/cross-check warning banners), then tabbed documents — **90-Day Plan** (phase timeline + workstreams), **Charter**, and labeled placeholders for MOU and Kickoff Deck (their templates are open items in the spec).

### Data Access (`src/lib/firebase.ts`)

Initializes the Firebase app from [firebase-applet-config.json](firebase-applet-config.json) and exports `auth` and `db` (Firestore) singletons. Also exposes `handleFirestoreError`, a shared error handler that enriches thrown Firestore errors with the operation type, document path, and current auth context before logging/re-throwing — used by every read/write call site in the dashboard and business portal.

### Domain Model (`src/types.ts`)

- **`Business`** — `{ id, name, type: 'small_business' | 'nonprofit', ein?, industry?, ownerId, certified, address?, createdAt }`
- **`Engagement`** — `{ id, businessId, ownerId, stage, status, notes?, budget_amount?, hackathon_project?, updatedAt }`, where `stage` is one of the six roadmap stages and `status` is `pending | in_progress | completed`
- **`UserProfile`** — `{ id, email, displayName?, role: 'client' | 'admin', createdAt }`
- **`ScoutIntake`** — intake answers + Scout's routing output + review decision in one document; see the Scout section below for the full shape
- **`ArchitectAssessment`** — Scout handoff + 18 CSA answers + maturity scores + generated charter/90-day plan in one document; see the Architect section below

The same shapes are mirrored as JSON Schema for the Firebase applet in [firebase-blueprint.json](firebase-blueprint.json).

### Scout — intake & routing agent (`src/lib/scoutRouting.ts`, `src/components/scout/`)

Scout is a triage agent: prospective nonprofits/small businesses apply via a public form, and Scout assigns each application a **bucket** (`Data Infrastructure`, `Analytics & Insight`, `ML / Predictive`, `Tooling & Automation`, `Advisory / Strategy`), a **confidence** level, and an independent **engagement readiness** signal (point-of-contact availability, problem clarity, data foothold — each 1–3, rolled into `Ready | Conditional | Not Ready`), before routing to a human-review queue. `scout-design.md` and `scout-build-spec.md` (repo root) are the original design/build specs, written against a Tally + n8n + Airtable + Anthropic API pipeline; this app implements the same intake → bucket-routing → human-review logic natively instead, since none of that external stack exists in this repo.

`routeScoutIntake()` in [`src/lib/scoutRouting.ts`](src/lib/scoutRouting.ts) is a **deterministic stand-in** for the real Claude call the spec describes (no Anthropic API key is wired up yet) — it implements the same Q6-default → Q7-cross-check → Q5/Q8-tiebreaker bucketing logic and the same 8-field output shape (`bucket`, `confidence`, `rationale`, `poc_score`, `clarity_score`, `foothold_score`, `composite_signal`, `flags`), plus one derived routing field, `hitlTier: 'L2' | 'L3'` (high confidence + Ready → `L2`, everything else → `L3`). Swapping in a real API call later is meant to be a drop-in replacement behind this same function signature — and should move server-side (a Cloud Function) at that point, since a client bundle can't hold a secret API key.

Everything (raw answers + Scout's output + the eventual human review decision) lives in one Firestore collection, `scoutIntakes/{id}` — see [`ScoutIntake`](src/types.ts) for the full field list. This intentionally does not create a `Business`/`Engagement` record automatically; converting an approved application into an onboarded client account would need an invite/claim flow, which isn't built here.

### Architect — assessment & 90-day plan agent (`src/lib/architectScoring.ts`, `src/lib/architectPlan.ts`, `src/components/architect/`)

Architect follows Scout in the pipeline ([architect-design.md](architect-design.md)): it takes an **approved** Scout intake's handoff (bucket, confidence, readiness) and runs the deeper, staff-conducted **18-question Current-State Assessment** (~30 min, recorded by an admin during the kickoff call — distinct from Scout's 5–7-minute public triage).

The CSA feeds a **5-dimension maturity model** — Data Infrastructure (×2), Governance (×2), Tooling, Decision Culture, Team Capacity (each scored Foundational 1 / Developing 2 / Established 3 per the spec's rubric). Implemented in [`src/lib/architectScoring.ts`](src/lib/architectScoring.ts) as *Points-Primary with Targeted Override + Flag*:

1. **Weighted composite** — `2·DI + 2·Gov + Tooling + DC + TC`, max 21; bands 7–11 Foundational, 12–16 Developing, 17–21 Established.
2. **Override (DI only)** — a Foundational Data Infrastructure score caps the composite at Developing regardless of points ("you can't run a project on data that doesn't exist"). Governance deliberately gets no override.
3. **Mandatory flags** — DI or Governance at Foundational becomes a **required, named workstream** ("Data Integration & Hygiene" / "Reporting Automation"), never generic improvement language.
4. **Remediation scoping** — one flag: the workstream runs alongside a scoped deliverable; two flags: the 90-day plan is **remediation-only** and the stretch project defers to Phase 2, contingent on the flags clearing.
5. **Scout cross-check** — a Foundational-maturity org holding an ML/Predictive bucket raises a "redirect before chartering" warning.

Unlike Scout's routing, this scoring is *not* an LLM stand-in — the spec defines it as a mechanical rubric, so the deterministic implementation is the real thing. [`src/lib/architectPlan.ts`](src/lib/architectPlan.ts) then generates the **project charter** and **90-day engagement plan** (four plan shapes by composite level: build-basics / ship-one-deliverable / remediation-only / accelerate, each with Days 1–30/31–60/61–90 phases and milestones) from deterministic templates — that narrative layer is what a future Claude call would enrich. MOU and kickoff deck render as placeholders (templates were open items in the spec).

Everything lives in one admin-only Firestore collection, `architectAssessments/{id}`, where the **doc ID equals the source `scoutIntakes` doc ID** (1:1). The spec's four validated edge-case profiles (including the override and remediation-only cases) are the verification vectors for the scoring engine.

### Firestore Security (`firestore.rules`)

Default-deny rules scoped per collection:

- **`users/{userId}`** — a user may only read/write their own profile; `role` is immutable after creation and only `displayName`/`updatedAt` can be patched.
- **`businesses/{businessId}`** — owner-scoped read/list/update/delete; `ownerId` must match `request.auth.uid` on create and cannot be changed afterward.
- **`engagements/{engagementId}`** — owner-scoped, and creation requires the referenced `businessId` to already exist (atomic guarantee against orphaned engagements). A `completed` engagement cannot be reverted to an earlier status (terminal-state lock).
- **`scoutIntakes/{intakeId}`** — the one public-write collection: any unauthenticated client can `create` an intake (shape/enum/length-validated), but `get`/`list`/`update` are staff-only (`role == 'admin'`, checked via a `get()` lookup on the requester's `users/{uid}` doc). `update` is further locked to only the review-decision fields. Because the routing result is computed client-side and written in the same unauthenticated `create`, a motivated actor could forge a bucket/confidence Scout never actually produced — an accepted gap for a stub with no auto-send action behind it, and one more reason the real routing call needs to move server-side.
- **`architectAssessments/{assessmentId}`** — fully admin-only (staff-conducted). `create` requires the doc ID to reference an existing `scoutIntakes` doc (no orphaned assessments) and validates every scored CSA field against its enum; `update` (re-conducting) revalidates the whole document. The nested `charter`/`ninetyDayPlan` maps are shape-checked only — deep map validation in rules is impractical, and this surface is admin-authored. No delete (audit trail).

The threat model behind these rules (identity spoofing, privilege escalation, orphaned records, resource exhaustion, etc.) is documented in [security_spec.md](security_spec.md).

## Project Structure

```
├── src/
│   ├── App.tsx                        # Router, navbar, footer, auth state, role, demo mode
│   ├── main.tsx                       # React root
│   ├── index.css                      # Tailwind entry + design tokens
│   ├── types.ts                       # Business / Engagement / UserProfile / Scout / Architect types
│   ├── lib/
│   │   ├── firebase.ts                # Firebase app/auth/db init + error handling
│   │   ├── scoutRouting.ts            # Scout's stub bucket/readiness routing algorithm
│   │   ├── architectScoring.ts        # Architect's maturity model (rubric, override, flags)
│   │   ├── architectPlan.ts           # Charter + 90-day plan template generators
│   │   └── demoStore.ts               # In-memory demo-mode persistence across routes
│   └── components/
│       ├── auth/Login.tsx             # Sign-in / register / demo mode
│       ├── dashboard/Dashboard.tsx    # Business list + registration
│       ├── business/BusinessPortal.tsx# Per-business engagement workspace
│       ├── scout/
│       │   ├── ScoutIntakeForm.tsx    # Public intake form (/apply)
│       │   └── ScoutReviewQueue.tsx   # Admin review queue (/scout/review)
│       └── architect/
│           ├── ArchitectAssessment.tsx# Staff-conducted CSA form (/architect/assess/:id)
│           └── ArchitectPlan.tsx      # Maturity scorecard + charter + 90-day plan (/architect/plan/:id)
├── firestore.rules                    # Firestore security rules
├── firebase-applet-config.json        # Firebase project config (consumed by lib/firebase.ts)
├── firebase-blueprint.json            # JSON Schema for Business/Engagement/User entities
├── security_spec.md                   # Data invariants + attack-vector checklist
├── design.md                          # Portable design system spec (colors, type, components)
├── scout-design.md                    # Scout agent design spec (original Tally/n8n/Airtable plan)
├── scout-build-spec.md                # Scout agent build spec (original Tally/n8n/Airtable plan)
├── architect-design.md                # Architect agent design spec (CSA + maturity model + outputs)
├── vite.config.ts
└── tsconfig.json
```

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   ```
   npm install
   ```
2. Copy [.env.example](.env.example) to `.env.local` and set `GEMINI_API_KEY` (only needed if you extend the app with Gemini API calls — the current UI does not call it). Firebase credentials are read from the committed [firebase-applet-config.json](firebase-applet-config.json), not from env vars.
3. Run the app:
   ```
   npm run dev
   ```

Other scripts: `npm run build` (production build), `npm run preview` (preview the build), `npm run lint` (TypeScript type-check via `tsc --noEmit`).

If you don't want to sign in with a real Firebase account, use **Enter Demo Mode** on the login screen — it populates the dashboard and business portal with static sample data and disables live database writes.
