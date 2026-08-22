import { describe, expect, it } from "vitest";
import { scoreAssessment } from "../scoring";
import type { CsaScoredAnswers } from "../scoring";
import type { ScoutBucket } from "../../../types";

const DI: Record<
  1 | 2 | 3,
  Pick<
    CsaScoredAnswers,
    | "q4_collection_scope"
    | "q6_system_integration"
    | "q7_integration_familiarity"
    | "q8_quality_confidence"
  >
> = {
  1: {
    q4_collection_scope: "systematic",
    q6_system_integration: "own_island",
    q7_integration_familiarity: "very_familiar",
    q8_quality_confidence: "very_confident",
  },
  2: {
    q4_collection_scope: "systematic",
    q6_system_integration: "most_share_auto",
    q7_integration_familiarity: "somewhat_familiar",
    q8_quality_confidence: "very_confident",
  },
  3: {
    q4_collection_scope: "systematic",
    q6_system_integration: "most_share_auto",
    q7_integration_familiarity: "very_familiar",
    q8_quality_confidence: "very_confident",
  },
};

const GOV: Record<
  1 | 2 | 3,
  Pick<CsaScoredAnswers, "q13_reporting_automation">
> = {
  1: { q13_reporting_automation: "none_manual" },
  2: { q13_reporting_automation: "semi_automated" },
  3: { q13_reporting_automation: "mostly_automated" },
};

const TOOL: Record<1 | 2 | 3, Pick<CsaScoredAnswers, "q14_tools">> = {
  1: { q14_tools: ["spreadsheets"] },
  2: { q14_tools: ["crm_case_tool"] },
  3: { q14_tools: ["crm_case_tool", "reporting_analytics"] },
};

const DC: Record<
  1 | 2 | 3,
  Pick<CsaScoredAnswers, "q11_decision_empowerment">
> = {
  1: { q11_decision_empowerment: "not_from_data" },
  2: { q11_decision_empowerment: "leadership_managers" },
  3: { q11_decision_empowerment: "anyone_with_access" },
};

const TC: Record<
  1 | 2 | 3,
  Pick<CsaScoredAnswers, "q15_staff_confidence" | "q16_budget_speed">
> = {
  1: { q15_staff_confidence: "low_comfort", q16_budget_speed: "case_by_case" },
  2: {
    q15_staff_confidence: "some_adhoc",
    q16_budget_speed: "requires_approval",
  },
  3: { q15_staff_confidence: "dedicated_staff", q16_budget_speed: "fast" },
};

type Score = 1 | 2 | 3;

function answers(
  di: Score,
  gov: Score,
  tool: Score,
  dc: Score,
  tc: Score,
): CsaScoredAnswers {
  return { ...DI[di], ...GOV[gov], ...TOOL[tool], ...DC[dc], ...TC[tc] };
}

const BUCKET: ScoutBucket = "Data Infrastructure";

