import type {
  ChronicleDraft,
  ChronicleInput,
  ChronicleReadiness,
} from "../../types/chronicle.js";

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

  // The thin marker is the second sentence, not the last: a reviewer who reads two
  // sentences has already learned the record is thin (chronicle.md §1; run 2,
  // 2026-10-08: thin model stories said "provisional" late or not at all).
  const provisionalLine =
    readiness === "thin"
      ? "This account is provisional: little of the engagement was recorded, so it needs review and filling in before it is shared."
      : null;

  // What the team did, in the caller's words and order — never reworded, never extended.
  // Without summaries the count is all the record holds, and only a ready record can
  // stand behind it as evidence.
  const summaries = input.eventSummaries?.filter((s) => s.trim().length > 0) ?? [];
  const activityParagraph =
    summaries.length > 0
      ? `Over ${input.eventCount} recorded touchpoints the team ${summaries.join("; ")}.`
      : readiness === "ready"
        ? `The engagement ran to completion with ${input.eventCount} recorded touchpoints along the way.`
        : null;

  const opening = [
    `${input.orgName} completed an engagement with the DSSG volunteer programme.`,
    provisionalLine,
    objectiveLine,
    criteriaLine,
  ]
    .filter((line): line is string => line !== null)
    .join(" ");

  return {
    engagementId: input.engagementId,
    readiness,
    headline: `Working with ${input.orgName}`,
    narrative:
      activityParagraph === null
        ? opening
        : summaries.length > 0
          ? `${opening}\n\n${activityParagraph}`
          : `${opening} ${activityParagraph}`,
    // No achievement is recorded in the input, so none is claimed. A success criterion is
    // a definition, not a result.
    outcomes: [],
    // No evidence to name causes from: the deterministic draft proposes none.
    successFactors: [],
    failureFactors: [],
    hitlTier: "L3",
  };
}
