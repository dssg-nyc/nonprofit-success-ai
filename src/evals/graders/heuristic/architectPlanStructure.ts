import { buildTemplate, enrichWithModel } from "../../../agents/architect/model";
import type { PlanGenerationInput } from "../../../agents/architect/plan";
import { WORKSTREAM_DEFS, structuralRiskCount } from "../../../agents/architect/plan";
import { GatewayError } from "../../../model/errors";
import { architectCharterSchema, ninetyDayPlanSchema } from "../../../schemas";
import type { ArchitectCharter, NinetyDayPlan } from "../../../types";
import type { EvalCase, GraderResult } from "../../types";

interface Expected {
  shape: NinetyDayPlan["shape"];
  /** Names of the `required: true` workstreams, in plan order. */
  requiredWorkstreams: string[];
  /** The bucket deliverable's name when one is promised, or null when none is. */
  deliverable: string | null;
  /** Whether the plan defers the deliverable to Phase 2 (remediation_only). */
  phase2Note: boolean;
}

const PHASE_WINDOWS = ["Days 1–30", "Days 31–60", "Days 61–90"] as const;

/**
 * Structural invariants of an Architect draft — the parts architect.md's Rules make
 * code's, not prose: plan shape, the three phase windows, which workstreams are required,
 * whether a deliverable is promised or deferred, and that the structural risks lead the
 * charter's risk list. Free-text quality is architectCharter's judge, not this.
 *
 * Shared by the template grader and the model grader, so the model path is held to the
 * very same fixture expectations: `mergeEnrichment()` is supposed to make every check
 * here model-proof, and this is where that claim is measured rather than assumed.
 */
function compare(
  evalCase: EvalCase,
  draft: { charter: ArchitectCharter; plan: NinetyDayPlan },
  grader: "heuristic" | "model",
): GraderResult {
  const input = evalCase.input as unknown as PlanGenerationInput;
  const expected = evalCase.expected as unknown as Expected;
  const { charter, plan } = draft;

  const schemaValid =
    architectCharterSchema.safeParse(charter).success &&
    ninetyDayPlanSchema.safeParse(plan).success;
  const shapeMatch = plan.shape === expected.shape;
  const phasesValid =
    plan.phases.length === PHASE_WINDOWS.length &&
    plan.phases.every(
      (p, i) =>
        p.window === PHASE_WINDOWS[i] &&
        p.title.trim().length > 0 &&
        p.milestones.length > 0 &&
        p.milestones.every((m) => m.trim().length > 0),
    );
  const required = plan.workstreams.filter((w) => w.required).map((w) => w.name);
  const requiredMatch =
    required.length === expected.requiredWorkstreams.length &&
    required.every((name, i) => name === expected.requiredWorkstreams[i]);
  const optional = plan.workstreams.filter((w) => !w.required).map((w) => w.name);
  const deliverableMatch =
    expected.deliverable === null
      ? optional.length === 0
      : optional.length === 1 && optional[0] === expected.deliverable;
  const workstreamsAgree =
    JSON.stringify(charter.workstreams) === JSON.stringify(plan.workstreams);
  const phase2Match = (plan.phase2Note !== undefined) === expected.phase2Note;

  // The structural risks are the flag-derived ones: a required workstream that stands in
  // for a flagged dimension is named as non-skippable. Data Foundations (zero-flag
  // build_basics) is required too, but is grounded in the plan's phases, not a gap, so
  // it carries no such risk; `requiredMatch` above still holds it to the fixture.
  const nStructural = structuralRiskCount(input.maturity);
  const structural = charter.risks.slice(0, nStructural);
  const flaggedNames = input.maturity.flaggedDimensions.map((d) => WORKSTREAM_DEFS[d].name);
  const risksValid =
    charter.risks.length > 0 &&
    charter.risks.length >= nStructural &&
    (input.maturity.crossCheckFlag === null || structural[0]?.startsWith("CROSS-CHECK: ") === true) &&
    flaggedNames.every((name) => expected.requiredWorkstreams.includes(name)) &&
    flaggedNames.every((name) =>
      structural.some((r) => r.startsWith(`${name} is a required workstream`)),
    );
  const objectivesMatch =
    charter.objectives.length === plan.phases.length &&
    charter.objectives.every((o, i) => o === `${plan.phases[i].window}: ${plan.phases[i].title}`);

  const checks = {
    schemaValid,
    shapeMatch,
    phasesValid,
    requiredMatch,
    deliverableMatch,
    workstreamsAgree,
    phase2Match,
    risksValid,
    objectivesMatch,
  };
  const isCorrect = Object.values(checks).every(Boolean);

  return {
    caseId: evalCase.id,
    metric: "architectPlanStructure",
    grader,
    status: "graded",
    isCorrect,
    score: isCorrect ? 1.0 : 0.0,
    reasoning: [
      `shape=${plan.shape} (expected ${expected.shape})`,
      `required=[${required.join(",")}] (expected [${expected.requiredWorkstreams.join(",")}])`,
      `deliverable=[${optional.join(",")}] (expected ${expected.deliverable ?? "none"})`,
      `phase2Note=${plan.phase2Note !== undefined} (expected ${expected.phase2Note})`,
      ...Object.entries(checks)
        .filter(([, ok]) => !ok)
        .map(([name]) => `FAILED ${name}`),
    ].join(", "),
    dimensions: Object.fromEntries(
      Object.entries(checks).map(([name, ok]) => [name, ok ? 1 : 0]),
    ),
  };
}

/** The deterministic draft — what the handler saves when the model path fails. */
export function grade(evalCase: EvalCase): GraderResult {
  return compare(
    evalCase,
    buildTemplate(evalCase.input as unknown as PlanGenerationInput),
    "heuristic",
  );
}

/**
 * The model-backed draft, on the same fixtures. Needs a key; reported, never gated.
 * `produce` defaults to `enrichWithModel()`; the registry passes one shared with
 * architectCharter, so each case's draft is generated once and graded by both.
 */
export async function gradeWithModel(
  evalCase: EvalCase,
  produce: (evalCase: EvalCase) => Promise<{ charter: ArchitectCharter; plan: NinetyDayPlan }> = (c) =>
    enrichWithModel(c.input as unknown as PlanGenerationInput),
): Promise<GraderResult> {
  try {
    const { charter, plan } = await produce(evalCase);
    return { ...compare(evalCase, { charter, plan }, "model"), output: { charter, plan } };
  } catch (err) {
    const code = err instanceof GatewayError ? err.code : "model_call_failed";
    // `model_call_failed` is the catch-all; the message is the only clue to the cause.
    const detail = err instanceof Error && err.message && err.message !== code ? ` — ${err.message}` : "";
    console.error(`model architectPlanStructure [${evalCase.id}]: errored (${code})`);
    return {
      caseId: evalCase.id,
      metric: "architectPlanStructure",
      grader: "model",
      status: "errored",
      error: code,
      isCorrect: false,
      score: 0,
      reasoning: `model path errored: ${code}${detail}`,
      dimensions: {},
    };
  }
}
