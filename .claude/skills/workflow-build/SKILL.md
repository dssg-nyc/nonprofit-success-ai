---
name: workflow-build
description: "Build orchestrator — takes a READY plan doc through execute → review → fix loop until approved or escalated. Chains build-scout agents for each stage. Triggers on: /workflow-build, 'build this', 'ship #N', 'execute and review'."
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent, AskUserQuestion
---

# /workflow-build

The build entry point. Takes a READY plan from execute through review to ship-ready.
Opus orchestrates; sonnet (build-scout) executes each stage.

## Usage

```
/workflow-build <plan-path>
/workflow-build <issue-number> [--repo <repo>]
```

## Step 1 — Locate the plan

If issue number given: find matching plan doc in `.claude/docs/plans/` by slug or derive
slug from issue title via `gh issue view`.

```bash
# By issue number
TITLE=$(gh issue view <N> -R dssg-nyc/<repo> --json title -q .title)
SLUG=$(echo "$TITLE" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | cut -c1-40)
ls .claude/docs/plans/*"$SLUG"* 2>/dev/null
```

Verify plan Status:
- `READY` → proceed
- `PLANNED` or `REFINED` → stop: "Plan is <Status> — run `/workflow-scope #N` first."
- `IN_PROGRESS` → resume (a previous build was interrupted)
- `EXECUTED` → skip to review loop (execute already done)

## Step 2 — Assess workspace state

```bash
git status
git branch --show-current
# Check for existing PR
gh pr list --head $(git branch --show-current) --json number,state -q '.[0]'
```

Set mode:
- PR exists → `pr_mode=true` (review will auto-post to PR)
- No PR → `pr_mode=false` (review runs in plan-doc mode, no auto-post)

Log entry decision:

```bash
echo '{"ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","issue":<N>,"repo":"<repo>","plan":"<path>","branch":"<branch>","stage":"execute","round":1,"verdict":"pending","blocker_count":0,"finding_count":0,"outcome":"started"}' >> .claude/docs/telemetry/build-decisions.jsonl
```

## Step 3 — Execute stage

Spawn the build-scout agent for execute:

```
Agent(subagent_type: "build-scout", model: "sonnet", run_in_background: false)
prompt: |
  Repo: <repo-path>
  Plan: <plan-doc-path>
  Branch: <branch-name>
  Stage: execute
  Task: Implement all plan steps per your execute stage, run the gate, pass DoD.
  Constraint: Do NOT review your own work — return after the DoD gate passes.
  Read files before editing them.
```

**Verify** after build-scout returns:
- Plan status is `IN_PROGRESS` or steps are marked done
- Code changes are present (`git diff --stat` is non-empty)
- If build-scout reports failure → log `outcome: escalated`, print failure details, stop

```bash
echo '{"ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","issue":<N>,"repo":"<repo>","plan":"<path>","branch":"<branch>","stage":"execute","round":1,"verdict":"pending","blocker_count":0,"finding_count":0,"outcome":"execute_complete"}' >> .claude/docs/telemetry/build-decisions.jsonl
```

## Step 4 — Review loop (max 3 rounds)

```
round = 1
max_rounds = 3
```

### 4a — Review dispatch

Run `/workflow-review` against the plan and the diff. It runs the gate, then dispatches
the `review-scout` agent (no edit tools — the reviewer never touches the code it judges)
and returns a verdict plus structured findings.

```
/workflow-review <plan-doc-path>
```

Pass `Authorization: auto-post` through **only** if `pr_mode=true`.

Parse the review's JSON findings block for:
- `verdict`: one of `approve`, `comment`, `request_changes`, `insufficient_context`
- `findings`: each with `dimension`, `file`, `line`, `merge_impact`, `summary`,
  `failure_scenario`, `fix`
- `blocker_count`: count of `merge_impact: blocker` findings
- `finding_count`: total findings

If the block is missing or unparseable, treat it as `insufficient_context` (Step 5c) —
never as `approve`.

### 4b — Route on verdict

**approve or comment** → ship-ready exit (Step 5a)

```bash
echo '{"ts":"...","issue":<N>,"repo":"<repo>","plan":"<path>","branch":"<branch>","stage":"review","round":'$round',"verdict":"<verdict>","blocker_count":0,"finding_count":<N>,"outcome":"ship_ready"}' >> .claude/docs/telemetry/build-decisions.jsonl
```

**request_changes with blockers** → blocker escalation exit (Step 5b)

```bash
echo '{"ts":"...","issue":<N>,"repo":"<repo>","plan":"<path>","branch":"<branch>","stage":"review","round":'$round',"verdict":"request_changes","blocker_count":<N>,"finding_count":<N>,"outcome":"blocked"}' >> .claude/docs/telemetry/build-decisions.jsonl
```

**request_changes, no blockers** → fix and re-review

```bash
echo '{"ts":"...","issue":<N>,"repo":"<repo>","plan":"<path>","branch":"<branch>","stage":"review","round":'$round',"verdict":"request_changes","blocker_count":0,"finding_count":<N>,"outcome":"fix_dispatched"}' >> .claude/docs/telemetry/build-decisions.jsonl
```

Spawn build-scout for fix:

```
Agent(subagent_type: "build-scout", model: "sonnet", run_in_background: false)
prompt: |
  Repo: <repo-path>
  Plan: <plan-doc-path>
  Branch: <branch-name>
  Stage: fix
  Findings:
  <paste the major/minor findings as JSON — never blockers>
  Task: Fix each finding listed above. Run the gate after fixes.
  Do not expand scope beyond these findings.
  Read files before editing them.
```

