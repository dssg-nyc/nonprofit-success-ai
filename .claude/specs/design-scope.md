# Design Doc — Nonprofit Success AI

**Status:** Draft
**Date:** 2026-08-21
**Roles:** PM: Jian · EM: Ramsey · Des: Tony · CRM: Karthik
**Source:** `docs/nonprofit-success-product-requirements.html` (Tony Amodeo, Data Diplomat Cohort)

## Problem Statement

DSSG NYC runs pro bono data-science engagements for nonprofits. Today, intake runs on
whichever volunteer has an hour free — not on a process. Nonprofits arrive with every
level of data maturity, problem clarity, and capacity, and whoever picks up the email
decides the bucket and the fit from scratch, every time. Nothing is captured or reused,
so each new volunteer cohort re-learns the same judgment calls — and the organizations
with the least data maturity, who often need DSSG most, quietly fall through the cracks.

**What it costs:**
- Volunteer hours burned on ad-hoc triage instead of project work
- Inconsistent routing → bad matches → slow starts → silent stalls
- No engagement visibility — stalls are invisible until someone manually checks
- No institutional memory — each cohort starts from zero
- The least-ready nonprofits, who need DSSG most, are the ones who drop

## Known Failure Modes

1. **Ad-hoc routing** — intake quality depends entirely on which volunteer reviews it;
   no scoring, no consistency, no audit trail
2. **Invisible stalls** — engagements go silent for weeks with no signal to staff;
   by the time someone notices, the relationship is damaged
3. **No assessment structure** — the kickoff call produces whatever notes the volunteer
   takes; no maturity scoring, no charter, no plan
4. **No consent mechanism** — nonprofits proceed on verbal agreements; no signed
   charter, no stage-gating, no audit trail
5. **No learning loop** — completed engagements produce no artifacts that improve the
   next cohort's onboarding or routing

## Existing Assets

| Asset | Location | State |
|---|---|---|
| React SPA (portal UI) | `src/` — 8 screens, Tailwind 4, Vite 6 | Live on Vercel |
| Supabase schema | `supabase/migrations/` — 4 migrations, 6 tables | Applied, live |
| Scout routing heuristic | `src/lib/scoutRouting.ts` | Built, no tests |
| Architect scoring + plan | `src/lib/architectScoring.ts`, `architectPlan.ts` | Built, no tests |
| Intake form | `src/components/scout/ScoutIntakeForm.tsx` | Built |
| Review queue | `src/components/scout/ScoutReviewQueue.tsx` | Built |
| Assessment UI | `src/components/architect/ArchitectAssessment.tsx` | Built |
| Plan UI | `src/components/architect/ArchitectPlan.tsx` | Built |
| Dashboard | `src/components/dashboard/Dashboard.tsx` | Built |
| Product requirements | `docs/nonprofit-success-product-requirements.html` | Revised Aug 2026 |
| Demo store | `src/lib/demoStore.ts` | Live (local state, not Supabase) |
| Supabase auth | `src/lib/supabase.ts`, `src/components/auth/Login.tsx` | Live |
| Deferred migrations | `supabase/migrations/_deferred/` (9 tables) | Drafted, not applied |

**What's missing:** Server boundary (`api/`), eval harness, tests of any kind,
`src/agents/` directory structure, Chronicle agent, health service, contract signing,
meeting intelligence, knowledge retrieval.

## Actors

| Actor | Context | Interaction pattern |
|---|---|---|
| **Prospective nonprofit** | Org leader/staff, filling a form for the first time, 5–7 min time budget | Public intake form, no login |
| **DSSG staff reviewer** | Volunteer or staff managing the intake queue, 2–3 min per review | Authenticated, reviews Scout output, approves/edits/redirects |
| **DSSG staff (engagement)** | Managing 3–8 active engagements, needs to spot the 2 that need attention | Dashboard scan, ~30 sec per engagement |
| **Nonprofit authorized rep** | ED or director, signing the charter — legal consent, not a feature | In-app contract preview + e-signature |
| **Volunteer (project work)** | Cohort member doing the actual data science — not a portal user today | Receives plan/charter context from staff |
| **Public audience** | Reads impact stories, case studies — Chronicle's output | No login; published artifacts |
| **GrantPilot** (system) | Sibling DSSG app; shares Supabase identity aspirationally | Future shared `auth.users`; no integration today |

