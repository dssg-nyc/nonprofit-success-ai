# Envoy
**Plate:** C4.3 in docs/nonprofit-success-system-design.html
**Status:** see `roadmap.md` D10 (built; send path not designed) — build state lives only in the registry and in CLAUDE.md
**PRD sections:** §8

> Design note: the prior consolidated model classified this as a service (Communications
> Service); the current roster restores it as the Envoy agent. Envoy handles partner
> communications — drafting is L3-gated, staff-initiated. The engineering decisions are
> unchanged — occasion taxonomy, HITL rationale, Pulse relationship, template fallback
> contract.

## Responsibility

Sends templated partner communications with optional model-polished prose — staff-initiated
only, L3-gated, never autonomous. The partner-facing communications surface — the
counterpart to Pulse's internal-only scope. Where Pulse surfaces engagement status to
DSSG staff, Envoy is what actually reaches the partner org.

Templates are the primary path; the model is an optional polish step on the body text only.
Staff sees and may edit the draft before any send.

## §1 Trigger

**Staff-initiated, always.** A staff member picks an occasion and asks for a draft; nothing
fires on its own. This is the deliberate choice among the three candidates the prior spec
listed:

1. Fully autonomous (agent decides when to send) — rejected: an agent that autonomously
   decides *when* to contact a partner is a much larger claim on the relationship than one
   that drafts on request, and drafting quality has to earn trust before timing is worth
   delegating.
2. Event-suggested (Pulse proposes a draft might be warranted) — deferred: a
   future state once staff trust is established.
3. **Staff-initiated (current)** — the approved model.

**Pulse detecting `at_risk` must not auto-trigger a communication draft.** It surfaces
the signal to staff, who then decide to initiate.

## §2 Occasions

`occasion` is a caller input, not a model judgement, and it is stamped server-side so a
draft cannot come back attributed to a different occasion than the one requested.

Registered occasions: `kickoff` | `check_in` | `milestone_reached` | `at_risk_follow_up` | `wrap_up`

