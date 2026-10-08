# Architect Agent
**Plate:** C3.2 in docs/nonprofit-success-system-design.html
**Status:** see `roadmap.md` D2, D8, D24, D31 (built) — build state lives only in the registry and in CLAUDE.md
**PRD sections:** §5, §6, §7, §9 CF2

> Engineering note: scoring is `src/agents/architect/scoring.ts`, the templates
> `src/agents/architect/plan.ts`, the model path `src/agents/architect/model.ts`, and the
> SPA's submit logic `src/agents/architect/draft.ts`. Served by `POST /api/architect-plan`
> (`api/architect-plan.ts`). Unit-tested under `src/agents/architect/__tests__/` and
> `api/__tests__/architect-plan.test.ts`; graded by `architectScoring`,
> `architectPlanStructure` and `architectCharter` (`src/evals/`). Supersedes
> `architect-design.md` (tracked at `docs/architect-design.md` since 2026-10-08; superseded source).

## Responsibility

Scores nonprofit data maturity across five dimensions and generates an engagement charter
and 90-day plan. The scoring is fully deterministic — the model call enriches background
prose and milestone wording; plan shape and maturity level are derived, never model-supplied.

## §1 Current-State Assessment (CSA v2)

18 questions, conducted after Scout's handoff, distinct from Scout's ~10-question intake:

- **§1 Organization context** (Q1–Q3) — narrative only, not scored.
- **§2 What data you have** (Q4–Q8) → **Data Infrastructure**.
- **§3 How data gets used** (Q9–Q11) → **Decision Culture**.
- **§4 Reporting and accountability** (Q12–Q13) → **Governance**.
- **§5 Tools and capacity** (Q14–Q16) → **Tooling** (Q14) and **Team Capacity** (Q15–Q16).
- **§6 Goals and readiness** (Q17a/b, Q18) — narrative and risk-flagging only; feeds the
  charter's background and risk sections directly.

Nine of the eighteen questions feed scoring directly (Q4, Q6, Q7, Q8, Q11, Q13, Q14,
Q15, Q16); the rest are narrative inputs to the charter.

## §2 Maturity model

**Not a stand-in for an LLM call.** The spec itself defines this as a mechanical rubric
("Points-Primary with Targeted Override + Flag") — the deterministic implementation *is*
the real thing, not a fallback. A future model call would enrich charter/plan narrative,
not the scoring.

### Dimensions and scoring

| Dimension | Foundational (1) | Developing (2) | Established (3) |
|---|---|---|---|
| Data Infrastructure (×2) | Q4 not systematic, or Q6 "own island," or Q8 not confident | anything else | Q6 "most share automatically" + Q8 "very confident" + Q7 "very familiar" |
| Governance (×2) | Q13 not automated | Q13 semi-automated | Q13 mostly automated |
| Tooling (×1) | no CRM, no reporting tool | has one of CRM/reporting tool | has both CRM and reporting tool |
| Decision Culture (×1) | Q11 not empowerment-based | Q11 leadership/managers | Q11 anyone with access |
| Team Capacity (×1) | Q15 low comfort + Q16 case-by-case | anything else | Q15 dedicated staff + Q16 fast budget |

**Finding — Tooling's middle tier is broader in code than the spec's rubric table states.**
`architect-design.md`'s rubric describes Developing as "has a CRM or case tool, no
dedicated reporting tool" specifically. The shipped `scoreTooling()` scores Developing for
*either* a CRM-without-reporting-tool *or* a reporting-tool-without-CRM — the second case
isn't named in the original rubric. The function's own inline comment acknowledges this:
"Reporting tool without a CRM isn't in the rubric — treated as Developing." Carried here
as an intentional, code-documented extension of the spec, not a silent divergence.

### Composite: Points-Primary with Targeted Override + Flag

1. **Score each dimension** 1/2/3 per the rubric above.
2. **Weighted composite** — Data Infrastructure ×2, Governance ×2, Tooling/Decision
   Culture/Team Capacity ×1 each (max 21). Bands: 7–11 Foundational, 12–16 Developing,
   17–21 Established. Matches `bandFromPoints()` exactly.
3. **Override, Data Infrastructure only** — a Foundational DI score caps the composite at
   Developing regardless of points total. "You can't run a project on data that doesn't
   exist." The override is scoped to DI alone: a Governance gap is a real problem but not
   a structural blocker the way a missing data foundation is.
4. **Mandatory flags** — DI or Governance at Foundational becomes a required, named
   workstream in the charter, independent of whether the override triggered.
5. **Remediation scoping** — 1 flag runs alongside a scoped deliverable; 2+ flags makes
   the 90-day plan remediation-only, with the stretch project deferred to Phase 2.

