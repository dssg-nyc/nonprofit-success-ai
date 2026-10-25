# Supabase

Postgres schema, RLS policies, and the pgTAP suite that verifies them. The schema is a
port of `reference/firestore.rules` — see [reference/README.md](reference/README.md).

**Status:** the schema is real and verified, and the app runs on it — the Firebase
migration is complete. `src/lib/supabase.ts` is the anon client; `src/observability/recorder.ts`
holds the only service-role client. Both are typed by the generated
`src/lib/database.types.ts`.

## Local stack

Requires Docker running (`open -a Docker`).

```bash
make db-start     # boot the stack, apply all migrations
make db-status    # URL + keys
make db-test      # pgTAP suite (tests/*.test.sql, one transaction each; fails if zero run)
make db-types     # regenerate src/lib/database.types.ts after a migration
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

`studio` and `analytics` are disabled in `config.toml` (2026-08-21): their containers
failed health checks on this machine and neither is needed for schema work. `storage` is
enabled (nothing uses it yet). `[db.seed]` loads the Salesforce stand-in
(`migrations/reference/salesforce/schema.sql`, `seed.sql`) and then the git-ignored `seed.sql` on
every `db reset` (see "Local data" and "The Salesforce stand-in" below); the pgTAP suite
seeds its own rows inside each test transaction, and only `salesforce.test.sql` needs the
stand-in schema. `[api].schemas` exposes `salesforce` so the intake route can reach it. Re-enable Studio if you want the UI on :54323.

## Local data

`supabase/seed.sql` gives the local stack the team's staff accounts and the DSSG NYC
organization, and nothing else. It is **git-ignored** and not tracked in any form: it
holds teammates' email addresses and a working password, which do not belong in the repo
(the hosted project, when it exists, is seeded by real sign-ups — `supabase db push`
never runs a seed). Get the file from a teammate, drop it at `supabase/seed.sql`, and
every `make db-reset` loads it; `make db-seed` applies it to the running stack without a
reset. Without the file, `make db-reset` still works and writes an empty placeholder, so
the stack comes up with no accounts until you add it.

What the file does, so you can read or extend it: one `seed_accounts` temp table with
`(id, email, full_name, org_role)` per teammate and a `\set seed_password` at the top;
inserts into `auth.users` (bcrypt password, confirmed email, empty-string token columns
GoTrue requires) and `auth.identities`; `handle_new_user()` creates each `public.users`
profile as `client`; the seed then lifts the immutability trigger as the database owner
and sets `role = 'admin'` — the operator step a real admin goes through — and makes each
account a member of the organization, which is what `is_admin()` reads. Every insert is
`on conflict do nothing`, so applying it twice is a no-op.

The file's rows point at the stand-in's fixed ids (`001DS0000000000AAA` is DSSG NYC's
Account): the app tables hold no names or emails (NPS #28), only Salesforce ids.

There is deliberately no partner data in the seed: submit the public intake form, review
it in the queue and approve it, so what the UI shows locally is what a real flow produced.
Google sign-in stays disabled locally; use the email form. The pgTAP fixtures
(`tests/_shared/fixtures.psql`) are the only checked-in rows, and they roll back with each
test file.

## The Salesforce stand-in

`migrations/reference/salesforce/` is a **local-only** model of the Salesforce org the integration (NPS #52)
will talk to: a `salesforce` Postgres schema with the objects the portal needs (`account`,
`contact`, `account_contact_relation`, `campaign`, `gift_transaction`,
`volunteer_initiative`, `volunteer_assignment`) and their real id shapes (`001` Account,
`003` Contact, …), plus fictional seed rows at fixed ids. It is not a migration: the CLI
loads it as seed data, so `supabase db push` never sends it to a hosted project.

The split it enforces is the point of #28. **Salesforce owns people and organizations**
— names, emails, phones, addresses; **Supabase owns workflow** and refers to them by id:
`users.salesforce_contact_id`, `organizations.salesforce_account_id`,
`businesses.salesforce_account_id`, `scout_intakes.salesforce_account_id` /
`salesforce_contact_id` (all the `salesforce_id` domain, 0001_core).

Every stand-in table is closed to `anon` and `authenticated`; two definer RPCs are the
only doors, and `api/_salesforce.ts` is the only caller in the app:

| RPC | Caller | Does |
|---|---|---|
| `salesforce.upsert_applicant(org, ein, name_role, email)` | intake route (anonymous session) | Stage one of #52: unverified Account by EIN (else name), primary Contact by email; idempotent; returns `{account_id, contact_id}` |
| `salesforce.get_contacts(ids[])` | staff (`is_admin()`) | Reads Contacts back by id — the review queue's "who applied", until the real read path exists |

When the integration lands, `_salesforce.ts` switches to the Salesforce REST API under a
server-side integration user and this folder is deleted — it lives under `reference/` because it is temporary. Until then the
hosted project has no `salesforce` schema, so a hosted intake answers 502
`salesforce_unavailable`.

## Hosted project

Not provisioned yet — tracked in #27. To create one:

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
   Environment Variables.
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
| **service_role** | **never `VITE_`** | Server-side only. **Bypasses RLS entirely** — but not table privileges, which is how `agent_runs`/`tool_calls`/`audit_events` stay append-only even for it. |

The one consumer is `src/observability/recorder.ts`, reading `SUPABASE_SERVICE_ROLE_KEY`
(server-only env, `/api` functions). Locally, `npx supabase status` prints it; never write
it into a tracked file.

## Google sign-in

`src/components/auth/Login.tsx` offers Google sign-in (`signInWithOAuth`, a redirect), but
`config.toml`'s `[auth.external.google]` block is disabled and unconfigured — the button
fails until the provider is configured:

1. Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID (Web)
2. Authorized redirect URIs:
   - `https://<project-ref>.supabase.co/auth/v1/callback`
   - `http://127.0.0.1:54321/auth/v1/callback` (local)
