/**
 * Judge calibration: grade hand-labelled outputs and report how often each judge agrees
 * with the label. The agent evals measure the agents; this measures the judges, so a
 * rubric change (`JUDGE_PROMPT_VERSION`) can be seen to help or hurt before its pass
 * rates are trusted, and a judge that passes everything is caught.
 *
 * Each row of `fixtures/judgeCalibration.jsonl` names a judge, one of that judge's
 * fixture cases, and a `patch` over the template output — a planted fabrication, an
 * argued-for wrong bucket, an overclaim — with the verdict a careful reader gives it.
 * Rows without a patch are the template output itself, labelled as a pass, so a judge
 * that is too strict shows up as well as one that is too lenient.
 *
 * Labels are two-level: `expected.isCorrect` is always scored; a dimension is scored
 * only when it is in `failed` (label 0) or not in `uncertain` (label 1). The rows are
 * judged through the same batched, paced `gradeBatch()` as the real cases.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JUDGE_PROMPT_VERSION, type JudgeItem, type LLMJudge } from '../graders/judges/base';
import { METRICS, type MetricDefinition } from '../registry';
import {
  calibrationCaseSchema,
  type CalibrationCase,
  type CalibrationResult,
  type CalibrationSummary,
  type EvalCase,
  type GraderResult,
} from '../types';
import { FIXTURES_DIR, loadFixtures } from './run';

export const CALIBRATION_FIXTURE = resolve(FIXTURES_DIR, 'judgeCalibration.jsonl');

export function loadCalibrationCases(path = CALIBRATION_FIXTURE): CalibrationCase[] {
  if (!existsSync(path)) return [];
  const rows = readFileSync(path, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => calibrationCaseSchema.parse(JSON.parse(line)));
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) throw new Error(`judgeCalibration.jsonl: duplicate id "${row.id}"`);
    seen.add(row.id);
  }
  return rows;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `patch` over `template`, one level deep: a nested object in the patch replaces the
 * matching keys of a nested object in the template (so `{charter: {objectives}}` keeps
 * the rest of the charter); anything else replaces the field.
 */
export function applyPatch(template: unknown, patch: Record<string, unknown> | undefined): unknown {
  if (!patch) return template;
  if (!isPlainObject(template)) throw new Error('calibration patch needs an object template');
  const out: Record<string, unknown> = { ...template };
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key];
    out[key] = isPlainObject(value) && isPlainObject(current) ? { ...current, ...value } : value;
  }
  return out;
}

export interface CalibrationItem {
  calibration: CalibrationCase;
  judge: LLMJudge<unknown>;
  item: JudgeItem<unknown>;
}

/**
 * Resolve every row to a judge instance and a `JudgeItem`. The item's `evalCase` is the
 * fixture case under the calibration row's id, since `gradeBatch()` matches verdicts
 * back by id and one fixture case can carry several labelled outputs.
 */
export function buildCalibrationItems(
  cases: CalibrationCase[],
  metrics: Record<string, MetricDefinition> = METRICS,
  fixturesDir = FIXTURES_DIR,
): CalibrationItem[] {
  const judges = new Map<string, LLMJudge<unknown>>();
  const fixtures = new Map<string, EvalCase[]>();
  return cases.map((calibration) => {
    const definition = metrics[calibration.judge];
    if (!definition?.judgeCls) {
      throw new Error(`judgeCalibration.jsonl "${calibration.id}": "${calibration.judge}" is not a judge metric`);
    }
    let judge = judges.get(calibration.judge);
    if (!judge) {
      judge = new definition.judgeCls();
      judges.set(calibration.judge, judge);
    }
    let fixtureCases = fixtures.get(calibration.judge);
    if (!fixtureCases) {
      fixtureCases = loadFixtures(definition, fixturesDir);
      fixtures.set(calibration.judge, fixtureCases);
    }
    const evalCase = fixtureCases.find((c) => c.id === calibration.caseId);
    if (!evalCase) {
      throw new Error(
        `judgeCalibration.jsonl "${calibration.id}": no case "${calibration.caseId}" in the ${calibration.judge} fixtures`,
      );
    }
    const output = applyPatch(judge.template(evalCase), calibration.patch);
    return {
      calibration,
      judge,
      item: { evalCase: { ...evalCase, id: calibration.id }, output, source: 'template' },
    };
  });
}

