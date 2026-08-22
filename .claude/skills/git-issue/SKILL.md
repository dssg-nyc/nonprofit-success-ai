---
name: git-issue
description: "Files a GitHub issue for a roadmap backlog item — reads the D/C row from .claude/specs/roadmap.md and its cited spec, fills the matching .github/ISSUE_TEMPLATE form, presents the draft, and only runs `gh issue create` after explicit approval. Labels `backlog` only. Triggers on: /git-issue, 'file an issue for D19', 'open a ticket for this delta', 'create issues for the backlog items'."
disable-model-invocation: true
allowed-tools: Read, Bash, Grep, Glob, AskUserQuestion
---

# /git-issue

Turn a row in the delta registry into a real GitHub issue, using this repo's issue form
templates. This skill drafts; it never files without approval, and it never grants
`ready`.

**Scope boundary vs `/design-roadmap`.** `/design-roadmap` files an *entire* agreed
backlog at once, at the end of a design pass, and owns the HTML Roadmap tab. This skill
files *one or a few* named items on demand, mints nothing, and touches no HTML. If you
are filing a whole freshly-designed backlog, use `/design-roadmap`.

## Usage

```
/git-issue D19                     # file one delta
/git-issue D19 D22 C1              # file several, one issue each
/git-issue --gaps                  # every D row in state GAP with no open issue
/git-issue --state SPECIFIED       # every row in a given state with no open issue
/git-issue --dry-run D19           # print the draft, create nothing
```

`--dry-run` is the default whenever more than three items are selected.

## Step 1 — Read the registry row

`.claude/specs/roadmap.md` **owns** every `D{n}` and `C{n}`. This skill **cites, never
mints** — if the caller names an item that has no row, stop and say so; adding the row is
an edit to the registry and belongs to whoever owns that decision, not to issue filing.

For each selected item, pull from the table:

| Column | Use |
|---|---|
| `#` | the delta id, cited verbatim in the issue body's `## Traces to` |
| `Item` | seeds the title, but the title is imperative — rewrite, don't paste |
| `State` | routes filing — see the state table below; qualifiers in parentheses matter |
| `Needs first` | becomes the `## Blocked by` checklist (D rows) |
| `Blocks` | C rows have this instead — it is the inverse, so it does **not** become a `## Blocked by` entry; name it under `## Traces to` as what the decision unblocks |
| `Plate` | carried into `## Traces to` when present |
| `Spec` | **read this file** — the issue body comes from the spec, not the one-line row |

**States carry qualifiers, and the qualifier is the work.** Match the whole cell, not
its first word:

| State cell | File? |
|---|---|
| `BUILT` / `RESOLVED`, unqualified | **No** — report as done |
| `BUILT … (partial)` / `(migration deferred)` | **Yes** — the issue covers only the named remainder (e.g. D6's non-Scout schemas, D4/D5's deferred migrations). Title it for the remainder, not the whole delta |
| `SPECIFIED` | Yes — approach decided |
| `SPECIFIED (partial)` | Yes — scope it to the unbuilt part (D12: `targets.yaml` thresholds + CI gate) |
| `SPECIFIED (deferred)` | Ask before filing — deferred is a decision, and a ticket reopens it |
| `GAP` | Yes — needs research first |
| `OPEN — decide, don't build` | Yes, as a `Decide:` issue (D40) — never as a build task |

Read the cited spec section before drafting. A row is one line; the issue needs the
spec's actual contract, failure modes, and acceptance conditions. An issue drafted from
the row alone is a title with padding.

## Step 2 — Check for duplicates

```bash
gh issue list -R dssg-nyc/nonprofit-success-ai --state all --limit 200 \
  --json number,title,body,labels,milestone
gh api repos/dssg-nyc/nonprofit-success-ai/milestones --jq '.[] | {number,title,state}'
```

An existing issue **whose body cites the same delta id** is a duplicate — report the
issue number and skip it. Do not file a second issue for a delta that already has one;
if the existing issue is stale, say so and let the user decide between updating it and
filing fresh.

## Step 3 — Pick the template

The body follows the `.github/ISSUE_TEMPLATE` form matching the work, so a filed issue
and a human-filed issue read the same and triage routes them identically:

| Item shape | Template | Labels |
|---|---|---|
| New capability that does not exist yet | `feature.yml` | `enhancement`, `backlog` |
| Restructure with no behavior change | `refactor.yml` | `refactor`, `backlog` |
| Something broken today (e.g. D22, a live authorization gap) | `bug.yml` | `bug`, `backlog` |
| Tooling, docs, CI, deps, evals | `chore.yml` | `chore`, `backlog` |
| A `C{n}` decision, or a `D` row marked "OPEN — decide, don't build" | `feature.yml`, titled `Decide: …` | `enhancement`, `backlog` |

