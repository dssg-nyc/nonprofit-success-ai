import { scoreAssessment } from "../../../agents/architect/scoring";
import type { CsaScoredAnswers } from "../../../agents/architect/scoring";
import type { ScoutBucket } from "../../../types";
import type { EvalCase, GraderResult } from "../../types";

type ScoreKey = "di_score" | "gov_score" | "tooling_score" | "dc_score" | "tc_score";

/**
 * Exact-match grader against scoreAssessment() — the maturity rubric is a
 * deterministic mechanical scoring, not an LLM call, so golden fixtures carry
 * the known-correct compositeLevel/overrideApplied/flaggedDimensions/remediationOnly.
 *
 * `crossCheckFlag` is graded on presence (`true` = a redirect signal was raised), not
 * text: the rubric decides whether it fires, the sentence is copy. `scores` is optional
 * and names only the dimension scores a case exists to pin (the tooling and team-capacity
 * edges), so a case is not coupled to dimensions it says nothing about.
 */
export function grade(evalCase: EvalCase): GraderResult {
  const input = evalCase.input as unknown as {
    answers: CsaScoredAnswers;
    scoutBucket: ScoutBucket;
  };
  const expected = evalCase.expected as {
    compositeLevel: string;
    overrideApplied: boolean;
    flaggedDimensions: string[];
    remediationOnly: boolean;
    crossCheckFlag: boolean;
    scores?: Partial<Record<ScoreKey, number>>;
  };

  const result = scoreAssessment(input.answers, input.scoutBucket);

  const levelMatch = result.compositeLevel === expected.compositeLevel;
  const overrideMatch = result.overrideApplied === expected.overrideApplied;
  const flagsMatch =
    result.flaggedDimensions.length === expected.flaggedDimensions.length &&
    result.flaggedDimensions.every((f) =>
      expected.flaggedDimensions.includes(f),
    );
  const remediationMatch = result.remediationOnly === expected.remediationOnly;
  const crossCheckRaised = result.crossCheckFlag !== null;
  const crossCheckMatch = crossCheckRaised === expected.crossCheckFlag;
  const scoreMismatches = Object.entries(expected.scores ?? {})
    .filter(([key, want]) => result[key as ScoreKey] !== want)
    .map(([key, want]) => `${key}=${result[key as ScoreKey]} (expected ${want})`);
  const scoresMatch = scoreMismatches.length === 0;
  const isCorrect =
    levelMatch &&
    overrideMatch &&
    flagsMatch &&
    remediationMatch &&
    crossCheckMatch &&
    scoresMatch;

  return {
    caseId: evalCase.id,
    metric: "architectScoring",
    grader: "heuristic",
    status: "graded",
    isCorrect,
    score: isCorrect ? 1.0 : 0.0,
    reasoning: [
      `compositeLevel=${result.compositeLevel} (expected ${expected.compositeLevel})`,
      `overrideApplied=${result.overrideApplied} (expected ${expected.overrideApplied})`,
      `flaggedDimensions=[${result.flaggedDimensions.join(",")}] (expected [${expected.flaggedDimensions.join(",")}])`,
      `remediationOnly=${result.remediationOnly} (expected ${expected.remediationOnly})`,
      `crossCheckFlag=${crossCheckRaised ? "raised" : "none"} (expected ${expected.crossCheckFlag ? "raised" : "none"})`,
      ...scoreMismatches,
    ].join(", "),
    dimensions: {
      levelMatch: levelMatch ? 1 : 0,
      overrideMatch: overrideMatch ? 1 : 0,
      flagsMatch: flagsMatch ? 1 : 0,
      remediationMatch: remediationMatch ? 1 : 0,
      crossCheckMatch: crossCheckMatch ? 1 : 0,
      scoresMatch: scoresMatch ? 1 : 0,
    },
  };
}