**`at_risk_follow_up` template treats health concerns carefully.** Pulse infers from
*recorded* activity, so a partner may have been working the whole time without
anything being logged. The draft raises the concern as a question ("we would rather ask
than assume") rather than an accusation. When no concerns are supplied, the draft owns the
gap as possibly DSSG's own rather than manufacturing a reason for the follow-up.

## §3 Relationship to Pulse

**Availability, not triggering.** Pulse's `reasons[]` can be passed in as
`staffNotes` for an `at_risk_follow_up` draft — that is the whole of the link. An at-risk
health signal does **not** cause a communication draft to be created; a staff member
decides whether the situation warrants contacting the partner at all.

## §4 Draft and confirm flow

Staff selects an occasion in the engagement UI → POST `/api/envoy-draft` → the model
drafts (or the template in `src/agents/envoy/draft.ts` does, on failure) →
`submit_envoy_draft()` (0012) writes one `communications` row, one pending L3 approval and
one audit event in one transaction → staff reviews the approval.

**The draft step does not send.** The send step (C3) is not built; nothing leaves the
portal. An approved draft is a record until C3 lands.

**Model failure** — gateway throws → the template is saved and the route answers 200 with
`source: 'fallback'`. A fallback draft still routes through the pending approval; it is
never auto-sent.

**Replay** — the same `idempotencyKey` returns the original result without a model call;
an expired approval answers 409 `draft_superseded`, a mismatched payload 400 `invalid_draft`.

## §5 Deterministic fallback

`generateCommunicationDraft()` — occasion-specific templates, in the same spirit as
`architect/plan.ts`. Returns the same `CommunicationDraft` shape the model path does, so
the caller falls back on any failure without branching on which path produced the draft. A
staff member is going to read and edit this before it is sent, so a plain accurate scaffold
beats a fluent guess.

The fallback is **server-side**, in `api/envoy-draft.ts`, following `architect-plan.ts`:
a failed model call is a 200 carrying the template with `source: 'fallback'`, a model
draft carries `source: 'model'`, and the gateway records the failed call as one `fallback`
run (`failureStatus: 'fallback'`). A missing model key is a fallback too, never a 503.
Only 401 (no session), 400 (bad input) and 405 are non-2xx. *(Decided 2026-10-07,
design-system.md §2.)*

## §6 HITL tier

**L3, always.** Every draft is reviewed by a human before it reaches a partner. `hitlTier`
is omitted from any model schema, so the model cannot mark its own draft as needing no
review. A blank draft is a failed generation — unlike Chronicle, there is no "nothing to
say yet" verdict this service could legitimately represent.

Model-drafted content passes through `/api`, never composed client-side, per the "no
secrets reach the client" constraint (`CLAUDE.md` Conventions).

## Contract

- **Input:** `EnvoyDraftRequest` — `engagementId` (guid), `idempotencyKey` (8-200 chars), `occasion` (one of `ENVOY_OCCASIONS`), `orgName`, `planTitle?`, `cadence?`, `concerns?`
- **Output:** `EnvoyDraftResponse` — the draft (`subject`, `body`, `occasion`, `hitlTier` 'L3') plus `source` ('model' | 'fallback'), `approvalId`, `draftId`, `runId`
- **Side effects:** `submit_envoy_draft()` writes one `communications` row, one pending L3 approval and one audit event, in one transaction. Nothing is sent; the send step is C3 and not built.

## Rules

- `hitlTier = 'L3'` always — the service never sends without an explicit staff confirmation step after previewing the draft. There is no L2 path for communications.
- The model drafts subject and body only; `occasion` and `hitlTier` are never model-supplied.
- Templates live in `src/agents/envoy/draft.ts` — not stored in the database. A template change requires a deploy, not a database edit, so changes are version-controlled.
- Model failure: gateway throws → the template is saved, `source = 'fallback'`, 200. A fallback draft still routes through the pending approval — it is never auto-sent.
- Replay: the same `idempotencyKey` returns the original result; an edit is a new row with `supersedes_id`, and `communications` content is write-once (trigger).
- No new Firebase surface area. `communications` is a Supabase table (0012), admin-readable through RLS, written only by `submit_envoy_draft()`.
- Staff-initiated only. Pulse detecting `at_risk` must not auto-trigger a communication draft.
- `occasion` is stamped server-side — a draft cannot be attributed to a different occasion than the one requested.
- The `at_risk_follow_up` template raises concerns as questions, not accusations. When no concerns are supplied, it owns the gap as possibly DSSG's own.
- No optional field (`cadence`, `concerns`) is fabricated — if no cadence was agreed, the draft proposes agreeing one rather than naming a rhythm the partner never consented to.

## Dependencies

- **Imports:** `src/types/` (`EnvoyDraftRequest`, `EnvoyDraftResponse`); `src/model/gateway.ts`; the caller's user-scoped client for the RPC (no service-role client in `api/`). Email service for C3 is TBD — same provider as contract-consent
- **Imported by:** Engagement detail screen (communications panel, staff-facing)
- **Data:** `communications` table (0012); `engagements` table (occasion context, RLS-checked lookup); `architect_assessments` (cadence field for template variant selection)

## Delta rows

Cited from [`roadmap.md`](../../../roadmap.md) — this spec does not mint numbers.

- **D10** — Envoy: draft + delivery, `communications` table — GAP
  (`/api/draft-communication`, `/api/send-communication`, occasion templates)

## Test contract

- Template path: model failure → template saved, `source = 'fallback'`, 200.
- Model path: model succeeds → `source = 'model'`, provenance row carries model, version and run id.
- Replay: same `idempotencyKey` → original result, no model call, no new rows.
- Expired approval on replay → 409 `draft_superseded`; mismatched payload → 400 `invalid_draft`.
- Authority: non-admin or other-org caller → 42501, mapped by the route.
- No send on draft: the draft endpoint sends nothing (C3 not built).
- `at_risk_follow_up` with no staffNotes: draft body does not manufacture a reason; framing owns the gap.
- `at_risk_follow_up` with staffNotes: concerns appear as questions, not accusations.

## Open questions

1. Which occasions are in scope for MVP? Likely: `kickoff`, `check_in`, `at_risk_follow_up`, `wrap_up`. Full list needs product sign-off before templates are authored.
2. Email provider: same as contract-consent? The provider decision there unblocks this service too — coordinate.
3. In-portal messaging (deferred) — when it lands, does it share the `communications` table and occasion template registry, or is it a separate surface?
4. Should `communications` rows be partner-visible in a future partner portal, or internal staff records only?
5. Whether `occasion` set needs to grow (e.g. a scheduling or reschedule occasion).
6. Whether the Architect charter's `cadence` should be read automatically rather than passed in by the caller.
7. Whether staff-initiated should later become event-suggested — Pulse proposing that a draft *might* be warranted, still without creating one.

## Requirement Trace

| Old requirement | Source | Now at | Status |
|---|---|---|---|
| Partner communications scope | `design-system.md:53` | §Responsibility | Carried |
| Green-field state | `design-system.md:53` | (this doc) | Closed — spec complete |
| Envoy → partner org handoff | `design-system.md:81` (handoff diagram) | §Responsibility, §Contract | Carried |
| No secrets / server-boundary constraint | `design-system.md:36-39`, `CLAUDE.md` Conventions | §6 HITL tier | Carried — inherited repo-wide constraint |
| Trigger model undesigned | prior Envoy spec §Open questions | §1 Trigger | Closed — staff-initiated |
| HITL tier unratified (L3 working assumption) | prior Envoy spec §HITL tier | §6 HITL tier | Closed — L3, encoded and enforced by schema omission |
| Deterministic fallback undesigned | prior Envoy spec §Deterministic fallback | §5 Deterministic fallback | Closed — occasion templates |
| Relationship to Pulse health signal undesigned | prior Envoy spec §Open questions | §3 Relationship to Pulse | Closed — availability, not triggering |
| Relationship to Architect's charter cadence | prior Envoy spec §Inputs, §Open questions | §Contract, §Open questions | Partial — `cadence` is consumed, but passed in rather than read automatically |
| Channel undesigned | prior Envoy spec §Open questions | §Open questions | Carried as open — current channel is email only; in-portal messaging deferred |
