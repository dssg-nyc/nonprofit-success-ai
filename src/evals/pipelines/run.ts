/**
 * The per-case grading step, split out of grade.ts so it can be tested: grade.ts runs
 * `main()` on import (it is a CLI entrypoint), so nothing in it can be imported by a test.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureName } from '../registry';
import type { MetricDefinition } from '../registry';
import { evalCaseSchema } from '../types';
import type { EvalCase, GraderResult } from '../types';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = resolve(HERE, '..', 'fixtures');

/** A metric's cases, from `fixtures/<fixture ?? name>.jsonl`; [] when the file is absent. */
export function loadFixtures(definition: MetricDefinition, dir = FIXTURES_DIR): EvalCase[] {
  const path = resolve(dir, `${fixtureName(definition)}.jsonl`);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf-8').split('\n').filter((line) => line.trim().length > 0);
  return lines.map((line) => evalCaseSchema.parse(JSON.parse(line)));
}

export interface RunOptions {
  /** Judges have a key and were not opted out of. */
  judgesRan: boolean;
  /** The agents' model paths run (same key, same opt-out as the judges). */
  modelRan: boolean;
  /**
   * `EVAL_MODEL_SAMPLES`: how many times each case's model path is called (default 1).
   * Every sample is graded and tagged `sample`; the summary's rates use sample 0 and the
   * rest measure agreement. Template paths are deterministic and are never resampled.
   */
  samples?: number;
}

/** The sample indices a run grades: `[0]` by default. */
const sampleIndices = (samples: number | undefined): number[] =>
  Array.from({ length: Math.max(1, Math.floor(samples ?? 1)) }, (_, i) => i);

/**
 * Every grade each case gets, in this order per case: the heuristic (always), the judge
 * over the template output, the judge over the model output (when the metric has a
 * `modelOutput` producer), and the heuristic over the model path (`model`). The
 * model-output judge needs both a judge and a model call, so it runs only when both are
 * enabled.
 *
 * A whole metric at a time, not a case at a time, so the judge can batch: the model
 * outputs are produced first, then every template output and every model output is
 * judged in groups (`LLMJudge.gradeBatch`). Returns one row of grades per case, in
 * `cases` order. With `samples` > 1 the model-path steps repeat per sample index, so a
 * case's row holds one model row and one model-judge row per sample, each tagged.
 */
export async function gradeMetric(
  definition: MetricDefinition,
  cases: EvalCase[],
  { judgesRan, modelRan, samples }: RunOptions,
): Promise<GraderResult[][]> {
  const heuristic = cases.map((evalCase) => (definition.heuristic ? [definition.heuristic(evalCase)] : []));
  const indices = sampleIndices(samples);

  const model: GraderResult[][] = cases.map(() => []);
  if (modelRan && definition.model) {
    for (const sample of indices) {
      for (const [index, evalCase] of cases.entries()) {
        model[index].push({ ...(await definition.model(evalCase, sample)), sample });
      }
    }
  }

  const templateJudge: GraderResult[][] = cases.map(() => []);
  const modelJudge: GraderResult[][] = cases.map(() => []);
  if (judgesRan && definition.judgeCls) {
    const judge = new definition.judgeCls();

    const templateVerdicts = await judge.gradeBatch(
      cases.map((evalCase) => ({ evalCase, output: judge.template(evalCase), source: 'template' as const })),
    );
    templateVerdicts.forEach((result, i) => templateJudge[i].push(result));

    if (modelRan && definition.modelOutput) {
      for (const sample of indices) {
        const produced: Array<{ index: number; output: unknown }> = [];
        for (const [index, evalCase] of cases.entries()) {
          try {
            produced.push({ index, output: await definition.modelOutput(evalCase, sample) });
          } catch (err) {
            modelJudge[index].push({ ...judge.modelOutputErrored(evalCase, err), sample });
          }
        }
        const modelVerdicts = await judge.gradeBatch(
          produced.map(({ index, output }) => ({ evalCase: cases[index], output, source: 'model' as const })),
        );
        modelVerdicts.forEach((result, i) => modelJudge[produced[i].index].push({ ...result, sample }));
      }
    }
  }

  return cases.map((_, i) => [...heuristic[i], ...templateJudge[i], ...modelJudge[i], ...model[i]]);
}

/** One case's grades — `gradeMetric` over a single case. */
export async function gradeCase(
  definition: MetricDefinition,
  evalCase: EvalCase,
  options: RunOptions,
): Promise<GraderResult[]> {
  const [grades] = await gradeMetric(definition, [evalCase], options);
  return grades;
}