## Constraints

- **Team:** Volunteer cohorts with high turnover — the system must be learnable in a session
- **Budget:** Under $50/month to run (Vercel free tier + Supabase free tier + Gemini free tier)
- **Timeline:** Phased delivery; no "ship everything in 3 weeks" — each initiative lands independently
- **Tech:** Single-repo TypeScript SPA on Vercel; Supabase Postgres; no Next.js, no multi-repo
- **AI:** Agents reason; services execute. No agent-to-agent delegation. Server-side only.
- **Security:** No secrets in the client bundle. HITL tiering derived server-side. RLS everywhere.
- **Legal:** Contract language pending from DSSG NYC counsel; mechanism designed, text not.

## Deconstruction Table

| Area | Finding | Implication |
|---|---|---|
| Intake triage | Runs on whoever has an hour free — no process, no consistency | Every nonprofit gets a different quality of routing; low-maturity orgs quietly drop |
| Onboarding | No structured assessment; no current-state scoring | Staff can't objectively compare readiness across intakes; charter quality varies |
| Engagement visibility | No health monitoring — stalls invisible until manual check | At-risk engagements don't surface until too late to recover |
| Partner communications | Ad hoc emails from individual volunteers | Tone, timing, and follow-up inconsistent; no audit trail |
| Institutional memory | Nothing from one engagement feeds the next | Every cohort re-learns the same patterns; no improvement loop |
| Data architecture | Supabase is live; no server boundary yet | Model keys can't be protected without Vercel Functions; all AI calls are target, not live |
| Agent scope | Original 5-agent model over-decomposed for current scale | Product requirements recommend 3 agents + shared services; Pulse/Envoy become deterministic services |
| Eval/quality | No eval harness, no golden sets, no quality gates | No way to know if a prompt/model change improved or degraded output |
| Contract/consent | No mechanism for nonprofit sign-off on charter/plan | Stage transitions can't be gated on partner consent |
| Demo vs production data | `demoStore.ts` holds local state; screens don't read Supabase yet | UI exists but doesn't talk to the real database |

## HMW Statements

| # | How Might We... | Technical Approach |
|---|---|---|
| 1 | ...route every intake consistently regardless of which volunteer is available? | Deterministic scoring heuristic (`scoutRouting.ts`) + model-backed classification via server-side Vercel Function |
| 2 | ...give staff a structured, repeatable assessment of each nonprofit's data maturity? | 18-question CSA with dimensional scoring (`architectScoring.ts`), charter + 90-day plan generation |
| 3 | ...make engagement health visible before stalls happen? | Deterministic health service: `on_track`/`at_risk`/`stalled` from days-silent, stage-overrun, blocker flags |
| 4 | ...ensure partner communications are consistent and auditable? | Templated drafts with model enhancement, mandatory L3 approval, staff-initiated only |
| 5 | ...close the learning loop so each engagement improves the next? | Chronicle: end-of-engagement synthesis → impact memos, case studies, lessons → feed Scout kits |
| 6 | ...protect model keys and ensure AI decisions aren't writable from the browser? | Server boundary via Vercel Functions under `/api`; HITL tiering derived server-side |
| 7 | ...measure and gate AI output quality before it reaches production? | Eval harness: deterministic graders + LLM judges, golden-set regression, `targets.yaml` thresholds |
| 8 | ...let nonprofit reps formally accept a charter before the engagement advances? | In-app preview + typed-name e-signature, server timestamp, immutable contract record |
| 9 | ...extract actionable items from meeting transcripts without manual notes? | Server-side structured extraction via `generateObject` → `decisions[]` + `action_items[]` |
| 10 | ...avoid building infrastructure before measuring the need for it? | Start with Postgres retrieval; defer pgvector/knowledge graph; one model adapter, not three frameworks |

