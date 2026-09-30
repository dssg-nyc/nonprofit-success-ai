# Data Model — current state and target

**Status:** Active
**Lane:** crm (PRD Workstream 2)
**Satisfies:** PRD §5.2 canonical entities, §5.3 data engineering requirements

This is the gap between the six tables that exist and the nineteen the PRD names, plus the
order to close it in. The live ER diagram for what exists today is in
[design-system.md](../design-system.md) §4; this doc does not repeat it.

---

## 1. The blocking decision: tenancy

**Nothing else in this doc should be built until this is settled.**

The repo is **owner-scoped**. Every RLS policy keys off the row's `owner_id`:

```sql
using (owner_id = auth.uid())
```

The PRD is **organization-scoped** (§5.2): `organizations` + `organization_members`, and
"every business entity has explicit organization ownership" (§5.3).

These are not compatible. The choice sits in the `using` clause of *every* policy on
*every* table, so it is not a migration that can be layered on later without rewriting the
authorization surface. Concretely: **every table added before this is decided is a table
migrated after it**, and each migration has to be re-verified against the pgTAP suite.

### Recommendation: adopt organization scoping now

Three reasons, in order of weight:

1. **It is where the product is going.** DSSG staff work a portfolio, not a personal list.
   Migration 0002 already had to bolt on admin `SELECT` across all engagements to make
   Pulse work — that is org-scoping arriving through the back door, one grant at a time.
2. **It is cheapest at six tables.** The rewrite is bounded today and grows with every
   table added.
3. **The shared-Supabase question (§9b) depends on it.** GrantPilot is org-scoped. A
   consolidated project cannot bridge two different tenancy models.

The identity coupling is already correct and does not change either way: `users.id`
references `auth.users(id)`, and every policy resolves the actor through `auth.uid()`.
That is the expensive half of the contract, and translating `firestore.rules` faithfully
got it for free.

### What the migration touches

- Add `organizations`, `organization_members`.
- Add `organization_id` to `businesses`, `engagements`, `scout_intakes`,
  `architect_assessments`, `engagement_events`.
- Rewrite the `using` clause of every policy from `owner_id = auth.uid()` to membership in
  the row's organization.
- Keep [`is_admin()`](../../supabase/migrations/0001_init.sql) as the **single indirection**
  for role checks — never inline `role = 'admin'` into a policy. Re-pointing one function at
  `organization_members` later beats rewriting seventeen policies.
- Re-run `supabase/tests/rls.test.sql` — the pgTAP assertions are the regression net for
  exactly this class of change.

---

## 2. Current state — six tables

| Table | Origin |
|---|---|
| `users` | Translated from `firestore.rules` |
| `businesses` | Translated from `firestore.rules` |
| `engagements` | Translated from `firestore.rules` |
| `scout_intakes` | Translated from `firestore.rules` |
| `architect_assessments` | Translated from `firestore.rules` |
| `engagement_events` | New in migration 0002 — Pulse's activity signal |

Authorization semantics currently in force are documented in
[design-system.md](../design-system.md) §4 and verified by `supabase/tests/rls.test.sql`.

---

## 3. Target — the PRD's nineteen entities

Mapped against what exists. "Rename" means the concept exists under a different name and
should converge on the PRD's vocabulary rather than carry two names for one thing.

