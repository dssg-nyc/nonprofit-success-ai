/**
 * Renders a grade run to one self-contained HTML file: the scoreboard, the trend across
 * keyed runs, the judge's calibration, then every case with each grader's verdict,
 * dimensions and reasoning. Run via `npm run eval:report` after `eval:grade`.
 *
 * Reads the latest run (`reports/output/`) by default, or `EVAL_RUN=<id>` for any run
 * under `reports/output/runs/`. The page is written beside the run it renders
 * (`runs/<id>/report.html`) — a derivation of that run's files, so it may be re-rendered
 * — and, for the latest run, copied up as `reports/output/report.html`.
 * The rendering itself is in render.ts (testable); this file is the CLI shell.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { METRICS } from '../registry';
import { calibrationResultSchema, evalReportSchema, gradedRowSchema } from '../types';
import type { CalibrationCase, CalibrationResult, EvalCase, GradedRow } from '../types';
import { CALIBRATION_FIXTURE, loadCalibrationCases } from './calibration';
import { loadRunHistory } from './history';
import { renderReport } from './render';
import { loadFixtures } from './run';

const HERE = dirname(fileURLToPath(import.meta.url));
const EVALS_ROOT = resolve(HERE, '..');
const REPORTS_OUTPUT_DIR = resolve(EVALS_ROOT, 'reports', 'output');
const RUNS_DIR = resolve(REPORTS_OUTPUT_DIR, 'runs');
const EXPERIMENT_LOG = resolve(EVALS_ROOT, 'experiments', 'log.jsonl');
const TARGETS_PATH = resolve(EVALS_ROOT, 'targets.yaml');
const KAPPA_DIR = resolve(REPORTS_OUTPUT_DIR, 'kappa');
const WORKFLOWS_DIR = resolve(EVALS_ROOT, '..', '..', '.github', 'workflows');

/** Rater sheets for the Chronicle κ protocol (D25): any file under reports/output/kappa/. */
function countKappaSheets(): number {
  if (!existsSync(KAPPA_DIR)) return 0;
  return readdirSync(KAPPA_DIR).filter((f) => !f.startsWith('.')).length;
}

/** Whether any workflow names a judge job (J3): a job id starting with `eval-judge`. */
function hasJudgeCiJob(): boolean {
  if (!existsSync(WORKFLOWS_DIR)) return false;
  return readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .some((f) => /^\s{2}eval-judges?[\w-]*:/m.test(readFileSync(resolve(WORKFLOWS_DIR, f), 'utf-8')));
}

/** The labelled set behind the calibration numbers, for the sample card; empty when the file is absent. */
function loadCalibrationSet(): CalibrationCase[] {
  return existsSync(CALIBRATION_FIXTURE) ? loadCalibrationCases() : [];
}

/** targets.yaml as grade.ts reads it, so the page shows the same gated/ungated split. */
function loadTargets(): Record<string, number> {
  if (!existsSync(TARGETS_PATH)) return {};
  const raw: unknown = parseYaml(readFileSync(TARGETS_PATH, 'utf-8'));
  return raw && typeof raw === 'object' ? (raw as Record<string, number>) : {};
}

function readJsonl<T>(path: string, parse: (row: unknown) => T): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => parse(JSON.parse(line)));
}

function main(): void {
  const pinned = process.env.EVAL_RUN?.trim();
  const sourceDir = pinned ? resolve(RUNS_DIR, pinned) : REPORTS_OUTPUT_DIR;
  const summaryPath = resolve(sourceDir, 'summary.json');
  if (!existsSync(summaryPath)) {
    console.error(
      pinned
        ? `error: no run '${pinned}' under '${RUNS_DIR}'.`
        : `error: no summary file at '${summaryPath}'.\nRun 'npm run eval:grade' first.`,
    );
    process.exit(1);
  }
  const report = evalReportSchema.parse(JSON.parse(readFileSync(summaryPath, 'utf-8')));
  const rows = readJsonl(resolve(sourceDir, 'graded.jsonl'), (row) => gradedRowSchema.parse(row) as GradedRow);
  // A heuristics-only run leaves the previous calibration.jsonl beside it; only a summary
  // that carries `calibration` owns the rows next to it.
  const calibrationRows = report.calibration
    ? readJsonl(resolve(sourceDir, 'calibration.jsonl'), (row) => calibrationResultSchema.parse(row) as CalibrationResult)
    : [];
  const cases: Record<string, EvalCase[]> = {};
  for (const [name, definition] of Object.entries(METRICS)) cases[name] = loadFixtures(definition);

  const html = renderReport({
    report,
    rows,
    cases,
    metrics: METRICS,
    targets: loadTargets(),
    history: loadRunHistory({ logPath: EXPERIMENT_LOG, runsDir: RUNS_DIR }),
    calibrationRows,
    calibrationCases: loadCalibrationSet(),
    readiness: { kappaSheets: countKappaSheets(), judgeCiJob: hasJudgeCiJob() },
  });

  const written: string[] = [];
  if (report.run) {
    const runDir = resolve(RUNS_DIR, report.run.id);
    if (existsSync(runDir)) {
      writeFileSync(resolve(runDir, 'report.html'), html, 'utf-8');
      written.push(resolve(runDir, 'report.html'));
    }
  }
  if (!pinned) {
    mkdirSync(REPORTS_OUTPUT_DIR, { recursive: true });
    writeFileSync(resolve(REPORTS_OUTPUT_DIR, 'report.html'), html, 'utf-8');
    written.push(resolve(REPORTS_OUTPUT_DIR, 'report.html'));
  }
  console.log(`Wrote HTML report (${rows.length} graded case(s)) to:\n  ${written.join('\n  ')}`);
}

main();
