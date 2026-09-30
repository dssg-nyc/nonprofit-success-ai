import { describe, expect, it } from "vitest";
import { generateEnvoyDraft } from "../draft";
import {
  ENVOY_OCCASIONS,
  buildEnvoyPrompt,
  envoyDraftSchema,
  envoyModelSchema,
} from "../schema";
import type { EnvoyInput } from "../../../types/envoy";

const BASE: EnvoyInput = {
  engagementId: "e-101",
  occasion: "kickoff",
  orgName: "Harbor Youth Collective",
  planTitle: "Outcome reporting for funder renewals",
  cadence: "fortnightly Thursday calls",
};

function draft(overrides: Partial<EnvoyInput> = {}) {
  return generateEnvoyDraft({ ...BASE, ...overrides });
}

describe("generateEnvoyDraft", () => {
  it.each(ENVOY_OCCASIONS)("produces a complete draft for %s", (occasion) => {
    const result = draft({ occasion });
    expect(result.subject.length).toBeGreaterThan(0);
    expect(result.body.length).toBeGreaterThan(0);
    expect(result.occasion).toBe(occasion);
  });

  it.each(ENVOY_OCCASIONS)(
    "addresses the organisation by name for %s",
    (occasion) => {
      expect(draft({ occasion }).body).toContain("Harbor Youth Collective");
    },
  );

  it.each(ENVOY_OCCASIONS)(
    "is L3 for %s — nothing reaches a partner unreviewed",
    (occasion) => {
      expect(draft({ occasion }).hitlTier).toBe("L3");
    },
  );

  it.each(ENVOY_OCCASIONS)("satisfies the schema for %s", (occasion) => {
    expect(() => envoyDraftSchema.parse(draft({ occasion }))).not.toThrow();
  });

  it("carries the engagement id through unchanged", () => {
    expect(draft({ engagementId: "e-999" }).engagementId).toBe("e-999");
  });
});

describe("charter cadence", () => {
  it("restates an agreed cadence verbatim", () => {
    expect(draft({ cadence: "fortnightly Thursday calls" }).body).toContain(
      "fortnightly Thursday calls",
    );
  });

  it("proposes agreeing one when none was supplied", () => {
    const body = draft({ cadence: undefined }).body;
    expect(body).toContain("agree a check-in rhythm");
  });

  it("does not name a rhythm that was never supplied", () => {
    const body = draft({ cadence: undefined }).body;
    for (const invented of ["weekly", "fortnightly", "monthly", "Thursday"]) {
      expect(body).not.toContain(invented);
    }
  });
});

describe("plan title", () => {
  it("names the project when one is known", () => {
    expect(draft().subject).toContain("Outcome reporting for funder renewals");
  });

  it("falls back to the organisation when no plan exists", () => {
    const result = draft({ planTitle: undefined });
    expect(result.subject).toContain("Harbor Youth Collective");
    expect(result.subject).not.toContain("undefined");
  });

  it.each(ENVOY_OCCASIONS)(
    "never leaks an undefined into %s prose",
    (occasion) => {
      const result = draft({
        occasion,
        planTitle: undefined,
        cadence: undefined,
      });
      expect(result.subject + result.body).not.toContain("undefined");
    },
  );
});

describe("at_risk_follow_up", () => {
  const concerns = [
    "no activity in 18 days",
    "most recent event was a raised blocker",
  ];

  it("relays Pulse's concerns rather than paraphrasing them", () => {
    const body = draft({ occasion: "at_risk_follow_up", concerns }).body;
    for (const concern of concerns) {
      expect(body).toContain(concern);
    }
  });

  it("frames the concerns as a question, not an accusation", () => {
    const body = draft({ occasion: "at_risk_follow_up", concerns }).body;
    expect(body).toContain("rather ask than assume");
  });

  it("owns the gap when no concerns were supplied", () => {
    const body = draft({
      occasion: "at_risk_follow_up",
      concerns: undefined,
    }).body;
    expect(body).toContain("missed an update on our side");
  });

  it("does not manufacture a concern when none was supplied", () => {
    const body = draft({ occasion: "at_risk_follow_up", concerns: [] }).body;
    expect(body).toContain("missed an update on our side");
  });
});

describe("wrap_up", () => {
  it("asks before anything is published", () => {
    const body = draft({ occasion: "wrap_up" }).body;
    expect(body).toContain("before anything is shared publicly");
  });
});

describe("envoyModelSchema", () => {
  it("does not let the model set its own hitlTier", () => {
    expect("hitlTier" in envoyModelSchema.shape).toBe(false);
  });

  it("does not let the model restate the identity fields", () => {
    expect("engagementId" in envoyModelSchema.shape).toBe(false);
    expect("occasion" in envoyModelSchema.shape).toBe(false);
  });

  it("accepts the subject/body a model is asked to write", () => {
    expect(() =>
      envoyModelSchema.parse({
        subject: "Kicking off",
        body: "Hi team,\n\nWelcome.",
      }),
    ).not.toThrow();
  });

  it("rejects an empty body", () => {
    expect(() =>
      envoyModelSchema.parse({ subject: "Kicking off", body: "" }),
    ).toThrow();
  });
});

describe("buildEnvoyPrompt", () => {
  it("supplies the facts and forbids inventing others", () => {
    const prompt = buildEnvoyPrompt(BASE);
    expect(prompt).toContain("Harbor Youth Collective");
    expect(prompt).toContain("Outcome reporting for funder renewals");
    expect(prompt).toContain("Do not invent facts");
  });

  it("marks absent fields rather than leaving them blank", () => {
    const prompt = buildEnvoyPrompt({
      ...BASE,
      planTitle: undefined,
      cadence: undefined,
    });
    expect(prompt).not.toContain("undefined");
  });
});

describe("fallback contract", () => {
  it("the deterministic draft satisfies the schema the API promises", () => {
    for (const occasion of ENVOY_OCCASIONS) {
      expect(() => envoyDraftSchema.parse(draft({ occasion }))).not.toThrow();
    }
  });
});
