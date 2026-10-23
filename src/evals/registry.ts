import { enrichWithModel } from '../agents/architect/model';
import type { PlanGenerationInput } from '../agents/architect/plan';
import { draftChronicleWithModel } from '../agents/chronicle/model';
import { draftEnvoyWithModel } from '../agents/envoy/model';
import { routeScoutIntakeWithModel } from '../agents/scout/model';
import type { ChronicleInput, EnvoyInput, ScoutRoutingInput } from '../types';
import {
  grade as gradeArchitectPlanStructure,
  gradeWithModel as gradeArchitectPlanStructureWithModel,
} from './graders/heuristic/architectPlanStructure';
import { grade as gradeArchitectScoring } from './graders/heuristic/architectScoring';
import { grade as gradeChronicleReadiness } from './graders/heuristic/chronicleReadiness';
import { grade as gradeEnvoyDraftStructure } from './graders/heuristic/envoyDraftStructure';
import {
  gradeArchitectGrounding,
  gradeChronicleGrounding,
  gradeEnvoyGrounding,
  gradeScoutGrounding,
} from './graders/heuristic/grounding';
import { grade as gradePulseHealth } from './graders/heuristic/pulseHealth';
import {
  grade as gradeScoutRouting,
  gradeWithModel as gradeScoutRoutingWithModel,
} from './graders/heuristic/scoutRouting';
import { ArchitectCharterJudge } from './graders/judges/architectCharter';
import { ChronicleDraftJudge } from './graders/judges/chronicleDraft';
import { EnvoyDraftJudge } from './graders/judges/envoyDraft';
import type { LLMJudge } from './graders/judges/base';
import { ScoutRationaleJudge } from './graders/judges/scoutRationale';
import { summarize } from './metrics/passRate';
import { scheduler } from './scheduler';
import type { EvalCase, GraderResult, MetricSummary } from './types';

/**
 * Central registry of eval metrics — the single wiring point. pipelines/grade.ts
 * and pipelines/report.ts discover enabled metrics HERE; nothing else may
 * hardcode a metric name. To add a metric: write graders/heuristic/<name>.ts
 * (+ optionally graders/judges/<name>.ts) and register it below.
 */

/**
 * `TOutput` ties a judge to its model-output producer: `modelOutput` must return what
 * `judgeCls` judges. `METRICS` holds them erased (`MetricDefinition` = `<unknown>`);
 * `defineMetric()` is where the pairing is type-checked.
 */
export interface MetricDefinition<TOutput = unknown> {
  name: string;
  /** What the metric measures, in the words a stakeholder uses: "Routing accuracy", not `scoutRouting`. */
  displayName: string;
  description: string;
  /**
   * Fixture file stem under fixtures/ (default: `name`). Lets a metric grade another
   * metric's cases — scoutRationale judges the prose of the very intakes scoutRouting
   * exact-matches, rather than keeping a duplicate set that drifts.
   */
  fixture?: string;
  // null for judge-only metrics (e.g. scoutRationale — free-text quality has no
  // meaningful heuristic exact-match).
  heuristic: ((evalCase: EvalCase) => GraderResult) | null;
  judgeCls: (new () => LLMJudge<TOutput>) | null;
  /**
   * The agent's MODEL output for a case, for the judge to grade beside its template
   * output (`source: 'model'` rows). Needs a key; reported, never gated. Omitted when the
   * agent has no model path. `sample` (default 0) is the `EVAL_MODEL_SAMPLES` index: a
   * producer that shares its call keys the share on it, so sample 1 is a fresh call.
   */
  modelOutput?: (evalCase: EvalCase, sample?: number) => Promise<TOutput>;
  // The model-backed path of an agent that also has a deterministic heuristic, graded
  // on the same fixtures (fallback contract: the two are compared, not assumed equal).
  // Needs a key; reported as `model pass`, never gated. Omitted when there is none.
  model?: (evalCase: EvalCase, sample?: number) => Promise<GraderResult>;
  summarize: (results: GraderResult[]) => MetricSummary;
  // targets.yaml key gating this metric in `--gate` runs (template-judge pass-rate when
  // judges ran, heuristic pass-rate otherwise).
  targetsKey: string;
}

const defineMetric = <TOutput>(definition: MetricDefinition<TOutput>): MetricDefinition =>
  definition;

