/**
 * CLI entrypoint for the eval suite, wired up by package.json + the Makefile:
 *
 *   npm run eval:grade                    # heuristics + judges (if available)
 *   npm run eval:grade -- --no-judges     # heuristics only (no judges, no model path)
 *   npm run eval:grade -- --gate          # exit non-zero on target miss
 *   npm run eval:grade -- --label "judge anchors"   # name the experiment (or EVAL_LABEL); default: the prompt versions
 *   npm run eval:grade -- --only chronicleDraft,chronicleReadiness   # grade these metrics only (a scoped run, see below)
 *   EVAL_MODEL_SAMPLES=3 npm run eval:grade          # call each case's model path 3 times; rates use the first, `agreement` the rest
 *
 * Reproduces evals/pipelines/grade.py's contract: load fixtures per metric,
 * run heuristic graders (free, always), run judges when available, summarize,
 * write graded.jsonl + summary.json, optionally gate on targets.yaml.
 *
 * Every model call's `model_call` log line (latency, tokens, outcome — the closed field
 * set of `observability/log.ts`, no intake data) is captured to calls.jsonl and
 * summarised into summary.json's `latency`.
 *
 * Runs are never overwritten. Each one is written to its own `output/runs/<id>/` (the
 * directory must not exist — a clash fails the run rather than replacing it), and only
 * then copied to `output/` as the latest, which is what report.ts and review.ts read.
 * `summary.json` carries the run's manifest (`pipelines/experiments.ts`): label, git
 * state, prompt versions and source hashes, fixture hashes. A run that called a model is
 * also appended to the tracked `experiments/log.jsonl`, the version-by-version history.
 */

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { PROVIDER_KEYS, defaultModel, hasModelKey, providerOf } from '../../model/gateway';
import { addLogSink, type LogLine } from '../../observability/log';
import { judgeBatchSize, judgeModel, judgesAvailable } from '../graders/judges/base';
import { judgeCache } from '../graders/judges/cache';
import { METRICS, type MetricDefinition } from '../registry';
import { resetScheduler } from '../scheduler';
import { runManifestSchema, type GradedRow, type GraderResult, type MetricSummary, type RunManifest } from '../types';
import { formatCalibration, loadCalibrationCases, runCalibration } from './calibration';
import { experimentEntry, fixtureHashes, gitState, promptHashes, promptVersions, runId, versionDrift, versionLabel } from './experiments';
import { summarizeLatency } from './latency';
import { gradeMetric, loadFixtures } from './run';

const HERE = dirname(fileURLToPath(import.meta.url));
const EVALS_ROOT = resolve(HERE, '..');
const REPORTS_OUTPUT_DIR = resolve(EVALS_ROOT, 'reports', 'output');
const GRADED_PATH = resolve(REPORTS_OUTPUT_DIR, 'graded.jsonl');
const SUMMARY_PATH = resolve(REPORTS_OUTPUT_DIR, 'summary.json');
const CALLS_PATH = resolve(REPORTS_OUTPUT_DIR, 'calls.jsonl');
const CALIBRATION_PATH = resolve(REPORTS_OUTPUT_DIR, 'calibration.jsonl');
const RUNS_DIR = resolve(REPORTS_OUTPUT_DIR, 'runs');
const TARGETS_PATH = resolve(EVALS_ROOT, 'targets.yaml');
const EXPERIMENT_LOG = resolve(EVALS_ROOT, 'experiments', 'log.jsonl');

export interface Args {
  noJudges: boolean;
  gate: boolean;
  label: string | null;
  /**
   * `--only a,b`: the metrics to grade, else every one. A scoped run spends model calls on
   * the prompt that changed — one agent's judge and model path are a fifth or less of a
   * full run's — and is kept out of the experiment log and the trend, since a run that
   * measured one agent is not a point on the others' history.
   */
  only: string[] | null;
}

function parseOnly(argv: string[], metrics: Record<string, unknown>): string[] | null {
  const at = argv.indexOf('--only');
  if (at < 0) return null;
  const names = (argv[at + 1] ?? '').split(',').map((name) => name.trim()).filter(Boolean);
  const unknown = names.filter((name) => !(name in metrics));
  if (names.length === 0 || unknown.length > 0) {
    throw new Error(
      `--only takes a comma-separated list of metrics${unknown.length ? ` (unknown: ${unknown.join(', ')})` : ''}; ` +
        `known: ${Object.keys(metrics).join(', ')}`,
    );
  }
  return [...new Set(names)];
}

export function parseArgs(argv: string[], metrics: Record<string, unknown> = METRICS): Args {
  const at = argv.indexOf('--label');
  const label = (at >= 0 ? argv[at + 1] : process.env.EVAL_LABEL)?.trim();
  const only = parseOnly(argv, metrics);
  return {
    noJudges: argv.includes('--no-judges'),
    gate: argv.includes('--gate'),
    // Unlabelled runs are named by the prompt versions they measured; a scoped run by what it graded.
    label: label || (only ? `only ${only.join(', ')}` : versionLabel()),
    only,
  };
}

