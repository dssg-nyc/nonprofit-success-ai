import {
  ArchitectAssessment,
  CompositeLevel,
  FlaggedDimension,
  MaturityScore,
  ScoutBucket,
} from "../../types";

export type CsaScoredAnswers = Pick<
  ArchitectAssessment,
  | "q4_collection_scope"
  | "q6_system_integration"
  | "q7_integration_familiarity"
  | "q8_quality_confidence"
  | "q11_decision_empowerment"
  | "q13_reporting_automation"
  | "q14_tools"
  | "q15_staff_confidence"
  | "q16_budget_speed"
>;

export interface MaturityResult {
  di_score: MaturityScore;
  gov_score: MaturityScore;
  tooling_score: MaturityScore;
  dc_score: MaturityScore;
  tc_score: MaturityScore;
  points: number;
  compositeLevel: CompositeLevel;
  overrideApplied: boolean;
  flaggedDimensions: FlaggedDimension[];
  remediationOnly: boolean;
  crossCheckFlag: string | null;
}

function scoreDataInfrastructure(a: CsaScoredAnswers): MaturityScore {
  if (
    a.q4_collection_scope === "not_systematic" ||
    a.q6_system_integration === "own_island" ||
    a.q8_quality_confidence === "not_confident"
  )
    return 1;
  if (
    a.q6_system_integration === "most_share_auto" &&
    a.q8_quality_confidence === "very_confident" &&
    a.q7_integration_familiarity === "very_familiar"
  )
    return 3;
  return 2;
}

function scoreGovernance(a: CsaScoredAnswers): MaturityScore {
  switch (a.q13_reporting_automation) {
    case "mostly_automated":
      return 3;
    case "semi_automated":
      return 2;
    default:
      return 1;
  }
}

function scoreTooling(a: CsaScoredAnswers): MaturityScore {
  const hasCrm = a.q14_tools.includes("crm_case_tool");
  const hasReporting = a.q14_tools.includes("reporting_analytics");
  if (hasCrm && hasReporting) return 3;
  if (hasCrm || hasReporting) return 2;
  return 1;
}

function scoreDecisionCulture(a: CsaScoredAnswers): MaturityScore {
  switch (a.q11_decision_empowerment) {
    case "anyone_with_access":
      return 3;
    case "leadership_managers":
      return 2;
    default:
      return 1;
  }
}

function scoreTeamCapacity(a: CsaScoredAnswers): MaturityScore {
  if (
    a.q15_staff_confidence === "low_comfort" &&
    a.q16_budget_speed === "case_by_case"
  )
    return 1;
  if (
    a.q15_staff_confidence === "dedicated_staff" &&
    a.q16_budget_speed === "fast"
  )
    return 3;
  return 2;
}

function bandFromPoints(points: number): CompositeLevel {
  if (points >= 17) return "Established";
  if (points >= 12) return "Developing";
  return "Foundational";
}

export function scoreAssessment(
  answers: CsaScoredAnswers,
  scoutBucket: ScoutBucket,
): MaturityResult {
  const di_score = scoreDataInfrastructure(answers);
  const gov_score = scoreGovernance(answers);
  const tooling_score = scoreTooling(answers);
  const dc_score = scoreDecisionCulture(answers);
  const tc_score = scoreTeamCapacity(answers);

  const points =
    2 * di_score + 2 * gov_score + tooling_score + dc_score + tc_score;
  let compositeLevel = bandFromPoints(points);

  let overrideApplied = false;
  if (di_score === 1 && compositeLevel === "Established") {
    compositeLevel = "Developing";
    overrideApplied = true;
  }

  const flaggedDimensions: FlaggedDimension[] = [];
  if (di_score === 1) flaggedDimensions.push("data_infrastructure");
  if (gov_score === 1) flaggedDimensions.push("governance");

  const remediationOnly = flaggedDimensions.length >= 2;

  const crossCheckFlag =
    compositeLevel === "Foundational" && scoutBucket === "ML / Predictive"
      ? "Foundational maturity vs. ML / Predictive bucket — redirect this engagement before chartering, don't chart around it."
      : null;

  return {
    di_score,
    gov_score,
    tooling_score,
    dc_score,
    tc_score,
    points,
    compositeLevel,
    overrideApplied,
    flaggedDimensions,
    remediationOnly,
    crossCheckFlag,
  };
}

export const DIMENSION_LABELS: {
  key: keyof MaturityResult;
  label: string;
  weight: number;
}[] = [
  { key: "di_score", label: "Data Infrastructure", weight: 2 },
  { key: "gov_score", label: "Governance", weight: 2 },
  { key: "tooling_score", label: "Tooling", weight: 1 },
  { key: "dc_score", label: "Decision Culture", weight: 1 },
  { key: "tc_score", label: "Team Capacity", weight: 1 },
];

export const LEVEL_NAMES: Record<MaturityScore, string> = {
  1: "Foundational",
  2: "Developing",
  3: "Established",
};
