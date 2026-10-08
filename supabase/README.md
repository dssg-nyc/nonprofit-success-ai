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
enabled (nothing uses it yet). `[db.seed]` is disabled: there is no `seed.sql`, and the
pgTAP suite seeds its own rows inside each test transaction. Re-enable Studio if you want
the UI on :54323.

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
`reference/firestore.rules`. `0007` is the first post-squash migration.

| File | What it adds |
|---|---|
| `0001_core.sql` | Enums; `users`, `organizations`, `organization_members`, `businesses`, `engagements`, `agent_runs`, `tool_calls`, `scout_intakes` (with routing provenance), `architect_assessments`; `user_org_ids()` / `is_admin()` (authenticated only); `handle_new_user()` provisioning; every immutability / transition / review-only trigger; RLS, policies and revoke-first grants |
| `0002_approvals.sql` | `approvals` (idempotency key, `draft_id`, reviewer must name themself), `audit_events` — the approval spine |
| `0003_delivery.sql` | `engagement_events` (`detail` jsonb, `approval_id`), `milestones`, `tasks`, `documents` — provenance only, no retrieval |
| `0004_drafts.sql` | `communications`, `chronicle_drafts`, `lessons`, `promoted_lessons`; `submit_architect_draft()`, `submit_envoy_draft()`, `submit_chronicle_draft()`, `derive_engagement_outcome()`, `promote_lesson()` — each draft lands beside a pending L3 approval in one transaction |
| `0005_lifecycle.sql` | `current_engagement_stage()`, `transition_engagement()` — the only stage writer; guards, L3 approval row, `stage_advanced` / `stage_reverted` events |
| `0006_views.sql` | `agent_run_metrics` (Q5 errors, latency, cost, override rate per agent per day), `provenance_chain` — the §7 reconstruction query |
| `0007_scout_intake_and_budget.sql` | `submit_scout_intake()` — the only writer of `scout_intakes`, derives `hitl_tier` from the Scout run; `check_model_budget()` per-user hourly model-call limit |

Nineteen tables, RLS enabled and forced on every one; every id defaults to
`gen_random_uuid()`. Every `organization_id` references `organizations`, and admin reads
on telemetry and approvals are scoped to the caller's orgs via `user_org_ids()`.

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
