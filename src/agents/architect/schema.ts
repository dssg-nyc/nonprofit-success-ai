import { z } from "zod";
import {
  PARTNER_DATA_NOTICE,
  field,
  neutralizePartnerText,
  partnerDataBlock,
} from "../../guardrails/partnerData";
import type { ArchitectCharter, NinetyDayPlan } from "../../types";
import type { PlanGenerationInput } from "./plan";
import { structuralRiskCount } from "./plan";

/**
 * One prose override, addressed by its index in the template array. `mergeEnrichment()`
 * applies an edit only when the index names an existing, editable entry, so the model can
 * reword an entry but never add, drop or reorder one.
 */
const proseEditSchema = z.object({
  index: z.number().int(),
  text: z.string().max(600),
});

const milestoneEditSchema = z.object({
  phase: z.number().int(),
  index: z.number().int(),
  text: z.string().max(300),
});

/**
 * What the model is asked for: prose only. No `shape`, phase windows or titles,
 * workstreams, `required` flags, maturity fields or `hitlTier` — those come from the
 * deterministic rubric and templates (architect.md Rules: "Model must not generate
 * `shape`"), so adversarial output can reword the draft but not restructure it.
 *
 * `null` for `background` / `scopeStatement` keeps the template's wording.
 */
export const architectEnrichmentSchema = z.object({
  background: z.string().max(4000).nullable(),
  scopeStatement: z.string().max(1500).nullable(),
  risks: z.array(proseEditSchema).max(20),
  successCriteria: z.array(proseEditSchema).max(10),
  milestones: z.array(milestoneEditSchema).max(20),
});

export type ArchitectEnrichment = z.infer<typeof architectEnrichmentSchema>;

export interface ArchitectTemplate {
  charter: ArchitectCharter;
  plan: NinetyDayPlan;
}

const orNone = (s: string) => (s.trim() ? s.trim() : "(not given)");

/**
 * 0.03 wraps everything partner-derived (the organisation's name and answers, and the
 * draft prose built from them) in the data delimiter (guardrails/partnerData.ts); the
 * instructions are unchanged, and the organisation is referred to by role, not name, in
 * them. 0.04 adds the traceability rule under scope discipline and tells the model to
 * name the dashboard's workflow from the assessment (run 1, 2026-10-08: the model added
 * funder-facing outcomes and a "most painful" workflow the assessment never named).
 */
export function buildArchitectPrompt(
  input: PlanGenerationInput,
  template: ArchitectTemplate,
): string {
  const { charter, plan } = template;
  const locked = structuralRiskCount(input.maturity);
  const editableRisks = charter.risks
    .map((risk, index) => ({ risk, index }))
    .filter(({ index }) => index >= locked);

  return [
    "You are Architect, refining a draft engagement charter and 90-day plan that DSSG NYC",
    "volunteers will run with the nonprofit named in the data block below. Staff review every draft before",
    "the organisation sees it.",
    "",
    "The structure is fixed and already decided: maturity level, plan shape, phases,",
    "workstreams and which workstreams are required. Do not restate or change any of it.",
    "Your job is wording only: make the prose specific to this organisation using what it",
    "told us below, in plain language, without promising more than the scope allows.",
    "",
    "Return:",
    "- background: a rewritten background paragraph, or null to keep the draft's.",
    "- scopeStatement: a rewritten scope statement that keeps its meaning, or null.",
    "- risks: rewordings as {index, text}, only for the risk indices listed as editable.",
    "- successCriteria: rewordings as {index, text}, one per criterion you improve.",
    "- milestones: rewordings as {phase, index, text}, using the numbers shown below.",
    "Omit any entry you would not improve. Edits to other indices are discarded.",
    "",
    "Scope discipline (the failure staff catch most):",
    "- Success criteria and milestones name what the engagement delivers — an artefact, a",
    "  documented decision, a working process. Never add a measurable target, an adoption",
    "  claim (\"actively used\", \"in real use\"), a funder-facing improvement or an outcome",
    "  the organisation did not state.",
    "- Flagged dimensions are non-skippable work. Keep their remediation explicit in the",
    "  wording; do not soften it into a label on other work.",
    "- A cross-check note means the engagement may need redirecting. Keep that visible in",
    "  the scope and risks; do not write around it.",
    "- Every deliverable and criterion must trace to a flagged dimension, the bucket, or a",
    "  sentence in the assessment. Do not add outcomes the assessment did not ask for.",
    "- A dashboard deliverable is for the workflow the assessment names as most manual.",
    "  Name that workflow from the organisation's own words; never assume one.",
    "",
    `Maturity: ${input.maturity.compositeLevel} (${input.maturity.points}/21 points).`,
    `Flagged dimensions: ${input.maturity.flaggedDimensions.length ? input.maturity.flaggedDimensions.join(", ") : "(none)"}.`,
    `Cross-check note: ${input.maturity.crossCheckFlag ?? "(none)"}`,
    `Scout bucket: ${input.bucket}. Plan shape: ${plan.shape} — "${plan.headline}"`,
    "",
    PARTNER_DATA_NOTICE,
    "",
    ...partnerDataBlock([
      field("Organisation", input.orgName),
      "What the organisation told us:",
      field("- Context", orNone(input.q1_org_context)),
      field("- How data is used today", orNone(input.q9_current_decisions)),
      field("- What they wish data could do", orNone(input.q10_wished_decisions)),
      field("- Data wish list", orNone(input.q17a_wish_list)),
      field("- Biggest worry", orNone(input.q17b_biggest_worry)),
      field("- What blocked this before", orNone(input.q18_past_blockers)),
      "",
      "Draft background:",
      neutralizePartnerText(charter.background || "(empty)"),
      "",
      "Draft scope statement:",
      neutralizePartnerText(charter.scopeStatement),
      "",
      "Editable risks:",
      ...(editableRisks.length > 0
        ? editableRisks.map(({ risk, index }) => neutralizePartnerText(`[${index}] ${risk}`))
        : ["(none)"]),
      "",
      "Success criteria:",
      ...charter.successCriteria.map((c, i) => neutralizePartnerText(`[${i}] ${c}`)),
      "",
      "Milestones:",
      ...plan.phases.flatMap((phase, p) => [
        `Phase ${p} — ${phase.window}: ${phase.title}`,
        ...phase.milestones.map((m, i) => neutralizePartnerText(`  [${p}.${i}] ${m}`)),
      ]),
    ]),
  ].join("\n");
}
