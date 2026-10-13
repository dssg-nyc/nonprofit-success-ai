/**
 * The human-review export: one CSV per fixture under reports/output/review/, one row per
 * case, with the question (fixture input), the expected values, every metric's verdict on
 * that case side by side, the answers that were graded, and blank `human_verdict` /
 * `human_notes` columns for a reviewer. Run via `npm run eval:review` after `eval:grade`.
 *
 * One file per fixture, not per metric: metrics that share a fixture (scoutRouting +
 * scoutRationale, architectPlanStructure + architectCharter) grade the same cases, so
 * their verdicts belong on the same row. No combined all.csv — every fixture has its own
 * input/expected keys, so one sheet would be mostly empty columns.
 *
 * `buildReviewRows()` and `toCsv()` are pure (tested); `main()` is the CLI shell and runs
 * only when this file is the entrypoint.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { METRICS, fixtureName } from '../registry';
import type { MetricDefinition } from '../registry';
import { gradedRowSchema } from '../types';
import type { EvalCase, GradedRow, GraderResult } from '../types';
import { loadFixtures } from './run';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORTS_OUTPUT_DIR = resolve(HERE, '..', 'reports', 'output');
const GRADED_PATH = resolve(REPORTS_OUTPUT_DIR, 'graded.jsonl');
const REVIEW_DIR = resolve(REPORTS_OUTPUT_DIR, 'review');

/** model_output for a run that predates `GraderResult.output`. */
export const NOT_SAVED = '(not saved — rerun npm run eval:grade)';

export interface ReviewTable {
  columns: string[];
  rows: string[][];
}

// ---- cells -----------------------------------------------------------------------------

/** PASS / FAIL / ERRORED: <code>; blank when the grader did not run on this case. */
export function passCell(result: GraderResult | undefined): string {
  if (!result) return '';
  if (result.status === 'errored') return `ERRORED: ${result.error ?? 'unknown'}`;
  return result.isCorrect ? 'PASS' : 'FAIL';
}

function scoreCell(result: GraderResult | undefined): string {
  if (!result || result.status === 'errored') return '';
  return result.score.toFixed(2);
}

