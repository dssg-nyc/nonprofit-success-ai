# Engagement Lifecycle — the state machine

**Status:** Decided 2026-08-21. Resolves **D17** (stage enum ratification, U7) and
**D18** (who writes `engagements.stage`, U5). Not yet implemented — no applied migration
enforces the transition rules below; §9 is the implementation ladder.
**Plate:** C2.1 in `docs/nonprofit-success-system-design.html`
**Lane:** crm (PRD Workstream 2)
**Satisfies:** PRD §5.4 stage transitions; closes the lifecycle gap
[design-system.md](../design-system.md) §7 had promised since before this session

This is the answer to the question `design-system.md` §6 has held open since the two-repo
split: *no component owns lifecycle writes.* One does now.

---

## 0. The structural correction that comes first

**`engagements` is not one row that moves through six stages. It is one row *per* stage.**

`0001_init.sql:176-177` constrains `unique (business_id, stage)`, and
`src/components/business/BusinessPortal.tsx:197` upserts onto exactly that conflict target.
A business at Scoping has up to four `engagements` rows — `initial_meeting`,
`budget_check`, `data_ethics_committee`, `scoping` — each carrying its own
`engagement_status` of `pending | in_progress | completed`.

This was inherited, not chosen: the Firestore portal wrote engagements to the deterministic
document id `{businessId}_{stage}`, so the shape is a translation artifact of a document
store, faithfully preserved into Postgres (`0001_init.sql:168-175` says so explicitly).

Every prior discussion of "who writes `engagements.stage`" assumed a cursor. It is not one,
and the distinction changes the answer:

- **There is no `UPDATE engagements SET stage = …` to authorize.** `stage` is immutable in
  practice — a transition *inserts a new row*. Rewriting `stage` on an existing row would
  either collide with the unique constraint or silently relabel history.
- **The engagement's position in the pipeline is derived, not stored.** No column holds it.
- **`engagements.status` is the mutable field**, and it is already terminal-locked:
  `engagements_enforce_transitions` (`0001_init.sql:407-410`) refuses any move out of
  `completed`.

**Decision: keep the row-per-stage shape.** It is append-structured, which is the right
property for a lifecycle — it retains when each stage was entered and how long it held,
which a single mutable cursor destroys on every write. The Health Service needs exactly
that (`daysInStage`, per-stage windows), and it cannot be reconstructed from a cursor.

The cost is that `stage` reads like a cursor to anyone who has not read this section. §3
names the derived value so nobody has to infer it.

---

## 1. D17 — Ratified: six stages

The `engagement_stage` enum stands as written at `0001_init.sql:66-73`. Six values, in
pipeline order:

| # | Stage | What it means | Exit condition | Window |
|---|---|---|---|---|
| 1 | `initial_meeting` | Discovery call held; org context and data assets identified | Charter signed | 14d |
| 2 | `budget_check` | Cost and volunteer capacity confirmed against the scoped work | Budget confirmed feasible | 21d |
| 3 | `data_ethics_committee` | DSSG ethics review of data handling, consent, and risk | Committee approves | 30d |
| 4 | `scoping` | Architect assessment → charter and 90-day plan agreed | Plan accepted by partner | 21d |
| 5 | `hackathon_ready` | Project brief, data access, and volunteer team in place | Delivery cycle begins | 45d |
| 6 | `membership` | Ongoing DSSG membership relationship post-delivery | — (terminal) | 90d |

Windows are the `STAGE_WINDOW_DAYS` table in
[health-service.md](../platform/services/health-service.md) §4 and are **provisional
estimates, not measured values** — that spec owns them; this table restates them so the
lifecycle reads in one place. They are advisory: an overrun makes the Health Service report
`stalled`, it never blocks a transition.

**Why six over the five in earlier docs.** Six is what every artifact that has ever
executed implements — `firestore.rules:62`, `0001_init.sql:66`, `src/types.ts:15`, and the
portal's `STAGES` array at `BusinessPortal.tsx:24-31`. Five appears only in prose that
predates the schema. Ratifying six costs one meeting confirmation; ratifying five costs an
enum migration, a data backfill, a rewrite of `STAGE_WINDOW_DAYS`, and a UI change, in
exchange for no capability.

