import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequest } from "../../../model/types";
import type { EnvoyInput } from "../../../types";

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

const { draftEnvoyWithModel, ENVOY_DRAFT_PROMPT_VERSION } = await import("../model");
const { GatewayError } = await import("../../../model/errors");

const INPUT: EnvoyInput = {
  engagementId: "e-1",
  occasion: "check_in",
  orgName: "Harbor Youth Collective",
  planTitle: "Outcome reporting",
  cadence: "fortnightly",
};

afterEach(() => {
  gateway.requests = [];
});

describe("draftEnvoyWithModel", () => {
  it("returns the model's subject/body with engagementId, occasion and tier stamped by code", async () => {
    gateway.respond = async () => ({ subject: "Checking in", body: "Hi team" });

    const { draft, runId } = await draftEnvoyWithModel(INPUT);

    expect(draft).toEqual({
      subject: "Checking in",
      body: "Hi team",
      engagementId: "e-1",
      occasion: "check_in",
      hitlTier: "L3",
    });
    expect(runId).toBe("run-1");
  });

  it("calls the gateway as envoy with the versioned prompt built from the input", async () => {
    gateway.respond = async () => ({ subject: "s", body: "b" });

    await draftEnvoyWithModel(INPUT);

    const [req] = gateway.requests;
    expect(req.agent).toBe("envoy");
    expect(req.engagementId).toBe("e-1");
    expect(req.promptVersion).toBe(ENVOY_DRAFT_PROMPT_VERSION);
    expect(req.prompt).toContain("Harbor Youth Collective");
    expect(req.prompt).toContain("fortnightly");
    expect(req.recordTier?.({})).toBe("L3");
  });

  it("a model that tries to supply its own tier or target is overridden", async () => {
    gateway.respond = async () => ({
      subject: "s",
      body: "b",
      hitlTier: "L2",
      engagementId: "someone-else",
      occasion: "wrap_up",
    });

    const { draft } = await draftEnvoyWithModel(INPUT);

    expect(draft.hitlTier).toBe("L3");
    expect(draft.engagementId).toBe("e-1");
    expect(draft.occasion).toBe("check_in");
  });

  it("propagates GatewayError rather than fabricating a draft", async () => {
    gateway.respond = async () => {
      throw new GatewayError("model_timeout", 504, "timed out");
    };

    await expect(draftEnvoyWithModel(INPUT)).rejects.toMatchObject({ code: "model_timeout" });
  });
});