**Cross-check against Scout** — a Foundational-maturity org holding an `ML / Predictive`
bucket from Scout is a redirect-before-chartering signal (`crossCheckFlag` in
`scoreAssessment()`), not something the plan quietly charters around.

All five steps, the override scope rationale, and the cross-check are implemented verbatim
in `scoreAssessment()` (`src/agents/architect/scoring.ts:84-128`) — no drift found between spec and
code at the composite-logic level.

### Validated edge cases

Four profiles from `architect-design.md` exercise the override, single-flag, and
remediation-only paths:

1. Paper-based org — Foundational on both DI and Governance → both flags mandatory.
   `architect-design.md` called this remediation-only, but a paper-based org's composite
   is Foundational, and the Rules put level first: it gets `build_basics`, carrying both
   flagged workstreams (see §4). Remediation-only is reachable only at Developing
   (profile 4).
2. Mixed-maturity org — Governance-only flag → named workstream runs alongside deliverable.
3. Well-resourced-but-siloed org — DI Foundational despite high points → override triggers,
   composite capped at Developing.
4. Dual-gaps-strong-capacity org — both flags → remediation-only regardless of capacity
   scores.

Each profile is now an executable case: `architectScoring` (25 cases) covers the scoring
surface and `architectPlanStructure` (23 cases, `fixtures/architectCharter.jsonl`) the
plan each one produces.

## §3 Output

Deterministic charter and 90-day plan generation (`generateCharter()` /
`generateNinetyDayPlan()`), shaped by composite level and the remediation-scoping rule:

| Composite | Plan shape | Headline |
|---|---|---|
| Foundational | `build_basics` | Build the basics — no analysis promised yet |
| Developing, remediation-only | `remediation_only` | Flagged workstreams are the deliverable; stretch project deferred to Phase 2 |
| Developing, not remediation-only | `ship_deliverable` | Ship one concrete deliverable, flagged workstream (if any) runs alongside |
| Established | `accelerate` | Accelerate toward a leadership-locked success metric, possibly multi-phase |

Each shape has its own three-phase (Days 1–30/31–60/61–90) milestone structure. The
charter additionally produces scope statement, objectives, risks (including the cross-check
flag and override note when triggered), success criteria, and cadence — all derived from
the same `MaturityResult`.

**MOU and kickoff deck are named as charter outputs in `architect-design.md` but have no
corresponding generation code** — `ArchitectCharter`'s shape covers title, background,
scope, objectives, workstreams, risks, success criteria, and cadence only. Recorded as a
gap, not fixed here (see §4 Open items).

## §4 Open items

- **MOU / kickoff deck templates** — no implementation; `architect-design.md` itself
  flagged these as not-yet-drafted.
- **Team Capacity / Governance question-to-dimension mapping** — `architect-design.md`
  flagged this as unconfirmed against any build-side schema; the shipped `CsaScoredAnswers`
  type is now that schema, but no separate confirmation/sign-off is recorded.
- **Cross-check does not stop the charter.** The Rules say a Foundational org on an
  `ML / Predictive` bucket is "redirect signal, do not charter", and the flag text says the
  same, but `generateCharter()` still produces a `build_basics` charter — with the
  cross-check as its first risk — and the route submits it for approval. Either the rule
  is "charter the basics and lead with the redirect" (what the code does) or the route
  should refuse to draft. Undecided; the L3 approval is the stop today.
- **Cross-check runs after the DI override.** `scoreAssessment()` caps an Established
  `di_score === 1` org at Developing before evaluating the cross-check, which only fires at
  Foundational — so the two never co-occur. Correct by construction today, but the order
  is load-bearing and not stated anywhere but the code.
- **A re-submit after approval leaves the approval in place.** `submit_architect_draft()`
  (0004_drafts) expires only *pending* approvals for the assessment. Re-conducting an assessment
  whose charter was already approved writes a new pending approval beside the approved
  one; the approved row is not expired or reopened, so the plan page shows the new
  pending draft while an approval for the old content still exists.
- **Edge-case 1 conflict, resolved in code, not in `architect-design.md`.** See §2
  "Validated edge cases": a Foundational org with both flags is `build_basics`, not
  `remediation_only`. The Rules and `plan.test.ts` agree; the source doc does not.
- *Fixed in R5:* an Established org with a Governance flag (di=3, gov=1, others 3 — 17
  points) lost its required Reporting Automation workstream on the `accelerate` plan while
  the charter's risks still called it non-skippable. `generateNinetyDayPlan()` now carries
  flagged workstreams on every shape; caught by `architectPlanStructure`
  (`established-governance-flag`).

