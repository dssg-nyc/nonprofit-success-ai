import { describe, expect, it } from "vitest";
import { SCHEMA_VERSIONS, chronicleDraftRequestSchema, chronicleInputSchema } from "../../../schemas";

const VALID = {
  engagementId: "bbbbbbbb-0000-0000-0000-000000000001",
  idempotencyKey: "chronicle-submit-0001",
};

const FACTS = {
  engagementId: VALID.engagementId,
  orgName: "Borough Food Bank",
  status: "completed",
  hasPlan: true,
  eventCount: 4,
};

describe("chronicleDraftRequestSchema", () => {
  it("accepts a minimal request", () => {
    expect(chronicleDraftRequestSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects a short idempotency key", () => {
    expect(chronicleDraftRequestSchema.safeParse({ ...VALID, idempotencyKey: "short" }).success).toBe(false);
  });

  it("strips engagement facts a caller sends — they are read server-side (api/_engagement.ts)", () => {
    const parsed = chronicleDraftRequestSchema.parse({ ...VALID, ...FACTS, eventCount: 50 });
    expect(parsed).toEqual(VALID);
  });

  it("is on wire version v4 (v4: the request lost every engagement fact to the server)", () => {
    expect(SCHEMA_VERSIONS["chronicle-draft"]).toBe("v4");
  });
});

describe("chronicleInputSchema", () => {
  it("accepts the facts the route builds", () => {
    expect(chronicleInputSchema.safeParse(FACTS).success).toBe(true);
  });

  it("rejects a negative or fractional event count", () => {
    expect(chronicleInputSchema.safeParse({ ...FACTS, eventCount: -1 }).success).toBe(false);
    expect(chronicleInputSchema.safeParse({ ...FACTS, eventCount: 1.5 }).success).toBe(false);
  });
});
