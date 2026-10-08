# Environments — local, staging, production

**Status:** production is live; the hosted Supabase projects (staging and prod) are
tracked in #27 (Jian). This describes the intended shape and what is missing.

## The three environments

| | Local | Staging (Preview) | Production |
|---|---|---|---|
| **Frontend** | `npm run dev` on :3000 | Vercel Preview — per-PR URL | `nonprofit-success-ai-chi.vercel.app` |
| **Trigger** | you | any pull request | push to `main` |
| **Database** | local Docker stack | **hosted Supabase — staging project** | **hosted Supabase — prod project** |
| **Data** | disposable, `make db-reset` | seeded / test data | real partner data |
| **Vercel scope** | `Development` | `Preview` | `Production` |

Vercel's three scopes are the mechanism — no separate hosting setup is needed. A variable
set to `Preview` reaches every preview deploy; one set to `Production` reaches only `main`.

## Two Supabase projects, not one

**Staging and production must not share a database.** A preview deploy runs unreviewed code
from a branch; pointing it at production means an untested migration or a bad write reaches
real partner data. Two free-tier projects cost nothing.

Name them `nonprofit-success-ai-staging` and `nonprofit-success-ai-prod`. Each has its own
URL and keys, so the same variable names carry different values per Vercel scope:

```
VITE_SUPABASE_URL         Development -> http://127.0.0.1:54321
                          Preview     -> https://<staging-ref>.supabase.co
                          Production  -> https://<prod-ref>.supabase.co
VITE_SUPABASE_ANON_KEY    (the matching anon key per scope)
```

## Migrations across environments

Migrations are append-only once applied. The path is one-directional:

```
local (make db-reset, free to redo)
  -> staging (supabase db push, verify against test data)
    -> production (supabase db push, only after staging proves it)
```

Never push a migration to production that has not run on staging. Linking switches which
project `db push` targets:

```bash
npx supabase link --project-ref <staging-ref>
npx supabase db push
```

## What is missing

1. **The hosted projects** — staging and prod Supabase, their Vercel env values and the
   CD secrets — are tracked in #27 (Jian). Until they land, only the local stack has a
   database behind it.
2. **`cd.yml` deploys from the workflow, not Vercel's Git integration** (disabled: Settings
   -> Git -> Ignored Build Step). It triggers on `pull_request` and on push to `main`, calls
   `ci.yml` as a reusable workflow (`workflow_call`), and deploys only after it passes — a
   preview deploy on PRs, `--prod` on `main`. Previews read the `Preview` scope, so they
   need #27's staging values to have a database.
3. **Auth redirect URLs** must be registered per environment — a staging Supabase project
   needs the preview URLs in Authentication -> URL Configuration, and preview URLs change
   per PR.

## Current reality, stated plainly

Right now there is **one** environment that fully works: local. The Firebase-to-Supabase
migration is complete in code — auth and every component are on Supabase — but production
has a deployed frontend whose hosted Supabase project is tracked in #27 (Jian).

Do not treat the production URL as working software until a hosted project is behind it
and its migrations are pushed (#28).
