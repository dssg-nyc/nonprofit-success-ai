import { z } from "zod";
import { scoutResultSchema } from "../../schemas/scout";
import {
  PARTNER_DATA_NOTICE,
  field,
  partnerDataBlock,
} from "../../guardrails/partnerData";
import { SCOUT_BUCKETS } from "../../types";
import type { ScoutRegistry, ScoutRoutingInput } from "../../types";
import { Q6_DEFAULT_BUCKET, type ScoutReadiness } from "./routing";

/**
 * What the model is asked for: the wire schema minus the fields code derives.
 * `hitlTier` comes from `guardrails/hitl.ts`; the three readiness scores and
 * `composite_signal` from `routing.ts` `scoreReadiness()`. So a model can neither
 * assert readiness nor grant itself L2 — it buckets, weighs confidence, and explains.
 */
export const SCOUT_RATIONALE_MAX = 1_000;
export const SCOUT_FLAG_MAX = 200;
export const SCOUT_FLAGS_MAX = 10;

export const scoutModelSchema = scoutResultSchema
  .omit({
    hitlTier: true,
    composite_signal: true,
    poc_score: true,
    clarity_score: true,
    foothold_score: true,
  })
  .extend({
    // Bounded here, not on the wire schema: the stored row reads back uncapped, and an
    // over-long answer (a prompt-injected intake asking for an essay) is a parse error
    // that the deterministic router answers instead.
    rationale: z.string().min(1).max(SCOUT_RATIONALE_MAX),
    flags: z.array(z.string().min(1).max(SCOUT_FLAG_MAX)).max(SCOUT_FLAGS_MAX),
  });

const needToBucket = Object.entries(Q6_DEFAULT_BUCKET)
  .map(([need, bucket]) => `  - ${need} → ${bucket ?? "no bucket (see step 1)"}`)
  .join("\n");

/** The readiness facts the model is given, in the same words `routing.ts` uses in its rationale. */
function readinessFacts(readiness: ScoutReadiness): string[] {
  const { poc_score, clarity_score, foothold_score, composite_signal } = readiness;
  const weakest =
    poc_score === 1
      ? "the point of contact"
      : clarity_score === 1
        ? "the description's clarity"
        : foothold_score === 1
          ? "the systems foothold"
          : composite_signal === "Ready"
            ? "none — every score is 2 or 3 and they total 7 or more"
            : "a total below the Ready threshold of 7";
  return [
    `- point of contact ${poc_score}/3 (a named decision-maker and a concrete timeline)`,
    `- clarity ${clarity_score}/3 (a description over 25 words naming a kind of data work)`,
    `- foothold ${foothold_score}/3 (a system of record to build on)`,
    `- readiness: ${composite_signal}; what holds it back: ${weakest}`,
  ];
}

/**
 * The foothold floor, stated as what the model must not do, and placed before the
 * tiebreak list so the list is read as the only way a bucket moves.
 */
export const FOOTHOLD_FLOOR_RULE =
  "- Paper, spreadsheets or no systems never change the bucket — they only cap readiness (the foothold floor, already applied below). A stated need on paper systems keeps its starting bucket; only the tiebreak below, and only on an ambiguous description, moves a bucket.";

/**
 * The IRS registry record's one job in step 1: stand in for org size when the applicant
 * named none. Stated before the tiebreak list, like the foothold floor, so the record is
 * read as evidence for one branch of the tie and nothing more.
 */
export const REGISTRY_RULE =
  "- The IRS registry line (when present) never changes the bucket on its own. It stands in for org size only in the tiebreak below, and only when the applicant's own words name no size: IRS-reported revenue of $1,000,000 or more reads as a larger org, under $250,000 as a small one, anything between says nothing. 'No record matched' is a flag for the reviewer, never a reason to move the bucket or lower confidence.";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/**
 * The registry record as one labelled line inside the partner-data block: it was found
 * from what the applicant wrote, so it is material, not instruction. `undefined` (no
 * lookup) adds no line at all; `null` says the lookup found nothing.
 */
export function registryLine(registry: ScoutRegistry | null | undefined): string[] {
  if (registry === undefined) return [];
  if (registry === null) return [field("- IRS registry (ProPublica)", "no record matched the org name")];
  const parts = [
    `${registry.name}, EIN ${registry.ein.slice(0, 2)}-${registry.ein.slice(2)}`,
    registry.subsectionCode !== null ? `501(c)(${registry.subsectionCode})` : "subsection unknown",
    registry.nteeCode !== null ? `NTEE ${registry.nteeCode}` : null,
    registry.revenue !== null ? `revenue ${usd.format(registry.revenue)}` : "revenue not reported",
    registry.latestFilingYear !== null
      ? `newest filing ${registry.latestFilingYear}`
      : "no filing on record",
  ].filter((part): part is string => part !== null);
  return [field("- IRS registry (ProPublica)", parts.join("; "))];
}

/** One example per shape run 2 missed; each is the heuristic's answer on the matching fixture. */
export const WORKED_EXAMPLES: readonly string[] = [
  "- A three-way match on a mid-size org: stated need build_tool, 'a growing regional nonprofit', a description that wants a dashboard, trend analysis and predictive models at once, systems 'a mix of internal tools we built ourselves'. Ambiguous (three kinds of work); the org is neither under 20 staff nor 20+ with a system of record, so the tie falls to 'anything else' → Advisory / Strategy, confidence Low.",
  "- An ML need on paper systems: stated need ml_predictive, staff of 28, a description that wants a risk score flagging which tenants are likely to fall behind on rent, systems 'paper sign-in sheets and a filing cabinet'. The description clearly describes ML / Predictive and nothing else → ML / Predictive, confidence High; the paper systems cap readiness at Conditional and move nothing.",
];

