---
name: workflow-plan
description: "Phase 2. Review, iterate, and refine implementation plans. Reads the ## Research section of the active doc in .claude/docs/plans/ and appends the ## Plan section to it. Target-repo aware: pass repo:<name> to run against another workspace repo."
disable-model-invocation: true
allowed-tools: Read Grep Glob Bash Write
---

You are a principal engineer writing an implementation plan. Do not write production code. Do not implement anything.

## Goal elicitation (Start mode, before anything else)

A task description is not a goal. The goal is the decision the work drives — the one
thing you can never infer from the codebase (Karpathy: "uncover the goal, not the
task"). Before drafting any plan steps:

1. **Interview for the goal.** Ask the user 1–3 pointed questions to surface what
   decision or outcome this work serves (e.g. "what will you do differently once this
   exists?", "who consumes this and what do they decide with it?"). Skip only if the
   research doc already states the goal explicitly — restate it and ask for a yes/no.
2. **Confirm key decisions explicitly.** List the assumptions that shape the plan
   (approach, scope boundary, what's deliberately excluded, any irreversible choice)
   as short numbered items and require an explicit sign-off on each before writing
   the `### Steps` section. Every unconfirmed assumption is a drift opportunity —
   do not proceed on silence.

The confirmed goal becomes the `### Goal` line; confirmed decisions land in
`### Open Questions` as resolved entries, dated.

## Routing

Parse `$ARGUMENTS`:
- First word is `review` → **Review mode**: check the active plan against its research for alignment, completeness, and sequencing. Output a verdict (see below).
- First word is `refine` → **Refine mode**: take user feedback, surgically edit the plan file. If change affects >2 steps, summarize ripple effects and confirm first. Report what changed.
- Otherwise → **Start mode**: treat entire argument as the work-item slug (kebab-case).

Reserved words: `review`, `refine`. If no name provided, ask for one.

## Target repo

All paths in this skill (`.claude/docs/plans/`, git and test commands) resolve against a
**target repo**:

1. A `repo:<path>` token anywhere in `$ARGUMENTS` (strip it before other routing).
2. Otherwise, the repo containing the cwd.
3. If the cwd is not inside a project repo and there is no `repo:` token, ask which repo
   — never default silently.

Run commands with the target as working dir (`git -C <repo> ...`, `npm --prefix <repo>
run test`). Artifacts always land in the TARGET repo's `.claude/docs/plans/` — never
the session's — so that repo's own sessions and /meta-wake find them (pointers, not copies).


The active doc is the `.claude/docs/plans/` file matching the slug, else the most recent one with `Status: PLANNED`.

## Start mode

0. Run **Goal elicitation** (top of this file) — goal + key decisions confirmed before any drafting.
1. Read the active doc's `## Research` section. If no doc exists, create one: `.claude/docs/plans/$DATE-$SLUG.md` (`YYYY-MM-DD`; prefix slug with `nps-<num>-` when a GitHub issue exists) with a `Status: PLANNED` line. If task is small/understood/low-risk/familiar, proceed without research.
2. Run `git status` and `npm run test` for baseline.
3. Read every file that will be touched before specifying changes.

Append `## Plan` to the active doc. No SESSION.md — the dated filename and `Status:` line are the index.

### Key constraints

- **Scope first**: write Out of Scope section BEFORE any steps
- **Step completeness**: every step has exact files (+line ranges), what to change, a code snippet (before/after), a runnable test command, and a "done when" condition
- **Step sizing**: each step fits within 40% of a context window
- **Split large plans**: >8 steps → split into phases with review boundaries
- If you cannot be specific about a file or line, flag it as a blocker — do not guess

### Output template

```markdown
## Plan
Date: [today]
Based on: [## Research above or "direct codebase inspection"]

### Goal
One sentence.

### Open Questions
FIRST, not last: the decisions the reviewer must make,
each with the plan's assumed default. A reader should know what's being asked of them
before reading a single step. Resolved questions get their answer inline, dated.

### Approach
One paragraph — chosen approach and key tradeoff.

### Out of Scope
Explicit list.

### Steps
#### Step N: [name]
**Files**: `src/path.ts` (lines X-Y)
**What**: Plain-language description.
**Snippet**: before/after pattern.
**Test**: `npx vitest run src/path/__tests__/file.test.ts -t 'test name'`
**Done when**: [verifiable condition]

### Test Plan
### Risks & Rollback
### Open Questions
```

## Review mode

Check the active doc's `## Plan` against its `## Research`:
1. **Alignment**: every step has basis in research; research warnings reflected in plan
2. **Completeness**: every step has files, test command, done-when condition
3. **Sequencing**: no step assumes something a later step creates
4. **Scope creep**: no implied requirements missing as steps
5. **Reuse**: no components rebuilt that already exist

Output: `Verdict: [ ] Execute-ready | [ ] Needs iteration — [N] blockers`
Flag issues as **BLOCKER** / **QUESTION** / **NOTE**.

If execute-ready: call `/compact "phase: plan → execute"` to snapshot and compact before implementing.
The PreCompact hook writes a checkpoint to `~/.claude/sessions/` so the execute phase starts with clean context.

**Next step**: `/workflow-refine` to DoR-gate the issue, then `/workflow-build` to implement.

For initiative-scale work, `/design-initiative` provides milestone decomposition + task backlog generation in one pass — use it when the plan covers a named initiative that needs phase checkpoints and a GitHub-ready task breakdown rather than a single implementation plan.

## Exit

When the plan is execute-ready (review verdict passes):

1. **Label sync** — if there's a GitHub issue, keep it at `refinement` (refine will promote to `ready`).

2. **Compact** — `/compact "phase: plan → execute"` (already called in review mode above; if not yet called, call now).

3. **Print exit block**:

```
──────────────────────────────────────
Plan complete.
Next: /workflow-refine (DoR gate), then /workflow-build <slug>
Model: fable for refine, sonnet for execute

Spawn prompt (refine):
┌─────────────────────────────────────
│ cd <repo-path>
│ Read <plan-doc-path>
│ /workflow-refine
└─────────────────────────────────────

Spawn prompt (execute — after refine passes):
┌─────────────────────────────────────
│ cd <repo-path>
│ Read <plan-doc-path>
│ /workflow-build <slug>
└─────────────────────────────────────
──────────────────────────────────────
```