`data_ethics_committee` is the stage most likely to be questioned as "not really a
pipeline stage" — it is a DSSG-internal gate, not a partner-facing one. It stays: it has a
real approval body, a real queue, a real duration, and engagements genuinely wait in it.
A gate that engagements wait in is a stage.

**This ratification is a design decision, not a team decision.** `design-system.md` §6
records that six stages "have not been ratified by the team". This spec resolves the
*engineering* question — the enum will not change, and downstream work may depend on it.
If the team later renames or drops a stage, that is a migration against a stable target,
not an open question blocking the state machine.

---

## 2. D18 — Who writes lifecycle state

**Answer: a single server-side domain command, `POST /api/engagement-transition`. It is the
only writer, for every stage, for every actor.** No agent owns lifecycle writes. No client
writes them.

This resolves U5 the way the surrounding architecture already resolves everything else:
*AI proposes; deterministic code decides; humans authorize.* A transition is a decision, so
it belongs to deterministic code, not to an agent.

### What this displaces

**Today the partner org owner writes their own lifecycle state, from the browser, with no
guard.** `BusinessPortal.tsx:155-218` calls `updateStage()`, which upserts an `engagements`
row directly through the Supabase client, and `engagements_insert_own` /
`engagements_update_own` (`0001_init.sql:557-577`) permit it because the row is theirs.
A partner can mark themselves `hackathon_ready` on day one.

That is not an abuse to defend against so much as an unfinished portal: the partner-facing
prototype was built before any of these gates existed. But it is the live behavior, and it
means the migration in §9 is a **restriction** of an existing capability, not a grant of a
new one — the roll-out has to account for the portal losing a write it currently makes.

### Why not the alternatives

| Candidate | Rejected because |
|---|---|
| **The partner org (status quo)** | The subject of a decision cannot be its own approver. Budget check and ethics committee are DSSG-internal gates by definition. |
| **Staff, via a direct admin RLS policy** | Ships stage-writing as a *grant* rather than a *transition*: an admin UPDATE policy authorizes writing any value from any state, so guards, approvals, and events all become optional. `0002` refuses this explicitly (`0002:23-25`) and it was right to. |
| **The Health Service** | It reads `stage` to judge overrun. Making the observer the writer means health signals become self-fulfilling. [health-service.md](../platform/services/health-service.md) §7 already rules this out. |
| **An agent (Scout / Architect / Chronicle)** | Agents reason over ambiguous input; a transition is a guard evaluation over structured state. An agent may *propose* one (§6), never commit it. |
| **A HubSpot webhook** | `design-requirements.md`:319, 346 — Supabase owns the state machine; a stage never advances because an external system said so. |

### The command contract

```
POST /api/engagement-transition
  { businessId, toStage, evidence?, idempotencyKey }
→ 201 { engagementId, fromStage, toStage, transitionedAt, eventId }
```

Executed with the service-role client, server-side only. Its obligations, in order, in one
transaction:

1. **Authenticate** the caller and resolve their role from `users.role` (never from the
   request body).
2. **Derive** `fromStage` (§3) — the caller does not supply it. A client-supplied
   `fromStage` is a lost-update race waiting to happen.
3. **Authorize** the actor against the transition's row in §4.
4. **Evaluate the guard**. A failed guard is `422` with the unmet condition named — never a
   silent no-op.
5. **Check the approval**, where the transition requires one: an `approvals` row for this
   engagement with `status = 'approved'` (deferred migration `_deferred/0005`).
6. **Write**, atomically:
   - `UPDATE` the current stage's row to `status = 'completed'`
   - `INSERT` the target stage's row at `status = 'in_progress'`
   - `INSERT` an `engagement_events` row
   - `INSERT` an `audit_events` row (once `_deferred/0005` lands)
7. **Fire side effects after commit**, never inside the transaction (§7).

**Idempotency.** `idempotencyKey` is required and unique per transition attempt; a replay
returns the original `201` body rather than performing a second transition. Without it, a
double-click advances a stage twice. This is the same requirement `data-model.md` §6 states
for workflow writes generally.

