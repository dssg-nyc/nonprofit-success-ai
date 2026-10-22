# Supabase

Postgres schema, RLS policies, and the pgTAP suite that verifies them. The schema is a
port of `reference/firestore.rules` — see [reference/README.md](reference/README.md).

**Status:** the schema is real and verified; the app does not use it yet. Every screen in
`src/` still reads and writes Firestore. `src/lib/supabase.ts` exists and compiles but has
no callers.

## Local stack

Requires Docker running (`open -a Docker`).

```bash
make db-start     # boot the stack, apply all migrations
make db-status    # URL + keys
make db-test      # pgTAP RLS suite (81 assertions)
make db-reset     # drop and re-apply migrations from scratch
make db-stop      # shut down
```

`db-start` prints the local URL and anon key. Put them in `.env`:

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<the ANON_KEY it printed>
```

These local keys are fixed dev values, identical on every machine — not secrets. The
**hosted** project's keys are different, and its service-role key is a real secret.

`studio`, `storage`, and `analytics` are disabled in `config.toml` (2026-08-21): their
containers failed health checks on this machine and none is needed for schema work.
Re-enable individually if you want the Studio UI on :54323.

## Hosted project

Not provisioned yet. To create one:

1. https://supabase.com/dashboard → **New project**. Region `East US (North Virginia)`
   (nearest NYC, matches the Vercel deployment). Free tier. **Save the database password** —
   shown once, needed for `db push`.
2. Link and push the schema:
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```
3. **Project Settings → API** for the URL and keys.
4. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel → Settings →
   Environment Variables, alongside the existing `VITE_FIREBASE_*` ones.
5. **Authentication → URL Configuration**: set Site URL and the same redirect list that
   `config.toml`'s `additional_redirect_urls` carries. `config.toml` configures only the
   local stack; the hosted project does not read it.

Free tier: 500MB database, 50k monthly active users, and **projects pause after 7 days of
inactivity** — one click to restore, but it means a demo after a quiet week needs waking up
first.

## Keys, and which ones are dangerous

| Key | Prefix | Where it may live |
|---|---|---|
| anon / publishable | `VITE_` is fine | Browser. RLS constrains it — that is the whole design. |
| **service_role** | **never `VITE_`** | Server-side only. **Bypasses RLS entirely** — reads and writes every row in every table regardless of policy. |

There is nowhere to put a service-role key today: `/api` does not exist, and no server code
runs. Do not set it anywhere until a server function actually needs it — an unused secret
in an env file is pure risk with no benefit.

## Google sign-in

`config.toml` has an `[auth.external.google]` block, disabled and unconfigured. It has to be
set up before auth moves off Firebase, or the migration silently drops a login method that
`src/components/auth/Login.tsx` already offers.

1. Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID (Web)
2. Authorized redirect URIs:
   - `https://<project-ref>.supabase.co/auth/v1/callback`
   - `http://127.0.0.1:54321/auth/v1/callback` (local)
3. Client id into `config.toml`; secret into `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`
4. Hosted project: the same pair under **Authentication → Providers → Google**

Note this is a *different* Google Cloud project from the Firebase one — that one belongs to
the account that generated the app in AI Studio, which is not ours to configure.

## Migrations

| File | What it adds |
|---|---|
| `0000_test_helpers.sql` | pgTAP helpers used only by the test suite |
| `0001_init.sql` | `users`, `businesses`, `engagements`, `scout_intakes`, `architect_assessments` — the firestore.rules port |
| `0002_staff_engagement_access.sql` | `engagement_events`; staff access paths |
| `0003_tenancy.sql` | `organizations`, `organization_members` |
| `0004_telemetry.sql` | `agent_runs`, `tool_calls` |
| `0005_approval_spine.sql` | `approvals`, `audit_events` |
| `0006_delivery.sql` | `milestones`, `tasks` |
| `0007_documents.sql` | `documents` with provenance |

15 tables, RLS enabled on every one, 81 passing RLS assertions.

Migrations are append-only once pushed to a hosted project — to change the schema, add a new
numbered file rather than editing an applied one.