3. Client id into `config.toml`; secret into `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`
4. Hosted project: the same pair under **Authentication → Providers → Google**

Note this is a *different* Google Cloud project from the Firebase one — that one belongs to
the account that generated the app in AI Studio, which is not ours to configure.

## Migrations

Numbered `NNNN_<name>.sql` and applied in numeric order. The original nineteen files
(0001–0019, one per issue) were squashed on 2026-10-08 into six that read as a schema
rather than a changelog; nothing has been pushed to a hosted project, so there was no
history to preserve. `0001_core.sql` keeps the `-- rules:NN` citations (about a hundred) into
`reference/firestore.rules`. The post-squash `0007`–`0011` were folded into one
`0007_scout.sql` on 2026-10-25 (NPS #28, still nothing pushed), when the PII columns came
out of the schema; the originals are in `reference/archived/`.

| File | What it adds |
|---|---|
| `0001_core.sql` | Enums; `users`, `organizations`, `organization_members`, `businesses`, `engagements`, `agent_runs`, `tool_calls`, `scout_intakes` (with routing provenance), `architect_assessments`; `user_org_ids()` / `is_admin()` (authenticated only); `handle_new_user()` provisioning; every immutability / transition / review-only trigger; RLS, policies and revoke-first grants |
| `0002_approvals.sql` | `approvals` (idempotency key, `draft_id`, reviewer must name themself), `audit_events` — the approval spine |
| `0003_delivery.sql` | `engagement_events` (`detail` jsonb, `approval_id`), `milestones`, `tasks`, `documents` — provenance only, no retrieval |
| `0004_drafts.sql` | `communications`, `chronicle_drafts`, `lessons`, `promoted_lessons`; `submit_architect_draft()`, `submit_envoy_draft()`, `submit_chronicle_draft()`, `derive_engagement_outcome()`, `promote_lesson()` — each draft lands beside a pending L3 approval in one transaction |
| `0005_lifecycle.sql` | `current_engagement_stage()`, `transition_engagement()` — the only stage writer; guards, L3 approval row, `stage_advanced` / `stage_reverted` events |
| `0006_views.sql` | `agent_run_metrics` (Q5 errors, latency, cost, override rate per agent per day), `provenance_chain` — the §7 reconstruction query |
| `0007_scout.sql` | `submit_scout_intake()` — the only writer of `scout_intakes`, derives `hitl_tier` from the Scout run, files the registry record and the applicant's Salesforce ids; `check_model_budget()` per-user hourly model-call limit; `approve_scout_intake()` — the one writer of `businesses.scout_intake_id` (and the business's `salesforce_account_id`), opens the pipeline through `transition_engagement()`, `p_reopen` re-reviews a declined intake. (`needs_info`, `businesses_select_admin` and the registry columns, once 0009–0011, now sit in 0001_core) |