/** The fixture file stem a metric's cases are loaded from. */
export const fixtureName = (definition: MetricDefinition): string => definition.fixture ?? definition.name;

/**
 * Agent model outputs, one paced call per case. Two metrics grade each of these — a
 * heuristic over the structure and a judge over the prose — and share the one output
 * (`scheduler().shared`) rather than each paying for its own call.
 */
const scoutModelOutput = (c: EvalCase, sample = 0) =>
  scheduler().shared(`scout:${c.id}:${sample}`, async () =>
    (await routeScoutIntakeWithModel(c.input as unknown as ScoutRoutingInput)).result,
  );

const architectModelOutput = (c: EvalCase, sample = 0) =>
  scheduler().shared(`architect:${c.id}:${sample}`, async () => {
    const { charter, plan } = await enrichWithModel(c.input as unknown as PlanGenerationInput);
    return { charter, plan };
  });

export const METRICS: Record<string, MetricDefinition> = {
  scoutRouting: {
    name: 'scoutRouting',
    displayName: 'Routing accuracy',
    description: 'Does routeScoutIntake() assign the correct bucket/composite_signal/hitlTier?',
    heuristic: gradeScoutRouting,
    judgeCls: null,
    model: (c, sample) => gradeScoutRoutingWithModel(c, (evalCase) => scoutModelOutput(evalCase, sample)),
    summarize: (results) => summarize('scoutRouting', results),
    targetsKey: 'scout_routing_pass_rate',
  },
  architectScoring: {
    name: 'architectScoring',
    displayName: 'Maturity scoring',
    description: 'Does scoreAssessment() assign the correct maturity level/override/flags?',
    heuristic: gradeArchitectScoring,
    judgeCls: null,
    summarize: (results) => summarize('architectScoring', results),
    targetsKey: 'architect_scoring_pass_rate',
  },
  pulseHealth: {
    name: 'pulseHealth',
    displayName: 'Health status',
    description: 'Does computePulseSignal() assign the correct engagement health status?',
    heuristic: gradePulseHealth,
    judgeCls: null,
    summarize: (results) => summarize('pulseHealth', results),
    targetsKey: 'pulse_health_pass_rate',
  },
  // The structural half of the Architect draft (shape, phase windows, required
  // workstreams, deferred deliverable, structural risks), graded on architectCharter's
  // cases for both paths: buildTemplate() and enrichWithModel().
  architectPlanStructure: {
    name: 'architectPlanStructure',
    displayName: 'Plan structure',
    description: 'Does the plan/charter keep the rubric-fixed structure — shape, phases, required workstreams, structural risks?',
    fixture: 'architectCharter',
    heuristic: gradeArchitectPlanStructure,
    judgeCls: null,
    model: (c, sample) => gradeArchitectPlanStructureWithModel(c, (evalCase) => architectModelOutput(evalCase, sample)),
    summarize: (results) => summarize('architectPlanStructure', results),
    targetsKey: 'architect_plan_structure_pass_rate',
  },
  architectCharter: defineMetric({
    name: 'architectCharter',
    displayName: 'Charter quality',
    description: 'Is the charter grounded, proportionate to assessed maturity, and consistent with the plan?',
    heuristic: null,
    judgeCls: ArchitectCharterJudge,
    modelOutput: architectModelOutput,
    summarize: (results) => summarize('architectCharter', results),
    targetsKey: 'architect_charter_pass_rate',
  }),
  scoutRationale: defineMetric({
    name: 'scoutRationale',
    displayName: 'Rationale quality',
    description: 'Is the routing rationale text accurate, grounded, and clear?',
    fixture: 'scoutRouting',
    heuristic: null,
    judgeCls: ScoutRationaleJudge,
    modelOutput: scoutModelOutput,
    summarize: (results) => summarize('scoutRationale', results),
    targetsKey: 'scout_rationale_pass_rate',
  }),
  // The mechanical half of the Envoy draft, graded on envoyDraft's cases so the template
  // is checked on the very inputs the judge reads. Template path only: the model path
  // is the judge's (`envoyDraft`), reported and never gated.
  envoyDraftStructure: {
    name: 'envoyDraftStructure',
    displayName: 'Email structure',
    description: 'Does the Envoy template echo its input, stay L3, name the partner, and state only the cadence, concerns and consent ask it was given?',
    fixture: 'envoyDraft',
    heuristic: gradeEnvoyDraftStructure,
    judgeCls: null,
    summarize: (results) => summarize('envoyDraftStructure', results),
    targetsKey: 'envoy_draft_structure_pass_rate',
  },
  envoyDraft: defineMetric({
    name: 'envoyDraft',
    displayName: 'Email quality',
    description: 'Is the partner-facing draft grounded, occasion-appropriate, and clear?',
    heuristic: null,
    judgeCls: EnvoyDraftJudge,
    modelOutput: (c) =>
      scheduler().run(async () => (await draftEnvoyWithModel(c.input as unknown as EnvoyInput)).draft),
    summarize: (results) => summarize('envoyDraft', results),
    targetsKey: 'envoy_draft_pass_rate',
  }),
  // Readiness and the no-fabrication contract of the deterministic Chronicle draft, on
  // chronicleDraft's cases. Template path only, as `envoyDraftStructure`.
  chronicleReadiness: {
    name: 'chronicleReadiness',
    displayName: 'Story readiness',
    description: 'Does Chronicle derive the right readiness, write nothing when not_ready, read as provisional when thin, and never state an outcome the input lacks?',
    fixture: 'chronicleDraft',
    heuristic: gradeChronicleReadiness,
    judgeCls: null,
    summarize: (results) => summarize('chronicleReadiness', results),
    targetsKey: 'chronicle_readiness_pass_rate',
  },
  chronicleDraft: defineMetric({
    name: 'chronicleDraft',
    displayName: 'Story quality',
    description: 'Is the impact story grounded and proportionate to what was recorded?',
    heuristic: null,
    judgeCls: ChronicleDraftJudge,
    modelOutput: (c) =>
      scheduler().run(async () => (await draftChronicleWithModel(c.input as unknown as ChronicleInput)).draft),
    summarize: (results) => summarize('chronicleDraft', results),
    targetsKey: 'chronicle_draft_pass_rate',
  }),
  // Groundedness lint (graders/heuristic/grounding.ts): the judge findings of run 1 that a
  // regex can detect, graded on each drafting agent's existing cases, template path only.
  // The judges above keep grading prose; these gate the template at 1.0 so the same
  // inventions cannot return unnoticed.
  chronicleGrounding: {
    name: 'chronicleGrounding',
    displayName: 'Story grounding',
    description: 'Does the Chronicle template claim only outcomes the record holds, tell a thin record as provisional, and avoid stock phrases that assert unrecorded facts?',
    fixture: 'chronicleDraft',
    heuristic: gradeChronicleGrounding,
    judgeCls: null,
    summarize: (results) => summarize('chronicleGrounding', results),
    targetsKey: 'chronicle_grounding_pass_rate',
  },
  envoyGrounding: {
    name: 'envoyGrounding',
    displayName: 'Email grounding',
    description: 'Does the Envoy template sign off as the DSSG team, propose no cause when no concern was supplied, and state no rhythm when no cadence was agreed?',
    fixture: 'envoyDraft',
    heuristic: gradeEnvoyGrounding,
    judgeCls: null,
    summarize: (results) => summarize('envoyGrounding', results),
    targetsKey: 'envoy_grounding_pass_rate',
  },
  architectGrounding: {
    name: 'architectGrounding',
    displayName: 'Plan grounding',
    description: 'Does the Architect template name a workstream on every shape, require only flagged work, promise a recurring report only where the deliverable is a pipeline or dashboard, call a workstream required only when a dimension was flagged, and keep success criteria free of funder, maturity-level and unflagged-dimension promises?',
    fixture: 'architectCharter',
    heuristic: gradeArchitectGrounding,
    judgeCls: null,
    summarize: (results) => summarize('architectGrounding', results),
    targetsKey: 'architect_grounding_pass_rate',
  },
  scoutGrounding: {
    name: 'scoutGrounding',
    displayName: 'Rationale format',
    description: 'Is the fallback rationale written for a reviewer — no rubric arithmetic ("3/3") and no wire field names in the text? A format check only; it does not judge whether the rationale is right.',
    fixture: 'scoutRouting',
    heuristic: gradeScoutGrounding,
    judgeCls: null,
    summarize: (results) => summarize('scoutGrounding', results),
    targetsKey: 'scout_grounding_pass_rate',
  },
};
