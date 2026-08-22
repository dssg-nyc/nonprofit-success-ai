# PRD — Nonprofit Success AI

**Status:** Draft
**Reviewers:** Ramsey
**Design doc:** `.claude/specs/design-scope.md`

---

## §1 Executive Summary

Nonprofit Success AI is a CSM-grade lifecycle platform for every pro bono engagement
DSSG NYC runs — a React SPA backed by five focused AI agents (Scout, Architect,
Pulse, Envoy, Chronicle), and centralized evaluation. The
platform routes nonprofits from intake through assessment, planning, delivery, and
impact wrap-up, with human-in-the-loop oversight at every partner-facing decision.

**Ratified — the roster is five agents.** Scout, Architect, Pulse, Envoy, and Chronicle
are each agents. Pulse's health monitoring is deterministic threshold arithmetic — no
reasoning loop — but it remains an agent by roster. Envoy's communications drafting is
**L3, always**: every partner-facing draft requires staff approval before any send path
exists.

**Recommendation:** The system should be delivered as six initiatives (I1–I6) in
dependency order, not as a single release. I1 (Server Boundary & Scout) is the keystone
with zero external dependencies.

**Implementation is organized as three workstreams** (§5–§7). Jian is tech lead —
reviews and supports across all workstreams.

| # | Workstream | Owner | Concern |
|---|---|---|---|
| WS1 | Design & UX | Tony | Every surface a human touches |
| WS2 | Data Engineering | Karthik | Schema, RLS, migrations, tenancy, CI/CD, CRM/HubSpot sync |
| WS3 | Agentic / Platform | Ramsey | Five agents, model gateway, evals, knowledge, MCP, plugins |

HubSpot is the CRM of record; Supabase owns the engagement state machine. The boundary
between them (§7) is the single most consequential integration decision in this document.

## §2 Product Principles

Each principle is phrased as a test that can fail:

1. **Agents reason; services execute.** _Fails when:_ an agent writes directly to
   partner-visible state, owns a side effect, or orchestrates another agent.
2. **Every capability has one owner.** _Fails when:_ two components maintain independent
   data models for the same operational function (e.g., two task stores).
3. **AI never acts without a server boundary.** _Fails when:_ a model key is in the
   client bundle, an AI classification is writable from the browser, or HITL tiering is
   derived client-side.
4. **Human-in-the-loop is the design constraint, not an add-on.** _Fails when:_ a
   partner-facing action can complete without human approval at the appropriate tier.
5. **Deterministic fallback on every agent path.** _Fails when:_ a model call failure
   leaves the user with no result (the heuristic must produce the same output shape).
6. **Graceful degradation.** _Fails when:_ a service outage (model provider, database,
   integration) produces an error screen instead of a reduced-capability experience.
7. **Measure before you build infrastructure.** _Fails when:_ pgvector, a knowledge
   graph, a second model provider, or an orchestration framework is added before a
   measured workflow requires it.
8. **Skills, plugins, and MCPs are shared platform resources.** _Fails when:_ an agent
   module imports a vendor SDK directly, or two agents reach the same external system
   through different code paths.
9. **Every capability has one owner, one system of record, and one audit trail.**
   _Fails when:_ two systems both claim to own a field, or a state change lands with no
   record of who caused it.
10. **Memory promotion is explicit.** _Fails when:_ content from a run or conversation
    reaches durable shared knowledge without a human approval and an explicit scope.
11. **Quality is a release requirement, not a phase.** _Fails when:_ a change ships
    against an agent path with no Q0–Q3 coverage (§15), or an LLM judge is treated as
    sufficient authority for an irreversible action.

## §3 Target System Boundary

**Identity root:** `supabase.auth.users` — Supabase Auth is the single identity
provider. Every authenticated request resolves to an `auth.users.id`. Roles (`client`,
`admin`) are stored in `public.users.role` and enforced by RLS.

**Tenancy model:** Organization-scoped. Each `business` has an `ownerId` (immutable
after creation); each `engagement` belongs to a `business`. RLS policies enforce that
clients see only their own org's data; admins see all. There is no multi-tenant
partitioning beyond this — DSSG NYC is the single operator.

**Execution boundary:** The React SPA runs in the browser and calls Supabase directly
for CRUD operations protected by RLS. AI agent calls and privileged writes go through
Vercel Functions under `/api`, which hold model keys and the service-role Supabase
client. The browser never calls a model provider directly.

