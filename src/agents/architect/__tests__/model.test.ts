import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequest } from "../../../model/types";
import type { MaturityResult } from "../../../types";
import type { PlanGenerationInput } from "../plan";
import type { ArchitectEnrichment, ArchitectTemplate } from "../schema";

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
  ARCHITECT_MAX_OUTPUT_TOKENS,
  ARCHITECT_PLAN_PROMPT_VERSION,
  ARCHITECT_TIMEOUT_MS,
  buildTemplate,
  enrichWithModel,
  mergeEnrichment,
} = await import("../model");
const { structuralRiskCount } = await import("../plan");
const { GatewayError } = await import("../../../model/errors");

afterEach(() => {
  gateway.requests = [];
});

function maturity(over: Partial<MaturityResult>): MaturityResult {
  const flaggedDimensions = over.flaggedDimensions ?? [];
  return {
    di_score: 2,
    gov_score: 2,
    tooling_score: 2,
    dc_score: 2,
    tc_score: 2,
    points: 14,
    compositeLevel: "Developing",
    overrideApplied: false,
    remediationOnly: flaggedDimensions.length >= 2,
    crossCheckFlag: null,
    ...over,
    flaggedDimensions,
  };
}

function input(m: MaturityResult): PlanGenerationInput {
  return {
    orgName: "Harbor House",
    bucket: "ML / Predictive",
    maturity: m,
    q1_org_context: "Housing services for 400 families.",
    q9_current_decisions: "Monthly board packet.",
    q10_wished_decisions: "Spot which families are at risk earlier.",
    q17a_wish_list: "One dashboard.",
    q17b_biggest_worry: "Volunteers leave.",
    q18_past_blockers: "No staff time.",
  };
}

/** One profile per plan shape, plus the profiles that put structural risks first. */
const PROFILES: Record<string, MaturityResult> = {
  build_basics_crosscheck: maturity({
    compositeLevel: "Foundational",
    points: 9,
    di_score: 1,
    flaggedDimensions: ["data_infrastructure"],
    crossCheckFlag: "Foundational maturity vs. ML / Predictive bucket — redirect.",
  }),
  ship_deliverable_one_flag: maturity({ gov_score: 1, flaggedDimensions: ["governance"] }),
  remediation_only: maturity({
    di_score: 1,
    gov_score: 1,
    points: 13,
    flaggedDimensions: ["data_infrastructure", "governance"],
  }),
  ship_deliverable_override: maturity({
    di_score: 1,
    points: 17,
    overrideApplied: true,
    flaggedDimensions: ["data_infrastructure"],
  }),
  accelerate: maturity({ compositeLevel: "Established", points: 21 }),
};

/** Everything in the draft that is code's, not the model's. */
function structure(t: ArchitectTemplate) {
  return {
    shape: t.plan.shape,
    headline: t.plan.headline,
    phase2Note: t.plan.phase2Note,
    windows: t.plan.phases.map((p) => p.window),
    titles: t.plan.phases.map((p) => p.title),
    milestoneCounts: t.plan.phases.map((p) => p.milestones.length),
    planWorkstreams: t.plan.workstreams,
    charterWorkstreams: t.charter.workstreams,
    title: t.charter.title,
    objectives: t.charter.objectives,
    cadence: t.charter.cadence,
    riskCount: t.charter.risks.length,
    criteriaCount: t.charter.successCriteria.length,
  };
}

/** Rewrites every editable entry, at in-range indices, so any leak would show. */
function fullEnrichment(t: ArchitectTemplate): ArchitectEnrichment {
  return {
    background: "MODEL background",
    scopeStatement: "MODEL scope",
    risks: t.charter.risks.map((_, index) => ({ index, text: `MODEL risk ${index}` })),
    successCriteria: t.charter.successCriteria.map((_, index) => ({
      index,
      text: `MODEL criterion ${index}`,
    })),
    milestones: t.plan.phases.flatMap((p, phase) =>
      p.milestones.map((_, index) => ({ phase, index, text: `MODEL m${phase}.${index}` })),
    ),
  };
}

