import type { PlanGenerationInput } from "../../../agents/architect/plan";
import { BUCKET_DELIVERABLES, DATA_FOUNDATIONS, WORKSTREAM_DEFS } from "../../../agents/architect/plan";
import { buildTemplate } from "../../../agents/architect/model";
import { generateChronicleDraft } from "../../../agents/chronicle/draft";
import { SIGN_OFF, generateEnvoyDraft } from "../../../agents/envoy/draft";
import { routeScoutIntake } from "../../../agents/scout/routing";
import type {
  ArchitectCharter,
  ChronicleDraft,
  ChronicleInput,
  EnvoyDraft,
  EnvoyInput,
  ScoutResult,
  ScoutRoutingInput,
} from "../../../types";
import type { EvalCase, GraderResult } from "../../types";

/**
 * Groundedness lint for the three drafting agents' template paths — the judge findings
 * of eval run 1 (2026-10-08) that a regex can detect, made deterministic and gated at 1.0
 * (eval-harness.md Rules: "A judge finding that a regex can detect becomes a heuristic
 * grader"). The judge keeps grading prose; this keeps the template from re-learning the
 * same inventions:
 *
 *  - a stock phrase that asserts a fact the input never gave ("scoped with the
 *    organisation directly", "on our end"), a sign-off in an agent's name, rubric
 *    arithmetic ("clarity 2/3") or a field name in prose (`BANNED_TEMPLATE_PHRASES`);
 *  - Chronicle: an outcome absent from the success criteria and objectives, a thin record
 *    told as achieved, a not_ready record with any text;
 *  - Envoy: a proposed cause when no concern was supplied, a rhythm when no cadence was
 *    agreed, any sign-off but `SIGN_OFF`;
 *  - Architect: a required workstream that traces to no flagged dimension, an empty
 *    workstream list, a success criterion promising funders, a maturity level, or a
 *    dimension that was not flagged.
 *
 * Run 2 (2026-10-08, R18) added the next set, each a judge finding on the model path that
 * the template could also regress into:
 *
 *  - Architect: a criterion promising a pipeline or a recurring report on a bucket whose
 *    deliverable is a roadmap or a model (8 of 11 charter failures); prose calling a
 *    workstream "required" when the assessment flagged nothing — the prose, not
 *    `workstreams[].required`, since Data Foundations legitimately stands in as required
 *    on a zero-flag Foundational shape;
 *  - Chronicle: a completed engagement told as beginning ("began", "is starting"); a thin
 *    record whose provisional marker comes later than the second sentence;
 *  - Scout: rubric arithmetic ("3/3") in the rationale — the scores live in the structured
 *    fields beside it, and the prompt says never to quote one.
 *
 * Each check returns binary dimensions; the `grade*` wrappers turn them into the
 * `GraderResult` the registry expects. Adding a phrase to the deny-list is one line and
 * one test (`__tests__/grounding.test.ts`).
 */

/** Phrases no template may emit: each asserts something the input did not say. */
export const BANNED_TEMPLATE_PHRASES: readonly RegExp[] = [
  /scoped with the organisation directly/i,
  /on our end/i,
  /\b(warm|kind|best) regards,\s*(envoy|scout|architect|chronicle|pulse)\b/i,
  // Rubric arithmetic leaking into prose: "(clarity 2/3)".
  /\(\w+ \d\/3\)/,
  // Wire field names leaking into prose.
  /\bcomposite_signal\b|\bhitlTier\b/,
];

/** The first banned phrase `text` contains, as its source, or null. */
export function bannedPhrase(text: string): string | null {
  const hit = BANNED_TEMPLATE_PHRASES.find((re) => re.test(text));
  return hit ? hit.source : null;
}

