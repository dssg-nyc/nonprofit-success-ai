# Evals

Grading suite for agent logic — deterministic functions and LLM-generated prose —
against hand-authored golden fixtures.

## Layout

```
evals/
├── graders/
│   ├── heuristic/    Exact-match against golden fixtures (pure function output)
│   └── judges/       LLM judge for prose-shaped output only
├── metrics/          Pure aggregate metrics (pass rates per metric)
├── fixtures/         Hand-authored golden cases, JSONL — one file per agent
├── experiments/      log.jsonl — tracked, append-only history of every keyed run (versions + rates)
├── pipelines/        CLI entrypoints — grade / report / review (+ latency.ts, experiments.ts)
├── notebooks/        build_review.py → review.ipynb (git-ignored): cases, sub-scores, judge alignment, latency
├── reports/          output/ holds generated JSON + HTML (gitignored)
├── __tests__/        registry.test.ts (the registry's own invariants), judges, scheduler
├── registry.ts       Single source of truth for metric wiring
├── scheduler.ts      Paces, retries and quota-stops model calls during a run
├── targets.yaml      Pass-rate thresholds (commented = not enforced)
└── types.ts          Eval-internal type definitions
```

## What gets evaluated

| Agent | Metric | Grader type | What it checks |
|-------|--------|-------------|----------------|
| Scout | `scoutRouting` | Heuristic | Exact-match on bucket, composite_signal, hitlTier |
| Scout | `scoutRationale` | LLM judge | Accuracy, groundedness, clarity of free-text rationale — grades `scoutRouting.jsonl` cases (`fixture: 'scoutRouting'`) |
| Scout | `scoutGrounding` | Heuristic (lint) | No rubric arithmetic ("3/3") or wire field names in the template rationale — on `scoutRouting`'s cases, the applicant's own words excluded |
| Architect | `architectScoring` | Heuristic | Exact-match on compositeLevel, overrideApplied, flaggedDimensions |
| Architect | `architectPlanStructure` | Heuristic | Plan shape, the three phase windows, required workstreams, deferred vs. promised deliverable, structural risks first — on `architectCharter`'s cases, for both `buildTemplate()` and the model path |
| Architect | `architectCharter` | LLM judge | Is the charter grounded in the assessment, proportionate to assessed maturity, and consistent with the 90-day plan |
| Architect | `architectGrounding` | Heuristic (lint) | Template charter: required workstreams trace to flags, criteria promise no funders or maturity level, no pipeline criterion on a roadmap or model deliverable, no "required" prose when nothing was flagged — on `architectCharter`'s cases |
| Pulse | `pulseHealth` | Heuristic | Health signal status against golden inputs |
| Envoy | `envoyDraftStructure` | Heuristic | Template echoes its input, stays L3, names the partner, states only the cadence, concerns and consent ask it was given — on `envoyDraft`'s cases |
| Envoy | `envoyDraft` | LLM judge | Draft quality, factual grounding, tone |
| Envoy | `envoyGrounding` | Heuristic (lint) | Template draft: the fixed sign-off, no proposed cause without a concern, no rhythm without a cadence, no banned phrase — on `envoyDraft`'s cases |
| Chronicle | `chronicleReadiness` | Heuristic | Right readiness derived, nothing written when `not_ready`, provisional when thin, no outcome the input lacks — on `chronicleDraft`'s cases |
| Chronicle | `chronicleDraft` | LLM judge | Story quality, evidence grounding, readiness alignment |
| Chronicle | `chronicleGrounding` | Heuristic (lint) | Template story: outcomes trace to the input, a thin story is provisional within two sentences, a completed engagement is never told as beginning, `not_ready` is empty — on `chronicleDraft`'s cases |

Every agent in the roster has at least one metric, and `registry.test.ts` fails the build
if a new agent lands without one. Architect's charter was the gap that invariant was
written to close: its scoring was graded, but the prose it generates was not.