/** Compare one verdict with its label. */
export function compareVerdict(calibration: CalibrationCase, judge: LLMJudge<unknown>, verdict: GraderResult): CalibrationResult {
  const { expected } = calibration;
  const graded = verdict.status === 'graded';
  const uncertain = new Set(expected.uncertain ?? []);
  const dimensionsAgreed: Record<string, boolean> = {};
  if (graded) {
    for (const dim of judge.dimensions) {
      if (uncertain.has(dim)) continue;
      const label = expected.failed.includes(dim) ? 0 : 1;
      dimensionsAgreed[dim] = verdict.dimensions[dim] === label;
    }
  }
  return {
    id: calibration.id,
    judge: calibration.judge,
    caseId: calibration.caseId,
    expected,
    verdict: { ...verdict, caseId: calibration.caseId },
    agreed: graded ? verdict.isCorrect === expected.isCorrect : null,
    dimensionsAgreed,
  };
}

function rate(hits: number, n: number): number | null {
  return n === 0 ? null : hits / n;
}

export function summarizeCalibration(results: CalibrationResult[]): CalibrationSummary {
  const byJudge = new Map<string, CalibrationResult[]>();
  for (const result of results) {
    const rows = byJudge.get(result.judge) ?? [];
    rows.push(result);
    byJudge.set(result.judge, rows);
  }
  return {
    judgeVersion: JUDGE_PROMPT_VERSION,
    nCases: results.length,
    judges: [...byJudge.entries()].map(([judge, rows]) => {
      const graded = rows.filter((row) => row.agreed !== null);
      const dimensions: Record<string, { n: number; agreement: number | null }> = {};
      const tallies = new Map<string, { n: number; hits: number }>();
      for (const row of graded) {
        for (const [dim, agreed] of Object.entries(row.dimensionsAgreed)) {
          const tally = tallies.get(dim) ?? { n: 0, hits: 0 };
          tally.n += 1;
          if (agreed) tally.hits += 1;
          tallies.set(dim, tally);
        }
      }
      for (const [dim, tally] of tallies) dimensions[dim] = { n: tally.n, agreement: rate(tally.hits, tally.n) };
      return {
        judge,
        n: rows.length,
        nErrored: rows.length - graded.length,
        agreement: rate(graded.filter((row) => row.agreed).length, graded.length),
        dimensions,
      };
    }),
  };
}

/** Grade every calibration row, one batch per judge, and summarise. */
export async function runCalibration(
  cases: CalibrationCase[],
  metrics: Record<string, MetricDefinition> = METRICS,
  fixturesDir = FIXTURES_DIR,
): Promise<{ results: CalibrationResult[]; summary: CalibrationSummary }> {
  const items = buildCalibrationItems(cases, metrics, fixturesDir);
  const byJudge = new Map<string, CalibrationItem[]>();
  for (const entry of items) {
    const group = byJudge.get(entry.calibration.judge) ?? [];
    group.push(entry);
    byJudge.set(entry.calibration.judge, group);
  }
  const results: CalibrationResult[] = [];
  for (const group of byJudge.values()) {
    const { judge } = group[0];
    const verdicts = await judge.gradeBatch(group.map((entry) => entry.item));
    group.forEach((entry, i) => results.push(compareVerdict(entry.calibration, judge, verdicts[i])));
  }
  // Fixture order, so the written file reads like the fixture.
  const order = new Map(cases.map((c, i) => [c.id, i]));
  results.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return { results, summary: summarizeCalibration(results) };
}

export function formatCalibration(summary: CalibrationSummary): string {
  const pct = (value: number | null) => (value === null ? '   -' : `${Math.round(value * 100)}%`.padStart(4));
  const lines = [`Judge calibration (${summary.nCases} hand-labelled outputs, judge ${summary.judgeVersion}):`];
  for (const j of summary.judges) {
    const dims = Object.entries(j.dimensions)
      .map(([dim, d]) => `${dim} ${pct(d.agreement)} (${d.n})`)
      .join(', ');
    lines.push(
      `  ${j.judge.padEnd(18)} verdict agreement ${pct(j.agreement)} of ${j.n - j.nErrored}` +
        (j.nErrored ? ` (${j.nErrored} errored)` : '') +
        `; ${dims}`,
    );
  }
  return lines.join('\n');
}
