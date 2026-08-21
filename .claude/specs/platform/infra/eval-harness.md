# Eval Harness
**Plate:** C5.1 in docs/nonprofit-success-system-design.html
**Status:** GAP
**PRD sections:** §7, §11

## Responsibility
Provides measurable quality contracts for every agent — deterministic heuristic graders for correctness, LLM judges for prose quality — so regressions fail CI before they reach production.

## Mechanism
`src/evals/registry.ts` declares every agent's eval metrics. `registry.test.ts` fails the build if any agent in the roster has no registered metric — the harness enforces coverage, not just quality. Two pipeline families: `src/evals/pipelines/heuristic/` (deterministic, fast, run on every PR) and `src/evals/pipelines/judge/` (LLM-as-judge, slower, run before deploy). Golden-set fixtures live as JSONL files in `src/evals/fixtures/`, one file per agent. `targets.yaml` holds pass-rate thresholds; a metric with no measured baseline stays commented out and reports `UNGATED` rather than failing CI.

CI gate `eval-heuristics` runs on every PR via `npm run eval:heuristics`. The full judge harness runs as a pre-deploy check via `npm run eval:judge`, commented into `cd.yml` pending harness landing.

## Contract
- **Input:** `EvalFixture` (JSONL row) — `{ input: AgentInput, expected: AgentOutput, tags: string[] }` + `targets.yaml` threshold keyed by `targetsKey`
- **Output:** Per-metric: `{ metricId, agentId, score, pass, threshold }`. Per-run: `{ agentId, passRate, gated }`. Reporter: structured JSONL to stdout for CI consumption.
- **Side effects:** Writes JSONL eval run log to `src/evals/runs/` (git-ignored). Judge pipeline writes `agent_runs` rows via `src/observability/recorder.ts` (judge calls are model calls too).

## Rules
- Every agent in the roster (`scout`, `architect`, `chronicle`) must have at least one metric in `registry.ts` or `registry.test.ts` fails the build. Adding an agent without a metric is a build failure.
- Heuristic graders are deterministic and must not call a model. A grader that makes a model call belongs in the judge pipeline.
- LLM judge graders use a separate model budget from production agents — a judge call must not share production quota. Use a dedicated eval key or a rate-limited alias.
- `targets.yaml` thresholds are set from a measured pass rate over at least 20 fixtures — a threshold invented without measurement is prohibited. Comment the metric out as `UNGATED` until measured.
- Fixture files are JSONL: one fixture per line — `{ "input": {...}, "expected": {...}, "tags": [...] }`. Tags are used by `--filter` to run subsets.
- No fixture file may contain PII or real partner data — synthetic fixtures only.
- Judge outputs must not be used to auto-update thresholds — a human sets the threshold after reviewing calibration results.
- `--passWithNoTests` in Vitest config is dropped with the first test suite (see CLAUDE.md). `registry.test.ts` is the first suite.

## Dependencies
- **Imports:** `src/agents/` (all agent modules under test); `src/model/` gateway (for judge calls); `src/types/` (agent input/output types for fixture validation); `targets.yaml`
- **Imported by:** Nothing imports the eval harness — it is the terminal consumer. `src/evals/__tests__/registry.test.ts` is the build gate.
- **Data:** `targets.yaml` (threshold config); `src/evals/fixtures/*.jsonl` (golden sets); `agent_runs` (`_deferred/0004_telemetry.sql`, for judge call recording). No Supabase access during heuristic runs.

## Delta rows
Cited from [`delta.md`](../../../delta.md) — this spec does not mint numbers.

- **D12** — eval harness: `registry.ts` + `registry.test.ts` + `targets.yaml` — SPECIFIED
- **D28** — CI integration: `eval-heuristics` in `ci.yml`, `eval-judge` in `cd.yml` — GAP

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
2. Should `src/evals/runs/` write to a persistent store (e.g., a `eval_runs` Supabase table) for trend tracking across deploys, or remain git-ignored local files only for MVP?
3. Fixture authoring workflow: generated from the deterministic fallback path (known-good inputs), or hand-authored? A documented convention prevents trivially-passing fixtures.