const PROVISIONAL = /provisional|needs review|set out to|aimed to/i;
/** The thin marker a reviewer must meet within two sentences (chronicle.md §1). */
const PROVISIONAL_MARKER = /provisional|needs review/i;
/** A completed engagement told as starting. */
const BEGINNING = /\b(began|begins|is starting)\b/i;
/** A score quoted as rubric arithmetic: "3/3", "1 / 3". */
const SCORE_ARITHMETIC = /\d\s*\/\s*3\b/;
/** A criterion that presumes a pipeline deliverable. */
const PIPELINE_CRITERION = /\bpipeline\b|recurring report/i;
/** Prose that calls a workstream required: "the required Data Foundations workstream", "a required workstream". */
const REQUIRED_WORKSTREAM_PROSE = /\brequired\b[^.;]{0,60}\bworkstreams?\b/i;
/** Deliverable kinds a pipeline criterion may describe. */
const PIPELINE_KINDS = new Set(["pipeline", "dashboard"]);
const PROPOSED_CAUSE = /(^|[.!?]\s+)(we may have|we noticed)\b/i;
const RHYTHM = /every (week|two weeks|month)|weekly|biweekly|monthly/i;
const DIMENSION_WORDS: Record<keyof typeof WORKSTREAM_DEFS, RegExp> = {
  data_infrastructure: /data infrastructure/i,
  governance: /governance/i,
};

/** The first `n` sentences of `text`, split on terminal punctuation. */
export function firstSentences(text: string, n: number): string {
  return text
    .trim()
    .split(/(?<=[.!?])\s+/)
    .slice(0, n)
    .join(" ");
}

export function chronicleGrounding(
  input: ChronicleInput,
  draft: ChronicleDraft,
): Record<string, number> {
  const text = [draft.headline, draft.narrative, ...draft.outcomes].join("\n");
  const given = new Set([...(input.successCriteria ?? []), ...(input.objectives ?? [])]);
  const dimensions: Record<string, number> = {
    noBannedPhrase: bannedPhrase(text) === null ? 1 : 0,
    outcomesTraceToInput: draft.outcomes.every((o) => given.has(o)) ? 1 : 0,
  };
  if (input.status === "completed" && draft.narrative !== "") {
    dimensions.completedNotBeginning = BEGINNING.test(draft.narrative) ? 0 : 1;
  }
  if (draft.readiness === "thin") {
    dimensions.thinIsProvisional = PROVISIONAL.test(draft.narrative) ? 1 : 0;
    dimensions.thinProvisionalEarly = PROVISIONAL_MARKER.test(firstSentences(draft.narrative, 2)) ? 1 : 0;
    dimensions.thinClaimsNoOutcome = draft.outcomes.length === 0 ? 1 : 0;
  }
  if (draft.readiness === "not_ready") {
    dimensions.notReadyIsEmpty =
      draft.headline === "" && draft.narrative === "" && draft.outcomes.length === 0 ? 1 : 0;
  }
  return dimensions;
}

export function envoyGrounding(input: EnvoyInput, draft: EnvoyDraft): Record<string, number> {
  const body = draft.body;
  const dimensions: Record<string, number> = {
    noBannedPhrase: bannedPhrase(`${draft.subject}\n${body}`) === null ? 1 : 0,
    signOff: body.endsWith(SIGN_OFF) ? 1 : 0,
  };
  if (input.occasion === "at_risk_follow_up" && !input.concerns?.length) {
    dimensions.noProposedCause = PROPOSED_CAUSE.test(body) ? 0 : 1;
  }
  if (!input.cadence) {
    dimensions.noInventedRhythm = RHYTHM.test(body) ? 0 : 1;
  }
  return dimensions;
}

