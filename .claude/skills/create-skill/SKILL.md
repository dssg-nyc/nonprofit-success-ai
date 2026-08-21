---
name: create-skill
description: "Scaffolds a new skill in this repo following the house conventions — frontmatter, trigger phrases, HITL gates, doc paths — and validates it. Use when adding a workflow to .claude/skills/, e.g. a data-* or design-* family member. Triggers on: 'create a skill', 'new skill', 'add a skill', 'scaffold a skill', '/create-skill'."
disable-model-invocation: true
allowed-tools: Read Write Edit Glob Grep Bash AskUserQuestion
---

You are helping a contributor add a skill to this repo. Your job is to make their skill
look like it belongs next to the ten that already exist — and to talk them out of writing
one if a skill is the wrong shape for what they want.

## Usage

```
/create-skill                 # interview, then scaffold
/create-skill <name>          # skip the name question
/create-skill validate        # check existing skills against the conventions
```

## Step 0 — Should this be a skill at all?

Ask before scaffolding. A skill earns its place when it is a **workflow with a gate** — a
repeatable sequence someone invokes by name, that produces an artifact and stops for human
judgment. Most things people want are not that.

| They want | Give them |
|---|---|
| A repeatable multi-step workflow with a human gate | A skill — continue |
| A fact, convention, or stack rule to consult while coding | A ref in `.claude/refs/` |
| Durable description of how the system works | A doc in `docs/` (see its README lane map) |
| One deterministic operation, same every time | A `Makefile` target or a script |
| A judgment pass over files, dispatched by an existing skill | An agent in `.claude/agents/` |

If it is not a skill, say so plainly, point at the right home, and stop. A `.claude/skills/`
directory full of things that are not workflows is how the family stops being legible.

## Step 1 — Interview

Ask these together with `AskUserQuestion`; do not scaffold on unanswered assumptions.

1. **Name** — `family-verb`, kebab-case. Existing families: `workflow-*` (research → plan →
   refine → scope → build → review) and `design-*` (initiative → product → system →
   roadmap). A new family (`data-*`) is fine; say what stage it owns.
2. **Stage and role** — one line, present tense: who the skill acts as and where it sits.
   The `design-*` skills open with "PM + EM + Designer role — the second design stage."
   This line becomes the first sentence of the description.
3. **Input and output** — what it reads, what artifact it writes, and where that lands.
   Artifacts go to `.claude/docs/plans/` (working, git-ignored) or `docs/` (durable,
   tracked, follows the lane map). Be explicit; a skill whose output has no home drifts.
4. **The gate** — what human decision ends it. Every skill in this repo stops somewhere:
   a verdict, a sign-off on assumptions, a `Status:` transition. A skill with no gate is a
   script.
5. **Trigger phrases** — 3–6 natural phrasings someone would actually type, plus the slash
   command. These go in the description verbatim and are how the skill gets found.
6. **Does it dispatch agents?** If yes, it needs `Agent` in `allowed-tools` and an agent in
   `.claude/agents/`. Reviewing agents get no edit tools — see Step 4.

## Step 2 — Write the frontmatter

```yaml
---
name: <family-verb>
description: "<Role/stage line>. <What it takes and what it produces>. Triggers on: '<phrase>', '<phrase>', '/<name>'."
disable-model-invocation: true
allowed-tools: Read Write Edit Glob Grep Bash
---
```

Rules that matter:

- **`description` is the whole discovery surface.** It is the only thing read when deciding
  whether to load the skill. State the role, the input, the output, and the triggers. A
  description that says "helps with X" will not fire.
- **`disable-model-invocation: true` unless the skill is meant to be auto-dispatched.**
  Seven of ten skills set it — they are user-invoked stages. The exceptions are
  `workflow-build`, `workflow-review`, and `workflow-scope`, which other skills call. If a
  human always types it, set the flag.
- **`allowed-tools` is a real boundary, not a formality.** Grant only what the skill uses.
  A skill that writes no files does not get `Write`.
