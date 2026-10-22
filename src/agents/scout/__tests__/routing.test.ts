import { describe, expect, it } from "vitest";
import {
  getOnboardingKitName,
  routeScoutIntake,
} from "../routing";
import type {
  ScoutBucket,
  ScoutCompositeSignal,
  ScoutConfidence,
  ScoutHitlTier,
  ScoutRoutingInput,
} from "../../../types";

const BASE: ScoutRoutingInput = {
  scale: "40 full-time staff",
  primary_need: "analyze_data",
  problem_description:
    "We need to analyze three years of program participation data to report trends to our board, " +
    "and we cannot currently produce that report without weeks of manual spreadsheet work.",
  current_systems: "Salesforce CRM and a Postgres database",
  contact_name_role: "Dana Whitfield, Executive Director",
  timeline: "this quarter",
};

const intake = (
  overrides: Partial<ScoutRoutingInput> = {},
): ScoutRoutingInput => ({
  ...BASE,
  ...overrides,
});

describe("routeScoutIntake — bucket assignment", () => {
  const cases: Array<{
    name: string;
    input: ScoutRoutingInput;
    bucket: ScoutBucket | null;
    confidence: ScoutConfidence;
  }> = [
    {
      name: "Q6 and Q7 agree → High confidence, Q6 bucket",
      input: intake(),
      bucket: "Analytics & Insight",
      confidence: "High",
    },
    {
      name: "Q7 contradicts Q6 → re-buckets to Q7, Low confidence",
      input: intake({
        primary_need: "analyze_data",
        problem_description:
          "We want to predict which donors are at risk of lapsing so we can intervene early, " +
          "using a risk score for each supporter in our database.",
      }),
      bucket: "ML / Predictive",
      confidence: "Low",
    },
    {
      name: "each Q6 value maps to its default bucket when Q7 agrees",
      input: intake({
        primary_need: "organize_data",
        problem_description:
          "Our records are messy and spread across many systems; we need to consolidate and " +
          "migrate them into one clean pipeline that staff can actually rely on day to day.",
      }),
      bucket: "Data Infrastructure",
      confidence: "High",
    },
  ];

  for (const { name, input, bucket, confidence } of cases) {
    it(name, () => {
      const result = routeScoutIntake(input);
      expect(result.bucket).toBe(bucket);
      expect(result.confidence).toBe(confidence);
    });
  }

  it("'something else' never auto-buckets and always lands in L3", () => {
    const result = routeScoutIntake(
      intake({
        primary_need: "something_else",
        primary_need_other: "board governance training",
      }),
    );
    expect(result.bucket).toBeNull();
    expect(result.confidence).toBeNull();
    expect(result.hitlTier).toBe("L3");
    expect(result.rationale).toContain("board governance training");
    expect(result.composite_signal).toBeTruthy();
  });
});

describe("routeScoutIntake — tiebreaker", () => {
  const ambiguous =
    "We need a dashboard and also want to predict future demand, plus our data is messy " +
    "and needs cleaning before any of that can happen at all.";

  it("small org with minimal systems routes to Advisory regardless of the stated ask", () => {
    const result = routeScoutIntake(
      intake({
        scale: "just me and 3 volunteers",
        current_systems: "a few google sheets",
        problem_description: ambiguous,
      }),
    );
    expect(result.bucket).toBe("Advisory / Strategy");
    expect(result.confidence).toBe("Low");
  });

  it("large org with real systems keeps the Q6 bucket at Medium confidence", () => {
    const result = routeScoutIntake(
      intake({
        scale: "250 full-time staff",
        current_systems: "Salesforce and a data warehouse",
        problem_description: ambiguous,
      }),
    );
    expect(result.bucket).toBe("Analytics & Insight");
    expect(result.confidence).toBe("Medium");
  });

  it("ambiguous signals default to Advisory", () => {
    const result = routeScoutIntake(
      intake({
        scale: "about 30 people",
        current_systems: "some internal tools",
        problem_description: ambiguous,
      }),
    );
    expect(result.bucket).toBe("Advisory / Strategy");
    expect(result.confidence).toBe("Low");
  });

  it("a vague description is flagged and never yields High confidence", () => {
    const result = routeScoutIntake(
      intake({ problem_description: "we need help" }),
    );
    expect(result.flags).toContain("vague problem description");
    expect(result.confidence).not.toBe("High");
  });
});

