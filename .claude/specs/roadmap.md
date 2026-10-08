# Delta registry — the single owner of D and C numbers

**Status:** Active. Created 2026-08-21 to end a namespace collision; restructured 2026-10-08 to
follow the ownership plan (milestones M0–M6, one GitHub issue per person).

This file **owns** every delta number in this repo. Component specs cite these numbers; none
mints its own. Build state is recorded here and nowhere else — a spec's `Status` line points at
its rows.

## The rule

- **`D{n}` — build items.** Something to write, wire, or migrate.
- **`C{n}` — crm decisions.** Resolved by *deciding*, not building.
- **Never renumber. Only append.** Issues, plans and specs cite these; a renumber rebinds every
  citation. Rows move between sections below as state changes; the number never changes.
- **A spec cites, never mints.** Add the row here first, then cite it. Local milestone labels in
  a spec (`M1`, `M2` in `crm/security.md`) are not registry numbers.
- **`R{n}`, `T{n}`, `#{n}`** are the ownership plan's work packages and the GitHub issues
  (`.claude/docs/research/ownership-plan.md`, git-ignored). They group rows; they do not replace
  them. Plate numbers (`C3.1` …) live only in each spec's header.

Why this exists: before this file, `.claude/specs/` and the generated design record each
minted `D1`–`D18` independently and agreed on none of them
([`delta-namespace-decision.md`](../docs/delta-namespace-decision.md)).

---

## Where things stand

| Milestone | Scope | Owner · issue | State 2026-10-08 |
|---|---|---|---|
| M0–M3 | `main` is the truth; local schema; validation harness; Scout and Architect end-to-end (R1–R5) | Ramsey · #26 | Built, staged on `agent-validation` |
| M4 | Pulse, lifecycle command, draft persistence, provenance chain (R6–R8, R12) | Ramsey · #26 | Built, staged; DB verified by pgTAP 2026-10-08 |
| M4 | Hosted Supabase + Vercel envs + CD secrets | Jian · #27 | Open — blocks every "hosted" step |
| M4 | Migrations review and sign-off, then `db push`; access-model, contract and PII decisions | Carlos · #28 | Open — blocked by #27 for the push |
| M5 | Lessons, eval completion, hardening + CI, adversarial tests (R9–R11, R13) | Ramsey · #26 | Built, staged; judge job needs #27's keys |
| M2–M5 | Screens for the five agents | Tony · #29 | Open |
| M5 | Production monitoring (B2) | Jian · not filed | Blocked by #27, #28 |
| M6 | Knowledge base | Jian decides · #30 | Decision pending; nothing built |

"Validated" for an agent means: the SPA calls its `/api` route with the deterministic fallback
proven by a test; a golden set of ≥ 20 hand-authored cases; fallback and model graded on the same
fixtures; the `targets.yaml` threshold set at the measured rate; `make gate` and
`eval:grade --gate` green.

---

## D — build items

### Built — M0–M5, Ramsey (#26)

Everything here is on `agent-validation`, migrations applied locally and covered by the pgTAP
suite (green 2026-10-08). "Hosted" means nothing until #27 and #28 land.

