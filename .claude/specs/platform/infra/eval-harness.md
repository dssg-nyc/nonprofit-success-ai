# Eval Harness
**Plate:** C5.1 in docs/nonprofit-success-system-design.html
**Status:** see `roadmap.md` D12, D28 (built; judges ungated, J3 pending) — build state lives only in the registry and in CLAUDE.md
**PRD sections:** §7, §11

## Responsibility
Provides measurable quality contracts for every agent — deterministic heuristic graders for correctness, LLM judges for prose quality — so regressions fail CI before they reach production.

## Mechanism
`src/evals/registry.ts` declares every agent's eval metrics. `registry.test.ts` fails the build if any agent in the roster has no registered metric — the harness enforces coverage, not just quality. Two pipeline families: `src/evals/pipelines/heuristic/` (deterministic, fast, run on every PR) and `src/evals/pipelines/judge/` (LLM-as-judge, slower, run before deploy). Golden-set fixtures live as JSONL files in `src/evals/fixtures/`, one file per agent. `targets.yaml` holds pass-rate thresholds; a metric with no measured baseline stays commented out and reports `UNGATED` rather than failing CI.

The `eval-heuristics` CI job (`npm run eval:grade -- --no-judges --gate`) is live in `ci.yml` (R11, 2026-10-07); the `eval-judge` pre-deploy job is not yet in `cd.yml`, and its paste-ready snippet is under "D28 hand-off (J3) — judge job" below. Locally, `make eval-gate` is the gate.

## Contract
- **Input:** `EvalFixture` (JSONL row) — `{ input: AgentInput, expected: AgentOutput, tags: string[] }` + `targets.yaml` threshold keyed by `targetsKey`
- **Output:** Per-metric: `{ metricId, agentId, score, pass, threshold }`. Per-run: `{ agentId, passRate, gated }`. Reporter: structured JSONL to stdout for CI consumption.
- **Side effects:** Writes each run to `src/evals/reports/output/runs/<id>/` (git-ignored, never overwritten) and appends keyed runs to the tracked `src/evals/experiments/log.jsonl`. Judge pipeline writes `agent_runs` rows via `src/observability/recorder.ts` (judge calls are model calls too).

