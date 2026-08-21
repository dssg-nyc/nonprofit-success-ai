---
name: design-initiative
description: "PM + EM + Designer role — the first design stage. Deconstructs a problem space into HMW statements, clusters them into named initiatives, and produces a design doc that frames what we are building and why. Runs: deconstruct → HMW → technical solutions → workstream clusters → initiative definitions → dependency map. Triggers on: 'what should we build', 'break this down', 'frame the initiative', 'blank-page initiative', 'design doc for X', '/design-initiative'."
disable-model-invocation: true
allowed-tools: Read Bash Grep Glob WebSearch Write AskUserQuestion
---

# /design-initiative

Frame and scope the following into named initiatives: `$ARGUMENTS`

**The first design stage.** This is where a problem space becomes named work. The output
is a design doc — not a PRD, not a system design, not a backlog. Those come later.

## Pipeline position

```
/design-initiative (PM, EM, Des) → .claude/specs/design-scope.md: what we are building, why, initiative map
    ↓
/design-product (PM, EM, Des) → PRD: deliverables, requirements, constraints
    ↓
/design-system (Architect) → two outputs:
    docs/<project>-platform.html (design of record)
    specs/*.md (component build specs)
    ↓
/design-roadmap (PM, EM, Des) → milestones, dependencies, GitHub issues
    ↓
/workflow-scope → /workflow-build
```

No PRD is written without a design doc to scope from. No system design is drawn without
both a design doc and a PRD. No build begins without a design record.

## Target repo

A `repo:<path>` token in `$ARGUMENTS` targets a different repo; all repo-relative paths
and git/test commands resolve against it, and artifacts land in the TARGET repo. No token
→ the cwd's repo. If the cwd is not inside a project repo, ask rather than defaulting.

## Roles at the table

This skill runs as three roles collaborating:

| Role | Focus | Accountable for |
|------|-------|-----------------|
| **PM** | Problem definition, user stories, scope boundaries | "Are we solving the right problem?" |
| **EM** | Technical feasibility, dependency ordering, team capacity | "Can we build this, and in what order?" |
| **Designer** | User journeys, information architecture, interaction patterns | "How does this feel to use?" |

All three voices appear in the output. A design doc that only has PM or only has EM is
incomplete — push for the missing perspective before finalizing.

## Inputs (ask if not provided)

1. **Problem statement** — who hurts, what they do today, what it costs
2. **Known failure modes** — 3-5 distinct ways the system currently fails (patterns, not symptoms)
3. **Existing assets** — prototypes, research, analogous systems, production metrics
4. **Actors** — every person and system that touches the boundary
5. **Constraints** — team size/turnover, budget, deadlines, hard tech constraints
6. **Scope boundary** — what is explicitly in vs out of MVP
7. **Dependencies** — what must exist elsewhere first

## Process

### Phase 1 — Deconstruct

IDEO / Stanford d.school HMW methodology.

1. **Deconstruct** — problems, pain points, insights, opportunities. Table: Area | Finding | Implication.
2. **HMW statements** — reframe each finding as a How Might We question. Outcome-oriented, not solution-prescribing.
3. **Technical solutions** — for each HMW: what's required + concrete named technical approach.
4. **Workstream clustering** — group by WHO (FE), WHERE-BE, WHERE-AI, WHERE-data, WHY (observability), WHERE-Ops. Note cross-cluster items.
5. **Initiative definition** — 5-7 named initiatives. Each: name, one-sentence goal, components, roles, cross-initiative dependencies. First initiative has zero external deps.
6. **Dependency mapping** — visual artifact per initiative: cards with title, description, needs, enables, role badge. Color-coded by role.

### Phase 2 — User journeys (Designer-led)

For each initiative, before it is considered framed:

1. **Primary actors** — who interacts with this, what is their context (volunteer on day 2, staff managing 8 engagements, nonprofit filling a form)
2. **Key journeys** — step-by-step what the actor experiences, including wait states and failure paths
3. **Information architecture** — what does the actor need to see at each step, what decisions do they make, what feedback do they get
4. **Interaction constraints** — accessibility requirements, device context, time budget (a volunteer has 5 minutes, not 30)

### Quality constraints

- Be specific to the use case — no generic outputs that could apply to anything
- Use real numbers, benchmarks, and named tools where they exist
- Cite analogous systems or prior art
- If multilingual requirements exist, call them out as day-one decisions

## Output

Write `.claude/specs/design-scope.md` — one per repo, tracked, no date in the filename. The `**Date:**`
line inside the doc carries the date; the file itself is overwritten in place so
downstream skills and reviewers always read one path.

```markdown
<!-- .claude/specs/design-scope.md -->
# Design Doc — <project/initiative name>
**Status:** Draft | Reviewed | Agreed
**Date:** <YYYY-MM-DD>
**Roles:** PM: <name> · EM: <name> · Des: <name>

## Problem statement
<who hurts, what it costs>

## Deconstruction table
| Area | Finding | Implication |

## HMW statements
| # | HMW | Technical approach |

## Initiatives
### I1 — <name>
Goal: <one sentence>
Components: <list>
Depends on: <none | I2, I3>
Actors: <who uses this>
Key journey: <2-3 sentence walkthrough>

## Dependency map
<visual or table>

## Scope boundary
In: <list>
Out: <list with reasons>

## Open questions
<numbered, each names who must answer>
```

Present each section for confirmation before writing. Park every unknown in
Open Questions rather than guessing.

---

**Next step:** `/design-product` — takes this design doc and produces the PRD
(deliverables, requirements, constraints). The design doc frames the problem;
the PRD defines what gets built.
