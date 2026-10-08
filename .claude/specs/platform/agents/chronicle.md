# Chronicle Agent
**Plate:** C3.3 in docs/nonprofit-success-system-design.html
**Status:** see `roadmap.md` D11, D15, D21 (built), D25 (eval suite gap) — build state lives only in the registry and in CLAUDE.md
**PRD sections:** §7, §9 CF4

> Engineering note: no code in this repo yet — `src/agents/chronicle/` and
> `api/chronicle-draft.ts` do not exist. The Scout feedback loop is specified (§6), not built.
> Scoped from `design-system.md` §2 and the 2026-08-06 meeting.

## Responsibility

Synthesizes end-of-engagement artifacts — case study narrative, lessons learned, and
impact summary — from the engagement record at close, published externally. The only agent
with a designed feedback edge back into another agent: Chronicle → Scout (what predicted
success). The content shape of that edge is specified in §6; it is not built.

## §1 Trigger and readiness gate

**Engagement completion, gated by a readiness check.** `engagements.status = 'completed'`
makes an engagement eligible; `assessChronicleReadiness()` decides whether there is enough
on record to write from. Completion alone is not sufficient.

The gate derives from the record, never model-supplied, and runs **before** any model call:

- **`not_ready`** — not completed, or no plan and no recorded activity. Drafting is
  suppressed entirely: the endpoint returns empty headline/narrative/outcomes and never
  calls the model. Returns a draft with empty string fields; no row, approval or run id is
  written (ids are null).
- **`thin`** — completed and real, but sparse (no linked plan, or fewer than
  `THIN_EVENT_THRESHOLD` recorded events). A story may be drafted, framed honestly as
  provisional. Model call proceeds and the written row's generated `provisional` column is true; staff UI must surface the provisional label prominently.
- **`ready`** — completed, with a linked plan and enough recorded activity. `provisional = false`;
  full synthesis across all three eval dimensions.

**This gate is the whole point of the agent's design.** Chronicle's failure mode is not a
bad sentence — it is a confident public story about a named real nonprofit that the record
does not support, and that failure reads as *good prose*. Therefore:

- `readiness` is omitted from `chronicleModelSchema` — a model asked to judge its own
  licence to proceed is not a guard.
- The `not_ready` path returns **nothing rather than a placeholder** — a plausible short
  story is exactly what a reviewer might wave through.
- The `thin` narrative states its own provisionality in the prose, so a reviewer reading
  only the text still learns the record is thin.

The `chronicleDraft` eval judge scores a `proportionate` dimension alongside `grounded` and
`clear` for the same reason — a judge scoring only fluency would reward the failure.

**`not_ready` is a 200**, deliberately — "there is nothing to write yet" is a correct
answer, not a failure to fall back from. Turning it into a throw would send the caller to
a deterministic path that would only agree.

## §2 Inputs

`ChronicleInput` (target: `src/types/chronicle.ts` — not yet created):

- **`engagementId`** (FK to `engagements`)
- **`includeQuote?`** (boolean, default false)

Assembled from Supabase by the caller:

