import { assessChronicleReadiness, generateChronicleDraft } from "../../../agents/chronicle/draft";
import type { ChronicleInput } from "../../../types/chronicle";
import type { EvalCase, GraderResult } from "../../types";

/**
 * Readiness and the no-fabrication contract of Chronicle's deterministic draft, graded
 * on the `chronicleDraft` cases (registry `fixture: 'chronicleDraft'`). Prose quality is
 * the judge's; this grades what code can check:
 *
 *  - `readiness` equals the fixture's, from `assessChronicleReadiness()` and in the draft
 *  - `not_ready` writes nothing: empty headline, narrative and outcomes
 *  - `thin` reads as provisional
 *  - `outcomes` is empty on every readiness: nothing in `ChronicleInput` records an
 *    achievement, and a success criterion is a definition, not a result (R17; roadmap D46).
 *    The criteria are quoted in the narrative as "Success was defined as: …" instead.
 *  - never an outcome the input does not contain (eval-harness.md's fabricated-claim
 *    contract), and the first objective is lower-cased into "set out to …"
 */

const lowerFirst = (s: string) => `${s.charAt(0).toLowerCase()}${s.slice(1)}`;

export function grade(evalCase: EvalCase): GraderResult {
  const input = evalCase.input as unknown as ChronicleInput;
  const expected = evalCase.expected as { readiness: string };

  const readiness = assessChronicleReadiness(input);
  const draft = generateChronicleDraft(input);

  const dimensions: Record<string, number> = {
    readiness: readiness === expected.readiness && draft.readiness === readiness ? 1 : 0,
    tierL3: draft.hitlTier === "L3" ? 1 : 0,
  };

  const given = new Set([...(input.successCriteria ?? []), ...(input.objectives ?? [])]);
  dimensions.noFabrication = draft.outcomes.every((o) => given.has(o)) ? 1 : 0;

  if (expected.readiness === "not_ready") {
    dimensions.writesNothing =
      draft.headline === "" && draft.narrative === "" && draft.outcomes.length === 0 ? 1 : 0;
  } else {
    dimensions.hasStory = draft.headline !== "" && draft.narrative !== "" ? 1 : 0;
    const first = input.objectives?.[0];
    if (first) dimensions.objectiveLowered = draft.narrative.includes(`set out to ${lowerFirst(first)}`) ? 1 : 0;
  }

  if (expected.readiness === "thin") {
    dimensions.provisional = draft.narrative.toLowerCase().includes("provisional") ? 1 : 0;
  }

  if (expected.readiness === "ready") {
    dimensions.outcomesEmpty = draft.outcomes.length === 0 ? 1 : 0;
    const criteria = input.successCriteria ?? [];
    dimensions.criteriaAsDefinition = criteria.length
      ? draft.narrative.includes(`Success was defined as: ${criteria.join("; ")}.`) ? 1 : 0
      : !draft.narrative.includes("Success was defined as") ? 1 : 0;
  }

  const failed = Object.entries(dimensions).filter(([, v]) => v === 0).map(([k]) => k);
  const isCorrect = failed.length === 0;

  return {
    caseId: evalCase.id,
    metric: "chronicleReadiness",
    grader: "heuristic",
    status: "graded",
    isCorrect,
    score: isCorrect ? 1.0 : 0.0,
    reasoning: isCorrect
      ? `readiness=${readiness}; all checks hold`
      : `readiness=${readiness} (expected ${expected.readiness}); failed: ${failed.join(", ")}`,
    dimensions,
  };
}