```
Browser (React SPA)
  ├── Supabase (anon key, RLS-protected reads/writes)
  └── /api (Vercel Functions)
        ├── Model provider (Gemini via AI SDK, server-only key)
        ├── Supabase (service-role key, privileged writes)
        └── Integration adapters (calendar, email — future)
```

## §4 User Experience Requirements

### Per-actor journeys

Detailed journeys are in the design doc §User Journeys (J1–J6). Key UX constraints:

| Actor | Device context | Time budget | Zero-data state |
|---|---|---|---|
| Prospective nonprofit | Mobile-first (form filled between meetings) | 5–7 min | Empty form with inline guidance |
| Staff reviewer | Desktop (queue scanning) | 2–3 min per intake | "No pending intakes" with CTA |
| Staff (engagement) | Desktop (dashboard) | 30 sec per engagement scan | "No active engagements" |
| Nonprofit signer | Any device (one-time legal action) | 5 min | N/A — only shown when charter exists |

### Accessibility

- WCAG 2.1 AA minimum
- Full keyboard navigation for all interactive elements
- Screen reader support: form labels, ARIA roles for dynamic content
- No time-limited interactions (form saves progress; contract has no timeout)
- Reduced-motion support (already in CSS: `prefers-reduced-motion`)

### Information hierarchy

- **Dashboard:** Health badge → org name → stage → days in stage (scannable in 10 sec)
- **Review queue:** Bucket → confidence badge → readiness signal → flags (actionable in 2 min)
- **Assessment results:** Composite level → dimension scores → charter → plan (decision-ready)

### Error states

- **Form validation:** Inline, per-field, as the user types — not on submit
- **Server error:** "Something went wrong — your data is saved. Try again in a moment."
- **Model failure:** Transparent — "AI classification unavailable; using deterministic routing"
  (never hide the fallback behind identical UI)

### Content design

- Agent-generated content is always visually distinguishable from human-written content
  (badge or subtle indicator — not a wall of disclaimers)
- `thin` Chronicle drafts state their own provisionality in the prose
- `not_ready` Chronicle returns nothing, not a placeholder (a plausible short story is
  the failure mode)

## §5 Workstream 1 — Design & UX: TONY

**Owns:** every surface a human touches — journeys, screens, states, accessibility,
approval and review surfaces, and the visual boundary between AI output and verified fact.

**Does not own:** the data those screens read, the server boundary that authorizes them,
or the integrations that populate them.

### Screens (existing, to be retargeted to Supabase)

| Screen | Component | Current state | Retarget in |
|---|---|---|---|
| Login / register | `Login.tsx` | Live (Supabase Auth) | — (done) |
| Dashboard | `Dashboard.tsx` | Live (reads `demoStore`) | I3 |
| Scout intake form | `ScoutIntakeForm.tsx` | Live (writes `demoStore`) | I1 |
| Scout review queue | `ScoutReviewQueue.tsx` | Live (reads `demoStore`) | I1 |
| Architect assessment | `ArchitectAssessment.tsx` | Live (reads `demoStore`) | I2 |
| Architect plan | `ArchitectPlan.tsx` | Live (reads `demoStore`) | I2 |
| Business portal | `BusinessPortal.tsx` | Live (reads `demoStore`) | I3 |

### New screens

| Screen | Initiative | Description |
|---|---|---|
| Contract preview + sign | I4 | Read-only charter terms + e-signature widget |
| Engagement health detail | I3 | Timeline, health reasons, current plan, contact info |
| Chronicle draft review | I5 | Impact memo + case study with approve/edit/reject actions |

### Shared UI requirements

- **AI content indicator:** Every model-generated field must carry a visual marker
  (the data requirement this implies: `agent_runs` must be joinable to the output)
- **Optimistic updates:** Form submissions show immediate feedback; server confirmation
  replaces the optimistic state
- **Component naming:** Flat under `src/components/`, prefixed by feature
  (`ScoutIntakeForm`, `ArchitectPlan`) — no feature subdirectories (target layout in CLAUDE.md)

### WS1 acceptance criteria