- Completed `engagements` rows and their terminal state (the
  `engagements_enforce_transitions` trigger documented in `crm/security.md` §2
  row 6 guarantees a completed engagement's data is stable — safe to summarize from).
- Architect's charter and 90-day plan outputs — the stated success criteria are the natural
  basis for "did this engagement succeed." Success criteria are quoted in the narrative as
  the definition of success ("Success was defined as: …"); they are **not** outcomes. The
  template's `outcomes` is **empty** until an achieved-outcomes source exists on
  `ChronicleInput` (roadmap D46). Since `chronicle-draft-0.06` the model is not asked
  for outcomes at all: `outcomes` is omitted from `chronicleModelSchema` and set to `[]`
  in code, so a restated criterion cannot reach the draft.
  *(R17, 2026-10-08: run 1's model lane restated criteria as achieved outcomes under 0.05.)*
- `eventCount` from `engagement_events` (0003_delivery) as the activity signal.

## §3 Outputs

- **`ChronicleDraftResponse`** — `readiness` ('not_ready' | 'thin' | 'ready'), `headline`
  (string), `narrative` (string), `outcomes` (string[]), `successFactors` / `failureFactors`
  (string[], at most 10 each, model-proposed and grounded in the record; the fallback returns
  `[]`), `hitlTier` ('L3' always), plus `source` ('model' | 'fallback'), `approvalId`,
  `draftId`, `lessonId` and `runId` (null on `not_ready`, which saves nothing). `provisional` is not on the wire: it is a generated column on
  `chronicle_drafts` (`readiness = 'thin'`).
- **Feedback signal to Scout** — a `lessons` row, human-promoted before Scout can see it.
  Shape and rules in §6; built in 0004_drafts (D15, D21), review-queue UI pending (T5).
- **Publication path** — none. Chronicle drafts; nothing publishes.

## §4 HITL tier

**L3, always** — nothing publishes without human approval, including a `not_ready` verdict,
which is still returned as a well-formed tiered payload. `hitlTier` is omitted from
`chronicleModelSchema` so the model cannot mark its own draft as needing no review.

## §5 Deterministic fallback

`generateChronicleDraft()` — returns the same shape the model path does for every readiness
branch, so the caller falls back without branching. The readiness gate is shared by both
paths rather than duplicated.

`api/chronicle-draft.ts` follows `architect-plan.ts`'s failure contract, not
`route-intake.ts`'s: the fallback is **server-side**. A failed model call is a 200
carrying `generateChronicleDraft()` with `source: 'fallback'`; a model draft carries
`source: 'model'`. The gateway records the failed call as one `fallback` run
(`failureStatus: 'fallback'`). A missing model key is a fallback too, never a 503, so the
route answers from the deterministic path on a keyless deploy. `not_ready` is a 200 with
`source: 'fallback'` (no model was called, `runId: null`; see §1 rationale). Only 401
(no session), 400 (bad input) and 405 are non-2xx. *(Decided 2026-10-07, design-system.md
§2.)*

## §6 The learning artifact — Chronicle → Scout

The feedback edge is the strategic point of the whole system: completed engagements should
make the next routing decision better. That only works if what crosses the edge is a
**structured claim that can be checked**, not prose.

**Do not build this as "Chronicle writes embeddings, Scout searches them."** Generic
similarity over impact stories returns things that read alike, not things that predicted
alike — and it cannot be evaluated, because there is no ground truth to score against.

### The `lessons` entity

One row per engagement (`engagement_id` is unique), written by Chronicle, promoted by a human:

```
engagement_id          uuid    -- the source engagement (unique)
draft_id               uuid    -- the chronicle_drafts row it was last derived from
scout_intake_id        uuid    -- the intake the business was created from (businesses.scout_intake_id)
predicted_bucket       text    -- what Scout routed it as, at intake: coalesce(final_bucket, bucket)
predicted_readiness    text    -- Ready | Conditional | Not Ready, at intake (composite_signal)
outcome                text    -- delivered | partial | abandoned
prediction_correct     boolean -- GENERATED: did the routing hold up
success_factors        text[]  -- what actually made it work (model-proposed)
failure_factors        text[]  -- what actually blocked it (model-proposed)
promoted_by            uuid    -- FK auth.users; null until a human approves
promoted_at            timestamptz
promotion_approval_id  uuid    -- the approved `lesson` approval: the promotion record
```

A business with no `scout_intake_id` (every pre-R7 business) still gets a candidate, with
null predictions and a null `prediction_correct`; the audit event flags `prediction_missing`.

**Outcome rule** (`derive_engagement_outcome()`, SQL, in this precedence):

1. `abandoned` — the business's latest `stage_advanced` / `stage_reverted` event is a
   `stage_reverted` (no later advance), **or** — only while the business has no
   `membership`-stage engagement — the newest `engagement_events` row for the business is
   older than 90 days (a finished engagement chronicled late is quiet, not abandoned);
2. else, when the engagement has at least one milestone: `delivered` if every milestone is
   `completed`, `partial` otherwise (`milestones` has no `waived` status, 0003_delivery, so
   "completed or waived" collapses to `completed`);
3. else (no milestones): `delivered` — reaching `membership` is the lifecycle's own
   definition of completion, and `submit_chronicle_draft()` already gates on it.

**`prediction_correct`** is `generated always as (...) stored`, null-safe: `Ready` ↔
`delivered`; `Not Ready` ↔ `outcome <> 'delivered'`; `Conditional` ↔ `partial`; null when
`predicted_readiness` or `outcome` is null.

The first four columns are what make it evaluable. Because intake stored the prediction and
the completed engagement carries the outcome, `prediction_correct` is **computed, not
judged** — which turns the feedback loop into a measurable signal rather than a vibe.

It answers the question the platform exists to answer: *what characteristics of a nonprofit
predicted a successful engagement?* Generic memory cannot answer that.

### Promotion is human-gated

A lesson is a **candidate** until a human promotes it. Chronicle proposes; staff approve.
No agent writes institutional truth unreviewed — the same rule as every other partner-
visible artifact, and the reason `promoted_by` exists as a column rather than a flag.

Un-promoted lessons are visible to staff and invisible to Scout. Promotion is
`promote_lesson(lesson_id, notes)` (0004_drafts): staff of the lesson's org only, idempotent, and
the only writer of `promoted_by` / `promoted_at`; it records an already-approved `lesson`
approval. A promoted lesson is never rewritten by a later draft (`lesson_frozen` in the
audit detail); an un-promoted one is updated in place by each new draft.

### How Scout consumes it

Promoted lessons are retrievable at review time as **context for a human reviewer** — read
from the `promoted_lessons` view (`security_invoker`, so `lessons` RLS applies) through
`src/lib/lessons.ts` `fetchPromotedLessons()`, filtered by the intake's bucket. No digest,
no route, no rubric change. They are **context for a human reviewer**, not as an
input that changes routing automatically. Scout's rubric stays deterministic; a lesson
saying "orgs like this one stalled at data ethics" belongs in the review queue next to the
routing result, where a person weighs it.

Auto-tuning the rubric from outcomes is a later decision and needs an eval gate first —
otherwise a bad early sample teaches the system a wrong prior it cannot unlearn.

This is registry rows **D15** (the edge) and **D21** (the artifact).

## Contract

- **Input:** `ChronicleDraftRequest` — `engagementId` (guid), `idempotencyKey` (8-200 chars) only (v4, 2026-10-08). `orgName`, `status`, `hasPlan`, `eventCount`, `objectives?` and `successCriteria?` are read by the route through RLS (`api/_engagement.ts`) into `ChronicleInput`; a caller can no longer supply the facts readiness is derived from.
- **Model caps:** `headline` ≤200 and `narrative` ≤4,000 chars in `chronicleModelSchema`; `outcomes` is not model-generated.
- **Output:** `ChronicleDraftResponse` — see §3
- **Side effects:** On `thin` and `ready`, `submit_chronicle_draft()` (0004_drafts) writes, in one transaction, one `chronicle_drafts` row (with its factors), one pending L3 `story` approval, one audit event and the engagement's lesson candidate (upsert; a promoted lesson is left alone) and returns its `lessonId`; a replay with the same key returns the original, lesson included. `not_ready` writes nothing and makes no model or RPC call.
- **Completion gate:** a `membership`-stage engagement row must exist for the same business; enforced in `submit_chronicle_draft()` (SQLSTATE 55000, mapped to 422).

## Rules

- `hitlTier` is always `L3` — every chronicle draft requires staff review and approval before any external use. The model schema must never include `hitlTier` as a field to generate.
- `not_ready` path: return a draft with empty string fields and null ids; do not call the model; do not write a row.
- `thin` path: model call proceeds and the written row's generated `provisional` column is true; staff UI must surface the provisional label prominently.
- `ready` path: `provisional = false`; full synthesis across all three eval dimensions — grounded, proportionate, and clear.
- Charter context (objectives, success criteria) is the only org context the narrative may use — the model must not invent org context not present in the charter or engagement record.
- Impact claims must be proportionate to engagement scope; the model must not extrapolate from pilot to organization-wide conclusions without evidence in the engagement record.
- No delete on `chronicle_drafts` — rows are audit trail. Staff approves or rejects via status field; rejected drafts are retained.
- `readiness` omitted from `chronicleModelSchema` — gate is deterministic, not model-supplied.
- `not_ready` is a 200 response, not an error — "nothing to write yet" is a correct answer.
- `outcomes` lists only what the record states was achieved. Nothing in `ChronicleInput` records an achievement today, so the template and the model path both return `[]` on every readiness (the model schema omits the field) and a criterion or objective never becomes an outcome (D46; gated by `chronicleGrounding` and `chronicleReadiness`). With no objectives the "set out to" sentence is omitted, never replaced by a stock phrase.

## Dependencies

- **Imports:** `src/types/` (`ChronicleDraftRequest`, `ChronicleDraftResponse`); `src/model/` gateway; `src/observability/recorder.ts`
- **Imported by:** Engagement close workflow (staff UI); engagement detail screen (approved draft display)
- **Data:** `engagements` table (lifecycle state); `architect_assessments` (charter as synthesis source); `engagement_events` (activity signal / eventCount); `chronicle_drafts` (0004_drafts); `agent_runs` (`0001_core.sql`)

## Delta rows

Cited from [`roadmap.md`](../../roadmap.md) — this spec does not mint numbers.

- **D11** — Chronicle agent: readiness gate + model synthesis + `/api/chronicle-draft` — GAP
- **D15** — Chronicle → Scout feedback loop — built (0004_drafts), UI pending T5
- **D21** — the learning artifact: `lessons` entity with prediction/outcome fields — built (0004_drafts), UI pending T5
- **D25** — Chronicle eval suite: readiness-gate fixtures, three judge dimensions — GAP

## Test contract

- `not_ready` path: engagement with no signed contract → `readiness = 'not_ready'`, no row written, no model call made.
- `thin` path: engagement with charter + contract + one engagement event → `readiness = 'thin'`, row written with `provisional = true`.
- `ready` path: full engagement record → `readiness = 'ready'`, `provisional = false`, headline and narrative non-empty.
- Grounded eval: `narrative` must not contain claims absent from the charter or engagement events (LLM judge fixture).
- Proportionate eval: `narrative` language matches engagement scope metadata — no "organization-wide" language when scope is pilot (heuristic grader).
- Clear eval: `outcomes` items are each one to three sentences and non-redundant (heuristic grader).
- `hitlTier` is always `'L3'` regardless of readiness state or model output.
- Readiness field absent from model schema: verify `generateObject` schema definition excludes `hitlTier`.
- `not_ready` returns HTTP 200, not a 4xx/5xx.

## Open questions

1. ~~Does `chronicle_drafts` land in its own migration?~~ Resolved — it lives in `0004_drafts`.
2. Should approved chronicles be surfaced publicly (partner-facing) or remain internal staff artifacts only?
3. `includeQuote` — does the model solicit a quote from the engagement record (e.g., a field in `engagement_events`) or generate a synthetic placeholder for staff to replace?
4. ~~Chronicle → Scout feedback loop mechanism.~~ **Content shape resolved 2026-08-21** — the `lessons` entity, §6. ~~Delivery.~~ **Resolved 2026-10-07: query at review time, `promoted_lessons` via `src/lib/lessons.ts`.**
5. Knowledge base / `platform-api` — parked on Chronicle to absorb or reject. Chronicle is the designated place to decide whether this workstream is absorbed into Chronicle's scope or rejected outright — still not decided either way.
6. `THIN_EVENT_THRESHOLD` is a provisional estimate, not a measured value — calibration needed against real engagement data.
7. Whether Pulse's historical health signals should feed the narrative as a timeline input (`eventCount` is used; health history is not).

## Requirement Trace

| Old requirement | Source | Now at | Status |
|---|---|---|---|
| Impact statements / case studies scope | `design-system.md:54` | §Responsibility | Carried |
| Green-field state | `design-system.md:54` | (this doc) | Partially closed — drafting built, feedback loop not |
| Feedback loop into Scout | `design-system.md:54`, `design-system.md:84` (handoff diagram) | §6 | Changed 2026-08-21 — content shape specified as the `lessons` entity (D21); delivery resolved 2026-10-07 (query at review time); built in 0004_drafts, UI pending T5 |
| KB / `platform-api` parked on Chronicle | `design-system.md:54`, `design-system.md:198` (§5 open items) | §Open questions | Carried as open, not resolved |
| Chronicle → Public handoff | `design-system.md:83` (handoff diagram) | §Responsibility, §3 Outputs | Carried — drafts only, no publication path |
| Trigger model undesigned | prior spec §Trigger | §1 Trigger | Closed — completion plus a readiness gate |
| HITL tier unratified (L3 candidate) | prior spec §HITL tier | §4 HITL tier | Closed — L3, encoded and enforced by schema omission |
| Deterministic fallback undesigned | prior spec §Deterministic fallback | §5 Deterministic fallback | Closed — `generateChronicleDraft()` |
| Case-study content shape undesigned | prior spec §Open questions | §3 Outputs | Closed — headline/narrative/outcomes |
| Pulse health signals as timeline input | prior spec §Inputs | §Open questions | Carried as open — `eventCount` is used, health history is not |
