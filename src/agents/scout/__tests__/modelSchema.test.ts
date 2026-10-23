import { describe, expect, it } from "vitest";
import { SCOUT_FLAGS_MAX, SCOUT_FLAG_MAX, SCOUT_RATIONALE_MAX, scoutModelSchema } from "../schema";

const ANSWER = { bucket: "ML / Predictive", confidence: "High", rationale: "Clear need.", flags: [] };

describe("scoutModelSchema", () => {
  it("does not let the model set the tier or the readiness scores", () => {
    for (const key of ["hitlTier", "composite_signal", "poc_score", "clarity_score", "foothold_score"]) {
      expect(key in scoutModelSchema.shape).toBe(false);
    }
  });

  it("accepts a routing answer", () => {
    expect(scoutModelSchema.safeParse(ANSWER).success).toBe(true);
  });

  // Bounded on the model-facing schema only (review finding, 2026-10-08): a prompt-injected
  // intake that makes the model write an essay is a parse error, and the deterministic
  // router answers instead. The stored row reads back through the wire schema uncapped.
  it("caps the rationale and requires one", () => {
    expect(scoutModelSchema.safeParse({ ...ANSWER, rationale: "" }).success).toBe(false);
    expect(scoutModelSchema.safeParse({ ...ANSWER, rationale: "r".repeat(SCOUT_RATIONALE_MAX + 1) }).success).toBe(false);
    expect(scoutModelSchema.safeParse({ ...ANSWER, rationale: "r".repeat(SCOUT_RATIONALE_MAX) }).success).toBe(true);
  });

  it("caps the flag count and each flag's length", () => {
    expect(scoutModelSchema.safeParse({ ...ANSWER, flags: Array(SCOUT_FLAGS_MAX + 1).fill("f") }).success).toBe(false);
    expect(scoutModelSchema.safeParse({ ...ANSWER, flags: ["f".repeat(SCOUT_FLAG_MAX + 1)] }).success).toBe(false);
    expect(scoutModelSchema.safeParse({ ...ANSWER, flags: [""] }).success).toBe(false);
    expect(scoutModelSchema.safeParse({ ...ANSWER, flags: Array(SCOUT_FLAGS_MAX).fill("f") }).success).toBe(true);
  });
});
