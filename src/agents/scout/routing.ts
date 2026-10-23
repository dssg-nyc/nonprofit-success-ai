import { deriveHitlTier } from "../../guardrails/hitl";
import {
  PrimaryNeed,
  ScoutBucket,
  ScoutConfidence,
  ScoutCompositeSignal,
  type ScoutRegistry,
  type ScoutRoutingInput,
  type ScoutResult,
} from "../../types";

/** The bucket each stated primary need (Q6) implies. Shared with the model prompt. */
export const Q6_DEFAULT_BUCKET: Record<PrimaryNeed, ScoutBucket | null> = {
  analyze_data: "Analytics & Insight",
  build_tool: "Tooling & Automation",
  ml_predictive: "ML / Predictive",
  organize_data: "Data Infrastructure",
  strategy_guidance: "Advisory / Strategy",
  something_else: null,
};

const BUCKET_KEYWORDS: Record<ScoutBucket, RegExp> = {
  "ML / Predictive":
    /predict|forecast|\bmodel\b|classif|machine learning|\bml\b|risk score/i,
  "Tooling & Automation": /dashboard|\btool\b|automat|workflow|\bapp\b|portal/i,
  "Data Infrastructure":
    /messy|clean(?:ing|up)?|organi[sz]e|pipeline|migrat|integrat|consolidat/i,
  "Analytics & Insight": /analy|insight|trend|\breport/i,
  "Advisory / Strategy": /strategy|not sure|guidance|where to start|roadmap/i,
};

const SMALL_ORG_SIGNAL =
  /\b([1-9]|1[0-9])\b|volunteer|just me|small team|one[- ]person|two[- ]person/i;
const MINIMAL_SYSTEMS_SIGNAL =
  /spreadsheet|excel|google sheet|nothing|none\b|paper|just started|no system/i;
const LARGE_ORG_SIGNAL =
  /\b([2-9][0-9]|[1-9][0-9]{2,})\b|staff of|full[- ]time staff/i;
const REAL_SYSTEMS_SIGNAL = /crm|salesforce|database|warehouse|data lake|erp/i;

/**
 * Registry revenue standing in for `scale` in the tiebreak, only when the free text
 * names no org size. The bands are deliberately far apart: between them the registry
 * says nothing, and the tie falls to Advisory as before.
 */
const REGISTRY_LARGE_REVENUE = 1_000_000;
const REGISTRY_SMALL_REVENUE = 250_000;
/** A newest filing older than this is worth a reviewer's glance. */
const REGISTRY_STALE_YEARS = 3;

const CONCRETE_ROLE_SIGNAL =
  /director|founder|\bed\b|executive director|manager|coordinator|lead|president|ceo/i;
const CONCRETE_TIMELINE_SIGNAL =
  /asap|immediately|this (quarter|month|year)|q[1-4]|january|february|march|april|may|june|july|august|september|october|november|december|\d{4}|weeks?|months?/i;

function keywordMatchedBuckets(text: string): ScoutBucket[] {
  const matches: ScoutBucket[] = [];
  for (const bucket of Object.keys(BUCKET_KEYWORDS) as ScoutBucket[]) {
    if (BUCKET_KEYWORDS[bucket].test(text)) matches.push(bucket);
  }
  return matches;
}

function scorePoc(contactNameRole: string, timeline: string): 1 | 2 | 3 {
  const hasRole =
    CONCRETE_ROLE_SIGNAL.test(contactNameRole) &&
    contactNameRole.trim().split(/\s+/).length >= 2;
  const hasTimeline =
    CONCRETE_TIMELINE_SIGNAL.test(timeline) && timeline.trim().length > 0;
  if (hasRole && hasTimeline) return 3;
  if (hasRole || hasTimeline) return 2;
  return 1;
}

function scoreClarity(problemDescription: string): 1 | 2 | 3 {
  const wordCount = problemDescription
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const hasBucketKeyword = keywordMatchedBuckets(problemDescription).length > 0;
  if (wordCount > 25 && hasBucketKeyword) return 3;
  if (wordCount >= 8) return 2;
  return 1;
}

