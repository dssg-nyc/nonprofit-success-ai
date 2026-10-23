import { z } from 'zod';

/**
 * Mirrors evals/models.py: EvalInteraction -> EvalCase, GraderResult, MetricSummary,
 * InteractionReport -> EvalReport. zod (not interfaces) because the JSONL loader must
 * validate fixtures, exactly as pydantic does on the Python side.
 *
 * Deliberate divergence from Python: this repo's first two metrics grade pure
 * deterministic functions (routeScoutIntake, scoreAssessment) against golden fixtures,
 * not recorded conversations — so `input`/`expected` are open records shaped per metric
 * rather than the Python model's fixed conversation fields.
 */

export const evalCaseSchema = z.object({
  id: z.string(),
  input: z.record(z.string(), z.unknown()),
  expected: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()).optional(),
  /** Why the case exists and how its expectation follows from the spec. Read by people, not graders. */
  note: z.string().optional(),
});
export type EvalCase = z.infer<typeof evalCaseSchema>;

/**
 * `grader`: `heuristic` grades the deterministic path, `model` grades the model-backed
 * path of the same agent against the same fixtures, `judge` is an LLM grading prose.
 *
 * `source` (judge rows only): whose prose was judged. `template` is the agent's
 * deterministic output, `model` its model-backed output for the same case — the same
 * judge, rubric and fixtures, so the two rates are directly comparable. Kept as a field
 * rather than a fourth `grader` value because the grader *is* the same; only its input
 * differs. A judge row without one predates the field and reads as `template`.
 *
 * `status: 'errored'` means the grader could not produce a verdict (a judge or model
 * call failed). It is excluded from pass rates and counted separately: an errored case
 * is neither a pass nor a fail, and must never read as either.
 */
export const judgedSourceSchema = z.enum(['template', 'model']);
export type JudgedSource = z.infer<typeof judgedSourceSchema>;

export const graderResultSchema = z.object({
  caseId: z.string(),
  metric: z.string(),
  grader: z.enum(['heuristic', 'judge', 'model']),
  source: judgedSourceSchema.optional(),
  status: z.enum(['graded', 'errored']).default('graded'),
  error: z.string().optional(),
  isCorrect: z.boolean(),
  score: z.number(),
  reasoning: z.string().default(''),
  dimensions: z.record(z.string(), z.number()).default({}),
  /**
   * The output this grader judged or graded, persisted so a reviewer can read the answer
   * beside the verdict (`pipelines/review.ts`). Judge rows: the template or model output
   * for their `source`. `grader: 'model'` rows: the model-path result, when the model call
   * succeeded. Absent on heuristic (template-path) rows — the output is deterministic and
   * regenerable — and on rows from runs before the field existed.
   */
  output: z.unknown().optional(),
  /**
   * Which model sample this row grades (`EVAL_MODEL_SAMPLES`): the agent's model path
   * is called once per sample per case, and every sample is graded. Rates use sample 0
   * only; the others feed `agreement`. Absent (read as 0) on template-path rows and on
   * rows from runs before the field existed.
   */
  sample: z.number().int().nonnegative().optional(),
});
export type GraderResult = z.infer<typeof graderResultSchema>;

/**
 * One hand-labelled output for a judge (`fixtures/judgeCalibration.jsonl`): the judge's
 * template output for `caseId`, with `patch` merged over it (one level deep), and the
 * verdict a careful reader gives it. A run with judges grades every row and reports how
 * often the judge agreed (`pipelines/calibration.ts`) — the judge measured, not the agent.
 */
export const calibrationCaseSchema = z.object({
  id: z.string(),
  /** The judge metric, a `METRICS` key with a `judgeCls`. */
  judge: z.string(),
  /** A case id in that metric's fixture file; the output is built from its template. */
  caseId: z.string(),
  /** Fields to replace on the template output. Absent: the template output itself. */
  patch: z.record(z.string(), z.unknown()).optional(),
  expected: z.object({
    isCorrect: z.boolean(),
    /** Dimensions the reader marks 0. Every other dimension is 1 unless `uncertain`. */
    failed: z.array(z.string()),
    /** Dimensions the reader would not stake a label on; left out of the per-dimension rate. */
    uncertain: z.array(z.string()).optional(),
  }),
  note: z.string().optional(),
});
export type CalibrationCase = z.infer<typeof calibrationCaseSchema>;

export const calibrationResultSchema = z.object({
  id: z.string(),
  judge: z.string(),
  caseId: z.string(),
  expected: calibrationCaseSchema.shape.expected,
  verdict: graderResultSchema,
  /** The judge's `isCorrect` matches the label; null when the judge errored. */
  agreed: z.boolean().nullable(),
  /** Per labelled dimension (not `uncertain`): the judge's 0/1 matches the label. */
  dimensionsAgreed: z.record(z.string(), z.boolean()),
});
export type CalibrationResult = z.infer<typeof calibrationResultSchema>;

export const calibrationSummarySchema = z.object({
  judgeVersion: z.string(),
  nCases: z.number(),
  judges: z.array(
    z.object({
      judge: z.string(),
      n: z.number(),
      nErrored: z.number(),
      /** Share of graded rows whose `isCorrect` matched the label; null when none graded. */
      agreement: z.number().nullable(),
      /** Per dimension: labelled rows and the share the judge matched. */
      dimensions: z.record(z.string(), z.object({ n: z.number(), agreement: z.number().nullable() })),
    }),
  ),
});
export type CalibrationSummary = z.infer<typeof calibrationSummarySchema>;

