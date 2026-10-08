import type { z } from 'zod';
import type {
  architectCharterSchema,
  architectPlanRequestSchema,
  architectPlanResponseSchema,
  budgetSpeedSchema,
  charterWorkstreamSchema,
  collectionScopeSchema,
  compositeLevelSchema,
  csaAnswersSchema,
  csaFullAnswersSchema,
  csaToolSchema,
  decisionEmpowermentSchema,
  flaggedDimensionSchema,
  integrationFamiliaritySchema,
  maturityResultSchema,
  maturityScoreSchema,
  ninetyDayPhaseSchema,
  ninetyDayPlanSchema,
  ninetyDayPlanShapeSchema,
  qualityConfidenceSchema,
  reportingAutomationSchema,
  staffConfidenceSchema,
  systemIntegrationSchema,
} from '../schemas/architect';
import type { WriteTimestamp } from './domain';
import type { ScoutBucket, ScoutConfidence, ScoutCompositeSignal } from './scout';

// Wire shapes for /api/architect-plan: inferred from src/schemas/architect.ts, never
// hand-written beside it (CLAUDE.md "One definition per shape"). Type-only import, so
// the schemas -> types constant imports do not form a runtime cycle.

export type MaturityScore = z.infer<typeof maturityScoreSchema>;
export type CompositeLevel = z.infer<typeof compositeLevelSchema>;
export type FlaggedDimension = z.infer<typeof flaggedDimensionSchema>;

export type CollectionScope = z.infer<typeof collectionScopeSchema>;
export type SystemIntegration = z.infer<typeof systemIntegrationSchema>;
export type IntegrationFamiliarity = z.infer<typeof integrationFamiliaritySchema>;
export type QualityConfidence = z.infer<typeof qualityConfidenceSchema>;
export type DecisionEmpowerment = z.infer<typeof decisionEmpowermentSchema>;
export type ReportingAutomation = z.infer<typeof reportingAutomationSchema>;
export type StaffConfidence = z.infer<typeof staffConfidenceSchema>;
export type BudgetSpeed = z.infer<typeof budgetSpeedSchema>;
export type CsaTool = z.infer<typeof csaToolSchema>;

/** The nine scored CSA answers. */
export type CsaAnswers = z.infer<typeof csaAnswersSchema>;
/** All eighteen CSA answers, scored and narrative. */
export type CsaFullAnswers = z.infer<typeof csaFullAnswersSchema>;

export type MaturityResult = z.infer<typeof maturityResultSchema>;
export type CharterWorkstream = z.infer<typeof charterWorkstreamSchema>;
export type ArchitectCharter = z.infer<typeof architectCharterSchema>;
export type NinetyDayPlanShape = z.infer<typeof ninetyDayPlanShapeSchema>;
export type NinetyDayPhase = z.infer<typeof ninetyDayPhaseSchema>;
export type NinetyDayPlan = z.infer<typeof ninetyDayPlanSchema>;

export type ArchitectPlanRequest = z.infer<typeof architectPlanRequestSchema>;
export type ArchitectPlanResponse = z.infer<typeof architectPlanResponseSchema>;