| # | Item | Landed | Spec |
|---|---|---|---|
| D1 | Server boundary — `api/route-intake.ts`, model key server-side, bearer auth (`api/_auth.ts`), anonymous sign-in for the public form (0001_core); the route files the intake through `submit_scout_intake()` (0007) and the browser never writes `scout_intakes` | R1 2026-08-22, SPA wired R4 2026-10-06, server-side write 2026-10-08 | `platform/agents/scout.md` |
| D2 | Architect end-to-end — `api/architect-plan.ts`, idempotent replay, model enrichment over the `buildTemplate()` fallback | R5 2026-10-06 | `platform/agents/architect.md` |
| D3 | Model gateway — `src/model/gateway.ts`, failure ladder, provider abstraction | R1 2026-08-22, hardened R2/R3 | `platform/infra/model-gateway.md` |
| D4 | Observability — `agent_runs` recorder, `0001_core.sql` | R2 2026-08-22 | `platform/infra/observability.md` |
| D47 | API hardening — request id on every log line and `x-request-id` (`api/_request.ts`), uncaught throws → logged 500, `cost_cents` from `src/model/pricing.ts`, per-user hourly model budget (`check_model_budget()`, 0007, 429), `health` probes Supabase (503 when unreachable); drain/alerts/dashboard stay D44 | 2026-10-08 | `stack/vercel-functions.md`, `platform/infra/observability.md` |
| D5 | Approval spine — `deriveHitlTier()`, `0002_approvals.sql` (queue UI is D26 / #29) | R2 2026-08-22 | `design-system.md` §2 |
| D6 | Wire contracts — `src/schemas/`, `z.infer` types for Scout, Architect, Envoy, Chronicle, Pulse | R2–R8, complete 2026-10-07 | `design-system.md` §2 |
| D7 | Scout to `src/agents/scout/` + first test suite | R1 2026-08-22 | `platform/agents/scout.md` |
| D8 | Architect to `src/agents/architect/` + tests | R1 2026-08-22 | `platform/agents/architect.md` |
| D10 | Envoy agent — `src/agents/envoy/draft.ts`, `api/envoy-draft.ts`; drafts persisted L3-gated via `submit_envoy_draft()` (0004_drafts) | R1 2026-08-22, persistence R8 2026-10-07 | `platform/agents/envoy.md` |
| D11 | Chronicle agent — readiness gate, model synthesis, `api/chronicle-draft.ts`; drafts via `submit_chronicle_draft()` (0004_drafts) | R1 2026-08-22, persistence R8 2026-10-07 | `platform/agents/chronicle.md` |
| D12 | Eval harness — graders + judges, six heuristic metrics gated at 1.0, `eval-heuristics` job in `ci.yml` | R3 2026-08-22, CI R11 2026-10-07 | `platform/infra/eval-harness.md` |
| D13 | Pulse agent — `computePulseSignal()`, `api/pulse-health.ts`, deterministic only | R2 2026-08-22, API R6 2026-10-07 | `platform/agents/pulse.md` |
| D15 | Chronicle → Scout feedback — `promoted_lessons` + `src/lib/lessons.ts` at review time (UI is #29) | R9 2026-10-07 (0004_drafts) | `platform/agents/chronicle.md` |
| D16 | `engagement_events` producer — `transition_engagement()` appends one event per transition | R7 2026-10-07 (0005_lifecycle) | `crm/lifecycle.md` §2 |
| D17 | Stage enum ratification — six stages | Resolved 2026-08-21 | `crm/lifecycle.md` §1 |
| D18 | `engagements.stage` writer — the transition command owns it | Resolved 2026-08-21, enforced in 0001_core | `crm/lifecycle.md` §2 |
| D19 | `POST /api/engagement-transition` — guards, events, idempotency, L3 approval row | R7 2026-10-07 (0005_lifecycle) | `crm/lifecycle.md` §2 |
| D20 | Provenance — `provenance_source` columns on AI content (0004_drafts), `engagement_events.approval_id` (0003_delivery), `scout_intakes` routing provenance (0001_core), `provenance_chain` view (0006_views) | R8 + R12 2026-10-07 | `crm/data-model.md` §7 |
| D21 | Chronicle learning artifact — `lessons` with prediction/outcome, `promote_lesson()` | R9 2026-10-07 (0004_drafts) | `platform/agents/chronicle.md` |
| D22 | Trust boundary — partner writes to `engagements` revoked; the self-transition hole found 2026-08-21 is closed | R7 2026-10-07 (0001_core) | `crm/security.md` §2a |
| D23 | Scout eval suite — `scoutRouting` 21 cases gated at 1.0; `scoutRationale` judge UNGATED | R4 2026-10-06 | `platform/agents/scout.md` |
| D24 | Architect eval suite — `architectScoring` 25, `architectPlanStructure` 23 gated at 1.0; `architectCharter` judge UNGATED | R5 2026-10-06 | `platform/agents/architect.md` |
| D31 | Architect HITL gate — `submit_architect_draft()` (0004_drafts), direct writes revoked (0001_core), approval badge | R5 2026-10-06 | `platform/agents/architect.md` |

### Open — Ramsey

| # | Item | State | Blocked by | Spec |
|---|---|---|---|---|
| D25 | Chronicle eval suite — readiness fixtures gated (`chronicleReadiness`); the three judge dimensions and the κ protocol need a keyed run and two blind raters | PARTIAL · κ protocol spec'd R10 | D28, #29 raters | `platform/agents/chronicle.md` |
| D28 | Eval CI — `eval-heuristics` and `db-test` live in `ci.yml`; the judge job (`eval-judge`, R14) and measured judge thresholds remain | PARTIAL | #27 secrets | `platform/infra/eval-harness.md` |
| D42 | Anonymous-to-member conversion — an intake visitor who later signs up keeps the `auth.users` row but `handle_new_user` never fires; needs an on-update trigger or first-sign-in provisioning before sign-up from the intake flow ships | GAP · accepted 2026-10-07 | — | `platform/agents/scout.md` Rules; 0001_core |
| D45 | `POST /api/send-communication` — the Envoy send step: provider, `sent_at`, the L4 question | GAP (R16) | #28 provider decision, D10 | `platform/agents/envoy.md` |
| D46 | `achievedOutcomes?: string[]` on `ChronicleInput` — Chronicle reads achieved outcomes from `engagement_events`; until then the template's `outcomes` stays empty and a success criterion is quoted as the definition of success, never promoted to an outcome | GAP (R17, 2026-10-08) | — | `platform/agents/chronicle.md` |

### Open — Tony (#29), logic wiring by Ramsey (R15)

| # | Item | State | Blocked by | Spec |
|---|---|---|---|---|
| D26 | `demoStore` → Supabase — review queue, CSA form, engagement detail still read `src/lib/demoStore.ts`; approval queue UI (from D5), lessons review UI (from D15) | PARTIAL · 3 components left | — | `platform/agents/scout.md`, `architect.md` |
| D27 | In-app contract signature UI — charter preview + typed-name form (stub until D9) | GAP | D9 | `platform/services/contract-consent.md` |

### Open — Carlos (#28): decide first, then file the build

| # | Item | State | Blocked by | Spec |
|---|---|---|---|---|
| D9 | Contract & Consent gate — `engagement_contracts`, server timestamp, immutable write, PDF + email provider | SPECIFIED | #28 provider decision | `platform/services/contract-consent.md` |
| D29 | Tenancy — three roles, project-scoped; replaces 0001_core's org model (the pgTAP assertion labelled `KNOWN WRONG` flips when it lands) | SPECIFIED, deferred | C1, C2 | `crm/access-model.md`, `crm/data-model.md` |
| D35 | HubSpot CRM sync — bidirectional, idempotent | PARKED · placeholder in `.claude/docs/research/hubspot-mcp.md`; re-spec here before building | D29 | — |

### Open — Jian

| # | Item | State | Blocked by | Spec |
|---|---|---|---|---|
| D43 | Hosted deployment — Supabase project, Vercel envs (`VITE_` client, service-role and model keys server-only), Actions secrets, `cd.yml` preview + `--prod`, `api/health` 200 on both | OPEN (#27) | — | `stack/environments.md` |
| D44 | Production monitoring — log drain ≥ 30 days, alert on `agent_run_metrics` error/fallback rate, one dashboard, auto-pause runbook | NOT FILED (B2) | D43, #28 | `platform/infra/observability.md` Q5 |

### M6 — Knowledge base, gated on #30 (Jian decides)

Nothing here is filed or built until #30 records go / no-go, what goes in, and who approves access.
The three build issues may be redefined by that answer.

| # | Item | Package | Blocked by | Spec |
|---|---|---|---|---|
| D40 | Code-embedding storage decision — symbol vectors in `document_chunks` or beside `code_symbols` | KB-1 (decide in the migration) | #30 | `platform/knowledge.md` §8 |
| D37 | Knowledge schema — pgvector, `document_chunks`, org-scoped RLS mirroring `documents` (0003_delivery) | KB-1 | #30, D29 | `platform/knowledge.md` |
| D32 | Retrieval — `src/knowledge/`, hybrid search, `/api/knowledge-search` | KB-1 | D37 | `platform/knowledge.md` |
| D38 | Retrieval eval — recall@10 on a golden set, registered in `src/evals/registry.ts` | KB-1 | D32 | `platform/knowledge.md` |
| D41 | Degraded-arm retrieval eval — recall@10 with FTS unavailable | KB-1 | D38 | `platform/knowledge.md` §7 |
| D33 | Ingestion — manual staff upload first, redaction before embedding; Granola as a second adapter once #30 confirms its export | KB-2 | KB-1, #28 privacy | `platform/knowledge.md` |
| D39 | Redaction log — per-chunk rule id, span offsets, timestamp | KB-2 | D33 | `platform/knowledge.md` §5 |
| D14 | Scout meeting intelligence — summaries only, folded into ingestion | KB-2 | #28 privacy | `platform/agents/scout.md` §2 |
| D30 | Codemap indexer | **Dropped** pending #30 — developer tooling, no user | — | `platform/knowledge.md` |
| D34 | `/api/mcp` read-only MCP server | **Dropped** pending #30 | — | `platform/knowledge.md` |
| D36 | Plugin registry, `tool_calls` audit | **Dropped** pending #30 | — | `platform/knowledge.md` |

Retrieval as an agent tool (KB-3: Scout and Architect get a search tool and an eval shows quality
improves) gets its D-number when KB-1 and KB-2 are filed.

---

## C — crm decisions

All four land as comments on #28 before any migration is written.

| # | Decision | State | Blocks | Spec |
|---|----------|-------|--------|------|
| C1 | Tenancy model — owner-scoped vs organization-scoped vs project-scoped three-role model | OPEN · recommendation in `crm/access-model.md` | D29, every RLS policy | `crm/data-model.md` §1 |
| C2 | `projects` vs `engagements` — how a project relates to the stage rows | OPEN | C1, `unique (business_id, stage)` scope | `crm/access-model.md` |
| C3 | Stage-name ratification with the team — `data_ethics_committee` is the one most likely to be questioned | OPEN · engineering settled by D17 | nothing structurally | `crm/lifecycle.md` §1 |
| C4 | Reversal past a signed contract — does re-advancing require a new signature? | OPEN · needs counsel, not design | backward transitions across a signed charter | `crm/lifecycle.md` §10 |

---

## Adding an entry

1. Append a row with the next free number (next: **D48**, **C5**). Never reuse, never renumber.
2. Put it in the section for its owner and milestone; move it to **Built** when it lands, keeping
   the number.
3. Cite it from the spec as `D19` — do not restate the description.