describe("scoreAssessment — dimension scoring", () => {
  it("scores each dimension from its own answers, independently", () => {
    const r = scoreAssessment(answers(3, 2, 1, 3, 2), BUCKET);
    expect(r.di_score).toBe(3);
    expect(r.gov_score).toBe(2);
    expect(r.tooling_score).toBe(1);
    expect(r.dc_score).toBe(3);
    expect(r.tc_score).toBe(2);
  });

  it("weights DI and Governance double (spec §2 step 2, max 21)", () => {
    expect(scoreAssessment(answers(3, 3, 3, 3, 3), BUCKET).points).toBe(21);
    expect(scoreAssessment(answers(1, 1, 1, 1, 1), BUCKET).points).toBe(7);
    expect(scoreAssessment(answers(3, 1, 1, 1, 1), BUCKET).points).toBe(11);
    expect(scoreAssessment(answers(1, 3, 1, 1, 1), BUCKET).points).toBe(11);
  });

  it("scores a reporting tool without a CRM as Developing (documented rubric extension)", () => {
    const reportingOnly = {
      ...answers(2, 2, 2, 2, 2),
      q14_tools: ["reporting_analytics"] as CsaScoredAnswers["q14_tools"],
    };
    expect(scoreAssessment(reportingOnly, BUCKET).tooling_score).toBe(2);
    const crmOnly = {
      ...answers(2, 2, 2, 2, 2),
      q14_tools: ["crm_case_tool"] as CsaScoredAnswers["q14_tools"],
    };
    expect(scoreAssessment(crmOnly, BUCKET).tooling_score).toBe(2);
    const neither = {
      ...answers(2, 2, 2, 2, 2),
      q14_tools: [] as CsaScoredAnswers["q14_tools"],
    };
    expect(scoreAssessment(neither, BUCKET).tooling_score).toBe(1);
  });

  it("treats any one of the three DI triggers as Foundational", () => {
    const base = answers(3, 3, 3, 3, 3);
    expect(
      scoreAssessment(
        { ...base, q4_collection_scope: "not_systematic" },
        BUCKET,
      ).di_score,
    ).toBe(1);
    expect(
      scoreAssessment({ ...base, q6_system_integration: "own_island" }, BUCKET)
        .di_score,
    ).toBe(1);
    expect(
      scoreAssessment(
        { ...base, q8_quality_confidence: "not_confident" },
        BUCKET,
      ).di_score,
    ).toBe(1);
  });
});

describe("scoreAssessment — band edges (spec §2: 7-11 / 12-16 / 17-21)", () => {
  it("11 is Foundational and 12 is Developing", () => {
    const eleven = scoreAssessment(answers(2, 2, 1, 1, 1), BUCKET);
    expect(eleven.points).toBe(11);
    expect(eleven.compositeLevel).toBe("Foundational");

    const twelve = scoreAssessment(answers(2, 2, 2, 1, 1), BUCKET);
    expect(twelve.points).toBe(12);
    expect(twelve.compositeLevel).toBe("Developing");
  });

  it("16 is Developing and 17 is Established", () => {
    const sixteen = scoreAssessment(answers(3, 2, 2, 2, 2), BUCKET);
    expect(sixteen.points).toBe(16);
    expect(sixteen.compositeLevel).toBe("Developing");

    const seventeen = scoreAssessment(answers(3, 2, 3, 2, 2), BUCKET);
    expect(seventeen.points).toBe(17);
    expect(seventeen.compositeLevel).toBe("Established");
  });

  it("bottoms out at Foundational and tops out at Established", () => {
    expect(scoreAssessment(answers(1, 1, 1, 1, 1), BUCKET).compositeLevel).toBe(
      "Foundational",
    );
    expect(scoreAssessment(answers(3, 3, 3, 3, 3), BUCKET).compositeLevel).toBe(
      "Established",
    );
  });
});

describe("scoreAssessment — DI override (spec §2 step 3)", () => {
  it("caps an Established-point total at Developing when DI is Foundational", () => {
    const r = scoreAssessment(answers(1, 3, 3, 3, 3), BUCKET);
    expect(r.points).toBe(17);
    expect(r.di_score).toBe(1);
    expect(r.compositeLevel).toBe("Developing");
    expect(r.overrideApplied).toBe(true);
  });

  it("leaves the same point total alone when DI is not Foundational", () => {
    const r = scoreAssessment(answers(3, 2, 3, 2, 2), BUCKET);
    expect(r.points).toBe(17);
    expect(r.compositeLevel).toBe("Established");
    expect(r.overrideApplied).toBe(false);
  });

  it("does not fire when DI is Foundational but the band is already below Established", () => {
    const r = scoreAssessment(answers(1, 3, 2, 2, 2), BUCKET);
    expect(r.points).toBe(14);
    expect(r.compositeLevel).toBe("Developing");
    expect(r.overrideApplied).toBe(false);
  });

  it("is scoped to DI alone — a Governance gap never overrides (spec §2 step 3)", () => {
    const r = scoreAssessment(answers(3, 1, 3, 3, 3), BUCKET);
    expect(r.points).toBe(17);
    expect(r.gov_score).toBe(1);
    expect(r.compositeLevel).toBe("Established");
    expect(r.overrideApplied).toBe(false);
  });
});

