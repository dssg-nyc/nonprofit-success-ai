import { z } from "zod";

/**
 * Envoy's wire contract for `/api/envoy-draft`. The model-facing schema
 * (`agents/envoy/schema.ts` `envoyModelSchema`) is derived from `envoyDraftSchema` there.
 * `src/types/envoy.ts` infers its types from these (type-only import).
 */

export const ENVOY_OCCASIONS = [
  "kickoff",
  "check_in",
  "milestone_reached",
  "at_risk_follow_up",
  "wrap_up",
] as const;

export const envoyDraftSchema = z.object({
  engagementId: z.string(),
  occasion: z.enum(ENVOY_OCCASIONS),
  subject: z.string().min(1),
  body: z.string().min(1),
  /** Constant by construction: every Envoy output is partner-facing and human-approved. */
  hitlTier: z.literal("L3"),
});

/**
 * The facts a draft is written from. `orgName`, `planTitle` and `cadence` are read by the
 * route from rows through the caller's client (`api/_engagement.ts`), never taken from the
 * body, so a draft cannot be addressed to an organisation or a plan that is not the
 * engagement's. `concerns` is the one caller-chosen field (see the request schema).
 */
export const envoyInputSchema = z.object({
  engagementId: z.string(),
  occasion: z.enum(ENVOY_OCCASIONS),
  /** Partner organisation name, used in the salutation. */
  orgName: z.string().min(1),
  /** Charter title, when the engagement has a linked assessment. */
  planTitle: z.string().optional(),
  /** `ArchitectCharter.cadence` — shapes how the draft frames next contact. */
  cadence: z.string().optional(),
  /**
   * For `at_risk_follow_up`, the Pulse reasons behind the signal. Envoy quotes staff-facing
   * context back into a partner-facing draft, so the caller passes only what it is willing
   * to have paraphrased to the partner.
   */
  concerns: z.array(z.string().min(1).max(300)).max(10).optional(),
});

/** `z.guid()` as in `architect.ts`: seeded fixture ids carry no RFC version nibble. */
export const envoyDraftRequestSchema = envoyInputSchema
  .pick({ occasion: true, concerns: true })
  .extend({
    engagementId: z.guid(),
    /** Client-generated per user action (design-system.md §8.1); a replay returns the original. */
    idempotencyKey: z.string().min(8).max(200),
  });

export const envoyDraftResponseSchema = envoyDraftSchema.extend({
  /** `fallback` = the model call failed and the occasion template was saved. */
  source: z.enum(["model", "fallback"]),
  approvalId: z.guid(),
  draftId: z.guid(),
  runId: z.guid().nullable(),
});