## Design decisions

**Heuristic graders for deterministic functions.** Scout routing and Architect scoring
are pure functions with known-correct outputs. Their grader is an exact-match check,
not an LLM judge — there is nothing to ask a model about a mechanical rubric.

**LLM judges for prose output only.** `scoutRationale` grades the free-text rationale
string, because "is this explanation accurate and clear" has no exact-match answer.
Same for Envoy and Chronicle drafts.

**Judges grade both paths, reported apart.** A judge metric grades the deterministic
template output, and — when its registry entry has a `modelOutput` producer
(`scoutRationale`, `envoyDraft`, `chronicleDraft`, `architectCharter`) — the model output for the same case.
Rows carry `source: 'template' | 'model'`; the summary reports them as `judge*` and
`modelJudge*`. Only the template judge feeds the gate: it grades the path the fallback
contract guarantees, and model prose varies run to run. A model-path failure is an
`errored` row (`model:<code>`), excluded from the rate.

**Judges see the golden facts.** Every judge appends the case's `expected` fields to its
prompt as reference facts, so a judge grades against the fixture rather than its own
reading of the input. A reference fact is what the output must not contradict; an output
that leaves one unmentioned is not wrong for that, and facts the drafter was given — the
readiness scores Scout's router was handed, the engagement status Chronicle was told — are
reference facts too, so restating one is grounded (judge prompt `0.06`, `JUDGE_PROMPT_VERSION`
in `graders/judges/base.ts`).

**Judges are measured too.** `fixtures/judgeCalibration.jsonl` holds hand-labelled outputs
per judge: the template output with a planted fault (an invented date, an argued-for wrong
bucket, an overclaim on a thin record) or untouched, each with the verdict a careful reader
gives it. Every run with judges grades them (`pipelines/calibration.ts`) and reports how
often the judge agreed, overall and per dimension, in `summary.json` `calibration` and
`calibration.jsonl`. The agent pass rates are only as trustworthy as that agreement; a
rubric change that lowers it is reverted, not shipped. The floor is 10 labelled outputs per
judge, about half passes and half fails, with every dimension planted at least once as the
sole fault (41 rows as of R18); `calibration.test.ts` enforces it.

**Per-check tallies beside every rate.** Each summary carries `dimensions` per lane —
for every grader check, how many graded rows met it out of how many carried it — so a
lane rate that moves says which check moved. The experiment log keeps them (numbers only).

**A metric may borrow another's fixtures.** `fixture: 'scoutRouting'` points
`scoutRationale` at the routing cases — the rationale is graded on the same inputs the
routing heuristic checks, with no second file to keep in sync.

**Fixtures are hand-authored, not recorded traffic.** The fixture set is a small
starter representing the rubric's edge cases, not production volume. Set real
pass-rate targets in `targets.yaml` once the fixture set reflects real usage.

## Running

```bash
npm run eval:grade                  # heuristics (+judges if key set) → graded JSONL + summary
npm run eval:grade -- --gate        # same, exits non-zero on targets.yaml misses
npm run eval:grade -- --no-judges   # heuristics only, even if a key is set
npm run eval:grade -- --label "judge anchors"     # name the experiment (or EVAL_LABEL=...); default: the prompt versions
npm run eval:grade -- --only chronicleDraft,chronicleReadiness   # grade these metrics only: the judges and model path of one agent
npm run eval:report                 # HTML report: scoreboard, trend across runs, judge calibration, every case
EVAL_RUN=<id> npm run eval:report   # the same for any run under reports/output/runs/
npm run eval:review                 # review CSVs, one per fixture, for human verdicts
```