function scoreFoothold(currentSystems: string): 1 | 2 | 3 {
  if (REAL_SYSTEMS_SIGNAL.test(currentSystems)) return 3;
  if (
    MINIMAL_SYSTEMS_SIGNAL.test(currentSystems) ||
    currentSystems.trim().length === 0
  )
    return 1;
  return 2;
}

export function compositeSignal(
  poc: number,
  clarity: number,
  foothold: number,
): ScoutCompositeSignal {
  const sum = poc + clarity + foothold;
  if (poc === 1 && sum > 3) return "Not Ready";
  if (poc === 1 || clarity === 1 || foothold === 1) return "Conditional";
  if (sum >= 7) return "Ready";
  return "Conditional";
}

/** The three readiness scores and the signal they compose to. */
export interface ScoutReadiness {
  poc_score: 1 | 2 | 3;
  clarity_score: 1 | 2 | 3;
  foothold_score: 1 | 2 | 3;
  composite_signal: ScoutCompositeSignal;
}

/**
 * Readiness from the intake alone. The rubric is mechanical — a title and a timeline, a
 * word count and a keyword, a system of record — so both Scout paths compute it here:
 * `routeScoutIntake()` directly and `model.ts` before its model call. The baseline eval
 * run had the model score these itself and it disagreed with the rubric in 7 of 21
 * intakes, every time toward Ready; a readiness the model cannot assert is the point of
 * deriving `composite_signal` in code at all.
 */
export function scoreReadiness(input: ScoutRoutingInput): ScoutReadiness {
  const poc_score = scorePoc(input.contact_name_role, input.timeline);
  const clarity_score = scoreClarity(input.problem_description);
  const foothold_score = scoreFoothold(input.current_systems);
  return {
    poc_score,
    clarity_score,
    foothold_score,
    composite_signal: compositeSignal(poc_score, clarity_score, foothold_score),
  };
}

/** How the rationale names the applicant's stated need — words, not the form's Q6 label. */
const NEED_PHRASE: Record<PrimaryNeed, string> = {
  analyze_data: "help analyzing their data",
  build_tool: "a custom tool",
  ml_predictive: "a predictive model",
  organize_data: "help organizing their data",
  strategy_guidance: "strategy guidance",
  something_else: "something else",
};

const EXCERPT_WORDS = 14;

/** The problem description's opening words, quoted, so the rationale cites the intake itself. */
function excerpt(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "no problem description";
  const cut = words.slice(0, EXCERPT_WORDS).join(" ");
  return `"${cut}${words.length > EXCERPT_WORDS ? "…" : ""}"`;
}

/**
 * The readiness half of the rationale: the signal, the intake fact behind each
 * sub-score, and — when it is not Ready — which score holds it back. The judge failed
 * the old one-line rationale on `grounded` in 16 of 21 cases: it named the bucket but
 * no intake detail, so a reviewer could not check it against the intake.
 */
