import type {
  PulseInput,
  PulseSignal,
  PulseStatus,
} from "../../types/pulse";

export const STAGE_WINDOW_DAYS: Record<string, number> = {
  initial_meeting: 14,
  budget_check: 21,
  data_ethics_committee: 30,
  scoping: 21,
  hackathon_ready: 45,
  membership: 90,
};

export const STALLED_SILENCE_DAYS = 21;
export const AT_RISK_SILENCE_DAYS = 14;

function stageWindow(stage: string): number | null {
  return STAGE_WINDOW_DAYS[stage] ?? null;
}

export function computePulseSignal(input: PulseInput): PulseSignal {
  const reasons: string[] = [];
  let status: PulseStatus = "on_track";

  const window = stageWindow(input.stage);
  const overdueInStage = window !== null && input.daysInStage > window;

  if (input.daysSinceLastEvent === null) {
    status = "at_risk";
    reasons.push("no recorded activity");
  } else if (input.daysSinceLastEvent >= STALLED_SILENCE_DAYS) {
    status = "stalled";
    reasons.push(`no activity in ${input.daysSinceLastEvent} days`);
  } else if (input.daysSinceLastEvent >= AT_RISK_SILENCE_DAYS) {
    status = "at_risk";
    reasons.push(`no activity in ${input.daysSinceLastEvent} days`);
  }

  if (overdueInStage) {
    status = "stalled";
    reasons.push(
      `in ${input.stage} for ${input.daysInStage} days (expected ${window})`,
    );
  }

  if (input.lastEventWasBlocker) {
    if (status === "on_track") status = "at_risk";
    reasons.push("most recent event was a raised blocker");
  }

  if (!input.hasPlan) {
    reasons.push("no linked assessment to measure against");
  }

  if (reasons.length === 0) {
    reasons.push("recent activity and within the expected stage window");
  }

  return {
    engagementId: input.engagementId,
    status,
    reasons,
    daysSinceLastEvent: input.daysSinceLastEvent,
    daysInStage: input.daysInStage,
    hasPlan: input.hasPlan,
    hitlTier: "L2",
  };
}
