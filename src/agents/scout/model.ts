import { deriveHitlTier } from "../../guardrails/hitl";
import { callModel } from "../../model/gateway";
import type { ScoutResult, ScoutRoutingInput } from "../../types";
import { Q6_DEFAULT_BUCKET, scoreReadiness } from "./routing";
import { buildRoutingPrompt, scoutModelSchema } from "./schema";

export const SCOUT_ROUTING_PROMPT_VERSION = "scout-routing-0.05";

export const SOMETHING_ELSE_FLAG =
  "Q6 = 'something else' — no auto-bucket, needs manual review";
export const REBUCKET_CONFIDENCE_FLAG =
  "confidence capped at Low — bucket differs from the stated need";

/** The model's half of a `ScoutResult`: bucket, confidence, rationale, flags. */
type ScoutModelOutput = Pick<
  ScoutResult,
  "bucket" | "confidence" | "rationale" | "flags"
>;

/**
 * The spec's rules that are not judgement calls, applied after the model answers, so a
 * routing decision cannot violate them whatever the model returns (`scout.md` §Rules):
 *
 * - `something_else` bypasses auto-bucket: bucket and confidence null, always.
 * - A bucket other than the stated need's is never High — the description-wins rule
 *   gives it Low. Capped to Low with a flag, since High is what would make it `L2`.
 */
export function enforceRoutingRules(
  input: ScoutRoutingInput,
  object: ScoutModelOutput,
): ScoutModelOutput {
  if (input.primary_need === "something_else") {
    const flags = object.flags.includes(SOMETHING_ELSE_FLAG)
      ? object.flags
      : [...object.flags, SOMETHING_ELSE_FLAG];
    return { ...object, bucket: null, confidence: null, flags };
  }
  const starting = Q6_DEFAULT_BUCKET[input.primary_need];
  if (object.bucket !== starting && object.confidence === "High") {
    return {
      ...object,
      confidence: "Low",
      flags: [...object.flags, REBUCKET_CONFIDENCE_FLAG],
    };
  }
  return object;
}

/**
 * The model-backed Scout path: code scores readiness, the model buckets and explains,
 * code derives the tier. `routing.ts` `routeScoutIntake()` is its deterministic
 * counterpart (fallback contract rule 1); both return the same `ScoutResult`, which is
 * what lets one eval fixture set grade them side by side.
 *
 * Throws `GatewayError` on any model failure — never a fabricated result (rule 2). The
 * failed run is recorded as `fallback`, not `error`: every caller (the route, the eval
 * harness) answers a failure here with `routeScoutIntake()`, so that is what the run
 * became (observability.md: status is what happened to the request).
 */
export async function routeScoutIntakeWithModel(
  input: ScoutRoutingInput,
): Promise<{ result: ScoutResult; runId: string | null }> {
  const readiness = scoreReadiness(input);
  const toResult = (object: ScoutModelOutput): ScoutResult => {
    const ruled = enforceRoutingRules(input, object);
    return {
      ...ruled,
      ...readiness,
      hitlTier: deriveHitlTier("scout", {
        confidence: ruled.confidence,
        compositeSignal: readiness.composite_signal,
      }),
    };
  };

  const { object, runId } = await callModel({
    agent: "scout",
    schema: scoutModelSchema,
    prompt: buildRoutingPrompt(input, readiness),
    promptVersion: SCOUT_ROUTING_PROMPT_VERSION,
    recordTier: (o) => toResult(o).hitlTier,
    failureStatus: "fallback",
  });

  return { result: toResult(object), runId };
}