**Concurrency.** Deliberately deferred, consistent with the general position in
[design-system.md](../design-system.md) §8.2. The unique constraint on `(business_id, stage)` is the
accidental backstop: two concurrent transitions to the same stage produce one success and
one `23505`, which the endpoint maps to `409`. That is sufficient for a system with one
staff team and no scheduler. It is *not* sufficient against two concurrent transitions to
*different* stages — that races, and the loser's write survives as an orphan
`in_progress` row. If it ever matters, the mechanism is `SELECT … FOR UPDATE` on the
business row, not a `version` column.

---

## 3. Derived vs persisted

The single most confusing thing about this model, stated once:

| Value | Persisted? | Where it comes from |
|---|---|---|
| `engagements.stage` | **Persisted** | Enum on each row. Identifies *which* stage the row is about — not where the engagement is. |
| `engagements.status` | **Persisted** | `pending \| in_progress \| completed`, per stage row. The mutable field. |
| **Current stage** | **Derived** | The `engagements` row for the business with `status = 'in_progress'`; if none, the furthest-along `completed` row in pipeline order. |
| `daysInStage` | **Derived** | `now() - created_at` of the current stage's row. |
| **Stage history** | **Derived** | The set of rows itself, ordered by enum position. No separate table. |
| `daysSinceLastEvent` | **Derived** | Max `created_at` from `engagement_events`. |
| **Health status** | **Derived** | Computed on read by the Health Service. Never stored — see [health-service.md](../platform/services/health-service.md) §1. |
| **Engagement complete** | **Derived** | §5. |
| `assessment_id` | **Persisted** | Nullable FK to the Architect plan (`0002`). |

The derivation of "current stage" already exists in the client:
`BusinessPortal.tsx:134` does `data.find(e => e.status === 'in_progress')`. **That belongs
server-side**, as one shared function, because two implementations of "where is this
engagement" will disagree. `0001_init.sql:172-174` records the same class of bug biting
once already — a `find()` returning whichever row it hit first.

**Rule: nothing is persisted that can be derived from the rows plus the event log.** No
`current_stage` column, no `days_in_stage` column, no cached health. Every one of them is a
denormalization that can disagree with its source, and none is expensive to compute at six
rows per business.

---

## 4. The transition table

Actors: **Partner** (org owner, `owner_id = auth.uid()`), **Staff** (`users.role = 'admin'`),
**Ethics Committee** (staff acting in a committee capacity — not a distinct role until the
diplomat tier lands, see [access-model.md](access-model.md)), **System** (the transition
command, acting on a verified server-side precondition).

Every row writes an `engagement_events` row and, once `_deferred/0005` lands, an
`audit_events` row. "Event written" names the `engagement_event_kind`; the enum
(`0002:62-67`) currently has `milestone_completed | session_held | blocker_raised |
note_added`, so §8 adds `stage_advanced` and `stage_reverted`.

### Forward transitions

| From | To | Trigger | Actor | Guard | Approval | Event | Side effects |
|---|---|---|---|---|---|---|---|
| *(none)* | `initial_meeting` | Scout intake approved, `composite_signal = Ready` | System | Reviewed `scout_intakes` row with `review_status = 'reviewed'` and `review_action ∈ (approved, edited)` | Already given — the Scout review **is** the approval | `stage_advanced` | Create `businesses` row if absent; notify staff; push contact to HubSpot |
| `initial_meeting` | `budget_check` | Charter signed | System, on `POST /api/contract-sign` | Immutable `engagement_contracts` row written; `signerName` matches contact | The signature is the approval | `stage_advanced` | PDF emailed to signer + dssgnyc@gmail.com; same transaction as the contract insert |
| `budget_check` | `data_ethics_committee` | Staff confirms budget and volunteer capacity | Staff | `engagements.budget_amount` is non-null and ≥ 0 | Staff action is the authorization (L2) | `stage_advanced` | Ethics committee queue notification |
| `data_ethics_committee` | `scoping` | Committee approves data handling | Ethics Committee | An `approvals` row for this engagement, `entity_type = 'assessment'`, `status = 'approved'` | **Required — L3.** Recorded, not implied | `stage_advanced` | Unblock Architect assessment; notify partner |
| `scoping` | `hackathon_ready` | Partner accepts charter and 90-day plan | Staff, on recorded partner acceptance | `engagements.assessment_id` is non-null **and** its `architect_assessments` row is complete **and** ≥ 1 `milestones` row exists | **Required — L3.** Staff confirms partner acceptance | `stage_advanced` | Project brief published; volunteer team assignment opens |
| `hackathon_ready` | `membership` | Delivery cycle complete | Staff | All `milestones` for the engagement are `completed` or explicitly waived with a reason | **Required — L3** | `stage_advanced` | Chronicle readiness check becomes available; wrap-up communication offered |

