import { describe, expect, it } from "vitest";
import { SCHEMA_VERSIONS, envoyDraftRequestSchema } from "../../../schemas";

const VALID = {
  engagementId: "bbbbbbbb-0000-0000-0000-000000000001",
  idempotencyKey: "envoy-submit-0001",
  occasion: "kickoff",
};

describe("envoyDraftRequestSchema", () => {
  it("accepts a minimal request", () => {
    expect(envoyDraftRequestSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects a short idempotency key", () => {
    expect(envoyDraftRequestSchema.safeParse({ ...VALID, idempotencyKey: "short" }).success).toBe(false);
  });

  it("strips orgName, planTitle and cadence a caller sends — they are read server-side (api/_engagement.ts)", () => {
    const parsed = envoyDraftRequestSchema.parse({ ...VALID, orgName: "Someone Else", planTitle: "x", cadence: "daily" });
    expect(parsed).toEqual(VALID);
  });

  it("keeps concerns, bounded: at most ten, each under 300 characters", () => {
    expect(envoyDraftRequestSchema.safeParse({ ...VALID, concerns: ["No session in 21 days"] }).success).toBe(true);
    expect(envoyDraftRequestSchema.safeParse({ ...VALID, concerns: Array(11).fill("c") }).success).toBe(false);
    expect(envoyDraftRequestSchema.safeParse({ ...VALID, concerns: ["c".repeat(301)] }).success).toBe(false);
  });

  it("rejects an unknown occasion", () => {
    expect(envoyDraftRequestSchema.safeParse({ ...VALID, occasion: "birthday" }).success).toBe(false);
  });

  it("is on wire version v3 (v3: orgName, planTitle and cadence moved to the server)", () => {
    expect(SCHEMA_VERSIONS["envoy-draft"]).toBe("v3");
  });
});
