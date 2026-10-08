import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequest } from "../../../model/types";
import type { ChronicleInput } from "../../../types";

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

const { draftChronicleWithModel, CHRONICLE_DRAFT_PROMPT_VERSION } = await import("../model");
const { GatewayError } = await import("../../../model/errors");

const READY: ChronicleInput = {
  engagementId: "e-1",
  orgName: "Harbor Youth Collective",
  status: "completed",
  hasPlan: true,
  eventCount: 12,
  objectives: ["Report outcomes to funders"],
  successCriteria: ["Quarterly report in under a day"],
};

const MODEL_STORY = {
  headline: "Working with Harbor",
  narrative: "Harbor completed an engagement.",
  successFactors: ["Success criteria were measurable"],
  failureFactors: ["Only a handful of events were recorded"],
};

afterEach(() => {
  gateway.requests = [];
});

describe("draftChronicleWithModel", () => {
  it("returns the model's story with readiness, engagementId and tier stamped by code", async () => {
    gateway.respond = async () => MODEL_STORY;

    const { draft, runId } = await draftChronicleWithModel(READY);

    expect(draft).toEqual({
      ...MODEL_STORY,
      engagementId: "e-1",
      readiness: "ready",
      outcomes: [],
      hitlTier: "L3",
    });
    expect(runId).toBe("run-1");
    const [req] = gateway.requests;
    expect(req.agent).toBe("chronicle");
    expect(req.promptVersion).toBe(CHRONICLE_DRAFT_PROMPT_VERSION);
    expect(req.prompt).toContain("Quarterly report in under a day");
  });

  it("stamps 'thin' readiness from code even when the model claims otherwise", async () => {
    gateway.respond = async () => ({ ...MODEL_STORY, readiness: "ready", hitlTier: "L2" });

    const { draft } = await draftChronicleWithModel({ ...READY, eventCount: 1 });

    expect(draft.readiness).toBe("thin");
    expect(draft.hitlTier).toBe("L3");
  });

  it("a not_ready record gets the empty draft and makes no model call", async () => {
    const { draft, runId } = await draftChronicleWithModel({ ...READY, status: "in_progress" });

    expect(gateway.requests).toHaveLength(0);
    expect(runId).toBeNull();
    expect(draft).toEqual({
      engagementId: "e-1",
      readiness: "not_ready",
      headline: "",
      narrative: "",
      outcomes: [],
      successFactors: [],
      failureFactors: [],
      hitlTier: "L3",
    });
  });

  it("passes the model's factors through unchanged and asks for them in the prompt", async () => {
    gateway.respond = async () => MODEL_STORY;

    const { draft } = await draftChronicleWithModel(READY);

    expect(draft.successFactors).toEqual(MODEL_STORY.successFactors);
    expect(draft.failureFactors).toEqual(MODEL_STORY.failureFactors);
    expect(gateway.requests[0].prompt).toContain("success factors");
    expect(CHRONICLE_DRAFT_PROMPT_VERSION).toBe("chronicle-draft-0.06");
  });

  // The review finding of 2026-10-08: the ready branch spread model outcomes straight into
  // the draft, and with no achievement in the input every one of them was invented.
  it("claims no outcomes whatever the model returns, and does not ask for them", async () => {
    gateway.respond = async () => ({ ...MODEL_STORY, outcomes: ["Reduced reporting time by 40%"] });

    const { draft } = await draftChronicleWithModel(READY);

    expect(draft.outcomes).toEqual([]);
    expect(gateway.requests[0].prompt).not.toMatch(/list of outcomes/i);
    expect(gateway.requests[0].prompt).toContain("do not");
  });

  it("propagates GatewayError rather than fabricating a story", async () => {
    gateway.respond = async () => {
      throw new GatewayError("model_parse_error", 502, "bad json");
    };

    await expect(draftChronicleWithModel(READY)).rejects.toMatchObject({ code: "model_parse_error" });
  });
});
