import { z } from "zod";

/**
 * Architect's wire contract for `/api/architect-plan`. The agent's model-facing schema
 * (`agents/architect/schema.ts` `architectEnrichmentSchema`) is separate and prose-only:
 * nothing here is model-supplied. Maturity is the deterministic rubric
 * (`agents/architect/scoring.ts`), and the charter and plan structure come from the
 * templates in `agents/architect/plan.ts`; the model can only reword their prose.
 *
 * `src/types/architect.ts` infers its wire types from these schemas (type-only import),
 * so each shape has exactly one definition.
 */

// ---- CSA answer enums -------------------------------------------------------------

export const collectionScopeSchema = z.enum(["systematic", "partial", "not_systematic"]);
export const systemIntegrationSchema = z.enum(["own_island", "some_share", "most_share_auto"]);
export const integrationFamiliaritySchema = z.enum([
  "not_familiar",
  "somewhat_familiar",
  "very_familiar",
]);
export const qualityConfidenceSchema = z.enum(["not_confident", "mixed", "very_confident"]);
export const decisionEmpowermentSchema = z.enum([
  "not_from_data",
  "leadership_managers",
  "anyone_with_access",
]);
export const reportingAutomationSchema = z.enum([
  "none_manual",
  "semi_automated",
  "mostly_automated",
]);
export const staffConfidenceSchema = z.enum(["low_comfort", "some_adhoc", "dedicated_staff"]);
export const budgetSpeedSchema = z.enum(["case_by_case", "requires_approval", "fast"]);
export const csaToolSchema = z.enum([
  "spreadsheets",
  "crm_case_tool",
  "reporting_analytics",
  "forms_surveys",
  "accounting",
  "other",
]);

// ---- CSA answers ------------------------------------------------------------------

/** The nine answers the maturity rubric scores (architect.md §1). */
export const csaAnswersSchema = z.object({
  q4_collection_scope: collectionScopeSchema,
  q6_system_integration: systemIntegrationSchema,
  q7_integration_familiarity: integrationFamiliaritySchema,
  q8_quality_confidence: qualityConfidenceSchema,
  q11_decision_empowerment: decisionEmpowermentSchema,
  q13_reporting_automation: reportingAutomationSchema,
  // 0001_init.sql caps q14_tools at 8 elements; six distinct values exist.
  q14_tools: z.array(csaToolSchema).max(8),
  q15_staff_confidence: staffConfidenceSchema,
  q16_budget_speed: budgetSpeedSchema,
});

/**
 * All eighteen CSA answers: the nine scored ones plus the narrative inputs. The length
 * caps mirror the `architect_assessments` check constraints (0001_init.sql), so a value
 * that passes here cannot fail the insert on length.
 */
export const csaFullAnswersSchema = csaAnswersSchema.extend({
  q1_org_context: z.string().max(2000),
  q2_org_size: z.string().max(500),
  q3_poc: z.string().max(256),
  q5_data_locations: z.string().max(1000),
  q9_current_decisions: z.string().max(2000),
  q10_wished_decisions: z.string().max(2000),
  q12_reporting_to: z.string().max(1000),
  q17a_wish_list: z.string().max(2000),
  q17b_biggest_worry: z.string().max(2000),
  q18_past_blockers: z.string().max(2000),
});

// ---- Maturity ---------------------------------------------------------------------

export const maturityScoreSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export const compositeLevelSchema = z.enum(["Foundational", "Developing", "Established"]);
export const flaggedDimensionSchema = z.enum(["data_infrastructure", "governance"]);

export const maturityResultSchema = z.object({
  di_score: maturityScoreSchema,
  gov_score: maturityScoreSchema,
  tooling_score: maturityScoreSchema,
  dc_score: maturityScoreSchema,
  tc_score: maturityScoreSchema,
  points: z.number().int(),
  compositeLevel: compositeLevelSchema,
  overrideApplied: z.boolean(),
  flaggedDimensions: z.array(flaggedDimensionSchema),
  remediationOnly: z.boolean(),
  crossCheckFlag: z.string().nullable(),
});

// ---- Charter + 90-day plan --------------------------------------------------------

export const charterWorkstreamSchema = z.object({
  name: z.string(),
  required: z.boolean(),
  description: z.string(),
});

export const architectCharterSchema = z.object({
  title: z.string(),
  background: z.string(),
  scopeStatement: z.string(),
  objectives: z.array(z.string()),
  workstreams: z.array(charterWorkstreamSchema),
  risks: z.array(z.string()),
  successCriteria: z.array(z.string()),
  cadence: z.string(),
});

export const ninetyDayPlanShapeSchema = z.enum([
  "build_basics",
  "ship_deliverable",
  "remediation_only",
  "accelerate",
]);

export const PHASE_WINDOWS = ["Days 1–30", "Days 31–60", "Days 61–90"] as const;

export const ninetyDayPhaseSchema = z.object({
  window: z.enum(PHASE_WINDOWS),
  title: z.string(),
  milestones: z.array(z.string()),
});

export const ninetyDayPlanSchema = z.object({
  shape: ninetyDayPlanShapeSchema,
  headline: z.string(),
  // Every shape is three phases (architect.md §3); the wire rejects anything else.
  phases: z.array(ninetyDayPhaseSchema).length(PHASE_WINDOWS.length),
  workstreams: z.array(charterWorkstreamSchema),
  phase2Note: z.string().optional(),
});

// ---- /api/architect-plan ----------------------------------------------------------

/**
 * `z.guid()`, not `z.uuid()`: v4's `uuid()` enforces the RFC version nibble, which the
 * seeded fixture ids (`cccccccc-0000-0000-0000-000000000001`) do not carry.
 */
export const architectPlanRequestSchema = z.object({
  scoutIntakeId: z.guid(),
  /** Client-generated per user action (design-system.md §8.1); a replay returns the original. */
  idempotencyKey: z.string().min(8).max(200),
  answers: csaFullAnswersSchema,
});

export const architectPlanResponseSchema = z.object({
  maturity: maturityResultSchema,
  charter: architectCharterSchema,
  plan: ninetyDayPlanSchema,
  /** Architect is always L3 (`guardrails/hitl.ts`): the draft waits on staff approval. */
  hitlTier: z.literal("L3"),
  approvalId: z.guid(),
  /** `fallback` = the model call failed and the deterministic template was saved. */
  source: z.enum(["model", "fallback"]),
  runId: z.guid().nullable(),
});