- A reviewer can approve, reject, or request changes without leaving the workflow
- No UI action bypasses backend authorization — every privileged write goes through `/api`
- A user can distinguish AI recommendations, retrieved evidence, and human-verified facts
- Consequential recommendations expose their evidence *before* the approval control
- Approval actions state the exact side effect before confirming
- Critical actions have visible success/failure states and an audit reference
- Every screen has a defined zero-data, loading, and error state (§4)
- WCAG 2.1 AA, full keyboard navigation, `prefers-reduced-motion` honored

## §6 Workstream 2 — Data Engineering: KARTHIK

**Owns:** the Supabase schema and RLS, migrations, tenancy, observability tables, CI/CD,
and CRM/HubSpot sync (moved from WS3 — see §7).

**Does not own:** the agents or their fallbacks (WS3 — Ramsey), what the screens look
like (WS1), or the model gateway/eval harness (WS3).

### Server boundary — Vercel Functions under `/api`

| Endpoint | Initiative | Purpose | HITL |
|---|---|---|---|
| `POST /api/route-intake` | I1 | Scout model classification + deterministic fallback | L2/L3 |
| `POST /api/architect-assess` | I2 | Architect scoring + charter + plan generation | L3 |
| `POST /api/envoy-draft` | (deferred) | Communications draft generation | L3 |
| `POST /api/chronicle-draft` | I5 | Impact synthesis + case study generation | L3 |
| `POST /api/contract-sign` | I4 | E-signature capture + immutable record + stage gate | — |
| `POST /api/meeting-extract` | I2 | Transcript → decisions + action items | L3 |

**Shared helpers** (leading underscore, not routes):
- `_env.ts` — environment validation, model key access
- `_http.ts` — error response factory, request validation

**Failure contract:** Every `/api` failure returns non-2xx **without a result body**,
so a half-filled AI output can never be mistaken for a real one. Status codes:
`400` (invalid input), `502` (model call failed), `503` (model key missing).

### Data model — Supabase Postgres

**Applied tables (6):**

| Table | Migration | Purpose |
|---|---|---|
| `users` | 0001 | Auth-linked profiles with role (`client`/`admin`) |
| `businesses` | 0001 | Registered organizations, owner-scoped |
| `engagements` | 0001 | Lifecycle stage records, one per business |
| `scout_intakes` | 0001 | Raw intake answers + Scout output + review decision |
| `architect_assessments` | 0001 | CSA answers + maturity scores + charter + plan |
| `engagement_events` | 0002 | Activity timeline for health computation |

**Deferred tables (in `_deferred/`, not yet applied):**

| Table | Deferred migration | Initiative |
|---|---|---|
| `organizations`, `organization_members` | 0003 | Future (GrantPilot shared identity) |
| `agent_runs`, `tool_calls` | 0004 | I6 (telemetry) |
| `approvals` | 0005 | I3/I4 (approval spine) |
| `documents`, `milestones`, `tasks` | 0006/0007 | I3 (delivery tracking) |

**Entities not yet specified (gap — see §17 Q12):**

| Table | Purpose | Why it is not `agent_runs` |
|---|---|---|
| `signatures` | Immutable signature events: signer identity, timestamp, document version + hash | A signature is a legal record, not model telemetry. It must reject writes after creation, including from admins |
| `audit_events` | Immutable operational/security trail — who did what, when, under which role | Answers "can this be disputed"; `agent_runs` answers "how did the model behave". Different retention, different access rules |
| `communications` | Operational communications (drafts, sends, delivery state) | Owned by the communications service; today it has no table at all |
| `calendar_events` | External calendar references | WS3-owned; the reference lives here, the sync lives in the plugin registry |

`engagement_contracts` (I4) currently carries the signature inline. Splitting `signatures`
out is what lets a contract be re-issued without destroying the record that the prior
version was signed.

**State machine constraints:**
- `engagements_enforce_transitions` trigger: a completed engagement cannot revert
- `engagement_contracts` (I4): once `status = 'signed'`, rejects all further writes
- `scout_intakes`: public write-once for intake data; admin-only for review fields
- `architect_assessments`: admin-only; requires matching `scout_intakes` row

### RLS summary

- `users`: read/write own profile only; role immutable after trigger-based creation
- `businesses`: owner-scoped; `ownerId` immutable after create
- `engagements`: owner-scoped; creation requires referenced business to exist
- `scout_intakes`: public insert (intake data only); admin read/list/update (review fields)
- `architect_assessments`: admin-only CRUD; no delete (audit trail)
- `engagement_events`: admin insert; owner + admin read

### Data engineering requirements