/** A fixture value as a cell: strings as-is, everything else JSON. */
function valueCell(value: unknown): string {
  if (value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

// ---- answers ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string => (typeof value === 'string' ? value : valueCell(value));

const list = (value: unknown, render: (item: unknown) => string = str): string[] =>
  Array.isArray(value) ? value.map(render) : [];

const bullets = (label: string, items: string[]): string[] =>
  items.length > 0 ? [`${label}:`, ...items.map((item) => `- ${item}`)] : [];

function renderScout(r: Record<string, unknown>): string {
  return [
    `bucket: ${str(r.bucket)} (confidence ${str(r.confidence)})`,
    `signal: ${str(r.composite_signal)}`,
    `tier: ${str(r.hitlTier)}`,
    ...(Array.isArray(r.flags) && r.flags.length > 0 ? [`flags: ${list(r.flags).join(', ')}`] : []),
    `rationale: ${str(r.rationale)}`,
  ].join('\n');
}

function renderEnvoy(r: Record<string, unknown>): string {
  return `Subject: ${str(r.subject)}\n\n${str(r.body)}`;
}

function renderChronicle(r: Record<string, unknown>): string {
  const outcomes = list(r.outcomes);
  return [
    `readiness: ${str(r.readiness)}`,
    `Headline: ${str(r.headline) || '(empty)'}`,
    '',
    str(r.narrative) || '(empty)',
    ...(outcomes.length > 0 ? ['', ...bullets('Outcomes', outcomes)] : []),
  ].join('\n');
}

const workstream = (w: unknown): string =>
  isRecord(w) ? `${str(w.name)}${w.required === true ? ' (required)' : ''}: ${str(w.description)}` : str(w);

const phase = (p: unknown): string =>
  isRecord(p) ? `${str(p.window)} — ${str(p.title)}: ${list(p.milestones).join('; ')}` : str(p);

function renderArchitect(charter: Record<string, unknown>, plan: Record<string, unknown>): string {
  return [
    `Title: ${str(charter.title)}`,
    `Shape: ${str(plan.shape)} — ${str(plan.headline)}`,
    `Background: ${str(charter.background)}`,
    `Scope: ${str(charter.scopeStatement)}`,
    ...bullets('Phases', list(plan.phases, phase)),
    ...(plan.phase2Note !== undefined ? [`Phase 2 note: ${str(plan.phase2Note)}`] : []),
    ...bullets('Workstreams', list(charter.workstreams, workstream)),
    ...bullets('Risks', list(charter.risks)),
    ...bullets('Success criteria', list(charter.successCriteria)),
    `Cadence: ${str(charter.cadence)}`,
  ].join('\n');
}

/**
 * An agent output as readable text, recognised by shape rather than by metric name (the
 * registry is the only place metric names live). An unrecognised shape falls back to
 * indented JSON, so a new agent's output is still reviewable before it gets a renderer.
 */
export function renderOutput(output: unknown): string {
  if (output === undefined || output === null) return '';
  if (typeof output === 'string') return output;
  if (isRecord(output)) {
    if (isRecord(output.charter) && isRecord(output.plan)) return renderArchitect(output.charter, output.plan);
    if ('composite_signal' in output && 'bucket' in output) return renderScout(output);
    if ('subject' in output && 'body' in output) return renderEnvoy(output);
    if ('headline' in output && 'narrative' in output) return renderChronicle(output);
  }
  return JSON.stringify(output, null, 2);
}

// ---- table -----------------------------------------------------------------------------

type Slot = 'heuristic' | 'model' | 'judgeTemplate' | 'judgeModel';

function slotOf(result: GraderResult): Slot {
  if (result.grader === 'heuristic') return 'heuristic';
  if (result.grader === 'model') return 'model';
  // A judge row without `source` predates the field and reads as `template`.
  return result.source === 'model' ? 'judgeModel' : 'judgeTemplate';
}

function metricColumns(definition: MetricDefinition): string[] {
  const p = `${definition.name}.`;
  return [
    ...(definition.heuristic ? [`${p}heuristic_pass`, `${p}heuristic_reason`] : []),
    ...(definition.model ? [`${p}model_pass`, `${p}model_reason`] : []),
    ...(definition.judgeCls
      ? [
          `${p}judge_template_pass`,
          `${p}judge_template_score`,
          `${p}judge_template_reasoning`,
          `${p}judge_model_pass`,
          `${p}judge_model_score`,
          `${p}judge_model_reasoning`,
        ]
      : []),
  ];
}

function metricCells(definition: MetricDefinition, grades: Partial<Record<Slot, GraderResult>>): string[] {
  const { heuristic, model, judgeTemplate, judgeModel } = grades;
  return [
    ...(definition.heuristic ? [passCell(heuristic), heuristic?.reasoning ?? ''] : []),
    ...(definition.model ? [passCell(model), model?.reasoning ?? ''] : []),
    ...(definition.judgeCls
      ? [
          passCell(judgeTemplate),
          scoreCell(judgeTemplate),
          judgeTemplate?.reasoning ?? '',
          passCell(judgeModel),
          scoreCell(judgeModel),
          judgeModel?.reasoning ?? '',
        ]
      : []),
  ];
}

/** Keys across every case, in first-seen order — fixtures need not all carry the same keys. */
function keysOf(records: Array<Record<string, unknown>>): string[] {
  const keys = new Set<string>();
  for (const record of records) for (const key of Object.keys(record)) keys.add(key);
  return [...keys];
}

/** The model output saved on any of a case's rows, or why there is none. */
function modelAnswer(grades: GraderResult[], hasModelPath: boolean): string {
  if (!hasModelPath) return '';
  const modelRows = grades.filter((g) => g.grader === 'model' || (g.grader === 'judge' && g.source === 'model'));
  const saved = modelRows.find((g) => g.output !== undefined);
  if (saved) return renderOutput(saved.output);
  if (modelRows.length === 0) return '';
  if (modelRows.every((g) => g.status === 'errored')) {
    return `(no output — model path errored: ${modelRows[0].error ?? 'unknown'})`;
  }
  return NOT_SAVED;
}

/** The template output saved on a template-judge row; regenerated from the judge when absent. */
function templateAnswer(evalCase: EvalCase, grades: GraderResult[], metrics: MetricDefinition[]): string {
  const saved = grades.find((g) => g.grader === 'judge' && g.source !== 'model' && g.output !== undefined);
  if (saved) return renderOutput(saved.output);
  const Judge = metrics.find((m) => m.judgeCls)?.judgeCls;
  return Judge ? renderOutput(new Judge().template(evalCase)) : '';
}

/**
 * One fixture's review table: one row per case, the verdicts of every metric graded on
 * that fixture (`metrics`, in registry order) merged onto it. `template_output` /
 * `model_output` appear only when a metric on the fixture has a judge or model path —
 * a heuristic-only fixture's answer is already spelled out in its `heuristic_reason`.
 */
export function buildReviewRows(
  cases: EvalCase[],
  metrics: MetricDefinition[],
  graded: GradedRow[],
): ReviewTable {
  const byKey = new Map<string, GraderResult[]>();
  for (const row of graded) byKey.set(`${row.metric}\u0000${row.caseId}`, row.grades);
  const gradesOf = (metric: string, caseId: string) => byKey.get(`${metric}\u0000${caseId}`) ?? [];

  const inputKeys = keysOf(cases.map((c) => c.input));
  const expectedKeys = keysOf(cases.map((c) => c.expected));
  const hasModelPath = metrics.some((m) => m.model || m.modelOutput);
  const hasAnswers = hasModelPath || metrics.some((m) => m.judgeCls);

  const columns = [
    'case_id',
    'note',
    ...inputKeys.map((k) => `input.${k}`),
    ...expectedKeys.map((k) => `expected.${k}`),
    ...metrics.flatMap(metricColumns),
    ...(hasAnswers ? ['template_output', 'model_output'] : []),
    'human_verdict',
    'human_notes',
  ];

  const rows = cases.map((evalCase) => {
    const all = metrics.flatMap((m) => gradesOf(m.name, evalCase.id));
    const verdicts = metrics.flatMap((m) => {
      const slots: Partial<Record<Slot, GraderResult>> = {};
      for (const result of gradesOf(m.name, evalCase.id)) slots[slotOf(result)] ??= result;
      return metricCells(m, slots);
    });
    return [
      evalCase.id,
      evalCase.note ?? '',
      ...inputKeys.map((k) => valueCell(evalCase.input[k])),
      ...expectedKeys.map((k) => valueCell(evalCase.expected[k])),
      ...verdicts,
      ...(hasAnswers ? [templateAnswer(evalCase, all, metrics), modelAnswer(all, hasModelPath)] : []),
      '',
      '',
    ];
  });

  return { columns, rows };
}

// ---- CSV -------------------------------------------------------------------------------

/** RFC 4180: quote a field holding a comma, quote, CR or LF; double the quotes inside. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** RFC 4180 CSV, CRLF between records. No BOM — the writer adds it for Excel. */
export function toCsv({ columns, rows }: ReviewTable): string {
  return [columns, ...rows].map((record) => record.map(csvField).join(',')).join('\r\n') + '\r\n';
}

/** Metrics grouped by the fixture they grade, in registry order. */
export function metricsByFixture(metrics: Record<string, MetricDefinition>): Map<string, MetricDefinition[]> {
  const groups = new Map<string, MetricDefinition[]>();
  for (const definition of Object.values(metrics)) {
    const stem = fixtureName(definition);
    groups.set(stem, [...(groups.get(stem) ?? []), definition]);
  }
  return groups;
}

// ---- CLI -------------------------------------------------------------------------------

function main(): void {
  if (!existsSync(GRADED_PATH)) {
    console.error(`error: no graded file at '${GRADED_PATH}'.\nRun 'npm run eval:grade' first.`);
    process.exit(1);
  }
  const graded = readFileSync(GRADED_PATH, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => gradedRowSchema.parse(JSON.parse(line)));

  mkdirSync(REVIEW_DIR, { recursive: true });
  for (const [stem, metrics] of metricsByFixture(METRICS)) {
    const cases = loadFixtures(metrics[0]);
    if (cases.length === 0) continue;
    const path = resolve(REVIEW_DIR, `${stem}.csv`);
    // The BOM makes Excel read the file as UTF-8 (em dashes, curly quotes in the prose).
    writeFileSync(path, '\uFEFF' + toCsv(buildReviewRows(cases, metrics, graded)), 'utf-8');
    console.log(`Wrote ${path} (${cases.length} case(s); ${metrics.map((m) => m.name).join(', ')})`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
