---
name: git-board
description: "Read-only GitHub issue board — shows open issues, grouped by label/milestone/owner, so you know what to pick up before triaging. Never edits anything. Triggers on: /git-board, 'show the board', 'what's open', 'what issues are open', 'show my issues', 'what's assigned to me'."
disable-model-invocation: true
allowed-tools: Bash
---

# /git-board

Show the current GitHub issue state. Read-only — this skill never edits a label, body,
or comment. Use it before `/workflow-triage` to decide what to pick up, or to resume
where you left off.

## Usage

```
/git-board                    # all open issues, this repo
/git-board --mine             # open issues assigned to the invoking GitHub user
/git-board --user <login>     # open issues assigned to a specific user
/git-board --label ready      # filter by label
/git-board --repo <repo>      # target a different repo
```

## Step 1 — Pull issue state

```bash
gh issue list -R dssg-nyc/<repo> --state open \
  --json number,title,labels,assignees,milestone,updatedAt \
  --limit 200
```

Apply `--assignee <login>` (or `@me` for `--mine`) or `--label <label>` as filters on the
same call rather than fetching everything and filtering client-side.

## Step 2 — Group and present

Group by label first (`backlog` / `ready` / `in-progress` / `blocked`, whatever labels
are present), then by milestone within each group. For each issue show: number, title,
labels, assignee, milestone, and how long since `updatedAt` (a stale `in-progress` issue
— untouched for a while — is worth flagging, not just listing).

```markdown
## backlog (N)
| # | Title | Milestone | Assignee | Updated |

## ready (N)
| # | Title | Milestone | Assignee | Updated |

## in-progress (N)
| # | Title | Milestone | Assignee | Updated | Stale? |

## blocked (N)
| # | Title | Blocked by | Assignee | Updated |
```

Flag anything with a `blocked` label or an unresolved `## Blocked by` checklist item at
the top of its group, not buried in the table.

## Step 3 — Suggest next action

Do not triage, label, or edit anything here — only suggest:

- `backlog` issues with no plan doc yet → candidates for `/workflow-triage`
- `ready` issues with no PR yet → candidates for `/workflow-build`
- `in-progress` issues stale for several days → worth a status check with the assignee
- issues with unresolved `Blocked by` → worth checking if the blocker closed

Print a one-line summary and stop. This skill's job ends at showing state — the human
decides what to act on next.

## Rules

- **Never writes.** No `gh issue edit`, no comments, no labels. If a caller wants that,
  point them at `/workflow-triage`.
- **No opinions on priority.** That's `/workflow-triage`'s multi-issue pre-pass (trio
  triage), not this skill's job — this skill reports state, triage judges it.
