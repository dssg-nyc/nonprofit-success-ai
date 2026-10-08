import { deriveHitlTier } from "../../guardrails/hitl";
import { callModel } from "../../model/gateway";
import type { ArchitectCharter, NinetyDayPlan } from "../../types";
import type { PlanGenerationInput } from "./plan";
import {
  generateCharter,
  generateNinetyDayPlan,
  structuralRiskCount,
} from "./plan";
import type { ArchitectEnrichment, ArchitectTemplate } from "./schema";
import { architectEnrichmentSchema, buildArchitectPrompt } from "./schema";

export const ARCHITECT_PLAN_PROMPT_VERSION = "architect-plan-0.04";

/**
 * One call must fit inside the handler's 30s `maxDuration` with the database write after
 * it, so it gets less than the gateway's 25s default. The enrichment echoes most of the
 * template's prose back, hence the larger output cap.
 */
export const ARCHITECT_TIMEOUT_MS = 20_000;
export const ARCHITECT_MAX_OUTPUT_TOKENS = 4_096;

/** The deterministic draft: fallback contract rule 1's counterpart to the model path. */
export function buildTemplate(input: PlanGenerationInput): ArchitectTemplate {
  return {
    charter: generateCharter(input),
    plan: generateNinetyDayPlan(input),
  };
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Applies `{index, text}` edits onto a copy of `base`. An edit lands only when its index
 * is an integer naming an existing entry at or past `firstEditable`; anything else —
 * out-of-range, negative, fractional, locked, non-string or empty text — is dropped. The
 * result always has `base`'s length.
 */
function applyEdits(
  base: readonly string[],
  edits: unknown,
  firstEditable = 0,
): string[] {
  const out = [...base];
  if (!Array.isArray(edits)) return out;
  for (const edit of edits) {
    if (typeof edit !== "object" || edit === null) continue;
    const { index, text } = edit as { index?: unknown; text?: unknown };
    const clean = cleanText(text);
    if (
      clean === null ||
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      index < firstEditable ||
      index >= out.length
    )
      continue;
    out[index] = clean;
  }
  return out;
}

/**
 * Merges model prose onto the deterministic template. Only five things can change:
 * `background`, `scopeStatement`, the non-structural risks, success-criteria wording and
 * milestone wording — each by index, never by count. Everything else is copied from the
 * template field by field rather than spread, so a field the model adds (`shape`,
 * `workstreams`, `required`, `hitlTier`, …) has nowhere to land: plan shape, phase
 * windows and titles, objectives, workstreams and their `required` flags, the title,
 * cadence and `phase2Note` are always code's.
 *
 * Pure, and defensive about its argument even though the gateway has already validated
 * it against `architectEnrichmentSchema`: the merge is the guarantee, not the schema.
 */
export function mergeEnrichment(
  template: ArchitectTemplate,
  enrichment: ArchitectEnrichment,
  maturity: PlanGenerationInput["maturity"],
): ArchitectTemplate {
  const { charter, plan } = template;
  const e = (enrichment ?? {}) as Partial<Record<keyof ArchitectEnrichment, unknown>>;

  const milestoneEdits = Array.isArray(e.milestones) ? e.milestones : [];
  const phases: NinetyDayPlan["phases"] = plan.phases.map((phase, p) => ({
    window: phase.window,
    title: phase.title,
    milestones: applyEdits(
      phase.milestones,
      milestoneEdits.filter(
        (m) =>
          typeof m === "object" &&
          m !== null &&
          (m as { phase?: unknown }).phase === p,
      ),
    ),
  }));

  // One copy shared by charter and plan, as in the template, but never the template's own
  // objects, so a caller mutating the result cannot reach back into it.
  const workstreams = plan.workstreams.map((w) => ({
    name: w.name,
    required: w.required,
    description: w.description,
  }));

  const mergedPlan: NinetyDayPlan = {
    shape: plan.shape,
    headline: plan.headline,
    phases,
    workstreams,
    ...(plan.phase2Note !== undefined ? { phase2Note: plan.phase2Note } : {}),
  };

  const mergedCharter: ArchitectCharter = {
    title: charter.title,
    background: cleanText(e.background) ?? charter.background,
    scopeStatement: cleanText(e.scopeStatement) ?? charter.scopeStatement,
    objectives: [...charter.objectives],
    workstreams,
    risks: applyEdits(charter.risks, e.risks, structuralRiskCount(maturity)),
    successCriteria: applyEdits(charter.successCriteria, e.successCriteria),
    cadence: charter.cadence,
  };

  return { charter: mergedCharter, plan: mergedPlan };
}

export interface EnrichOptions {
  organizationId?: string;
  engagementId?: string;
}

/**
 * The model-backed Architect path: one gateway call for prose, merged onto the template.
 * `buildTemplate()` is its deterministic counterpart (fallback contract rule 1) — the
 * handler saves that when this throws.
 *
 * Throws `GatewayError` on any model failure, a missing key included — never a
 * half-enriched draft (rule 2). The gateway has already recorded the failed call as a
 * `fallback` run; the error carries its `runId` so the handler can link the approval.
 */
export async function enrichWithModel(
  input: PlanGenerationInput,
  options: EnrichOptions = {},
): Promise<ArchitectTemplate & { runId: string | null; model: string }> {
  const template = buildTemplate(input);
  const { object, runId, model } = await callModel({
    agent: "architect",
    schema: architectEnrichmentSchema,
    prompt: buildArchitectPrompt(input, template),
    promptVersion: ARCHITECT_PLAN_PROMPT_VERSION,
    organizationId: options.organizationId,
    engagementId: options.engagementId,
    timeoutMs: ARCHITECT_TIMEOUT_MS,
    maxOutputTokens: ARCHITECT_MAX_OUTPUT_TOKENS,
    recordTier: () => deriveHitlTier("architect"),
    // Every failure ends in the saved template (the handler's fallback), so the run is
    // recorded as `fallback` — one row per call, not an `error` row and a second one.
    failureStatus: "fallback",
  });

  return { ...mergeEnrichment(template, object, input.maturity), runId, model };
}