- **Tool list separator:** the repo has both space- and comma-separated lists. Both parse.
  Use spaces for a new skill; do not reformat existing ones.
- Add `model:` only to override the session model — rare, and only for a verdict pass.

## Step 3 — Write the body

Follow the shape the family already uses. Read the closest existing skill first and match
its structure — that is a faster path to a good skill than any template.

Required sections:

- **`# /<name>`** then one or two lines: what it takes, what it emits, who calls it.
- **`## Usage`** — a fenced block of real invocations, including argument forms.
- **`## Routing`** if it has modes. The convention is a first-word verb (`review`, `refine`,
  `argue`) with reserved words listed explicitly.
- **Numbered `## Step N —` sections.** Concrete and checkable. Include the actual bash
  where a step runs commands; do not describe a command in prose.
- **A stop condition per step that can fail.** Say what the skill prints and that it halts.
  Silent continuation past a failed step is the failure mode that costs the most.
- **`## Rules`** — the invariants. What it must never do.

Keep the whole file under ~250 lines. Past that, move the conditional parts into a
`references/` directory beside the skill and read them only in the branch that needs
them.

Writing rules:

- Address the model as "you". Present tense, imperative.
- Prefer a table over a paragraph for any list of cases.
- Name real paths from this repo, not placeholders.
- Say what to do when a step cannot complete. Every one.

## Step 4 — Agents, if it dispatches

Agents live in `.claude/agents/<name>-scout.md`, not under the skill. The four here are
`research-scout`, `plan-refine-scout`, `build-scout`, `review-scout`.

Non-negotiable: **an agent that judges work gets no edit tools.** `review-scout` has
`tools: Read, Grep, Glob, Bash` for exactly this reason — a reviewer that can fix what it
finds stops reporting honestly. Execute and review never share an agent.

Give the agent: what it receives (labelled input lines), numbered steps, its exact output
schema, and its rules. If it emits structured findings, specify the JSON shape in full and
say the verdict comes last.

## Step 5 — Validate

```bash
NAME=<name>
test -f .claude/skills/$NAME/SKILL.md || echo "FAIL missing SKILL.md"
head -1 .claude/skills/$NAME/SKILL.md | grep -q '^---$' || echo "FAIL no frontmatter"
grep -qE '^name: '"$NAME"'$' .claude/skills/$NAME/SKILL.md || echo "FAIL name mismatch"
grep -q '^description:' .claude/skills/$NAME/SKILL.md || echo "FAIL no description"
grep -q '^allowed-tools:' .claude/skills/$NAME/SKILL.md || echo "FAIL no allowed-tools"
grep -q 'Triggers on:' .claude/skills/$NAME/SKILL.md || echo "WARN no trigger phrases"
grep -q '^## Usage' .claude/skills/$NAME/SKILL.md || echo "WARN no Usage section"
awk 'END{if(NR>250) print "WARN "NR" lines — consider references/"}' .claude/skills/$NAME/SKILL.md
echo VALIDATED
```

`name:` must equal the directory name — a mismatch means the skill never loads.

In `validate` mode, run the same checks across every `.claude/skills/*/SKILL.md` and report
a table of failures. Do not edit skills to fix them; report and let the owner decide.

## Step 6 — Hand off

Report: the path, the frontmatter, the gate, validation output, and the invocation to try.
Then stop.

Tell the contributor to test discovery — start a fresh session and type one of the trigger
phrases. A skill that does not fire on its own triggers has a description problem, and it
is cheaper to find that now than the first time someone needs it.

## Rules

- **Never scaffold before Step 0.** Redirecting a ref-shaped request to `.claude/refs/` is
  a better outcome than a skill nobody invokes.
- **Never create a skill that aggregates a family into one entry point.** The `design-*`
  stages are separate so each one stops for review; a wrapper that runs all four collapses
  exactly the gates that make them useful.
- **Never write the skill's first real artifact as a demonstration.** Scaffold, validate,
  hand off.
- One skill per invocation.
- Do not edit sibling skills to make a new one fit. If the new skill needs a convention
  that does not exist, say so and let the owner decide.
