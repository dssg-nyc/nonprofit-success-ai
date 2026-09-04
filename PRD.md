# PRD — Nonprofit Success AI (DSSG NYC Partner Portal)

**Status:** Draft, consolidated
**Prepared for:** Tony Amodeo (Design & UX, Workstream 1)
**Workstream owners:** Tony (Design & UX) · Karthik (Data Engineering + CRM) · Ramsey (Agentic / Platform) · Jian (tech lead, reviews across all three)

---

## 0. Purpose & Sources — read this before anything else

**This branch (`tonys_branch`) is behind the rest of the project.** As checked out here,
the app is still Firebase (Auth + Firestore), has only two of five agents (Scout,
Architect) as deterministic stubs in `src/lib/`, has no server boundary, no tests, and no
`.claude/specs/` or `docs/` directory at all. That is the actual state of *this* working
tree today.

A sibling branch, `origin/ramsey-refactor` (tip commit `9bc93d2`), is far ahead: the
Firebase→Supabase migration is complete there, and it carries an extensive spec corpus —
`.claude/specs/` (28 files) and `docs/nonprofit-success-product-requirements.html` /
`docs/nonprofit-success-system-design.html` — that documents a converged, actively-argued
product design with a real PRD (`.claude/specs/design-requirements.md`), a delta/decision
registry (`.claude/specs/roadmap.md`), and one spec per agent and service. Other branches
(`jian_production`, `feat/login`) sit at various earlier points in between.

**This document synthesizes that spec corpus into one PRD**, written from `tonys_branch`
so Tony has a single reference that doesn't require checking out another branch. Section
4 (UX) reproduces the User Experience section you already drafted, verbatim. Everything
else is pulled from the specs on `ramsey-refactor`, cross-checked against what's actually
built versus merely decided. Every claim below is traceable to a real file; where the
specs disagree with each other (this corpus has open, live disagreements — see §15), that
is called out rather than silently resolved.

**This is not committed anywhere yet.** It exists only as `PRD.md` in this working tree.
See §16 for the branch/merge question this raises.

---

## 1. Executive Summary

Nonprofit Success AI is a CSM-grade lifecycle platform for every pro bono engagement DSSG
NYC runs. Today, intake and onboarding run on whichever volunteer has an hour free — no
process, no consistency, no institutional memory, and the least data-mature nonprofits
(who need DSSG most) quietly fall through the cracks. The fix is a React SPA backed by
five focused AI agents — **Scout, Architect, Pulse, Envoy, Chronicle** — routing
nonprofits from public intake through assessment, contracting, delivery, and impact
wrap-up, with human-in-the-loop oversight at every partner-facing decision.

**Agent roster — ratified 2026-08-22, five agents.** An earlier design pass
(`docs/nonprofit-success-system-design.html`) argued for consolidating to three agents
(Scout, Architect, Chronicle) plus deterministic shared services, on the grounds that
health monitoring and communications don't need independent reasoning loops. That
argument was revisited and the roster was ratified at five: Pulse (health monitoring) and
Envoy (communications) stay agents by roster even though Pulse's logic is pure threshold
arithmetic with no model call, and Envoy's drafting is L3-always with mandatory staff
approval before any send path exists. See §15 for why both versions of this argument are
worth knowing about.

**Delivery is organized as three workstreams**, not a single release:

| Workstream | Owner | Concern |
|---|---|---|
| WS1 — Design & UX | Tony | Every surface a human touches: journeys, screens, approval/review UI, the AI-vs-verified visual boundary |
| WS2 — Data Engineering | Karthik | Supabase schema, RLS, migrations, tenancy, CI/CD, CRM/HubSpot sync |
| WS3 — Agentic / Platform | Ramsey | Five agents + fallbacks, model gateway, HITL tiering, eval harness, knowledge base, MCP/plugin registries |

Jian reviews and supports across all three. HubSpot is the CRM of record for the
*relationship*; Supabase owns the engagement *state machine*. That boundary (§12) is the
single most consequential integration decision in the whole design.

**Budget constraint:** under $50/month to run (Vercel free tier + Supabase free tier +
Gemini free tier). This shapes several decisions below (single model adapter, no
knowledge graph, no second model provider) as much as any technical argument does.

---

## 2. Product Principles

Each principle is written as a test that can fail — from `design-requirements.md` §2:

1. **Agents reason; services execute.** Fails when an agent writes directly to
   partner-visible state, owns a side effect, or orchestrates another agent.
2. **Every capability has one owner.** Fails when two components maintain independent
   data models for the same operational function (e.g., two task stores).
3. **AI never acts without a server boundary.** Fails when a model key is in the client
   bundle, an AI classification is writable from the browser, or HITL tiering is derived
   client-side.
4. **Human-in-the-loop is the design constraint, not an add-on.** Fails when a
   partner-facing action can complete without human approval at the appropriate tier.
5. **Deterministic fallback on every agent path.** Fails when a model call failure leaves
   the user with no result — the heuristic must produce the identical output shape.
6. **Graceful degradation.** Fails when a service outage produces an error screen instead
   of a reduced-capability experience.
7. **Measure before you build infrastructure.** Fails when pgvector, a knowledge graph, a
   second model provider, or an orchestration framework is added before a measured
   workflow requires it.
8. **Skills, plugins, and MCPs are shared platform resources.** Fails when an agent module
   imports a vendor SDK directly, or two agents reach the same external system through
   different code paths.
9. **One owner, one system of record, one audit trail per capability.** Fails when two
   systems both claim to own a field, or a state change lands with no record of who
   caused it.
