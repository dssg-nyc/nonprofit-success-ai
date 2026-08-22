import type {
  ChronicleDraft,
  ChronicleInput,
  ChronicleReadiness,
} from "../../types/chronicle";

export const THIN_EVENT_THRESHOLD = 3;

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
      hitlTier: "L3",
    };
  }

  const outcomes = input.successCriteria?.length
    ? [...input.successCriteria]
    : (input.objectives ?? []);

  const objectiveLine = input.objectives?.length
    ? `The work set out to ${input.objectives[0].charAt(0).toLowerCase()}${input.objectives[0].slice(1)}.`
    : "The work was scoped with the organisation directly.";

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
      evidenceLine,
    ].join(" "),
    outcomes,
    hitlTier: "L3",
  };
}