## Initiatives

### I1 — Server Boundary & Scout End-to-End

**Goal:** Route every intake through a server-side pipeline with deterministic fallback,
eval coverage, and staff review — the first agent to work end-to-end.

**Components:** `/api/route-intake.ts`, `src/agents/scout/routing.ts` (move from `src/lib/`),
Scout eval suite (golden set + LLM judge), `ScoutIntakeForm` → Supabase writes,
`ScoutReviewQueue` → Supabase reads.

**Depends on:** None — zero external dependencies. This is the keystone.

**Actors:** Prospective nonprofits (form), DSSG staff reviewers (queue).

**Key journey:** Nonprofit fills form → server-side Scout scores → `scout_intakes` row
written → staff reviewer sees card with bucket/confidence/readiness/flags → approves or
redirects → approved intake ready for onboarding.

### I2 — Architect End-to-End

**Goal:** Structured assessment, charter, and 90-day plan — server-side, with staff
approval gate before anything reaches the nonprofit.

**Components:** `/api/architect-assess.ts`, `src/agents/architect/scoring.ts` (move from
`src/lib/`), `src/agents/architect/plan.ts` (move), Architect eval suite, assessment +
plan UI retarget to Supabase.

**Depends on:** I1 (server boundary pattern established).

**Actors:** DSSG staff (conducts assessment), nonprofit POC (provides answers).

**Key journey:** Staff conducts 30-min kickoff call → fills 18-question CSA in-portal →
server-side Architect scores maturity + generates charter + 90-day plan → staff reviews
and approves → charter ready for nonprofit sign-off.

### I3 — Engagement Health & Lifecycle

**Goal:** Deterministic health signals, stage transitions, and activity tracking —
visible to staff in the dashboard, computed at read time.

**Components:** Health service (deterministic: threshold-based `on_track`/`at_risk`/`stalled`),
`engagement_events` producer, dashboard health indicators, stage state machine enforcement.

**Depends on:** I1 (server boundary), DATA (0002 migration with `engagement_events` already landed).

**Actors:** DSSG staff managing active engagements.

**Key journey:** Staff opens dashboard → sees all engagements with health badge →
spots the 2 at-risk ones → clicks in → sees timeline, reasons, current plan →
decides whether to intervene.

### I4 — Contract & Consent Gate

**Goal:** In-app charter preview, e-signature, immutable record, automatic stage
transition from Initial Meeting → Budget Check on signature.

**Components:** Contract preview UI, `/api/contract-sign.ts`, `engagement_contracts` table
(in deferred migration `_deferred/0005`), stage transition trigger, PDF generation + email.

**Depends on:** I2 (charter must exist to sign).

**Actors:** Nonprofit authorized representative, DSSG staff.

**Key journey:** Nonprofit rep receives notification → opens contract view → reads
charter terms + plan summary → types name + title, checks acknowledgment → signs →
server timestamps, record locked, stage advances, PDF emailed to signer + DSSG.

### I5 — Chronicle & Learning Loop

**Goal:** End-of-engagement impact synthesis — case studies and lessons that feed
back into Scout's onboarding kits, closing the institutional memory gap.

**Components:** `src/agents/chronicle/draft.ts`, `/api/chronicle-draft.ts`, readiness gate,
eval suite (grounded + proportionate + clear), knowledge retrieval from approved artifacts.

**Depends on:** I3 (engagement lifecycle must be reliable), I2 (charter/plan as source material).

**Actors:** DSSG staff (reviews drafts), public audience (reads published stories).

**Key journey:** Engagement completes → Chronicle assesses readiness → if ready: generates
impact memo + case study draft → staff reviews/edits/approves → approved artifacts enter
knowledge base → next cohort's Scout onboarding kits are better.

