---
name: design-product
description: "PM + EM + Designer role — the second design stage. Takes a design doc (from /design-initiative) and produces a PRD: deliverables, requirements, constraints, responsibility matrix, critical flows. The gate before system design. Triggers on: 'write a PRD', 'define the product', 'product requirements', 'what are the deliverables', '/design-product'."
disable-model-invocation: true
allowed-tools: Read Bash Grep Glob WebSearch Write AskUserQuestion
---

# /design-product

Produce a PRD for: `$ARGUMENTS`

**The second design stage.** The design doc (from `/design-initiative`) frames the problem;
this skill defines what gets delivered. The PRD is a contract between the trio (PM, EM,
Designer) and the Architect who will design the system.

## Pipeline position

```
/design-initiative → .claude/specs/design-scope.md (what we are building, why)
    ↓
/design-product → PRD (deliverables, requirements, constraints)  ← YOU ARE HERE
    ↓
/design-system (Architect) → design of record + specs/*.md
    ↓
/design-roadmap → milestones, dependencies, GitHub issues
```

No system design is drawn without a PRD. No PRD is written without a design doc.

## Roles at the table

| Role | Focus | Accountable for |
|------|-------|-----------------|
| **PM** | Requirements, success criteria, scope | "What must the system do?" |
| **EM** | Feasibility, quality gates, delivery plan | "What's the realistic delivery shape?" |
| **Designer** | UX requirements, accessibility, information design | "What does the user need to see, do, and understand?" |

## Inputs (ask if not provided)

1. **Design doc** (`.claude/specs/design-scope.md`) — the framing from `/design-initiative`
2. **Actors** — every person and system that touches the boundary
3. **Constraints** — team size and turnover, budget, deadlines, hard tech constraints
4. **Prior art** — existing systems, forks, or docs this builds on or replaces

## Document shape

Write `.claude/specs/design-requirements.md` with these sections. The numbering is the contract — reviews and
design records cite `§N`, so keep it stable.

| § | Section | Must contain |
|---|---------|--------------|
| 1 | Executive summary | Problem, proposed system, **recommendations marked as recommendations** — never present an unsettled roster or architecture as fact; §11's reviewers cannot approve a boundary §1 has already closed |
| 2 | Product principles | Each principle phrased as a **test that can fail**, not a slogan — include a graceful-degradation principle |
| 3 | Target system boundary | Identity root, **tenancy model** (the most expensive thing to get wrong), execution boundary |
| 4 | User experience requirements | Per-actor journeys (from design doc Phase 2), accessibility requirements, device context, information hierarchy — **Designer-led** |
| 5 | Workstream 1 | Screens, flows, states. Every "AI content must be distinguishable"-class requirement names the **data requirement** it implies |
| 6 | Workstream 2 | Services, data model, canonical entities, integrations |
| 7 | Workstream 3 | Model boundaries, deterministic fallbacks, shared registries, deployment topology |
| 8 | Responsibility matrix | Apply "**agents reason; services execute**" through each capability. Every reassignment from prior docs carries one sentence of rationale. Add a **does-not-own** column — the boundary an agent must not cross is as load-bearing as the one it owns |
| 9 | Platform registries | Skills, plugins, MCP catalog, policy, schema, model gateway. **Integrations are a governed catalog, not per-agent adapters** — see "Shared capability rule" below |
| 10 | Agent memory & knowledge | Working / episodic / semantic tiers, retrieval provenance fields, and the **promotion gate**: what it takes for run content to become durable shared knowledge |
| 11 | Critical flows | Step-by-step for anything irreversible (signing, sending, publishing). Server-generated timestamps and hashes stated explicitly |
| 12 | Migration / consolidation | Split **done** (residual cleanup) from **open** (genuinely unplanned) |
| 13 | Quality ladder | The Q0–Q5 table (below). Every level names **applies-to**, **gate status**, and an **owner** |
| 14 | Delivery plan | **Name the pilot**: one real user/org, one end-to-end slice, success criteria, date. Then Part → Workstream → deliverables, so each owner reads one row |
| 15 | Review checklist | What a reviewer must approve, mapped to sections that still leave them free to disagree |
| 16 | Open decisions | Flat list, **blocking decisions marked** with a target date and what they block |

## Workstreams are people, not topics

**§5–§7 are named owners.** A workstream with no name on it is a category, and categories
do not get delivered. Title each as `Workstream N — <Concern>: <NAME>`, and carry the same
three names into §14's delivery table so every owner can read exactly one row.

Derive the split from **who is accountable**, not from a tidy taxonomy. If two topic areas
land on one person, they are one workstream; if one topic has no owner, say `TBD` in the
title and file it in §16 — never let it read as owned. Three owners means three
workstreams, even when the topics would sort naturally into five.

Each workstream section ends with its own **acceptance criteria** — the conditions that
let that owner declare their stream done, phrased so they can fail.

## Shared capability rule

**Agents invoke approved operations through shared skills, plugins, and MCP servers; they
do not own separate implementations.** Every external system — CRM, calendar, email,
storage, search — is a platform capability in a governed registry, never an adapter that
one agent carries privately.

§9 names the registries and, for each, what "approved" means: the schema, the permission
scope, the preconditions, and the test that admits an entry. An integration with no
registry entry is not integrated, it is embedded — and embedded integrations fork the
contract once per agent.

