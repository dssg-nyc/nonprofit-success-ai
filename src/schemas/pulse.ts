import { z } from 'zod';

/**
 * Wire shape of `GET /api/pulse-health`. Derived by `computePulseSignal()` — never
 * model-supplied; there is no model call on this path.
 */
export const pulseSignalSchema = z.object({
  engagementId: z.string(),
  /** Derived by `computePulseSignal()`, never model-supplied. */
  status: z.enum(['on_track', 'at_risk', 'stalled']),
  /** Why the status was assigned. Never empty — every branch contributes a reason. */
  reasons: z.array(z.string()),
  /**
   * Null when the engagement has no recorded events: "not observed", never "nothing
   * happened". Required-but-nullable, so a missing key fails validation.
   */
  daysSinceLastEvent: z.number().nullable().nonoptional(),
  daysInStage: z.number(),
  hasPlan: z.boolean(),
  /**
   * Constant by construction: Pulse is staff-facing and read-only, so it never needs a
   * human to approve a draft. Kept explicit so the tier is legible at the call site and
   * a future version with an L3 path has somewhere to put it.
   */
  hitlTier: z.literal('L2'),
  /** ISO timestamp of when the signal was computed. */
  computedAt: z.string().datetime(),
});