### Backward transitions

**Yes, a stage can move backwards — but only by a named, recorded reversal, never by an
edit.** See §5 for why the answer is not "no".

| From | To | Trigger | Actor | Guard | Approval | Event | Side effects |
|---|---|---|---|---|---|---|---|
| *any* | *any earlier stage* | Reversal — a gate that was passed is no longer satisfied (ethics concern raised, budget withdrawn, scope invalidated) | Staff only | A `reason` is **mandatory** and non-empty; target stage must be strictly earlier in enum order | **Required — L3.** A reversal is never L2 | `stage_reverted` | Notify partner; open a review task; **no** deletion of the forward rows |
| `membership` | *any* | — | — | **Blocked.** Terminal | — | — | — |

**A reversal does not delete history.** The forward rows stay exactly as they are; the
reverted-to stage's row returns to `status = 'in_progress'` and the intervening rows keep
`status = 'completed'` with their original timestamps. The `stage_reverted` event is what
makes the reversal legible. A reversal that erased the forward path would make the record
lie about what happened, and would silently reset `daysInStage` — hiding from the Health
Service exactly the engagement most in trouble.

**Non-transitions — what the state machine explicitly does not permit:**

| Attempt | Result |
|---|---|
| Skipping a stage forward (`initial_meeting` → `scoping`) | `422`. Each gate exists to be passed. Advancing two stages is two transitions, each with its own guard and record. |
| A partner writing any transition | `403`. Partners trigger transitions by *doing things* (signing a charter, accepting a plan); they never write the stage. |
| Any transition out of `membership` | `409`. Terminal (§5). |
| A stage change on a `completed` engagement row | Refused by `engagements_enforce_transitions` (`0001_init.sql:407-410`) — the terminal-status lock, already in force. |
| A transition triggered by an inbound HubSpot webhook | Rejected at the integration boundary — `design-requirements.md`:346. |
| A transition whose guard has no evidence | `422` with the unmet condition named. Never a silent success. |

---

## 5. Terminal, and what "complete" means

**Two different notions, currently conflated. They are not the same, and the system needs
both.**

### Terminal stage: `membership`

`membership` is the end of the pipeline. There is nothing after it, and no forward
transition leaves it. It is **terminal but not closed**: an org sits in `membership`
indefinitely as an ongoing DSSG relationship. It is a steady state, not a finish line —
which is why its 90-day window is the longest and why an overrun there is the weakest
signal in the health rubric.

### Terminal status: `status = 'completed'`

Per stage row, and already enforced in the database: once a stage row is `completed` it
cannot leave that state (`0001_init.sql:407-410`). This is the lock that makes a passed
gate a fact.

**A reversal (§4) does not violate this lock**, and the distinction matters for
implementation: reversal moves the *target* row from `completed` back to `in_progress` —
which the trigger, as written, forbids. §8 resolves this: the trigger is amended to permit
the move only when performed by the transition command, which is the only writer with the
service role. The lock stays absolute for every client.

### What makes an engagement complete

**"Complete" is not a stage and not a status. It is a derived judgment, and it needs a
name because three different things currently claim it:**

| Claim | What it actually means |
|---|---|
| `engagements.status = 'completed'` on a row | *That stage* is done. Says nothing about the engagement. |
| Reaching `membership` | The pipeline is done. The delivery work may not be. |
| Chronicle's `status = 'completed'` gate (`design-requirements.md`:CF4) | Ambiguous today — reads a per-stage status as if it were engagement-level. **This is a live defect.** |

