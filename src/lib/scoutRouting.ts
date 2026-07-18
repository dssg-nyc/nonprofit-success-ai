import { PrimaryNeed, ScoutBucket, ScoutConfidence, ScoutCompositeSignal, ScoutHitlTier } from '../types';

/**
 * Deterministic stand-in for Scout's real routing call (see scout-build-spec.md §6).
 * Implements the same bucketing/readiness/HITL logic a Claude call would perform,
 * behind the exact output shape the real call would return, so swapping in a live
 * Anthropic API call later is a drop-in replacement for this function. That swap
 * must run server-side (Cloud Function) once a real API key is involved — client
 * code can't hold a secret key, and a trusted server is also what makes a Scout
 * result's bucket/confidence trustworthy again (see README's Scout section).
 */

export interface ScoutRoutingInput {
  scale: string;
  primary_need: PrimaryNeed;
  primary_need_other?: string;
  problem_description: string;
  current_systems: string;
  contact_name_role: string;
  timeline: string;
}

export interface ScoutResult {
  bucket: ScoutBucket | null;
  confidence: ScoutConfidence;
  rationale: string;
  poc_score: 1 | 2 | 3;
  clarity_score: 1 | 2 | 3;
  foothold_score: 1 | 2 | 3;
  composite_signal: ScoutCompositeSignal;
  flags: string[];
  hitlTier: ScoutHitlTier;
}

const Q6_DEFAULT_BUCKET: Record<PrimaryNeed, ScoutBucket | null> = {
  analyze_data: 'Analytics & Insight',
  build_tool: 'Tooling & Automation',
  ml_predictive: 'ML / Predictive',
  organize_data: 'Data Infrastructure',
  strategy_guidance: 'Advisory / Strategy',
  something_else: null,
};

const BUCKET_KEYWORDS: Record<ScoutBucket, RegExp> = {
  'ML / Predictive': /predict|forecast|\bmodel\b|classif|machine learning|\bml\b|risk score/i,
  'Tooling & Automation': /dashboard|\btool\b|automat|workflow|\bapp\b|portal/i,
  'Data Infrastructure': /messy|clean(?:ing|up)?|organi[sz]e|pipeline|migrat|integrat|consolidat/i,
  'Analytics & Insight': /analy|insight|trend|\breport/i,
  'Advisory / Strategy': /strategy|not sure|guidance|where to start|roadmap/i,
};

const SMALL_ORG_SIGNAL = /\b([1-9]|1[0-9])\b|volunteer|just me|small team|one[- ]person|two[- ]person/i;
const MINIMAL_SYSTEMS_SIGNAL = /spreadsheet|excel|google sheet|nothing|none\b|paper|just started|no system/i;
const LARGE_ORG_SIGNAL = /\b([2-9][0-9]|[1-9][0-9]{2,})\b|staff of|full[- ]time staff/i;
const REAL_SYSTEMS_SIGNAL = /crm|salesforce|database|warehouse|data lake|erp/i;

const CONCRETE_ROLE_SIGNAL = /director|founder|\bed\b|executive director|manager|coordinator|lead|president|ceo/i;
const CONCRETE_TIMELINE_SIGNAL = /asap|immediately|this (quarter|month|year)|q[1-4]|january|february|march|april|may|june|july|august|september|october|november|december|\d{4}|weeks?|months?/i;

function keywordMatchedBuckets(text: string): ScoutBucket[] {
  const matches: ScoutBucket[] = [];
  for (const bucket of Object.keys(BUCKET_KEYWORDS) as ScoutBucket[]) {
    if (BUCKET_KEYWORDS[bucket].test(text)) matches.push(bucket);
  }
  return matches;
}

function scorePoc(contactNameRole: string, timeline: string): 1 | 2 | 3 {
  const hasRole = CONCRETE_ROLE_SIGNAL.test(contactNameRole) && contactNameRole.trim().split(/\s+/).length >= 2;
  const hasTimeline = CONCRETE_TIMELINE_SIGNAL.test(timeline) && timeline.trim().length > 0;
  if (hasRole && hasTimeline) return 3;
  if (hasRole || hasTimeline) return 2;
  return 1;
}

function scoreClarity(problemDescription: string): 1 | 2 | 3 {
  const wordCount = problemDescription.trim().split(/\s+/).filter(Boolean).length;
  const hasBucketKeyword = keywordMatchedBuckets(problemDescription).length > 0;
  if (wordCount > 25 && hasBucketKeyword) return 3;
  if (wordCount >= 8) return 2;
  return 1;
}

function scoreFoothold(currentSystems: string): 1 | 2 | 3 {
  if (REAL_SYSTEMS_SIGNAL.test(currentSystems)) return 3;
  if (MINIMAL_SYSTEMS_SIGNAL.test(currentSystems) || currentSystems.trim().length === 0) return 1;
  return 2;
}

function compositeSignal(poc: number, clarity: number, foothold: number): ScoutCompositeSignal {
  if (poc === 1 || clarity === 1 || foothold === 1) return 'Conditional';
  const sum = poc + clarity + foothold;
  if (sum >= 7) return 'Ready';
  if (sum <= 4) return 'Not Ready';
  return 'Conditional';
}