**A scoped run (`--only`) is how to iterate on one prompt without paying for the others.**
A full keyed run is ~135 model calls; the judges are 40 of them but half the spend, because
every judged case is graded twice (template output and model output) in batches that carry
the rubric, the calibration block and six outputs each. `--only` runs the named metrics, the
calibration rows of their judges, and nothing else. Its run directory and report are written
like any other, but it is not appended to `experiments/log.jsonl` and does not appear in the
trend: a run that measured one agent is not a point on the others' history. Finish with a
full keyed run before relying on the numbers. Other cost knobs, all env: `EVAL_JUDGE_BATCH_SIZE`
(default 6; larger batches amortise the rubric but dropped items rise), `GATEWAY_THINKING_LEVEL`
(`low` default; `minimal` cuts reasoning tokens, unmeasured on the judges), `EVAL_JUDGE_MODEL`.

**`EVAL_MODEL_SAMPLES=n` measures the model's own noise.** Each case's model path is called
`n` times (default 1); every sample is graded and its rows carry `sample`. The rates in
`summary.json` are sample 0's alone, so a sampled run still compares with a plain one, and
`agreement` per model lane is the share of cases whose every sample reached the same
verdict. Each extra sample is a full extra pass of agent calls and model-judge calls, so
it is opt-in; the template paths are deterministic and are never resampled.

**Template verdicts are cached.** The judge's template-path verdict depends only on the
agent's code, the fixture, the judge prompt and the judge model, so
`src/evals/graders/judges/cache.ts` keeps it in `reports/output/judge-cache.jsonl`
(git-ignored, append-only) keyed on a hash of all of those. A rerun with none of them
changed pays only for the model-output verdicts, about half the judge calls; change any
input and the key misses, so a cached verdict is never stale. Model-output verdicts and the
calibration rows' hand-written outputs are the exceptions: model output is judged every run,
calibration is cached like a template. The run prints `Judge cache: N reused, M judged`
and `summary.json` carries it as `judgeCache`. `EVAL_JUDGE_CACHE=0` judges everything
again (to measure judge noise, or after a judge-side change the key does not see).

Judges run on OpenAI `gpt-5.4-nano` and need `OPENAI_API_KEY`; the agents' model path
runs on `gemini-3.5-flash-lite` and needs `GOOGLE_GENERATIVE_AI_API_KEY` (the var the
agent endpoints read). Each runs when its own key is exported and prints `skipped`
otherwise. Override the judge with `EVAL_JUDGE_MODEL` and the agents with `GATEWAY_MODEL`;
the gateway picks the provider from the id (`gpt-*` / `o<digit>*` → OpenAI, else Gemini).
A judge from another vendor is less inclined to favour the agent's own style, and its
calls leave the Gemini free tier (`gemini-3.8-flash`: 20 requests/day) to the agents.

A keyed run is ~75 model calls: one agent call per case (shared between the metrics that
grade it) and judge calls batched `EVAL_JUDGE_BATCH_SIZE` cases at a time (default 6).
`src/evals/scheduler.ts` paces them (`EVAL_MIN_INTERVAL_MS`, default 4500), retries
rate limits, overloads and timeouts (`EVAL_MAX_RETRIES`, default 3), and stops sending
after the first quota error. The Gemini API's daily quota resets at midnight Pacific;
OpenAI's `insufficient_quota` means the account is out of credits.

Everything under `reports/output/` is generated, not committed. A grade run writes its
own `runs/<id>/` first, then copies it to `reports/output/` as the latest:

