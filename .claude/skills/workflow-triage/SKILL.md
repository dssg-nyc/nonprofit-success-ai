---
name: workflow-triage
description: "Triage orchestrator — takes one issue, a list of issues, or the whole backlog through research → plan → refine as subagents until each hits READY (or reports what's blocking). Also runs a trio (PM/Designer/EM) pass and priority sort when given more than one issue. One retry per stage; after that the main model resolves. Triggers on: /workflow-triage, 'triage this issue', 'triage #N', 'triage the backlog', 'groom backlog', 'what's ready to work on', 'take this to ready'. Aliases: /triage, /scope, /groom."
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent, AskUserQuestion
---

# /workflow-triage

The triage entry point — the seam between design and build. Takes backlog work (filed by
`/design-roadmap`) from unscoped to READY by routing through research → plan → refine as
subagents. Opus decides the routing; sonnet executes each stage. `/workflow-build` picks
up from READY. Use `/git-board` first if you need to see what's open before picking
what to triage.

## Usage

```
/workflow-triage <issue-number> [--repo <repo>]     # one issue
/workflow-triage "problem statement as inline text"  # no issue lookup
/workflow-triage --all [--repo <repo>]                # every backlog-labeled issue
/workflow-triage #12 #13 #17 [--repo <repo>]          # an explicit list
```

If given an issue number, reads the issue body via `gh`. If given inline text, treats it
as the problem statement directly. If given `--all` or more than one issue, runs the
**multi-issue pre-pass** (Step 0) before entering the per-issue loop for each.

**Dispatch rule**: a "triage spawn" means spawning an agent that executes THIS skill —
never the bare `plan-refine-scout` agent directly. The plan-refine-scout agent is
one-stage-per-invocation by design; without this orchestrator loop it stops after a
single stage and the issue stalls short of READY (observed 2026-08-19: #149 and #152
each stopped at `plan`).

If you want manual control over one stage instead of the full loop — e.g. you already
have a research doc and just want to iterate the plan — invoke `/workflow-research`,
`/workflow-plan`, or `/workflow-refine` directly. This skill is for when you want the
whole sequence to run without re-invoking between stages.

## Step 0 — Multi-issue pre-pass (only when given more than one issue)

Skip this step entirely for a single issue or inline text — go straight to Step 1.

### Load the set

```bash
# --all:
gh issue list --label "backlog" --json number,title,body,labels --jq '.'
# explicit list: gh issue view each number
```

Also check the Delta tab of the design of record (`docs/<project>-system-design.html`,
if one exists) for items that should be promoted to issues first. If unfiled Δ rows
remain, ask whether to create issues for them before proceeding.

If the set is empty, say so and stop.

### Fan-out research

For each issue, spawn a haiku Agent to investigate feasibility, scope, and approach —
not implementation. Run these in parallel; the point is breadth.

```
Agent(model: "haiku", run_in_background: true)
prompt: |
  Research this issue for a triage pass. You are investigating feasibility,
  scope, and approach — not implementing.

  Issue #<N>: <title>
  <body>

  Answer:
  1. What is the concrete problem? (one sentence, observed friction, not solution)
  2. What would a fix look like? (approach sketch, not implementation)
  3. What enforcement level fits? (hook > skill > rules > MEMORY.md)
  4. What metric would verify it? (absence: / count-drop: / presence: / ratio:)
  5. Can this be done in one session? If not, how does it split?
  6. What depends on this? What does this depend on?
  7. What's the risk of NOT doing this?

  Read relevant files before answering. Write your findings to stdout — no files.
```

Wait for all agents to complete before proceeding.

### Trio triage

**Model note**: fan-out research above uses haiku for breadth. This step synthesizes
agent reports into priority-sorted verdicts — fable's lane. When this skill is dispatched
as a spawned agent for a multi-issue set, use `model: "fable"` for this step.

Apply the PM / Designer / EM framing per issue — three lenses applied by one mind:

| Role | Owns | Asks | Risk angle |
|------|------|------|------------|
| **PM** | Product requirements, user stories, domain knowledge | Who needs this? Does the problem justify the effort? Priority relative to other work? | Product risk — right thing? |
| **Designer** | User workflow, experience, interaction design | How will people use this? Does it compose with existing patterns? | Usability risk — used correctly? |
| **EM** | Technical feasibility, dependency ordering | One session? Dependencies? What breaks if wrong? | Engineering risk — built reliably? |