- Postgres constraints and typed schemas are the **first** correctness layer — not
  application validation, which a second caller can skip
- RLS carries tenant and role boundaries; every business entity has explicit organization
  ownership
- Operational data is separated from AI telemetry and evaluation datasets
- Prompts, models, policies, and schemas are versioned
- Migrations live in source control; no manual schema drift
- Workflow writes and external side effects are idempotent
- Reliable external delivery uses an outbox/event pattern rather than an inline call
- Retention, deletion, export, and audit requirements are defined per entity

### WS2 acceptance criteria

- Every privileged write is authorized server-side; no service-role key reaches the browser
- HITL tier is derived server-side for every agent path — a model cannot self-assign L2
- Every agent path has a deterministic fallback producing the same output shape
- Every `/api` failure returns non-2xx **without** a result body
- An immutable record (signature, approval, completed stage) rejects later writes, verified by test
- `make gate` (type-check, lint, test, build) passes on every PR

## §7 Workstream 3 — Agentic / Platform: RAMSEY

**Owns:** the five agents and their deterministic fallbacks, the model gateway, HITL
tiering, the eval harness, the knowledge base, codemap indexer, MCP server, and
skills/plugin registries.

**Does not own:** the canonical operational schema (WS2), CRM integrations (WS2 — Karthik
owns HubSpot sync), or any UI (WS1).

**Note:** CRM & HubSpot sync stays with WS2 (Karthik) because the sync boundary between
HubSpot and Supabase is a data-engineering concern — it lives in the schema, not in the
agent layer. The plugin registry that CRM writes through is WS3 (Ramsey), which keeps
the seam visible.

### HubSpot — CRM of record

HubSpot is committed, not a candidate. The sync boundary:

| Concern | System of record | Direction | Conflict rule |
|---|---|---|---|
| Nonprofit org profile, contacts | HubSpot | HubSpot → Supabase | HubSpot wins; Supabase mirror is read-only |
| Pipeline / deal stage | HubSpot | Supabase → HubSpot | Engagement stage transition pushes; HubSpot never drives lifecycle |
| Engagement lifecycle state | Supabase | — | Supabase only. `engagements.stage` is the state machine (§6) |
| Intake submissions | Supabase | Supabase → HubSpot | Approved intake creates/updates the HubSpot contact |
| Assessment output, charter, plan | Supabase | Supabase → HubSpot (summary only) | Full artifacts stay in Supabase; HubSpot gets a link and status |
| Communications log | HubSpot | Bidirectional | Last-write-wins on the log; never on lifecycle state |

**The rule that matters:** HubSpot is where the *relationship* lives; Supabase is where the
*engagement state machine* lives. A stage never advances because HubSpot said so — it
advances because `/api` verified the precondition and wrote the transition (§12 CF3).

Sync runs through the plugin registry, not from agent code. All writes are idempotent on a
stable external key so a retry cannot double-create a contact.

### Integration ownership

Calendar, email, CRM synchronization, events, and marketing are **shared platform
capabilities**. Agents invoke approved operations through shared skills, plugins, and MCP
servers; they do not own separate implementations. An integration reached directly from
agent code is a defect, not a shortcut — it forks the auth, retry, and audit contract once
per agent.

### WS3 acceptance criteria

- No agent module imports a vendor SDK directly; every external call goes through a registry entry
- Every external write is idempotent on a stable external key
- Every tool/MCP invocation writes a `tool_calls` audit row with scope and outcome
- HubSpot sync failure degrades gracefully — the engagement proceeds, the sync retries
- No integration credential is reachable from the browser
- A stage transition is never triggered by an inbound external webhook alone

## §8 Model boundaries & deployment

### Model boundaries

| Agent | Model call | Deterministic fallback | Server-only |
|---|---|---|---|
| Scout | `generateObject` — bucket + confidence + rationale | `routeScoutIntake()` — keyword/heuristic scoring | Yes (`/api/route-intake`) |
| Architect | `generateObject` — charter + plan from CSA answers | `generateCharter()` / `generatePlan()` — template-based | Yes (`/api/architect-assess`) |
| Pulse | No model call — deterministic only | Threshold arithmetic over `engagement_events` | Yes (`/api/pulse-health`) |
| Envoy | `generateObject` — communications draft, template-based fallback | Template-based draft | Yes (`/api/envoy-draft`) |
| Chronicle | `generateObject` — impact memo + case study | `generateChronicleDraft()` — template-based | Yes (`/api/chronicle-draft`) |
| Meeting intel | `generateObject` — decisions + action items | Hard failure (no fallback — extraction without a model is not useful) | Yes (`/api/meeting-extract`) |

