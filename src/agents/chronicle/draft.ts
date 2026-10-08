import type {
  ChronicleDraft,
  ChronicleInput,
  ChronicleReadiness,
} from "../../types/chronicle";

export const THIN_EVENT_THRESHOLD = 3;

const lowerFirst = (s: string): string =>
  `${s.charAt(0).toLowerCase()}${s.slice(1)}`;

export function assessChronicleReadiness(
  input: ChronicleInput,
): ChronicleReadiness {
  if (input.status !== "completed") return "not_ready";
  if (!input.hasPlan && input.eventCount === 0) return "not_ready";
  if (!input.hasPlan || input.eventCount < THIN_EVENT_THRESHOLD) return "thin";
  return "ready";
}

export function generateChronicleDraft(input: ChronicleInput): ChronicleDraft {
  const readiness = assessChronicleReadiness(input);

  if (readiness === "not_ready") {
    return {
      engagementId: input.engagementId,
      readiness,
      headline: "",
      narrative: "",
      outcomes: [],
      successFactors: [],
      failureFactors: [],
      hitlTier: "L3",
    };
  }

  const objectiveLine = input.objectives?.length
    ? `The work set out to ${lowerFirst(input.objectives[0])}.`
    : null;

  // Criteria are what success would have looked like, not what was achieved: they are
  // stated as the definition, and `outcomes` stays empty (nothing in `ChronicleInput`
  // records an achievement — roadmap D46).
  const criteriaLine = input.successCriteria?.length
    ? `Success was defined as: ${input.successCriteria.join("; ")}.`
    : null;

  const evidenceLine =
    readiness === "thin"
      ? "This account is provisional: little of the engagement was recorded, so it needs review and filling in before it is shared."
      : `The engagement ran to completion with ${input.eventCount} recorded touchpoints along the way.`;

  return {
    engagementId: input.engagementId,
    readiness,
    headline: `Working with ${input.orgName}`,
    narrative: [
      `${input.orgName} completed an engagement with the DSSG volunteer programme.`,
      objectiveLine,
      criteriaLine,
      evidenceLine,
    ]
      .filter((line): line is string => line !== null)
      .join(" "),
    // No achievement is recorded in the input, so none is claimed. A success criterion is
    // a definition, not a result.
    outcomes: [],
    // No evidence to name causes from: the deterministic draft proposes none.
    successFactors: [],
    failureFactors: [],
    hitlTier: "L3",
  };
}
