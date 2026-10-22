# Security Specification

**Status:** PARTIAL — the invariants below are implemented and applied; the pgTAP suite
that verifies them is **deferred and cannot run** (§3).
**Lane:** crm
**PRD sections:** §5.2, §5.3

Data invariants and the attack-vector checklist that motivates them, restated against the
**Supabase (Postgres + RLS)** model. Supersedes the Firestore-era `security_spec.md`, which
described the same invariants as `firestore.rules` predicates.

## Responsibility

Defines the authorization boundary: what a client may read and write, which columns are
immutable, and which attacks the schema is shaped to refuse. RLS is the authorization
layer; Postgres constraints are the correctness layer. Both, never either.

## Mechanism

Source of truth for the implementation is
[`0001_init.sql`](../../supabase/migrations/0001_init.sql), extended by
[`0002_staff_engagement_access.sql`](../../supabase/migrations/0002_staff_engagement_access.sql)
(staff read access to engagements, and the append-only `engagement_events` history) and
[`0008_user_provisioning.sql`](../../supabase/migrations/0008_user_provisioning.sql)
(server-side profile provisioning on signup).

**Applied migrations are 0000, 0001, 0002, 0008.** Numbers 0003–0007 exist on disk under
`supabase/migrations/_deferred/` and are **not applied** — every policy described here is
the owner-scoped model, not the organization-scoped one those files propose. See
[data-model.md](data-model.md) §1.

## Schema contract

Six tables, all with `ROW LEVEL SECURITY` **enabled and `FORCE`d**: `users`, `businesses`,
`engagements`, `scout_intakes`, `architect_assessments` (0001), `engagement_events` (0002).

**20 policies** are applied — 16 in 0001, 4 in 0002. **Seven** of them branch on
`is_admin()`: `scout_intakes_select_admin`, `scout_intakes_update_admin`,
`architect_assessments_select_admin`, `architect_assessments_insert_admin`,
`architect_assessments_update_admin` (0001), `engagements_select_admin`,
`engagement_events_select_admin` (0002).

`is_admin()` (`0001_init.sql:323`) is `stable security definer` with
`search_path = public, pg_temp` pinned, revoked from `public`, granted to `authenticated`.
It is the **single indirection** for role checks — no policy inlines `role = 'admin'`, so
re-pointing one function at a membership table later beats rewriting twenty policies.

Grants to `authenticated` — the outer gate, independent of policy:

| Table | Granted |
|---|---|
| `users` | `select, insert, update` — no delete |
| `businesses` | `select, insert, update, delete` |
| `engagements` | `select, insert, update, delete` |
| `scout_intakes` | `select, insert, update` — no delete |
| `architect_assessments` | `select, insert, update` — no delete |
| `engagement_events` | `select, insert` — **no update, no delete** |

`anon` holds exactly one grant: `insert on scout_intakes` (public intake).

## 1. Data Invariants

- A `businesses` row must specify an `owner_id` matching the creator's `auth.uid()`. Enforced
  by `businesses_insert_own`'s `WITH CHECK (owner_id = auth.uid())`, and made immutable after
  insert by the `businesses_enforce_immutable` trigger.
- An `engagements` row must reference an existing `businesses` row (a foreign key, not just a
  rule check) and have an `owner_id` matching the creator. Enforced by the FK on
  `engagements.business_id` plus `engagements_insert_own`'s `WITH CHECK`, which also confirms
  the referenced business belongs to the caller.
- Users can only read and write their own `businesses` and `engagements` rows — every SELECT/
  UPDATE/DELETE policy on both tables is scoped `owner_id = auth.uid()`. **One exception,
  added in 0002**: `engagements_select_admin` lets a caller whose `users.role = 'admin'`
  SELECT any engagement. It is read-only and admin-only — no corresponding admin INSERT/
  UPDATE/DELETE policy exists, so staff visibility does not become staff authorship. The
  `role` column's immutability (below) is what makes this policy safe to add: a client
  cannot elevate itself into it.
- An `engagement_events` row is **append-only**: once written, no client can change or
  remove it. Enforced twice over — there is no UPDATE or DELETE *policy* on the table, and
  the `authenticated` role is granted only `select, insert`. The grant is the outer gate,
  so an attempted UPDATE raises `42501` (insufficient privilege) rather than silently
  matching zero rows. History that can be rewritten is not history, and Pulse's health
  signals are only as trustworthy as the record they read.