### I6 — Eval Harness & Quality Gates

**Goal:** Measurable quality contracts for every agent and skill — deterministic graders
first, LLM judges second, CI/CD gating, production monitoring.

**Components:** `src/evals/registry.ts`, `src/evals/pipelines/`, `targets.yaml`, golden-set
fixtures, LLM judge prompts, CI eval jobs, `agent_runs` telemetry.

**Depends on:** I1 (first agent to grade). Grows with each subsequent agent.

**Actors:** Engineers (write evals), DSSG staff (monitor override rates).

**Key journey:** Engineer changes a prompt → CI runs golden-set regression → score compared
to `targets.yaml` thresholds → gated: merge only if no regression → production monitors
override rate, latency, cost.

## Dependency Map

```
I1 Server Boundary & Scout ──────────────────────────┐
  │                                                    │
  ├──> I2 Architect End-to-End                         │
  │      │                                             │
  │      ├──> I4 Contract & Consent Gate               │
  │      │                                             │
  │      └──> I5 Chronicle & Learning Loop <─── I3     │
  │                                                    │
  ├──> I3 Engagement Health & Lifecycle                │
  │                                                    │
  └──> I6 Eval Harness ───────────────────────────────┘
            (grows with each agent)
```

Critical path: I1 → I2 → I4 (the shortest path to a signed charter).
Parallel track: I1 → I3 (health can start as soon as the server boundary exists).
I6 is a cross-cutting concern that starts with I1 and expands.

## Scope Boundary

**In:**

- Three AI agents: Scout, Architect, Chronicle (reasoning components)
- Server boundary: Vercel Functions under `/api`
- Deterministic health service (not an agent — threshold computation)
- Eval harness with golden-set regression and LLM judges
- In-app contract signing with e-signature
- Meeting intelligence (transcript → structured extraction) as Architect input
- Single Supabase backend, single model adapter (Gemini via AI SDK)

**Out (with reasons):**

- **Pulse as a separate agent** — absorbed into deterministic health service (no model needed for threshold arithmetic)
- **Envoy as a separate agent** — absorbed into shared communications service (templated drafts, staff-initiated only)
- **Multi-repo architecture** — product requirements doc explicitly rejects this; single repo ships
- **GrantPilot shared identity** — aspirational; no integration work in this scope
- **pgvector / knowledge graph** — deferred until measured need (I5 starts with Postgres retrieval)
- **CrewAI / LangChain / LlamaIndex** — product requirements doc explicitly removes these; one thin model adapter
- **Autonomous agent-to-agent delegation** — agents return structured outputs; no free-form handoffs
- **Real contract legal text** — pending DSSG NYC counsel; mechanism is in scope, text is not
- **Eventbrite / social media / marketing automation** — shared services for later; no current workflow requires them

## User Journeys

### J1 — Prospective Nonprofit Applies (Scout Intake)

**Actor:** Nonprofit org leader, first visit, no account, 5–7 min time budget.

1. Arrives at `/apply` — clean form, no login required
2. Fills 10 questions: org context, data practices, primary need, wish-list, blockers
3. Inline validation guides them; form saves progress locally
4. Submits → server-side Scout scores and writes `scout_intakes`
5. Sees confirmation: "We'll review your submission within [X] business days"
6. **Wait state:** No portal access; next contact is from DSSG staff
7. **Failure:** Server error → deterministic fallback still produces a routing result;
   form validation errors shown inline; empty/gibberish detected by clarity scoring

**Accessibility:** Form must work on mobile (nonprofit EDs fill forms on phones between
meetings). WCAG AA. No time pressure.

### J2 — Staff Reviews Intake (Scout Queue)

**Actor:** DSSG staff/volunteer, reviewing the intake queue, 2–3 min per intake.

