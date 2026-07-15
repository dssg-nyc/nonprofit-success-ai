# DSSG Success Portal

A customer success portal for NYC small businesses and nonprofits to track their engagement lifecycle with **DSSG NYC** (Data Science for Social Good), from initial meeting through membership close.

Client organizations register their business/nonprofit profile, then move it through a five-stage engagement roadmap while DSSG staff and the client collaborate on notes, budget, and hackathon deliverables in real time.

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
| `/` | — | redirects to `/dashboard` or `/login` |

### Components (`src/components`)

- **`auth/Login.tsx`** — email/password sign-in and registration, Google OAuth popup sign-in, and a "Demo Mode" entry point. New registrations write a `users/{uid}` profile document with `role: 'client'`.
- **`dashboard/Dashboard.tsx`** — lists the signed-in user's registered businesses/nonprofits (live Firestore `onSnapshot` query filtered by `ownerId`), shows portfolio stats, and lets the user register a new business via a modal form.
- **`business/BusinessPortal.tsx`** — the per-business workspace. Renders a bento-grid layout showing the business profile, a 5-stage engagement roadmap (`initial_meeting → budgeting → engagement_tracking → hackathon → membership_close`), a live activity feed of engagement records, and stage-management controls (status toggle + notes) that upsert an `engagements/{businessId}_{stage}` document per stage.

### Data Access (`src/lib/firebase.ts`)

Initializes the Firebase app from [firebase-applet-config.json](firebase-applet-config.json) and exports `auth` and `db` (Firestore) singletons. Also exposes `handleFirestoreError`, a shared error handler that enriches thrown Firestore errors with the operation type, document path, and current auth context before logging/re-throwing — used by every read/write call site in the dashboard and business portal.

### Domain Model (`src/types.ts`)

- **`Business`** — `{ id, name, type: 'small_business' | 'nonprofit', ein?, industry?, ownerId, certified, address?, createdAt }`
- **`Engagement`** — `{ id, businessId, ownerId, stage, status, notes?, budget_amount?, hackathon_project?, updatedAt }`, where `stage` is one of the five roadmap stages and `status` is `pending | in_progress | completed`
- **`UserProfile`** — `{ id, email, displayName?, role: 'client' | 'admin', createdAt }`

The same shapes are mirrored as JSON Schema for the Firebase applet in [firebase-blueprint.json](firebase-blueprint.json).

### Firestore Security (`firestore.rules`)

Default-deny rules scoped per collection:

- **`users/{userId}`** — a user may only read/write their own profile; `role` is immutable after creation and only `displayName`/`updatedAt` can be patched.
- **`businesses/{businessId}`** — owner-scoped read/list/update/delete; `ownerId` must match `request.auth.uid` on create and cannot be changed afterward.
- **`engagements/{engagementId}`** — owner-scoped, and creation requires the referenced `businessId` to already exist (atomic guarantee against orphaned engagements). A `completed` engagement cannot be reverted to an earlier status (terminal-state lock).

The threat model behind these rules (identity spoofing, privilege escalation, orphaned records, resource exhaustion, etc.) is documented in [security_spec.md](security_spec.md).

## Project Structure

```
├── src/
│   ├── App.tsx                        # Router, navbar, footer, auth state, demo mode
│   ├── main.tsx                       # React root
│   ├── index.css                      # Tailwind entry + design tokens
│   ├── types.ts                       # Business / Engagement / UserProfile types
│   ├── lib/
│   │   └── firebase.ts                # Firebase app/auth/db init + error handling
│   └── components/
│       ├── auth/Login.tsx             # Sign-in / register / demo mode
│       ├── dashboard/Dashboard.tsx    # Business list + registration
│       └── business/BusinessPortal.tsx# Per-business engagement workspace
├── firestore.rules                    # Firestore security rules
├── firebase-applet-config.json        # Firebase project config (consumed by lib/firebase.ts)
├── firebase-blueprint.json            # JSON Schema for Business/Engagement/User entities
├── security_spec.md                   # Data invariants + attack-vector checklist
├── design.md                          # Portable design system spec (colors, type, components)
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
