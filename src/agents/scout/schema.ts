import { z } from "zod";
import { scoutResultSchema } from "../../schemas/scout";
import {
  PARTNER_DATA_NOTICE,
  field,
  partnerDataBlock,
} from "../../guardrails/partnerData";
import { SCOUT_BUCKETS } from "../../types";
import type { ScoutRoutingInput } from "../../types";
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
    "- It points at no bucket's kind of work, or at two or more: it is ambiguous. Break the tie on scale and systems, in this order:",
    "  - a small org (under 20 staff, volunteer-run, one or two people) with only spreadsheets, paper or nothing → Advisory / Strategy, confidence Low, whatever the stated need;",
    "  - a larger org (20+ staff) with a real system of record (CRM, Salesforce, database, warehouse, ERP) → keep the starting bucket, confidence Medium;",
    "  - anything else → Advisory / Strategy, confidence Low.",
    "- Paper or no systems is a foothold floor: it caps the readiness at Conditional (already applied below), but it does not move the bucket away from the stated need. Only the tiebreak above moves a bucket.",
    "- Confidence: High only when the stated need and the description agree and the description is specific; Medium when they agree but the description is short or the tie was broken for the starting bucket; Low whenever the bucket is not the stated need's default or the tie fell to Advisory / Strategy. A bucket other than the starting one is never High.",
    "",
    "Readiness has already been scored from the intake by a fixed rubric; these are facts, not your call:",
    ...readinessFacts(readiness),
    "",
    "Step 2 — rationale and flags.",
    "- rationale: two sentences a staff reviewer can act on. First, name the bucket and the specific intake detail that decided it (a phrase from the problem, the stated need, the org's scale or systems).",
    "  Second, state the readiness exactly as given above, with the score that holds it back and the intake fact behind that score (the contact and timeline, the description's length, the systems named).",
    "  Never describe the org as more or less ready than the readiness above. No step numbers or form-question labels like Q6/Q7.",
    "- flags: short phrases for anything a reviewer should check — a need/description mismatch, a vague description, an ambiguous tiebreak, the something_else bypass. Empty when the intake is clean.",
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
    ]),
  ].join("\n");
}
