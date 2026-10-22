---
name: workflow-refine
description: "Phase 3. DoR-gates a single plan doc — the last stage before /workflow-build. Checks whether steps are concrete enough to execute without re-scoping, open questions are resolved, and sizing is realistic. Updates Status to REFINED or READY. This is /workflow-triage's third stage, standalone-invocable when driving one plan manually. Target-repo aware: pass repo:<name> to run against another workspace repo. Aliases: /refine."
disable-model-invocation: true
allowed-tools: Read Grep Glob Bash Write Edit
---

You are DoR-gating one plan doc. Your job is to decide whether it is concrete enough to
execute without re-scoping mid-build — not to write new steps, and not to sweep the
whole backlog. That is `/workflow-triage`'s multi-issue mode.

## Target repo

All paths in this skill (`.claude/docs/plans/`, git commands) resolve against a
**target repo**:

1. A `repo:<path>` token anywhere in `$ARGUMENTS` (strip it before other routing).
2. Otherwise, the repo containing the cwd.
3. If the cwd is not inside a project repo and there is no `repo:` token, ask which repo
   — never default silently.

The active doc is the `.claude/docs/plans/` file matching the slug, else the most recent
one with `Status: PLANNED`.

## Step 1 — Read the plan

Read the active doc's `## Plan` section in full, plus the linked GitHub issue if one
exists. Do not skim — every DoR check below depends on the actual step content, not the
section headers.

## Step 2 — Check against the Definition of Ready

From `~/.claude/refs/agile.md`:

- [ ] Problem stated in one sentence (observed friction, not solution)
- [ ] Acceptance criteria — checkable by someone who didn't scope it
- [ ] Enforcement level chosen (hook > skill > rules > MEMORY.md), where applicable
- [ ] Metric named (`absence:` / `count-drop:` / `presence:` / `ratio:`) for tooling changes
- [ ] Sized to one session, or split into a task checklist
- [ ] Dependencies named, none unresolved-blocking
- [ ] Every step has exact files, what to change, and a "done when" condition

If any point fails, do not promote — see Step 4.

## Step 3 — Resolve what you can

Open questions and vague steps are not automatically blockers. Where the answer is
inferable from the codebase or the issue body, resolve it and edit the plan directly —
that's what "refine" means here, as distinct from a batch sweep that only labels. Only
leave a gap open if it needs a decision the plan doc cannot supply on its own.

If the plan needs splitting (too large for one session), add a `- [ ]` task checklist to
the GitHub issue body — one line per session-sized slice, each naming its plan-doc steps.
Do not create sub-issues or extra branches.

## Step 4 — Update Status

- All DoR checks pass, nothing left unresolved → `Status: READY`
- DoR checks pass after this pass resolved the gaps → `Status: READY`
- Gaps remain that need a human decision → `Status: REFINED` (closer, not done) and list
  exactly what's missing under `### Open Questions`
- Fails DoR after two refinement passes (check plan history / issue comments for a prior
  pass) → do not promote; report why and stop. Don't let a plan sit in perpetual refinement.

Edit the `Status:` line at the top of the plan doc in place.

## Step 5 — Report

State the new `Status`, the DoR checklist with each item checked/unchecked, and — if not
`READY` — exactly what's blocking promotion.

## When to use this vs other skills

- **This skill** (`/workflow-refine`): DoR-gate ONE plan doc that's already through
  research and plan. The last stage before build.
- **`/workflow-triage`**: the orchestrator that dispatches research → plan → refine in
  sequence, for one issue, a list, or the whole backlog. This skill is its third stage.
- **`/git-board`**: read-only GitHub issue state. Use it to see what's open before
  choosing what to triage.

Pipeline: `/workflow-research` → `/workflow-plan` → **`/workflow-refine`** → `/workflow-build`

## Exit

When the plan reaches `READY`:

1. **Label sync**:
   ```bash
   gh issue edit <N> --remove-label "backlog" --add-label "ready"
   ```

2. **Compact** — call `/compact "phase: refine → execute"` to shed triage context.

3. **Print exit block**:

```
──────────────────────────────────────
✅ Refine complete — Status: READY.
👉 Next: /workflow-build <slug>
🧠 Model: sonnet

Spawn prompt:
┌─────────────────────────────────────
│ cd <repo-path>
│ Read <plan-doc-path>
│ /workflow-build <slug>
└─────────────────────────────────────
──────────────────────────────────────
```
