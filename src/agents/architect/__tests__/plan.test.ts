import { describe, expect, it } from "vitest";
import {
  generateCharter,
  generateNinetyDayPlan,
} from "../plan";
import type { PlanGenerationInput } from "../plan";
import type { MaturityResult } from "../scoring";
import type {
  CompositeLevel,
  FlaggedDimension,
  ScoutBucket,
} from "../../../types";

function maturity(
  over: Partial<MaturityResult> & { compositeLevel: CompositeLevel },
): MaturityResult {
  const flaggedDimensions: FlaggedDimension[] = over.flaggedDimensions ?? [];
  return {
    di_score: 2,
    gov_score: 2,
    tooling_score: 2,
    dc_score: 2,
    tc_score: 2,
    points: 14,
    overrideApplied: false,
    remediationOnly: flaggedDimensions.length >= 2,
    crossCheckFlag: null,
    ...over,
    flaggedDimensions,
  };
}

function input(
  m: MaturityResult,
  over: Partial<PlanGenerationInput> = {},
): PlanGenerationInput {
  return {
    orgName: "Harbor House",
    bucket: "Analytics & Insight" as ScoutBucket,
    maturity: m,
    q1_org_context: "Housing services for 400 families.",
    q9_current_decisions: "Monthly board packet.",
    q10_wished_decisions: "Spot which families are at risk earlier.",
    q17a_wish_list: "One dashboard.",
    q17b_biggest_worry: "",
    q18_past_blockers: "",
    ...over,
  };
}

describe("generateNinetyDayPlan — shape selection (spec §3)", () => {
  it("gives a Foundational org build_basics", () => {
    expect(
      generateNinetyDayPlan(input(maturity({ compositeLevel: "Foundational" })))
        .shape,
    ).toBe("build_basics");
  });

  it("gives a Developing org ship_deliverable", () => {
    expect(
      generateNinetyDayPlan(input(maturity({ compositeLevel: "Developing" })))
        .shape,
    ).toBe("ship_deliverable");
  });

  it("gives an Established org accelerate", () => {
    expect(
      generateNinetyDayPlan(input(maturity({ compositeLevel: "Established" })))
        .shape,
    ).toBe("accelerate");
  });

  it("gives a two-flag Developing org remediation_only, which wins over ship_deliverable", () => {
    const m = maturity({
      compositeLevel: "Developing",
      flaggedDimensions: ["data_infrastructure", "governance"],
    });
    expect(m.remediationOnly).toBe(true);
    expect(generateNinetyDayPlan(input(m)).shape).toBe("remediation_only");
  });

  it("keeps a two-flag Foundational org on build_basics — level outranks remediation", () => {
    const m = maturity({
      compositeLevel: "Foundational",
      flaggedDimensions: ["data_infrastructure", "governance"],
    });
    expect(m.remediationOnly).toBe(true);
    const plan = generateNinetyDayPlan(input(m));
    expect(plan.shape).toBe("build_basics");
    expect(plan.phase2Note).toBeUndefined();
  });
});

describe("generateNinetyDayPlan — phase2Note defers the deliverable", () => {
  it("sets it on remediation_only and names the bucket deliverable", () => {
    const m = maturity({
      compositeLevel: "Developing",
      flaggedDimensions: ["data_infrastructure", "governance"],
    });
    const plan = generateNinetyDayPlan(
      input(m, { bucket: "Analytics & Insight" }),
    );
    expect(plan.phase2Note).toContain("Board-Facing Insight Report");
    expect(plan.phase2Note).toContain("Analytics & Insight");
  });

  it("leaves it undefined on every other shape", () => {
    for (const level of [
      "Foundational",
      "Developing",
      "Established",
    ] as CompositeLevel[]) {
      expect(
        generateNinetyDayPlan(input(maturity({ compositeLevel: level })))
          .phase2Note,
      ).toBeUndefined();
    }
  });
});

describe("generateNinetyDayPlan — workstreams", () => {
  it("makes every flagged dimension a required workstream", () => {
    const m = maturity({
      compositeLevel: "Developing",
      flaggedDimensions: ["data_infrastructure", "governance"],
    });
    const ws = generateNinetyDayPlan(input(m)).workstreams;
    expect(ws.map((w) => w.name)).toEqual([
      "Data Integration & Hygiene",
      "Reporting Automation",
    ]);
    expect(ws.every((w) => w.required)).toBe(true);
  });

  it("attaches the bucket deliverable as not-required alongside flagged work", () => {
    const m = maturity({
      compositeLevel: "Developing",
      flaggedDimensions: ["governance"],
    });
    const ws = generateNinetyDayPlan(
      input(m, { bucket: "Tooling & Automation" }),
    ).workstreams;
    expect(ws.find((w) => w.name === "Reporting Automation")?.required).toBe(
      true,
    );
    expect(
      ws.find((w) => w.name === "Operational Dashboard v1")?.required,
    ).toBe(false);
  });

  it("carries only the deliverable when nothing is flagged", () => {
    const ws = generateNinetyDayPlan(
      input(maturity({ compositeLevel: "Established" })),
    ).workstreams;
    expect(ws).toHaveLength(1);
    expect(ws[0].required).toBe(false);
  });

  it("carries only flagged work on build_basics — no deliverable is promised", () => {
    const m = maturity({
      compositeLevel: "Foundational",
      flaggedDimensions: ["data_infrastructure"],
    });
    const ws = generateNinetyDayPlan(input(m)).workstreams;
    expect(ws.map((w) => w.name)).toEqual(["Data Integration & Hygiene"]);
  });
});

