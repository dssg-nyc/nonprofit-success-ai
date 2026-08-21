# Health Service
**Plate:** C4.1 in docs/nonprofit-success-system-design.html
**Status:** GAP
**PRD sections:** §8

> Design note: the prior agent spec (Pulse) framed this as an agent; the PRD's
> consolidated model classifies it as a service. Both are aligned on the core engineering
> decisions — deterministic-only computation, pull-on-read, no model call — but the framing
> here is authoritative. The Pulse spec's engineering detail (health taxonomy, thresholds,
> stage windows, HITL rationale) is carried here in full.

## Responsibility

Computes a deterministic engagement health status from engagement events — `on_track` /
`at_risk` / `stalled` — based on days-silent, stage-overrun, and blocker flags, with no
model call. Surfaces that status to DSSG staff so problems are visible before an engagement
stalls or misses its 90-day plan milestones. Internal-facing only — health output goes to
staff, never to the partner org (contrast Communications Service, which is partner-facing).

## §1 Trigger

**Pull-on-read, computed per engagement when staff view it.** Not a scheduled sweep:
`computeEngagementHealth()` is pure and cheap, there is no scheduler in this stack, and a
signal computed at read time cannot go stale between the sweep and the person reading it.
A scheduled digest remains possible later — it would call the same function, so nothing
here forecloses it.

## §2 Inputs

`engagementId` (string, FK to `engagements`), from which the service reads:

- `stage`, `daysInStage` — lifecycle position and how long it has held.
- `daysSinceLastEvent` — recency, from `engagement_events` (migration 0002). **Nullable:**
  an engagement with no recorded events is the normal launch-day state, not an error.
- `lastEventWasBlocker` — whether the most recent event was `blocker_raised`.
- `hasPlan` — whether `engagements.assessment_id` links an Architect assessment.

## §3 Health taxonomy

Deterministic, in `health.ts`. **Five rules applied in order to four numbers.** Rules 1–2
are mutually exclusive (an if/else chain on event recency); rules 3–5 then run
unconditionally and may escalate what 1–2 decided.

1. **No history** (`daysSinceLastEvent === null`) → `at_risk`, **never** `stalled`.
   Absence of evidence is not evidence of stalling — every engagement starts here, and
   nothing writes `engagement_events` yet, so at launch this is the common case. Treating
   it as `stalled` would flag the entire portfolio on day one and teach staff to ignore
   the signal. Reason: `"no recorded activity"`.
2. **Silence** — `daysSinceLastEvent >= STALLED_SILENCE_DAYS` (**21**) → `stalled`;
   otherwise `>= AT_RISK_SILENCE_DAYS` (**14**) → `at_risk`. Both inclusive.
3. **Stage overrun** — `daysInStage` past that stage's window in `STAGE_WINDOW_DAYS` →
   `stalled`, independent of event recency. This catches the engagement that looks active
   and is still stuck, which recency alone cannot see.
4. **Blocker** — a most-recent `blocker_raised` event may only ever *worsen* a verdict
   (`on_track` → `at_risk`); it never softens one already `stalled`. Asymmetric on
   purpose: a raised blocker is evidence of trouble, never evidence of health.
5. **Missing plan** — appended as **context only**. It never changes the status;
   engagements legitimately predate their assessment.

`on_track` is the result when none of 1–4 escalates.

**Unknown stage has no window** rather than a default one, so a stage added by migration
without updating the `STAGE_WINDOW_DAYS` table cannot mark every engagement in it stalled.

Note that rules 2 and 3 both produce `stalled` by different routes — silence and stage
overrun are independent stalling signals, not two thresholds on one axis.

### Output: `HealthResult`

The `reasons[]` array is the point — a bare status label is not actionable, and the
implementation guarantees the array is never empty:

- `status` ('on_track' | 'at_risk' | 'stalled')
- `daysSilent` (number — always populated)
- `stageOverrunDays` (number | null — null when stage has no defined expected duration)
- `openBlockers` (string[])
- `computedAt` (ISO timestamp)

## §4 Thresholds

Two silence thresholds on one axis, plus a per-stage window table:

```ts
export const STALLED_SILENCE_DAYS = 21;
export const AT_RISK_SILENCE_DAYS = 14;

export const STAGE_WINDOW_DAYS: Record<string, number> = {
  initial_meeting: 14,
  budget_check: 21,
  data_ethics_committee: 30,
  scoping: 21,
  hackathon_ready: 45,
  membership: 90,
};
```

**The thresholds are provisional.** They are first estimates, not measured values,
exported as constants so they can be tuned against real engagement data once there is
some. Threshold changes require a code deploy, not a database edit.

