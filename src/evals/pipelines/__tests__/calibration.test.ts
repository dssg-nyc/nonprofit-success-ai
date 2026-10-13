import { afterEach, describe, expect, it, vi } from 'vitest';
import { LLMJudge, type JudgeItem } from '../../graders/judges/base';
import { METRICS } from '../../registry';
import type { CalibrationCase, GraderResult } from '../../types';
import {
  applyPatch,
  buildCalibrationItems,
  compareVerdict,
  loadCalibrationCases,
  runCalibration,
  summarizeCalibration,
} from '../calibration';

const cases = loadCalibrationCases();

afterEach(() => {
  vi.restoreAllMocks();
});

/** A verdict shaped like `gradeBatch()` returns, for one item. */
function verdict(item: JudgeItem<unknown>, metric: string, dimensions: Record<string, number>): GraderResult {
  const isCorrect = Object.values(dimensions).every((v) => v === 1);
  return {
    caseId: item.evalCase.id,
    metric,
    grader: 'judge',
    source: item.source,
    status: 'graded',
    isCorrect,
    score: isCorrect ? 1 : 0.5,
    reasoning: 'stub',
    dimensions,
    output: item.output,
  };
}

/** Stub the judge to answer exactly as the labels say (uncertain dimensions pass). */
function judgeByLabels() {
  const byId = new Map(cases.map((c) => [c.id, c]));
  return vi.spyOn(LLMJudge.prototype, 'gradeBatch').mockImplementation(async function (this: LLMJudge<unknown>, items) {
    return items.map((item) => {
      const label = byId.get(item.evalCase.id)!;
      const dims = Object.fromEntries(this.dimensions.map((d) => [d, label.expected.failed.includes(d) ? 0 : 1]));
      return verdict(item, this.metric, dims);
    });
  });
}

describe('judgeCalibration.jsonl', () => {
  it('covers every judge metric with at least one pass and one fail label', () => {
    const judges = Object.values(METRICS).filter((m) => m.judgeCls).map((m) => m.name);
    expect(judges.length).toBeGreaterThan(0);
    for (const judge of judges) {
      const rows = cases.filter((c) => c.judge === judge);
      expect(rows.some((c) => c.expected.isCorrect), `${judge} has no pass label`).toBe(true);
      expect(rows.some((c) => !c.expected.isCorrect), `${judge} has no fail label`).toBe(true);
    }
  });

  it('meets the calibration floor: 10 labels per judge, at least 4 of each verdict, every dimension a sole fault once', () => {
    for (const metric of Object.values(METRICS).filter((m) => m.judgeCls)) {
      const rows = cases.filter((c) => c.judge === metric.name);
      const passes = rows.filter((c) => c.expected.isCorrect).length;
      expect(rows.length, `${metric.name}: ${rows.length} labels`).toBeGreaterThanOrEqual(10);
      expect(passes, `${metric.name}: ${passes} passes of ${rows.length}`).toBeGreaterThanOrEqual(4);
      expect(rows.length - passes, `${metric.name}: ${rows.length - passes} fails of ${rows.length}`).toBeGreaterThanOrEqual(4);
      for (const dimension of new metric.judgeCls!().dimensions) {
        const sole = rows.some((c) => c.expected.failed.length === 1 && c.expected.failed[0] === dimension);
        expect(sole, `${metric.name}: "${dimension}" is never the sole planted fault`).toBe(true);
      }
      expect(rows.some((c) => (c.expected.uncertain ?? []).length > 0), `${metric.name} has no uncertain row`).toBe(true);
    }
  });

  it('labels are coherent: failed is non-empty exactly when the output is wrong, and names rubric dimensions', () => {
    const items = buildCalibrationItems(cases);
    for (const { calibration, judge } of items) {
      const { expected } = calibration;
      expect(expected.failed.length > 0, `${calibration.id}: failed vs isCorrect`).toBe(!expected.isCorrect);
      for (const d of [...expected.failed, ...(expected.uncertain ?? [])]) {
        expect(judge.dimensions, `${calibration.id}: "${d}" is not a ${calibration.judge} dimension`).toContain(d);
      }
      for (const d of expected.failed) {
        expect(expected.uncertain ?? [], `${calibration.id}: "${d}" both failed and uncertain`).not.toContain(d);
      }
      expect(calibration.note, `${calibration.id} has no note`).toBeTruthy();
    }
  });

  it('every row resolves to a fixture case and a patched template output', () => {
    const items = buildCalibrationItems(cases);
    expect(items).toHaveLength(cases.length);
    for (const { calibration, item } of items) {
      expect(item.evalCase.id).toBe(calibration.id);
      for (const [key, value] of Object.entries(calibration.patch ?? {})) {
        const got = (item.output as Record<string, unknown>)[key];
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          expect(got).toMatchObject(value as Record<string, unknown>);
        } else {
          expect(got).toEqual(value);
        }
      }
    }
  });
});

