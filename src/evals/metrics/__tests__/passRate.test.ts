import { describe, expect, it } from 'vitest';
import { laneDimensions, sampleAgreement, summarize } from '../passRate';
import type { GraderResult } from '../../types';

const row = (over: Partial<GraderResult>): GraderResult => ({
  caseId: 'x',
  metric: 'm',
  grader: 'judge',
  status: 'graded',
  isCorrect: true,
  score: 1,
  reasoning: '',
  dimensions: {},
  ...over,
});

describe('laneDimensions', () => {
  it('counts met over carried per dimension, skipping errored rows', () => {
    const dims = laneDimensions([
      row({ dimensions: { grounded: 1, clear: 1 } }),
      row({ dimensions: { grounded: 0, clear: 1 }, isCorrect: false }),
      row({ dimensions: { grounded: 1 } }),
      row({ status: 'errored', dimensions: { grounded: 0, clear: 0 }, isCorrect: false }),
    ]);
    expect(dims).toEqual({ grounded: { passed: 2, graded: 3 }, clear: { passed: 2, graded: 2 } });
  });
});

describe('summarize dimensions', () => {
  it('reports per-lane dimension tallies, lanes with no rows omitted', () => {
    const s = summarize('m', [
      row({ grader: 'heuristic', dimensions: { bucket: 1, tier: 0 }, isCorrect: false }),
      row({ grader: 'heuristic', dimensions: { bucket: 1, tier: 1 } }),
      row({ source: 'template', dimensions: { grounded: 1 } }),
      row({ source: 'model', dimensions: { grounded: 0 }, isCorrect: false }),
    ]);
    expect(s.dimensions).toEqual({
      heuristic: { bucket: { passed: 2, graded: 2 }, tier: { passed: 1, graded: 2 } },
      judge: { grounded: { passed: 1, graded: 1 } },
      modelJudge: { grounded: { passed: 0, graded: 1 } },
    });
    expect(s.dimensions).not.toHaveProperty('model');
    expect(s.agreement).toBeUndefined();
  });
});

describe('sampleAgreement', () => {
  it('is the share of multi-sample cases whose verdicts all agree', () => {
    const agreement = sampleAgreement([
      row({ caseId: 'a', sample: 0, isCorrect: true }),
      row({ caseId: 'a', sample: 1, isCorrect: true }),
      row({ caseId: 'b', sample: 0, isCorrect: true }),
      row({ caseId: 'b', sample: 1, isCorrect: false }),
      // One sample only: not a case that can agree or disagree with itself.
      row({ caseId: 'c', sample: 0, isCorrect: false }),
    ]);
    expect(agreement).toBe(0.5);
  });

  it('is null when no case was sampled twice', () => {
    expect(sampleAgreement([row({ caseId: 'a' }), row({ caseId: 'b' })])).toBeNull();
  });

  it('ignores errored samples: a failed call is not a verdict to agree with', () => {
    const agreement = sampleAgreement([
      row({ caseId: 'a', sample: 0, isCorrect: true }),
      row({ caseId: 'a', sample: 1, status: 'errored', isCorrect: false }),
    ]);
    expect(agreement).toBeNull();
  });
});

describe('summarize over samples', () => {
  const sampled = [
    row({ caseId: 'a', grader: 'model', sample: 0, isCorrect: true }),
    row({ caseId: 'a', grader: 'model', sample: 1, isCorrect: false, score: 0 }),
    row({ caseId: 'b', grader: 'model', sample: 0, isCorrect: false, score: 0 }),
    row({ caseId: 'b', grader: 'model', sample: 1, isCorrect: false, score: 0 }),
    row({ caseId: 'a', source: 'model', sample: 0, isCorrect: true }),
    row({ caseId: 'a', source: 'model', sample: 1, isCorrect: true }),
    row({ caseId: 'b', source: 'model', sample: 0, isCorrect: true }),
    row({ caseId: 'b', source: 'model', sample: 1, isCorrect: false, score: 0 }),
  ];

  it('rates and counts use sample 0 only, so a sampled run compares with a one-sample run', () => {
    const s = summarize('m', sampled);
    expect(s.nModel).toBe(2);
    expect(s.modelPassRate).toBe(0.5);
    expect(s.nModelJudge).toBe(2);
    expect(s.modelJudgePassRate).toBe(1);
  });

  it('reports agreement per model lane when a case has more than one sample', () => {
    expect(summarize('m', sampled).agreement).toEqual({ nSamples: 2, model: 0.5, modelJudge: 0.5 });
  });

  it('rows without a sample index are sample 0', () => {
    const s = summarize('m', [row({ grader: 'model', isCorrect: true }), row({ grader: 'model', caseId: 'y', isCorrect: false, score: 0 })]);
    expect(s.nModel).toBe(2);
    expect(s.agreement).toBeUndefined();
  });
});
