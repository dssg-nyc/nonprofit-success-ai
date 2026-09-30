import { describe, expect, it } from "vitest";
import {
  THIN_EVENT_THRESHOLD,
  assessChronicleReadiness,
  generateChronicleDraft,
} from "../draft";
import {
  chronicleDraftSchema,
  chronicleModelSchema,
} from "../schema";
import type { ChronicleInput } from "../../../types/chronicle";

const READY: ChronicleInput = {
  engagementId: "e-201",
  orgName: "Harbor Youth Collective",
  status: "completed",
  hasPlan: true,
  eventCount: 12,
  objectives: [
    "Report programme outcomes to funders without manual spreadsheet work",
  ],
  successCriteria: ["Quarterly funder report produced in under a day"],
};

function readiness(overrides: Partial<ChronicleInput> = {}) {
  return assessChronicleReadiness({ ...READY, ...overrides });
}

function draft(overrides: Partial<ChronicleInput> = {}) {
  return generateChronicleDraft({ ...READY, ...overrides });
}

describe("assessChronicleReadiness", () => {
  it("is ready when the engagement is completed, planned, and well recorded", () => {
    expect(readiness()).toBe("ready");
  });

  it.each(["in_progress", "on_hold", "cancelled"])(
    "is not_ready while status is %s, however good the record",
    (status) => {
      expect(readiness({ status, hasPlan: true, eventCount: 40 })).toBe(
        "not_ready",
      );
    },
  );

  it("is not_ready when nothing at all is on record", () => {
    expect(readiness({ hasPlan: false, eventCount: 0 })).toBe("not_ready");
  });

  it("is thin when there is no plan to measure against", () => {
    expect(readiness({ hasPlan: false, eventCount: 8 })).toBe("thin");
  });

  it.each([
    [0, "thin"],
    [THIN_EVENT_THRESHOLD - 1, "thin"],
    [THIN_EVENT_THRESHOLD, "ready"],
  ] as const)(
    "%i recorded events with a plan is %s",
    (eventCount, expected) => {
      expect(readiness({ eventCount })).toBe(expected);
    },
  );

  it("produces every declared readiness value", () => {
    const produced = new Set([
      readiness(),
      readiness({ eventCount: 1 }),
      readiness({ status: "in_progress" }),
    ]);
    expect([...produced].sort()).toEqual(["not_ready", "ready", "thin"]);
  });
});

describe("the not_ready short-circuit", () => {
  it("returns nothing rather than a placeholder story", () => {
    const result = draft({ status: "in_progress" });
    expect(result.headline).toBe("");
    expect(result.narrative).toBe("");
    expect(result.outcomes).toEqual([]);
  });

  it("suppresses the story even when objectives were supplied", () => {
    const result = draft({
      status: "in_progress",
      objectives: ["Do the thing"],
    });
    expect(result.narrative).toBe("");
    expect(result.outcomes).toEqual([]);
  });

  it("still returns a well-formed, tiered payload", () => {
    const result = draft({ status: "in_progress" });
    expect(result.readiness).toBe("not_ready");
    expect(result.hitlTier).toBe("L3");
    expect(() => chronicleDraftSchema.parse(result)).not.toThrow();
  });
});

describe("generateChronicleDraft — ready", () => {
  it("names the organisation and writes a story", () => {
    const result = draft();
    expect(result.headline).toContain("Harbor Youth Collective");
    expect(result.narrative).toContain("Harbor Youth Collective");
  });

  it("draws outcomes from the success criteria", () => {
    expect(draft().outcomes).toEqual([
      "Quarterly funder report produced in under a day",
    ]);
  });

  it("falls back to objectives when no success criteria were recorded", () => {
    const result = draft({ successCriteria: undefined });
    expect(result.outcomes).toEqual(READY.objectives);
  });

  it("claims no outcomes when neither was recorded", () => {
    expect(
      draft({ objectives: undefined, successCriteria: undefined }).outcomes,
    ).toEqual([]);
  });

  it("grounds the narrative in the recorded event count", () => {
    expect(draft().narrative).toContain("12 recorded touchpoints");
  });
});

describe("generateChronicleDraft — thin", () => {
  it("states its own provisionality inside the narrative", () => {
    const result = draft({ eventCount: 1 });
    expect(result.readiness).toBe("thin");
    expect(result.narrative).toContain("provisional");
  });

  it("does not cite a touchpoint count it cannot stand behind", () => {
    expect(draft({ eventCount: 1 }).narrative).not.toContain(
      "recorded touchpoints",
    );
  });

  it("is thin by way of a missing plan too", () => {
    const result = draft({ hasPlan: false, eventCount: 8 });
    expect(result.readiness).toBe("thin");
    expect(result.narrative).toContain("provisional");
  });
});

describe("draft invariants", () => {
  const cases: Array<[string, Partial<ChronicleInput>]> = [
    ["ready", {}],
    ["thin by event count", { eventCount: 1 }],
    ["thin by missing plan", { hasPlan: false, eventCount: 8 }],
    ["not_ready in progress", { status: "in_progress" }],
    ["not_ready with no record", { hasPlan: false, eventCount: 0 }],
  ];

  it.each(cases)(
    "%s carries the engagement id through unchanged",
    (_label, overrides) => {
      expect(draft({ ...overrides, engagementId: "e-777" }).engagementId).toBe(
        "e-777",
      );
    },
  );

  it.each(cases)(
    "%s is L3 — no story publishes unreviewed",
    (_label, overrides) => {
      expect(draft(overrides).hitlTier).toBe("L3");
    },
  );

  it.each(cases)(
    "%s satisfies the schema the API promises",
    (_label, overrides) => {
      expect(() => chronicleDraftSchema.parse(draft(overrides))).not.toThrow();
    },
  );

  it.each(cases)(
    "%s never leaks an undefined into prose",
    (_label, overrides) => {
      const result = draft(overrides);
      expect(
        result.headline + result.narrative + result.outcomes.join(" "),
      ).not.toContain("undefined");
    },
  );
});

describe("chronicleModelSchema", () => {
  it("does not let the model set its own readiness", () => {
    expect("readiness" in chronicleModelSchema.shape).toBe(false);
  });

  it("does not let the model set its own hitlTier", () => {
    expect("hitlTier" in chronicleModelSchema.shape).toBe(false);
  });

  it("does not let the model restate the engagement id", () => {
    expect("engagementId" in chronicleModelSchema.shape).toBe(false);
  });

  it("permits empty story fields, unlike Envoy", () => {
    expect(() =>
      chronicleModelSchema.parse({ headline: "", narrative: "", outcomes: [] }),
    ).not.toThrow();
  });

  it("accepts the story fields a model is asked to write", () => {
    expect(() =>
      chronicleModelSchema.parse({
        headline: "Faster funder reporting",
        narrative: "The organisation cut its reporting time.",
        outcomes: ["Reports produced in a day"],
      }),
    ).not.toThrow();
  });
});