Nineteen tables, RLS enabled and forced on every one; every id defaults to
`gen_random_uuid()`. Every `organization_id` references `organizations`, and admin reads
on telemetry and approvals are scoped to the caller's orgs via `user_org_ids()`.

### Tables by cluster

The files above are a history: the CLI applies `migrations/*.sql` flat, in numeric order,
so the folder cannot be laid out by subject. This is the map of what the schema holds
today, by the kind of data each table carries. Every table is the portal's own
operational data. Nothing that identifies a person is: names, emails, phones and
addresses live in Salesforce and the tables hold `salesforce_*_id` references (see "The
Salesforce stand-in" above).

| Cluster | Tables | Owned by | Trust posture |
|---|---|---|---|
| **Identity and tenancy** | `users`, `organizations`, `organization_members` | 0001 | Provisioned by Auth (`handle_new_user()`); `users.role` immutable to every API role. Access model to be replaced by C1 (below) |
| **Partner pipeline** | `businesses`, `engagements`, `engagement_events`, `milestones`, `tasks`, `documents` | 0001, 0003, 0005, 0007 | Partner-owned rows, org-scoped staff reads; stage changes only through `transition_engagement()`, pipeline entry only through `approve_scout_intake()` |
| **Agent output** | `scout_intakes`, `architect_assessments`, `communications`, `chronicle_drafts`, `lessons`, `promoted_lessons` | 0001, 0004, 0007 | Written only by the `submit_*` definer functions, each beside a pending L3 approval; review-only updates by staff |
| **HITL spine and provenance** | `approvals`, `audit_events`, `agent_runs`, `tool_calls` | 0001, 0002 | Append-only; `agent_runs` written by the recorder's service role alone; the `provenance_chain` view (0006) reconstructs a decision from these |
| **Plumbing** | `model_call_budget`; views `agent_run_metrics`, `provenance_chain` | 0006, 0007 | No role reads or writes the budget table directly; views are `security_invoker` |

When a second kind of data lands it gets its own Postgres schema rather than more tables
in `public`: the knowledge base (`knowledge.md`, D37 — public sources such as filings,
chunked and embedded) as `knowledge`. The CRM already has one: `salesforce`, the
local stand-in above, which is the shape a sync (D35) would land in. A schema is the
boundary RLS and grants are easiest to reason about per data type, and it keeps the
public-source cluster's "everyone reads" posture from ever sharing a policy file with
partner records.

Invariants the squash settled, so nobody has to rediscover them:

- **Stage changes have one door.** `transition_engagement()` is the only writer of
  `engagements.stage`/`status`; partners hold no UPDATE at all. The terminal lock
  (`completed` never reopens) and the `businesses.scout_intake_id` lock key on the
  session role: refused for `anon`, `authenticated` and `service_role`, passed for a
  `SECURITY DEFINER` function (which runs as its owner). There is no session setting a
  client could flip.
- **`service_role` bypasses RLS, not privileges.** `agent_runs`, `tool_calls` and
  `audit_events` are append-only for it too; `approvals` it can insert and update, never
  delete. `0001_core` revokes Supabase's default grants before stating each table's own.
- **Review cannot rewrite the record.** The `scout_intakes` review-only trigger locks
  every applicant field and the routing provenance columns.
- **`engagement_events.detail` is a jsonb object** (check constraint). A note is
  `{"text": ...}`; a transition carries `{from, to, reason, guard_deferred, approval_id,
  evidence}`.

### The access model is wrong — the brief for C1 — and it blocks hosting

`0001_core` scopes access by **organization**, granting org staff access to every row in
their org. The decided model ([access-model.md](../.claude/specs/db/access-model.md))
scopes volunteers by **project assignment**, with three roles (`client`/`diplomat`/`admin`)
rather than the schema's `owner`/`admin`/`member`.

Under the current model a volunteer added to the DSSG organization with the only role
that grants any engagement read (`admin`) sees **every client engagement** — the opposite
of the intent. The suite pins exactly this in the assertion labelled
`KNOWN WRONG — 0001_core model, replaced by C1`; the rewrite should flip it deliberately.
`documents` (`0003_delivery`) has the same overreach for plain members: any org member
reads, writes and deletes every document in the org, commented as `KNOWN OVERREACH` in
the migration.

**Do not push this schema to a hosted project before C1 lands.** It is applied locally so
the whole schema can be tested and redesigned; it needs rewriting, not just unblocking
([access-model.md](../.claude/specs/db/access-model.md) § Sequencing). Worth salvaging:
the `SECURITY DEFINER` helper pattern (`user_org_ids()`). Policies checking membership
must use a definer function or they recurse through the membership table's own policies.
The replacement needs the same shape over a project-membership table.

After any migration, run `make db-types` and commit the regenerated
`src/lib/database.types.ts` with it, or the typed client drifts from the schema.

Migrations are append-only once pushed to a hosted project — to change the schema, add a
new numbered file rather than editing an applied one. Until the first `db push`, the
squashed files may still be edited in place; after it, take the next free number.

## Tests

`tests/*.test.sql` — the pgTAP suite, split by area, each file its own transaction:

| File | Covers |
|---|---|
| `_shared/fixtures.psql` | Opens the transaction; pgTAP, the `tests` helper schema and every seed row. Included by each file with `\ir`; the `.psql` extension keeps `supabase test db` from running it alone |
| `core.test.sql` | Provisioning, default deny, every `0001_core` table and trigger, the routine-privilege allow-lists, routing provenance, `submit_scout_intake()` / `check_model_budget()` |
| `spine.test.sql` | Telemetry, approvals, audit events, milestones / tasks, documents, `agent_run_metrics` |
| `rpcs.test.sql` | The draft commands, `transition_engagement()`, lessons, `provenance_chain` — blocks that build on each other's rows |
| `salesforce.test.sql` | The stand-in's boundary: no direct table reads, `upsert_applicant()` idempotency and name/title split, `get_contacts()` admin-only. Needs `migrations/reference/salesforce/schema.sql` loaded (every `db reset` / `db start` does) |

It documents what the schema does today, including the org model (see above), not what
C1 will make it. Every row count is scoped to fixture ids, so rows left in the local
database by other work (an eval run's `agent_runs`, say) cannot change a result.
`make db-test` fails when there is no `tests/*.test.sql` file or when zero assertions
ran, so a moved or renamed suite cannot report green. After `make db-reset`, wait for the
auth container to finish its own migrations before the first run (a few seconds), or the
fixtures fail on `auth.users.is_anonymous`.

## Port conflicts

The stack binds 54321/54322. If another project's Supabase stack already holds them, run
against a copy of `supabase/` with shifted ports instead of stopping it:

```bash
make db-start SUPABASE_WORKDIR=/path/to/dir/containing/supabase
```

Every `db-*` target honours `SUPABASE_WORKDIR`.