## Rules
- Every agent in the roster (`scout`, `architect`, `chronicle`) must have at least one metric in `registry.ts` or `registry.test.ts` fails the build. Adding an agent without a metric is a build failure.
- Heuristic graders are deterministic and must not call a model. A grader that makes a model call belongs in the judge pipeline.
- LLM judge graders use a separate model budget from production agents — a judge call must not share production quota. Judges default to OpenAI `gpt-5.4-nano` (`OPENAI_API_KEY`, override `EVAL_JUDGE_MODEL`), a different vendor and quota from the Gemini agents. *(2026-10-07.)*
- `targets.yaml` thresholds are set from a measured pass rate over at least 20 fixtures — a threshold invented without measurement is prohibited. Comment the metric out as `UNGATED` until measured.
- Fixture files are JSONL: one fixture per line — `{ "input": {...}, "expected": {...}, "tags": [...] }`. Tags are used by `--filter` to run subsets.
- No fixture file may contain PII or real partner data — synthetic fixtures only.
- Judges are batched: one judge call grades up to `EVAL_JUDGE_BATCH_SIZE` cases (default 6), each under a `### Item <caseId>` heading, and returns one verdict per id. A case the reply omits is re-asked once on its own (one more paced call); a case omitted twice is `errored` (`judge_missing_verdict`), never a pass or a fail *(0.05, R17: run 1 lost 3 of 254 verdicts to dropped batch items)*. Groups stay small so verdicts stay independent and one failed call costs a handful of verdicts. *(2026-10-07: one call per case was ~112 judge calls a run, over the free-tier daily quota on its own.)*
- Every eval model call (agent model paths and judge batches) goes through `src/evals/scheduler.ts`: calls start at least `EVAL_MIN_INTERVAL_MS` apart (default 4500); `model_rate_limited` / `model_unavailable` / `model_timeout` are retried up to `EVAL_MAX_RETRIES` times with exponential backoff (the provider's retry delay when given); the first `model_quota_exhausted` stops all further calls for the run. An agent's model output for a case is produced once and shared by every metric grading it (scoutRouting + scoutRationale, architectPlanStructure + architectCharter). The gateway's own one-retry policy is unchanged — it is sized for a live request.
- Judge prompts share one calibration block (`CALIBRATION` in `graders/judges/base.ts`, `JUDGE_PROMPT_VERSION` = `0.05`): dimensions are binary and named exactly as the rubric lists them; `isCorrect` is true exactly when every dimension is 1; the score follows fixed anchors (1.0 / 0.8 / 0.5 / 0.2 / 0.0); reasoning is at most three sentences and quotes the failing evidence. The rubric is also enforced in code: each judge declares its `dimensions`, and `applyRubric()` holds every verdict to them — a dimension is met only at exactly 1, `isCorrect` is derived from the dimensions, and the score is capped at the anchor for the unmet count. The run logs how many verdicts it corrected; a judge that needs frequent correction is a prompt to fix. *(2026-10-07: 0.02 returned 9 verdicts with non-binary dims or `isCorrect` contradicting its dims.)* 0.04 adds the omission rule: a reference fact is what the output must not contradict, and leaving one unmentioned is not a failure. *(The 0.03 scoutRationale judge failed `accurate` on rationales that never named the tier — 5 of the model path's 13 misses were omissions, not contradictions.)*
- Judges are themselves measured. `fixtures/judgeCalibration.jsonl` holds hand-labelled outputs per judge — the template output with a planted fault (an invented date, an argued-for wrong bucket, an overclaim on a thin record) or untouched — each with the verdict a careful reader gives it (`expected.isCorrect`, the `failed` dimensions, and `uncertain` ones left unscored). Every run with judges grades them through the same batched `gradeBatch()` (`pipelines/calibration.ts`), writes `calibration.jsonl` beside `graded.jsonl`, and reports verdict and per-dimension agreement per judge in `summary.json` `calibration`; the notebook's §6b lists the disagreements with the judge's reasoning. A judge whose agreement drops after a rubric change is the signal to revert it, and a judge's pass rate on the agents is only as trustworthy as its agreement here.
- Every run records latency and keeps errored calls: grade.ts captures each gateway `model_call` line via `addLogSink()` into `reports/output/calls.jsonl`, summarises p50/p95/max and failures by code per agent × model × promptVersion into `summary.json` `latency`, and writes `graded.jsonl` + `summary.json` + `calls.jsonl` to its own `reports/output/runs/<id>/` before copying them up as the latest. A failed call is counted under its code, never dropped. `src/evals/notebooks/review.ipynb` (built from the tracked `build_review.py`, git-ignored because its outputs carry fixture and model text; `make eval-notebook`, or `make eval-kernel` for VS Code) reads these for the judge-vs-heuristic alignment loop and the run-over-run history.
- The HTML report (`pipelines/report.ts` → `render.ts`, `npm run eval:report`, `EVAL_RUN=<id>` for an older run) is written beside its run as `runs/<id>/report.html` and copied up as the latest. It leads with a scoreboard — every metric × lane with passed/graded and the change in points against the previous keyed run, `†` when the fixture hash differs — then the trend across keyed runs (`pipelines/history.ts`: the experiment log plus unlogged local runs, heuristic-only runs excluded, columns headed by the prompt versions that changed), then judge calibration: agreement per judge with the misses split into *lenient* (judge passed a hand-labelled bad output — a leak past the gate) and *harsh* (judge failed a good one), this run and per judge version. Keyed log rows carry the calibration summary (numbers only) from 2026-10-08.
- Runs are experiments, tracked by version and never overwritten (`pipelines/experiments.ts`). `runs/<id>/` (`<id>` = timestamp + the label's slug; the label is `--label`/`EVAL_LABEL`, or by default the prompt versions measured, `scout 0.03, architect 0.02, …`) is created fresh — an existing directory fails the run. `summary.json` `run` is the manifest: label, git commit + dirty, `promptVersions`, `promptHashes` (sha256 of each prompt's source), fixture hashes, flags, `drift`. Keyed runs append manifest + models + pass rates + p50 latency — no fixture text, no output — to the tracked `experiments/log.jsonl`. A prompt whose source hash changed under an unchanged version is reported as drift: bump the version with the prompt. Versions are `0.0N` until the first production deployment (`1.0` is the prompt that ships); the log's earliest rows keep their older `vN` labels. Wire `SCHEMA_VERSIONS` are a separate `vN` series.
- A judge finding that a regex can detect becomes a heuristic grader gated at 1.0; the judge is not the regression gate for it. `graders/heuristic/grounding.ts` (`chronicleGrounding`, `envoyGrounding`, `architectGrounding`, R17) holds the deny-list and the derivation checks that came out of run 1 (2026-10-08); a new banned phrase is one line and one test.
- Judge outputs must not be used to auto-update thresholds — a human sets the threshold after reviewing calibration results.
- `--passWithNoTests` in Vitest config is dropped with the first test suite (see CLAUDE.md). `registry.test.ts` is the first suite.

### Keyed judge run — the procedure
R10 (2026-10-07) could not run this: no key was available in that session, so every judge metric is still `UNGATED`. A human does it, never a script:

```
export OPENAI_API_KEY=...                # judges (gpt-5.4-nano default; EVAL_JUDGE_MODEL overrides)
export GOOGLE_GENERATIVE_AI_API_KEY=...  # agents' model path (GATEWAY_MODEL overrides the default)
EVAL_LABEL="judges baseline $(date +%F)" make eval
```

Then: read `summary.json` `calibration` first (a judge below about 0.8 agreement is not trusted); note each judge's pass rate over at least 20 fixtures; uncomment the key in `targets.yaml` at or just below the observed rate, with the date and the run id; re-run `make eval-gate`.

### κ protocol — Chronicle judge
D25. Take 20 `chronicleDraft` cases with the model path's output. Two blind human raters (Tony and Karthik, during T6) score the three dimensions (grounded, proportionate, clear) binary. Compute Cohen's κ per dimension. The judge's threshold is trusted only when judge-vs-rater agreement is at least the inter-rater κ. The rater sheets live in `src/evals/reports/output/kappa/` (git-ignored like the rest of `reports/output/`).

### D28 hand-off (J3) — judge job
The `eval-heuristics` job landed in `ci.yml` in R11. The judge job is J3's (`cd.yml` is not edited by R10/R11). Paste-ready:

```yaml
# cd.yml - main only, after ci
eval-judge:
  if: github.ref == 'refs/heads/main'
  needs: ci
  runs-on: ubuntu-latest
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    GOOGLE_GENERATIVE_AI_API_KEY: ${{ secrets.GOOGLE_GENERATIVE_AI_API_KEY }}
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version-file: .nvmrc, cache: npm }
    - run: npm ci
    - run: make eval-gate
```

Secret names are exactly the env names `src/model/gateway.ts` reads. Enable `eval-judge` only after the procedure above has set at least one judge threshold; until then the job gates on `UNGATED` metrics and proves nothing. Open: whether CI appends to `experiments/log.jsonl` (it would need a commit step) or stays report-only.

## Dependencies
- **Imports:** `src/agents/` (all agent modules under test); `src/model/` gateway (for judge calls); `src/types/` (agent input/output types for fixture validation); `targets.yaml`
- **Imported by:** Nothing imports the eval harness — it is the terminal consumer. `src/evals/__tests__/registry.test.ts` is the build gate.
- **Data:** `targets.yaml` (threshold config); `src/evals/fixtures/*.jsonl` (golden sets); `agent_runs` (`0001_core.sql`, for judge call recording). No Supabase access during heuristic runs.

## Delta rows
Cited from [`roadmap.md`](../../../roadmap.md) — this spec does not mint numbers.

- **D12** — eval harness: `registry.ts` + `registry.test.ts` + `targets.yaml` — SPECIFIED
- **D28** — CI integration: `eval-heuristics` in `ci.yml` (live, R11 2026-10-07) — DONE; `eval-judge` in `cd.yml` — GAP (J3)

## Test contract
- Registry coverage: adding a mock agent entry to the roster without a registry metric → `registry.test.ts` fails.
- Fixture validation: malformed JSONL line (missing `input` key) → pipeline throws typed `EvalLoadError`, not a silent skip.
- Heuristic pipeline: Scout routing fixture (known input → known bucket) → grader returns 1.0 for correct, 0.0 for incorrect.
- Heuristic grader determinism: same fixture + same grader = same score on every run.
- `UNGATED` metric: metric with `targetsKey` absent from `targets.yaml` → eval run reports `UNGATED`, does not fail CI.
- Judge pipeline: Chronicle `caseSummary` grounded check — fixture with a fabricated claim not in source context → judge returns score below threshold.
- No-PII guard: fixture with a field value matching a real-looking email pattern → loader rejects (heuristic check).

## Open questions
1. Judge model: same Gemini model as production (separate quota alias) or a different model (e.g., flash for speed/cost)? Tradeoffs: flash is cheaper but may grade differently than pro.
2. ~~Should `src/evals/runs/` write to a persistent store for trend tracking?~~ Partly answered: trend tracking is the tracked `src/evals/experiments/log.jsonl` (rates and versions, no content). Open: whether CI runs append to it, or to an `eval_runs` table, once the eval job is enabled.
3. Fixture authoring workflow: generated from the deterministic fallback path (known-good inputs), or hand-authored? A documented convention prevents trivially-passing fixtures.
