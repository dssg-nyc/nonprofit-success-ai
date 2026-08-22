export type PulseStatus = 'on_track' | 'at_risk' | 'stalled';

export interface PulseInput {
  engagementId: string;
  stage: string;
  /**
   * Null when the engagement has no recorded events at all. This is the common case at
   * launch: migration 0002 creates `engagement_events` but nothing writes to it yet, so
   * absence here means "not observed", never "nothing happened".
   */
  daysSinceLastEvent: number | null;
  daysInStage: number;
  /** True when the most recent event was a `blocker_raised`. */
  lastEventWasBlocker: boolean;
  /** Whether the engagement is linked to an Architect assessment (`assessment_id`). */
  hasPlan: boolean;
}

export interface PulseSignal {
  engagementId: string;
  /** Derived by `computePulseSignal()`, never model-supplied. */
  status: PulseStatus;
  /** Why the status was assigned. Never empty — every branch contributes a reason. */
  reasons: string[];
  daysSinceLastEvent: number | null;
  daysInStage: number;
  hasPlan: boolean;
  /**
   * Constant by construction: Pulse is staff-facing and read-only, so it never needs a
   * human to approve a draft. Kept as an explicit field rather than omitted so the tier
   * is legible at the call site and a future version with an L3 path has somewhere to
   * put it.
   */
  hitlTier: 'L2';
}
