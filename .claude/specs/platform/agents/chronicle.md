# Chronicle Agent
**Plate:** C3.3 in docs/nonprofit-success-system-design.html
**Status:** GAP
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
  calls the model. Returns `ChronicleDraft` with empty string fields and `notReadyReasons[]`
  populated; no row is written.
- **`thin`** — completed and real, but sparse (no linked plan, or fewer than
  `THIN_EVENT_THRESHOLD` recorded events). A story may be drafted, framed honestly as
  provisional. Model call proceeds but `provisional = true` in both output and the written
  row; staff UI must surface the provisional label prominently.
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
  basis for "did this engagement succeed." Outcomes are drawn from `successCriteria` when
  present, falling back to `objectives`, and are **empty when neither was recorded** rather
  than asserted.
- `eventCount` from `engagement_events` (migration 0002) as the activity signal.

## §3 Outputs

- **`ChronicleDraft`** — `readinessState` ('not_ready' | 'thin' | 'ready'), `provisional`
  (boolean), `caseSummary` (string), `lessonsLearned` (string[]), `impactStatement`
  (string), `notReadyReasons?` (string[]), `hitlTier` ('L3' always)
- **Feedback signal to Scout** — a `lessons` row, human-promoted before Scout can see it.
  Shape in §6; not built (D15, D21).
- **Publication path** — none. Chronicle drafts; nothing publishes.

## §4 HITL tier

**L3, always** — nothing publishes without human approval, including a `not_ready` verdict,
which is still returned as a well-formed tiered payload. `hitlTier` is omitted from
`chronicleModelSchema` so the model cannot mark its own draft as needing no review.

## §5 Deterministic fallback

`generateChronicleDraft()` — returns the same shape the model path does for every readiness
branch, so the caller falls back without branching. The readiness gate is shared by both
paths rather than duplicated.

Target `api/chronicle-draft.ts` follows `route-intake.ts`'s failure contract: failures
return non-2xx without a result body. `not_ready` is a 200 (see §1 rationale).

## §6 The learning artifact — Chronicle → Scout

The feedback edge is the strategic point of the whole system: completed engagements should
make the next routing decision better. That only works if what crosses the edge is a
**structured claim that can be checked**, not prose.

**Do not build this as "Chronicle writes embeddings, Scout searches them."** Generic
similarity over impact stories returns things that read alike, not things that predicted
alike — and it cannot be evaluated, because there is no ground truth to score against.

### The `lessons` entity

One row per completed engagement, written by Chronicle, promoted by a human:

```
engagement_id        uuid    -- the source engagement
predicted_bucket     text    -- what Scout routed it as, at intake
predicted_readiness  text    -- Ready | Conditional | Not Ready, at intake
outcome              text    -- delivered | partial | abandoned
prediction_correct   boolean -- did the routing hold up
success_factors      text[]  -- what actually made it work
failure_factors      text[]  -- what actually blocked it
promoted_by          uuid    -- FK users; null until a human approves
promoted_at          timestamptz
```

The first four columns are what make it evaluable. Because intake stored the prediction and
the completed engagement carries the outcome, `prediction_correct` is **computed, not
judged** — which turns the feedback loop into a measurable signal rather than a vibe.

It answers the question the platform exists to answer: *what characteristics of a nonprofit
predicted a successful engagement?* Generic memory cannot answer that.

### Promotion is human-gated

A lesson is a **candidate** until a human promotes it. Chronicle proposes; staff approve.
No agent writes institutional truth unreviewed — the same rule as every other partner-
visible artifact, and the reason `promoted_by` exists as a column rather than a flag.

Un-promoted lessons are visible to staff and invisible to Scout.

### How Scout consumes it

Promoted lessons are retrievable at intake as **context for a human reviewer**, not as an
input that changes routing automatically. Scout's rubric stays deterministic; a lesson
saying "orgs like this one stalled at data ethics" belongs in the review queue next to the
routing result, where a person weighs it.

Auto-tuning the rubric from outcomes is a later decision and needs an eval gate first —
otherwise a bad early sample teaches the system a wrong prior it cannot unlearn.

This is registry rows **D15** (the edge) and **D21** (the artifact).

## Contract

- **Input:** `ChronicleInput` — `engagementId` (FK to `engagements`), `includeQuote?` (boolean, default false)
- **Output:** `ChronicleDraft` — `readinessState` ('not_ready' | 'thin' | 'ready'), `provisional` (boolean), `caseSummary` (string), `lessonsLearned` (string[]), `impactStatement` (string), `notReadyReasons?` (string[]), `hitlTier` ('L3' always)
- **Side effects:** Writes one `chronicle_drafts` row on non-`not_ready` paths; no write on `not_ready`. Updates `engagements.chronicle_status`.

## Rules

