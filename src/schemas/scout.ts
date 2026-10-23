import { z } from "zod";
import { PRIMARY_NEED_OPTIONS, SCOUT_BUCKETS } from "../types";

const SCORE = z.union([z.literal(1), z.literal(2), z.literal(3)]);

/**
 * The Scout routing result as it crosses `/api/route-intake`. The agent's model-facing
 * schema (`agents/scout/schema.ts` `scoutModelSchema`) derives from this one, not the
 * reverse: agents depend on schemas, so schemas must not import agents.
 */
export const scoutResultSchema = z.object({
  bucket: z.enum(SCOUT_BUCKETS).nullable().nonoptional(),
  confidence: z.enum(["High", "Medium", "Low"]).nullable().nonoptional(),
  rationale: z.string(),
  poc_score: SCORE,
  clarity_score: SCORE,
  foothold_score: SCORE,
  composite_signal: z.enum(["Ready", "Conditional", "Not Ready"]),
  flags: z.array(z.string()),
  hitlTier: z.enum(["L2", "L3"]),
});

const PRIMARY_NEEDS = PRIMARY_NEED_OPTIONS.map((o) => o.value) as [string, ...string[]];

/**
 * The applicant's IRS registry record, as `api/_scoutRegistry.ts` reduces a ProPublica
 * organization (`nonprofitDetailSchema`) to what Scout and the reviewer use. Looked up
 * server-side from `org_name` (or the form's optional EIN) before routing; `source` is
 * the provenance the row keeps. Revenue and assets come from the newest extracted
 * filing, else the IRS master file; null when neither has a figure.
 */
export const scoutRegistrySchema = z.object({
  ein: z.string().regex(/^\d{9}$/),
  name: z.string(),
  city: z.string(),
  state: z.string(),
  nteeCode: z.string().nullable(),
  /** 501(c) subsection, e.g. 3 for 501(c)(3). */
  subsectionCode: z.number().nullable(),
  revenue: z.number().nullable(),
  assets: z.number().nullable(),
  /** Tax year of the newest filing ProPublica holds (with or without extracted data). */
  latestFilingYear: z.number().nullable(),
  source: z.literal("propublica"),
});

/**
 * What the lookup found. `matched` is the only status with a record; `skipped` is the
 * column default for rows written before the lookup existed and for demo intakes.
 */
export const scoutRegistryLookupSchema = z.enum([
  "matched",
  "not_found",
  "ambiguous",
  "unavailable",
  "skipped",
]);

/**
 * The whole intake as `/api/route-intake` takes it (0007): the form's fields, which the
 * handler routes and then files through `submit_scout_intake()`. Lengths mirror the
 * column checks in 0001_core so a too-long field is a 400 here, not a 23514 from the RPC.
 * `ScoutRoutingInput` is the subset the routing logic reads.
 */
export const scoutIntakeRequestSchema = z.object({
  org_name: z.string().trim().min(1).max(256),
  contact_name_role: z.string().trim().min(1).max(256),
  contact_email: z.string().trim().min(3).max(256),
  mission: z.string().trim().min(1).max(1000),
  scale: z.string().trim().min(1).max(500),
  primary_need: z.enum(PRIMARY_NEEDS),
  primary_need_other: z.string().trim().max(500).optional(),
  problem_description: z.string().trim().min(1).max(2000),
  current_systems: z.string().trim().min(1).max(500),
  timeline: z.string().trim().min(1).max(500),
  referral_source: z.string().trim().max(256).default(""),
  /** Optional: the org's EIN, dashes allowed. Given, the registry lookup skips the name search. */
  ein: z
    .string()
    .trim()
    .transform((s) => s.replace(/-/g, ""))
    .pipe(z.string().regex(/^\d{9}$/))
    .optional(),
});

/** What the route returns: the routing result as filed, plus the row it created. */
export const scoutIntakeResponseSchema = scoutResultSchema.extend({
  intakeId: z.guid(),
  routingSource: z.enum(["ai", "derived"]),
  /** The registry record filed with the row, and how the lookup went. */
  registry: scoutRegistrySchema.nullable(),
  registryLookup: scoutRegistryLookupSchema,
});

/**
 * `POST /api/scout-approve` — the Scout-approve command (lifecycle.md §4 row 1), one
 * call to `approve_scout_intake()` (0008): review a pending intake (or take one the
 * queue reviewed approved/edited), create the linked business if absent, and open
 * `initial_meeting` through `transition_engagement()` under `idempotencyKey`.
 */
export const scoutApproveRequestSchema = z.object({
  intakeId: z.guid(),
  /** Client-generated per user action (design-system.md §8.1); a replay returns the original. */
  idempotencyKey: z.string().min(8).max(128),
  /** The reviewer's bucket. Omitted keeps Scout's (`approved`); different reviews as `edited`. */
  finalBucket: z.enum(SCOUT_BUCKETS).optional(),
  /** Reviewer notes, saved only when this call performs the review. */
  reviewNotes: z.string().trim().max(2000).optional(),
  businessType: z.enum(["nonprofit", "small_business"]).optional(),
  /** Which organization to file under when the intake has none and the caller administers several. */
  organizationId: z.guid().optional(),
  /**
   * Reopen a declined (`redirected`) intake and approve it (0010). Off, a declined intake is
   * refused with `guard_unmet`; reopening is an explicit act, recorded in the audit row.
   */
  reopen: z.boolean().optional(),
});

export const scoutApproveResponseSchema = z.object({
  intakeId: z.guid(),
  businessId: z.guid(),
  /** False when the intake already had a business (a replay, or a prior partial run). */
  businessCreated: z.boolean(),
  reviewAction: z.enum(["approved", "edited"]),
  finalBucket: z.enum(SCOUT_BUCKETS),
  /** True when this call reopened a declined intake (`reopen` was sent and applied). */
  reopened: z.boolean(),
  /** The `initial_meeting` row `transition_engagement()` opened. */
  engagementId: z.guid(),
  eventId: z.guid(),
  transitionedAt: z.iso.datetime({ offset: true }),
  /** True when the idempotency key had been used and this is the original result. */
  replayed: z.boolean(),
});
