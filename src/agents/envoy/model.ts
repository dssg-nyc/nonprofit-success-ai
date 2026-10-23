import { deriveHitlTier } from "../../guardrails/hitl";
import { callModel } from "../../model/gateway";
import type { EnvoyDraft, EnvoyInput } from "../../types";
import { buildEnvoyPrompt, envoyModelSchema } from "./schema";

export const ENVOY_DRAFT_PROMPT_VERSION = "envoy-draft-0.04";

/**
 * The model-backed Envoy path: the model writes subject and body, code stamps the rest.
 * `draft.ts` `generateEnvoyDraft()` is its deterministic counterpart (fallback contract
 * rule 1); both return the same `EnvoyDraft`, so one fixture set judges them side by side.
 *
 * `engagementId` and `occasion` are echoed from the input and `hitlTier` comes from
 * `guardrails/hitl.ts` — none of the three is in `envoyModelSchema`, so the model can
 * neither retarget a draft nor grant it a tier.
 *
 * Throws `GatewayError` on any model failure — never a fabricated draft (rule 2).
 */
export async function draftEnvoyWithModel(
  input: EnvoyInput,
): Promise<{ draft: EnvoyDraft; runId: string | null; model: string }> {
  const { object, runId, model } = await callModel({
    agent: "envoy",
    schema: envoyModelSchema,
    prompt: buildEnvoyPrompt(input),
    engagementId: input.engagementId,
    promptVersion: ENVOY_DRAFT_PROMPT_VERSION,
    recordTier: () => deriveHitlTier("envoy"),
    // The handler falls back to the deterministic draft on failure, so a failed call
    // is recorded as a `fallback` run, not an `error` (design-system.md §2).
    failureStatus: "fallback",
  });

  return {
    draft: {
      ...object,
      engagementId: input.engagementId,
      occasion: input.occasion,
      hitlTier: deriveHitlTier("envoy"),
    },
    runId,
    model,
  };
}
