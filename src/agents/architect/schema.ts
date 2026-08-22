import { z } from "zod";
import type {
  BudgetSpeed,
  CollectionScope,
  CsaTool,
  DecisionEmpowerment,
  IntegrationFamiliarity,
  QualityConfidence,
  ReportingAutomation,
  StaffConfidence,
  SystemIntegration,
} from "../../types";

const SCORE = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const csaAnswersSchema = z.object({
  q4_collection_scope: z.enum([
    "systematic",
    "partial",
    "not_systematic",
  ] satisfies readonly CollectionScope[]),
  q6_system_integration: z.enum([
    "own_island",
    "some_share",
    "most_share_auto",
  ] satisfies readonly SystemIntegration[]),
  q7_integration_familiarity: z.enum([
    "not_familiar",
    "somewhat_familiar",
    "very_familiar",
  ] satisfies readonly IntegrationFamiliarity[]),
  q8_quality_confidence: z.enum([
    "not_confident",
    "mixed",
    "very_confident",
  ] satisfies readonly QualityConfidence[]),
  q11_decision_empowerment: z.enum([
    "not_from_data",
    "leadership_managers",
    "anyone_with_access",
  ] satisfies readonly DecisionEmpowerment[]),
  q13_reporting_automation: z.enum([
    "none_manual",
    "semi_automated",
    "mostly_automated",
  ] satisfies readonly ReportingAutomation[]),
  q15_staff_confidence: z.enum([
    "low_comfort",
    "some_adhoc",
    "dedicated_staff",
  ] satisfies readonly StaffConfidence[]),
  q16_budget_speed: z.enum([
    "case_by_case",
    "requires_approval",
    "fast",
  ] satisfies readonly BudgetSpeed[]),
  q14_tools: z.array(
    z.enum([
      "spreadsheets",
      "crm_case_tool",
      "reporting_analytics",
      "forms_surveys",
      "accounting",
      "other",
    ] satisfies readonly CsaTool[]),
  ),
});

export type CsaAnswersPayload = z.infer<typeof csaAnswersSchema>;

export const maturityResultSchema = z.object({
  di_score: SCORE,
  gov_score: SCORE,
  tooling_score: SCORE,
  dc_score: SCORE,
  tc_score: SCORE,
  points: z.number().int(),
  compositeLevel: z.enum(["Foundational", "Developing", "Established"]),
  overrideApplied: z.boolean(),
  flaggedDimensions: z.array(z.enum(["data_infrastructure", "governance"])),
  remediationOnly: z.boolean(),
  crossCheckFlag: z.string().nullable(),
});

export type MaturityResultPayload = z.infer<typeof maturityResultSchema>;

// Runtime schema.parse() in tests covers the contract between
// Zod-inferred types and hand-written interfaces. Compile-time
// Equal<A,B> assertions break with Zod v4's branded internals.