- `engagement_events` rows are visible and writable only to a caller who owns the parent
  engagement (or, for reads, to an admin) — the policies join through
  `engagements.owner_id`, so event access can never outrun engagement access. An inserted
  event must also carry `created_by = auth.uid()`, so a caller cannot attribute an event
  to someone else; this mirrors the `architect_assessments` `created_by` check in 0001.
- The `role` column on `users` is immutable by the client once set, and locked from change by
  the `users_enforce_immutable` trigger (object name `users_enforce_immutable_trg`). Elevation
  to `'admin'` is an out-of-band operation performed with the service role, which bypasses RLS
  by design.
- **Every `public.users` row is created server-side, not by the client** (0008). The
  `on_auth_user_created` trigger on `auth.users` runs `handle_new_user()` —
  `security definer`, `search_path = public, pg_temp` pinned — which inserts the profile
  with `role` hard-coded to `'client'` and `on conflict (id) do nothing`. `display_name`
  comes from `raw_user_meta_data->>'full_name'` or `->>'name'`, so OAuth signups get a name
  and email/password signups get NULL.

  **This is now the live role-assignment mechanism.** `users_insert_self`'s
  `WITH CHECK (role = 'client')` still exists but is dead code on the normal signup path,
  because the definer function bypasses RLS entirely. The invariant holds either way — a
  client cannot self-assign `admin` — but it is enforced by the literal at
  `0008_user_provisioning.sql:38`, not by the policy.

  The bug this closes: under Firestore the *client* created the profile document, so any
  path that skipped that call (Google OAuth did) left an authenticated user with no profile
  row and therefore no role — and every RLS policy depends on the role.
- Timestamps are server-assigned (`now()` in table defaults and in every `updated_at`-touching
  trigger), never client-supplied — there is no Postgres equivalent of validating a client
  timestamp against `request.time` because the client cannot set one at all.
- **`scout_intakes` admits no draft review.** `scout_intakes_enforce_review_only()` rejects
  any UPDATE where `new.reviewed_by is distinct from auth.uid()` — which is true when
  `reviewed_by` is still NULL — and `scout_intakes_update_admin`'s `WITH CHECK` requires
  `review_status = 'reviewed'`. So a single admin UPDATE must set `review_status`,
  `review_action`, `final_bucket`, and `reviewed_by` together. An admin who edits only
  `review_notes` on an unreviewed row gets `check_violation` (23514). This constrains the
  review-queue UI: it submits one complete review, never a partial save.

## 2. The Dirty Dozen (Attack Vectors)

