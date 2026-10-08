import { deriveHitlTier } from "../../guardrails/hitl";
import { callModel } from "../../model/gateway";
import type { ChronicleDraft, ChronicleInput } from "../../types";
import { assessChronicleReadiness, generateChronicleDraft } from "./draft";
import { buildChroniclePrompt, chronicleModelSchema } from "./schema";

export const CHRONICLE_DRAFT_PROMPT_VERSION = "chronicle-draft-0.06";

/**
 * The model-backed Chronicle path; `draft.ts` `generateChronicleDraft()` is its
 * deterministic counterpart and both return the same `ChronicleDraft`.
 *
 * Readiness is derived in code before any model call. A `not_ready` record gets the empty
 * draft with no call at all (`runId: null`) — there is nothing to write a story from, and
 * asking a model anyway is how a fabricated one gets made. `readiness`, `engagementId`,
 * `outcomes` and `hitlTier` are stamped here, never taken from the model. The success and
 * failure factors are the model's proposals: code cannot check a cause, so the pending
 * L3 approval is where they are judged.
 *
 * Throws `GatewayError` on any model failure — never a fabricated draft.
 */
export async function draftChronicleWithModel(
  input: ChronicleInput,
): Promise<{ draft: ChronicleDraft; runId: string | null; model: string | null }> {
  const readiness = assessChronicleReadiness(input);
  if (readiness === "not_ready") {
    return { draft: generateChronicleDraft(input), runId: null, model: null };
  }

  const { object, runId, model } = await callModel({
    agent: "chronicle",
    schema: chronicleModelSchema,
    prompt: buildChroniclePrompt({ ...input, readiness }),
    engagementId: input.engagementId,
    promptVersion: CHRONICLE_DRAFT_PROMPT_VERSION,
    recordTier: () => deriveHitlTier("chronicle"),
    // The handler falls back to the deterministic draft on failure, so a failed call
    // is recorded as a `fallback` run, not an `error` (design-system.md §2).
    failureStatus: "fallback",
  });

  return {
    draft: {
      ...object,
      engagementId: input.engagementId,
      readiness,
      // No achievement is recorded in the input (roadmap D46), so none is claimed on the
      // model path either: the model is not asked for outcomes (`chronicleModelSchema`)
      // and could not set them if it tried. Same as `generateChronicleDraft()`.
      outcomes: [],
      hitlTier: deriveHitlTier("chronicle"),
    },
    runId,
    model,
  };
}