describe("generateNinetyDayPlan — windows", () => {
  it("returns exactly the three windows, in order, on every shape", () => {
    const cases: MaturityResult[] = [
      maturity({ compositeLevel: "Foundational" }),
      maturity({ compositeLevel: "Developing" }),
      maturity({ compositeLevel: "Established" }),
      maturity({
        compositeLevel: "Developing",
        flaggedDimensions: ["data_infrastructure", "governance"],
      }),
    ];
    for (const m of cases) {
      const plan = generateNinetyDayPlan(input(m));
      expect(plan.phases.map((p) => p.window)).toEqual([
        "Days 1–30",
        "Days 31–60",
        "Days 61–90",
      ]);
      expect(plan.phases.every((p) => p.milestones.length > 0)).toBe(true);
    }
  });
});

describe("generateCharter — risks (spec §3)", () => {
  it("leads with the cross-check when Scout and maturity disagree", () => {
    const m = maturity({
      compositeLevel: "Foundational",
      crossCheckFlag:
        "Foundational maturity vs. ML / Predictive bucket — redirect.",
    });
    const risks = generateCharter(
      input(m, { bucket: "ML / Predictive" }),
    ).risks;
    expect(risks[0]).toContain("CROSS-CHECK");
  });

  it("records the override as its own risk line", () => {
    const m = maturity({
      compositeLevel: "Developing",
      overrideApplied: true,
      points: 17,
    });
    const risks = generateCharter(input(m)).risks;
    expect(
      risks.some((r) => r.includes("capped this engagement at Developing")),
    ).toBe(true);
  });

  it("names each flagged workstream as non-skippable", () => {
    const m = maturity({
      compositeLevel: "Developing",
      flaggedDimensions: ["data_infrastructure", "governance"],
    });
    const risks = generateCharter(input(m)).risks;
    expect(
      risks.some((r) =>
        r.startsWith("Data Integration & Hygiene is a required workstream"),
      ),
    ).toBe(true);
    expect(
      risks.some((r) =>
        r.startsWith("Reporting Automation is a required workstream"),
      ),
    ).toBe(true);
  });

  it("includes the org's own worry and past blockers only when non-empty", () => {
    const m = maturity({ compositeLevel: "Developing" });
    const withText = generateCharter(
      input(m, {
        q17b_biggest_worry: "Staff turnover",
        q18_past_blockers: "No budget",
      }),
    ).risks;
    expect(withText.some((r) => r.includes("Staff turnover"))).toBe(true);
    expect(withText.some((r) => r.includes("No budget"))).toBe(true);

    const blank = generateCharter(
      input(m, { q17b_biggest_worry: "   ", q18_past_blockers: "\n" }),
    ).risks;
    expect(blank.some((r) => r.includes("stated worry"))).toBe(false);
    expect(blank.some((r) => r.includes("blocked this work before"))).toBe(
      false,
    );
  });

  it("falls back to standard engagement risk when nothing else applies", () => {
    const risks = generateCharter(
      input(maturity({ compositeLevel: "Developing" })),
    ).risks;
    expect(risks).toHaveLength(1);
    expect(risks[0]).toContain("No structural risks flagged");
  });

  it("drops the fallback as soon as any real risk exists", () => {
    const m = maturity({
      compositeLevel: "Developing",
      flaggedDimensions: ["governance"],
    });
    const risks = generateCharter(input(m)).risks;
    expect(risks.some((r) => r.includes("No structural risks flagged"))).toBe(
      false,
    );
  });
});

describe("generateCharter — scope and composition", () => {
  it("scopes a Foundational engagement away from promising analysis", () => {
    const charter = generateCharter(
      input(maturity({ compositeLevel: "Foundational" })),
    );
    expect(charter.scopeStatement).toContain(
      "No analysis or modeling is promised",
    );
  });

  it("names both workstreams as the deliverable on a remediation-only charter", () => {
    const m = maturity({
      compositeLevel: "Developing",
      flaggedDimensions: ["data_infrastructure", "governance"],
    });
    const charter = generateCharter(input(m));
    expect(charter.scopeStatement).toContain("Remediation-only");
    expect(charter.scopeStatement).toContain(
      "Data Integration & Hygiene and Reporting Automation",
    );
  });

  it("derives objectives from the plan phases it generated", () => {
    const charter = generateCharter(
      input(maturity({ compositeLevel: "Established" })),
    );
    expect(charter.objectives).toEqual([
      "Days 1–30: Align & Sprint",
      "Days 31–60: Deepen",
      "Days 61–90: Land & Extend",
    ]);
  });

  it("shares one workstream list with the plan", () => {
    const m = maturity({
      compositeLevel: "Developing",
      flaggedDimensions: ["governance"],
    });
    const built = input(m);
    expect(generateCharter(built).workstreams).toEqual(
      generateNinetyDayPlan(built).workstreams,
    );
  });

  it("tightens cadence for a Foundational org only", () => {
    expect(
      generateCharter(input(maturity({ compositeLevel: "Foundational" })))
        .cadence,
    ).toContain("weekly");
    expect(
      generateCharter(input(maturity({ compositeLevel: "Developing" })))
        .cadence,
    ).toContain("Standard cadence");
    expect(
      generateCharter(input(maturity({ compositeLevel: "Established" })))
        .cadence,
    ).toContain("Standard cadence");
  });

  it("omits empty background fields rather than emitting blank lines", () => {
    const charter = generateCharter(
      input(maturity({ compositeLevel: "Developing" }), {
        q1_org_context: "Housing services.",
        q9_current_decisions: "",
        q10_wished_decisions: "",
        q17a_wish_list: "",
      }),
    );
    expect(charter.background).toBe("Housing services.");
  });
});