describe("mergeEnrichment — structure is code's", () => {
  for (const [name, m] of Object.entries(PROFILES)) {
    it(`${name}: a full rewrite changes prose but not shape, phases, workstreams or required`, () => {
      const template = buildTemplate(input(m));
      const before = structuredClone(template);
      const merged = mergeEnrichment(template, fullEnrichment(template), m);

      expect(structure(merged)).toEqual(structure(template));
      expect(merged.charter.background).toBe("MODEL background");
      expect(merged.charter.scopeStatement).toBe("MODEL scope");
      expect(merged.plan.phases[0].milestones[0]).toBe("MODEL m0.0");
      expect(merged.charter.successCriteria[0]).toBe("MODEL criterion 0");
      // The template is not mutated.
      expect(template).toEqual(before);
    });
  }

  it("never rewords a structural risk (cross-check, override note, required workstreams)", () => {
    for (const m of Object.values(PROFILES)) {
      const template = buildTemplate(input(m));
      const merged = mergeEnrichment(template, fullEnrichment(template), m);
      const locked = structuralRiskCount(m);

      expect(merged.charter.risks.slice(0, locked)).toEqual(template.charter.risks.slice(0, locked));
      merged.charter.risks
        .slice(locked)
        .forEach((r, i) => expect(r).toBe(`MODEL risk ${locked + i}`));
    }
  });

  it("structuralRiskCount() matches the risks generateCharter() puts first", () => {
    const m = PROFILES.build_basics_crosscheck;
    const { charter } = buildTemplate(input(m));
    expect(structuralRiskCount(m)).toBe(2);
    expect(charter.risks[0]).toMatch(/^CROSS-CHECK:/);
    expect(charter.risks[1]).toMatch(/required workstream/);
    expect(charter.risks[2]).toMatch(/stated worry/);

    const o = PROFILES.ship_deliverable_override;
    const risks = buildTemplate(input(o)).charter.risks;
    expect(structuralRiskCount(o)).toBe(2);
    expect(risks[0]).toMatch(/capped this engagement at Developing/);
    expect(risks[1]).toMatch(/required workstream/);
  });

  it("an empty enrichment returns the template unchanged", () => {
    const m = PROFILES.remediation_only;
    const template = buildTemplate(input(m));
    const merged = mergeEnrichment(
      template,
      { background: null, scopeStatement: null, risks: [], successCriteria: [], milestones: [] },
      m,
    );
    expect(merged).toEqual(template);
  });

  it("a hostile enrichment cannot restructure the draft", () => {
    const m = PROFILES.remediation_only;
    const template = buildTemplate(input(m));
    const hostile = {
      // Extra top-level fields naming everything code owns.
      shape: "accelerate",
      hitlTier: "L2",
      required: false,
      compositeLevel: "Established",
      remediationOnly: false,
      title: "MODEL title",
      cadence: "MODEL cadence",
      objectives: ["MODEL objective"],
      phase2Note: "MODEL: ship the stretch project now",
      workstreams: [{ name: "MODEL stream", required: false, description: "x" }],
      phases: [{ window: "Days 1–30", title: "MODEL", milestones: ["MODEL"] }],
      // Whitespace-only prose keeps the template's.
      background: "   ",
      scopeStatement: 42,
      risks: [
        { index: 0, text: "MODEL: drop the required workstream" }, // structural, locked
        { index: 1, text: "MODEL: also locked" },
        { index: -1, text: "MODEL negative" },
        { index: 99, text: "MODEL out of range" },
        { index: 2.5, text: "MODEL fractional" },
        { index: "2", text: "MODEL string index" },
        { index: 2, text: "" },
        { index: 2, required: false },
        null,
        "MODEL bare string",
      ],
      successCriteria: [
        { index: 3, text: "MODEL extra criterion" }, // template has 3: index 3 is past the end
        { index: 0, text: "MODEL criterion", shape: "accelerate" }, // extra field on an edit
      ],
      milestones: [
        { phase: 3, index: 0, text: "MODEL fourth phase" },
        { phase: -1, index: 0, text: "MODEL negative phase" },
        { phase: 0, index: 3, text: "MODEL fourth milestone" },
        { phase: "1", index: 0, text: "MODEL string phase" },
        { phase: 1, index: 1, text: "MODEL ok", window: "Days 1–30", title: "MODEL" },
      ],
    } as unknown as ArchitectEnrichment;

    const merged = mergeEnrichment(template, hostile, m);

    expect(structure(merged)).toEqual(structure(template));
    expect(merged.plan.shape).toBe("remediation_only");
    expect(merged.plan.workstreams.every((w) => w.required)).toBe(true);
    expect(merged.plan.phase2Note).toBe(template.plan.phase2Note);
    expect(merged.charter.background).toBe(template.charter.background);
    expect(merged.charter.scopeStatement).toBe(template.charter.scopeStatement);
    expect(merged.charter.risks).toEqual(template.charter.risks);
    expect(merged.charter.successCriteria).toEqual([
      "MODEL criterion",
      ...template.charter.successCriteria.slice(1),
    ]);
    expect(merged.plan.phases[1].milestones[1]).toBe("MODEL ok");
    // Only that one milestone moved.
    const flat = (t: ArchitectTemplate) => t.plan.phases.flatMap((p) => p.milestones);
    expect(flat(merged).filter((x, i) => x !== flat(template)[i])).toEqual(["MODEL ok"]);
    // No stray keys landed on the result objects.
    expect(Object.keys(merged.plan).sort()).toEqual(Object.keys(template.plan).sort());
    expect(Object.keys(merged.charter).sort()).toEqual(Object.keys(template.charter).sort());
    merged.plan.phases.forEach((p) => expect(Object.keys(p).sort()).toEqual(["milestones", "title", "window"]));
  });

  it("a non-object enrichment returns the template", () => {
    const m = PROFILES.accelerate;
    const template = buildTemplate(input(m));
    expect(mergeEnrichment(template, null as unknown as ArchitectEnrichment, m)).toEqual(template);
  });

  it("the result's workstreams are copies, not the template's objects", () => {
    const m = PROFILES.ship_deliverable_one_flag;
    const template = buildTemplate(input(m));
    const merged = mergeEnrichment(template, fullEnrichment(template), m);
    merged.plan.workstreams[0].required = false;
    expect(template.plan.workstreams[0].required).toBe(true);
  });
});