| PRD entity | Status here | Notes |
|---|---|---|
| `auth.users` | ✅ Exists | Supabase-managed. Canonical identity. |
| `profiles` | 🟡 Rename | Our `users` table *is* this. PRD reserves `users` for `auth.users`. |
| `organizations` | ❌ Missing | **Blocking** — see §1. |
| `organization_members` | ❌ Missing | **Blocking** — see §1. |
| `intakes` | 🟡 Rename | `scout_intakes` → `intakes`. |
| `scout_reviews` | ❌ Missing | Qualification evidence, model/version, reviewer decision. Today the routing result is denormalized onto the intake row, so re-running Scout overwrites history. |
| `assessments` | 🟡 Rename | `architect_assessments` → `assessments`. Needs a human-edit column: PRD says "Architect outputs **and human edits**". |
| `engagements` | ✅ Exists | Six-stage enum ratified — [lifecycle.md](lifecycle.md) §1. One row *per stage* (`unique (business_id, stage)`), not a cursor. |
| `tasks` | ❌ Missing | **MVP.** Architect emits milestones as prose. |
| `milestones` | ❌ Missing | **MVP.** Until these are rows, "behind schedule" is not computable, Pulse has nothing to measure, and two lifecycle guards stay staff-attested rather than verified ([lifecycle.md](lifecycle.md) §6). |
| `contracts` | ❌ Missing | Backlog — gates Stage 1→2 (PRD §8). |
| `signatures` | ❌ Missing | Backlog. Immutable — same append-only pattern as `engagement_events`. |
| `documents` | ❌ Missing | **MVP** — see §5. |
| `communications` | ❌ Missing | The canonical record for anything Envoy drafts. Envoy must not become a second system of record. |
| `calendar_events` | ❌ Missing | Scout's meeting-intelligence extension needs this. |
| `agent_runs` | ❌ Missing | **MVP** — highest-leverage table in the system. |
| `tool_calls` | ❌ Missing | **MVP.** Pairs with `agent_runs`. |
| `approvals` | ❌ Missing | **MVP.** HITL tiers derive correctly but there is nowhere for a human to act on L3/L4 outside Scout's own queue. |
| `audit_events` | ❌ Missing | **MVP.** Immutable — the `engagement_events` append-only pattern generalizes. |

`engagement_events` has no PRD counterpart. It is a real concept (episodic memory, PRD §6.4)
and should stay; it is arguably a scoped view of `audit_events`, which is worth resolving
when `audit_events` lands rather than now.

---

## 4. Sequencing

Each step is a migration that leaves the suite green.

| # | Migration | Contents | Why here |
|---|---|---|---|
| 1 | **Tenancy** | `organizations`, `organization_members`, `organization_id` columns, policy rewrite | Blocks everything. §1. |
| 2 | **Telemetry** | `agent_runs`, `tool_calls` | Ships with the model gateway — the gateway is what writes these. Building them apart means building the gateway twice. |
| 3 | **Approval spine** | `approvals`, `audit_events` | Gives L3/L4 a place to land. One surface, all five agents. |
| 4 | **Delivery** | `tasks`, `milestones` | Makes engagement health computable, which is what Pulse is for. |
| 5 | **Provenance** | `documents` | §5. Cheap now, expensive later. |
| 6 | **Renames** | `users`→`profiles`, `scout_intakes`→`intakes`, `architect_assessments`→`assessments` | Deliberately last — pure churn with no capability gain, and it touches application code. Do it once the shape is stable. |

Backlog, ordered by when their feature starts: `communications`, `calendar_events`,
`scout_reviews`, `contracts`, `signatures`.

---

## 5. Documents: ingest now, retrieve later

Retrieval is backlog. **Ingestion with provenance is not**, and the asymmetry is entirely
one-sided:

- Capture documents from day one with source, organization, engagement, and classification
  attached → adding retrieval later is a weekend of work.
- Capture them without provenance → adding retrieval later means re-ingesting everything
  and reconstructing context that no longer exists.

So `documents` earns its place now; chunking, embeddings, pgvector, and reranking do not.
PRD §6.3 requires every retrieved item to carry "source, version, tenant/scope, document
status, and provenance" — those are columns, and they are free to add at creation and
costly to backfill.

Worth noting: the first genuinely useful retrieval in this system is likely **structured**
— prior engagements at similar organizations, past assessments in the same sector — which
is a SQL query against data we already have, not a vector search.

---

## 6. Standing requirements

From PRD §5.3, as they apply here:

- **Constraints first.** Postgres constraints and typed schemas are the correctness layer;
  RLS is the authorization layer. Both, not either.
- **Migrations in source control.** No manual schema drift. Already the practice.
- **Separate operational data from AI telemetry.** `agent_runs` / `tool_calls` are
  telemetry; they should not grow foreign keys that make them load-bearing for business
  reads.