### Model adapter

One adapter: `@ai-sdk/google` (Gemini). Key: `GOOGLE_GENERATIVE_AI_API_KEY` (server-only,
no `VITE_` prefix). Free tier likely covers this app's volume.

**Do not add:** LangChain, LlamaIndex, LiteLLM, CrewAI, or a second provider SDK
until a measured workflow requires it. The AI SDK abstracts the provider, so switching
is a small change.

### Knowledge retrieval

**Phase 1 (I5):** Postgres `SELECT` over approved `documents` + `lessons` tables with
full-text search. Source IDs stored with every AI-generated recommendation.

**Phase 2 (deferred):** `pgvector` for semantic retrieval, only when there is enough
history to justify it. No knowledge graph until multi-hop questions arise.

### Deployment topology

- **Hosting:** Vercel (SPA + Functions)
- **Database:** Supabase (managed Postgres)
- **CI:** GitHub Actions — `ci.yml` on PR (type-check, lint, test, build), `cd.yml` on
  push to main (deploy to production)
- **Eval gates:** `eval-heuristics` on PR, full judge harness before deploy (commented
  into both workflows, land with I6)

## §9 Responsibility Matrix

### Agent boundaries

What each agent does **not** own is as load-bearing as what it does:

| Agent | Primary responsibility | Shared capabilities it uses | Does not own |
|---|---|---|---|
| Scout | Qualification, readiness, routing | Retrieval, skills, MCPs, model gateway, approvals | Tasks, calendar, CRM persistence |
| Architect | Assessment, planning, scoping | Retrieval, skills, MCPs, contract service, approvals | Independent task/calendar stores |
| Pulse | Engagement health monitoring, activity tracking | `engagement_events` reads, model gateway (none) | Stage transitions, communications |
| Envoy | Partner communications drafting | Skills, MCPs, model gateway, approvals | Operational CRM state, send authority |
| Chronicle | Impact synthesis, lessons, knowledge candidates | Retrieval, memory, evaluation, approvals | Operational CRM state |

### Capability ownership

Applying "agents reason; services execute" through each capability:

| Capability | Owner | Type | Rationale |
|---|---|---|---|
| Intake classification | Scout | Agent | Requires reasoning over free-text answers |
| Readiness scoring | Scout | Deterministic | Threshold arithmetic — no model needed |
| HITL tier derivation | Platform (`/api`) | Service | Must be server-side; model cannot self-assign |
| Assessment scoring | Architect | Deterministic | Dimensional scoring from structured answers |
| Charter generation | Architect | Agent | Requires narrative synthesis from scores + answers |
| 90-day plan generation | Architect | Agent | Requires plan shape selection + milestone synthesis |
| Meeting extraction | Architect (input) | Agent | Structured extraction from unstructured transcript |
| Health monitoring | Pulse | Agent (deterministic) | Threshold arithmetic over structured event data |
| Activity tracking | Pulse | Agent (deterministic) | `engagement_events` CRUD — no model call |
| Stage transitions | Platform (state machine) | Service | Database trigger — no agent involvement |
| Partner communications | Envoy | Agent | Templates + AI draft, L3-gated |
| Impact synthesis | Chronicle | Agent | Cross-engagement reasoning for case studies |
| Knowledge retrieval | Knowledge service | Service | Postgres query — no agent reasoning |
| Contract signing | Platform (`/api`) | Service | Server timestamp + immutable write — no AI |
| Eval grading | Eval harness | Service | Deterministic graders + LLM judges |
| Telemetry | Observability | Service | `agent_runs` writes — no reasoning |
| Approval queue | Platform | Service | One centralized surface for all agents |

## §10 Platform Registries

Shared capabilities live in registries so that authorization, retry, and audit are decided
once rather than once per agent. **Every registry below is a target, not current state —
none exist in the tree today.** They land with I6 unless noted.