Increment `round`, loop back to 4a.

**Re-review after every fix round.** A fix is not verified until the reviewer has seen
it — a fix stage can introduce a new defect while closing an old one, so the loop always
returns to 4a rather than exiting on the fixer's own say-so.

**insufficient_context** → escalation exit (Step 5c)

```bash
echo '{"ts":"...","issue":<N>,"repo":"<repo>","plan":"<path>","branch":"<branch>","stage":"review","round":'$round',"verdict":"insufficient_context","blocker_count":0,"finding_count":0,"outcome":"escalated"}' >> .claude/docs/telemetry/build-decisions.jsonl
```

**max rounds exhausted** → max-rounds exit (Step 5d)

```bash
echo '{"ts":"...","issue":<N>,"repo":"<repo>","plan":"<path>","branch":"<branch>","stage":"review","round":'$round',"verdict":"<last>","blocker_count":0,"finding_count":<N>,"outcome":"max_rounds"}' >> .claude/docs/telemetry/build-decisions.jsonl
```

## Step 5 — Exit blocks

### 5a — Ship-ready (approve or comment)

**Before closing out: settle the specs.** `docs/` is the team's durable memory of how the
system works — the only record that outlives the issue and is visible to contributors who
never see `.claude/docs/`. A shipped change that leaves it wrong is how the next volunteer
gets misled.

Check the review's `docs-alignment` findings:

- **Findings present** — apply their `fix` wording to the named `docs/` files now, in this
  branch. They ship in the same PR as the code, never as a follow-up. Docs fixes are edits,
  not a new review round: apply and continue, no re-review needed for `minor`/`note`. A
  `major` (a doc now states something false) gets re-checked in the next round if one runs.
- **No findings, and the diff touched no documented surface** — nothing to do.
- **No findings, but the diff added an agent, table, endpoint, or contract** — the reviewer
  may have missed it. Route it yourself via the lane map in the `docs-alignment` section
  of `.claude/agents/review-scout.md`, and either update the lane doc or note in the exit
  block which doc is now owed.

If a change needs a doc that does not exist yet, do **not** author a new spec here — add it
to `design-system.md` §7 ("Docs still to be written") and name it in the exit block. New
specs are a design decision, not a build step.

Update plan doc: set `Status: EXECUTED`, `Review: passed`.

```
──────────────────────────────────────
  Build complete — ship-ready.
  Plan: <plan-doc-path>
  Verdict: <approve|comment>
  Rounds: <N>
  Docs: <files updated | "no documented surface touched" | "owed: <doc> (added to design-system.md §7)">

Ready for: user commit + make ship
──────────────────────────────────────
```

### 5b — Blocker escalation

```
──────────────────────────────────────
  Build blocked — blocker findings need judgment.
  Plan: <plan-doc-path>
  Blockers: <count>
  <blocker list with file:line and description>

Fix blockers manually, then re-run /workflow-build.
──────────────────────────────────────
```

### 5c — Insufficient context escalation

```
──────────────────────────────────────
  Build: review could not reach a verdict.
  Plan: <plan-doc-path>
  Reason: insufficient_context (review infrastructure issue)

Investigate review dispatch failures, then re-run /workflow-build.
──────────────────────────────────────
```

### 5d — Max rounds exhausted

```
──────────────────────────────────────
  Build: max review rounds (3) reached.
  Plan: <plan-doc-path>
  Remaining findings: <count>
  <remaining finding list>

Fix remaining findings manually, then re-run /workflow-build.
──────────────────────────────────────
```

## Telemetry

Every stage transition logs to `.claude/docs/telemetry/build-decisions.jsonl`.

| Field | Type | Values |
|-------|------|--------|
| `ts` | ISO-8601 | When the decision was made |
| `issue` | int | Issue number |
| `repo` | string | Repository name |
| `plan` | string | Plan doc path |
| `branch` | string | Branch name |
| `stage` | string | `execute`, `review`, `fix` |
| `round` | int | 1–3 |
| `verdict` | string | `approve`, `comment`, `request_changes`, `insufficient_context`, `pending` |
| `blocker_count` | int | Count of blocker findings |
| `finding_count` | int | Total finding count |
| `outcome` | string | `started`, `execute_complete`, `ship_ready`, `fix_dispatched`, `blocked`, `max_rounds`, `escalated` |

## Boundaries

- Never commit, push, or merge — the user commits.
- Never auto-fix blocker findings — escalate to user.
- Max 3 review rounds — no infinite loops.
- If no PR exists, review runs in plan-doc mode (no GH review posting).
- The build orchestrator does NOT create branches or PRs — caller's responsibility.
- **Execute and review never share an agent.** `build-scout` writes code and has edit
  tools; `review-scout` judges it and has none. A stage that reviews its own output is
  not a gate.
- **A review that could not run is `insufficient_context`, never `approve`.** Failing
  open would make this loop worse than no review at all.

## Pipeline position

```
/design-initiative → /design-product → /design-system (→ specs/*.md) → /design-roadmap (→ GH issues)
   → /workflow-scope #N (→ plan READY)
   → /workflow-build #N
        ├─ build-scout   (execute)
        ├─ /workflow-review → review-scout   (verdict + findings)
        └─ build-scout   (fix)  ⟲ max 3 rounds
   → user commits → make ship
```
