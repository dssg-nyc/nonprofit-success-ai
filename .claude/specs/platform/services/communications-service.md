# Communications Service
**Plate:** C4.3 in docs/nonprofit-success-system-design.html
**Status:** GAP
**PRD sections:** §8

> Design note: the prior agent spec (Envoy) framed this as an agent; the PRD's
> consolidated model classifies it as a service. The service framing is authoritative.
> Envoy's engineering detail — occasion taxonomy, HITL rationale, Pulse/Health Service
> relationship, template fallback contract — is carried here in full.

## Responsibility

Sends templated partner communications with optional model-polished prose — staff-initiated
only, L3-gated, never autonomous. The partner-facing communications surface — the
counterpart to Health Service's internal-only scope. Where Health Service surfaces
engagement status to DSSG staff, Communications Service is what actually reaches the
partner org.

The service is not an agent — it has no reasoning loop, no tool use, no confidence scoring.
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
2. Event-suggested (health service proposes a draft might be warranted) — deferred: a
   future state once staff trust is established.
3. **Staff-initiated (current)** — the approved model.

**Health Service detecting `at_risk` must not auto-trigger a communication draft.** It
surfaces the signal to staff, who then decide to initiate.

## §2 Occasions

`occasion` is a caller input, not a model judgement, and it is stamped server-side so a
draft cannot come back attributed to a different occasion than the one requested.

Registered occasions: `kickoff` | `check_in` | `milestone_reached` | `at_risk_follow_up` | `wrap_up`

