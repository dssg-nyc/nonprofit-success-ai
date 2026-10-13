import { describe, expect, it } from "vitest";
import { toPulseInput } from "../input";

const NOW = new Date("2026-10-07T12:00:00.000Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const ROW = {
  id: "e-1",
  stage: "scoping",
  updated_at: ago(5),
  created_at: ago(40),
  assessment_id: "a-1",
};

describe("toPulseInput", () => {
  it("counts a same-day event as 0 days", () => {
    expect(toPulseInput(ROW, { kind: "note", created_at: ago(0) }, NOW).daysSinceLastEvent).toBe(0);
  });

  it("floors 21.9 days to 21", () => {
    const input = toPulseInput(ROW, { kind: "note", created_at: ago(21.9) }, NOW);
    expect(input.daysSinceLastEvent).toBe(21);
  });

  it("is null with no event, and not a blocker", () => {
    const input = toPulseInput(ROW, null, NOW);
    expect(input.daysSinceLastEvent).toBeNull();
    expect(input.lastEventWasBlocker).toBe(false);
  });

  it("detects a blocker only from blocker_raised", () => {
    expect(toPulseInput(ROW, { kind: "blocker_raised", created_at: ago(1) }, NOW).lastEventWasBlocker).toBe(true);
    expect(toPulseInput(ROW, { kind: "note", created_at: ago(1) }, NOW).lastEventWasBlocker).toBe(false);
  });

  it("derives hasPlan from assessment_id", () => {
    expect(toPulseInput(ROW, null, NOW).hasPlan).toBe(true);
    expect(toPulseInput({ ...ROW, assessment_id: null }, null, NOW).hasPlan).toBe(false);
  });

  it("derives daysInStage from updated_at and passes id and stage through", () => {
    expect(toPulseInput(ROW, null, NOW)).toMatchObject({ engagementId: "e-1", stage: "scoping", daysInStage: 5 });
  });

  it("clamps a future timestamp to 0", () => {
    expect(toPulseInput({ ...ROW, updated_at: ago(-2) }, null, NOW).daysInStage).toBe(0);
  });
});