export const CSA_OPTIONS = {
  q4_collection_scope: [
    { value: 'systematic', label: 'We collect data systematically across programs' },
    { value: 'partial', label: 'Some programs collect data consistently, others don\'t' },
    { value: 'not_systematic', label: 'Data collection isn\'t systematic yet' },
  ],
  q6_system_integration: [
    { value: 'most_share_auto', label: 'Most of our systems share data automatically' },
    { value: 'some_share', label: 'Some systems connect, but most don\'t' },
    { value: 'own_island', label: 'Every system is its own island' },
  ],
  q7_integration_familiarity: [
    { value: 'very_familiar', label: 'Very familiar — we\'ve connected systems before' },
    { value: 'somewhat_familiar', label: 'Somewhat familiar — we know it\'s possible' },
    { value: 'not_familiar', label: 'Not familiar with system integration at all' },
  ],
  q8_quality_confidence: [
    { value: 'very_confident', label: 'Very confident — our data is accurate and current' },
    { value: 'mixed', label: 'Mixed — some data is reliable, some isn\'t' },
    { value: 'not_confident', label: 'Not very confident / we don\'t track quality' },
  ],
  q11_decision_empowerment: [
    { value: 'anyone_with_access', label: 'Anyone with access to the data can act on it' },
    { value: 'leadership_managers', label: 'Leadership and program managers' },
    { value: 'not_from_data', label: 'Decisions don\'t really get made from data' },
  ],
  q13_reporting_automation: [
    { value: 'mostly_automated', label: 'Mostly automated — reports pull from live data' },
    { value: 'semi_automated', label: 'Semi-automated — some templates, some manual work' },
    { value: 'none_manual', label: 'We don\'t produce regular reports / mostly manual' },
  ],
  q15_staff_confidence: [
    { value: 'dedicated_staff', label: 'We have dedicated staff for data work' },
    { value: 'some_adhoc', label: 'Some comfort — data work happens ad hoc' },
    { value: 'low_comfort', label: 'Low comfort — data work intimidates the team' },
  ],
  q16_budget_speed: [
    { value: 'fast', label: 'Fast — we can approve a new tool within weeks' },
    { value: 'requires_approval', label: 'Requires board/leadership approval cycles' },
    { value: 'case_by_case', label: 'Case-by-case — no real budget process for tools' },
  ],
} as const;

export const CSA_TOOL_OPTIONS: { value: CsaTool; label: string }[] = [
  { value: 'spreadsheets', label: 'Spreadsheets (Excel / Google Sheets)' },
  { value: 'crm_case_tool', label: 'CRM or case-management tool (Salesforce, Apricot, etc.)' },
  { value: 'reporting_analytics', label: 'Dedicated reporting/analytics tool (Tableau, Power BI, Looker)' },
  { value: 'forms_surveys', label: 'Forms / survey tools (Google Forms, SurveyMonkey)' },
  { value: 'accounting', label: 'Accounting software (QuickBooks, etc.)' },
  { value: 'other', label: 'Other' },
];

export interface ArchitectAssessment {
  id: string;
  // handoff (denormalized from the scout intake at create time)
  scoutIntakeId: string;
  org_name: string;
  scoutBucket: ScoutBucket;
  scoutConfidence: ScoutConfidence;
  scoutReadiness: ScoutCompositeSignal;
  // CSA answers — Section 1 (narrative)
  q1_org_context: string;
  q2_org_size: string;
  q3_poc: string;
  // Section 2 — Data Infrastructure
  q4_collection_scope: CollectionScope;
  q5_data_locations: string;
  q6_system_integration: SystemIntegration;
  q7_integration_familiarity: IntegrationFamiliarity;
  q8_quality_confidence: QualityConfidence;
  // Section 3 — Decision Culture
  q9_current_decisions: string;
  q10_wished_decisions: string;
  q11_decision_empowerment: DecisionEmpowerment;
  // Section 4 — Governance
  q12_reporting_to: string;
  q13_reporting_automation: ReportingAutomation;
  // Section 5 — Tooling + Team Capacity
  q14_tools: CsaTool[];
  q15_staff_confidence: StaffConfidence;
  q16_budget_speed: BudgetSpeed;
  // Section 6 — Goals & readiness (narrative, risk-flagging only)
  q17a_wish_list: string;
  q17b_biggest_worry: string;
  q18_past_blockers: string;
  // maturity output
  di_score: MaturityScore;
  gov_score: MaturityScore;
  tooling_score: MaturityScore;
  dc_score: MaturityScore;
  tc_score: MaturityScore;
  points: number;
  compositeLevel: CompositeLevel;
  overrideApplied: boolean;
  flaggedDimensions: FlaggedDimension[];
  remediationOnly: boolean;
  crossCheckFlag: string | null;
  // generated documents
  charter: ArchitectCharter;
  ninetyDayPlan: NinetyDayPlan;
  // meta
  createdBy: string;
  createdByEmail: string;
  createdAt: WriteTimestamp;
  updatedAt: WriteTimestamp;
}
