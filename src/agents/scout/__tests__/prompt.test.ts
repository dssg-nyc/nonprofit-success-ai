import { describe, expect, it } from "vitest";
import type { ScoutRoutingInput } from "../../../types";
import { scoreReadiness } from "../routing";
import { FOOTHOLD_FLOOR_RULE, WORKED_EXAMPLES, buildRoutingPrompt } from "../schema";

// The `conditional-foothold-floor-high-confidence-l3` fixture shape: an ML need on paper.
const ML_ON_PAPER: ScoutRoutingInput = {
  scale: "staff of 28",
  primary_need: "ml_predictive",
  problem_description:
    "We want to build a risk score that flags which tenants in our housing program are most likely to fall behind on rent, so our caseworkers can reach out early with support and referrals.",
  current_systems: "paper sign-in sheets and a filing cabinet",
  contact_name_role: "Omar Haddad, Program Director",
  timeline: "next 3 months",
};

const prompt = buildRoutingPrompt(ML_ON_PAPER, scoreReadiness(ML_ON_PAPER));

describe("buildRoutingPrompt — scout-routing-0.06 (R18)", () => {
  it("states the foothold floor as a prohibition above the tiebreak list", () => {
    expect(prompt).toContain(FOOTHOLD_FLOOR_RULE);
    expect(FOOTHOLD_FLOOR_RULE).toContain("never change the bucket");
    expect(prompt.indexOf(FOOTHOLD_FLOOR_RULE)).toBeLessThan(prompt.indexOf("Break the tie on scale and systems"));
  });

  it("carries one worked example per shape run 2 missed", () => {
    expect(WORKED_EXAMPLES).toHaveLength(2);
    for (const example of WORKED_EXAMPLES) expect(prompt).toContain(example);
    expect(prompt).toContain("A three-way match on a mid-size org");
    expect(prompt).toContain("→ Advisory / Strategy, confidence Low.");
    expect(prompt).toContain("An ML need on paper systems");
    expect(prompt).toContain("→ ML / Predictive, confidence High; the paper systems cap readiness at Conditional and move nothing.");
  });

  it("keeps the examples in the instructions, before the partner-data block", () => {
    const block = prompt.indexOf("--- partner-supplied data");
    expect(prompt.indexOf("Worked examples:")).toBeLessThan(block);
    expect(prompt.indexOf("Step 2 — rationale and flags.")).toBeLessThan(block);
  });

  it("tells the rationale to name the intake detail, never a score", () => {
    expect(prompt).toContain("Never quote a numeric score; name the intake detail instead.");
    expect(prompt).not.toContain("with the score that holds it back");
  });

  it("still hands the model the readiness facts it must not restate as numbers", () => {
    expect(prompt).toContain("foothold 1/3");
    expect(prompt).toContain("readiness: Conditional");
  });
});
