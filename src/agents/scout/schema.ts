import { z } from "zod";
import { SCOUT_BUCKETS } from "../../types";
import type { ScoutRoutingInput } from "../../types";

const SCORE = z.union([z.literal(1), z.literal(2), z.literal(3)]);

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

export type ScoutResultPayload = z.infer<typeof scoutResultSchema>;

export const scoutModelSchema = scoutResultSchema.omit({
  hitlTier: true,
  composite_signal: true,
});

export function deriveHitlTier(
  confidence: "High" | "Medium" | "Low" | null,
  composite: "Ready" | "Conditional" | "Not Ready",
): "L2" | "L3" {
  return confidence === "High" && composite === "Ready" ? "L2" : "L3";
}

export function buildRoutingPrompt(input: ScoutRoutingInput): string {
  return [
    "You are Scout, triaging an intake request from a nonprofit for a volunteer data-science engagement.",
    "Assign the request to one bucket, judge readiness, and explain your reasoning in one or two sentences.",
    "",
    `Available buckets: ${SCOUT_BUCKETS.join(", ")}.`,
    "Use a null bucket only when the request genuinely does not fit any of them.",
    "",
    "Score each 1 (weak) to 3 (strong):",
    "- poc_score: is there a named person with the authority to make decisions?",
    "- clarity_score: is the problem described concretely enough to scope?",
    "- foothold_score: do they already have systems or data to build on?",
    "",
    "Score honestly: overall readiness is computed from these three, not judged separately.",
    "",
    "Intake:",
    `- Organisation scale: ${input.scale || "(not given)"}`,
    `- Primary need: ${input.primary_need}${input.primary_need_other ? ` (${input.primary_need_other})` : ""}`,
    `- Problem: ${input.problem_description || "(not given)"}`,
    `- Current systems: ${input.current_systems || "(none described)"}`,
    `- Contact: ${input.contact_name_role || "(not given)"}`,
    `- Timeline: ${input.timeline || "(not given)"}`,
  ].join("\n");
}