| File | What it holds |
|---|---|
| `graded.jsonl` | One row per (metric, case, path): verdict, dims, reasoning, the graded `output` |
| `summary.json` | Pass rates per lane, the models called (`models`), `latency` per agent/judge, and the run manifest (`run`) |
| `calls.jsonl` | Every gateway `model_call` log line — latency, tokens, outcome, failure code. Errored calls are kept, not dropped |
| `calibration.jsonl` | One row per hand-labelled output: the label, the judge's verdict, and whether they agree (runs with judges only) |
| `report.html` | `npm run eval:report`: a tabbed dashboard — Overview · one tab per agent (derived from the metric-name prefix) · Calibration — one HTML file, no external scripts or fonts, light only in the shared system-analysis style (navy document header, off-white page, white section cards with a teal rule). Every card opens the same way: a small label naming the tab, a question as the heading, an answering lead; each tab's first card carries a claim / caveat callout, with amber/teal/red callouts for partial runs, rules and what needs attention. **Overview**: four stat tiles (gated metrics passing, model metrics at the 90% bar, judges trusted, open P1 actions), the roster (metrics, fallback and model rates, gates, judge trust, failing cases per agent), a grouped bar per agent × path, a line chart across keyed runs with a tick where prompts changed, a one-line pointer to the readiness ladder, the review queues and every failing verdict under one disclosure, the actions table (where — the kind of fix: code, template, prompt, fixture / rubric, infrastructure — action, expected outcome, effort, priority — P1 blocks a gate), an evidence line, and at the foot a collapsed **How to read this page** block: the four verdict states, the gate rule, how to regenerate, links to the specs, the eight-step readiness table (fixtures ≥20, fallback gated, judges run, judges calibrated at 80%+ on 10+, judge metrics gated, model path measured, Chronicle κ sheets, judge CI job — the κ-sheet count and the CI job come from `report.ts`; step, status, evidence, where), the fixture profile and the glossary. **Agent tabs**: per metric, a card per lane with passed/graded beside the rate, a grouped bar per compared field or rubric dimension × path (read from `summary.json` `dimensions` when present, else recomputed from `graded.jsonl`), the judge rubric; then every case, failing first, with expected · got · judge reasoning inline and a filter bar (verdict, lane lost on, dimension lost on, free text). **Calibration**: can the judges be trusted, and how does this run compare with the last — one card per judge in the system-analysis calibration style: agreement against the 80% bar, labels against the 10-label floor, a strip plot of judge scores split by hand label (green = reader passed, red = reader failed) with the pass threshold drawn as a line, and a note on separation (a red dot at the line is lenient, a green dot under it harsh); then agreement per dimension, lenient and harsh lists with the judge's reasoning, confusion cells and the calibration trend across judge versions. When no judge ran, one callout says so. Below, each in a collapsed disclosure: the scoreboard (every metric on every path, Δ against the previous keyed run, † where the fixture changed), the trend, pass rate per check, template-vs-model bars with a judge-score scatter, latency p50/p95 and tokens; judge-cache hits sit in the run facts. Old anchors still resolve: `#<metric>` and `#case-<metric>-<id>` open the tab that holds them, `#judges` and `#runs` open Calibration, `#method`, `#readiness` and `#glossary` open the method block on the Overview. Failing and errored cases are rendered inline; every case's outputs, expected fields and verdicts sit in one `<script type="application/json">` blob (gzip + base64 once it passes 32 KB, inflated in the browser with `DecompressionStream`) and a passing case's body is built from it when expanded, which keeps the page under 600 KB for a 325-case run. Without JavaScript the tabs stack in order and passing cases show their verdicts only. Metrics carry a `displayName` in the registry ("Routing accuracy") shown beside the code name. Written beside its run as `runs/<id>/report.html` and copied up for the latest |
| `runs/<id>/` | The run itself: the files above, never overwritten. `<id>` is the timestamp plus the label's slug |

`calls.jsonl` is captured through `addLogSink()` (`src/observability/log.ts`), so it
carries the same closed field set as the server logs — ids, codes, numbers, model names,
never a prompt or an output. The run sets `LOG_LEVEL=warn` for the console unless you set
it; the sink still receives every line.

## Experiment tracking

Runs are never overwritten or deleted. `runs/<id>/` is created fresh for each run (an
existing directory fails the run), and `reports/output/` holds only a copy of the latest.

Each run's `summary.json` carries a manifest (`pipelines/experiments.ts`):

