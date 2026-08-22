---
name: workflow-review
description: "Pre-commit review — walks the diff against a fixed dimension checklist and emits one verdict with structured findings. Dispatched by /workflow-build after execute; also runnable standalone on any branch. Triggers on: /workflow-review, 'review this', 'review the diff', 'is this ready to commit'."
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
---

# /workflow-review

The review gate. Takes a working tree with changes and emits a **verdict** plus
**findings**, in a shape `/workflow-build` can route on without guessing.

This is the only review entry point in this repo. It does not call the global
`/code-review` — that skill's levels 2–3 dispatch retired agents and read a
`finding-schema.md` that no longer lives in global. Everything needed is here.

## Usage

```
/workflow-review                      # review diff vs origin/main
/workflow-review <plan-path>          # also check plan fidelity
/workflow-review --base <ref>         # review against a different base
```

## Step 1 — Establish the diff

```bash
BASE=$(git merge-base origin/main HEAD)
git diff --stat "$BASE"
git diff "$BASE" -- . ':(exclude).claude/docs/*'
```

If the diff is empty and there are no unstaged changes, stop:
`No changes to review.` — do not invent findings from an empty diff.

Include unstaged and staged work — this is a **pre-commit** review, so
`git diff "$BASE"` plus `git status --porcelain` is the real surface. Untracked
files that plan steps created count as part of the change.

## Step 2 — Run the gate before reading code

A failing gate is a finding you get for free, and it re-frames everything else.

```bash
npm run type-check && npm run lint && npm run test
```

Record each result. A gate failure is **always** at least `major`; a type error or
failing test on the changed path is `blocker`. Do not fix anything here — this skill
reviews, it does not repair.

## Step 3 — Plan fidelity (only if a plan doc was given)

Read the plan doc. For each step in `### Steps`:

| Check                                        | Finding if violated                           |
| -------------------------------------------- | --------------------------------------------- |
| Step is implemented                          | `blocker` — plan step N not implemented       |
| Implementation matches what the step said    | `major` — deviation without a recorded reason |
| Deviations are recorded in the plan doc      | `minor` — undocumented deviation              |
| Nothing outside the plan's scope was changed | `major` — scope creep, name the files         |

Scope creep is a real finding, not a bonus. An unrelated refactor in a plan-scoped
diff is exactly what makes a PR unreviewable.

## Step 4 — Dimension pass

Spawn **one** `review-scout` agent to walk the checklist. One agent, one pass —
the dimensions are a checklist inside the agent, not seven parallel agents.

```
Agent(subagent_type: "review-scout", model: "sonnet", run_in_background: false)
prompt: |
  Repo: <repo-path>
  Base: <merge-base sha>
  Plan: <plan-doc-path or "none">
  Gate: type-check=<pass|fail> lint=<pass|fail> test=<pass|fail>
  Task: Review the diff against the seven dimensions in your checklist.
  Emit findings as the JSON block your agent definition specifies. Verdict last.
  Read files before judging them. Do not edit anything.
```

| Dimension        | Asks                                                                                                                                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `correctness`    | Does it do what it claims? Off-by-one, wrong branch, unhandled async, bad state update.                                                                                                                                                                   |
| `contracts`      | Do wire types, schemas, and function signatures still agree across `/api` ↔ `src/`? Did a `src/types/` shape change without its consumers?                                                                                                                |
| `safety`         | Secrets in the bundle, HITL tier granted client-side, service-role key on a client path, missing auth check, RLS bypass.                                                                                                                                  |
| `runtime`        | Does an agent path have its deterministic fallback (`src/lib/scoutRouting.ts` is the pattern)? Is a model call unguarded against failure?                                                                                                                 |
| `testing`        | New behavior without a test. Changed behavior whose test was edited to match rather than the code fixed. Missing eval metric for a new agent.                                                                                                             |
| `silent-failure` | Swallowed errors, `catch {}`, a fallback that hides a real outage, a default that masks a missing value.                                                                                                                                                  |
| `docs-alignment` | Does the change leave a `.claude/specs/` lane spec or `docs/` doc wrong or incomplete? `.claude/specs/` is the build contract agents read; `docs/` is what a new contributor reads. Caps at `major`, never `blocker`; the `fix` carries proposed wording. |

`leakage` applies only if the diff touches `src/evals/` — train/test contamination,
fixture answers reachable from the graded path. Skip it otherwise, and say you skipped it.

## Step 5 — Merge and rank

Take the scout's findings. Drop any that:

- name a file the diff does not touch (unless it's a **contract** break the diff caused)
- restate a gate failure already recorded in Step 2
- are style preferences the linter does not enforce

Rank the survivors by `merge_impact`, most severe first.

### Finding schema

Every finding is:

```json
{
  "dimension": "correctness",
  "file": "src/agents/scout/routing.ts",
  "line": 42,
  "merge_impact": "blocker",
  "summary": "One sentence: the defect itself.",
  "failure_scenario": "Concrete input/state → wrong output or crash.",
  "fix": "What to change. One or two sentences."
}
```

`merge_impact` is the only field `/workflow-build` routes on:

| Value     | Means                                                       | Build routes to                     |
| --------- | ----------------------------------------------------------- | ----------------------------------- |
| `blocker` | Ships a bug, a security hole, or an unimplemented plan step | Escalate to user — never auto-fixed |
| `major`   | Wrong but contained; a reviewer would reject the PR         | Auto-fix loop                       |
| `minor`   | Should change, would not block a merge                      | Auto-fix loop                       |
| `note`    | Observation, no action required                             | Reported only                       |

A finding with no `failure_scenario` is not a finding — it is a preference. Cut it.

## Step 6 — Verdict

One verdict for the whole review:

| Verdict                | When                                                                      |
| ---------------------- | ------------------------------------------------------------------------- |
| `approve`              | No findings above `note`, gate green                                      |
| `comment`              | Only `minor`/`note` findings, gate green                                  |
| `request_changes`      | Any `major` or `blocker`, or the gate is red                              |
| `insufficient_context` | The diff could not be read, the scout failed, or the base is unresolvable |

`insufficient_context` is an infrastructure failure, not a soft `approve`. Never emit
`approve` because the review could not run — that is the one failure mode that makes an
automated review gate worse than no gate at all.

## Step 7 — Write the review doc

```
.claude/docs/reviews/<YYYY-MM-DD>-<slug>.md
```

```markdown
# Review — <slug>

Date: <YYYY-MM-DD>
Base: <sha>
Plan: <plan-path or none>
Verdict: <verdict>
Gate: type-check=<r> lint=<r> test=<r>

## Findings

### <merge_impact> · <dimension> · <file>:<line>

<summary>
**Fails when:** <failure_scenario>
**Fix:** <fix>

## Skipped

- <dimension> — <why>
```

Then print the verdict block to the session:

```
──────────────────────────────────────
  Review: <verdict>
  Blockers: <n>   Major: <n>   Minor: <n>
  Doc: .claude/docs/reviews/<file>.md
──────────────────────────────────────
```

If invoked by `/workflow-build`, the orchestrator parses this block plus the findings
JSON. Emit both — the human block and the machine findings.

## Boundaries

- **Review only — never fix.** The fix stage is a separate build-scout dispatch. A
  reviewer that edits the code it is judging cannot report honestly on it.
- **Never commit, push, or merge.**
- **Never post to a PR unless the dispatcher passed `Authorization: auto-post`** and a
  PR actually exists for the branch.
- **No finding without evidence.** Every finding names a file and line in the diff and
  a concrete failure. Speculation goes in `## Skipped` with the reason.
- **An empty diff yields `approve` with zero findings**, not a manufactured list.