There is no `STAGE_OVERRUN_DAYS` offset — a stage window *is* the boundary. An earlier
draft of this spec specified `STALL_DAYS = 30` plus a 14-day overrun offset; that
contradicted the only working implementation of this rubric (the prototype's
`pulse/health.ts`) and was corrected 2026-08-21. The
difference was not cosmetic: under the old spec an engagement silent for 21 days read
`on_track`, and stage overrun produced `at_risk` rather than `stalled`.

## §5 HITL tier

**L2, always.** The service computes a read-only signal for staff; it takes no action
against a partner and writes nothing. There is no path by which it can be anything else,
so the tier is a literal in the type rather than a derivation. The service does not write
`agent_runs` — health computation is not an agent operation.

## §6 No model call

This service has no model path at all — the deterministic computation is the only path.
Health here is a threshold judgement over structured numbers, which is exactly what code
does better than a model: a model would add latency and non-determinism to arithmetic, and
staff cannot audit a flag they cannot reproduce. Any future proposal to "AI-enhance" health
scoring must route through a separate agent spec and a new plate entry — this service stays
deterministic.

## §7 What this service is not

**The health service does not write `engagements.stage`.** Per the 2026-08-06 meeting
resolution, this service only *observes* engagement health. U5 was resolved 2026-08-21 —
the writer is a server-side domain command, `POST /api/engagement-transition`
([crm/lifecycle.md](../../crm/lifecycle.md) §2) — and this service is deliberately not it.
Making the observer the writer would make health signals self-fulfilling.

**An at-risk signal does not auto-trigger a communication draft.** The health service
surfaces the signal to staff, who then decide to initiate via Communications Service.

## Contract

- **Input:** `engagementId` (string, FK to `engagements`)
- **Output:** `HealthResult` — `status` ('on_track' | 'at_risk' | 'stalled'), `daysSilent` (number), `stageOverrunDays` (number | null), `openBlockers` (string[]), `computedAt` (ISO timestamp)
- **Side effects:** None — read-only. Does not write `agent_runs`.

## Rules

- No model call on any path. Any future AI-enhancement routes through a separate agent spec and a new plate entry.
- Stalled check fires before at-risk check — a stalled engagement with open blockers reports `stalled`, not `at_risk`.
- `daysSilent` is always populated; `stageOverrunDays` is null when the stage has no defined expected duration.
- No-history path (`daysSinceLastEvent === null`) → `at_risk`, never `stalled`.
- Thresholds (`STALLED_SILENCE_DAYS`, `AT_RISK_SILENCE_DAYS`, `STAGE_WINDOW_DAYS`) are constants in the service module, not database config — changes require a code deploy.
- Service is server-side only, imported by `api/` handlers or SSR data fetchers. Dashboard components receive `HealthResult` as a prop and do not call Supabase directly for health state.
- Read-only Supabase client (anon key with RLS) is sufficient — no service-role access needed.
- An unknown stage has no window rather than a default one — no stage added by migration without updating `STAGE_WINDOW_DAYS` can mark every engagement in it stalled.
- Health service does not write `engagements.stage`. The writer is the transition command ([crm/lifecycle.md](../../crm/lifecycle.md) §2); this service reads only.
- An at-risk result must not auto-trigger a Communications Service draft — surfaces signal to staff only.

## Dependencies

- **Imports:** Supabase client (`src/lib/supabase.ts`); `src/types/` (`HealthResult`)
- **Imported by:** Dashboard component (engagement list health badges); engagement detail screen (health panel); any `api/` handler that needs to gate on engagement health
- **Data:** `engagement_events` table (deferred `supabase/migrations/0002_engagement_events.sql`); `engagements` table (`0001_init.sql`)

## Delta rows

Cited from [`delta.md`](../../../delta.md) — this spec does not mint numbers.

- **D13** — Health Service: `computeEngagementHealth()` — SPECIFIED
- **D16** — `engagement_events` producer; until it lands every engagement reads `at_risk` — GAP

## Test contract

- `stalled` — silence path: last event 21+ days ago, no open blockers, stage within window
  → `status = 'stalled'`.
- **Boundary, exactly 21 days silent → `stalled`** (inclusive, not 22).
- **Boundary, exactly 14 days silent → `at_risk`** (inclusive); 13 days → `on_track`.
- `at_risk` — silence path: 14–20 days silent → `status = 'at_risk'`.
- `at_risk` — blocker path: recent event + most-recent event is a blocker →
  `status = 'at_risk'`, `openBlockers` non-empty.
