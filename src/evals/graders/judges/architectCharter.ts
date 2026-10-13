import { generateCharter, generateNinetyDayPlan } from "../../../agents/architect/plan";
import type { PlanGenerationInput } from "../../../agents/architect/plan";
import type { ArchitectCharter, NinetyDayPlan } from "../../../types";
import type { EvalCase } from "../../types";
import { LLMJudge } from "./base";

/**
 * What this judge grades: the charter plus the 90-day plan generated from the same input
 * (`consistent` compares them). A model-backed Architect path plugs in by returning this
 * shape from a registry `modelOutput` producer — the judge needs no change.
 */
export interface ArchitectCharterOutput {
  charter: ArchitectCharter;
  plan: NinetyDayPlan;
}

interface Expected {
  shape?: string;
  mustNotPromise?: string;
  mustAddress?: string;
}

/**
 * Judge-only, like `envoyDraft` and `chronicleDraft`. `architectScoring` already grades
 * the deterministic half (levels, overrides, flags) against golden fixtures; nothing
 * graded the free text the charter wraps around it until this metric.
 *
 * The dimension under real scrutiny is `proportionate`: Architect's failure mode is a
 * charter that reads well while promising an org more than its maturity supports — the
 * scope/level mismatch `build_basics` exists to prevent. A judge scoring only fluency
 * would reward exactly that. `consistent` is the second guard: the charter and the plan
 * are generated from one input and must not disagree about the workstreams.
 *
 * The fixture's `expected` carries exactly the checks `proportionate` and `grounded` turn
 * on (`mustNotPromise`, `mustAddress`, the plan `shape`), so it is passed as facts.
 */
export class ArchitectCharterJudge extends LLMJudge<ArchitectCharterOutput> {
  metric = "architectCharter";
  agent = "architect" as const;
  dimensions = ['grounded', 'proportionate', 'consistent'] as const;
  systemPrompt = `\
You evaluate an engagement charter drafted for a nonprofit that has completed a data
maturity assessment. A human reviews it before it reaches the partner.

Given the maturity assessment and the org's own words, judge whether the charter is:
- grounded: every claim traces to the supplied assessment, bucket, or the org's stated
  context. No invented metrics, systems, staffing, or commitments.
- proportionate: scope matches assessed maturity. A Foundational org must not be promised
  analysis or deliverables it has no foundation for; flagged dimensions must appear as
  non-skippable work rather than being written around. Overpromising on a weak assessment
  is the primary failure — mark it incorrect even if the prose is excellent.
- consistent: the charter's workstreams and objectives do not contradict the 90-day plan
  generated from the same input, and risks name the real constraints (flagged dimensions,
  the org's stated worry, past blockers) rather than generic filler.

When reference facts are listed, a charter that violates one fails the dimension it
belongs to.

Return isCorrect=true only if all three hold. score is 0.0-1.0 reflecting overall
quality. dimensions should include grounded/proportionate/consistent as 0 or 1 each.`;

  template(evalCase: EvalCase): ArchitectCharterOutput {
    const input = evalCase.input as unknown as PlanGenerationInput;
    return { charter: generateCharter(input), plan: generateNinetyDayPlan(input) };
  }

  formatUserMessage(evalCase: EvalCase, { charter, plan }: ArchitectCharterOutput): string {
    const input = evalCase.input as unknown as PlanGenerationInput;

    const workstreams = charter.workstreams
      .map((w) => `- ${w.name}${w.required ? " (required)" : ""}: ${w.description}`)
      .join("\n");
    const phases = plan.phases
      .map((p) => `- ${p.window} — ${p.title}: ${p.milestones.join("; ")}`)
      .join("\n");

    return (
      `Assessment available to the drafter:\n${JSON.stringify(input, null, 2)}\n\n` +
      `Derived plan shape: ${plan.shape}\n\n` +
      `Charter to evaluate:\n` +
      `Title: ${charter.title}\n\n` +
      `Background: ${charter.background}\n\n` +
      `Scope: ${charter.scopeStatement}\n\n` +
      `Objectives:\n${charter.objectives.map((o) => `- ${o}`).join("\n")}\n\n` +
      `Workstreams:\n${workstreams}\n\n` +
      `Risks:\n${charter.risks.map((r) => `- ${r}`).join("\n")}\n\n` +
      `Success criteria:\n${charter.successCriteria.map((s) => `- ${s}`).join("\n")}\n\n` +
      `Cadence: ${charter.cadence}\n\n` +
      `90-day plan generated from the same input:\n${phases}`
    );
  }

  expectedFacts(evalCase: EvalCase): string[] {
    const expected = evalCase.expected as Expected;
    const facts: string[] = [];
    if (expected.shape) facts.push(`The correct 90-day plan shape for this assessment is ${expected.shape}.`);
    if (expected.mustNotPromise) facts.push(`The charter must not promise: ${expected.mustNotPromise}.`);
    if (expected.mustAddress) facts.push(`The charter must address: ${expected.mustAddress}.`);
    return facts;
  }
}
