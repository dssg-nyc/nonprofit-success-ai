import { describe, expect, it } from "vitest";
import {
  BUCKET_DELIVERABLES,
  DATA_FOUNDATIONS,
  WORKSTREAM_DEFS,
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

  it("keeps a flagged Governance workstream on accelerate — an Established org can carry one", () => {
    // di=3, gov=1, the rest 3: 6 + 2 + 9 = 17 points, Established, one flag.
    const m = maturity({
      compositeLevel: "Established",
      di_score: 3,
      gov_score: 1,
      tooling_score: 3,
      dc_score: 3,
      tc_score: 3,
      points: 17,
      flaggedDimensions: ["governance"],
    });
    const plan = generateNinetyDayPlan(input(m));
    expect(plan.shape).toBe("accelerate");
    expect(plan.workstreams.map((w) => [w.name, w.required])).toEqual([
      ["Reporting Automation", true],
      ["Board-Facing Insight Report", false],
    ]);
    expect(generateCharter(input(m)).workstreams).toEqual(plan.workstreams);
  });

  it("carries only flagged work on build_basics — no deliverable is promised", () => {
    const m = maturity({
      compositeLevel: "Foundational",
      flaggedDimensions: ["data_infrastructure"],
    });
    const ws = generateNinetyDayPlan(input(m)).workstreams;
    expect(ws.map((w) => w.name)).toEqual(["Data Integration & Hygiene"]);
  });

  it("names Data Foundations as the required workstream on build_basics when nothing is flagged", () => {
    const m = maturity({ compositeLevel: "Foundational", flaggedDimensions: [] });
    const ws = generateNinetyDayPlan(input(m)).workstreams;
    expect(ws.map((w) => [w.name, w.required])).toEqual([["Data Foundations", true]]);
    expect(generateCharter(input(m)).workstreams).toEqual(ws);
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

describe("generateCharter — success criteria follow the deliverable (R18)", () => {
  const BASICS = [
    "Systematic collection running in at least two programs",
    "One internal from-live-data summary produced",
    "Org staff can state where every data type lives",
  ];
  const RECURRING_REPORT =
    "One recurring report produced from the new pipeline without manual steps";
  const ROADMAP = "Roadmap adopted by the board with a named owner per initiative";
  const MODEL =
    "Model evaluated against a held-out period with its error stated to the org";

  it("build_basics promises the basics only — no pipeline, roadmap or model", () => {
    const criteria = generateCharter(
      input(maturity({ compositeLevel: "Foundational" }), {
        bucket: "Advisory / Strategy",
      }),
    ).successCriteria;
    expect(criteria).toEqual(BASICS);
  });

  it("remediation_only promises the flags cleared, never the deferred deliverable", () => {
    const m = maturity({
      compositeLevel: "Developing",
      flaggedDimensions: ["data_infrastructure", "governance"],
    });
    const criteria = generateCharter(input(m, { bucket: "ML / Predictive" }))
      .successCriteria;
    expect(criteria).toEqual([
      "Each flagged dimension has a named owner and a written procedure in use",
      "Documentation and reporting rhythm handed off to staff",
      "Phase 2 charter ready if flags cleared",
    ]);
  });

  it.each<[ScoutBucket, string]>([
    ["Data Infrastructure", RECURRING_REPORT],
    ["Analytics & Insight", RECURRING_REPORT],
    ["Tooling & Automation", RECURRING_REPORT],
    ["Advisory / Strategy", ROADMAP],
    ["ML / Predictive", MODEL],
  ])("ship_deliverable on %s ends with the criterion its deliverable supports", (bucket, last) => {
    const criteria = generateCharter(
      input(maturity({ compositeLevel: "Developing" }), { bucket }),
    ).successCriteria;
    expect(criteria).toEqual([
      `${BUCKET_DELIVERABLES[bucket].name} delivered and in real use by day 90`,
      "Org staff trained to own the deliverable independently",
      last,
    ]);
  });

  it.each<[ScoutBucket, string]>([
    ["Data Infrastructure", RECURRING_REPORT],
    ["Advisory / Strategy", ROADMAP],
    ["ML / Predictive", MODEL],
  ])("accelerate on %s ends with the same deliverable criterion", (bucket, last) => {
    const criteria = generateCharter(
      input(maturity({ compositeLevel: "Established" }), { bucket }),
    ).successCriteria;
    expect(criteria.at(-1)).toBe(last);
  });

  it("a roadmap or a model is never promised a pipeline or a recurring report", () => {
    for (const bucket of ["Advisory / Strategy", "ML / Predictive"] as ScoutBucket[]) {
      for (const level of ["Developing", "Established"] as CompositeLevel[]) {
        const criteria = generateCharter(
          input(maturity({ compositeLevel: level }), { bucket }),
        ).successCriteria;
        expect(criteria.some((c) => /pipeline|recurring report/i.test(c))).toBe(false);
      }
    }
  });

  it("keeps the governance owner line beside the deliverable criterion when governance is flagged", () => {
    const m = maturity({
      compositeLevel: "Developing",
      flaggedDimensions: ["governance"],
    });
    const criteria = generateCharter(input(m, { bucket: "ML / Predictive" }))
      .successCriteria;
    expect(criteria).toContain(
      "Every recurring funder and board report has a named owner and a documented data source",
    );
    expect(criteria.at(-1)).toBe(MODEL);
  });

  it("names the override criterion from the deliverable, then the kind's own", () => {
    const m = maturity({
      compositeLevel: "Developing",
      overrideApplied: true,
      points: 17,
    });
    const criteria = generateCharter(input(m, { bucket: "Advisory / Strategy" }))
      .successCriteria;
    expect(criteria[0]).toContain("Data-Strategy Roadmap delivered by day 90 on the data that is already integrated");
    expect(criteria.at(-1)).toBe(ROADMAP);
  });
});

describe("generateCharter — required means flagged (R18)", () => {
  it("calls nothing required in the zero-flag Foundational scope, though Data Foundations still stands in", () => {
    const m = maturity({ compositeLevel: "Foundational", flaggedDimensions: [] });
    const charter = generateCharter(input(m));
    expect(charter.scopeStatement).not.toContain("required");
    expect(charter.scopeStatement).not.toContain("Data Foundations");
    expect(charter.workstreams).toEqual([DATA_FOUNDATIONS]);
  });

  it("names the flagged workstream as required in the Foundational scope", () => {
    const m = maturity({
      compositeLevel: "Foundational",
      flaggedDimensions: ["data_infrastructure"],
    });
    expect(generateCharter(input(m)).scopeStatement).toContain(
      "with the required Data Integration & Hygiene workstream running inside them",
    );
  });

  it("describes a required workstream as flagged on its dimension, never as flagged Foundational", () => {
    for (const def of Object.values(WORKSTREAM_DEFS)) {
      expect(def.description).not.toMatch(/flagged Foundational/);
      expect(def.description).toMatch(/flagged on the (Data Infrastructure|Governance) dimension/);
    }
  });
});