**`at_risk_follow_up` template treats health concerns carefully.** Health Service infers
from *recorded* activity, so a partner may have been working the whole time without
anything being logged. The draft raises the concern as a question ("we would rather ask
than assume") rather than an accusation. When no concerns are supplied, the draft owns the
gap as possibly DSSG's own rather than manufacturing a reason for the follow-up.

## §3 Relationship to Health Service

**Availability, not triggering.** Health Service's `reasons[]` can be passed in as
`staffNotes` for an `at_risk_follow_up` draft — that is the whole of the link. An at-risk
health signal does **not** cause a communication draft to be created; a staff member
decides whether the situation warrants contacting the partner at all.

## §4 Draft and confirm flow

Staff selects an occasion and recipient in the engagement UI → POST `/api/draft-communication` →
server selects the matching template → if staff opted into AI polish, calls model gateway
to rewrite the body for tone and clarity → returns draft to staff for preview and editing →
staff confirms → POST `/api/send-communication` → email sent → `communication_log` row written.

**The draft step does not send or log.** The confirm step sends and logs. This two-step
flow is how the L3 gate is enforced in the API, not just in the UI.

**Model polish failure** — gateway throws → service falls back to template-only body,
`polished = false`, draft returned successfully. Fallback draft still routes through staff
confirmation — it is never auto-sent.

**Double-confirm** — second POST to confirm with the same `previewToken` → 409, no second
email sent.

## §5 Deterministic fallback

`generateCommunicationDraft()` — occasion-specific templates, in the same spirit as
`architect/plan.ts`. Returns the same `CommunicationDraft` shape the model path does, so
the caller falls back on any failure without branching on which path produced the draft. A
staff member is going to read and edit this before it is sent, so a plain accurate scaffold
beats a fluent guess.

## §6 HITL tier

**L3, always.** Every draft is reviewed by a human before it reaches a partner. `hitlTier`
is omitted from any model schema, so the model cannot mark its own draft as needing no
review. A blank draft is a failed generation — unlike Chronicle, there is no "nothing to
say yet" verdict this service could legitimately represent.

Model-drafted content passes through `/api`, never composed client-side, per the "no
secrets reach the client" constraint (`CLAUDE.md` Conventions).

## Contract

- **Input (draft):** `CommunicationDraftInput` — `engagementId` (FK), `occasion` (one of the registered occasion keys), `recipientEmail` (string), `staffNotes?` (string), `aiPolish?` (boolean, default false)
- **Output (draft):** `CommunicationDraft` — `subject` (string), `body` (string), `polished` (boolean), `occasion` (string), `previewToken` (string — required by the confirm endpoint)
- **Input (confirm):** `previewToken` (string)
- **Side effects (on confirm only):** Sends email; writes one `communication_log` row with `polished`, `occasion`, `sentAt`, and `recipientEmail`. The draft step does not send or log.

## Rules

- `hitlTier = 'L3'` always — the service never sends without an explicit staff confirmation step after previewing the draft. There is no L2 path for communications.
- `aiPolish` rewrites only the body text — subject line, recipient, occasion, and template-variable substitutions are never modified by the model.
- Templates are static files in `src/agents/communications/templates/` — not stored in the database. A template change requires a deploy, not a database edit, so changes are version-controlled.
- `recipientEmail` must match the engagement's registered contact email unless staff explicitly overrides (an acknowledged mismatch flag in the confirm request). This check is server-side.
- Model polish failure: gateway throws → service falls back to template-only body, `polished = false`, draft returned successfully. Fallback draft still routes through staff confirmation — it is never auto-sent.
- Double-confirm: second POST to confirm with the same `previewToken` → 409, no second email sent.
- No new Firebase surface area. `communication_log` writes to Supabase.
- Staff-initiated only. Health Service detecting `at_risk` must not auto-trigger a communication draft.
- `occasion` is stamped server-side — a draft cannot be attributed to a different occasion than the one requested.
- The `at_risk_follow_up` template raises concerns as questions, not accusations. When no concerns are supplied, it owns the gap as possibly DSSG's own.
- No optional field (`cadence`, `concerns`) is fabricated — if no cadence was agreed, the draft proposes agreeing one rather than naming a rhythm the partner never consented to.

## Dependencies

- **Imports:** `src/types/` (`CommunicationDraftInput`, `CommunicationDraft`); `src/model/gateway.ts` (polish path only); email service (TBD — same provider as contract-consent); Supabase service-role client (`src/lib/supabase.ts`) for log write
- **Imported by:** Engagement detail screen (communications panel, staff-facing)
- **Data:** `communication_log` table (not yet in migrations — needs a new migration); `engagements` table (contact email validation, occasion context); `architect_assessments` (cadence field for template variant selection)

## Delta rows

Cited from [`delta.md`](../../../delta.md) — this spec does not mint numbers.

- **D10** — Communications Service: draft + delivery, `communications` table — GAP
  (`/api/draft-communication`, `/api/send-communication`, occasion templates)

## Test contract

- Template path (no polish): valid input with `aiPolish = false` → `CommunicationDraft` with `polished = false`, body matches template with substitutions applied.
- Polish path: `aiPolish = true` → model gateway called with body text, `CommunicationDraft` with `polished = true`.
- Preview token: draft response includes `previewToken`; confirm endpoint requires it — prevents confirm without prior draft.
- Recipient mismatch: `recipientEmail` differs from engagement contact email → server returns 422 unless override flag is set in confirm request.
- Confirm sends: POST to confirm with valid `previewToken` → email sent, `communication_log` row written with `polished`, `sentAt`, `occasion`.
- Double confirm: second POST with same `previewToken` → 409, no second email.
- Model polish failure: gateway throws → draft returned with `polished = false`, no error surfaced to staff.
- No send on draft: POST to draft endpoint alone → no email sent, no log row written.
- `at_risk_follow_up` with no staffNotes: draft body does not manufacture a reason; framing owns the gap.
- `at_risk_follow_up` with staffNotes: concerns appear as questions, not accusations.

## Open questions

1. Which occasions are in scope for MVP? Likely: `kickoff`, `check_in`, `at_risk_follow_up`, `wrap_up`. Full list needs product sign-off before templates are authored.
2. Email provider: same as contract-consent? The provider decision there unblocks this service too — coordinate.
3. In-portal messaging (deferred) — when it lands, does it share the `communication_log` table and occasion template registry, or is it a separate surface?
4. Should `communication_log` rows be partner-visible in a future partner portal, or internal staff records only?
5. Whether `occasion` set needs to grow (e.g. a scheduling or reschedule occasion).
6. Whether the Architect charter's `cadence` should be read automatically rather than passed in by the caller.
7. Whether staff-initiated should later become event-suggested — Health Service proposing that a draft *might* be warranted, still without creating one.

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
| Relationship to Pulse / Health Service health signal undesigned | prior Envoy spec §Open questions | §3 Relationship to Health Service | Closed — availability, not triggering |
| Relationship to Architect's charter cadence | prior Envoy spec §Inputs, §Open questions | §Contract, §Open questions | Partial — `cadence` is consumed, but passed in rather than read automatically |
| Channel undesigned | prior Envoy spec §Open questions | §Open questions | Carried as open — current channel is email only; in-portal messaging deferred |