- `stalled` — **overrun path**: no blocker, recent activity, but `daysInStage` exceeds that
  stage's `STAGE_WINDOW_DAYS` → `status = 'stalled'`, `stageOverrunDays > 0`. Overrun is a
  stalling signal, not an at-risk one.
- `on_track` path: recent event, no blocker, stage within window → `status = 'on_track'`.
- **Blocker never softens**: 21+ days silent AND a raised blocker → `status = 'stalled'`,
  not `at_risk`.
- **Blocker only worsens**: `on_track` + raised blocker → `at_risk`.
- **Unknown stage**: a stage not in `STAGE_WINDOW_DAYS` with large `daysInStage` and recent
  activity → `status = 'on_track'`, `stageOverrunDays = null`. A new stage must not mark
  its whole cohort stalled.
- No events at all: `daysSinceLastEvent === null` → `status = 'at_risk'` with
  `"no recorded activity"`, **never** `stalled` — including when `daysInStage` is large.
- `reasons[]` is never empty, in any branch — including `on_track`.
- Missing plan adds a reason but does not change status: `on_track` + `hasPlan: false`
  stays `on_track`.
- `computedAt` is within one second of test execution time.
- Missing engagement ID: throws or returns typed error — does not return a default `HealthResult`.

## Open questions

1. `0002_engagement_events.sql` is deferred — what columns does `engagement_events` expose for blocker flags? Boolean column or an event-type enum value?
2. Should health history be tracked (a `health_snapshots` table written periodically) for trend reporting, or is always-current sufficient for the MVP dashboard?
3. ~~Are the thresholds uniform across stages, or per-stage?~~ **Resolved 2026-08-21 — both.** The silence thresholds (`STALLED_SILENCE_DAYS`, `AT_RISK_SILENCE_DAYS`) are uniform; stage overrun is per-stage via `STAGE_WINDOW_DAYS`. Still open: whether the six window values are right, which needs data from a producer for `engagement_events` (question 4).
4. Who writes `engagement_events` — the table and its RLS exist; no producer does. The transition command becomes the first ([crm/lifecycle.md](../../crm/lifecycle.md) §4 writes an event on every transition), but it does not cover `session_held` or `note_added`. Until a fuller producer lands, engagements with no events read as `at_risk` with "no recorded activity".
5. Whether a scheduled weekly digest is worth adding on top of pull-on-read (would call the same function).
6. Whether Communications Service comms history should feed back as an activity signal (reverse direction of the Pulse→Envoy/Communications relationship — undesigned).

## Requirement Trace

| Old requirement | Source | Now at | Status |
|---|---|---|---|
| Weekly internal health monitoring scope | `design-system.md:52` | §Responsibility | Carried |
| Weekly scheduled trigger | prior Pulse spec §Trigger | §1 Trigger | Changed — pull-on-read; no scheduler in this stack |
| Green-field state | `design-system.md:52` | (this doc) | Closed — spec complete |
| Silence thresholds `STALL_DAYS = 30` + `STAGE_OVERRUN_DAYS = 14` offset | earlier draft of this doc | §3, §4 | Changed 2026-08-21 — corrected to `STALLED_SILENCE_DAYS = 21` / `AT_RISK_SILENCE_DAYS = 14` with a per-stage `STAGE_WINDOW_DAYS` table, reconciled against the prototype's `pulse/health.ts`. The draft contradicted the only working implementation and inverted the overrun verdict (`at_risk` → `stalled`) |
| Five ordered rules over four inputs | prior Pulse spec §Taxonomy | §3 | Carried — restored the five-rule shape; an earlier draft folded it to four and lost the silence/overrun distinction |
| Health service does not write `engagements.stage` (Q2 resolution) | 2026-08-06 meeting, via `design-system.md` §5 U5 | §7 / Rules | Carried — U5 resolved elsewhere 2026-08-21 ([crm/lifecycle.md](../../crm/lifecycle.md) §2); this service stays read-only |
| Health-signal handoff to DSSG staff | `design-system.md:79` (handoff diagram) | §Responsibility, §3 Outputs | Carried |
| Health taxonomy undesigned | prior Pulse spec §Outputs | §3 Health taxonomy | Closed — `on_track`/`at_risk`/`stalled` |
| "Activity signal" undefined | prior Pulse spec §Inputs | §2 Inputs | Closed — `engagement_events`, migration 0002 |
| HITL tier unassigned | prior Pulse spec §HITL tier | §5 HITL tier | Closed — L2; read-only |
| Deterministic fallback undesigned | prior Pulse spec §Deterministic fallback | §6 No model call | Closed — no model path exists |