describe("scoreAssessment — flags and remediation scoping (spec §2 steps 4-5)", () => {
  it("flags DI and Governance independently, and nothing else", () => {
    expect(
      scoreAssessment(answers(1, 3, 1, 1, 1), BUCKET).flaggedDimensions,
    ).toEqual(["data_infrastructure"]);
    expect(
      scoreAssessment(answers(3, 1, 1, 1, 1), BUCKET).flaggedDimensions,
    ).toEqual(["governance"]);
    expect(
      scoreAssessment(answers(1, 1, 3, 3, 3), BUCKET).flaggedDimensions,
    ).toEqual(["data_infrastructure", "governance"]);
    expect(
      scoreAssessment(answers(3, 3, 1, 1, 1), BUCKET).flaggedDimensions,
    ).toEqual([]);
  });

  it("flags independently of whether the override triggered (spec §2 step 4)", () => {
    const overridden = scoreAssessment(answers(1, 3, 3, 3, 3), BUCKET);
    expect(overridden.overrideApplied).toBe(true);
    expect(overridden.flaggedDimensions).toContain("data_infrastructure");

    const notOverridden = scoreAssessment(answers(1, 3, 2, 2, 2), BUCKET);
    expect(notOverridden.overrideApplied).toBe(false);
    expect(notOverridden.flaggedDimensions).toContain("data_infrastructure");
  });

  it("makes 2+ flags remediation-only, 1 flag not", () => {
    expect(
      scoreAssessment(answers(1, 3, 3, 3, 3), BUCKET).remediationOnly,
    ).toBe(false);
    expect(
      scoreAssessment(answers(3, 1, 3, 3, 3), BUCKET).remediationOnly,
    ).toBe(false);
    expect(
      scoreAssessment(answers(1, 1, 3, 3, 3), BUCKET).remediationOnly,
    ).toBe(true);
    expect(
      scoreAssessment(answers(3, 3, 1, 1, 1), BUCKET).remediationOnly,
    ).toBe(false);
  });
});

describe("scoreAssessment — Scout cross-check (spec §2)", () => {
  it("sets the flag for a Foundational org in the ML / Predictive bucket", () => {
    const r = scoreAssessment(answers(1, 1, 1, 1, 1), "ML / Predictive");
    expect(r.compositeLevel).toBe("Foundational");
    expect(r.crossCheckFlag).toContain("redirect");
  });

  it("leaves it null for a Foundational org in any other bucket", () => {
    expect(
      scoreAssessment(answers(1, 1, 1, 1, 1), "Data Infrastructure")
        .crossCheckFlag,
    ).toBeNull();
    expect(
      scoreAssessment(answers(1, 1, 1, 1, 1), "Analytics & Insight")
        .crossCheckFlag,
    ).toBeNull();
    expect(
      scoreAssessment(answers(1, 1, 1, 1, 1), "Advisory / Strategy")
        .crossCheckFlag,
    ).toBeNull();
  });

  it("leaves it null for an ML / Predictive org above Foundational", () => {
    expect(
      scoreAssessment(answers(3, 3, 3, 3, 3), "ML / Predictive").crossCheckFlag,
    ).toBeNull();
  });

  it("does not fire for an overridden org, whose DI is Foundational but level is not", () => {
    const r = scoreAssessment(answers(1, 3, 3, 3, 3), "ML / Predictive");
    expect(r.di_score).toBe(1);
    expect(r.overrideApplied).toBe(true);
    expect(r.compositeLevel).toBe("Developing");
    expect(r.crossCheckFlag).toBeNull();
  });
});