**Decided — human review.** Architect's output is **L3**: the model drafts, a staff
member approves. `POST /api/architect-plan` never sets the tier from model output;
`submit_architect_draft()` (0004_drafts) writes the assessment, a pending `charter` approval and
the `architect.draft_submitted` audit event in one transaction, and `ArchitectPlan` shows
the approval's state. Direct client writes to `architect_assessments` are revoked (0001_core).

## Contract

- **Input:** 18 CSA answers — Section 1: `q1_org_context`, `q2_org_size`, `q3_poc`
  (narrative); Section 2 (DI): `q4_collection_scope`, `q5_data_locations`,
  `q6_system_integration`, `q7_integration_familiarity`, `q8_quality_confidence`;
  Section 3 (DC): `q9_current_decisions`, `q10_wished_decisions`,
  `q11_decision_empowerment`; Section 4 (Gov): `q12_reporting_to`,
  `q13_reporting_automation`; Section 5 (Tooling+TC): `q14_tools[]`,
  `q15_staff_confidence`, `q16_budget_speed`; Section 6 (Goals): `q17a_wish_list`,
  `q17b_biggest_worry`, `q18_past_blockers`. Plus `scoutIntakeId` (FK required).
- **Output:** `MaturityResult` (di_score, gov_score, tooling_score, dc_score, tc_score,
  points, compositeLevel, overrideApplied, flaggedDimensions[], remediationOnly,
  crossCheckFlag) + `ArchitectCharter` + `NinetyDayPlan`
- **Side effects:** Through `submit_architect_draft()` only, in one transaction: upserts
  the `architect_assessments` row (id = the intake id; CSA answers + scoring output +
  generated documents), expires any older pending approval for it, inserts one pending
  `approvals` row (`entity_type 'charter'`, keyed by `idempotency_key`), and writes one
  `architect.draft_submitted` audit event. The model call writes one `agent_runs` row via
  the gateway — `fallback` when it fails — linked from the approval. A replay of the same
  idempotency key writes nothing and returns the stored result.

## Rules

- Assessment requires a matching `scout_intakes` row (`scoutIntakeId` FK). Cannot assess an org that has not been intake-reviewed.
- No delete on `architect_assessments` — rows are permanent audit trail. Org admins read;
  only `submit_architect_draft()` writes (INSERT/UPDATE revoked from `authenticated`, 0001_core).
- HITL is **L3**, always: the draft is pending staff approval, and a model cannot raise it.
- Every path saves a draft: a model failure saves `buildTemplate()` (`source: 'fallback'`).
- Plan shape is derived: `compositeLevel === 'Foundational'` → `build_basics`; `remediationOnly` → `remediation_only`; `compositeLevel === 'Developing'` (and not remediationOnly) → `ship_deliverable`; `compositeLevel === 'Established'` → `accelerate`. Model must not generate `shape`.
- DI override: `di_score === 1 && compositeLevel === 'Established'` → cap to `Developing`, set `overrideApplied = true`.
- Remediation-only: `flaggedDimensions.length >= 2` (both DI and Governance at Foundational).
- Cross-check flag: `compositeLevel === 'Foundational' && scoutBucket === 'ML / Predictive'` → redirect signal, do not charter. (The code still drafts a `build_basics` charter that leads with the redirect — §4 open item.)
- DI and Governance Foundational scores become named required workstreams in the charter and the plan, at every composite level — never generic "areas to improve" language. A `build_basics` plan with nothing flagged carries one required workstream, Data Foundations ("Stand up the collection, storage and first summary the plan describes"), so `workstreams` is never empty.
- Every deliverable and success criterion traces to a flagged dimension, the bucket, or a sentence in the assessment (prompt `architect-plan-0.04`). The templates promise no funder-facing improvement and no maturity level ("Developing level"); the dashboard deliverable is for "the workflow the assessment names as most manual", and the model names that workflow from the assessment text. Gated by `architectGrounding` (R17, 2026-10-08).
- Tooling's Developing tier covers either-direction pairing (CRM without reporting tool, or reporting tool without CRM) — this is a documented, intentional extension of the original rubric.

## Dependencies