10. **Memory promotion is explicit.** Fails when content from a run or conversation reaches
    durable shared knowledge without human approval and an explicit scope.
11. **Quality is a release requirement, not a phase.** Fails when a change ships against an
    agent path with no test coverage, or an LLM judge is treated as sufficient authority
    for an irreversible action.

---

## 3. Users & Actors

| Actor | Context | Time budget | Interaction pattern |
|---|---|---|---|
| Prospective nonprofit | Org leader/staff, first contact, mobile-first (fills forms between meetings) | 5–7 min | Public `/apply` form, no account |
| DSSG staff reviewer | Volunteer or staff managing the intake queue | 2–3 min per intake | Authenticated, reviews Scout output, approves/edits/redirects |
| DSSG staff (engagement) | Managing 3–8 active engagements | ~30 sec per engagement scan | Dashboard scan, health-badge triage |
| Nonprofit authorized rep | ED or director — a legal actor, not a feature user | 5 min, one-time | In-app contract preview + e-signature |
| Volunteer / diplomat (project work) | Delivers the actual data-science work | — | Not a portal user under the current 2-role model; a **third role** is decided-but-unbuilt (§10) |
| Public audience | Reads impact stories, case studies | — | No login; published Chronicle artifacts only |
| GrantPilot (system) | Sibling DSSG app; aspirationally shares Supabase identity | — | **No integration exists today** — this is the single most-repeated "future" item across every spec pulled (§15) |

**Zero-data states**, one per actor: empty intake form with inline guidance; "no pending
intakes" with a CTA; "no active engagements"; the contract view is only ever shown once a
charter exists (never an empty contract screen).

---

## 4. User Experience Requirements

*This section is reproduced from your draft as-is.*

### 4.1 User Journeys

- Shared Supabase login → organization/profile context → role-aware dashboard.
- Scout queue → qualification evidence → recommendation → approve/request changes/reject.
- Approved intake → Architect assessment → priorities → scoped plan → canonical
  tasks/resources → contract preview.
- Option B contract flow: preview → authorized in-app signature → immutable signature
  event → lifecycle transition.
- Engagement operations: canonical tasks, milestones, calendar, communications, and
  status.
- Chronicle: completed engagement → impact summary → lessons → candidate knowledge →
  human review/publish.
- AI oversight: provenance, evidence, tool activity, approvals, and relevant evaluation
  status.

### 4.2 UI Requirements

- Role-based navigation and route protection using Supabase identity and application
  roles.
- Consistent entity model for organizations, engagements, assessments, tasks, contracts,
  documents, and users.
- AI-generated content must be visually distinguishable from verified source data.
- Consequential recommendations expose evidence before approval.
- Approval actions show the exact side effect before confirmation.
- Contract signing shows final artifact, signer identity, timestamp, and status.
- Task/calendar views consume canonical backend records; no agent-local task stores.
- Errors identify validation, permission, integration, or AI failures.
- Accessibility, responsive behavior, keyboard navigation, and loading/empty/error states
  are release requirements.

### 4.3 UX Acceptance Criteria

- A GrantPilot user can sign in with the same account and reach the correct
  organization/role context.
- A reviewer can approve, reject, or request changes without leaving the relevant
  workflow.
- No UI action bypasses backend authorization.
- A contract cannot advance stages unless the backend verifies a valid signature event.
- Users can distinguish AI recommendations, retrieved evidence, and human-verified facts.
- Critical actions have visible success/failure states and an audit reference.

### 4.4 Supplementary UX detail (from the wider spec corpus)

The rest of the corpus fills in detail your three sections above assume but don't spell
out — worth folding in as you build these screens out:

**Per-actor device/time budget** (`design-requirements.md` §4) matches §3 above.

**Accessibility (non-negotiable, WCAG 2.1 AA):** full keyboard navigation on every
interactive element; screen-reader form labels and ARIA roles for dynamic content; no
time-limited interactions (the intake form saves progress, the contract view has no
timeout); `prefers-reduced-motion` honored (already present in `src/index.css`).

**Information hierarchy per screen:**

| Screen | Scan order |
|---|---|
| Dashboard | Health badge → org name → stage → days in stage (10 sec) |
| Review queue | Bucket → confidence badge → readiness signal → flags (2 min) |
| Assessment results | Composite level → dimension scores → charter → plan |

**Error states:**

- Form validation: inline, per-field, as the user types — never only on submit.
- Server error: *"Something went wrong — your data is saved. Try again in a moment."*
- Model failure: transparent, never hidden behind identical-looking UI — *"AI
  classification unavailable; using deterministic routing."*

**Content design:** agent-generated content carries a badge or subtle indicator, not a
wall of disclaimers. A `thin` Chronicle draft states its own provisionality in the prose
itself (so a reviewer reading only the text still learns the record is thin). A
`not_ready` Chronicle result returns nothing, not a placeholder — a plausible-looking
short story is exactly the failure mode this guards against (§9.5).

**New screens this PRD implies beyond the six already built:** contract preview + sign
(Option B, §9); engagement health detail (timeline, health reasons, current plan, contact
info); Chronicle draft review (approve/edit/reject); an approval queue surface that's
centralized across all five agents rather than per-agent (§14 §10 registries).

---

## 5. System Architecture

### 5.1 Identity & tenancy — the open blocker

**Identity root:** `supabase.auth.users` is the single identity provider once the
Supabase migration lands (it has not landed in `tonys_branch`). Every authenticated
request resolves to an `auth.users.id`; roles are enforced by RLS, not application code.

**Tenancy has three competing answers in the spec corpus right now, not one** — this is
the single highest-leverage open decision in the whole project (detailed in §15.1):

