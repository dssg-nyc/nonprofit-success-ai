import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  architectPlanRequestSchema,
  architectPlanResponseSchema,
  maturityResultSchema,
} from "../../../schemas/architect";
import type { CsaFullAnswers } from "../../../types";
import { buildTemplate } from "../model";
import type { PlanGenerationInput } from "../plan";
import { scoreAssessment } from "../scoring";
import { architectEnrichmentSchema, buildArchitectPrompt } from "../schema";

/** Every property name declared anywhere in a JSON schema, nested objects and arrays included. */
function propertyNames(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    node.forEach((n) => propertyNames(n, out));
  } else if (typeof node === "object" && node !== null) {
    const obj = node as Record<string, unknown>;
    if (typeof obj.properties === "object" && obj.properties !== null) {
      for (const [name, child] of Object.entries(obj.properties)) {
        out.add(name);
        propertyNames(child, out);
      }
    }
    for (const [key, child] of Object.entries(obj)) {
      if (key !== "properties") propertyNames(child, out);
    }
  }
  return out;
}

const ANSWERS: CsaFullAnswers = {
  q1_org_context: "Food pantry network, 12 sites.",
  q2_org_size: "40 staff",
  q3_poc: "Dana Reyes, ED",
  q4_collection_scope: "partial",
  q5_data_locations: "Sheets, a CRM",
  q6_system_integration: "some_share",
  q7_integration_familiarity: "somewhat_familiar",
  q8_quality_confidence: "mixed",
  q9_current_decisions: "Monthly site reports.",
  q10_wished_decisions: "Predict shortages.",
  q11_decision_empowerment: "leadership_managers",
  q12_reporting_to: "Board, two funders",
  q13_reporting_automation: "none_manual",
  q14_tools: ["spreadsheets", "crm_case_tool"],
  q15_staff_confidence: "some_adhoc",
  q16_budget_speed: "requires_approval",
  q17a_wish_list: "One live dashboard.",
  q17b_biggest_worry: "Staff time.",
  q18_past_blockers: "A consultant left mid-project.",
};

function planInput(): PlanGenerationInput {
  return {
    orgName: "Harbor Pantry",
    bucket: "Analytics & Insight",
    maturity: scoreAssessment(ANSWERS, "Analytics & Insight"),
    q1_org_context: ANSWERS.q1_org_context,
    q9_current_decisions: ANSWERS.q9_current_decisions,
    q10_wished_decisions: ANSWERS.q10_wished_decisions,
    q17a_wish_list: ANSWERS.q17a_wish_list,
    q17b_biggest_worry: ANSWERS.q17b_biggest_worry,
    q18_past_blockers: ANSWERS.q18_past_blockers,
  };
}

describe("architectEnrichmentSchema — prose only", () => {
  const names = propertyNames(z.toJSONSchema(architectEnrichmentSchema));

  it("declares none of the fields code derives", () => {
    for (const forbidden of [
      "shape",
      "required",
      "hitlTier",
      "workstreams",
      "window",
      "title",
      "phase2Note",
      "compositeLevel",
      "remediationOnly",
      "flaggedDimensions",
    ]) {
      expect(names.has(forbidden), `enrichment schema exposes "${forbidden}"`).toBe(false);
    }
  });

  it("declares exactly the prose fields and their edit shapes", () => {
    expect([...names].sort()).toEqual(
      [
        "background",
        "scopeStatement",
        "risks",
        "successCriteria",
        "milestones",
        "index",
        "text",
        "phase",
      ].sort(),
    );
  });

  it("strips a field the model adds rather than passing it through", () => {
    const parsed = architectEnrichmentSchema.parse({
      background: null,
      scopeStatement: null,
      risks: [],
      successCriteria: [],
      milestones: [],
      shape: "accelerate",
      hitlTier: "L2",
    });
    expect(parsed).not.toHaveProperty("shape");
    expect(parsed).not.toHaveProperty("hitlTier");
  });
});

describe("buildArchitectPrompt", () => {
  it("shows the org's own words and every milestone with its address", () => {
    const input = planInput();
    const template = buildTemplate(input);
    const prompt = buildArchitectPrompt(input, template);

    expect(prompt).toContain("Harbor Pantry");
    expect(prompt).toContain("A consultant left mid-project.");
    template.plan.phases.forEach((phase, p) =>
      phase.milestones.forEach((m, i) => expect(prompt).toContain(`[${p}.${i}] ${m}`)),
    );
  });

  it("offers only the non-structural risks for rewording", () => {
    const input = planInput();
    // gov=1 (none_manual) -> one required workstream -> one structural risk at index 0.
    expect(input.maturity.flaggedDimensions).toEqual(["governance"]);
    const template = buildTemplate(input);
    const prompt = buildArchitectPrompt(input, template);

    expect(prompt).not.toContain(`[0] ${template.charter.risks[0]}`);
    expect(prompt).toContain(`[1] ${template.charter.risks[1]}`);
  });
});

describe("wire schemas (src/schemas/architect.ts)", () => {
  it("accepts a real scoreAssessment() result as the maturity wire shape", () => {
    expect(() => maturityResultSchema.parse(planInput().maturity)).not.toThrow();
  });

  it("accepts the deterministic template as a response's charter and plan", () => {
    const input = planInput();
    const { charter, plan } = buildTemplate(input);
    const response = {
      maturity: input.maturity,
      charter,
      plan,
      hitlTier: "L3",
      approvalId: "ffffffff-0000-0000-0000-000000000099",
      source: "fallback",
      runId: null,
    };
    expect(() => architectPlanResponseSchema.parse(response)).not.toThrow();
  });

  it("rejects a response that claims L2 or a plan with a missing phase", () => {
    const input = planInput();
    const { charter, plan } = buildTemplate(input);
    const base = {
      maturity: input.maturity,
      charter,
      plan,
      hitlTier: "L3",
      approvalId: "ffffffff-0000-0000-0000-000000000099",
      source: "model",
      runId: "ffffffff-0000-0000-0000-000000000098",
    };
    expect(architectPlanResponseSchema.safeParse({ ...base, hitlTier: "L2" }).success).toBe(false);
    expect(
      architectPlanResponseSchema.safeParse({
        ...base,
        plan: { ...plan, phases: plan.phases.slice(0, 2) },
      }).success,
    ).toBe(false);
  });

  it("requires the 18 answers, the intake id and an idempotency key", () => {
    const ok = {
      scoutIntakeId: "cccccccc-0000-0000-0000-000000000001",
      idempotencyKey: "architect-submit-0001",
      answers: ANSWERS,
    };
    expect(architectPlanRequestSchema.safeParse(ok).success).toBe(true);
    expect(architectPlanRequestSchema.safeParse({ ...ok, idempotencyKey: undefined }).success).toBe(false);
    expect(architectPlanRequestSchema.safeParse({ ...ok, scoutIntakeId: "nope" }).success).toBe(false);

    const { q18_past_blockers: _dropped, ...seventeen } = ANSWERS;
    void _dropped;
    expect(architectPlanRequestSchema.safeParse({ ...ok, answers: seventeen }).success).toBe(false);
    expect(
      architectPlanRequestSchema.safeParse({
        ...ok,
        answers: { ...ANSWERS, q3_poc: "x".repeat(257) },
      }).success,
    ).toBe(false);
  });
});