- **Version prompts, models, policies, schemas.** `agent_runs` is where model and prompt
  version get recorded, which is another reason it comes early.
- **Idempotency for workflow writes and external side effects.** Applies the moment Envoy
  gets a send path.
- **Retention, deletion, export, audit.** Undefined. Needs an owner before production data
  accumulates — and it interacts with the immutability of `audit_events` and `signatures`,
  which cannot simply be deleted on request.

---

## 7. Provenance — where a sentence came from

**Provenance is a data contract, not a UI feature.** A badge that says "AI-generated" with
no column behind it cannot answer *"where did this sentence come from?"* six months later,
and that is the question that gets asked when a partner disputes something in a charter.

Every stored artifact a person reads is one of four kinds, and the schema carries which:

| Kind | Meaning | Trust |
|---|---|---|
| **Verified fact** | Sourced directly from system or user input | Authoritative |
| **Deterministic inference** | Computed by stated rules (`compositeSignal()`, `computeEngagementHealth()`, the maturity rubric) | Reproducible by hand |
| **AI interpretation** | Generated by a named agent through the model gateway | Requires approval before it reaches a partner |
| **Human decision** | Approved, edited, or rejected by staff | Authoritative, and supersedes the above |

The distinction is not cosmetic. A maturity band is a *deterministic inference* — a person
can recompute it from the rubric. The charter narrative explaining that band is an *AI
interpretation*. They print side by side and carry different weight, so they cannot share
a provenance story.

### The columns

Any table holding model-generated or model-influenced content carries:

```
source_type      enum('verified','derived','ai','human')  not null
generated_by     text          -- agent name, or the function for 'derived'
model            text          -- null unless source_type = 'ai'
model_version    text
prompt_version   text
run_id           uuid          -- FK to agent_runs; null unless source_type = 'ai'
approved_by      uuid          -- FK to users; set when a human accepts it
approved_at      timestamptz
```

`architect_assessments`, `chronicle_drafts`, `communications`, and `scout_intakes`
(routing output) all qualify. `agent_runs` already records `model` and `prompt_version`
per run — these columns let a *stored artifact* point back at the run that produced it,
which is the direction the audit actually needs.

### The chain has to be traversable

The reason `run_id` is a foreign key and not a text label:

```
agent_run → proposal → human edit → approval → state transition → external effect
```

Every hop is a row, and each names the previous one. Given a sentence in a partner email,
this answers: which model wrote it, on what prompt version, from what input, who edited
it, who approved it, and which lifecycle transition it accompanied. Break any link and the
system can no longer explain itself.

Two consequences worth stating, because they are easy to violate:

- **A human edit does not overwrite the AI original.** It writes a new version and points
  at the prior one. Otherwise the record shows a human authoring text a model actually
  drafted, which is precisely backwards for review.
- **`approved_by` is set by the approval path, never by the agent.** Same rule as
  `hitlTier`: a model that can stamp its own approval has no approval.

This is registry row **D20**, and it lands with `agent_runs` (**D4**) — retrofitting
provenance after content exists means backfilling columns nobody can populate, because the
runs that produced the content are gone.

## 8. Open questions

- **Tenancy** (§1) — blocking, recommendation above.
- **`engagements.stage` writer** — **resolved 2026-08-21.** One server-side domain command
  is the sole writer; `stage` is row-scoped, not a cursor. [lifecycle.md](lifecycle.md) §2.
- **Stage enum ratification** — **resolved 2026-08-21 at six stages.** [lifecycle.md](lifecycle.md) §1.
- **`engagement_events` vs. `audit_events`** — resolve when the latter lands (§3).
- **Shared Supabase project with GrantPilot** (PRD §9b) — blocked on tenancy. Two cheap
  preparations meanwhile: namespace tables out of `public` into a `portal` schema (one
  migration while only six tables exist; the `search_path` pins in `0001_init.sql` become
  `portal, public, pg_temp`), and keep `is_admin()` as the sole role indirection.
- **Retention and deletion policy** — unowned (§6).
