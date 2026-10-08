import type { z } from 'zod';
import type { pulseSignalSchema } from '../schemas/pulse';

export type PulseStatus = PulseSignal['status'];

export interface PulseInput {
  engagementId: string;
  stage: string;
  /**
   * Null when the engagement has no recorded events at all. This is the common case at
   * launch: `engagement_events` (0003_delivery) exists but little writes to it yet, so
   * absence here means "not observed", never "nothing happened".
   */
  daysSinceLastEvent: number | null;
  daysInStage: number;
  /** True when the most recent event was a `blocker_raised`. */
  lastEventWasBlocker: boolean;
  /** Whether the engagement is linked to an Architect assessment (`assessment_id`). */
  hasPlan: boolean;
}

/** Wire shape of `GET /api/pulse-health`; the schema carries the field docs. */
export type PulseSignal = z.infer<typeof pulseSignalSchema>;