export function architectGrounding(
  input: PlanGenerationInput,
  charter: ArchitectCharter,
): Record<string, number> {
  const flagged = input.maturity.flaggedDimensions;
  const allowedRequired = new Set(flagged.map((d) => WORKSTREAM_DEFS[d].name));
  // The default build_basics workstream is grounded in the plan's own phases, but only
  // stands in when nothing was flagged.
  if (flagged.length === 0) allowedRequired.add(DATA_FOUNDATIONS.name);
  const unflagged = (Object.keys(DIMENSION_WORDS) as (keyof typeof DIMENSION_WORDS)[]).filter(
    (d) => !flagged.includes(d),
  );
  const criteria = charter.successCriteria;
  const prose = [charter.background, charter.scopeStatement, ...charter.objectives, ...charter.risks, ...criteria].join("\n");
  const deliverableKind = BUCKET_DELIVERABLES[input.bucket].kind;
  return {
    noBannedPhrase:
      bannedPhrase([charter.background, charter.scopeStatement, ...charter.objectives, ...criteria].join("\n")) ===
      null
        ? 1
        : 0,
    // Only a pipeline or a dashboard produces a recurring report; a roadmap or a model
    // promised one is the deliverable of another bucket.
    criteriaMatchDeliverable:
      !PIPELINE_KINDS.has(deliverableKind) && criteria.some((c) => PIPELINE_CRITERION.test(c)) ? 0 : 1,
    // "Required" in the prose is a claim that the assessment flagged something.
    requiredProseOnlyWhenFlagged: flagged.length === 0 && REQUIRED_WORKSTREAM_PROSE.test(prose) ? 0 : 1,
    requiredTraceToFlags: charter.workstreams
      .filter((w) => w.required)
      .every((w) => allowedRequired.has(w.name))
      ? 1
      : 0,
    hasWorkstreams: charter.workstreams.length > 0 ? 1 : 0,
    criteriaPromiseNoFunders: criteria.some((c) => /funders/i.test(c)) ? 0 : 1,
    criteriaPromiseNoLevel: criteria.some((c) => /Developing level/i.test(c)) ? 0 : 1,
    criteriaNameOnlyFlagged: criteria.some((c) => unflagged.some((d) => DIMENSION_WORDS[d].test(c))) ? 0 : 1,
  };
}

const EXCERPT_WORDS = 14;

/**
 * The rationale with the intake's own words removed: every field it quotes verbatim, and
 * the opening words of each (the template's `excerpt()` quotes the first fourteen). The
 * lint judges what the template says, not what the applicant wrote — the adversarial
 * routing cases plant `hitlTier` and `composite_signal` in `current_systems`, and a
 * rationale that quotes that field is grounded in the intake, not leaking a wire name.
 */
function withoutIntakeQuotes(input: ScoutRoutingInput, rationale: string): string {
  let text = rationale;
  // The registry name is upstream data the rationale names verbatim ("IRS records list
  // …", R19), so it is material like the form fields, not the template's own words.
  const quoted = [...Object.values(input), input.registry?.name];
  for (const value of quoted) {
    if (typeof value !== "string" || value.trim().length === 0) continue;
    const trimmed = value.trim();
    const opening = trimmed.split(/\s+/).slice(0, EXCERPT_WORDS).join(" ");
    text = text.split(trimmed).join("").split(opening).join("");
  }
  return text;
}

export function scoutGrounding(input: ScoutRoutingInput, result: ScoutResult): Record<string, number> {
  const own = withoutIntakeQuotes(input, result.rationale);
  return {
    noBannedPhrase: bannedPhrase(own) === null ? 1 : 0,
    noScoreArithmetic: SCORE_ARITHMETIC.test(own) ? 0 : 1,
  };
}

function toResult(evalCase: EvalCase, metric: string, dimensions: Record<string, number>): GraderResult {
  const failed = Object.entries(dimensions)
    .filter(([, v]) => v === 0)
    .map(([k]) => k);
  const isCorrect = failed.length === 0;
  return {
    caseId: evalCase.id,
    metric,
    grader: "heuristic",
    status: "graded",
    isCorrect,
    score: isCorrect ? 1.0 : 0.0,
    reasoning: isCorrect ? "every grounding check holds" : `failed: ${failed.join(", ")}`,
    dimensions,
  };
}

export function gradeChronicleGrounding(evalCase: EvalCase): GraderResult {
  const input = evalCase.input as unknown as ChronicleInput;
  return toResult(evalCase, "chronicleGrounding", chronicleGrounding(input, generateChronicleDraft(input)));
}

export function gradeEnvoyGrounding(evalCase: EvalCase): GraderResult {
  const input = evalCase.input as unknown as EnvoyInput;
  return toResult(evalCase, "envoyGrounding", envoyGrounding(input, generateEnvoyDraft(input)));
}

export function gradeArchitectGrounding(evalCase: EvalCase): GraderResult {
  const input = evalCase.input as unknown as PlanGenerationInput;
  return toResult(evalCase, "architectGrounding", architectGrounding(input, buildTemplate(input).charter));
}

export function gradeScoutGrounding(evalCase: EvalCase): GraderResult {
  const input = evalCase.input as unknown as ScoutRoutingInput;
  return toResult(evalCase, "scoutGrounding", scoutGrounding(input, routeScoutIntake(input)));
}
