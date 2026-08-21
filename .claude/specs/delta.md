# Delta registry — the single owner of D and C numbers

**Status:** Active. Created 2026-08-21 to end a total namespace collision.

This file **owns** every delta number in this repo. Component specs and the generated
design record both **cite** these numbers; neither mints its own.

## The rule

- **`D{n}` — build items.** Something to write, wire, or migrate. Platform, agents,
  services, infra, schema.
- **`C{n}` — crm decisions.** Questions about the data model and its access rules whose
  answer shapes the schema. A `C` is resolved by *deciding*; a `D` by *building*.
- **Never renumber. Only append.** Issues, milestones, and plan docs cite these; a
  renumber silently rebinds every citation.
- **A spec cites, never mints.** Writing `- D19: …` in a component spec is how the
  collision happened. Add the row here first, then cite it.
- **The design record renders its Delta tab from this file.** `/design-system` must not
  invent its own numbering.

### Why this exists

Before this file, `.claude/specs/` and `docs/nonprofit-success-system-design.html` each
minted `D1`–`D18` independently and agreed on **none** of them — `D1` was both "server
boundary" and "Scout's `/api/route-intake`"; `D17` was both "stage enum ratification" and
"Communications service implementation". No number was safe to cite. Full collision table:
[`.claude/docs/delta-namespace-decision.md`](../docs/delta-namespace-decision.md).

Numbers below are seeded from the design record generated 2026-08-21 22:10, which was the
most complete of the two namespaces and already carried dependency order.

---

## D — build items

| # | Item | State | Needs first | Plate | Spec |
|---|------|-------|-------------|-------|------|
| D1 | Server boundary — `api/route-intake.ts` with model key in server env | SPECIFIED | D3 | C3.1 | `platform/agents/scout.md` |
| D2 | Architect end-to-end — `api/` endpoint, model enrichment | SPECIFIED | D1, D3 | C3.2 | `platform/agents/architect.md` |
| D3 | Model gateway — `src/model/gateway.ts`, failure ladder, provider abstraction | SPECIFIED | — | C4.P | `platform/infra/model-gateway.md` |
| D4 | Observability — `agent_runs` + `tool_calls` tables + recorder | SPECIFIED | D3 | C4.P | `platform/infra/observability.md` |
| D5 | Approval spine — `approvals` table + `deriveHitlTier()` + approval queue | SPECIFIED | D3 | C4.P | `design-system.md` §2 |
| D6 | Wire contracts — `src/schemas/` with versioned types crossing `/api` | GAP | D1 | C4.P | `design-system.md` §2 |
| D7 | Move Scout to `src/agents/scout/` + first test suite | SPECIFIED | — | C3.1 | `platform/agents/scout.md` |
| D8 | Move Architect to `src/agents/architect/` | SPECIFIED | — | C3.2 | `platform/agents/architect.md` |
| D9 | Contract & Consent gate — server timestamp, immutable write | SPECIFIED | D3 | C4.3 | `platform/services/contract-consent.md` |
| D10 | Communications Service — draft + delivery, `communications` table | GAP | D3, D5 | C4.2 | `platform/services/communications-service.md` |
| D11 | Chronicle agent — readiness gate + model synthesis + eval judge | GAP | D3, D4 | C3.3 | `platform/agents/chronicle.md` |
| D12 | Eval harness — turn on `targets.yaml` thresholds, gate CI | SPECIFIED | D1 | C4.P | `platform/infra/eval-harness.md` |
| D13 | Health Service — `computeEngagementHealth()` | SPECIFIED | — | C4.1 | `platform/services/health-service.md` |
| D14 | Scout meeting intelligence — transcript extraction | SPECIFIED | D1, D7 | C3.1 | `platform/agents/scout.md` §2 |
| D15 | Chronicle → Scout feedback loop | GAP | D11 | C3.3 | `platform/agents/chronicle.md` |
| D16 | `engagement_events` producer — nothing writes events yet | GAP | D19 | D1 | `crm/lifecycle.md` §2 |
| D17 | Stage enum ratification — six stages | **RESOLVED** 2026-08-21 | — | C2.1 | `crm/lifecycle.md` §1 |
| D18 | `engagements.stage` writer — who owns lifecycle transitions | **RESOLVED** 2026-08-21 | D17 | C2.1 | `crm/lifecycle.md` §2 |
| D19 | `POST /api/engagement-transition` — the transition command: guards, events, idempotency | SPECIFIED | D5 | C2.1 | `crm/lifecycle.md` §2 |
| D20 | Provenance columns on AI-generated content + the run→approval→transition chain | GAP | D4 | D1 | `crm/data-model.md` §7 |
| D21 | Chronicle learning artifact — `lessons` entity with prediction/outcome fields | GAP | D11, D15 | C3.3 | `platform/agents/chronicle.md` |
| D22 | Trust-boundary enforcement — close the partner self-transition hole | GAP | D19 | C4.S | `crm/security.md` §2a |
| D23 | Scout eval suite — golden-set regression fixture + grader (incl. the two `compositeSignal` boundary cases) | GAP | D12 | C3.1 | `platform/agents/scout.md` |
| D24 | Architect eval suite — scoring edge cases + charter generation fixture | GAP | D12 | C3.2 | `platform/agents/architect.md` |
| D25 | Chronicle eval suite — readiness-gate fixtures, three judge dimensions (grounded, proportionate, clear) | GAP | D12 | C3.3 | `platform/agents/chronicle.md` |
| D26 | `demoStore` → Supabase retarget — intake form, review queue, CSA form, engagement detail | SPECIFIED | — | C4.P | `platform/agents/scout.md`, `architect.md` |
| D27 | In-app contract signature UI — charter preview + typed-name form | GAP | D9 | C4.3 | `platform/services/contract-consent.md` |
| D28 | Eval CI integration — `eval-heuristics` job in `ci.yml`, `eval-judge` in `cd.yml` | GAP | D12 | C4.P | `platform/infra/eval-harness.md` |

**D17 and D18 are resolved, not built.** They were decisions, and `crm/lifecycle.md`
answered them. The *work* they implied is D19. They keep their numbers because prior
documents cite them.

**D22 is a live authorization gap, not a future feature.** A partner org can currently
write its own lifecycle state from the browser — marking itself `hackathon_ready` on day
one, skipping budget, ethics, and scoping. Found 2026-08-21; `crm/security.md` §2a carries
it as a vector with no defense in force.

---

## C — crm decisions

| # | Decision | State | Blocks | Spec |
|---|----------|-------|--------|------|
| C1 | Tenancy model — owner-scoped vs organization-scoped | OPEN | every RLS policy | `crm/data-model.md` §1 |
| C2 | `projects` vs `engagements` — how a project relates to the stage rows | OPEN | C1, `unique (business_id, stage)` scope | `crm/access-model.md` |
| C3 | Stage-name ratification with the team — `data_ethics_committee` is the one most likely to be questioned | OPEN | nothing structurally; D17 settled the engineering | `crm/lifecycle.md` §1 |
| C4 | Reversal past a signed contract — does re-advancing require a new signature? | OPEN — needs counsel, not design | backward transitions across a signed charter | `crm/lifecycle.md` §10 |

---

## Adding an entry

1. Append a row here with the next free number. Never reuse, never renumber.
2. Cite it from the spec as `D19` — do not restate the description.
3. If it needs a plate in the design record, name the plate in the table.