function readinessSentence(
  input: ScoutRoutingInput,
  poc: number,
  clarity: number,
  foothold: number,
  signal: ScoutCompositeSignal,
): string {
  const contact = input.contact_name_role.trim() || "no named contact";
  const timeline = input.timeline.trim() || "no timeline";
  const systems = input.current_systems.trim() ? `"${input.current_systems.trim()}"` : "no systems listed";
  const words = input.problem_description.trim().split(/\s+/).filter(Boolean).length;
  // The facts only — the three scores live in the structured fields the UI shows beside
  // this sentence, so repeating the arithmetic here reads as the rubric talking.
  const facts =
    `contact ${contact} with timeline "${timeline}", ` +
    `a description of ${words} words, and ${systems} today`;
  if (signal === "Ready") return `Readiness is Ready: ${facts}.`;
  const holding =
    poc === 1
      ? "the point of contact"
      : clarity === 1
        ? "the description's clarity"
        : foothold === 1
          ? "the systems foothold"
          : "a total below the Ready threshold";
  return `Readiness is ${signal}: ${facts}; ${holding} holds it back.`;
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/**
 * What the reviewer should check in the registry record. The record never moves a
 * score or a tier; it only earns a flag — including when there is none: an applicant
 * ProPublica does not know is either not a registered nonprofit or filed under another
 * name, and either is worth a look before approval.
 */
export function registryFlags(registry: ScoutRegistry | null | undefined): string[] {
  if (registry === undefined) return [];
  if (registry === null) {
    return ["Registry: no IRS record matched the org name — verify nonprofit status"];
  }
  const flags: string[] = [];
  if (registry.subsectionCode !== null && registry.subsectionCode !== 3) {
    flags.push(`Registry: 501(c)(${registry.subsectionCode}), not a 501(c)(3)`);
  }
  if (registry.latestFilingYear === null) {
    flags.push("Registry: no IRS filing on record");
  } else if (registry.latestFilingYear < new Date().getFullYear() - REGISTRY_STALE_YEARS) {
    flags.push(`Registry: newest IRS filing is from ${registry.latestFilingYear}`);
  }
  return flags;
}

/** The registry half of the rationale: the record as a fact the reviewer can check, or its absence. */
function registrySentence(registry: ScoutRegistry | null | undefined): string {
  if (registry === undefined) return "";
  if (registry === null) return " No IRS record matched the org name.";
  const subsection =
    registry.subsectionCode !== null ? `a 501(c)(${registry.subsectionCode})` : "a registered nonprofit";
  const revenue =
    registry.revenue !== null
      ? ` with revenue of ${usd.format(registry.revenue)}${registry.latestFilingYear !== null ? ` in its ${registry.latestFilingYear} filing` : ""}`
      : registry.latestFilingYear !== null
        ? `, newest filing ${registry.latestFilingYear}`
        : " with no filing on record";
  return ` IRS records list ${registry.name} (EIN ${registry.ein.slice(0, 2)}-${registry.ein.slice(2)}) as ${subsection}${revenue}.`;
}

export function routeScoutIntake(input: ScoutRoutingInput): ScoutResult {
  const flags: string[] = [];

  const { poc_score, clarity_score, foothold_score, composite_signal } =
    scoreReadiness(input);

  if (input.primary_need === "something_else") {
    flags.push("Q6 = 'something else' — no auto-bucket, needs manual review");
    flags.push(...registryFlags(input.registry));
    return {
      bucket: null,
      confidence: null,
      rationale: `The applicant asked for something outside the listed needs${input.primary_need_other ? `: "${input.primary_need_other}"` : ""}, described as ${excerpt(input.problem_description)}. Scout does not auto-bucket this case, so it goes straight to human review. ${readinessSentence(input, poc_score, clarity_score, foothold_score, composite_signal)}${registrySentence(input.registry)}`,
      poc_score,
      clarity_score,
      foothold_score,
      composite_signal,
      flags,
      hitlTier: deriveHitlTier("scout", {
        confidence: null,
        compositeSignal: composite_signal,
      }),
    };
  }

  const q6Bucket = Q6_DEFAULT_BUCKET[input.primary_need] as ScoutBucket;

  const q7Matches = keywordMatchedBuckets(input.problem_description);
  const wordCount = input.problem_description
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  let bucket: ScoutBucket = q6Bucket;
  let confidence: ScoutConfidence;
  let rationale: string;
  let needsTiebreaker = false;
  const need = NEED_PHRASE[input.primary_need];
  const quoted = excerpt(input.problem_description);
  const unclear =
    q7Matches.length > 1
      ? `touches several areas (${q7Matches.join(", ")})`
      : "does not point to one area";

  if (q7Matches.length === 0 || wordCount < 8) {
    flags.push("vague problem description");
    confidence = "Medium";
    rationale = `The applicant asked for ${need} (${q6Bucket}), but the description ${quoted} is too short or unspecific to confirm it, so the bucket stands at Medium confidence.`;
    needsTiebreaker = q7Matches.length === 0;
  } else if (q7Matches.length === 1 && q7Matches[0] === q6Bucket) {
    confidence = "High";
    rationale = `The applicant asked for ${need}, and the description ${quoted} describes the same ${q6Bucket} work.`;
  } else if (q7Matches.length === 1 && q7Matches[0] !== q6Bucket) {
    const q7Bucket = q7Matches[0];
    flags.push(
      `Q6/Q7 mismatch — re-bucketed from ${q6Bucket} to ${q7Bucket} based on problem description`,
    );
    bucket = q7Bucket;
    confidence = "Low";
    rationale = `The applicant asked for ${need} (${q6Bucket}), but the description ${quoted} describes ${q7Bucket} work, so Scout routed it to ${q7Bucket}: what they describe outweighs the need they selected.`;
  } else {
    needsTiebreaker = true;
    confidence = "Medium";
    rationale = `The description ${quoted} touches several areas (${q7Matches.join(", ")}), so Scout used org scale and systems to decide.`;
  }

  if (needsTiebreaker) {
    // Org size: the applicant's words first; when they name no size, the registry's
    // revenue stands in (a matched record only — `null` and `undefined` say nothing).
    const textSmall = SMALL_ORG_SIGNAL.test(input.scale);
    const textLarge = LARGE_ORG_SIGNAL.test(input.scale);
    const revenue = textSmall || textLarge ? null : (input.registry?.revenue ?? null);
    const isSmallOrg = textSmall || (revenue !== null && revenue < REGISTRY_SMALL_REVENUE);
    const isLargeOrg = textLarge || (revenue !== null && revenue >= REGISTRY_LARGE_REVENUE);
    const sizeEvidence =
      revenue !== null && (isSmallOrg || isLargeOrg)
        ? `an org with IRS-reported revenue of ${usd.format(revenue)}`
        : `an org of "${input.scale.trim()}"`;
    const hasMinimalSystems = MINIMAL_SYSTEMS_SIGNAL.test(
      input.current_systems,
    );
    const hasRealSystems = REAL_SYSTEMS_SIGNAL.test(input.current_systems);

    if (isSmallOrg && hasMinimalSystems) {
      bucket = "Advisory / Strategy";
      flags.push(
        "small org + minimal systems — routed to Advisory regardless of stated ask",
      );
      confidence = "Low";
      rationale = `The description ${quoted} ${unclear}, and ${sizeEvidence} running on "${input.current_systems.trim()}" is usually better served starting in Advisory / Strategy than with ${need}.`;
    } else if (isLargeOrg && hasRealSystems) {
      bucket = q6Bucket;
      flags.push(
        "ambiguous problem description; org scale/systems support the original ask",
      );
      confidence = "Medium";
      rationale = `The description ${quoted} ${unclear}, but ${sizeEvidence} with "${input.current_systems.trim()}" in place can take on the ${q6Bucket} work it asked for, so Scout kept that bucket.`;
    } else {
      bucket = "Advisory / Strategy";
      flags.push(
        "ambiguous signals — defaulted to Advisory per default-routing rule",
      );
      confidence = "Low";
      rationale = `The description ${quoted} ${unclear}, and neither the org's scale ("${input.scale.trim()}") nor its systems settle it, so Scout defaulted to Advisory / Strategy, the safest first step when in doubt.`;
    }
  }

  flags.push(...registryFlags(input.registry));

  const hitlTier = deriveHitlTier("scout", {
    confidence,
    compositeSignal: composite_signal,
  });

  return {
    bucket,
    confidence,
    rationale: `${rationale} ${readinessSentence(input, poc_score, clarity_score, foothold_score, composite_signal)}${registrySentence(input.registry)}`,
    poc_score,
    clarity_score,
    foothold_score,
    composite_signal,
    flags,
    hitlTier,
  };
}

const ONBOARDING_KIT_NAMES: Record<ScoutBucket, string> = {
  "Data Infrastructure": "Data Infrastructure Starter Kit",
  "Analytics & Insight": "Analytics & Insight Starter Kit",
  "ML / Predictive": "ML / Predictive Starter Kit",
  "Tooling & Automation": "Tooling & Automation Starter Kit",
  "Advisory / Strategy": "Advisory / Strategy Starter Kit",
};

export function getOnboardingKitName(bucket: ScoutBucket): string {
  return ONBOARDING_KIT_NAMES[bucket];
}