1. Opens `/scout/review` — queue sorted by date, filterable by bucket/confidence
2. Each card: bucket, confidence badge, readiness signal, flags, rationale summary
3. Clicks a card → sees full intake answers + Scout's reasoning
4. **Decision:** approve (with optional bucket/readiness edits), redirect, or reject
5. Approved intake → creates Business + Engagement records (manual today, automated in I1)
6. **Information hierarchy:** Health badge → bucket → confidence → flags (scannable in 10 sec)

### J3 — Staff Conducts Assessment (Architect)

**Actor:** DSSG staff, during/after a 30-min kickoff call with nonprofit POC.

1. Opens assessment form for the approved intake
2. Fills 18-question CSA — mix of multiple-choice and short-answer
3. Submits → server-side Architect scores 5 maturity dimensions
4. Sees generated charter + 90-day plan side-by-side with scores
5. **Decision:** approve charter as-is, edit before approving, or request re-assessment
6. Approved charter → becomes the basis for the contract (I4)
7. **Failure:** Model call fails → deterministic plan generation from scores alone

### J4 — Nonprofit Signs Charter (Contract)

**Actor:** Nonprofit ED/director, signing a legal commitment, one-time action.

1. Receives notification (email or in-portal) that charter is ready
2. Opens contract view — sees charter terms, plan summary, obligations
3. Reads through; can download PDF for offline review
4. Types full name + title, checks acknowledgment checkbox
5. Clicks "Sign & Submit" → server timestamps, record locked immutable
6. Stage advances automatically: Initial Meeting → Budget Check
7. PDF emailed to signer + dssgnyc@gmail.com
8. **Failure:** Can't sign if charter not approved; view is read-only after signing
9. **Accessibility:** Must be keyboard-navigable; signature is typed, not drawn

### J5 — Staff Monitors Engagements (Health)

**Actor:** DSSG staff managing 3–8 active engagements, 30 sec per scan.

1. Opens dashboard — grid/list of all active engagements
2. Each shows: org name, stage, days in stage, health badge (green/amber/red), reason summary
3. **Zero-data state:** "No recorded activity" is `at_risk`, never `stalled` — every engagement starts here
4. Clicks into at-risk engagement → sees event timeline, current plan, contact info
5. **Decision:** Intervene? Contact partner? Escalate?
6. **Information density:** Dashboard must surface the 2-3 that need attention without clicking

### J6 — Staff Wraps Up Engagement (Chronicle)

**Actor:** DSSG staff, after engagement reaches `completed`.

1. Opens completed engagement → Chronicle section appears
2. Chronicle assesses readiness: enough data to write from?
3. If `ready`/`thin`: sees generated impact memo + case study draft
4. `thin` drafts are explicitly labeled provisional in the prose
5. **Decision:** approve, edit, or mark as insufficient
6. Approved artifacts → knowledge base for future Scout onboarding kits
7. **Failure:** `not_ready` → no draft, explicit "nothing to write yet" — no plausible placeholder

## Open Questions

1. **Contract legal text** — Who at DSSG NYC drafts the actual agreement language? Target date? (Blocks I4 content, not mechanism.) — *DSSG NYC counsel*
2. **Approved intake → Business + Engagement auto-creation** — Should I1 automate this, or keep it manual through the pilot? — *PM*
3. **GrantPilot shared identity timeline** — When does the shared `auth.users` requirement become real? Does it affect schema decisions now? — *EM + GrantPilot team*
4. **Meeting intelligence source** — Which transcription service for the pilot? (Google Meet, Otter, manual paste?) — *EM*
5. **Communications channel** — Email, in-portal message, or both? Envoy's channel question from the original spec. — *PM + Des*
6. **`compositeSignal()` Not-Ready bug** — Fix in I1 or track separately? `src/lib/scoutRouting.ts:91` makes `Not Ready` structurally unreachable. — *EM*
7. **Shared services scope** — Task service, calendar integration, communications service: which land in I3 vs deferred? — *PM + EM*
8. **Demo store retirement** — When does `demoStore.ts` get replaced by Supabase reads? Per-screen in each initiative, or a dedicated migration pass? — *EM*