| Field | What it pins |
|---|---|
| `id`, `label` | The run directory and its label: the `--label` / `EVAL_LABEL` you gave it, else the prompt versions (e.g. `scout 0.04, architect 0.03, …`) |
| `git` | Short commit, and `dirty` when the tree had uncommitted changes |
| `promptVersions` | Each agent's `*_PROMPT_VERSION` and `JUDGE_PROMPT_VERSION` |
| `promptHashes` | A hash of each prompt's source (`agents/<agent>/schema.ts`, `graders/judges/`) |
| `fixtures` | A hash per fixture file. Two runs compare on a metric only when these match |
| `drift` | Prompts whose source changed under an unchanged version (see below) |

A run that called a model is also appended to **`experiments/log.jsonl`, which is
tracked**: the manifest, models, pass rates per lane, p50 latency and the judge's
calibration agreement per judge, nothing else. No fixture text, no model output, no reasoning. That file is the shared, version-by-version
record of what each prompt change did; the full rows stay in the git-ignored `runs/<id>/`.
Heuristic-only runs are not logged: they are deterministic and reproducible from the commit.

**Bump the version when you change a prompt.** The hash catches an edit without a bump:
the run prints a `prompt source changed without a version bump` warning and records the
prompt in `drift`, so two different prompts are never read as the same experiment.

Prompt versions are `0.0N` before the first production deployment (e.g. `scout-routing-0.06`,
judge `0.06`): each prompt edit bumps `N`, and `1.0` is the prompt that ships. The number
is a label for the log, not semver — a bump means "a different prompt", nothing more. The
wire `SCHEMA_VERSIONS` in `src/schemas/index.ts` are a separate series and stay `vN`. The
log's earliest rows carry the older `vN` labels and are not rewritten.

The first entry, `baseline (pre-tracking)`, was backfilled from the 2026-10-07 keyed run.
It has versions and rates but no hashes, models or git state (`backfilled: true`).

## Review notebook

`make eval-notebook` builds `notebooks/review.ipynb` from `notebooks/build_review.py` and
opens it in JupyterLab (uv supplies the deps in `notebooks/requirements.txt`; nothing is
installed into the repo). In VS Code instead: `make eval-kernel` creates `.venv` with the
same deps; pick **.venv** as the notebook's kernel. Another project's kernel usually lacks
`jinja2`, and the notebook's first cell says so instead of failing at the first table. It reviews the latest run, or — when that was heuristics-only — the latest run that called a
model; `EVAL_RUN=<id>` picks any run under `runs/` — and is meant for the
judge-vs-heuristic alignment loop: change a prompt, bump its version, rerun
`npm run eval:grade -- --label "what changed"`, rerun the notebook, read Iterations.

| Section | Question it answers |
|---|---|
| Legend | The four lanes: whose output (**rules, no AI** = template fallback · **LLM agent** = model path) × who graded it (**code check** = exact match · **LLM judge**) |
| 1 Scorecard | One row per agent, two questions: *is the decision right?* (code check) and *is the text good?* (LLM judge), rules vs LLM agent side by side, as a table and a bar chart |
| 2 Scout table | Each case's intake, expected routing, and rules vs LLM agent bucket, confidence, sub-scores, signal, tier, plus both judge verdicts. Red = differs from expected; amber = agent sub-score differs from the rules' |
| 3 Sub-scores | Rules (spec) vs LLM agent crosstab per sub-score, and which sub-score flipped each wrong readiness signal |
| 4 Where to review | Readiness-total distributions (rules vs agent, coloured by expected signal, floor-rule cases hatched); a sweep of the Ready cut-off counting wrong Readys (skip review via L2) vs missed Readys; candidate review triggers; judge score bands (0–1, rubric caps at 0.2/0.5 marked); same-case scatter of rules text vs agent text; the most-failed rubric dimension |
| 5 Alignment | LLM judge vs code check on the same case: where the decision was wrong but the judge passed the prose, or right but the judge failed it |
| 6 Rubric consistency | Judge verdicts that break their own rubric — unknown dimensions, non-binary values, `isCorrect` disagreeing with the dims. Then 6b: judge vs hand labels — agreement per judge and dimension, and every disagreement with the judge's reasoning |
| 7 Judge verdicts | Every judge verdict with its output and reasoning; `show_case(id)` for one case |
| 8 Latency | p50/p95 per agent and judge from `calls.jsonl`, failures by code. Then the run history from `experiments/log.jsonl`: pass-rate trend per lane, errored share, median latency and the delta vs the previous keyed run |
| Iterations | The experiment history: every keyed run (logged or local; `EVAL_HISTORY=all` adds heuristic-only ones) with label, versions, models, commit and fixture match; pass rate per metric × lane per run; the change vs the previous keyed run; judge calibration per run — agreement, lenient and harsh counts — by judge version |