/** One line of graded.jsonl: every grader's verdict on one case. Written by grade.ts, read by report.ts. */
export const gradedRowSchema = z.object({
  caseId: z.string(),
  metric: z.string(),
  grades: z.array(graderResultSchema),
});
export type GradedRow = z.infer<typeof gradedRowSchema>;

/**
 * `judge*` fields summarise judge rows over the TEMPLATE output — the gated judge rate.
 * `modelJudge*` summarise the same judge over the MODEL output: reported, never gated
 * (a model's prose varies run to run; the gate stays on the deterministic path).
 * `model*` (no "Judge") is the heuristic exact-match over the model path, as before.
 */
/** One lane's dimensions: name → rows that met it / rows that carried it. */
export const laneDimensionsSchema = z.record(z.string(), z.object({ passed: z.number(), graded: z.number() }));
export type LaneDimensions = z.infer<typeof laneDimensionsSchema>;

export const metricSummarySchema = z.object({
  metric: z.string(),
  nHeuristic: z.number(),
  nJudge: z.number(),
  heuristicPassRate: z.number().nullable(),
  judgePassRate: z.number().nullable(),
  judgeMeanScore: z.number().nullable(),
  nJudgeErrored: z.number().default(0),
  nModel: z.number().default(0),
  nModelErrored: z.number().default(0),
  modelPassRate: z.number().nullable().default(null),
  nModelJudge: z.number().default(0),
  nModelJudgeErrored: z.number().default(0),
  modelJudgePassRate: z.number().nullable().default(null),
  modelJudgeMeanScore: z.number().nullable().default(null),
  /**
   * Per lane, per grader dimension: how many graded rows met it (`dimensions[d] === 1`)
   * out of how many carried it. A failing lane rate says nothing about which check
   * failed; this does. Absent in summaries from before the field (R18).
   */
  dimensions: z.record(z.string(), laneDimensionsSchema).optional(),
  /**
   * When the model path was sampled more than once (`EVAL_MODEL_SAMPLES` > 1): per model
   * lane, the share of cases whose every sample reached the same `isCorrect`. The rates
   * above use sample 0 only, so this is where the model's run-to-run noise is read.
   */
  agreement: z
    .object({
      nSamples: z.number(),
      model: z.number().nullable(),
      modelJudge: z.number().nullable(),
    })
    .optional(),
});
export type MetricSummary = z.infer<typeof metricSummarySchema>;

/** What a run was — `pipelines/experiments.ts`. Absent in summaries from before run tracking. */
export const runManifestSchema = z.object({
  /** The run's directory under `reports/output/runs/`, and its key in `experiments/log.jsonl`. */
  id: z.string(),
  /** What this run is testing: `--label` / `EVAL_LABEL`, else the prompt versions measured (`versionLabel()`). */
  label: z.string().nullable(),
  git: z.object({ commit: z.string().nullable(), dirty: z.boolean().nullable() }),
  /** Declared prompt version per agent, plus `judge`. */
  promptVersions: z.record(z.string(), z.string()),
  /** Hash of each prompt's source; null on entries backfilled from before tracking. */
  promptHashes: z.record(z.string(), z.string()).nullable(),
  /** Hash per fixture file — runs are comparable on a metric only when its fixture matches. */
  fixtures: z.record(z.string(), z.string()).nullable(),
  flags: z.object({
    judges: z.boolean(),
    model: z.boolean(),
    gate: z.boolean(),
    /** `--only`: the metrics this run graded. Such a run is scoped, and not a point on the trend. */
    only: z.array(z.string()).optional(),
    /** `EVAL_MODEL_SAMPLES`: model-path calls per case. Absent means one. */
    samples: z.number().optional(),
  }),
  /** Prompts whose source changed under an unchanged version (see `versionDrift`). */
  drift: z.array(z.string()).default([]),
  backfilled: z.boolean().optional(),
});
export type RunManifest = z.infer<typeof runManifestSchema>;

export const evalReportSchema = z.object({
  generatedAt: z.string(),
  nCases: z.number(),
  judgesRan: z.boolean(),
  modelCallsRan: z.boolean().default(false),
  /** The models this run called; null for a path that did not run. Absent in older summaries. */
  models: z.object({ agent: z.string().nullable(), judge: z.string().nullable() }).optional(),
  /** Per-group model-call latency (`pipelines/latency.ts`). Absent in older summaries. */
  latency: z
    .array(
      z.object({
        role: z.enum(['agent', 'judge']),
        agent: z.string(),
        model: z.string(),
        promptVersion: z.string(),
        n: z.number(),
        nFailed: z.number(),
        failures: z.record(z.string(), z.number()),
        p50Ms: z.number(),
        p95Ms: z.number(),
        maxMs: z.number(),
        meanInputTokens: z.number().nullable(),
        meanOutputTokens: z.number().nullable(),
      }),
    )
    .optional(),
  summaries: z.array(metricSummarySchema),
  run: runManifestSchema.optional(),
  /** Judge-vs-hand-label agreement (`pipelines/calibration.ts`). Only when judges ran. */
  calibration: calibrationSummarySchema.optional(),
  /** Template verdicts answered from `graders/judges/cache.ts` vs judged this run. Absent when off. */
  judgeCache: z.object({ hits: z.number(), misses: z.number() }).optional(),
});
export type EvalReport = z.infer<typeof evalReportSchema>;
