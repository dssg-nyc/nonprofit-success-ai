import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { ArchitectPlanRequest, ArchitectPlanResponse, CsaFullAnswers } from "../../../types";
import { approvalBadge, localDraft, nextAttempt, submitDraft, unsavedMessage } from "../draft";
import { buildTemplate } from "../model";

// The assessment form's submit decision, tested as the pure function it delegates to:
// Vitest runs in node here and the repo has no jsdom / testing-library, so the React
// component itself is not rendered. The last test is a static guard on the component's
// source instead — that it has no direct write left to fall back to.

const ANSWERS: CsaFullAnswers = {
  q1_org_context: "Tenant-rights org in the Bronx.",
  q2_org_size: "12 staff",
  q3_poc: "Sam, ED",
  q4_collection_scope: "not_systematic",
  q5_data_locations: "Paper intake forms",
  q6_system_integration: "own_island",
  q7_integration_familiarity: "not_familiar",
  q8_quality_confidence: "not_confident",
  q9_current_decisions: "None",
  q10_wished_decisions: "Which buildings to organize first",
  q11_decision_empowerment: "not_from_data",
  q12_reporting_to: "One funder, annually",
  q13_reporting_automation: "none_manual",
  q14_tools: ["spreadsheets"],
  q15_staff_confidence: "low_comfort",
  q16_budget_speed: "case_by_case",
  q17a_wish_list: "A case tracker",
  q17b_biggest_worry: "Losing paper records",
  q18_past_blockers: "No budget",
};

const ARGS = {
  scoutIntakeId: "cccccccc-0000-0000-0000-000000000001",
  idempotencyKey: "key-00000001",
  answers: ANSWERS,
  orgName: "Bronx Tenants United",
  bucket: "Data Infrastructure" as const,
};

describe("submitDraft", () => {
  it("a 2xx is 'saved', with the server's response untouched", async () => {
    const response = { approvalId: "a" } as unknown as ArchitectPlanResponse;
    const submit = vi.fn<(request: ArchitectPlanRequest) => Promise<ArchitectPlanResponse>>(async () => response);

    const outcome = await submitDraft(ARGS, submit);

    expect(outcome).toEqual({ kind: "saved", response });
    expect(submit).toHaveBeenCalledWith({
      scoutIntakeId: ARGS.scoutIntakeId,
      idempotencyKey: ARGS.idempotencyKey,
      answers: ANSWERS,
    });
  });

  it("a route failure is 'unsaved': the local template is rendered, and nothing else is called", async () => {
    // `submit` is the only side effect submitDraft is given; on failure it is called
    // once and there is no other writer for it to reach.
    const submit = vi.fn(async () => {
      throw Object.assign(new Error("api"), { code: "draft_save_failed", status: 502 });
    });

    const outcome = await submitDraft(ARGS, submit);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(outcome.kind).toBe("unsaved");
    if (outcome.kind !== "unsaved") return;
    expect(outcome.errorCode).toBe("draft_save_failed");
    // The same template the server would have saved as its fallback.
    const template = buildTemplate({
      orgName: ARGS.orgName,
      bucket: ARGS.bucket,
      maturity: outcome.draft.maturity,
      q1_org_context: ANSWERS.q1_org_context,
      q9_current_decisions: ANSWERS.q9_current_decisions,
      q10_wished_decisions: ANSWERS.q10_wished_decisions,
      q17a_wish_list: ANSWERS.q17a_wish_list,
      q17b_biggest_worry: ANSWERS.q17b_biggest_worry,
      q18_past_blockers: ANSWERS.q18_past_blockers,
    });
    expect({ charter: outcome.draft.charter, plan: outcome.draft.plan }).toEqual(template);
  });

  it("an error with no code is client_error", async () => {
    const outcome = await submitDraft(ARGS, async () => {
      throw new TypeError("boom");
    });
    expect(outcome).toMatchObject({ kind: "unsaved", errorCode: "client_error" });
  });
});

describe("localDraft", () => {
  it("scores the answers against the given bucket", () => {
    const draft = localDraft(ANSWERS, ARGS.orgName, ARGS.bucket);
    expect(draft.maturity.compositeLevel).toBe("Foundational");
    expect(draft.plan.phases).toHaveLength(3);
  });
});

describe("nextAttempt", () => {
  const keys = () => {
    let n = 0;
    return () => `key-${String(++n).padStart(8, "0")}`;
  };

  it("a retry of the same answers keeps the key", () => {
    const newKey = keys();
    const first = nextAttempt(null, ANSWERS, newKey);
    const retry = nextAttempt(first, { ...ANSWERS }, newKey);
    expect(retry.key).toBe(first.key);
  });

  it("changed answers get a new key", () => {
    const newKey = keys();
    const first = nextAttempt(null, ANSWERS, newKey);
    const edited = nextAttempt(first, { ...ANSWERS, q3_poc: "Alex, COO" }, newKey);
    expect(edited.key).not.toBe(first.key);
  });
});

describe("unsavedMessage", () => {
  it("has a specific message for the codes staff can act on, and a generic one otherwise", () => {
    expect(unsavedMessage("unauthorized")).toMatch(/sign in/i);
    expect(unsavedMessage("forbidden")).toMatch(/admin/i);
    expect(unsavedMessage("network_error")).toMatch(/not saved/i);
  });
});

describe("ArchitectAssessment.tsx", () => {
  it("has no direct write to architect_assessments — /api/architect-plan is the only writer", () => {
    const path = fileURLToPath(
      new URL("../../../components/architect/ArchitectAssessment.tsx", import.meta.url),
    );
    const source = readFileSync(path, "utf8");
    expect(source).not.toMatch(/\.(upsert|insert|update|delete)\s*\(/);
    expect(source).toContain("/api/architect-plan");
  });
});

describe("approvalBadge", () => {
  const at = "2026-10-06T12:00:00Z";

  it("a pending approval is a draft pending staff approval, with source and time", () => {
    expect(approvalBadge({ status: "pending", created_at: at }, "fallback")).toEqual({
      label: "Draft, pending staff approval",
      tone: "pending",
      sourceLabel: "Template draft",
      submittedAt: at,
    });
  });

  it("approved and rejected say so", () => {
    expect(approvalBadge({ status: "approved", created_at: at }, "model")).toMatchObject({
      tone: "approved",
      sourceLabel: "Model-drafted",
    });
    expect(approvalBadge({ status: "rejected", created_at: at }, null).tone).toBe("rejected");
  });

  it("no approval row is 'not submitted', never 'approved'", () => {
    expect(approvalBadge(null, undefined)).toEqual({
      label: "Not submitted for approval",
      tone: "none",
      sourceLabel: null,
      submittedAt: null,
    });
  });

  it("an unrecognised source is not reported as either", () => {
    expect(approvalBadge({ status: "pending", created_at: at }, "gpt").sourceLabel).toBeNull();
  });
});