| Registry | Holds | "Approved" means | State |
|---|---|---|---|
| Skills | Versioned reusable business capabilities | Declared schema, permission scope, preconditions, and a passing test | Target (I6) |
| Plugins | Packaged external integrations behind a consistent interface | Idempotent writes, credential server-side, failure degrades gracefully | Target (I6) — HubSpot is the first entry |
| MCP catalog / gateway | Governed MCP servers and tools | Authenticated, scoped, logged, rate-limited | Target (I6) |
| Policy | Approval, safety, data-access, and side-effect rules | Enforced server-side, versioned | Partially live — HITL tiering exists, unversioned |
| Schema | Shared typed agent/tool contracts | Versioned, validated at the boundary | Partially live — `src/schemas/` is planned, not written |
| Model gateway | Server-side model selection, fallback, cost/latency tracking | Single call path; per-agent model calls are a defect | Target — `src/model/` in CLAUDE.md layout |

**The measurement that justifies each:** a registry earns its existence at the *second*
consumer. One agent calling HubSpot needs a module; two agents calling HubSpot need a
registry. Do not build the registry ahead of the second consumer — but do not let the
second consumer land without it.

## §11 Agent Memory & Knowledge

### Memory tiers

| Tier | Holds | Lifetime | Scope |
|---|---|---|---|
| Working | Context for one run or session | The run | Request |
| Episodic | Engagement events, decisions, outcomes, interaction summaries | Engagement lifetime | Organization + engagement |
| Semantic / shared | Approved organizational knowledge retrieved through RAG | Durable | Organization, subject to classification |

### The promotion gate

**Agents must not silently promote run or conversation content into durable shared
memory.** Promotion from episodic to semantic requires:

1. A human approval (Chronicle's L3 review, §12 CF4 step 6)
2. An explicit scope — organization, engagement, and classification
3. Provenance retained through the promotion, not summarized away

A `thin` or `not_ready` Chronicle draft is never promotable regardless of approval; the
readiness gate precedes the human gate.

### Retrieval provenance

Every retrieved item carries **source, version, tenant/scope, document status, and
provenance**. A recommendation whose evidence cannot be traced back to an approved
document is unreviewable — so this is a schema requirement on `documents`, not a UI
concern. Source IDs are stored with every AI-generated recommendation.

**Phase 1 (I5):** Postgres full-text search over approved `documents`. **Phase 2:**
`pgvector`, once there is enough history to measure retrieval quality against. **Deferred
indefinitely:** a knowledge graph — until a demonstrated multi-hop relationship query
exists that full-text and vector search both fail.

## §12 Critical Flows

### CF1 — Scout Intake (public write → server-side classification → staff review)

1. Anonymous user submits intake form → `POST /api/route-intake`
2. Server validates input against `ScoutRoutingInput` schema
3. Server calls model (`generateObject`) → on failure, calls `routeScoutIntake()` deterministic fallback
4. Server computes `composite_signal` and `hitlTier` from structured output (never model-supplied)
5. Server writes `scout_intakes` row with both intake data and routing output (single transaction)
6. Server returns `ScoutResult` to client (bucket, confidence, readiness, rationale)
7. Staff reviewer sees intake in queue → approves, edits, or redirects
8. Review decision written as admin-only update to `scout_intakes` row

**Irreversibility:** The intake write is idempotent (upsert on submission). The review
decision is an update, not a delete — the original routing output is preserved.

### CF2 — Architect Assessment (staff-conducted → server-side scoring → charter + plan)

1. Staff fills 18-question CSA in-portal → `POST /api/architect-assess`
2. Server validates input, scores 5 maturity dimensions deterministically
3. Server calls model for charter + plan generation → on failure, uses template-based fallback
4. Server writes `architect_assessments` row (requires matching `scout_intakes` row)
5. Staff reviews generated charter + plan → approves or edits before it reaches the nonprofit

### CF3 — Contract Signing (charter → preview → e-signature → immutable record)

1. Staff approves charter (CF2 step 5)
2. Nonprofit rep opens contract view → sees charter terms + plan summary
3. Rep types full name + title, checks acknowledgment
4. `POST /api/contract-sign` with `engagementId`, `signerName`, `signerTitle`
5. Server generates `signedAt` timestamp (server clock, never client)
6. Server writes `engagement_contracts` row, locks it immutable
7. Server transitions `engagements.stage` from `initial_meeting` → `budget_check`
8. Server generates PDF, emails to signer + dssgnyc@gmail.com

**Irreversibility:** Once `status = 'signed'`, the record rejects all further writes
including from admins. The stage transition is a forward-only state machine.

### CF4 — Chronicle Impact Synthesis (completed engagement → readiness gate → draft)

1. Engagement reaches `status = 'completed'`
2. Staff triggers Chronicle → `POST /api/chronicle-draft`
3. Server runs `assessChronicleReadiness()` — `not_ready` returns 200 with empty fields (no model call)
4. If `ready`/`thin`: server calls model → on failure, uses template-based fallback
5. `thin` drafts state provisionality in the prose — "based on limited recorded activity"
6. Staff reviews → approves, edits, or marks insufficient
7. Approved artifacts enter knowledge base with provenance tags

## §13 Migration / Consolidation

### Done (residual cleanup only)

| Item | State | Residual |
|---|---|---|
| Firebase → Supabase Auth | Complete | None — `firebase` removed from `package.json` |
| Firestore → Supabase Postgres | Complete | `supabase/reference/` holds port source docs for audit |
| Firebase security rules → RLS | Complete | 98 `-- rules:NN` citations in `0001_init.sql` point to `firestore.rules` |

### Open (genuinely unplanned)

| Item | Blocks | Owner |
|---|---|---|
| `demoStore.ts` → Supabase reads | Each screen; retire per-initiative | EM |
| `src/lib/` agent logic → `src/agents/` | I1 (Scout move), I2 (Architect move) | EM |
| `src/types.ts` → `src/types/` directory | Any initiative that adds wire types | EM |
| `src/components/` flatten (remove feature subdirs) | Cosmetic; do per-initiative | EM |
| GrantPilot shared identity | Future — no current integration | EM + GrantPilot team |

## §14 Delivery Plan

### Pilot

**One real user:** The next nonprofit that submits an intake through the live portal.
**One end-to-end slice:** Public intake → server-side Scout routing → staff review →
Architect assessment → charter → contract signature → engagement created.
**Success criteria:**
- Intake routed correctly (staff agrees with Scout's bucket) in ≥80% of cases
- Charter generated within 30 seconds of CSA submission
- Staff approval adds no more than 5 minutes to the process vs. current ad-hoc
- Nonprofit signs charter in-portal without needing a workaround

**Date:** Tied to I1 + I2 + I4 completion, not a calendar date.

### Deliverables by workstream

| Part | Workstream | Owner | Primary deliverables |
|---|---|---|---|
| 1 | Design & UX | Tony | Auth shell, dashboard, Scout review queue, Architect workflow, contract preview/signing, engagement/task views, accessibility |
| 2 | Data Engineering | Karthik | Supabase schema/RLS, migrations, tenancy, observability tables, CI/CD, HubSpot CRM sync |
| 3 | Agentic / Platform | Ramsey | Five agents + fallbacks, model gateway, HITL tiering, eval harness, knowledge base, codemap, MCP server, plugin registry |

## §15 Quality Ladder

| Level | Check | Applies to | Gate | Owner |
|---|---|---|---|---|
| Q0 | Unit / schema / permission tests | Code, tools, RLS, structured outputs | Required — every PR | Karthik (schema/RLS) + Ramsey (agents) |
| Q1 | Golden-set regression | Scout, Architect, Chronicle; prompts, retrieval | Required — I1 onward | Ramsey |
| Q2 | LLM-as-judge | Quality, relevance, completeness, groundedness | Required, calibrated against human labels | Ramsey |
| Q3 | **Adversarial / safety** | Prompt injection, tool abuse, data leakage | Required — **owner unassigned, see §17 Q11** | **TBD** |
| Q4 | Human acceptance | High-impact workflows and UX | Required pre-production | Tony + Ramsey |
| Q5 | Production monitoring | Drift, errors, latency, cost, staff override rate | Continuous | Ramsey |

**Concrete thresholds:**

| Gate | Threshold | Blocks |
|---|---|---|
| Type-check | 0 errors | Every PR |
| Lint | 0 errors | Every PR |
| Unit tests | 100% pass | Every PR |
| Golden-set regression (Scout) | No regression from baseline | I1 onward |
| Golden-set regression (Architect) | No regression from baseline | I2 onward |
| LLM judge (Scout) | ≥ target score in `targets.yaml` | I1 onward |
| LLM judge (Architect) | ≥ target score in `targets.yaml` | I2 onward |
| LLM judge (Chronicle) | ≥ target score + `proportionate` dimension | I5 onward |
| Adversarial suite | 0 successful injections reaching a side effect | I6 onward |
| Staff override rate | < 30% (measured, not gated initially) | Production monitoring |

**LLM judges are not the sole authority for high-impact actions.** Deterministic checks,
permission checks, policy checks, and human approval remain authoritative wherever an
action is irreversible or partner-facing. A passing Q2 never substitutes for Q0 or Q4.

**Q3 is a real gap.** This platform grants agents tool and MCP credentials (§10) and
accepts free-text from anonymous submitters (§12 CF1). Adversarial testing is therefore
required, not aspirational — and it currently has no owner.

## §16 Review Checklist

| # | Reviewer must assess | Section |
|---|---|---|
| 1 | ~~Is the 3-agent + services consolidation the right call?~~ **Ratified — five agents.** Scout, Architect, Pulse, Envoy, Chronicle. ~~Q9 resolved.~~ | §1, §9 |
| 2 | Is the initiative ordering (I1 → I2 → I4 critical path) correct? | §14, design doc §Dependency Map |
| 3 | Are the HITL tiers correctly assigned? (L2 for Scout high-confidence, L3 for everything else) | §8, §12 |
| 4 | Is the failure contract (non-2xx without body) the right pattern for all endpoints? | §6 |
| 5 | Is the `not_ready` Chronicle returning 200 (correct answer) vs. error (failure) the right choice? | §12 CF4 |
| 6 | Should approved intake → Business + Engagement creation be automated in I1 or kept manual? | §17 Q2 |
| 7 | Is the contract signing mechanism (typed name + checkbox) legally sufficient? | §12 CF3 |
| 8 | Are the quality gate thresholds realistic? | §15 |
| 9 | ~~Is the three-workstream split right, and does Karthik owning both WS2 and WS3 hold?~~ **Resolved 2026-08-22** — WS2 = Karthik (DE + CRM), WS3 = Ramsey (Agentic/Platform). Jian = tech lead/reviewer. | §5–§7 |
| 10 | **Is the HubSpot sync boundary correct — specifically that lifecycle stage never advances from HubSpot?** | §7 |
| 11 | **Who owns Q3 adversarial/safety testing?** | §15 |
| 12 | Is the memory promotion gate strict enough for partner-confidential content? | §11 |
| 13 | Are `signatures` and `audit_events` needed for the pilot, or can they follow? | §6 |

## §17 Open Decisions

| # | Decision | Blocking? | Blocks | Target date | Who |
|---|---|---|---|---|---|
| 1 | Contract legal text — who drafts? | **Yes** | I4 content (mechanism is designed) | Before I4 execute | DSSG NYC counsel |
| 2 | Approved intake → auto-create Business + Engagement? | No | I1 scope (manual works for pilot) | I1 plan | PM |
| 3 | GrantPilot shared identity — when? | No | Schema decisions (deferred `0003_tenancy`) | TBD | EM + GrantPilot |
| 4 | Meeting transcription source for pilot | No | I2 meeting-intelligence scope | I2 plan | EM |
| 5 | Communications channel (email, in-portal, both) | No | Deferred (communications service) | Post-pilot | PM + Des |
| 6 | `compositeSignal()` Not-Ready bug fix | No | I1 (Scout move) | I1 execute | EM |
| 7 | Shared services scope for I3 (task service, calendar) | No | I3 plan | I3 plan | PM + EM |
| 8 | `demoStore.ts` retirement strategy (per-screen or dedicated pass) | No | Each initiative | I1 plan | EM |
| 9 | ~~Pulse/Envoy as agents vs. services — final call~~ | ~~**Blocking**~~ | **Resolved — both are agents** | 2026-08-22 | PM + EM |
| 10 | HubSpot sync direction per field — ratify §7 table | No | WS2 first plugin entry | Before I3 | Karthik + PM |
| 11 | **Q3 adversarial/safety owner** | **Yes** | I6 eval harness scope; nothing gates injection today | Before I6 plan | PM |
| 12 | `signatures` / `audit_events` — pilot or post-pilot? | No | I4 schema shape | I4 plan | Karthik |
| 13 | Registry timing — build at second consumer, or up front with I6? | No | WS3 sequencing | I6 plan | Ramsey |
| 14 | Does the memory promotion gate need a classification taxonomy for partner-confidential data? | No | I5 (Chronicle → knowledge base) | I5 plan | PM + Ramsey |
