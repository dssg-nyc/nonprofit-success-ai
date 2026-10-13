import type { GraderResult, LaneDimensions, MetricSummary } from '../types';

/** Pass rate over graded results; errored results are not cases with a verdict. */
export function passRate(results: GraderResult[]): number | null {
  const graded = results.filter((r) => r.status !== 'errored');
  if (graded.length === 0) return null;
  return graded.filter((r) => r.isCorrect).length / graded.length;
}

export function meanScore(results: GraderResult[]): number | null {
  const graded = results.filter((r) => r.status !== 'errored');
  if (graded.length === 0) return null;
  return graded.reduce((sum, r) => sum + r.score, 0) / graded.length;
}

const countErrored = (results: GraderResult[]) =>
  results.filter((r) => r.status === 'errored').length;

/** Per dimension over graded rows: met (exactly 1) out of carried. */
export function laneDimensions(results: GraderResult[]): LaneDimensions {
  const out: LaneDimensions = {};
  for (const r of results) {
    if (r.status === 'errored') continue;
    for (const [name, value] of Object.entries(r.dimensions)) {
      const tally = (out[name] ??= { passed: 0, graded: 0 });
      tally.graded += 1;
      if (value === 1) tally.passed += 1;
    }
  }
  return out;
}

/**
 * Share of cases whose every graded sample reached the same `isCorrect`; null when no
 * case has two graded samples. One disagreeing sample is a disagreeing case — the
 * question is whether the model's verdict on a case is stable, not how often.
 */
export function sampleAgreement(results: GraderResult[]): number | null {
  const byCase = new Map<string, boolean[]>();
  for (const r of results) {
    if (r.status === 'errored') continue;
    const verdicts = byCase.get(r.caseId) ?? [];
    verdicts.push(r.isCorrect);
    byCase.set(r.caseId, verdicts);
  }
  const sampled = [...byCase.values()].filter((v) => v.length > 1);
  if (sampled.length === 0) return null;
  return sampled.filter((v) => v.every((x) => x === v[0])).length / sampled.length;
}

const sampleOf = (r: GraderResult): number => r.sample ?? 0;

export function summarize(metric: string, results: GraderResult[]): MetricSummary {
  const forMetric = results.filter((r) => r.metric === metric);
  const heuristic = forMetric.filter((r) => r.grader === 'heuristic');
  const judges = forMetric.filter((r) => r.grader === 'judge');
  // A judge row with no `source` predates the field and judged the template.
  const judge = judges.filter((r) => r.source !== 'model');
  // The model lanes: every sample is graded, but the rates are sample 0's alone — a rate
  // over three samples of each case would be a different (and smoother) number than a
  // one-sample run's, and the runs would no longer compare.
  const modelJudgeSamples = judges.filter((r) => r.source === 'model');
  const modelSamples = forMetric.filter((r) => r.grader === 'model');
  const modelJudge = modelJudgeSamples.filter((r) => sampleOf(r) === 0);
  const model = modelSamples.filter((r) => sampleOf(r) === 0);
  const nSamples = Math.max(0, ...[...modelSamples, ...modelJudgeSamples].map((r) => sampleOf(r) + 1));
  const lanes: [string, GraderResult[]][] = [
    ['heuristic', heuristic],
    ['judge', judge],
    ['modelJudge', modelJudge],
    ['model', model],
  ];
  const dimensions = Object.fromEntries(lanes.filter(([, rows]) => rows.length > 0).map(([lane, rows]) => [lane, laneDimensions(rows)]));
  return {
    metric,
    nHeuristic: heuristic.length,
    nJudge: judge.length,
    heuristicPassRate: passRate(heuristic),
    judgePassRate: passRate(judge),
    judgeMeanScore: meanScore(judge),
    nJudgeErrored: countErrored(judge),
    nModel: model.length,
    nModelErrored: countErrored(model),
    modelPassRate: passRate(model),
    nModelJudge: modelJudge.length,
    nModelJudgeErrored: countErrored(modelJudge),
    modelJudgePassRate: passRate(modelJudge),
    modelJudgeMeanScore: meanScore(modelJudge),
    dimensions,
    ...(nSamples > 1 && {
      agreement: {
        nSamples,
        model: sampleAgreement(modelSamples),
        modelJudge: sampleAgreement(modelJudgeSamples),
      },
    }),
  };
}