Read the chosen template and fill **every required field** with content from the spec.
The forms have required fields for a reason — a filed issue that leaves the routing
dropdown or the acceptance criteria empty pushes that work onto triage.

Fill the routing dropdown honestly from the registry state:

- `SPECIFIED` → the approach is decided (the spec says how) → "Decided" / "Settled" / "Mechanical"
- `SPECIFIED (partial)` / `BUILT (partial)` → same, scoped to the remainder
- `GAP` → nothing is designed yet → "Not decided — needs research first"
- `OPEN` → "Needs a decision on how first"

Never pick "Unsure" to avoid a judgment call; it is for genuine ambiguity, and choosing
it dishonestly makes triage re-derive what the registry already states.

## Step 4 — Draft the body

On top of the template's own fields, every issue this skill files carries:

```markdown
## Traces to

Δ row: <D19> — `.claude/specs/roadmap.md`
Spec: `.claude/specs/<cited spec path>` §<section>
Plate: <plate id, or omit the line>

## Blocked by

- [ ] #<n> — <title of the issue for that dependency>
```

Rules for `## Blocked by`:

- Dependencies come from the D table's `Needs first` column. **C rows have no such
  column** — their `Blocks` column points the other way, so a C issue normally has an
  empty `## Blocked by`; omit the section rather than inverting the arrow.
- A dependency in state `BUILT`/`RESOLVED` is **not** a blocker — omit it.
- A dependency with no issue filed yet: list it as `- [ ] D<n> — <item>` (unlinked) and
  say so in the report, rather than inventing an issue number.
- Cross-repo refs are fully qualified (`dssg-nyc/nonprofit-success-ai#65`, never bare `#65`).
- Dependencies are **checklists inside the blocked issue** — never sub-issues, never
  extra branches. Multi-session work stays one issue, one branch, one PR with a `- [ ]`
  task list naming each slice.

Milestone: attach only if an open milestone clearly covers the item. Do not create
milestones — that is `/design-roadmap`'s.

## Step 5 — Present the draft, gate on approval

Print, for every selected item, the full proposed issue before running anything:

```markdown
**D19** → template: feature.yml   labels: enhancement, backlog   milestone: <name or none>

**Title**: <imperative title>

**Body**:
<full rendered body>

**Blocked by**: #<n>, D<n> (unfiled)
```

Then block on `AskUserQuestion` — approve all, approve a subset, edit, or cancel. GitHub
issue creation is outward-facing and visible to the cohort, so it is the same class of
gate as `/design-roadmap`'s filing step and `/git-pr`'s: never default-yes.

## Step 6 — File (only after approval)

```bash
gh issue create -R dssg-nyc/nonprofit-success-ai \
  --title "<approved title>" \
  --label backlog --label <type-label> \
  --body "$(cat <<'EOF'
<approved body>
EOF
)"
```

Add `--milestone "<name>"` only when Step 4 resolved one.

Report a table of what was filed: delta id, issue number and URL, labels, milestone,
unfiled dependencies. Then state plainly whether any selected item was skipped, and why
(already built, duplicate, no registry row).

## Step 7 — Do not update the registry

`roadmap.md` records *what the work is*, not *where it is tracked*. This skill does not
write an issue number back into the table — the issue cites the delta, not the reverse,
so the citation direction stays one-way and the registry stays a registry.

## Rules

- **Cites, never mints.** No new `D`/`C` numbers, no registry edits, no renumbering.
- **Never files without explicit approval**, and `--dry-run` is the default past three items.
- **Labels `backlog` + one type label only.** `ready` belongs to `/workflow-refine`'s DoR
  gate — pre-granting it makes that gate ceremonial.
- **Never files an unqualified `BUILT`/`RESOLVED` row.** Report it as done. A `(partial)`
  or `(deferred)` qualifier is the opposite signal — that row has named work left, and the
  issue is scoped to exactly that remainder.
- **One issue per delta.** A delta with an existing issue is skipped, not duplicated.
- **Never creates milestones.** Attach to an existing one or leave it unset.
- **Body comes from the spec, not the row.** If the cited spec has nothing to say on the
  item, that gap is worth reporting — file the issue noting the spec is thin, rather than
  padding the body to look complete.