// Spec §3 also names an "L4 — human decides" confidence tier, but §5's HITL
// routing is explicitly binary (L2/L3). That binary is implemented as
// authoritative here; §3's Low/L4 language is treated as descriptive color
// on the Low confidence case, not a third queue.
export function routeScoutIntake(input: ScoutRoutingInput): ScoutResult {
  const flags: string[] = [];

  // Readiness is scored independently of bucket assignment (spec §4) — computed
  // up front so the "something else" no-auto-bucket path still gets a signal.
  const poc_score = scorePoc(input.contact_name_role, input.timeline);
  const clarity_score = scoreClarity(input.problem_description);
  const foothold_score = scoreFoothold(input.current_systems);
  const composite_signal = compositeSignal(poc_score, clarity_score, foothold_score);

  if (input.primary_need === 'something_else') {
    flags.push("Q6 = 'something else' — no auto-bucket, needs manual review");
    return {
      bucket: null,
      confidence: null,
      rationale: `Applicant selected "something else" for their primary need${input.primary_need_other ? `: "${input.primary_need_other}"` : ''}. Scout does not auto-bucket this case — routed straight to human review.`,
      poc_score,
      clarity_score,
      foothold_score,
      composite_signal,
      flags,
      hitlTier: 'L3',
    };
  }

  // Step 1 — Q6 sets the default hypothesis.
  const q6Bucket = Q6_DEFAULT_BUCKET[input.primary_need] as ScoutBucket;

  // Step 2 — cross-check against Q7's free text.
  const q7Matches = keywordMatchedBuckets(input.problem_description);
  const wordCount = input.problem_description.trim().split(/\s+/).filter(Boolean).length;

  let bucket: ScoutBucket = q6Bucket;
  let confidence: ScoutConfidence = 'High';
  let rationale: string;
  let needsTiebreaker = false;

  if (q7Matches.length === 0 || wordCount < 8) {
    flags.push('vague problem description');
    confidence = 'Medium';
    rationale = `Q6 suggested ${q6Bucket}, but the problem description was too short or unspecific to verify against it.`;
    needsTiebreaker = q7Matches.length === 0;
  } else if (q7Matches.length === 1 && q7Matches[0] === q6Bucket) {
    confidence = 'High';
    rationale = `Q6 and Q7 both point to ${q6Bucket} — the problem description clearly supports the stated need. No contradictions found.`;
  } else if (q7Matches.length === 1 && q7Matches[0] !== q6Bucket) {
    const q7Bucket = q7Matches[0];
    flags.push(`Q6/Q7 mismatch — re-bucketed from ${q6Bucket} to ${q7Bucket} based on problem description`);
    bucket = q7Bucket;
    confidence = 'Low';
    rationale = `Q6 suggested ${q6Bucket}, but the problem description actually describes a ${q7Bucket} need, so Scout re-bucketed to ${q7Bucket} per the Q7-wins rule.`;
  } else {
    // Multiple bucket keyword groups matched — ambiguous, fall through to Step 3.
    needsTiebreaker = true;
    confidence = 'Medium';
    rationale = `Q6 suggested ${q6Bucket}, but the problem description touched multiple possible areas (${q7Matches.join(', ')}), so Scout used org scale and systems as a tiebreaker.`;
  }

  // Step 3 — Q5/Q8 tiebreaker, only when Step 2 was ambiguous.
  if (needsTiebreaker) {
    const isSmallOrg = SMALL_ORG_SIGNAL.test(input.scale);
    const hasMinimalSystems = MINIMAL_SYSTEMS_SIGNAL.test(input.current_systems);
    const isLargeOrg = LARGE_ORG_SIGNAL.test(input.scale);
    const hasRealSystems = REAL_SYSTEMS_SIGNAL.test(input.current_systems);

    if (isSmallOrg && hasMinimalSystems) {
      bucket = 'Advisory / Strategy';
      flags.push('small org + minimal systems — routed to Advisory regardless of stated ask');
      confidence = 'Low';
      rationale = `Ambiguous problem description, but a small org with minimal existing systems is usually better served starting in Advisory / Strategy, regardless of the original ask.`;
    } else if (isLargeOrg && hasRealSystems) {
      bucket = q6Bucket;
      flags.push('ambiguous problem description; org scale/systems support the original ask');
      confidence = 'Medium';
      rationale = `Ambiguous problem description, but the org's scale and existing systems support the originally stated ${q6Bucket} need, so Scout kept Q6's bucket.`;
    } else {
      bucket = 'Advisory / Strategy';
      flags.push('ambiguous signals — defaulted to Advisory per default-routing rule');
      confidence = 'Low';
      rationale = `Signals were ambiguous across the intake, so Scout defaulted to Advisory / Strategy — the safest first-tier bucket when in doubt.`;
    }
  }

  const hitlTier: ScoutHitlTier = confidence === 'High' && composite_signal === 'Ready' ? 'L2' : 'L3';

  return {
    bucket,
    confidence,
    rationale,
    poc_score,
    clarity_score,
    foothold_score,
    composite_signal,
    flags,
    hitlTier,
  };
}

const ONBOARDING_KIT_NAMES: Record<ScoutBucket, string> = {
  'Data Infrastructure': 'Data Infrastructure Starter Kit',
  'Analytics & Insight': 'Analytics & Insight Starter Kit',
  'ML / Predictive': 'ML / Predictive Starter Kit',
  'Tooling & Automation': 'Tooling & Automation Starter Kit',
  'Advisory / Strategy': 'Advisory / Strategy Starter Kit',
};

export function getOnboardingKitName(bucket: ScoutBucket): string {
  return ONBOARDING_KIT_NAMES[bucket];
}
