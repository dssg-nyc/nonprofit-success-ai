import { describe, expect, it } from "vitest";
import {
  AT_RISK_SILENCE_DAYS,
  computePulseSignal,
  STAGE_WINDOW_DAYS,
  STALLED_SILENCE_DAYS,
} from "../health";
import { pulseSignalSchema } from "../schema";
import type { PulseInput } from "../../../types/pulse";

const HEALTHY: PulseInput = {
  engagementId: "e-001",
  stage: "scoping",
  daysSinceLastEvent: 3,
  daysInStage: 10,
  lastEventWasBlocker: false,
  hasPlan: true,
};

function signal(overrides: Partial<PulseInput> = {}) {
  return computePulseSignal({ ...HEALTHY, ...overrides });
}

describe("computePulseSignal", () => {
  it("reports on_track when activity is recent and the stage is within its window", () => {
    const result = signal();
    expect(result.status).toBe("on_track");
    expect(result.reasons).toHaveLength(1);
  });

  it("never returns an empty reasons array — a bare label is not actionable", () => {
    expect(signal().reasons.length).toBeGreaterThan(0);
  });

  it("passes through the inputs staff need to interpret the status", () => {
    const result = signal({
      engagementId: "e-042",
      daysInStage: 9,
      hasPlan: false,
    });
    expect(result.engagementId).toBe("e-042");
    expect(result.daysInStage).toBe(9);
    expect(result.hasPlan).toBe(false);
  });

  it("is always L2 — Pulse is staff-facing and read-only", () => {
    expect(signal().hitlTier).toBe("L2");
    expect(signal({ daysSinceLastEvent: 90 }).hitlTier).toBe("L2");
  });

  it("satisfies the schema the API contract promises", () => {
    expect(() => pulseSignalSchema.parse(signal())).not.toThrow();
    expect(() =>
      pulseSignalSchema.parse(signal({ daysSinceLastEvent: null })),
    ).not.toThrow();
  });
});

describe("no event history", () => {
  it("is at_risk, not stalled — absence of evidence is not evidence of stalling", () => {
    const result = signal({ daysSinceLastEvent: null });
    expect(result.status).toBe("at_risk");
    expect(result.reasons).toContain("no recorded activity");
  });

  it("preserves the null rather than substituting a number", () => {
    expect(signal({ daysSinceLastEvent: null }).daysSinceLastEvent).toBeNull();
  });

  it("still escalates to stalled when the stage itself has overrun", () => {
    const result = signal({
      daysSinceLastEvent: null,
      stage: "initial_meeting",
      daysInStage: 40,
    });
    expect(result.status).toBe("stalled");
  });
});

describe("silence thresholds", () => {
  it.each([
    [AT_RISK_SILENCE_DAYS - 1, "on_track"],
    [AT_RISK_SILENCE_DAYS, "at_risk"],
    [STALLED_SILENCE_DAYS - 1, "at_risk"],
    [STALLED_SILENCE_DAYS, "stalled"],
  ] as const)("%i days of silence is %s", (days, expected) => {
    expect(signal({ daysSinceLastEvent: days, daysInStage: days }).status).toBe(
      expected,
    );
  });

  it("names the silence in the reasons", () => {
    expect(
      signal({ daysSinceLastEvent: 30, daysInStage: 30 }).reasons,
    ).toContain("no activity in 30 days");
  });
});

describe("stage window", () => {
  it("stalls an engagement that overruns its stage even with recent activity", () => {
    const result = signal({
      stage: "initial_meeting",
      daysInStage: 40,
      daysSinceLastEvent: 2,
    });
    expect(result.status).toBe("stalled");
    expect(result.reasons.some((r) => r.includes("expected 14"))).toBe(true);
  });

  it("does not stall an engagement sitting exactly at its window", () => {
    expect(
      signal({ stage: "scoping", daysInStage: STAGE_WINDOW_DAYS.scoping })
        .status,
    ).toBe("on_track");
  });

  it("treats an unknown stage as having no window rather than a default one", () => {
    expect(
      signal({ stage: "some_future_stage", daysInStage: 400 }).status,
    ).toBe("on_track");
  });

  it("covers every stage in the domain enum", () => {
    const stages = [
      "initial_meeting",
      "budget_check",
      "data_ethics_committee",
      "scoping",
      "hackathon_ready",
      "membership",
    ];
    for (const stage of stages) {
      expect(STAGE_WINDOW_DAYS[stage]).toBeGreaterThan(0);
    }
  });
});

describe("blockers", () => {
  it("escalates an otherwise healthy engagement to at_risk", () => {
    const result = signal({ lastEventWasBlocker: true });
    expect(result.status).toBe("at_risk");
    expect(result.reasons).toContain("most recent event was a raised blocker");
  });

  it("does not soften an already-stalled engagement", () => {
    const result = signal({
      daysSinceLastEvent: 30,
      daysInStage: 35,
      lastEventWasBlocker: true,
    });
    expect(result.status).toBe("stalled");
    expect(result.reasons).toContain("most recent event was a raised blocker");
  });
});

describe("missing plan", () => {
  it("is reported as context without changing the status", () => {
    const result = signal({ hasPlan: false });
    expect(result.status).toBe("on_track");
    expect(result.reasons).toContain("no linked assessment to measure against");
  });
});
