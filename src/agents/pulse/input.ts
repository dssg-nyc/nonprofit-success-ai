import type { PulseInput } from "../../types/pulse";

export interface EngagementRowForPulse {
  id: string;
  stage: string;
  updated_at: string;
  created_at: string;
  assessment_id: string | null;
}

export interface LatestEventForPulse {
  kind: string;
  created_at: string;
}

const DAY_MS = 86_400_000;

/** Whole days from `from` to `now`, floored and never negative (clock skew). */
function wholeDaysSince(from: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(from).getTime()) / DAY_MS));
}

/**
 * Map an `engagements` row and its latest `engagement_events` row to `PulseInput`.
 * `updated_at` stands in for "entered the current stage": there is no stage-entered
 * column, so a non-stage edit over-reports `daysInStage`. R7's `stage_advanced` event
 * becomes the precise source, and this is the single place to switch.
 */
export function toPulseInput(
  engagement: EngagementRowForPulse,
  latestEvent: LatestEventForPulse | null,
  now: Date,
): PulseInput {
  return {
    engagementId: engagement.id,
    stage: engagement.stage,
    daysSinceLastEvent: latestEvent ? wholeDaysSince(latestEvent.created_at, now) : null,
    daysInStage: wholeDaysSince(engagement.updated_at, now),
    lastEventWasBlocker: latestEvent?.kind === "blocker_raised",
    hasPlan: engagement.assessment_id !== null,
  };
}
