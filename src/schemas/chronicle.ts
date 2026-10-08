import { z } from "zod";

/**
 * Chronicle's wire contract for `/api/chronicle-draft`. `src/types/chronicle.ts` infers
 * its types from these (type-only import).
 */

export const chronicleDraftSchema = z.object({
  engagementId: z.string(),
  /** Derived by `assessChronicleReadiness()`, never model-supplied. */
  readiness: z.enum(["ready", "thin", "not_ready"]),
  headline: z.string(),
  narrative: z.string(),
  outcomes: z.array(z.string()),
  /** Model-proposed causes, grounded in the record; `[]` when it supports none (and from the fallback). */
  successFactors: z.array(z.string().min(1).max(300)).max(10),
  failureFactors: z.array(z.string().min(1).max(300)).max(10),
  /** Constant by construction: impact stories are public-facing and always human-approved. */
  hitlTier: z.literal("L3"),
});

/**
 * The facts a draft is written from. The route builds these from rows read through the
 * caller's client (`api/_engagement.ts`), never from the request body: readiness is
 * derived from `status`, `hasPlan` and `eventCount`, so a caller who could supply them
 * could get a "ready" story for an engagement with nothing in it. Eval fixtures and the
 * agent's tests construct this shape directly.
 */
export const chronicleInputSchema = z.object({
  engagementId: z.string(),
  orgName: z.string().min(1),
  /** Only a completed engagement can be chronicled. */
  status: z.string(),
  /** Whether the engagement links to an Architect assessment. */
  hasPlan: z.boolean(),
  /** How many events were recorded over the engagement's life. */
  eventCount: z.number().int().min(0),
  /** `ArchitectCharter.objectives`, when a plan exists. */
  objectives: z.array(z.string()).optional(),
  /** `ArchitectCharter.successCriteria`, when a plan exists. */
  successCriteria: z.array(z.string()).optional(),
});

/** What the SPA sends: which engagement, and a key. Everything else is read server-side. */
export const chronicleDraftRequestSchema = z.object({
  engagementId: z.guid(),
  /** Client-generated per user action (design-system.md §8.1); a replay returns the original. */
  idempotencyKey: z.string().min(8).max(200),
});

/** Ids are null because a `not_ready` record saves nothing (chronicle.md §1). */
export const chronicleDraftResponseSchema = chronicleDraftSchema.extend({
  /** `fallback` = the model call failed (or was never made) and the deterministic draft was used. */
  source: z.enum(["model", "fallback"]),
  approvalId: z.guid().nullable(),
  draftId: z.guid().nullable(),
  /** The lesson candidate upserted with the draft (0004_drafts); null when nothing was saved. */
  lessonId: z.guid().nullable(),
  runId: z.guid().nullable(),
});