**Definition, for the whole engagement:**

> An engagement is **complete** when its `hackathon_ready` row is `status = 'completed'`
> and every `milestones` row for the engagement is `completed` or waived.

Reaching `membership` is the *consequence* of completing, not the definition of it — an
org can complete a delivery cycle and decline membership.

**Consequence for Chronicle:** its readiness gate must test the derived definition above,
not `status = 'completed'` on whichever row `find()` returns. As written it fires on a
completed `initial_meeting` — i.e. after the first discovery call. That is the bug §3's
"derive it server-side, once" exists to prevent, and it should be corrected when Chronicle
is wired.

---

## 6. How milestones relate to stage

**Milestones are delivery tracking *within* a stage. Stage is the gate *between* phases of
the relationship. Neither derives the other, and one guard connects them.**

| | Stage | Milestone |
|---|---|---|
| Granularity | Six, fixed, enum | Many, per engagement, free-form |
| Author | The transition command | Architect's 90-day plan (`_deferred/0006`) |
| Cadence | Weeks to months | Days to weeks |
| Order | Strictly sequential | Parallel, three phases (Days 1–30 / 31–60 / 61–90) |
| Reversible | By recorded reversal only | Freely — `pending \| in_progress \| completed \| blocked` |
| Meaning of "done" | A gate was passed | A deliverable shipped |

**The two rules that bind them:**

1. **Milestones do not advance stages.** Completing every milestone does not fire a
   transition. It *satisfies the guard* on `hackathon_ready → membership`, which a human
   still has to trigger. Auto-advancing on a milestone checkbox would put lifecycle
   authority in whoever ticks the box.
2. **Stages do not create milestones.** Architect does, when it generates the 90-day plan
   during `scoping`. A stage transition may *unblock* their creation; it never writes them.

**Where they meet:** two guards, both in §4 — `scoping → hackathon_ready` requires ≥ 1
milestone to exist (a plan with no milestones is not a plan), and
`hackathon_ready → membership` requires all of them resolved.

**Until `_deferred/0006` lands, both guards are unenforceable.** The `milestones` table does
not exist in an applied migration; Architect emits milestones as prose
(`data-model.md` §3). Until then those two transitions are **staff-attested**: the endpoint
records that a human asserted the condition, and the `audit_events` row says *attested*
rather than *verified*. This is a deliberate, dated weakening — not an oversight — and it
is the strongest reason to land `_deferred/0006` early.

`engagement_events.kind = 'milestone_completed'` (`0002:62-67`) already anticipates this
edge and predates the `milestones` table. Once the table lands, that event should carry the
milestone id in `detail`.

---

## 7. Side effects, failure, and the async boundary

**Every side effect in §4 happens after the transaction commits. None is inside it.**

The transaction is exactly four writes: stage-row update, stage-row insert,
`engagement_events` insert, `audit_events` insert. Emails, HubSpot pushes, PDF generation,
and notifications all follow it. The precedent is already set — `contract-consent.md` rules
that email failure after a successful transaction does not roll back a legal signature.