/**
 * `EVAL_MODEL_SAMPLES`: model-path calls per case, default 1. Each extra sample is a
 * full extra pass of the agents' calls and the model judge, so it is opt-in and never
 * moves the rates: those are sample 0's, and the samples only measure agreement.
 */
export function modelSamples(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.EVAL_MODEL_SAMPLES?.trim();
  if (!raw) return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`EVAL_MODEL_SAMPLES must be a positive integer, got "${raw}"`);
  }
  return n;
}

function readExperimentLog(): RunManifest[] {
  if (!existsSync(EXPERIMENT_LOG)) return [];
  return readFileSync(EXPERIMENT_LOG, 'utf-8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => runManifestSchema.parse(JSON.parse(line)));
}

function loadTargets(): Record<string, number> {
  if (!existsSync(TARGETS_PATH)) return {};
  const raw = parseYaml(readFileSync(TARGETS_PATH, 'utf-8'));
  if (!raw) return {};
  return raw as Record<string, number>;
}

function warnNoTargetsActivated(): void {
  console.warn(
    'WARNING: eval gate is NOT enforcing — no targets activated in targets.yaml. ' +
      'Uncomment real thresholds (see targets.yaml) to make --gate bite. Proceeding without enforcement.',
  );
}

// The model-output judge (`modelJudge*`) never feeds the gate: model prose varies run to
// run, and the gate certifies the deterministic path the fallback contract guarantees.
function effectivePassRate(summary: MetricSummary): number | null {
  return summary.judgePassRate !== null ? summary.judgePassRate : summary.heuristicPassRate;
}

function checkTargets(
  summaries: MetricSummary[],
  targets: Record<string, number>,
): string[] {
  const failures: string[] = [];
  for (const summary of summaries) {
    const key = METRICS[summary.metric].targetsKey;
    if (!(key in targets)) {
      // Not a failure — a metric may be deliberately ungated while its pass rate is
      // still being established. But it must be visible: silently skipping made three
      // registered metrics look gated when nothing was checking them (DSG-26).
      console.log(`target ${key}: UNGATED (no threshold in targets.yaml — not enforced)`);
      continue;
    }
    if (summary.nJudgeErrored > 0) {
      // An errored judge is not a pass or a fail; it is a case nobody graded. A gated
      // metric cannot be certified over cases it did not see.
      console.log(
        `target ${key}: FAIL (${summary.nJudgeErrored} judge call(s) errored — cannot certify)`,
      );
      failures.push(`${key} ${summary.nJudgeErrored} judge error(s)`);
      continue;
    }
    const rate = effectivePassRate(summary);
    if (rate === null) {
      console.log(`target ${key}: n/a (not measured this run — skipped)`);
      continue;
    }
    const target = targets[key];
    const passed = rate >= target;
    console.log(`target ${key}: ${passed ? 'PASS' : 'FAIL'} (${rate.toFixed(3)} vs >= ${target})`);
    if (!passed) failures.push(`${key} ${rate.toFixed(3)} < ${target}`);
  }
  return failures;
}

const fmt = (rate: number | null) => (rate !== null ? rate.toFixed(3) : '-');

// Column groups, left to right: heuristic over the template path; judge over the
// template output (gated); judge over the model output (`mjudge`, ungated); heuristic
// over the model path (`model`, ungated).
const GROUPS = {
  judge: ['judge n', 'judge err', 'judge pass', 'judge score'],
  mjudge: ['mjudge n', 'mjudge err', 'mjudge pass', 'mjudge score'],
  model: ['model n', 'model err', 'model pass'],
};
const WIDTH = (label: string) => Math.max(label.length + 1, 7);

function cols(labels: string[], values: string[] | 'skipped' | null): string {
  // A skipped grader prints `skipped`, not `-` or 0: an unrun judge must not read as
  // "graded nothing" or "scored zero". A metric with no such grader prints blanks.
  const cells =
    values === 'skipped'
      ? ['skipped', ...labels.slice(1).map(() => '')]
      : values ?? labels.map(() => '');
  return labels.map((label, i) => cells[i].padStart(WIDTH(label))).join(' ');
}

function printSummary(summaries: MetricSummary[], judgesRan: boolean, modelRan: boolean): void {
  const nameWidth = Math.max(16, ...summaries.map((s) => s.metric.length));
  const header =
    `${'metric'.padEnd(nameWidth)} ${'heur n'.padStart(7)} ${'heur pass'.padStart(10)} ` +
    Object.values(GROUPS).map((labels) => labels.map((l) => l.padStart(WIDTH(l))).join(' ')).join(' ');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const summary of summaries) {
    const def = METRICS[summary.metric];
    const judgeCols = !def.judgeCls
      ? null
      : !judgesRan
        ? 'skipped'
        : [String(summary.nJudge), String(summary.nJudgeErrored), fmt(summary.judgePassRate), fmt(summary.judgeMeanScore)];
    const modelJudgeCols = !def.judgeCls || !def.modelOutput
      ? null
      : !(judgesRan && modelRan)
        ? 'skipped'
        : [
            String(summary.nModelJudge),
            String(summary.nModelJudgeErrored),
            fmt(summary.modelJudgePassRate),
            fmt(summary.modelJudgeMeanScore),
          ];
    const modelCols = !def.model
      ? null
      : !modelRan
        ? 'skipped'
        : [String(summary.nModel), String(summary.nModelErrored), fmt(summary.modelPassRate)];
    console.log(
      `${summary.metric.padEnd(nameWidth)} ${String(summary.nHeuristic).padStart(7)} ${fmt(summary.heuristicPassRate).padStart(10)} ` +
        [cols(GROUPS.judge, judgeCols), cols(GROUPS.mjudge, modelJudgeCols), cols(GROUPS.model, modelCols)].join(' '),
    );
  }
  // Sampled runs: the share of cases whose every sample agreed, per model lane.
  const sampled = summaries.filter((s) => s.agreement);
  if (sampled.length) {
    console.log(`\nAgreement across ${sampled[0].agreement!.nSamples} model samples (rates above use sample 0):`);
    for (const s of sampled) {
      console.log(`  ${s.metric.padEnd(nameWidth)} model ${fmt(s.agreement!.model)}  mjudge ${fmt(s.agreement!.modelJudge)}`);
    }
  }
}