Where a registry is the *target* rather than what exists today, say so per row. A registry
listed with no current entries is a plan; a registry listed as if populated is a lie the
next reader inherits.

## The Q0–Q5 quality ladder (§13)

Every level names what it applies to, whether it gates, and **who owns it**:

| Level | Check | Applies to | Gate |
|---|---|---|---|
| Q0 | Unit / schema / permission tests | Code, tools, RLS, structured outputs | Required |
| Q1 | Golden-set regression | Agents, prompts, retrieval, workflows | Required |
| Q2 | LLM-as-judge | Quality, relevance, completeness, groundedness | Required, calibrated against human labels |
| Q3 | **Adversarial / safety** | Prompt injection, tool abuse, data leakage | Required |
| Q4 | Human acceptance | High-impact workflows and UX | Required pre-production |
| Q5 | Production monitoring | Drift, errors, latency, cost, feedback | Continuous |

Two rules that survive review:

- **Q3 is the level nobody volunteers for — assign it by name.** A platform whose agents
  hold tool or MCP credentials and has no adversarial gate has an open hole, not a backlog
  item. Any PRD that reaches §13 without a Q3 owner is incomplete.
- **LLM judges are not the sole authority for high-impact actions.** Deterministic checks,
  permission checks, policy checks, and human approval stay authoritative where required.
  State this in §13 so a passing Q2 can never be read as sufficient on its own.

## Quality bars

- **Every "must" is testable or it is a wish.** If you cannot say how it fails, rewrite it.
- **Entities imply mechanisms.** A governance rule with no entity to enforce it is not a rule yet — name the entity.
- **Structured beats prose where anything downstream computes on it.** Milestones as rows, not paragraphs.
- **Defer expensive machinery behind a measured need** — vector search, knowledge graphs, registries. Name the measurement that would justify each.
- **Every quality level (Q0-Q5 ladder) names an owner.** The adversarial level is the one nobody volunteers for; assign it explicitly.
- **Memory promotion is a gate, not a side effect.** Agents must not silently promote run or conversation content into durable shared memory. Name what approves a promotion and what scopes it (organization, engagement, user permission, classification).
- **Every retrieved item carries provenance** — source, version, tenant/scope, document status. A recommendation whose evidence cannot be traced is unreviewable, so provenance is a schema requirement, not a UI nicety.
- **Separate the audit trail from agent telemetry.** An immutable operational/security trail answers "who did what, and can it be disputed"; agent-run telemetry answers "how did the model behave." Same table for both means retention and access rules collide.
- **Immutable events get their own entity.** Signatures, approvals, and stage transitions are records that must reject later writes — including from admins. If the doc says immutable but names no entity that enforces it, it is not immutable yet.

## Designer contribution (§4 and throughout)

The Designer role is specifically accountable for:

- **§4 UX requirements** — not wireframes, but the constraints: what information density is acceptable, what the zero-data state looks like, what the error state communicates
- **§5 UI workstream** — interaction patterns, state management from the user's perspective
- **Accessibility throughout** — WCAG level, keyboard navigation requirements, screen reader considerations
- **Content design** — what the system says to users in each state (empty, loading, error, success)

## Output

`.claude/specs/design-requirements.md`, tracked, with a status header:

```markdown
# PRD — <project name>
**Status:** Draft | In review | Ratified · <date>
**Reviewers:** <names>
**Design doc:** <path to upstream design doc>
```

Present the draft section-by-section for confirmation before writing. Park every
unknown in §13 rather than guessing.

## Boundary with `/design-system`

**These are two separate documents with two navigation idioms. Do not merge them, and do
not write tabs into a file `/design-system` also writes.**

| | `/design-product` (this skill) | `/design-system` |
|---|---|---|
| Artifact | `.claude/specs/design-requirements.md`, optionally an HTML render | `docs/<project>-platform.html` |
| Navigation | sticky **sidenav**, flat scrolling sections | **tabs**, hash-routed panels |
| Read how | once, top to bottom | jumped into — one plate, or the Delta tab |
| Lifecycle | ratifies once, then freezes | re-verified against the working tree at every publish |
| Owner | the trio (PM, EM, Designer) | the Architect |

Three reasons the split holds:

1. **Different lifecycles.** A frozen PRD should not be republished every time build
   state moves, which is what one shared file would force.
2. **`§N` is this document's stable API.** Reviews, specs, and the design record's PRD
   coverage table all cite it. Interleaving Architect-owned tabs into the same file
   renumbers sections and breaks every citation.
3. **One writer per file is what makes the pipeline gate enforceable.** `/design-system`
   cites this PRD as an input and names it in its footer. That is the right coupling —
   reference, not co-authorship.

Where an HTML render of the PRD is produced, it uses the sidenav idiom and the shared
DSSG tokens (Inter / Fraunces / IBM Plex Mono, royal blue + orange, `--radius: 14px`),
never the tabbed plate layout.

---

**Upstream:** `/design-initiative` — its design doc seeds §1, §3, and §4.

**Next step:** `/design-system` — the Architect takes this PRD and the design doc,
designs the system, and produces two artifacts: the HTML design of record and deep
component specs in `.claude/specs/`.