/**
 * 0.02 carried the spec's full routing rubric and had the model score readiness; it
 * scored generously — 7 of its 10 misses were a `Ready` the rubric did not give.
 * 0.03 computes readiness in code (`scoreReadiness()`) and hands the model the scores as
 * facts, so the model's job is the two judgement calls the rubric leaves open — which
 * bucket the description really points at, and how sure that is — and a rationale that
 * cites the intake and agrees with the readiness a reviewer sees beside it.
 * 0.04 changes no instruction: the intake block is wrapped in the partner-supplied-data
 * delimiter (guardrails/partnerData.ts) with a notice before it, and values are
 * neutralised so they cannot forge the closing marker.
 * 0.05 spells out the tiebreak in the heuristic's own words — order, the foothold floor
 * that caps readiness without moving the bucket, and the confidence rule the tier derives
 * from — so the model and `routing.ts` apply one rule (run 1, 2026-10-08: the model lane
 * missed 5 of 21 routings, all on ambiguous descriptions).
 * 0.06 states the foothold floor as a prohibition *before* the tiebreak list, in the
 * model's own terms, adds one worked example per shape run 2 missed (a three-way match
 * on a mid-size org; an ML need on paper systems) and tells the rationale to name the
 * intake detail rather than quote a score (run 2, 2026-10-08: 4 of 29 model routings
 * missed on those two shapes, and 2 rationales quoted "3/3 foothold" at a judge who never
 * saw the scores). The heuristic is unchanged.
 * 0.07 adds the IRS registry record (ProPublica, looked up server-side from the org name
 * or EIN, R19) as one line inside the partner-data block and one rule above the tiebreak:
 * the record stands in for org size only when the applicant named none, and a missing
 * record is a flag, never a bucket change. The heuristic applies the same rule
 * (`routing.ts` `REGISTRY_LARGE_REVENUE` / `REGISTRY_SMALL_REVENUE`).
 */
export function buildRoutingPrompt(
  input: ScoutRoutingInput,
  readiness: ScoutReadiness,
): string {
  return [
    "You are Scout, triaging an intake request from a nonprofit for a volunteer data-science engagement.",
    "Follow the two steps below exactly; a human reviewer relies on them being applied the same way every time.",
    "",
    "Step 1 — bucket and confidence.",
    `Buckets: ${SCOUT_BUCKETS.join(", ")}.`,
    "The stated primary need implies a starting bucket:",
    needToBucket,
    "- primary need something_else: bucket null and confidence null. Stop step 1 there; a human buckets it.",
    "- The problem description clearly describes the starting bucket's kind of work, and no other: keep it, confidence High.",
    "- It clearly describes exactly one other bucket's kind of work: the description wins — use that bucket, confidence Low.",
    "- It is under 8 words but points at the starting bucket: keep it, confidence Medium.",
    FOOTHOLD_FLOOR_RULE,
    REGISTRY_RULE,
    "- It points at no bucket's kind of work, or at two or more: it is ambiguous. Break the tie on scale and systems, in this order:",
    "  - a small org (under 20 staff, volunteer-run, one or two people; or, when no size is stated, registry revenue under $250,000) with only spreadsheets, paper or nothing → Advisory / Strategy, confidence Low, whatever the stated need;",
    "  - a larger org (20+ staff; or, when no size is stated, registry revenue of $1,000,000 or more) with a real system of record (CRM, Salesforce, database, warehouse, ERP) → keep the starting bucket, confidence Medium;",
    "  - anything else → Advisory / Strategy, confidence Low.",
    "- Confidence: High only when the stated need and the description agree and the description is specific; Medium when they agree but the description is short or the tie was broken for the starting bucket; Low whenever the bucket is not the stated need's default or the tie fell to Advisory / Strategy. A bucket other than the starting one is never High.",
    "",
    "Worked examples:",
    ...WORKED_EXAMPLES,
    "",
    "Readiness has already been scored from the intake by a fixed rubric; these are facts, not your call:",
    ...readinessFacts(readiness),
    "",
    "Step 2 — rationale and flags.",
    "- rationale: two sentences a staff reviewer can act on. First, name the bucket and the specific intake detail that decided it (a phrase from the problem, the stated need, the org's scale or systems).",
    "  Second, state the readiness exactly as given above and what holds it back, as the intake fact behind it (the contact and timeline, the description's length, the systems named).",
    "  Never quote a numeric score; name the intake detail instead. Never describe the org as more or less ready than the readiness above. No step numbers or form-question labels like Q6/Q7.",
    "- flags: short phrases for anything a reviewer should check — a need/description mismatch, a vague description, an ambiguous tiebreak, the something_else bypass, a registry line that says no record matched or names a subsection other than 501(c)(3). Empty when the intake is clean.",
    "",
    PARTNER_DATA_NOTICE,
    "",
    ...partnerDataBlock([
      field("- Organisation scale", input.scale || "(not given)"),
      field(
        "- Primary need",
        `${input.primary_need}${input.primary_need_other ? ` (${input.primary_need_other})` : ""}`,
      ),
      field("- Problem", input.problem_description || "(not given)"),
      field("- Current systems", input.current_systems || "(none described)"),
      field("- Contact", input.contact_name_role || "(not given)"),
      field("- Timeline", input.timeline || "(not given)"),
      ...registryLine(input.registry),
    ]),
  ].join("\n");
}
