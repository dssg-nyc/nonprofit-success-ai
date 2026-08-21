---
name: workflow-refine
description: "Batch refinement — takes backlog issues through trio triage, DoR gating, and priority sort. Reads all backlog-labeled GitHub Issues, fan-out researches each, applies PM/designer/EM framing, checks Definition of Ready, and labels passing items as ready. The bridge between /meta-retro (which produces backlog) and /workflow-plan (which scopes one ready item). Use when: 'refine backlog', 'triage issues', 'groom tickets', 'sprint plan', 'what's ready to work on', 'prioritize backlog', 'refinement pass', 'batch triage'. Aliases: /refine, /tix-groom, /sprint-plan."
disable-model-invocation: true
allowed-tools: Read Bash Grep Glob Agent Write Edit
---

You are running a batch refinement pass. The goal: move backlog issues to `ready` (or
explain why they can't move yet). This is a batch operation — you process the whole
backlog in one pass, not one ticket at a time.

## Step 1 — Load the backlog

```bash
gh issue list --label "backlog" --json number,title,body,labels --jq '.'
```

Also check the Delta tab of the design of record (`docs/<project>-platform.html`, if one
exists) for items that should be promoted to issues first. If unfiled Δ rows remain, ask
whether to create issues for them before proceeding.

If the backlog is empty, say so and stop.

## Step 2 — Fan-out research

For each backlog issue, spawn a haiku Agent to investigate the problem space. These run
in parallel — the point is breadth, not depth.

Each agent gets this prompt shape:

```
Agent(model: "haiku", run_in_background: true)
prompt: |
  Research this issue for a refinement pass. You are investigating feasibility,
  scope, and approach — not implementing.

  Issue #<N>: <title>
  <body>

  Answer these questions:
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

## Step 3 — Trio triage

**Model note**: Steps 1-2 use haiku for fan-out breadth. This step synthesizes
agent reports into priority-sorted verdicts — fable's lane. When `/workflow-refine`
is dispatched as a spawned agent, use `model: "fable"` for Steps 3-5.

For each issue, apply the PM / designer / EM framing. This is where the three
perspectives converge on whether the issue is worth doing, well-scoped, and ready.

The trio is not three people — it's three lenses applied by one mind:

| Role | Owns | Asks | Risk angle |
|------|------|------|------------|
| **PM** (product manager) | Product requirements, user stories, domain knowledge | Who needs this? What's the user story? Does the problem justify the effort? What's the priority relative to other work? | **Product risk** — are we building the right thing? |
| **Designer** (UX/system designer) | User workflow, experience, interaction design | How will people use this? Is the interaction clear? Does the workflow feel natural or forced? Does it compose with existing patterns? | **Usability risk** — will people actually use it correctly? |
| **EM** (engineering manager) | Technical requirements, implementation feasibility, engineering constraints | Can we build this in one session? What's the technical approach? What are the dependencies and blockers? What breaks if we get it wrong? | **Engineering risk** — can we build it reliably? |

For each issue, write a triage card:

```markdown
### #<N>: <title>

**PM**: <impact assessment — who benefits, how much, relative to effort>
**Designer**: <architectural fit — does this compose well, or does it fight the system>
**EM**: <feasibility — one session? dependencies? risk?>

**Verdict**: ready | needs-research | needs-split | defer | close
**Priority**: P1 (do next) | P2 (do soon) | P3 (do eventually)
**Reason**: <one sentence justifying verdict + priority>
```

Verdicts:
- **ready** — passes DoR, can be picked up
- **needs-research** — problem is clear but solution needs investigation (spawn `/workflow-research`)
- **needs-split** — too large for one session; name the sub-issues
- **defer** — valid but not worth doing now; explain what would change that
- **close** — not worth doing; explain why

## Step 4 — DoR gate

For each issue with verdict `ready`, check against the Definition of Ready
(from `~/.claude/refs/agile.md`):

- [ ] Problem stated in one sentence (observed friction, not solution)
- [ ] Acceptance criteria — checkable by someone who didn't scope it
- [ ] Enforcement level chosen (hook > skill > rules > MEMORY.md)
- [ ] Metric named (`absence:` / `count-drop:` / `presence:` / `ratio:`) for tooling changes
- [ ] Sized to one session, or split
- [ ] Dependencies named, none unresolved-blocking

If any point fails, demote the verdict to `needs-research` and note what's missing.

## Step 5 — Priority sort and output

Present the full refinement report:

### Summary table

```markdown
| # | Title | Verdict | Priority | Missing |
|---|-------|---------|----------|---------|
```

### Ready items (sorted by priority)

For each `ready` item, present the complete DoR checklist (filled in) and the
acceptance criteria. These will be written to the GitHub Issue.

### Not-ready items

For each non-ready item, present what's needed to get it to ready.

### Recommended next actions

Based on the priority sort:
- Which `ready` items to pick up first
- Which `needs-research` items to spawn `/workflow-research` for
- Which `needs-split` items to break down

## Step 6 — Apply (gated on approval)

Present the report and ask which items to promote. **Apply nothing until approved.**

For each approved `ready` item:

1. Update the GitHub Issue body with acceptance criteria, enforcement level, metric, and
   sizing:
   ```bash
   gh issue edit <N> --body "<updated body with DoR fields>"
   ```

2. Move the label from `backlog` to `ready`:
   ```bash
   gh issue edit <N> --remove-label "backlog" --add-label "ready"
   ```

3. Report the issue URL.

For `needs-split` items, add a `- [ ]` task checklist to the PARENT issue body — one
line per session-sized slice, each pointing at its plan-doc steps. Do NOT create
sub-issues or extra branches for internal phases (GUA-119's three sub-issues added
nothing over a checklist). New issues are for genuinely separate work
items only. Everything lands on the parent's branch in one PR.

For `close` items, offer to close the issue with a comment explaining why.

## Refinement failure rule

An issue that fails DoR after two refinement passes (this pass counts as one — check the
issue comments for a prior "refinement pass" note) goes back to `backlog` with a comment
explaining the gap, or gets closed. Don't let issues sit in perpetual refinement.

## When to use this vs other skills

- **This skill** (`/workflow-refine`): batch triage of backlog → ready. The grooming pass.
- **`/workflow-research`**: deep investigation of ONE topic. Use when refine says "needs-research".
- **`/workflow-plan`**: detailed implementation plan for ONE ready item. Use after refine promotes it.
- **`/meta-retro`**: produces backlog items from session friction. Feeds into this skill.

Pipeline: `/meta-retro` → backlog → **`/workflow-refine`** → ready → `/workflow-plan` → plan doc → `/workflow-build`

## Exit

When refinement is complete and ready items are promoted:

1. **Label sync** — already handled in Step 6 (`--remove-label "backlog" --add-label "ready"`).

2. **Compact** — call `/compact "phase: refine → execute"` to shed triage context.

3. **Print exit block**:

```
──────────────────────────────────────
✅ Refinement complete.
👉 Next: /workflow-plan <slug> (for highest-priority ready item)
🧠 Model: opus

Spawn prompt (for each ready item):
┌─────────────────────────────────────
│ cd <repo-path>
│ gh issue view <N>
│ /workflow-plan <slug>
└─────────────────────────────────────
──────────────────────────────────────
```