1. **Owner-scoped** (what's actually applied in Supabase migrations `0001`/`0002`/`0008`
   on `ramsey-refactor`): every row keys off `owner_id = auth.uid()`.
2. **Organization-scoped** (what `design-requirements.md` describes, and what
   `_deferred/0003_tenancy.sql` implements): `organizations` + `organization_members`,
   needed for the GrantPilot shared-identity goal in §4.3.
3. **Project-scoped, three roles** (`crm/access-model.md`, decided 2026-08-21, **not**
   implemented, and explicitly supersedes #2's `_deferred/0003` as "the wrong shape"):
   `client` / `diplomat` / `admin`, where a diplomat (volunteer) sees only their assigned
   projects, cohort-bounded by a validity window.

None of this is layered — it's in the `USING` clause of every RLS policy on every table,
so whichever is chosen has to happen before more tables are added, not after.

### 5.2 Execution boundary

```
Browser (React SPA)
  ├── Supabase (anon key, RLS-protected reads/writes)
  └── /api (Vercel Functions — server boundary)
        ├── Model provider (Gemini via Vercel AI SDK, server-only key)
        ├── Supabase (service-role key, privileged writes)
        └── Integration adapters (HubSpot, calendar, email)
```

The browser never calls a model provider directly, and never sends a service-role key.
This is the load-bearing architectural decision that makes HITL tiering trustworthy: a
model cannot grant itself `L2`, because tier derivation happens server-side, after the
model call returns, in code the model doesn't touch.

**This boundary does not exist in `tonys_branch` today.** There is no `api/` directory;
Scout and Architect logic runs entirely client-side against `demoStore.ts` mock data or
directly against Firestore.

### 5.3 Target repository layout (not the current tree)

```
src/app/            SPA entrypoint — App.tsx, main.tsx, index.css
src/components/      Flat, one file per screen/card — no feature subdirectories
src/agents/          One dir per agent (scout/, architect/, pulse/, envoy/, chronicle/) — pure logic
src/model/           The gateway — the one place any agent calls a model
src/guardrails/      hitl.ts — L1–L4 tiering, one switch over the whole roster
src/observability/   recorder.ts — writes agent_runs, service-role, server-only
src/schemas/         Versioned wire contracts crossing /api
src/evals/           The grading harness — imports agents; nothing imports it
src/types/           Wire-contract types, re-exported from src/types/index.ts
src/lib/             Cross-cutting infra (supabase.ts) — not agent logic
api/                 Vercel Functions — root-level by necessity (filesystem routing)
docs/                Tracked: architecture, CRM, platform/agent specs, UX specs
```

Dependency direction: `app/`, `components/`, and `api/` may import `agents/`; nothing in
`agents/` imports from `app/` or `components/`. That's what lets `api/` call agent logic
without dragging React into a serverless function.

---

## 6. Data Model

### 6.1 Current state — six tables, applied

Everything below is what's actually live on `ramsey-refactor`'s Supabase project (not on
`tonys_branch`, which is still Firestore):

| Table | Purpose |
|---|---|
| `users` | Mirrors `auth.users`; `role` (`client`/`admin`) immutable after insert, set server-side by an `on_auth_user_created` trigger |
| `businesses` | Owned by a single user (`owner_id`); immutable after insert |
| `engagements` | One row **per lifecycle stage** per business (`unique (business_id, stage)`) — not a cursor; see §7.1 |
| `scout_intakes` | Public-insertable intake rows; admin-only read/review |
| `architect_assessments` | Shares its PK with the `scout_intakes` row it assesses |
| `engagement_events` | Append-only activity log (migration `0002`) — Pulse's only data source |

Applied migrations: `0000` (test helpers), `0001` (init), `0002` (staff engagement
access), `0008` (user provisioning). **`0003`–`0007` exist only as drafts under
`supabase/migrations/_deferred/` and are not applied.**

### 6.2 Target — nineteen entities named in the PRD, mapped against reality

| Entity | Status | Notes |
|---|---|---|
| `auth.users` | ✅ Live | Supabase-managed |
| `profiles` | 🟡 Rename pending | Today's `users` table is this |
| `organizations`, `organization_members` | ❌ Missing, blocking | §5.1 tenancy decision gates this |
| `intakes` | 🟡 Rename pending | Today's `scout_intakes` |
| `scout_reviews` | ❌ Missing | Routing result is denormalized onto the intake row today — re-running Scout overwrites review history |
| `assessments` | 🟡 Rename pending | Today's `architect_assessments`; needs a human-edit column |
| `engagements` | ✅ Live | Row-per-stage, six stages ratified (§7) |
| `tasks`, `milestones` | ❌ Missing — MVP-critical | Until these are rows, "behind schedule" isn't computable and two lifecycle guards stay staff-attested rather than verified |
| `contracts`, `signatures` | ❌ Missing | Gates the Stage 1→2 transition (§9); `signatures` must be immutable, append-only |
| `documents` | ❌ Missing — MVP-critical | Provenance columns are cheap now, expensive to backfill later (§6.3) |
| `communications` | ❌ Missing | Canonical record for anything Envoy drafts — Envoy must never become a second system of record |
| `calendar_events` | ❌ Missing | Needed once Scout's meeting-intelligence extension lands |
| `agent_runs`, `tool_calls` | ❌ Missing — highest-leverage table in the system | Every model call's audit trail; ships with the model gateway |
| `approvals` | ❌ Missing — MVP-critical | HITL tiers derive correctly today but there's nowhere for a human to act on an L3/L4 outside Scout's own queue |
| `audit_events` | ❌ Missing — MVP-critical | Immutable; generalizes the `engagement_events` append-only pattern |

Migration sequencing recommended by `crm/data-model.md`: **tenancy first** (blocks
everything), then **telemetry** (ships with the model gateway), then **approval spine**,
then **delivery** (`tasks`/`milestones`), then **provenance** (`documents`), and renames
last (pure churn, do it once the shape is stable).

### 6.3 Provenance — a schema requirement, not a UI feature

A badge that says "AI-generated" with no column behind it can't answer *"where did this
sentence come from?"* six months later — the question that actually gets asked when a
partner disputes something in a charter. Every table holding model-generated or
model-influenced content needs to carry:

```
source_type      enum('verified','derived','ai','human')  not null
generated_by     text          -- agent name, or the function for 'derived'
model            text          -- null unless source_type = 'ai'
model_version    text
prompt_version   text
run_id           uuid          -- FK to agent_runs; null unless source_type = 'ai'
approved_by      uuid          -- FK to users; set only by the approval path, never by the agent
approved_at      timestamptz
```

The chain that has to stay traversable: `agent_run → proposal → human edit → approval →
state transition → external effect`. A human edit writes a **new** version rather than
overwriting the AI original — otherwise the record shows a human authoring text a model
actually drafted, which is backwards for review.

---

## 7. Engagement Lifecycle (State Machine)

### 7.1 The structural correction

**`engagements` is not one row that moves through six stages — it's one row *per*
stage.** A business at Scoping has up to four `engagements` rows
(`initial_meeting`/`budget_check`/`data_ethics_committee`/`scoping`), each with its own
`status`. This is inherited from the Firestore document-ID pattern
(`{businessId}_{stage}`), and it's a deliberate keep: it's append-structured, which
retains exactly what Pulse needs (`daysInStage`, per-stage windows) — a single mutable
cursor would destroy that on every write. "Current stage" is **derived** (the row with
`status = 'in_progress'`), never a stored column.

### 7.2 The six stages — ratified 2026-08-21

| # | Stage | Exit condition | Window |
|---|---|---|---|
| 1 | `initial_meeting` | Charter signed | 14d |
| 2 | `budget_check` | Budget confirmed feasible | 21d |
| 3 | `data_ethics_committee` | Committee approves | 30d |
| 4 | `scoping` | Plan accepted by partner | 21d |
| 5 | `hackathon_ready` | Delivery cycle begins | 45d |
| 6 | `membership` | — (terminal, but not closed — an ongoing relationship) | 90d |

Six over five: every artifact that's ever actually executed (`firestore.rules`,
`0001_init.sql`, `src/types.ts`, `BusinessPortal.tsx`'s `STAGES` array) implements six.
Five only appears in prose that predates the schema. `data_ethics_committee` is the stage
most likely to get questioned as "not a real pipeline stage" — it stays, because it has a
real approval body, a real queue, and engagements genuinely wait in it. Windows are
provisional estimates pending real per-stage duration data, not measured values.

### 7.3 Who writes the transition — resolved, not yet enforced

**Answer: one server-side domain command, `POST /api/engagement-transition`, for every
stage, for every actor. No agent owns lifecycle writes; no client writes them.**

**This displaces a live behavior.** Today, `BusinessPortal.tsx` upserts an `engagements`
row directly through the Supabase client, and the owner-scoped RLS policies permit it —
**a partner org can currently mark itself `hackathon_ready` on day one**, skipping
budget, ethics, and scoping. This is an unfinished portal, not a defended-against abuse,
but it is live and unguarded today (tracked as gap **D22** in `crm/security.md`).

The command's contract:

```
POST /api/engagement-transition
  { businessId, toStage, evidence?, idempotencyKey }
→ 201 { engagementId, fromStage, toStage, transitionedAt, eventId }
```

One transaction: authenticate → derive `fromStage` server-side (never client-supplied) →
authorize the actor → evaluate the guard (a failed guard is `422` with the unmet condition
named, never a silent no-op) → check any required approval → write (complete the old
stage row, insert the new one, log an event) → fire side effects **after** commit, never
inside the transaction.

### 7.4 Forward transitions and their guards

| From → To | Actor | Guard | Approval |
|---|---|---|---|
| *(none)* → `initial_meeting` | System | Scout review approved, `composite_signal = Ready` | The Scout review itself |
| `initial_meeting` → `budget_check` | System, on contract sign | Immutable `engagement_contracts` row written | The signature is the approval |
| `budget_check` → `data_ethics_committee` | Staff | Budget amount confirmed non-null | Staff action (L2) |
| `data_ethics_committee` → `scoping` | Ethics Committee | Recorded `approvals` row | **Required — L3** |
| `scoping` → `hackathon_ready` | Staff | Assessment complete + ≥1 milestone exists | **Required — L3** |
| `hackathon_ready` → `membership` | Staff | All milestones completed or waived | **Required — L3** |

A stage can move **backward**, but only via a named reversal with a mandatory reason,
staff-only, never an edit — and it never deletes forward history. Skipping a stage
forward, a partner writing any transition, or any transition out of `membership`
(terminal) are all hard-rejected.

**Nothing here is implemented yet** — no applied migration enforces these rules. It's a
resolved design, not shipped code.

---

## 8. Agents

Status tags below (`BUILT, NOT WIRED` / `GAP` / `SPECIFIED`) are as of the
`ramsey-refactor` spec corpus, which is itself ahead of `tonys_branch`.

### 8.1 Scout — Qualification & Routing (`BUILT, NOT WIRED`)

Routes a public intake submission into one of five buckets (`Data Infrastructure`,
`Analytics & Insight`, `ML / Predictive`, `Tooling & Automation`, `Advisory / Strategy` —
Advisory is a genuine first tier, never a rejection path) plus an independent readiness
signal from three dimensions: **point-of-contact availability, problem clarity, data
foothold.**

**The composite rule — POC is decisive in both directions**, fixed 2026-08-21 (a
previous implementation made `'Not Ready'` structurally unreachable):

```ts
const sum = poc + clarity + foothold;
if (poc === 1 && sum > 3) return 'Not Ready';
if (poc === 1 || clarity === 1 || foothold === 1) return 'Conditional';
if (sum >= 7) return 'Ready';
return 'Conditional';
```

A strong POC carries readiness even with weak clarity/foothold; a floor POC routes `Not
Ready` regardless of how well-formed the rest of the intake is, with one exception — an
all-floor intake (thinly-filled form) stays `Conditional` for a human to read rather than
auto-rejecting.

**HITL:** `L2` iff `confidence === 'High' && composite_signal === 'Ready'`; `L3`
otherwise. Derived **server-side**, never model-supplied — the model schema must never
include `hitlTier` as a generated field. A `something_else` primary-need answer bypasses
auto-bucketing entirely (`bucket = null`, `hitlTier = 'L3'` always).

**Meeting intelligence** (specified, not built): transcript → `decisions[]` +
`action_items[]` via structured extraction. Transcripts are restricted data — never
logged, in any code path, including error/retry paths. A refused or truncated extraction
produces zero rows, never a partial set.

**Deterministic fallback:** `routeScoutIntake()` (currently `src/lib/scoutRouting.ts`) —
not a stub, the permanent fallback path when the model call fails, producing the
identical output shape.

### 8.2 Architect — Assessment & Delivery Planning (`BUILT, NOT WIRED`)

An 18-question Current-State Assessment (distinct from Scout's ~10-question intake),
scoring five maturity dimensions — Data Infrastructure (×2), Governance (×2), Tooling,
Decision Culture, Team Capacity — into a weighted composite (max 21; bands 7–11
Foundational / 12–16 Developing / 17–21 Established).

**This scoring is not an LLM stand-in.** It's a mechanical rubric by design — the
deterministic implementation *is* the real thing. A future model call would enrich
charter/plan narrative only, never the scoring itself.

**Override (Data Infrastructure only):** a Foundational DI score caps the composite at
Developing regardless of points — "you can't run a project on data that doesn't exist."
No equivalent override for Governance; a governance gap is real but not a structural
blocker the way a missing data foundation is.

**Mandatory flags:** DI or Governance at Foundational becomes a required, named
workstream — never generic "areas to improve" language. One flag runs alongside a scoped
deliverable; two flags make the 90-day plan remediation-only, with the stretch project
deferred to Phase 2.

**Cross-check:** a Foundational-maturity org in an `ML / Predictive` Scout bucket raises a
redirect-before-chartering flag rather than being quietly chartered around.

**Known gaps:** MOU and kickoff-deck generation are named as outputs in the original spec
but have **no implementation** — charter/plan generation only. No HITL tier or approval
flow is specified for Architect's output yet, unlike Scout's L2/L3 pattern (gap **D31**).

### 8.3 Pulse — Engagement Health (`GAP`, not built)

Computes `on_track` / `at_risk` / `stalled` from `engagement_events`, **no model call at
all** — this is deliberate: health here is threshold judgment over structured numbers,
exactly what code does better than a model, and staff need to be able to reproduce a flag
by hand.

**Pull-on-read**, not a scheduled sweep — computed when staff view an engagement, cheap
and always current.

Five ordered rules: no recorded history → `at_risk`, **never** `stalled` (absence of
evidence isn't evidence of stalling — every engagement starts here); silence ≥21 days →
`stalled`, ≥14 days → `at_risk`; stage overrun past that stage's window → `stalled`
independent of recency; a raised blocker can only ever *worsen* a verdict, never soften
one; a missing plan is context-only, never changes status.

**HITL: `L2`, always** — read-only, internal-facing only (contrast Envoy, which is
partner-facing). **Pulse does not write `engagements.stage`** — making the observer the
writer would make health signals self-fulfilling. **An at-risk signal does not
auto-trigger a communication draft** — it surfaces to staff, who decide whether to
initiate Envoy.

**Blocked on:** nothing currently writes `engagement_events` outside the (also unbuilt)
transition command — until a fuller producer lands, every engagement reads `at_risk` with
"no recorded activity" by default.

### 8.4 Envoy — Partner Communications (`GAP`, not built)

Templated partner communications with an optional model-polish step on body text only.
**Staff-initiated, always** — nothing fires on its own; this was chosen over both a fully
autonomous mode and an event-suggested mode (Pulse proposing a draft) as the first cut, on
the reasoning that an agent autonomously deciding *when* to contact a partner is a bigger
claim on the relationship than drafting on request.

Registered occasions: `kickoff`, `check_in`, `milestone_reached`, `at_risk_follow_up`,
`wrap_up`. The `at_risk_follow_up` template raises concerns as questions, never
accusations — Pulse infers from *recorded* activity, so a partner may have been working
the whole time with nothing logged.

**Two-step draft/confirm flow is how the L3 gate is enforced in the API, not just the
UI:** draft never sends or logs; only confirm sends and writes `communication_log`. A
model-polish failure falls back to template-only body and still routes through staff
confirmation — never auto-sent.

**HITL: `L3`, always.** `hitlTier` is omitted from the model schema so the model cannot
mark its own draft as needing no review.

### 8.5 Chronicle — Impact Synthesis & Institutional Learning (`GAP`, not built)

Synthesizes end-of-engagement case studies, lessons, and impact statements — gated by a
readiness check computed **before any model call**, deterministic, never model-supplied:

- **`not_ready`** — not completed, or no plan and no recorded activity. Returns empty
  fields and `notReadyReasons[]`; **the model is never called; no row is written.**
- **`thin`** — completed but sparse. A story may draft, but `provisional = true`, and the
  narrative states its own provisionality *in the prose* so a reviewer reading only the
  text still learns the record is thin.
- **`ready`** — full synthesis, `provisional = false`.

**This gate is the whole point of the agent's design.** Chronicle's failure mode isn't a
bad sentence — it's a confident, well-written public story about a named real nonprofit
that the record doesn't actually support. A `not_ready` result returns **nothing rather
than a placeholder**, deliberately, because a plausible short story is exactly what a
reviewer might wave through without scrutiny. `not_ready` is a **200**, not an error —
"there's nothing to write yet" is a correct answer.

**HITL: `L3`, always** — including a `not_ready` verdict, returned as a well-formed tiered
payload.

**The Chronicle → Scout feedback loop** is the strategic point of the whole system, and
its content shape is resolved even though it isn't built: a `lessons` row per completed
engagement, capturing `predicted_bucket`, `predicted_readiness`, `outcome`, and a
**computed** (not judged) `prediction_correct` boolean — because intake stored the
prediction and the completed engagement carries the outcome. Explicitly **not** built as
"Chronicle writes embeddings, Scout searches them" — similarity over prose returns things
that read alike, not things that predicted alike, and it can't be evaluated against
ground truth. A lesson is a candidate until a human promotes it; promoted lessons surface
to a staff reviewer as context, never as an automatic input that changes Scout's
deterministic rubric.

---

## 9. Contract & Consent Gate (Option B)

Once staff approve Architect's charter at the end of Stage 1, the nonprofit's authorized
rep must formally accept it before the roadmap advances — a different kind of gate from
everything else in this document: the client's own legal consent, not staff overseeing an
agent.

**Two options were weighed; Option B is recommended and specified:**

| | Option A — download/sign/email | Option B — preview & sign in-app (recommended) |
|---|---|---|
| Build cost | Zero — PDF + mailto | Real, but bounded |
| Stage-gating | Manual — someone has to notice the email and flip status by hand | Automatic — the signature event itself gates the transition |
| Audit trail | Depends on someone filing the reply correctly | Server timestamp + typed name become an immutable record automatically |

**Mechanism:** staff sends the charter for signature → partner opens the in-app signature
page → sees a read-only, versioned charter preview → types full legal name + title,
checks an acknowledgment box → `POST /api/contract-sign` → server validates the name
against the contact record → server generates the timestamp (**never** client-supplied —
the endpoint must reject any request body that includes `signedAt`) → writes one
`engagement_contracts` row, **immutable, no update path in the API or in RLS** → advances
`engagements.stage` to `budget_check` in the same transaction (both roll back together on
failure) → emails a PDF to the signer and `dssgnyc@gmail.com`.

**No DocuSign or external e-signature provider** — typed-name-plus-checkbox with a server
timestamp is the mechanism, generally considered sufficient under the U.S. ESIGN Act and
UETA for an agreement of this kind, pending a quick confirmation from DSSG's counsel once
real contract text exists.

The charter PDF shown at signing time is **pinned to the approved `architect_assessments`
version** — a later re-assessment does not retroactively change what a partner already
signed. Email failure after a successful transaction does **not** roll back the contract
or the stage transition — a legal signature doesn't get undone because a mail server
hiccupped; the failure is logged and retried out of band.

**Status:** fully specified (`platform/services/contract-consent.md`, delta rows **D9**,
**D27**), **not built**. Legal text itself is pending DSSG NYC counsel — the mechanism is
in scope; the actual clause language is not.

---

## 10. Security & Access Model

### 10.1 What's actually enforced today (on `ramsey-refactor`, not `tonys_branch`)

RLS is the authorization boundary; Postgres constraints are the correctness layer — both,
never either. All six applied tables have RLS **enabled and forced** (closing the
table-owner bypass). `is_admin()` is the single indirection every policy calls — no
policy inlines `role = 'admin'`, so re-pointing one function later beats rewriting twenty
policies. `anon` holds exactly one grant in the whole schema: `insert on scout_intakes`.

The inherited "Dirty Dozen" attack checklist (identity spoofing, resource hijacking,
privilege escalation, shadow-field injection, orphaned records, timeline bypass, resource
exhaustion, malicious IDs, PII leaks, state corruption, timestamp forgery, unverified
writes) is fully carried into RLS policy and, in several cases, structurally strengthened
— e.g. shadow-field injection is not merely checked but *impossible*, since Postgres has
a fixed column list.

### 10.2 Live, known gaps — not hypothetical

- **D22 — partner self-advancement.** Covered in §7.3: a partner org can write its own
  `engagements.stage` from the browser today, with no guard. This is the highest-priority
  security item in the whole corpus that has a designed fix (revoke the `INSERT`/`UPDATE`
  grant on `engagements` once the transition command ships) but zero defense in force
  right now.
- **Seven unbounded text columns** (`businesses.address`, `engagements.notes`,
  `engagements.hackathon_project`, `scout_intakes.review_notes`,
  `scout_intakes.onboarding_kit`, `architect_assessments.cross_check_flag`,
  `engagement_events.detail`) accept arbitrarily large strings from any authenticated
  writer. Bounded by auth, not by a length check — milestone **C6**, not started.
- **The RLS regression suite does not run.** 81 pgTAP assertions exist at
  `supabase/tests/_deferred/rls.test.sql.deferred` — the `.deferred` suffix means
  `supabase test db` doesn't collect them, so `make db-test` runs **zero assertions and
  exits green**. That's the worst failure mode a gate can have: a silent pass. ~28 of the
  81 could run today against the applied schema (milestone **C7**, not started); the rest
  are blocked on the tenancy decision (§10.3).

### 10.3 The access-model question layered on top of tenancy

`crm/access-model.md` (decided 2026-08-21, **not implemented**) proposes a third model on
top of the two already in tension in §5.1: three roles — **client**, **diplomat**
(volunteer, sees only assigned projects, cohort-bounded by a validity window), **admin**
— scoped to a new `projects` concept sitting between `businesses` and the work. This is
explicitly stated to supersede `_deferred/0003_tenancy.sql`'s organization model as "the
wrong shape" for what DSSG actually needs (a volunteer added to the org shouldn't see
every client's engagements). **How `projects` relates to `engagements` is itself an open
question** — three candidates are on the table (§15.1 goes into this).

---

## 11. Platform Infrastructure

| Component | Responsibility | Status |
|---|---|---|
| **Model gateway** (`src/model/gateway.ts`) | The one place any agent calls a model — one adapter (`@ai-sdk/google`, Gemini), telemetry, error classification, typed `GatewayError` with a per-failure-mode contract (schema-validation errors never retry; rate limits retry once; refusal/max-tokens are hard failures) | Specified; partially built on `ramsey-refactor` |
| **Observability recorder** (`src/observability/recorder.ts`) | Writes every model call to `agent_runs`/`tool_calls`, fire-and-forget so a recorder failure never blocks an agent response. Append-only; no raw prompt/output stored (that stays in domain tables); admin-only read | Specified, table deferred |
| **Eval harness** (`src/evals/`) | `registry.ts` fails the build if any roster agent has zero registered metrics. Deterministic heuristic graders run on every PR; LLM judges run pre-deploy. `targets.yaml` thresholds must come from a measured pass rate over ≥20 fixtures — an invented threshold is prohibited; ungated metrics report `UNGATED`, not a failure | Specified, not built |

**Quality ladder (Q0–Q5),** from `design-requirements.md` §15 — the release gate:

| Level | Check | Gate |
|---|---|---|
| Q0 | Unit/schema/permission tests | Required, every PR |
| Q1 | Golden-set regression | Required from Scout onward |
| Q2 | LLM-as-judge | Required, calibrated against human labels |
| Q3 | **Adversarial/safety** — prompt injection, tool abuse, data leakage | **Required — owner currently unassigned** |
| Q4 | Human acceptance | Required pre-production |
| Q5 | Production monitoring | Continuous |

**Q3 is a real, named gap, not aspirational hedging.** This platform grants agents tool
and MCP credentials and accepts free-text from anonymous submitters (Scout's public
intake) — adversarial testing is required by the platform's own threat surface, and it
has no owner today (§16 asks about this directly).

---

## 12. Integrations

**HubSpot is the CRM of record, committed, not a candidate.** The boundary that matters:

| Concern | System of record | Direction |
|---|---|---|
| Nonprofit org profile, contacts | HubSpot | HubSpot → Supabase (mirror, read-only) |
| Pipeline/deal stage | HubSpot | Supabase → HubSpot (push only) |
| **Engagement lifecycle state** | **Supabase, exclusively** | — |
| Intake submissions | Supabase | Supabase → HubSpot |
| Assessment/charter/plan | Supabase | Supabase → HubSpot (link + status only; full artifacts stay in Supabase) |

**The rule that matters:** HubSpot is where the *relationship* lives; Supabase is where
the *engagement state machine* lives. A stage transition is never triggered by an inbound
HubSpot webhook, ever — this is explicit and repeated across both the PRD and the
lifecycle spec. Sync runs through a shared plugin registry, not agent code, and every
external write is idempotent on a stable key so a retry can't double-create a contact.

Calendar and email follow the same rule: shared platform capabilities behind a registry,
never a per-agent integration. An agent reaching an external system directly is
classified as a defect, not a shortcut, because it forks the auth/retry/audit contract
once per agent.

---

## 13. Non-Functional Requirements

- **Budget:** under $50/month (Vercel + Supabase + Gemini, all free tier).
- **Team:** volunteer cohorts with high turnover — the system has to be learnable in a
  single session, which is as much a UX requirement as an onboarding one.
- **Timeline:** phased delivery by initiative (§14) — no single "ship everything" release.
- **Stack constraint:** single-repo TypeScript SPA on Vercel; Supabase Postgres; no
  Next.js, no multi-repo, no CrewAI/LangChain/LlamaIndex bundle (one thin model adapter
  until a measured need justifies more).
- **Security:** no secrets in the client bundle (the `VITE_` prefix is the literal
  boundary); HITL tiering always derived server-side; RLS everywhere, never key secrecy
  as the authorization mechanism.
- **Legal:** contract language pending DSSG NYC counsel; the mechanism is in scope, the
  text is not.
- **Idempotency:** every workflow write and external side effect must be idempotent on a
  stable key — a double-click must never double-advance a stage or double-send an email.

---

## 14. Delivery Plan

### 14.1 Initiatives (dependency-ordered, not calendar-ordered)

| # | Initiative | Goal | Depends on |
|---|---|---|---|
| I1 | Server Boundary & Scout End-to-End | Route every intake server-side with eval coverage and staff review | None — the keystone |
| I2 | Architect End-to-End | Structured assessment → charter → 90-day plan, staff-approved before reaching the nonprofit | I1 |
| I3 | Engagement Health & Lifecycle | Deterministic health signals, stage transitions, activity tracking | I1 |
| I4 | Contract & Consent Gate | In-app charter preview, e-signature, immutable record, auto stage transition | I2 |
| I5 | Chronicle & Learning Loop | End-of-engagement synthesis feeding back into Scout's onboarding kits | I2, I3 |
| I6 | Eval Harness & Quality Gates | Measurable quality contracts, CI/CD gating, production monitoring | I1, grows with each agent |

**Critical path: I1 → I2 → I4** — the shortest path to a signed charter. **Parallel
track:** I1 → I3 (health can start as soon as the server boundary exists). I6 is
cross-cutting from I1 onward.

### 14.2 Pilot definition

**One real user:** the next nonprofit that submits an intake through the live portal.
**One end-to-end slice:** public intake → server-side Scout routing → staff review →
Architect assessment → charter → contract signature → engagement created.

Success criteria: staff agrees with Scout's bucket ≥80% of the time; charter generated
within 30 seconds of CSA submission; staff approval adds no more than 5 minutes versus the
current ad-hoc process; a nonprofit signs the charter in-portal without a workaround.

---

## 15. Where the specs disagree with each other

Worth naming explicitly rather than silently picking a winner, since these are live,
unresolved tensions in the corpus this PRD was built from — not settled facts I'm
paraphrasing.

### 15.1 Tenancy — three designs, none built

Covered in §5.1/§10.3. This blocks more of the roadmap than any other single decision:
every RLS policy, the entire deferred pgTAP suite (§10.2), the GrantPilot shared-identity
goal in your §4.3, and the `projects`-vs-`engagements` relationship all sit downstream of
it. The corpus recommends resolving this *before* adding any more tables, "even though
the immediate goal is just getting the app running on Supabase for the tables that
already exist."

### 15.2 Three agents + services, vs. five agents

`docs/nonprofit-success-system-design.html` argues at length for consolidating Pulse and
Envoy into deterministic shared services (no independent reasoning loop needed for
threshold arithmetic or templated drafts). `design-requirements.md` ratifies five agents
instead, keeping Pulse and Envoy on the roster by name even while agreeing they're
deterministic/L3-gated respectively. The engineering behavior described for "Pulse the
service" and "Pulse the agent" is **identical** in both documents — this is a roster/
governance question (does it get its own plate, its own spec, its own eval line) more
than an implementation one. Worth confirming which framing you want this PRD and future
UI copy to use, since "agent" vs "service" language shows up in user-facing surfaces too
(§4.2's AI-content-indicator requirement).

### 15.3 Six stages vs. five

Resolved at the engineering level (six, §7.2) because every executable artifact already
implements six. But the same spec that resolves it flags that "six stages have not been
ratified by the team" — an engineering decision standing in for a team decision made
under time pressure. `data_ethics_committee` is named as the stage most likely to get
pushback.

---

## 16. Open Questions — needs your input

These are the genuinely unresolved items pulled from across the corpus that only you (or
DSSG leadership) can settle — not engineering choices I can make a call on.

1. **Which branch does this PRD live on?** It's currently a file in `tonys_branch`, which
   is Firebase-based and predates almost everything this document describes. Do you want
   `tonys_branch` rebased/merged onto `ramsey-refactor`'s work before continuing WS1
   screens, or is the plan to keep building here and reconcile later? This affects
   whether the "current state" sections above are read as "what I'll build against
   starting today" or "what I'm catching up to."
2. **Tenancy model (§5.1, §15.1)** — owner-scoped, organization-scoped, or the
   project-scoped three-role model? This is the single most blocking open decision in the
   project; everything downstream in the data model and RLS suite waits on it.
3. **Three-agent-plus-services vs. five-agent roster (§15.2)** — do you want the PRD, the
   UI copy, and future spec work to keep treating Pulse and Envoy as agents, or fold them
   into the "shared services" framing? Both describe identical engineering behavior; this
   is about how the product is presented and organized, including in the AI-provenance UI
   your §4.2 calls for.
4. **Contract legal text** — who at DSSG NYC drafts the actual agreement language, and by
   when? Blocks I4's content (the mechanism in §9 is fully designed; the words are not).
5. **Approved intake → auto-create Business + Engagement** — should this be automated as
   part of I1, or stay a manual step through the pilot?
6. **GrantPilot shared-identity timeline** — your §4.1 and §4.3 both assume a shared
   Supabase login with GrantPilot exists. No integration work has started on either side.
   When does this become real, and does it change the tenancy decision in question 2 (it
   likely forces organization-scoping)?
7. **Diplomat (volunteer) role rollout** — `access-model.md` decided the three-role model
   conceptually but left open how `projects` relates to `engagements` (three candidate
   shapes, §10.3). Do volunteers get portal access in the pilot, or is that explicitly
   post-pilot?
8. **Meeting transcription source** — which service feeds Scout's meeting-intelligence
   extension (Google Meet, Otter, manual paste)? Currently undesigned.
9. **Communications channel** — email only, in-portal messaging, or both, for Envoy?
10. **Q3 adversarial/safety testing owner (§11)** — currently unassigned, despite being a
    required gate on a platform that accepts anonymous free-text input and grants agents
    tool credentials. Who owns this before I6?
11. **`signatures` / `audit_events` tables** — needed for the pilot, or can they follow
    once volume justifies them? Affects I4's schema shape directly.
