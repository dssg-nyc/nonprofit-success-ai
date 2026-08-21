---
name: workflow-scope
description: "Triage orchestrator — reads a backlog issue, routes through research → plan → refine as subagents, exits when the plan is READY or reports what's blocking. One retry per stage; after that the main model resolves. Triggers on: /workflow-scope, 'triage this issue', 'scope this issue', 'triage #N', 'what does this need', 'take this to ready'. Aliases: /triage, /scope."
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent, AskUserQuestion
---

# /workflow-scope

The triage entry point — the seam between design and build. Takes a backlog issue (filed
by `/design-roadmap`) from unscoped to READY by routing through the right sequence of
workflow skills as subagents. Opus decides the routing; sonnet executes each stage.
`/workflow-build` picks up from READY.

## Usage

```
/workflow-scope <issue-number> [--repo <repo>]
/workflow-scope "problem statement as inline text"
```

If given an issue number, reads the issue body via `gh`. If given inline text, treats it
as the problem statement directly (no issue lookup).

**Dispatch rule**: a "triage spawn" means spawning an agent that executes THIS skill —
never the bare `plan-refine-scout` agent directly. The plan-refine-scout agent is
one-stage-per-invocation by design; without this orchestrator loop it stops after a
single stage and the issue stalls short of READY (observed 2026-08-19: #149 and #152
each stopped at `plan`).

## Step 1 — Assess current state

Read what already exists for this work item:

```bash
# Issue context (skip if inline text)
gh issue view <N> -R dssg-nyc/<repo> --json title,body,labels

# Existing artifacts
ls .claude/docs/research/*<slug>* 2>/dev/null
ls .claude/docs/plans/*<slug>* 2>/dev/null
```

Classify into exactly one state:

| State | Condition | Next action |
|-------|-----------|-------------|
| `UNSCOPED` | No research doc, no plan doc, problem is unclear or broad | → research |
| `CLEAR` | No research doc, no plan doc, but problem is well-defined in the issue body | → plan (skip research) |
| `RESEARCHED` | Research doc exists, no plan doc | → plan |
| `PLANNED` | Plan doc exists, Status is PLANNED (not refined) | → refine |
| `REFINED` | Plan doc exists, Status is REFINED or READY | → exit (already done) |
| `BLOCKED` | Issue has `blocked` label or plan has unresolved blockers | → report and stop |

**The skip-research decision is the key routing judgment.** Research is warranted when:
- The problem space is unfamiliar (new domain, new tool, new pattern)
- Multiple approaches exist and the issue doesn't specify one
- The issue references external systems/APIs that need investigation

Research is NOT warranted when:
- The issue body already contains the approach, acceptance criteria, and scope
- It's a bug fix with a clear reproduction
- It's a refactor of existing code with a known target state

**Check the reporter's routing answer first.** Issues filed through
`.github/ISSUE_TEMPLATE/` carry a `routing` dropdown answering whether the work is
already decided — rendered in the body under one of these headings, by type:

| Template | Heading | Skip research when the answer starts with |
|----------|---------|-------------------------------------------|
| bug | `Is the cause known?` | `Known` |
| feature | `Is the approach decided?` | `Decided` |
| chore | `Is the work mechanical?` | `Mechanical` |
| refactor | `Is the target shape settled?` | `Settled` |

Treat it as **evidence, not a verdict** — it is the reporter's estimate, and the person
who files a bug is often the one who does not yet know the cause. Trust it when the body
corroborates it: an answer of "decided" alongside a body that names no approach is a
reporter being optimistic, and the prose wins. An answer of "unsure", or no routing
field at all (issues predating this field, filed via `gh`, or transferred in), falls
through to the judgment criteria above.

### Job-type classification

Classify the issue into exactly one job type **before** logging. This runs immediately
after state assessment, using the issue title, labels, and body already in context.

| Job type | Detection (first match wins) |
|----------|------------------------------|
| `debug` | Label `bug`, or title contains: fix / bug / broken / error / regression |
| `refactor` | Label `refactor`, or title contains: refactor / rename / extract / reorganize |
| `chore` | Label `chore`, `docs`, `ci`, or `tooling`; or title contains: chore / docs / update / bump / ledger / tooling |
| `new-feature` | Default — none of the above matched |

**Labels outrank titles.** Issues filed through `.github/ISSUE_TEMPLATE/` carry a
job-type label stamped at creation (`bug` / `enhancement` / `refactor` / `chore`), so the
label is a fact where the title keyword is a guess. Only fall through to title matching
for issues with no job-type label — filed before the templates landed, opened from the
CLI, or transferred from another repo.

Unclassifiable issues (no issue body, inline text only) → `"unknown"`.

The `job_type` field shapes the exit artifact hint in the exit block:
- `debug` → repro steps + root-cause section in plan
- `new-feature` → acceptance criteria + test plan
- `refactor` → before/after contract + no-regression test
- `chore` → scope boundary + done-when condition

Log the routing decision:

```bash
echo '{"ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","issue":'<N>',"repo":"'<repo>'","state":"'<STATE>'","entry_point":"'<NEXT>'","job_type":"'<TYPE>'"}' >> .claude/docs/telemetry/scope-decisions.jsonl
```

## Step 2 — Execute the routing loop

Run stages sequentially. Each stage is a foreground subagent. After each stage completes,
re-assess state (Step 1 logic) and route to the next stage.

**One retry per stage.** If a stage's subagent fails or produces an incomplete artifact:
1. Read what it produced
2. Identify the gap (missing section, unresolved question, incomplete analysis)
3. Re-spawn the same stage with the gap noted in the prompt
4. If it fails again → **stop the loop and surface the issue to the main model**

The main model (you, opus) then resolves the open issues directly — reading the partial
output, filling the gaps, and marking the plan as READY or REFINED. Do not spawn a third
attempt. Two tries means the problem needs judgment, not repetition.

### Research stage (if routed)

```
Agent(model: "sonnet", run_in_background: false)
prompt: |
  Repo: <repo-path>
  Issue: #<N> — <title>
  Task: Run /workflow-research on this issue. Produce a research doc at
  .claude/docs/research/<date>-<slug>.md covering the problem space,
  existing approaches, and a recommended direction.
  Constraint: Read the issue body first. Write the research doc. Do not plan.
```

**Verify**: research doc exists and has a recommendation section.

### Plan stage

```
Agent(model: "sonnet", run_in_background: false)
prompt: |
  Repo: <repo-path>
  Issue: #<N> — <title>
  Research: <research-doc-path if exists>
  Task: Run /workflow-plan. Produce a plan doc at
  .claude/docs/plans/<date>-<slug>.md with Status: PLANNED.
  Include steps, test plan, risks, and sizing.
  Constraint: Read the issue and research doc first. Do not execute.
```

**Verify**: plan doc exists, has `Status: PLANNED`, has steps and test plan.

### Refine stage

```
Agent(model: "sonnet", run_in_background: false)
prompt: |
  Repo: <repo-path>
  Issue: #<N> — <title>
  Plan: <plan-doc-path>
  Task: Run /workflow-refine. Check DoR gate: are steps concrete enough to
  execute without re-scoping? Are open questions resolved? Is sizing realistic?
  Update Status to REFINED or READY. Add a task checklist to the issue body
  if the work needs splitting.
  Constraint: Read the plan doc first. Do not create sub-issues.
```

**Verify**: plan doc Status updated to REFINED or READY.

## Step 3 — Resolve or exit

After the loop completes (all stages run, or main model resolved gaps):

```bash
# Update issue label
gh issue edit <N> -R dssg-nyc/<repo> --add-label "ready" --remove-label "backlog"

# Log completion
echo '{"ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","issue":'<N>',"repo":"'<repo>'","outcome":"ready","stages_run":['<LIST>'],"retries":'<N>',"job_type":"'<TYPE>'"}' >> .claude/docs/telemetry/scope-decisions.jsonl
```

Print exit block:

```
──────────────────────────────────────
✅ Triage complete — #<N> is READY.
📋 Plan: <plan-doc-path>
📊 Stages: <research|skipped> → plan → refine
🔄 Retries: <N>

Ready for: /workflow-build
──────────────────────────────────────
```

If the main model had to resolve gaps (retry exhausted):

```
──────────────────────────────────────
⚠ Triage complete with manual resolution.
📋 Plan: <plan-doc-path>
🔧 Resolved: <what was fixed by the main model>

Ready for: /workflow-build
──────────────────────────────────────
```

## Performance tracking

Every routing decision and outcome logs to `.claude/docs/telemetry/scope-decisions.jsonl`.
Fields:

| Field | Type | Description |
|-------|------|-------------|
| `ts` | ISO-8601 | When the decision was made |
| `issue` | int | Issue number |
| `repo` | string | Repository name |
| `state` | string | Assessed state at entry |
| `entry_point` | string | First stage routed to |
| `outcome` | string | `ready` / `blocked` / `partial` |
| `stages_run` | list | Stages actually executed |
| `retries` | int | Total retry count across all stages |
| `job_type` | string | `debug` / `new-feature` / `refactor` / `chore` / `unknown` |
| `time_to_ready_s` | int | Wall-clock seconds from start to READY |

No dashboard reads this file in this repo yet — the JSONL is still written so routing
quality stays auditable:
- Routing distribution (what % skip research)
- Time-to-ready trend
- Retry rate (quality signal — high retries = bad routing or weak subagents)

## Critical rules

- **One retry, then YOU resolve.** Don't loop endlessly. Two attempts at a stage is the
  budget. After that, the gap needs opus-level judgment, not another sonnet attempt.
- **Skip research when the issue is clear.** The fastest path to READY is plan → refine.
  Research is investigation, not ceremony.
- **Don't create sub-issues.** Task checklists in the parent issue body, per convention.
- **Don't execute.** This skill takes an issue to READY. Execution is a separate session.
- **Log every decision.** The JSONL is how we measure whether the routing is correct.
