# Supabase

Schema, migration workflow, and client usage for the Postgres/Auth/RLS/Realtime layer
that fully replaced Firebase/Firestore ([design-system.md](../design-system.md) §1).
For the security model built on top of this schema — invariants, RLS policies, the
attack-vector checklist — see [security.md](security.md), which is the authoritative
doc for *why* the policies below exist. This doc covers *what the schema is* and *how
to work with it day to day*.

## Schema

Five core tables, defined in [`supabase/migrations/0001_init.sql`](../../../supabase/migrations/0001_init.sql),
translated from the forked portal's `firestore.rules`. See
[design-system.md](../design-system.md) §4 for the full ER diagram and authorization
semantics summary (self-scoping, owner-scoping, public intake, admin-only, terminal-status
lock).

| Table | Purpose |
|---|---|
| `users` | Mirrors `auth.users`; `role` is immutable after insert. |
| `businesses` | Owned by a single user (`owner_id`); immutable after insert. |
| `engagements` | Belongs to a `business`; carries `stage`/`status`, with a terminal-state lock once `completed`. |
| `scout_intakes` | Public-insertable intake form rows; admin-only read. |
| `architect_assessments` | Shares its primary key with the `scout_intakes` row it assesses; admin-only. |

Later migrations add `engagement_events` (staff access), `agent_runs` + `tool_calls`
(telemetry: append-only for every API role, service-role included; no raw model I/O) and
`approvals` + `audit_events` (approval spine), then `milestones` + `tasks` (0006),
`documents` (0007), `communications` + `chronicle_drafts` (0012) and `lessons` (0015) —
18 tables through 0019. `organization_id` on `agent_runs`, `approvals` and `audit_events`
is a nullable FK to `organizations` (0004:28, 0005:16, 0005:34); the access-model rewrite
(C1) re-scopes it. See [`supabase/README.md`](../../../supabase/README.md) for the full list.

## Migrations

- Source of truth: [`supabase/migrations/`](../../../supabase/migrations/), numbered
  `NNNN_<name>.sql` and applied in numeric order
  (`0001_init.sql`, ...). The pgTAP extension and `tests` schema are created inside
  `supabase/tests/rls.test.sql`'s transaction, not in a migration. Create one by hand with the next free
  number (`supabase migration new` would produce a timestamp name).
- Local dev and CI apply migrations against a local Supabase instance via the Supabase
  CLI (`supabase/config.toml` holds local ports/auth-provider config — no remote project
  is linked from this repo; deploying schema changes to the hosted project is a manual,
  out-of-band step, not automated here).
- New migrations are additive files, not edits to an applied one — once a migration has
  shipped, changes are a new numbered file.
- After any migration, `make db-types` regenerates `src/lib/database.types.ts`; commit it
  in the same change.

## Client usage

[`src/lib/supabase.ts`](../../../src/lib/supabase.ts) is the single anon client instance,
typed as `createClient<Database>` from the generated `src/lib/database.types.ts`. The one
other `createClient` call is the service-role client in `src/observability/recorder.ts`
(server-only, never exported). Conventions inherited from
[CLAUDE.md](../../../CLAUDE.md):

- The client is initialized with the **anon key** only — this is safe to ship to the
  browser because RLS (not key secrecy) is the authorization boundary. The service role
  key, which bypasses RLS, is never used client-side and never reaches `VITE_`-prefixed
  env vars.
- Every table access from `src/components/**` and `src/lib/**` goes through this client;
  the recorder's service-role client is the only other instance in `src/`.
- Realtime subscriptions (`postgres_changes`) respect RLS — a non-admin subscriber to an
  admin-only table sees silence, not an error. This is the failure mode to watch when
  porting or debugging the portal's realtime listeners (see
  [security.md](security.md) §Realtime note).

## Local dev and testing

- `make db-test` (wrapping `supabase test db`) runs
  [`supabase/tests/rls.test.sql`](../../../supabase/tests/rls.test.sql) — pgTAP tests
  exercising the policies and triggers directly against Postgres, not an emulator. It
  fails when no `*.test.sql` file exists or zero assertions ran.
- Local dev requires a running local Supabase stack (`supabase start`); ports and auth
  providers are configured in `supabase/config.toml`.

## Requirement Trace

| Requirement | Source | Now at | Status |
|---|---|---|---|
| Full replacement of Firebase/Firestore | `design-system.md:33` | §Schema | Carried |
| Five-table data model | `design-system.md` §4 | §Schema | Carried — this doc summarizes, design-system.md §4 is canonical |
| Anon key only, no service role client-side | `CLAUDE.md` Conventions ("No secrets reach the client") | §Client usage | Carried |
| Realtime silent-drop under RLS | `security.md` §Realtime note | §Client usage | Carried |
| RLS test runner | `security.md` §3 | §Local dev and testing | Carried |
