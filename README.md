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
| `/` | — | redirects to `/dashboard` or `/login` |

`App.tsx` fetches the signed-in user's `role` from `users/{uid}` on auth-state change to gate the admin-only route (Demo Mode grants `admin` automatically so the review queue is explorable without a real Firebase project).

### Components (`src/components`)

- **`auth/Login.tsx`** — email/password sign-in and registration, Google OAuth popup sign-in, and a "Demo Mode" entry point. New registrations write a `users/{uid}` profile document with `role: 'client'`.
- **`dashboard/Dashboard.tsx`** — lists the signed-in user's registered businesses/nonprofits (live Firestore `onSnapshot` query filtered by `ownerId`), shows portfolio stats, and lets the user register a new business via a modal form.
- **`business/BusinessPortal.tsx`** — the per-business workspace. Renders a bento-grid layout showing the business profile, a 6-stage engagement roadmap (`initial_meeting → budget_check → data_ethics_committee → scoping → hackathon_ready → membership`), a live activity feed of engagement records, and stage-management controls (status toggle + notes) that upsert an `engagements/{businessId}_{stage}` document per stage.
- **`scout/ScoutIntakeForm.tsx`** — a public, unauthenticated 10-question intake form for prospective nonprofits/small businesses (org info, mission, primary need, problem description, systems, timeline). On submit it runs [`routeScoutIntake`](src/lib/scoutRouting.ts) and writes one `scoutIntakes/{id}` document with both the raw answers and the computed routing result; the applicant only ever sees a generic confirmation screen.
- **`scout/ScoutReviewQueue.tsx`** — admin-only queue (Pending/Reviewed tabs) showing each intake's assigned bucket, confidence, rationale, readiness scores, and flags, with **Approve / Edit / Reject & Redirect** actions that finalize a bucket and mark the intake reviewed.

### Data Access (`src/lib/firebase.ts`)

Initializes the Firebase app from [firebase-applet-config.json](firebase-applet-config.json) and exports `auth` and `db` (Firestore) singletons. Also exposes `handleFirestoreError`, a shared error handler that enriches thrown Firestore errors with the operation type, document path, and current auth context before logging/re-throwing — used by every read/write call site in the dashboard and business portal.

### Domain Model (`src/types.ts`)

- **`Business`** — `{ id, name, type: 'small_business' | 'nonprofit', ein?, industry?, ownerId, certified, address?, createdAt }`
- **`Engagement`** — `{ id, businessId, ownerId, stage, status, notes?, budget_amount?, hackathon_project?, updatedAt }`, where `stage` is one of the six roadmap stages and `status` is `pending | in_progress | completed`
- **`UserProfile`** — `{ id, email, displayName?, role: 'client' | 'admin', createdAt }`
- **`ScoutIntake`** — intake answers + Scout's routing output + review decision in one document; see the Scout section below for the full shape

The same shapes are mirrored as JSON Schema for the Firebase applet in [firebase-blueprint.json](firebase-blueprint.json).

### Scout — intake & routing agent (`src/lib/scoutRouting.ts`, `src/components/scout/`)

Scout is a triage agent: prospective nonprofits/small businesses apply via a public form, and Scout assigns each application a **bucket** (`Data Infrastructure`, `Analytics & Insight`, `ML / Predictive`, `Tooling & Automation`, `Advisory / Strategy`), a **confidence** level, and an independent **engagement readiness** signal (point-of-contact availability, problem clarity, data foothold — each 1–3, rolled into `Ready | Conditional | Not Ready`), before routing to a human-review queue. `scout-design.md` and `scout-build-spec.md` (repo root) are the original design/build specs, written against a Tally + n8n + Airtable + Anthropic API pipeline; this app implements the same intake → bucket-routing → human-review logic natively instead, since none of that external stack exists in this repo.

`routeScoutIntake()` in [`src/lib/scoutRouting.ts`](src/lib/scoutRouting.ts) is a **deterministic stand-in** for the real Claude call the spec describes (no Anthropic API key is wired up yet) — it implements the same Q6-default → Q7-cross-check → Q5/Q8-tiebreaker bucketing logic and the same 8-field output shape (`bucket`, `confidence`, `rationale`, `poc_score`, `clarity_score`, `foothold_score`, `composite_signal`, `flags`), plus one derived routing field, `hitlTier: 'L2' | 'L3'` (high confidence + Ready → `L2`, everything else → `L3`). Swapping in a real API call later is meant to be a drop-in replacement behind this same function signature — and should move server-side (a Cloud Function) at that point, since a client bundle can't hold a secret API key.

Everything (raw answers + Scout's output + the eventual human review decision) lives in one Firestore collection, `scoutIntakes/{id}` — see [`ScoutIntake`](src/types.ts) for the full field list. This intentionally does not create a `Business`/`Engagement` record automatically; converting an approved application into an onboarded client account would need an invite/claim flow, which isn't built here.

### Firestore Security (`firestore.rules`)

Default-deny rules scoped per collection:

- **`users/{userId}`** — a user may only read/write their own profile; `role` is immutable after creation and only `displayName`/`updatedAt` can be patched.
- **`businesses/{businessId}`** — owner-scoped read/list/update/delete; `ownerId` must match `request.auth.uid` on create and cannot be changed afterward.
- **`engagements/{engagementId}`** — owner-scoped, and creation requires the referenced `businessId` to already exist (atomic guarantee against orphaned engagements). A `completed` engagement cannot be reverted to an earlier status (terminal-state lock).
- **`scoutIntakes/{intakeId}`** — the one public-write collection: any unauthenticated client can `create` an intake (shape/enum/length-validated), but `get`/`list`/`update` are staff-only (`role == 'admin'`, checked via a `get()` lookup on the requester's `users/{uid}` doc). `update` is further locked to only the review-decision fields. Because the routing result is computed client-side and written in the same unauthenticated `create`, a motivated actor could forge a bucket/confidence Scout never actually produced — an accepted gap for a stub with no auto-send action behind it, and one more reason the real routing call needs to move server-side.

The threat model behind these rules (identity spoofing, privilege escalation, orphaned records, resource exhaustion, etc.) is documented in [security_spec.md](security_spec.md).

## Project Structure

```
├── src/
│   ├── App.tsx                        # Router, navbar, footer, auth state, role, demo mode
│   ├── main.tsx                       # React root
│   ├── index.css                      # Tailwind entry + design tokens
│   ├── types.ts                       # Business / Engagement / UserProfile / ScoutIntake types
│   ├── lib/
│   │   ├── firebase.ts                # Firebase app/auth/db init + error handling
│   │   └── scoutRouting.ts            # Scout's stub bucket/readiness routing algorithm
│   └── components/
│       ├── auth/Login.tsx             # Sign-in / register / demo mode
│       ├── dashboard/Dashboard.tsx    # Business list + registration
│       ├── business/BusinessPortal.tsx# Per-business engagement workspace
│       └── scout/
│           ├── ScoutIntakeForm.tsx    # Public intake form (/apply)
│           └── ScoutReviewQueue.tsx   # Admin review queue (/scout/review)
├── firestore.rules                    # Firestore security rules
├── firebase-applet-config.json        # Firebase project config (consumed by lib/firebase.ts)
├── firebase-blueprint.json            # JSON Schema for Business/Engagement/User entities
├── security_spec.md                   # Data invariants + attack-vector checklist
├── design.md                          # Portable design system spec (colors, type, components)
├── scout-design.md                    # Scout agent design spec (original Tally/n8n/Airtable plan)
├── scout-build-spec.md                # Scout agent build spec (original Tally/n8n/Airtable plan)
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