- **Imports:** `src/types/` (barrel: ArchitectAssessment, MaturityResult, ArchitectCharter, NinetyDayPlan, CompositeLevel, FlaggedDimension, ScoutBucket, ArchitectPlanRequest/Response); `src/schemas/`; `src/model/gateway.ts` (which records `agent_runs` through `src/observability/recorder.ts`); `src/guardrails/hitl.ts`
- **Imported by:** `api/architect-plan.ts`; `ArchitectAssessment.tsx` (via `draft.ts` and `/api/architect-plan` — never `model.ts`); `ArchitectPlan.tsx` (`approvalBadge`); `src/evals/`
- **Data:** `architect_assessments` table (`supabase/migrations/0001_core.sql`, which also revokes client writes); `scout_intakes` (FK); `approvals` + `audit_events` (`submit_architect_draft()`, `0004_drafts.sql`); `agent_runs` (`0001_core.sql`)

## Delta rows

Cited from [`roadmap.md`](../../roadmap.md) — this spec does not mint numbers.

- **D2** — Architect end-to-end: `/api/architect-plan`, model enrichment — **BUILT** (R5) · local only, not on a hosted project
- **D8** — move Architect to `src/agents/architect/` — SPECIFIED
- **D24** — Architect eval suite: scoring edge cases + charter generation — **BUILT** (R5, partial) · `architectScoring` and `architectPlanStructure` gated at 1.0; `architectCharter` judge unmeasured
- **D31** — Architect HITL gate — **BUILT** (R5) · L3 via `submit_architect_draft()`, local only
- **D26** — `demoStore` → Supabase retarget for CSA form and engagement detail — SPECIFIED

## Test contract

- Scoring edge cases: one fixture per composite level (Foundational/Developing/Established), DI override trigger, remediation-only trigger (both DI+Gov at 1), cross-check flag (Foundational + ML/Predictive bucket).
- Plan shape: all four shapes generated from the correct composite/remediationOnly combinations.
- Charter generation: all composite levels produce valid ArchitectCharter with correct scopeStatement, correct risk entries for flaggedDimensions and crossCheckFlag.
- Remediation-only flag: `phase2Note` present, no stretch deliverable in workstreams.
- `overrideApplied` true when points ≥ 17 but `di_score === 1`.
- Tooling edge cases: reporting-tool-without-CRM → Developing (code extension confirmed); neither tool → Foundational; both tools → Established.

## Open questions

1. Meeting intelligence (transcript extraction) as Architect input — which transcription service, and does it flow in as `q1_org_context` or as a separate pre-fill step?
2. MOU / kickoff deck templates — implementation deferred; when does this become scope?
3. ~~Human review UI~~ — **decided:** L3 via `submit_architect_draft()`; see §4 "Decided — human review".
4. Q-to-dimension mapping confirmation — `CsaScoredAnswers` is the de facto schema; a formal sign-off on the Team Capacity / Governance mapping is still unrecorded.

## Requirement Trace

| Old requirement | Source | Now at | Status |
|---|---|---|---|
| 18-question CSA, six sections | `architect-design.md` §CSA | §1 | Carried |
| Five scored dimensions + rubric | `architect-design.md` §Maturity Model | §2 | Carried |
| Weighted composite, bands 7-11/12-16/17-21 | `architect-design.md` §Composite Step 2 | §2 / `bandFromPoints()` | Carried |
| Data Infrastructure override | `architect-design.md` §Composite Step 3 | §2 / `scoreAssessment()` override logic | Carried |
| Mandatory flags (DI/Governance) | `architect-design.md` §Composite Step 4 | §2 / `flaggedDimensions` | Carried |
| Remediation scoping rule | `architect-design.md` §Composite Step 5 | §2 / `remediationOnly` | Carried |
| Tooling rubric (CRM-or-reporting = Developing) | `architect-design.md` rubric table | §2 | Carried, widened — code scores either-direction pairing as Developing; spec only named one direction |
| Cross-check against Scout bucket | `architect-design.md` §Cross-check | §2 / `crossCheckFlag` | Carried |
| Charter + 90-day plan generation | `architect-design.md` §Output | §3 / `generateCharter()`, `generateNinetyDayPlan()` | Carried |
| Downstream effect by composite level table | `architect-design.md` §Downstream effect | §3 | Carried |
| MOU generation | `architect-design.md` §Output | §3 | Dropped — no generation code exists; charter/plan only |
| Kickoff deck generation | `architect-design.md` §Output | §3 | Dropped — no generation code exists |
| Validated edge-case profiles (4) | `architect-design.md` §Validated edge cases | §2 | Carried; executable in `architectScoring` / `architectPlanStructure`. Profile 1 corrected to `build_basics` |
| Charter/MOU/kickoff templates open item | `architect-design.md` §Still open | §4 | Carried — still open |
| Q-to-dimension mapping confirmation open item | `architect-design.md` §Still open | §4 | Carried — still open |
| Human review UI open item | `architect-design.md` §Still open | §4 | Resolved — L3 via `submit_architect_draft()` (R5) |