describe('applyPatch', () => {
  it('replaces top-level fields and merges one level into nested objects', () => {
    const out = applyPatch(
      { a: 1, nested: { x: 1, y: 2 }, list: [1] },
      { a: 2, nested: { y: 3 }, list: [9] },
    );
    expect(out).toEqual({ a: 2, nested: { x: 1, y: 3 }, list: [9] });
  });

  it('is the template when there is no patch', () => {
    const template = { a: 1 };
    expect(applyPatch(template, undefined)).toBe(template);
  });
});

describe('compareVerdict and summarizeCalibration', () => {
  const judge = new METRICS.scoutRationale.judgeCls!();
  const row: CalibrationCase = {
    id: 'x',
    judge: 'scoutRationale',
    caseId: 'c',
    expected: { isCorrect: false, failed: ['accurate'], uncertain: ['grounded'] },
  };
  const item: JudgeItem<unknown> = { evalCase: { id: 'x', input: {}, expected: {} }, output: {}, source: 'template' };

  it('scores the verdict and each labelled dimension, skipping uncertain ones', () => {
    const r = compareVerdict(row, judge, verdict(item, 'scoutRationale', { accurate: 1, grounded: 0, clear: 1 }));
    // The judge failed the output (isCorrect false, as labelled) but for the wrong reason:
    // grounded instead of accurate. Verdict agreement is about pass/fail alone.
    expect(r.agreed).toBe(true);
    expect(r.dimensionsAgreed).toEqual({ accurate: false, clear: true });
    expect(r.verdict.caseId).toBe('c');
  });

  it('an errored verdict agrees with nothing and is counted apart', () => {
    const errored: GraderResult = { ...verdict(item, 'scoutRationale', {}), status: 'errored', error: 'judge_failed', dimensions: {} };
    const r = compareVerdict(row, judge, errored);
    expect(r.agreed).toBeNull();
    expect(r.dimensionsAgreed).toEqual({});

    const s = summarizeCalibration([r]);
    expect(s.judges).toEqual([
      { judge: 'scoutRationale', n: 1, nErrored: 1, agreement: null, dimensions: {} },
    ]);
  });

  it('summarises agreement per judge and per dimension', () => {
    const agree = compareVerdict(row, judge, verdict(item, 'scoutRationale', { accurate: 0, grounded: 1, clear: 1 }));
    const disagree = compareVerdict(row, judge, verdict(item, 'scoutRationale', { accurate: 1, grounded: 1, clear: 1 }));
    const s = summarizeCalibration([agree, disagree]);
    expect(s.judgeVersion).toMatch(/^\d+\.\d+$/);
    expect(s.judges[0]).toEqual({
      judge: 'scoutRationale',
      n: 2,
      nErrored: 0,
      agreement: 0.5,
      dimensions: { accurate: { n: 2, agreement: 0.5 }, clear: { n: 2, agreement: 1 } },
    });
  });
});

describe('runCalibration', () => {
  it('grades one batch per judge and reports full agreement for a judge that matches the labels', async () => {
    const spy = judgeByLabels();

    const { results, summary } = await runCalibration(cases);

    const judges = new Set(cases.map((c) => c.judge));
    expect(spy).toHaveBeenCalledTimes(judges.size);
    expect(results.map((r) => r.id)).toEqual(cases.map((c) => c.id));
    expect(summary.nCases).toBe(cases.length);
    for (const j of summary.judges) {
      expect(j.agreement, j.judge).toBe(1);
      for (const [dim, d] of Object.entries(j.dimensions)) expect(d.agreement, `${j.judge} ${dim}`).toBe(1);
    }
  });

  it('a judge that passes everything disagrees on every fail label', async () => {
    vi.spyOn(LLMJudge.prototype, 'gradeBatch').mockImplementation(async function (this: LLMJudge<unknown>, items) {
      return items.map((item) =>
        verdict(item, this.metric, Object.fromEntries(this.dimensions.map((d) => [d, 1]))),
      );
    });

    const { results } = await runCalibration(cases);

    for (const r of results) expect(r.agreed).toBe(cases.find((c) => c.id === r.id)!.expected.isCorrect);
  });
});