The `.ipynb` is git-ignored (`*.ipynb`): its outputs carry fixture text and model output.
`build_review.py` is the tracked source — change cells there; `make eval-notebook` rebuilds
the notebook when the script is newer, replacing any edits made in the notebook itself.

## Human review export

`npm run eval:review` (`pipelines/review.ts`, also run by `make eval`) reads the last
run's `graded.jsonl` plus the fixtures and writes `reports/output/review/<fixture>.csv` —
one file per fixture, one row per case. Metrics sharing a fixture land on the same row
(`scoutRouting.csv` carries `scoutRouting` and `scoutRationale`; `architectCharter.csv`
carries `architectPlanStructure` and `architectCharter`). UTF-8 with BOM, RFC 4180
quoting, so it opens cleanly in Sheets, Excel or pandas. Columns, left to right:

| Columns | What they hold |
|---|---|
| `case_id`, `note` | The fixture case and why it exists |
| `input.<key>` | The question: one column per fixture input field (objects as JSON) |
| `expected.<key>` | The golden values the graders check against |
| `<metric>.heuristic_pass` / `_reason` | Exact-match on the deterministic path |
| `<metric>.model_pass` / `_reason` | The same exact-match on the model path (metrics with one) |
| `<metric>.judge_template_*`, `<metric>.judge_model_*` | Judge `pass`, `score` (2 dp) and `reasoning` over the template and the model output |
| `template_output`, `model_output` | The answer that was graded, rendered as text (fixtures with a judge or model path) |
| `human_verdict`, `human_notes` | Blank — for the reviewer |

Verdict cells read `PASS`, `FAIL`, `ERRORED: <code>` (no verdict — neither pass nor
fail), or blank when that grader did not run. The outputs come from `GraderResult.output`,
which judge rows and model-path rows persist. A run from before that field existed still
exports: `template_output` is regenerated (it is deterministic) and `model_output` reads
`(not saved — rerun npm run eval:grade)`. Heuristic-only fixtures (`architectScoring`,
`pulseHealth`) have no output columns; their `heuristic_reason` already states the computed
values beside the expected ones.

## Gating

`targets.yaml` holds one threshold per metric. Two rules keep the gate honest:

- **A threshold is set from a measured pass rate, never invented.** The ten heuristic
  metrics (six structural, four grounding lints) gate at 1.000 because that is what they scored. The judge metrics stay commented
  out until someone runs them with a key and records the result — gating a production
  deploy on a guessed number is worse than not gating.
- **A metric with no threshold reports `UNGATED`, not silence.** It used to be skipped
  quietly, which made three registered metrics look enforced when nothing was checking
  them. And `registry.test.ts` fails the build if a *gated* key has no fixture file, so a
  target cannot claim to enforce something it grades zero cases of.

CI runs `--no-judges --gate` on every PR (the `eval-heuristics` job in `ci.yml`): heuristics
are deterministic, so a miss is a real logic regression, and the job can never fail on model
variance or a missing key. `cd.yml` does not run the harness; it deploys only after `ci.yml`
passes. No CI job runs the judges yet.
