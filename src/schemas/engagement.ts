import { z } from "zod";
import { Constants } from "../lib/database.types";

/**
 * Wire contract for `POST /api/engagement-transition` — lifecycle.md §2. The command is
 * deterministic code, not an agent: no model call, so no model-facing schema.
 * `src/types/engagement.ts` infers its types from these (type-only import).
 */

/** The six stages, in pipeline order (the `engagement_stage` enum). */
export const engagementStageSchema = z.enum(Constants.public.Enums.engagement_stage);

/** `z.guid()` as in `envoy.ts`: seeded fixture ids carry no RFC version nibble. */
export const engagementTransitionRequestSchema = z.object({
  businessId: z.guid(),
  toStage: engagementStageSchema,
  /** Mandatory for a reversal and for the attested `budget_check` move; else optional. */
  reason: z.string().trim().max(2000).optional(),
  /** Client-generated per user action (design-system.md §8.1); a replay returns the original. */
  idempotencyKey: z.string().min(8).max(128),
  /** Free-form supporting facts, stored on the event. Never read as a guard result. */
  evidence: z.record(z.string(), z.unknown()).optional(),
});

export const engagementTransitionResponseSchema = z.object({
  /** The target stage's `engagements` row. */
  engagementId: z.guid(),
  /** Derived server-side; null for the first transition. */
  fromStage: engagementStageSchema.nullable(),
  toStage: engagementStageSchema,
  transitionedAt: z.iso.datetime({ offset: true }),
  eventId: z.guid(),
  /** Set for an L3 transition (`approvals`, entity_type 'transition'); null for L2 / first. */
  approvalId: z.guid().nullable(),
  /** True when the idempotency key had been used and this is the original result. */
  replayed: z.boolean(),
});
