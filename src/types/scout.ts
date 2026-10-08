import type { z } from 'zod';
import type {
  scoutApproveRequestSchema,
  scoutApproveResponseSchema,
  scoutIntakeRequestSchema,
  scoutIntakeResponseSchema,
  scoutResultSchema,
} from '../schemas/scout';
import type { WriteTimestamp } from './domain';

export const SCOUT_BUCKETS = [
  'Data Infrastructure',
  'Analytics & Insight',
  'ML / Predictive',
  'Tooling & Automation',
  'Advisory / Strategy',
] as const;
export type ScoutBucket = typeof SCOUT_BUCKETS[number];

export const PRIMARY_NEED_OPTIONS: { value: PrimaryNeed; label: string }[] = [
  { value: 'analyze_data', label: 'We have data and want help analyzing it' },
  { value: 'build_tool', label: 'We need help building a tool, dashboard, or workflow' },
  { value: 'ml_predictive', label: 'We want to build a predictive model or use machine learning' },
  { value: 'organize_data', label: "We have data but it's a mess and we need help organizing it" },
  { value: 'strategy_guidance', label: "We're not sure where to start — we need guidance on our data strategy" },
  { value: 'something_else', label: 'Something else' },
];

export type PrimaryNeed =
  | 'analyze_data'
  | 'build_tool'
  | 'ml_predictive'
  | 'organize_data'
  | 'strategy_guidance'
  | 'something_else';

export type ScoutConfidence = 'High' | 'Medium' | 'Low' | null;
export type ScoutCompositeSignal = 'Ready' | 'Conditional' | 'Not Ready';
export type ScoutHitlTier = 'L2' | 'L3';
export type ScoutReviewStatus = 'pending' | 'reviewed';
export type ScoutReviewAction = 'approved' | 'edited' | 'redirected';

export interface ScoutRoutingInput {
  scale: string;
  primary_need: PrimaryNeed;
  primary_need_other?: string;
  problem_description: string;
  current_systems: string;
  contact_name_role: string;
  timeline: string;
}

/**
 * The routing result, inferred from its wire schema — one definition, so the type and
 * the runtime check on `/api/route-intake` cannot drift. Type-only imports: `schemas/`
 * imports `SCOUT_BUCKETS` from here at runtime, so a value import back would be a cycle.
 */
export type ScoutResult = z.infer<typeof scoutResultSchema>;

/** The form as posted to `/api/route-intake` — the route's input, validated server-side. */
export type ScoutIntakeRequest = z.input<typeof scoutIntakeRequestSchema>;
/** The route's reply: the result as filed (tier derived by `submit_scout_intake`) plus the row id. */
export type ScoutIntakeResponse = z.infer<typeof scoutIntakeResponseSchema>;

/** `POST /api/scout-approve` — the Scout-approve command's input (lifecycle.md §4 row 1). */
export type ScoutApproveRequest = z.input<typeof scoutApproveRequestSchema>;
/** Its reply: the review as filed, the linked business and the `initial_meeting` transition. */
export type ScoutApproveResponse = z.infer<typeof scoutApproveResponseSchema>;

export interface ScoutIntake {
  id: string;
  // intake fields (Tally-equivalent, public write-once)
  org_name: string;
  contact_name_role: string;
  contact_email: string;
  mission: string;
  scale: string;
  primary_need: PrimaryNeed;
  primary_need_other?: string;
  problem_description: string;
  current_systems: string;
  timeline: string;
  referral_source: string;
  submittedAt: WriteTimestamp;
  // scout output fields (public write-once, computed at submit time)
  bucket: ScoutBucket | null;
  confidence: ScoutConfidence;
  rationale: string;
  poc_score: 1 | 2 | 3;
  clarity_score: 1 | 2 | 3;
  foothold_score: 1 | 2 | 3;
  composite_signal: ScoutCompositeSignal;
  flags: string[];
  hitlTier: ScoutHitlTier;
  // review fields (admin-only, written via update)
  reviewStatus: ScoutReviewStatus;
  reviewAction?: ScoutReviewAction;
  finalBucket?: ScoutBucket;
  reviewedBy?: string;
  reviewedByEmail?: string;
  reviewedAt?: WriteTimestamp;
  reviewNotes?: string;
  onboardingKit?: string;
}