- `hitlTier` is always `L3` — every chronicle draft requires staff review and approval before any external use. The model schema must never include `hitlTier` as a field to generate.
- `not_ready` path: return `ChronicleDraft` with empty string fields and `notReadyReasons[]` populated; do not call the model; do not write a row.
- `thin` path: model call proceeds but `provisional = true` in both the output and the written row; staff UI must surface the provisional label prominently.
- `ready` path: `provisional = false`; full synthesis across all three eval dimensions — grounded, proportionate, and clear.
- Charter (`architect_assessments`) is required context for `caseSummary` — the model must not invent org context not present in the charter or engagement record.
- Impact claims must be proportionate to engagement scope; the model must not extrapolate from pilot to organization-wide conclusions without evidence in the engagement record.
- No delete on `chronicle_drafts` — rows are audit trail. Staff approves or rejects via status field; rejected drafts are retained.
- `readiness` omitted from `chronicleModelSchema` — gate is deterministic, not model-supplied.
- `not_ready` is a 200 response, not an error — "nothing to write yet" is a correct answer.
- Outcomes are empty when neither `successCriteria` nor `objectives` was recorded — never asserted from context.

## Dependencies

- **Imports:** `src/types/` (`ChronicleInput`, `ChronicleDraft`); `src/model/` gateway; `src/observability/recorder.ts`
- **Imported by:** Engagement close workflow (staff UI); engagement detail screen (approved draft display)
- **Data:** `engagements` table (lifecycle state); `architect_assessments` (charter as synthesis source); `engagement_events` (activity signal / eventCount); `chronicle_drafts` (target write — migration pending); `agent_runs` (`_deferred/0004_telemetry.sql`)

## Delta rows

Cited from [`delta.md`](../../delta.md) — this spec does not mint numbers.

- **D11** — Chronicle agent: readiness gate + model synthesis + `/api/chronicle-draft` — GAP
- **D15** — Chronicle → Scout feedback loop — GAP
- **D21** — the learning artifact: `lessons` entity with prediction/outcome fields — GAP
- **D25** — Chronicle eval suite: readiness-gate fixtures, three judge dimensions — GAP

## Test contract

- `not_ready` path: engagement with no signed contract → `readinessState = 'not_ready'`, `notReadyReasons` non-empty, no row written, no model call made.
- `thin` path: engagement with charter + contract + one engagement event → `readinessState = 'thin'`, `provisional = true`, row written.
- `ready` path: full engagement record → `readinessState = 'ready'`, `provisional = false`, all three output fields non-empty.
- Grounded eval: `caseSummary` must not contain claims absent from the charter or engagement events (LLM judge fixture).
- Proportionate eval: `impactStatement` language matches engagement scope metadata — no "organization-wide" language when scope is pilot (heuristic grader).
- Clear eval: `lessonsLearned` items are each one to three sentences and non-redundant (heuristic grader).
- `hitlTier` is always `'L3'` regardless of readiness state or model output.
- Readiness field absent from model schema: verify `generateObject` schema definition excludes `hitlTier`.
- `not_ready` returns HTTP 200, not a 4xx/5xx.

## Open questions

1. Does `chronicle_drafts` land in its own migration or extend an existing deferred file? Confirm numbering relative to `_deferred/0004`, `0005`, `0007`.
2. Should approved chronicles be surfaced publicly (partner-facing) or remain internal staff artifacts only?
3. `includeQuote` — does the model solicit a quote from the engagement record (e.g., a field in `engagement_events`) or generate a synthetic placeholder for staff to replace?
4. ~~Chronicle → Scout feedback loop mechanism.~~ **Content shape resolved 2026-08-21** — the `lessons` entity, §6. Still open: *delivery*. Is a promoted lesson surfaced by query at intake, by a scheduled digest, or in the review-queue UI? §6 assumes review-queue context; confirm before D21.
5. Knowledge base / `platform-api` — parked on Chronicle to absorb or reject. Chronicle is the designated place to decide whether this workstream is absorbed into Chronicle's scope or rejected outright — still not decided either way.
6. `THIN_EVENT_THRESHOLD` is a provisional estimate, not a measured value — calibration needed against real engagement data.
7. Whether Pulse's historical health signals should feed the narrative as a timeline input (`eventCount` is used; health history is not).

## Requirement Trace

| Old requirement | Source | Now at | Status |
|---|---|---|---|
| Impact statements / case studies scope | `design-system.md:54` | §Responsibility | Carried |
| Green-field state | `design-system.md:54` | (this doc) | Partially closed — drafting built, feedback loop not |
| Feedback loop into Scout | `design-system.md:54`, `design-system.md:84` (handoff diagram) | §6 | Changed 2026-08-21 — content shape specified as the `lessons` entity (D21); delivery mechanism still open |
| KB / `platform-api` parked on Chronicle | `design-system.md:54`, `design-system.md:198` (§5 open items) | §Open questions | Carried as open, not resolved |
| Chronicle → Public handoff | `design-system.md:83` (handoff diagram) | §Responsibility, §3 Outputs | Carried — drafts only, no publication path |
| Trigger model undesigned | prior spec §Trigger | §1 Trigger | Closed — completion plus a readiness gate |
| HITL tier unratified (L3 candidate) | prior spec §HITL tier | §4 HITL tier | Closed — L3, encoded and enforced by schema omission |
| Deterministic fallback undesigned | prior spec §Deterministic fallback | §5 Deterministic fallback | Closed — `generateChronicleDraft()` |
| Case-study content shape undesigned | prior spec §Open questions | §3 Outputs | Closed — headline/narrative/outcomes |
| Pulse health signals as timeline input | prior spec §Inputs | §Open questions | Carried as open — `eventCount` is used, health history is not |