```markdown
### #<N>: <title>
**PM**: <impact — who benefits, how much, relative to effort>
**Designer**: <architectural fit>
**EM**: <feasibility — one session? dependencies? risk?>
**Verdict**: ready | needs-research | needs-split | defer | close
**Priority**: P1 (do next) | P2 (do soon) | P3 (do eventually)
**Reason**: <one sentence>
```

### Priority sort and report

Present the batch report before entering any per-issue loop:

```markdown
| # | Title | Verdict | Priority | Missing |
|---|-------|---------|----------|---------|
```

Then, for each `ready`-verdict issue, continue into Step 1 (per-issue loop) in priority
order. `needs-research` issues enter the loop starting at the research stage. `defer` and
`close` issues are reported, not looped — see "Resolve non-ready items" below.

### Resolve non-ready items (gated on approval)

Present the classification and **block on AskUserQuestion** before any GitHub write —
flipping a label or editing a body is outward-facing and immediate, unlike the per-issue
loop below whose artifacts stay in `.claude/docs/` until refine promotes them.

```markdown
| Issue | Current label | Proposed action | Reason |
|-------|---------------|------------------|--------|
| #<N>  | backlog       | close / defer    | <one-line justification> |
```

- `defer` — comment explaining what would change the priority; leave `backlog`.
- `close` — offer to close with a comment explaining why.
- `needs-split` — add a `- [ ]` task checklist to the issue body, one line per
  session-sized slice. Do NOT create sub-issues or extra branches.

## Step 1 — Assess current state (per issue)

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
echo '{"ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","issue":'<N>',"repo":"'<repo>'","state":"'<STATE>'","entry_point":"'<NEXT>'","job_type":"'<TYPE>'"}' >> .claude/docs/telemetry/triage-decisions.jsonl
```

## Step 2 — Execute the routing loop (per issue)

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

## Step 3 — Resolve or exit (per issue)

After the loop completes (all stages run, or main model resolved gaps), the issue is
ready for its GitHub label to flip. **This is a GitHub write — gate it.**

```markdown
| Issue | Current label | Proposed label | Reason |
|-------|---------------|-----------------|--------|
| #<N>  | backlog       | ready           | Status: READY, DoR checks passed |
```

Block on AskUserQuestion before running the label edit — whether this issue arrived via
single-issue mode or the multi-issue loop, the write is the same and gets the same gate:

```bash
gh issue edit <N> -R dssg-nyc/<repo> --add-label "ready" --remove-label "backlog"
```

```bash
# Log completion
echo '{"ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","issue":'<N>',"repo":"'<repo>'","outcome":"ready","stages_run":['<LIST>'],"retries":'<N>',"job_type":"'<TYPE>'"}' >> .claude/docs/telemetry/triage-decisions.jsonl
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

In multi-issue mode, run Step 1–3 for each `ready`/`needs-research` issue from the
priority sort before printing a final batch summary (issues promoted, issues still
blocked, issues deferred/closed).

## Telemetry

Every routing decision and outcome — single-issue or multi-issue — logs to
`.claude/docs/telemetry/triage-decisions.jsonl`.

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

## Pipeline position

```
/git-board (state) → /workflow-triage (one issue, a list, or --all) → /workflow-build
```

## When to use this vs other skills

- **This skill** (`/workflow-triage`): the orchestrator. One issue, a named list, or the
  whole backlog — same research → plan → refine machinery either way.
- **`/git-board`**: read-only. Shows open GitHub issue state (all or per-owner) so
  you know what to triage. Never edits anything.
- **`/workflow-refine`**: DoR-gates ONE already-planned issue. This skill's third stage —
  also invocable standalone if you're driving one plan manually.
- **`/workflow-research`** / **`/workflow-plan`**: standalone stages, for when you want
  manual control instead of the full loop.

## Critical rules

- **One retry per issue per stage, then YOU resolve.** Don't loop endlessly. Two attempts
  at a stage is the budget. After that, the gap needs opus-level judgment.
- **Skip research when the issue is clear.** The fastest path to READY is plan → refine.
- **Gate every label write**, single-issue or batch — `gh issue edit` is outward-facing
  and immediate, unlike the loop's own artifacts which stay in `.claude/docs/` until
  approved.
- **Don't create sub-issues.** Task checklists in the parent issue body, per convention.
- **Don't execute.** This skill takes issues to READY. Execution is `/workflow-build`.
- **Log every decision.** The JSONL is how routing quality gets measured later.
- An issue that fails DoR after two triage passes goes back to `backlog` with a comment
  explaining the gap, or gets closed. Don't let issues sit in perpetual triage.