Failure semantics, extending the four-rung ladder in [stack/vercel-functions.md](../stack/vercel-functions.md#the-four-rung-failure-ladder):

| Failure | Behavior |
|---|---|
| Guard unmet | `422`, condition named, nothing written |
| Approval missing | `422`, nothing written |
| Actor not authorized | `403`, nothing written |
| Duplicate request (same `idempotencyKey`) | `200` with the original result. Not an error |
| Concurrent transition to the same stage | One `201`, one `409` via `23505`. No partial state |
| Database unavailable mid-transaction | Postgres rolls back all four writes. No half-transitioned engagement |
| Side effect fails after commit | Transition **stands**. Failure is logged, retried out of band, and surfaced to staff — never rolled back |
| Approval service unavailable | `503`. The transition does not proceed unapproved |

**Realtime is UI synchronization, not the trigger.** `engagements` is in the realtime
publication (`0001_init.sql:665`), so subscribed clients see the transition. That is a
*consequence* of the write, never a step in it. No side effect may depend on a browser
having received an event — the failure mode is an engagement that only advances while
someone has the tab open.

---

## 8. Schema work this spec implies

None of it is applied. Listed so §4 is not read as describing something that exists.

| # | Change | Why |
|---|---|---|
| 1 | Add `stage_advanced` and `stage_reverted` to `engagement_event_kind` | §4 writes both; neither value exists (`0002:62-67`) |
| 2 | Add `reason text` to `engagement_events`, or use `detail` by convention | A reversal's reason is mandatory (§4). `detail` suffices; pick one and document it |
| 3 | Amend `engagements_enforce_transitions` to allow `completed → in_progress` **only** for the service role | Reversal (§5) needs it; the client-facing lock must stay absolute |
| 4 | Revoke `INSERT`/`UPDATE` on `engagements` from `authenticated`; drop `engagements_insert_own` / `engagements_update_own` | Makes the transition command the *only* writer. The privilege is the outer gate — §2 is unenforceable while the portal can upsert directly |
| 5 | Keep `engagements_select_own` and `engagements_select_admin` unchanged | Reads are settled; this spec changes writes only |
| 6 | Add an `idempotency_keys` table, or a unique index on `(engagement_id, to_stage, idempotency_key)` | §2 requires replay safety |

**Change 4 breaks the partner portal**, which writes stage today (§2). Sequence it with the
portal work that replaces `updateStage()` with a call to the transition endpoint, or the
portal's stage controls fail with `42501`. This is the one item here that is not additive.

---

## 9. Implementation ladder

Ordered so each rung leaves the pgTAP suite green and delivers something usable.

| # | Rung | Delivers | Depends on |
|---|---|---|---|
| 1 | Derive current stage server-side, one shared function | Kills the duplicate `find()` logic (§3) and fixes Chronicle's gate (§5) | Nothing |
| 2 | `POST /api/engagement-transition` with guards, events, and idempotency — additive, portal untouched | The state machine exists and is used by staff | Rung 1 |
| 3 | Enum values + trigger amendment (§8 items 1–3) | Reversal and correct event kinds | Rung 2 |
| 4 | Approval spine (`_deferred/0005`) wired to the three L3 transitions | Approvals recorded rather than implied | Rung 3 |
| 5 | Revoke direct write privileges (§8 item 4) + port the portal | Single-writer invariant becomes true, not just intended | Rung 4 |
| 6 | Delivery tables (`_deferred/0006`) | The two milestone guards become verifiable rather than attested (§6) | Rung 5 |

Rungs 1–2 are the ones worth doing now; they resolve D18 in practice, and the rest hardens
what they establish.

---

## 10. Open questions

- **Ethics Committee as a distinct role.** Modeled as staff-in-a-capacity today. It becomes
  a real role when the diplomat tier lands ([access-model.md](access-model.md)) — the same
  migration that adds `diplomat` should decide whether committee membership is a role, a
  per-engagement assignment, or an `approvals` convention.
- **Do `projects` run their own lifecycle?** [access-model.md](access-model.md)'s open
  question. This spec assumes candidate (1) — the six stages are an *org* journey and a
  project is a deliverable within it. If candidate (2) wins, `unique (business_id, stage)`
  becomes `unique (project_id, stage)` and every guard here re-scopes. **Nothing else in
  this spec changes**, which is a deliberate property of keeping stage row-scoped.
- **Stage windows are unmeasured.** The §1 table is provisional
  ([health-service.md](../platform/services/health-service.md) §4). Revisit after ~10
  engagements have real per-stage durations — which this spec's `stage_advanced` events are
  what make measurable.
- **Waiving a milestone** (§5) needs a mechanism. `_deferred/0006` has no `waived` status —
  either add one or express it as `completed` with a reason. Decide when the table lands.
- **Reversal beyond a signed contract.** A `budget_check → initial_meeting` reversal moves
  back across a signed charter. The signature stays immutable and valid
  ([contract-consent.md](../platform/services/contract-consent.md)); whether re-advancing
  requires a *new* signature is a question for counsel, not for this spec.
