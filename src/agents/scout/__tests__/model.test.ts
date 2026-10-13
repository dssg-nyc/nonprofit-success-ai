import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequest } from "../../../model/types";
import type { ScoutResult, ScoutRoutingInput } from "../../../types";

// The gateway is the agent's only seam to a model; replacing it means no key, network,
// or recorder. Each test sets what the "model" returns or throws.
const gateway = vi.hoisted(() => ({
  requests: [] as GatewayRequest[],
  respond: (async () => ({})) as (req: GatewayRequest) => Promise<unknown>,
}));
vi.mock("../../../model/gateway", () => ({
  callModel: async (req: GatewayRequest) => {
    gateway.requests.push(req);
    return { object: await gateway.respond(req), runId: "run-1", usage: {}, retried: false };
  },
}));

const {
  routeScoutIntakeWithModel,
  enforceRoutingRules,
  REBUCKET_CONFIDENCE_FLAG,
  SOMETHING_ELSE_FLAG,
  SCOUT_ROUTING_PROMPT_VERSION,
} = await import("../model");
const { scoreReadiness } = await import("../routing");
const { GatewayError } = await import("../../../model/errors");

// A Ready intake by the rubric: named director + concrete timeline, >25 words with a
// keyword, a system of record.
const READY: ScoutRoutingInput = {
  scale: "staff of 30",
  primary_need: "ml_predictive",
  problem_description:
    "We want to build a predictive model that forecasts which clients are at risk of dropping out of our program so case managers can intervene early with targeted outreach.",
  current_systems: "We run everything through Salesforce and a Postgres data warehouse",
  contact_name_role: "Maria Lopez, Program Director",
  timeline: "this quarter",
};

// POC floor with a strong rest: Not Ready by the rubric, however the model reads it.
const POC_FLOOR: ScoutRoutingInput = {
  ...READY,
  contact_name_role: "Riley",
  timeline: "eventually",
};

const MODEL_ANSWER: Pick<ScoutResult, "bucket" | "confidence" | "rationale" | "flags"> = {
  bucket: "ML / Predictive",
  confidence: "High",
  rationale: "Predictive work on Salesforce data; Ready.",
  flags: [],
};

afterEach(() => {
  gateway.requests = [];
});

describe("routeScoutIntakeWithModel", () => {
  it("takes bucket, confidence, rationale and flags from the model and the rest from code", async () => {
    gateway.respond = async () => MODEL_ANSWER;

    const { result, runId } = await routeScoutIntakeWithModel(READY);

    expect(result).toEqual({
      ...MODEL_ANSWER,
      poc_score: 3,
      clarity_score: 3,
      foothold_score: 3,
      composite_signal: "Ready",
      hitlTier: "L2",
    });
    expect(runId).toBe("run-1");
  });

  it("scores readiness by the rubric, not from the model's reply", async () => {
    // The model is not asked for scores, but a reply that carries them is ignored.
    gateway.respond = async () => ({
      ...MODEL_ANSWER,
      poc_score: 3,
      clarity_score: 3,
      foothold_score: 3,
      composite_signal: "Ready",
    });

    const { result } = await routeScoutIntakeWithModel(POC_FLOOR);

    expect(result.poc_score).toBe(1);
    expect(result.composite_signal).toBe("Not Ready");
    expect(result.hitlTier).toBe("L3");
    expect(scoreReadiness(POC_FLOOR).composite_signal).toBe("Not Ready");
  });

  it("gives the model the readiness facts and the versioned prompt, never a tier field", async () => {
    gateway.respond = async () => MODEL_ANSWER;

    await routeScoutIntakeWithModel(POC_FLOOR);

    const [req] = gateway.requests;
    expect(req.agent).toBe("scout");
    expect(req.promptVersion).toBe(SCOUT_ROUTING_PROMPT_VERSION);
    expect(req.prompt).toContain("point of contact 1/3");
    expect(req.prompt).toContain("readiness: Not Ready");
    expect(req.prompt).toContain("Riley");
    const asked = Object.keys((req.schema as unknown as { shape: Record<string, unknown> }).shape);
    expect(asked).toEqual(expect.arrayContaining(["bucket", "confidence", "rationale", "flags"]));
    expect(asked).not.toContain("hitlTier");
    expect(asked).not.toContain("poc_score");
    expect(req.recordTier?.(MODEL_ANSWER)).toBe("L3");
  });

  it("propagates GatewayError rather than fabricating a result", async () => {
    gateway.respond = async () => {
      throw new GatewayError("model_timeout", 504, "timed out");
    };

    await expect(routeScoutIntakeWithModel(READY)).rejects.toMatchObject({ code: "model_timeout" });
  });
});

describe("enforceRoutingRules", () => {
  it("something_else is never auto-bucketed, whatever the model chose", () => {
    const input: ScoutRoutingInput = { ...READY, primary_need: "something_else" };
    const ruled = enforceRoutingRules(input, { ...MODEL_ANSWER, bucket: "Advisory / Strategy" });

    expect(ruled.bucket).toBeNull();
    expect(ruled.confidence).toBeNull();
    expect(ruled.flags).toContain(SOMETHING_ELSE_FLAG);
  });

  it("a bucket other than the stated need's is capped at Low, so it cannot reach L2", async () => {
    gateway.respond = async () => ({ ...MODEL_ANSWER, bucket: "Tooling & Automation" });

    const { result } = await routeScoutIntakeWithModel(READY);

    expect(result.confidence).toBe("Low");
    expect(result.flags).toContain(REBUCKET_CONFIDENCE_FLAG);
    expect(result.hitlTier).toBe("L3");
  });

  it("leaves a Medium re-bucket and a High match alone", () => {
    const rebucket = enforceRoutingRules(READY, {
      ...MODEL_ANSWER,
      bucket: "Advisory / Strategy",
      confidence: "Medium",
    });
    expect(rebucket.confidence).toBe("Medium");
    expect(rebucket.flags).toEqual([]);

    expect(enforceRoutingRules(READY, MODEL_ANSWER)).toEqual(MODEL_ANSWER);
  });
});