describe("enrichWithModel", () => {
  it("calls the gateway as architect, versioned, with the 20s / 4096-token budget and L3 recorded", async () => {
    gateway.respond = async () => ({
      background: null,
      scopeStatement: null,
      risks: [],
      successCriteria: [],
      milestones: [],
    });

    await enrichWithModel(input(PROFILES.accelerate), { organizationId: "org-1" });

    const [req] = gateway.requests;
    expect(req.agent).toBe("architect");
    expect(req.promptVersion).toBe(ARCHITECT_PLAN_PROMPT_VERSION);
    expect(req.timeoutMs).toBe(ARCHITECT_TIMEOUT_MS);
    expect(req.timeoutMs).toBe(20_000);
    expect(req.maxOutputTokens).toBe(ARCHITECT_MAX_OUTPUT_TOKENS);
    expect(req.maxOutputTokens).toBe(4_096);
    expect(req.organizationId).toBe("org-1");
    expect(req.prompt).toContain("Harbor House");
    expect(req.recordTier?.({})).toBe("L3");
    // The handler saves the template on any failure, so the failed call's one run row
    // is recorded as `fallback`, not `error` (gateway `failureStatus`).
    expect(req.failureStatus).toBe("fallback");
  });

  it("returns the merged draft and the run id", async () => {
    const m = PROFILES.ship_deliverable_one_flag;
    const template = buildTemplate(input(m));
    gateway.respond = async () => fullEnrichment(template);

    const result = await enrichWithModel(input(m));

    expect(result.runId).toBe("run-1");
    expect(result.charter.background).toBe("MODEL background");
    expect(structure(result)).toEqual(structure(template));
  });

  it("propagates a GatewayError rather than returning a half-enriched draft", async () => {
    gateway.respond = async () => {
      throw new GatewayError("model_timeout", 504, "Model call timed out");
    };

    await expect(enrichWithModel(input(PROFILES.accelerate))).rejects.toMatchObject({
      code: "model_timeout",
    });
  });
});