| # | Attack | Firestore-era defense | Supabase/RLS defense |
|---|---|---|---|
| 1 | **Identity Spoofing** — create a `businesses` row with someone else's `owner_id` | `request.auth.uid` check in `allow create` | `businesses_insert_own` policy `WITH CHECK (owner_id = auth.uid())` |
| 2 | **Resource Hijacking** — read/update another user's `engagements` row | owner-scoped `allow get/update` | `engagements_select_own` / `engagements_update_own` policies, both `USING (owner_id = auth.uid())`. Since 0002, `engagements_select_admin` widens **reads** for `role = 'admin'`; writes stay owner-only |
| 3 | **Privilege Escalation** — self-update `role: 'client'` → `role: 'admin'` | immutability rule on `role` | `users_enforce_immutable` trigger raises on any `role` change, for every writer including future ones |
| 4 | **Shadow Field Injection** — add an undeclared field (e.g. `is_verified: true`) to a `businesses` row | Firestore `hasOnly`/key-count checks | structurally impossible — Postgres has a fixed column list; an unknown key is a syntax/column error, not a smuggled field |
| 5 | **Orphaned Engagement** — create an `engagements` row for a non-existent `business_id` | existence check in rule logic | `engagements.business_id` foreign key (`references businesses (id)`) — the database itself refuses the insert |
| 6 | **Timeline Bypass** — revert a `completed` engagement to an earlier `status` | none in source rules (status updates unrestricted) | `engagements_enforce_transitions` trigger: `if old.status = 'completed' and new.status <> 'completed' then raise exception` — a stricter guarantee than the Firestore original had |
| 7 | **Resource Exhaustion** — send a 1MB string as a business `name` | none in source rules | `check (char_length(name) <= 256)` on `businesses.name`, and equivalent length `CHECK`s on **most** text columns. **Seven are unbounded** — see the gap note below |
| 8 | **Malicious ID** — supply a very long or special-character document ID | `isValidId()` regex (`^[a-zA-Z0-9_\-]+$`, <=128 chars) | not applicable — all primary keys are server-generated `uuid` (`uuid_generate_v4()`), so no client ever supplies an ID string |
| 9 | **PII Leak** — list all `users` rows to scrape emails | admin-only `list` | no `SELECT ... FOR ALL` policy on `users`; `users_select_self` scopes every SELECT to `id = auth.uid()`, and RLS is `FORCE`d so even the table owner role cannot bypass it |
| 10 | **State Corruption** — same as #6, listed separately in the source doc | terminal-state check | see #6 — one trigger covers both attack framings |
| 11 | **Timestamp Forgery** — send a client-side `updated_at` far in the past/future | validate against `request.time` | not applicable — `updated_at` is set server-side by every enforcement trigger (`new.updated_at := now()`), and no policy grants a client the ability to set it directly |
| 12 | **Unverified Account Write** — write data with an unverified email | conditional, `isEmailVerified()` was defined but never called | not ported — porting it would add an unenforced restriction the source never actually enforced (see `0001_init.sql`'s divergence note #3) |

**Gap — seven unbounded text columns.** Vector #7 is only partly closed. These have no
`char_length` CHECK, so any of them accepts an arbitrarily large string from a caller who
already passes RLS:

| Column | Migration |
|---|---|
| `businesses.address` | `0001_init.sql:139` |
| `engagements.notes` | `0001_init.sql:158` |
| `engagements.hackathon_project` | `0001_init.sql:160` |
| `scout_intakes.review_notes` | `0001_init.sql:219` |
| `scout_intakes.onboarding_kit` | `0001_init.sql:220` |
| `architect_assessments.cross_check_flag` | `0001_init.sql:298` |
| `engagement_events.detail` | `0002_staff_engagement_access.sql:73` |

Every one is admin- or owner-writable rather than public, so the exposure is bounded by
authentication — this is a hardening gap, not an open door. Closing it is milestone C6.

### 2a. Vectors with no Firestore-era counterpart

The Dirty Dozen is the inherited list, kept fixed so it stays traceable to
`security_spec.md`. Objects added after the port bring vectors that list never described;
they are recorded here rather than renumbered into it.

| Attack | Introduced by | Defense |
|---|---|---|
| **History Tampering** — edit or delete an `engagement_events` row to change what the record says happened, and so change Pulse's verdict | `engagement_events` (0002) | Append-only, enforced twice: no UPDATE/DELETE policy exists, *and* `authenticated` holds only `select, insert`. The missing privilege is the outer gate, so the attempt raises `42501` rather than matching zero rows |
| **Attribution Forgery** — append an event credited to another user | `engagement_events` (0002) | `engagement_events_insert_own`'s `WITH CHECK (created_by = auth.uid() and ...)` — the same shape as `architect_assessments`' `created_by` check |
| **Staff Overreach** — a read-only staff grant used to write | `engagements_select_admin` (0002) | The admin policy is `FOR SELECT` only; no admin INSERT/UPDATE/DELETE policy exists on `engagements`. Deliberate — granting one would resolve U5 (who writes `engagements.stage`) by accident rather than by decision |
| **Lifecycle Self-Advancement** — a partner org marks its own engagement `hackathon_ready` or `membership`, skipping the budget, ethics, and scoping gates | `engagements_insert_own` / `engagements_update_own` (0001), reachable today from `BusinessPortal.tsx:155-218` | **Open — no defense in force.** The owner-scoped write policies predate the state machine, so the subject of a gate is currently its own approver. Closed by [lifecycle.md](lifecycle.md) §8 item 4 (revoke `INSERT`/`UPDATE` on `engagements` from `authenticated`, leaving the transition command as sole writer); until then this is a known, dated gap, not an oversight |
| **Self-Elevation into staff read** — set `role = 'admin'` to reach every org's engagements | `engagements_select_admin` (0002) | Not a new hole: Dirty Dozen #3's `users_enforce_immutable` trigger already makes `role` client-immutable, which is the precondition that makes an admin-scoped policy safe to add at all |

**Privacy posture, not only a technical change**: `engagements_select_admin` makes
engagement data cross-org readable by any `role = 'admin'` user. Approved 2026-08-07 for
the current single-team staff model; it should be revisited if staff ever spans
organizations, since the policy has no per-org narrowing.

### 2b. Trust boundaries — the actor axis

The Dirty Dozen enumerates *attacks*. This enumerates *actors*: for each principal that can
reach data, what it may submit, read, and mutate, and what it can cause. An attack list
answers "is this specific hole closed?"; this answers "what is this principal able to do at
all?" — which is the question that surfaces holes nobody thought to list.

| Principal | Credential | May submit | May read | May mutate | Can cause |
|---|---|---|---|---|---|
| **Anonymous partner** | none (anon key) | Intake form only | Nothing | Nothing | A `scout_intakes` row, forced to `review_status = 'pending'` (Dirty Dozen #7). Cannot self-approve |
| **Authenticated partner** | Supabase session, `role = 'client'` | Own business/engagement writes | Own org's rows, via RLS | Own rows — **including `engagements`, which is the open hole** (§2a, D22) | Today: its own lifecycle advancement. After D22: nothing beyond business detail |
| **DSSG staff** | Supabase session, `role = 'admin'` | Approvals, transitions, drafts | **Every org's** engagements (`engagements_select_admin`) | No direct `engagements` write — the admin policy is `SELECT`-only by design | A lifecycle transition *through the command*, an approval, a partner-facing send |
| **Server function** | service-role key, server-only | Anything | Everything — **RLS does not apply** | Everything | The transition command, the recorder, ingestion. The single most dangerous principal; it never reaches the browser (`VITE_` boundary) |
| **Model provider** | outbound only | — | Whatever a prompt includes | Nothing | Returns text. **Cannot write, cannot grant itself a tier** — `hitlTier` and `readiness` are omitted from every output schema |
| **Database** | — | — | — | — | Enforces constraints and RLS. The last line, and the only one that holds when application code is wrong |

Three properties this table makes visible that the attack list does not:

- **The partner is the only principal whose write surface exceeds its authority.** Every
  other row is either read-only or server-side. That asymmetry *is* D22.
- **Staff cannot write `engagements` directly, by design.** Their power routes through the
  transition command, which is what makes guards and approval checks unskippable. Granting
  an admin `UPDATE` policy for convenience would silently delete the state machine.
- **The model is the weakest principal, deliberately.** It reads what a prompt hands it and
  returns text. Every consequential decision derived from its output is stamped
  server-side.

**Prompt content is a read surface.** A model provider sees whatever a prompt includes, so
prompt assembly is subject to tenancy rules like any other read: a prompt must never be
built from a query that was not itself RLS-scoped or explicitly org-filtered. Transcripts
are restricted and never logged (`platform/agents/scout.md` §2) — the same reasoning,
applied to the logging sink instead of the model.

## Rules

1. RLS is the authorization boundary, never key secrecy. The anon key is public by design.
2. `is_admin()` is the **only** indirection for role checks. No policy inlines
   `role = 'admin'`. *Enforced by:* review only — nothing greps for inlined role checks.
3. Every table carries `enable` **and** `force row level security`. Force is what closes
   the table-owner bypass. *Enforced by:* pgTAP, once §3 is runnable.
4. Append-only tables are enforced **twice** — by policy absence and by privilege absence.
   Either alone is weaker: policy-only returns an empty set, privilege-only is bypassed by
   a future policy grant.
5. No client may set a timestamp. `created_at` is a column default; `updated_at` is written
   by an enforcement trigger.
6. Role elevation is service-role only, out of band. No client path assigns `admin`.
7. Public-writable surface is exactly one grant: `anon` → `insert on scout_intakes`.
   Widening it is a security decision, not a schema convenience.

## 3. Test Runner — **deferred, does not currently run**

> **The suite described here is switched off.** Any plan that treats it as a regression net
> is planning against a guard that is not there.

The pgTAP suite is at
[`supabase/tests/_deferred/rls.test.sql.deferred`](../../supabase/tests/_deferred/rls.test.sql.deferred).
It is **not** at `supabase/tests/rls.test.sql`, and the `.deferred` suffix means
`supabase test db` does not collect it. `make db-test` today runs **zero assertions** and
exits green — a silent pass, which is the worst failure mode a gate can have.

It declares `plan(81)` and contains 81 assertions: 31 `throws_ok`, 17 `lives_ok`,
16 `results_eq`, 13 `is_empty`, 3 `is`, 1 `isnt_empty`.

**Why it cannot simply be moved back.** 53 of the 81 assertions reference tables that the
applied schema does not have — `organizations`, `organization_members`, `agent_runs`,
`tool_calls`, `approvals`, `audit_events`, `milestones`, `tasks` — and some assert
row-counts that are only correct under organization scoping (an admin seeing 3 engagements,
alice seeing 2). Un-deferring is blocked on the tenancy decision
([data-model.md](data-model.md) §1), not on moving a file.

**Split by what they need** — this is the cost of turning the gate back on:

| Group | Assertions | Blocked on |
|---|---|---|
| Runnable against the applied schema | ~28 | nothing — could run today |
| Needs `organizations` + `organization_id` | ~25 | 0003 rewrite (C1) |
| Needs telemetry / approval / delivery tables | ~28 | 0004–0006, themselves blocked on 0003 |

Recovering the runnable ~28 as a working suite is milestone **C7** and does not wait for
tenancy. It is the cheapest way to stop `make db-test` lying.

The append-only assertions use `throws_ok(..., '42501', ...)` rather than
`results_eq(..., 0 rows)`. This is not stylistic: because the privilege is withheld as well
as the policy, the statement *raises* instead of returning an empty set, and a `results_eq`
written against it would abort the whole test transaction. Asserting "zero rows affected"
would assert the weaker of the two guarantees.

## Dependencies

- **Data:** all six applied tables; `auth.users` (FK target and 0008 trigger source)
- **Imported by:** [supabase.md](supabase.md) (client conventions),
  [access-model.md](access-model.md) (role model that would replace this one),
  [data-model.md](data-model.md) (migration sequencing)
- **Verified by:** `supabase/tests/_deferred/rls.test.sql.deferred` — **deferred**, §3

## Milestones

- **C6 — Bound the seven unbounded text columns.** Every text column carries a
  `char_length` CHECK. *Done when:* the seven columns in §2's gap note have CHECKs and
  `security.md` §2 row 7 needs no exception. *Status:* NOT STARTED.
- **C7 — Restore the runnable share of the pgTAP suite.** `make db-test` executes real
  assertions against the applied schema. *Done when:* the ~28 applied-schema assertions
  live at `supabase/tests/rls.test.sql` with a matching `plan(n)`, `make db-test` passes,
  and deliberately breaking one policy makes it fail. *Status:* NOT STARTED.
  *Blocks:* nothing — independent of tenancy.
- **C8 — Re-add `engagement_events` to the realtime publication.** *Done when:*
  `alter publication supabase_realtime add table engagement_events` is applied and a
  non-admin subscriber sees only their own engagement's events. *Status:* NOT STARTED.

## Test contract

Runnable against the **applied** schema today (C7 scope):

- `anon` cannot read or insert `users`; can insert `scout_intakes` and read nothing back.
- A public intake insert with `review_status <> 'pending'` or any review field set → denied.
- Non-admin `select` on `scout_intakes` / `architect_assessments` → empty.
- `users`: self-read only; `role` update → `check_violation` (23514); foreign-profile
  insert → denied.
- `businesses` / `engagements`: owner-scoped read, insert, update, delete; cross-owner
  access → empty; `owner_id` / `business_id` / `created_at` update → raises.
- Engagement with a non-existent `business_id` → FK violation (23503).
- Terminal lock: `completed` → any other status → raises.
- `engagement_events`: owner insert succeeds; `created_by` forgery → denied; UPDATE and
  DELETE → **42501** (privilege, not policy).
- Admin reads every engagement; admin **cannot** write one (no admin write policy).
- 0008: inserting into `auth.users` provisions exactly one `public.users` row with
  `role = 'client'`; a second insert with the same id does not error and does not duplicate.
- 0008: a client-supplied `role` in `raw_user_meta_data` is ignored — the row is `client`.
- Draft-review refusal: admin updates only `review_notes` on a row with `reviewed_by` NULL
  → raises 23514.

Blocked on tenancy (C1), retained in the deferred suite: organization isolation, telemetry
and approval table access, milestone/task scoping.

## Requirement Trace

| Old requirement | Source | Now at | Status |
|---|---|---|---|
| Business `ownerId` must match creator's `request.auth.uid` | `security_spec.md:4` | `docs/crm/security.md` §1 / `0001_init.sql` policy `businesses_insert_own` | Carried |
| Engagement must reference an existing Business, `ownerId` matches creator | `security_spec.md:5` | §1 / `0001_init.sql` FK `engagements.business_id` + policy `engagements_insert_own` | Carried |
| Users read/write only their own Business and Engagement docs | `security_spec.md:6` | §1 / `0001_init.sql` owner-scoped policies on `businesses`, `engagements` | Carried |
| `role` immutable by client once set | `security_spec.md:7` | §1 / `0001_init.sql` trigger `users_enforce_immutable` | Carried |
| Timestamps validated against `request.time` | `security_spec.md:8` | §1 / server-assigned `now()` everywhere | Carried, strengthened — client can no longer supply a timestamp at all, not merely a validated one |
| Identity Spoofing (Dirty Dozen #1) | `security_spec.md:11` | §2 row 1 | Carried |
| Resource Hijacking (#2) | `security_spec.md:12` | §2 row 2 | Carried |
| Privilege Escalation (#3) | `security_spec.md:13` | §2 row 3 | Carried |
| Shadow Field Injection (#4) | `security_spec.md:14` | §2 row 4 | Carried, structurally — no longer needs a runtime check |
| Orphaned Engagement (#5) | `security_spec.md:15` | §2 row 5 | Carried, structurally — enforced by a foreign key instead of rule logic |
| Timeline Bypass (#6) | `security_spec.md:16` | §2 row 6 | Carried, strengthened — the source rules text notes status updates "are allowed" with only a parenthetical tracking note; the trigger now hard-enforces the terminal lock |
| Resource Exhaustion (#7) | `security_spec.md:17` | §2 row 7 | Carried |
| Malicious ID (#8) | `security_spec.md:18` | §2 row 8 | Dropped as a live check — `uuid` primary keys make the attack class unreachable rather than validated-against |
| PII Leak (#9) | `security_spec.md:19` | §2 row 9 | Carried, strengthened — `FORCE ROW LEVEL SECURITY` closes the table-owner bypass Firestore rules had no equivalent gap for |
| State Corruption (#10) | `security_spec.md:20` | §2 row 10 | Carried — same trigger as #6 |
| Timestamp Forgery (#11) | `security_spec.md:21` | §2 row 11 | Dropped as a live check — client cannot set `updated_at` at all, so there is nothing left to forge |
| Unverified Account Write (#12) | `security_spec.md:22` | §2 row 12 | Dropped — the source `isEmailVerified()` guard was defined but never called by any rule; porting it would add a restriction the original never enforced (`0001_init.sql` divergence note #3) |
| Firestore `firestore.rules.test.ts` (Draft Plan) | `security_spec.md:24-25` | §3 / `supabase/tests/rls.test.sql` | Carried, implemented — the draft plan is no longer a draft |
| Staff read access to engagements | `0002_staff_engagement_access.sql` §1, Pulse buildout | §1, §2 row 2, §2a | New — no Firestore-era counterpart; read-only and admin-only, deliberately not extended to writes |
| Append-only engagement history | `0002_staff_engagement_access.sql` §3 | §1, §2a | New — enforced by policy absence *and* privilege absence |
| Event attribution (`created_by = auth.uid()`) | `0002_staff_engagement_access.sql` §3 | §1, §2a | New — mirrors `architect_assessments`' existing `created_by` check |
| U5: who writes `engagements.stage` | `design-system.md` §5, `0002` header note | — | **Resolved 2026-08-21** — [lifecycle.md](lifecycle.md) §2 assigns the write to one server-side domain command (`POST /api/engagement-transition`), never to a client or an agent. **Not yet enforced**: `engagements_insert_own` / `engagements_update_own` still let a partner org write its own stage from the browser ([lifecycle.md](lifecycle.md) §8 item 4 revokes them) |