async function runGrading(args: Args): Promise<void> {
  // The gateway logs one `model_call` line per call; an eval run makes ~100 of them.
  // They are captured to calls.jsonl below either way, so keep the terminal to warnings.
  process.env.LOG_LEVEL ??= 'warn';
  const modelCalls: LogLine[] = [];
  const removeSink = addLogSink((line) => {
    if (line.event === 'model_call') modelCalls.push(line);
  });

  // Judges and the agents' model path each need their own provider's key (judge on
  // OpenAI, agents on Google by default); --no-judges opts out of both.
  const judgesRan = !args.noJudges && judgesAvailable();
  const modelRan = !args.noJudges && hasModelKey();
  if (!args.noJudges && !judgesRan) {
    console.log(
      `Judges skipped: ${PROVIDER_KEYS[providerOf(judgeModel())]} not set for judge model ${judgeModel()}. ` +
        'Judge-only metrics are ungraded this run.',
    );
  }
  if (!args.noJudges && !modelRan) {
    console.log(
      `Model path skipped: ${PROVIDER_KEYS[providerOf(defaultModel())]} not set for agent model ` +
        `${defaultModel()} (fallback graded alone).`,
    );
  }

  const samples = modelRan ? modelSamples() : 1;
  const calls = resetScheduler();
  if (judgesRan || modelRan) {
    console.log(
      `Model calls: agent ${modelRan ? defaultModel() : 'skipped'}, judge ${judgesRan ? judgeModel() : 'skipped'} ` +
        `(${judgeBatchSize()} case(s) per judge call), paced and retried (src/evals/scheduler.ts).`,
    );
  }
  if (samples > 1) console.log(`Model path sampled ${samples} times per case (EVAL_MODEL_SAMPLES).`);

  const metrics: Record<string, MetricDefinition> = args.only
    ? Object.fromEntries(args.only.map((name) => [name, METRICS[name]]))
    : METRICS;
  if (args.only) console.log(`Scoped run (--only): ${args.only.join(', ')}. Not added to the experiment log.`);

  const rows: GradedRow[] = [];
  const allResults: GraderResult[] = [];

  for (const [name, definition] of Object.entries(metrics)) {
    const cases = loadFixtures(definition);
    const graded = await gradeMetric(definition, cases, { judgesRan, modelRan, samples });
    cases.forEach((evalCase, i) => {
      allResults.push(...graded[i]);
      rows.push({ caseId: evalCase.id, metric: name, grades: graded[i] });
    });
  }

  // The judges on hand-labelled outputs: how far to trust the judge rows above.
  // A scoped run calibrates the judges it ran, not the others.
  const calibration = judgesRan
    ? await runCalibration(loadCalibrationCases().filter((c) => c.judge in metrics), metrics)
    : null;

  removeSink();

  const summaries = Object.values(metrics).map((definition) =>
    definition.summarize(allResults),
  );

  printSummary(summaries, judgesRan, modelRan);
  if (calibration) console.log(`\n${formatCalibration(calibration.summary)}`);
  const cache = judgesRan ? judgeCache() : null;
  const judgeCacheStats = cache ? { hits: cache.hits, misses: cache.misses } : undefined;
  if (judgesRan) {
    console.log(
      judgeCacheStats
        ? `Judge cache: ${judgeCacheStats.hits} template verdict(s) reused, ${judgeCacheStats.misses} judged (src/evals/graders/judges/cache.ts).`
        : 'Judge cache: off (EVAL_JUDGE_CACHE=0).',
    );
  }

  const targets = loadTargets();
  if (args.gate && Object.keys(targets).length === 0) {
    warnNoTargetsActivated();
  }
  const failures = args.gate ? checkTargets(summaries, targets) : [];

  const generatedAt = new Date().toISOString();
  const manifest: RunManifest = {
    id: runId(generatedAt, args.label),
    label: args.label,
    git: gitState(EVALS_ROOT),
    promptVersions: promptVersions(),
    promptHashes: promptHashes(resolve(EVALS_ROOT, '..')),
    fixtures: fixtureHashes(resolve(EVALS_ROOT, 'fixtures')),
    flags: {
      judges: judgesRan,
      model: modelRan,
      gate: args.gate,
      ...(args.only && { only: args.only }),
      ...(samples > 1 && { samples }),
    },
    drift: [],
  };
  manifest.drift = versionDrift(manifest, readExperimentLog());
  const summary = {
    generatedAt,
    nCases: rows.length,
    judgesRan,
    modelCallsRan: modelRan,
    models: { agent: modelRan ? defaultModel() : null, judge: judgesRan ? judgeModel() : null },
    latency: summarizeLatency(modelCalls),
    summaries,
    run: manifest,
    ...(calibration && { calibration: calibration.summary }),
    ...(judgeCacheStats && { judgeCache: judgeCacheStats }),
  };

  // The run's own directory first; `recursive: false` makes an existing one an error, so
  // no run is ever written over another. The top-level files are a copy of the latest.
  const runDir = resolve(RUNS_DIR, manifest.id);
  mkdirSync(RUNS_DIR, { recursive: true });
  mkdirSync(runDir, { recursive: false });
  const files = {
    'graded.jsonl': rows.map((row) => JSON.stringify(row)).join('\n') + '\n',
    'summary.json': JSON.stringify(summary, null, 2) + '\n',
    'calls.jsonl': modelCalls.map((line) => JSON.stringify(line)).join('\n') + (modelCalls.length ? '\n' : ''),
    ...(calibration && {
      'calibration.jsonl': calibration.results.map((row) => JSON.stringify(row)).join('\n') + '\n',
    }),
  };
  for (const [name, content] of Object.entries(files)) writeFileSync(resolve(runDir, name), content, { encoding: 'utf-8', flag: 'wx' });
  // A heuristics-only run leaves the latest calibration.jsonl behind; the notebook reads
  // it only beside a summary that carries `calibration`, so it cannot be mistaken for this run's.
  for (const path of [GRADED_PATH, SUMMARY_PATH, CALLS_PATH, ...(calibration ? [CALIBRATION_PATH] : [])]) {
    copyFileSync(resolve(runDir, path.split('/').at(-1)!), path);
  }

  const logged = (judgesRan || modelRan) && !args.only;
  if (logged) {
    mkdirSync(dirname(EXPERIMENT_LOG), { recursive: true });
    appendFileSync(EXPERIMENT_LOG, JSON.stringify(experimentEntry(summary)) + '\n', 'utf-8');
  }

  if (judgesRan || modelRan) console.log(`\n${calls.calls} model call(s) sent this run.`);
  if (calls.quotaExhausted) {
    console.error(
      `Model quota exhausted (${calls.quotaExhausted.message}): every call after the first quota ` +
        'error was skipped, not sent. Rerun once it clears, or set GATEWAY_MODEL / EVAL_JUDGE_MODEL ' +
        'to a model with quota left.',
    );
  }
  if (manifest.drift.length) {
    console.warn(
      `WARNING: prompt source changed without a version bump: ${manifest.drift.join(', ')}. ` +
        'Bump the PROMPT_VERSION so this run is not compared as the same prompt.',
    );
  }
  console.log(`Run ${manifest.id}${manifest.label ? ` ("${manifest.label}")` : ''}: ${runDir}`);
  console.log(`Latest copied to ${REPORTS_OUTPUT_DIR}`);
  if (logged) console.log(`Logged to ${EXPERIMENT_LOG}`);
  else if (args.only) console.log('Scoped run (--only): not added to the experiment log or the trend.');
  else console.log('Heuristics only: not added to the experiment log (deterministic, reproducible from git).');

  if (args.gate && failures.length > 0) {
    console.error('eval gate FAILED:');
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await runGrading(args);
}

// Imported by its test for parseArgs(); run only as the script.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