describe("routeScoutIntake — readiness scoring", () => {
  it("scores all three dimensions at 3 for a well-formed intake", () => {
    const result = routeScoutIntake(intake());
    expect(result.poc_score).toBe(3);
    expect(result.clarity_score).toBe(3);
    expect(result.foothold_score).toBe(3);
    expect(result.composite_signal).toBe("Ready");
  });

  it("any dimension at 1 forces Conditional even when the others are strong", () => {
    const result = routeScoutIntake(intake({ current_systems: "nothing yet" }));
    expect(result.foothold_score).toBe(1);
    expect(result.composite_signal).toBe("Conditional");
  });

  const pocCases: Array<{
    name: string;
    role: string;
    timeline: string;
    score: 1 | 2 | 3;
  }> = [
    {
      name: "role and timeline",
      role: "Dana Whitfield, Executive Director",
      timeline: "Q3",
      score: 3,
    },
    {
      name: "role only",
      role: "Dana Whitfield, Executive Director",
      timeline: "whenever",
      score: 2,
    },
    {
      name: "timeline only",
      role: "someone",
      timeline: "this month",
      score: 2,
    },
    { name: "neither", role: "someone", timeline: "whenever", score: 1 },
  ];

  for (const { name, role, timeline, score } of pocCases) {
    it(`point-of-contact score is ${score} with ${name}`, () => {
      expect(
        routeScoutIntake(intake({ contact_name_role: role, timeline }))
          .poc_score,
      ).toBe(score);
    });
  }

  it("empty current systems scores foothold at 1", () => {
    expect(
      routeScoutIntake(intake({ current_systems: "" })).foothold_score,
    ).toBe(1);
  });
});

describe("routeScoutIntake — HITL tiering", () => {
  const tierCases: Array<{
    name: string;
    input: ScoutRoutingInput;
    tier: ScoutHitlTier;
  }> = [
    { name: "High confidence + Ready → L2", input: intake(), tier: "L2" },
    {
      name: "High confidence but not Ready → L3",
      input: intake({ current_systems: "nothing yet" }),
      tier: "L3",
    },
    {
      name: "Ready but low confidence → L3",
      input: intake({
        problem_description:
          "We want to predict which donors are at risk of lapsing so we can intervene early, " +
          "using a risk score for each supporter in our database.",
      }),
      tier: "L3",
    },
  ];

  for (const { name, input, tier } of tierCases) {
    it(name, () => {
      expect(routeScoutIntake(input).hitlTier).toBe(tier);
    });
  }

  it("L2 requires both High confidence and a Ready signal", () => {
    const result = routeScoutIntake(intake());
    const expected: ScoutHitlTier =
      result.confidence === "High" &&
      (result.composite_signal as ScoutCompositeSignal) === "Ready"
        ? "L2"
        : "L3";
    expect(result.hitlTier).toBe(expected);
  });
});

describe("getOnboardingKitName", () => {
  const buckets: ScoutBucket[] = [
    "Data Infrastructure",
    "Analytics & Insight",
    "ML / Predictive",
    "Tooling & Automation",
    "Advisory / Strategy",
  ];

  it("returns a distinct kit for every bucket", () => {
    const kits = buckets.map(getOnboardingKitName);
    expect(new Set(kits).size).toBe(buckets.length);
    expect(kits.every((kit) => kit.length > 0)).toBe(true);
  });
});
