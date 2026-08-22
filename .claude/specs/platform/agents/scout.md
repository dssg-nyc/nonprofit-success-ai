# Scout Agent
**Plate:** C3.1 in docs/nonprofit-success-system-design.html
**Status:** BUILT, NOT WIRED
**PRD sections:** §5, §6, §7, §9 CF1

> Engineering note: routing logic exists in `src/lib/scoutRouting.ts` and
> `src/components/ScoutIntakeForm.tsx` but is not wired to a Vercel Function or Supabase.
> `src/agents/scout/` does not exist yet — current code is under `src/lib/`.

## Responsibility

Routes nonprofit intake submissions into service buckets with confidence and readiness
scoring, and extracts structured facts (decisions, action items) from partner-org meeting
transcripts.

## §1 Intake

**Trigger:** a prospective partner org submits the ~10-question intake form,
`src/components/ScoutIntakeForm.tsx` (retargeted from the original spec's Tally form).

**Inputs:** the intake answers — org context, current data practices, the three scored
signals below, and free-text fields for wish-list/worry/blockers (same shape Architect's
CSA later expands on).

**Outputs**, written to `scout_intakes`:

1. **Bucket** — one of five: `Data Infrastructure`, `Analytics & Insight`,
   `ML / Predictive`, `Tooling & Automation`, `Advisory / Strategy`. Advisory is a
   first-tier bucket, not a catch-all fallback — an org can land there directly.
2. **Confidence** — how sure the routing is, independent of bucket.
3. **Composite signal** — `Ready` / `Conditional` / `Not Ready`, and a recommended
   onboarding kit.

### Three readiness dimensions

Scored from the intake answers (`src/lib/scoutRouting.ts`):

- **POC score** — is there a named point of contact who can actually unblock work.
- **Clarity score** — how well-formed the org's own ask is.
- **Foothold score** — whether DSSG has any existing relationship or context to build on.

### Routing algorithm

`routeScoutIntake()` in `src/lib/scoutRouting.ts` is the deterministic fallback and runs
the same three-step process the model call also produces:

1. **Bucket assignment** — Q6 sets the bucket hypothesis; Q7 free-text cross-checks via
   keyword match; Q5/Q8 break ties when Q7 is ambiguous.
2. **Confidence bucketing** from how cleanly the answers matched.
3. **Readiness** from POC/clarity/foothold — see the composite rule below.

`something_else` primary_need bypasses auto-bucket entirely: `bucket = null`,
`confidence = null`, `hitlTier = 'L3'` always.

### The composite rule — POC is decisive in both directions

`compositeSignal(poc, clarity, foothold)` in `src/lib/scoutRouting.ts`, evaluated in this
order:

```ts
const sum = poc + clarity + foothold;
if (poc === 1 && sum > 3) return 'Not Ready';
if (poc === 1 || clarity === 1 || foothold === 1) return 'Conditional';
if (sum >= 7) return 'Ready';
return 'Conditional';
```

**Point of contact is the decisive dimension, and it cuts both ways.** A strong POC can
carry readiness even when clarity and foothold are weak; a floor POC routes `Not Ready`
however well-formed the rest of the intake is — because nobody can unblock the work.

**The one exception is the all-floor intake** (`poc = clarity = foothold = 1`, hence
`sum === 3`). That pattern reads as a thinly-filled form from a small org, not as evidence
the org itself is unready, so it stays `Conditional` for a human to read. This is why the
first rule tests `sum > 3` rather than `poc === 1` alone.

A floor in clarity or foothold — but not POC — is `Conditional`: incomplete information
about an org that does have someone who can act on it.

Ties default to `Conditional`, never `Ready`; the tiebreaker is deliberately conservative.

Over the 27 possible score combinations this yields 7 `Ready`, 8 `Not Ready`, and 12
`Conditional`.

**Resolved 2026-08-21 — `'Not Ready'` was structurally unreachable.** The previous
implementation returned `'Conditional'` the moment any dimension scored `1`, before the
`sum <= 4` check that would have selected `'Not Ready'` — and `sum <= 4` with no floor
score is impossible, so that branch was dead code. Every intake that should have routed
`Not Ready` landed on `Conditional`. The fix above is ported from the prototype's
`scout/routing.ts`, where both the decisive-POC rule and the all-floor exception are
pinned by golden fixtures. Closes D10.

### HITL tiering

`hitlTier` is derived server-side — never model-supplied:

- **L2** — `confidence === 'High' && composite_signal === 'Ready'`: the routing result is
  surfaced to staff as a done decision, reversible.
- **L3** — everything else (low confidence, `Conditional`, `Not Ready`, or
  `something_else` bypass): drafted for a human reviewer who approves before the org
  moves forward.

The prior `scout-build-spec.md` §3 described a third tier (L4, auto-decline for very-low-
signal intakes). This was not implemented — `src/lib/scoutRouting.ts` has no third queue
and its own comment confirms an L2/L3 split only. Carried as a dropped requirement in the
trace.

## §2 Meeting Intelligence

**Trigger:** a transcript is captured for a partner-org meeting (calendar-linked, per the
n8n reference flow being ported).

**Model call contract** (targeting `api/route-intake.ts` via Vercel AI SDK
`generateObject`):

- **System prompt contract**: extract only what the transcript actually states; do not
  infer intent, and do not fabricate an assignee or due date when the transcript doesn't
  name one.
- **Output schema** (`additionalProperties: false` — the model may not add fields):
  - `decisions[]`: `{ statement, certainty }`
  - `action_items[]`: `{ description, assignee, due_date, certainty }`
- **Error contract**: `stop_reason === 'refusal'` and `stop_reason === 'max_tokens'` are
  both hard failures — neither is treated as partial/best-effort. A refused or truncated
  extraction produces no `extracted_facts` rows rather than an incomplete set.

### Baseline model (Q1)

The shipped model is the **two-type model** (`decisions` and `action_items`), matching
what the prior n8n flow actually extracted. This resolves U4: the full 11-type fact
taxonomy referenced in earlier planning docs is a documented extension point, not the
baseline. Widening from two to eleven types is future scope, not assumed here.

### Storage

- **`meetings`** row: `nonprofit_id`, `title`, `meeting_date`, `transcript`.
- **`extracted_facts`** row, one per decision/action item: `meeting_id`, `nonprofit_id`,
  `fact_type`, `statement`, `assignee`, `due_date`, `certainty`.

**The transcript is restricted data — never logged.** Anywhere the extraction pipeline
handles the transcript body (request construction, error paths, retries), it must not
appear in logs. Hard constraint, not a style preference.

### Downstream

Action items with a `due_date` feed calendar-reminder logic — a reminder is scheduled per
dated action item; items without a `due_date` are surfaced to staff without a reminder
rather than defaulted to one.

## §3 Deterministic fallback

`src/lib/scoutRouting.ts` is the required deterministic fallback for intake routing. It is
not a stub waiting to be replaced — `/api` falls back to it when the real model call
fails, and it stays in the path permanently. The fallback must produce the identical output
shape as the model path — a drop-in swap, not a degraded path.

Target: moves to `src/agents/scout/routing.ts` with tests. No tests exist yet.

## Contract

- **Input:** `ScoutRoutingInput` — `scale`, `primary_need`, `primary_need_other?`,
  `problem_description`, `current_systems`, `contact_name_role`, `timeline`
- **Output:** `ScoutResult` — `bucket` (ScoutBucket | null), `confidence`
  (High/Medium/Low/null), `rationale`, `poc_score`, `clarity_score`, `foothold_score`
  (each 1|2|3), `composite_signal` (Ready/Conditional/Not Ready), `flags[]`,
  `hitlTier` (L2|L3)
- **Side effects:** Writes one `scout_intakes` row (intake fields + computed output
  fields); review fields written later by admin.

## Rules

- `hitlTier` is derived server-side: `L2` iff `confidence === 'High' && composite_signal === 'Ready'`; `L3` otherwise. The model schema must never include `hitlTier` as a field to generate.
- `composite_signal` is derived from the three scores, not generated by the model. Floor rule: any score of 1 → Conditional, regardless of sum.
- `something_else` primary_need bypasses auto-bucket entirely: `bucket = null`, `confidence = null`, `hitlTier = 'L3'` always.
- Intake fields are public write-once (submitted by the nonprofit rep). Review fields (`reviewStatus`, `reviewAction`, `finalBucket`, `reviewedBy`, etc.) are admin-only update.
- Deterministic fallback must produce the identical output shape as the model path — a drop-in swap, not a degraded path.
- No new Firebase surface area. Screens must retarget to `scout_intakes` (Supabase), not `demoStore`.
- `composite_signal` and `hitlTier` are **derived, never model-supplied** — even once the real model call replaces the deterministic bucket/confidence heuristic, routing tier and readiness stay computed from the model's structured output, not asserted by it.
- The transcript (meeting intelligence path) must never appear in logs — not in request construction, error paths, or retries.
- Meeting intelligence: `stop_reason === 'refusal'` and `stop_reason === 'max_tokens'` are hard failures; produce no `extracted_facts` rows rather than an incomplete set.
- Action items without a `due_date` surface to staff without a reminder; no default date is assigned.

## Dependencies

- **Imports:** `src/types.ts` (ScoutBucket, PrimaryNeed, ScoutConfidence, ScoutCompositeSignal, ScoutHitlTier); future: `src/model/` gateway, `src/observability/recorder.ts`
- **Imported by:** Public intake form component; `ScoutReviewQueue` component (staff-facing)
- **Data:** `scout_intakes` table (`supabase/migrations/0001_init.sql`); `meetings` and `extracted_facts` tables (meeting intelligence); `agent_runs` table (`_deferred/0004_telemetry.sql`)

## Delta rows

Cited from [`roadmap.md`](../../roadmap.md) — this spec does not mint numbers.

- **D1** — server boundary `/api/route-intake` — SPECIFIED
- **D7** — move Scout to `src/agents/scout/` + first test suite — SPECIFIED
- **D14** — meeting intelligence (§2) — SPECIFIED
- **D23** — Scout eval suite; the two `compositeSignal` boundary cases land here — GAP
- **D26** — `demoStore` → Supabase retarget for intake form and review queue — SPECIFIED
- ~~D10~~ `compositeSignal` Not-Ready bug — **BUILT** 2026-08-21, decisive-POC rule ported
  from the prototype. Closed; no registry row needed.

## Test contract

- Golden-set regression: known inputs → known bucket/confidence/composite_signal tuples.
- Boundary cases: one input per bucket (including `something_else` bypass).
- All-floor intake (poc=1, clarity=1, foothold=1): `composite_signal = 'Conditional'` — the
  thinly-filled-form case, deliberately not `Not Ready`.
- Floor POC with anything else above floor (poc=1, clarity=3, foothold=3 and poc=1,
  clarity=1, foothold=2): `composite_signal = 'Not Ready'` — POC is decisive downward.
- Floor in clarity or foothold but not POC (poc=3, clarity=1, foothold=3):
  `composite_signal = 'Conditional'` — not `Not Ready`.
- Distribution guard over all 27 score combinations: 7 `Ready`, 8 `Not Ready`,
  12 `Conditional`. A change that empties any bucket is a regression.
- Q6/Q7 mismatch: Q6 = `analyze_data`, Q7 problem description matches only `ML / Predictive` keywords → re-bucket to ML/Predictive, confidence = Low.
- `something_else` bypass: `bucket = null`, `confidence = null`, `hitlTier = 'L3'` regardless of scores.
- `hitlTier = 'L2'` requires confidence=High AND composite_signal=Ready simultaneously; any other combination yields L3.
- Meeting intelligence: refused extraction → zero `extracted_facts` rows, no partial set.
- Meeting intelligence: action item without due_date → surfaced without reminder entry.

## Open questions

1. ~~D10: is `Not Ready` a dead code path, or should the floor return `Not Ready` when all
   three are 1?~~ **Resolved 2026-08-21 — neither.** POC is decisive in both directions; a
   floor POC routes `Not Ready` unless *every* dimension is at floor, which stays
   `Conditional`. See "The composite rule" above.
2. On staff approval of a scout intake, should the system auto-create a Business + Engagement record, or is that a separate manual step?
3. Meeting intelligence baseline: U4 — the full 11-type fact taxonomy is a documented extension point; when, if ever, does the baseline expand beyond `decisions` and `action_items`?
4. Meeting intelligence input source: transcript capture mechanism and the calendar integration that links meetings to engagements are undesigned.

## Requirement Trace

| Old requirement | Source | Now at | Status |
|---|---|---|---|
| Five-bucket routing (Advisory as first-tier) | `scout-design.md` §Buckets | §1 / `src/lib/scoutRouting.ts` | Carried |
| Three readiness dimensions (POC, clarity, foothold) | `scout-design.md` §Scoring | §1 | Carried |
| Q7-wins rule, Conditional tiebreaker | `scout-build-spec.md` §2 | §1 | Carried |
| Tally intake form | `scout-build-spec.md` §1 | §1 — retargeted to `ScoutIntakeForm.tsx` | Carried, retargeted |
| n8n IF node (tier routing) | `scout-build-spec.md` §3 | §1 — retargeted to `deriveHitlTier()` | Carried, retargeted |
| L4 auto-decline tier | `scout-build-spec.md` §3 | §1 | Dropped — not implemented in `src/lib/scoutRouting.ts`; no third queue exists in shipped code |
| Anthropic API extraction call | `scout-build-spec.md` §Anthropic call spec | §2 — retargeted to `api/route-intake.ts` via `generateObject` | Carried, retargeted |
| n8n node sequence | `scout-build-spec.md` | §2 | Carried, retargeted to Vercel Functions |
| Confidence levels table | `scout-build-spec.md` | §1 | Carried |
| Meeting-intelligence schema (`decisions`, `action_items`) | prior n8n meeting-intelligence flow | §2 | Carried |
| 11-type fact taxonomy | prior planning docs (#12–#15) | §2 — documented extension point | Carried as extension point, not baseline — resolves U4 |
| `extracted_facts` / `meetings` row shapes | prior n8n meeting-intelligence flow | §2 Storage | Carried |
| Transcript-not-logged constraint | prior n8n meeting-intelligence flow (implicit in node handling) | §2 | Carried, made explicit |
| Calendar-reminder downstream logic | prior n8n meeting-intelligence flow downstream nodes | §2 Downstream | Carried |
| `compositeSignal()` Not-Ready-unreachable bug | (none — found reading shipped code) | §"The composite rule" | Changed — fixed 2026-08-21 by porting the decisive-POC rule from the prototype's `scout/routing.ts`. The fork had already resolved this with rationale and golden fixtures; the answer was neither option this spec originally posed |
