---
name: git-pr
description: "Drafts and opens the pull request after the user has reviewed, tested, committed, and pushed. Fills .github/PULL_REQUEST_TEMPLATE.md from the plan doc and diff — including priority and the documentation-coverage fields — presents the draft, and only runs `gh pr create` after explicit approval. Never pushes; assumes the branch is already on the remote. Triggers on: /git-pr, 'open a PR', 'create the pull request', 'draft the PR'."
disable-model-invocation: true
allowed-tools: Read, Bash, Grep, Glob, AskUserQuestion
---

# /git-pr

The last step after `make ship` passes: turn a reviewed, tested, committed, pushed branch
into a pull request. This skill drafts; it never pushes and never opens the PR without
approval.

## Preconditions — check before drafting

```bash
git status --short          # working tree should be clean (nothing to stage)
git log @{u}.. --oneline    # commits not yet on the remote — should be empty if pushed
```

If the branch has no upstream, or has local commits not yet pushed, stop and say so:
**this skill does not push.** Tell the user to push first (`git push -u origin <branch>`)
and re-invoke.

If `make ship` has not been run this session (no evidence of it in the transcript or a
recent green run), ask before proceeding — a PR opened against a red gate is a PR someone
else has to catch.

## Step 1 — Gather context

```bash
git log origin/main..HEAD --oneline   # commits this PR contains
git diff origin/main...HEAD --stat    # files touched
gh issue list -R dssg-nyc/<repo> --state open --json number,title --jq '.[]' # cross-check for Closes #N
```

Find the plan doc for this work, if one exists: `.claude/docs/plans/*<slug>*.md` matching
the branch slug. Read its `### Goal`, `### Steps`, and `### Test Plan` sections — these
are the source for the PR body's Summary and Testing sections, not a re-derivation from
the diff alone.

## Step 2 — Fill the template

Read `.github/PULL_REQUEST_TEMPLATE.md` and populate every section:

- **Summary** — from the plan doc's `### Goal`, one or two sentences. If no plan doc
  exists (bug/spike branch), summarize from the commit messages.
- **Changes Made** — group the diff by area, not file-by-file.
- **Type of Change** — infer from the branch name / plan doc's job-type classification
  if `/workflow-triage` ran (`debug` → Bug fix, `refactor` → Refactor, etc.); ask if
  ambiguous.
- **Priority** — read from the linked issue's labels or the plan doc if either states
  one; otherwise ask. Do not guess a priority silently — it drives reviewer attention.
- **Testing** — check off only what you can verify actually ran: `make ship`'s four
  gates if the session ran it, plus whatever the plan doc's `### Test Plan` specifies.
  Leave "Manual testing performed" for the user to confirm, don't check it for them.
- **Documentation** — walk the diff for `.claude/specs/`, `.claude/refs/` (global,
  read-only from here), `CLAUDE.md`, and `.claude/skills|agents/` changes:
  - Any spec-relevant code changed with no matching `.claude/specs/` update in this
    diff → leave unchecked, note which spec is now stale.
  - Any `.claude/` tooling file changed → check that box and describe what changed
    (new skill, renamed skill, gate added) in the space below it.
  - If genuinely nothing applies, check N/A rather than leaving it blank — a blank
    box reads as "forgot to look," not "doesn't apply."
- **Screenshots** / **Database Changes** — leave the template's own instructions; do not
  fabricate content for sections that don't apply. Delete a section only if the template
  itself says to (Database Changes explicitly allows deletion; the others don't).

## Step 3 — Present the draft, gate on approval

Print the filled body in full and the proposed PR title
(`{PREFIX}-{NUM} {description}` — see repo conventions) before running anything:

```markdown
**Title**: NPS-<N> <description>

**Body**:
<full rendered template>

**Base**: main   **Head**: <branch>
**Closes**: #<N> (if applicable)
```

Block on `AskUserQuestion` — approve, edit, or cancel. This is the same class of gate as
every other GitHub write in this pipeline (`design-roadmap`'s issue filing,
`workflow-triage`'s label writes): outward-facing, immediate, and visible to other
people, so it doesn't get to be a default-yes.

## Step 4 — Open the PR (only after approval)

```bash
gh pr create -R dssg-nyc/<repo> \
  --title "<approved title>" \
  --base main \
  --body "$(cat <<'EOF'
<approved body>
EOF
)"
```

Report the PR URL. Do not merge, do not request reviewers unless asked, do not add
labels beyond what `gh pr create` does by default.

## Rules

- **Never pushes.** If the branch isn't on the remote yet, stop at Preconditions.
- **Never opens the PR without an explicit approval step** — draft, present, wait.
- **Never fabricates a checked box.** An unverified test claim or an unexamined spec is
  worse than an honest "unchecked, here's why."
- **One PR per branch.** If a PR already exists for this branch (`gh pr list --head
  <branch>`), offer to update its body instead of creating a second one.
