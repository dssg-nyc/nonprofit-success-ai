import type {
  ArchitectCharter,
  ArchitectPlanRequest,
  ArchitectPlanResponse,
  CsaFullAnswers,
  MaturityResult,
  NinetyDayPlan,
  ScoutBucket,
} from "../../types";
import { generateCharter, generateNinetyDayPlan } from "./plan";
import { scoreAssessment } from "./scoring";

/**
 * The SPA's side of submitting an Architect draft, as pure logic: what the assessment
 * form does with the `/api/architect-plan` outcome, separated from React so it can be
 * tested in Vitest's node environment (no jsdom / testing-library in this repo).
 *
 * The rule it encodes: **the server is the only writer.** A 2xx means the draft is saved
 * and pending staff approval. Anything else means nothing was saved — the form shows the
 * deterministic template locally, marked unsaved and not submitted, and offers a retry
 * with the same idempotency key. It never writes the draft from the browser
 * (`architect_assessments` insert/update is revoked from `authenticated`, 0001_core).
 */

/** The draft the browser can build on its own: rubric + templates, no model, no write. */
export interface LocalDraft {
  maturity: MaturityResult;
  charter: ArchitectCharter;
  plan: NinetyDayPlan;
}

export function localDraft(
  answers: CsaFullAnswers,
  orgName: string,
  bucket: ScoutBucket,
): LocalDraft {
  const maturity = scoreAssessment(answers, bucket);
  const input = {
    orgName,
    bucket,
    maturity,
    q1_org_context: answers.q1_org_context,
    q9_current_decisions: answers.q9_current_decisions,
    q10_wished_decisions: answers.q10_wished_decisions,
    q17a_wish_list: answers.q17a_wish_list,
    q17b_biggest_worry: answers.q17b_biggest_worry,
    q18_past_blockers: answers.q18_past_blockers,
  };
  return {
    maturity,
    charter: generateCharter(input),
    plan: generateNinetyDayPlan(input),
  };
}

/** One submit attempt: its key, and the answers it was made for. */
export interface DraftAttempt {
  key: string;
  fingerprint: string;
}

/**
 * The idempotency key for a submit (design-system.md §8.1). A retry of the same answers
 * reuses the previous key, so a request that did reach the server is replayed, not
 * submitted twice. Changed answers are a new draft and get a new key.
 */
export function nextAttempt(
  previous: DraftAttempt | null,
  answers: CsaFullAnswers,
  newKey: () => string,
): DraftAttempt {
  const fingerprint = JSON.stringify(answers);
  if (previous && previous.fingerprint === fingerprint) return previous;
  return { key: newKey(), fingerprint };
}

export type DraftSubmitOutcome =
  | { kind: "saved"; response: ArchitectPlanResponse }
  | { kind: "unsaved"; draft: LocalDraft; errorCode: string };

export async function submitDraft(
  args: {
    scoutIntakeId: string;
    idempotencyKey: string;
    answers: CsaFullAnswers;
    orgName: string;
    bucket: ScoutBucket;
  },
  submit: (request: ArchitectPlanRequest) => Promise<ArchitectPlanResponse>,
): Promise<DraftSubmitOutcome> {
  try {
    const response = await submit({
      scoutIntakeId: args.scoutIntakeId,
      idempotencyKey: args.idempotencyKey,
      answers: args.answers,
    });
    return { kind: "saved", response };
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    return {
      kind: "unsaved",
      draft: localDraft(args.answers, args.orgName, args.bucket),
      errorCode: typeof code === "string" && code.length > 0 ? code : "client_error",
    };
  }
}

/** What the form tells staff for an unsaved draft, by the handler's error code. */
export function unsavedMessage(errorCode: string): string {
  switch (errorCode) {
    case "unauthorized":
      return "Your session has expired. Sign in again, then retry.";
    case "forbidden":
      return "Only an admin of this organization can submit an Architect draft.";
    case "intake_not_reviewed":
      return "This intake has not been reviewed yet, so a draft cannot be submitted.";
    case "draft_superseded":
      return "A newer draft was submitted for this intake. Edit an answer to submit again.";
    case "invalid_input":
    case "invalid_draft":
      return "The answers could not be accepted. Check the form and retry.";
    default:
      return "Could not reach the server. This draft is not saved.";
  }
}

/**
 * What the plan page says about a draft's review state. The approval is the newest
 * `approvals` row for (entity_type 'charter', entity_id = the assessment id); older rows
 * for the same draft are `expired` by each re-submit. `source` is the audit event's
 * (`architect.draft_submitted`). No approval at all is a row written before submit_architect_draft() existed — it
 * was never submitted for review.
 */
export interface ApprovalBadge {
  label: string;
  tone: "pending" | "approved" | "rejected" | "none";
  /** "Model-drafted" / "Template draft", or null when the source was not recorded. */
  sourceLabel: string | null;
  /** ISO time the draft was submitted, or null with no approval. */
  submittedAt: string | null;
}

export function approvalBadge(
  approval: { status: string; created_at: string } | null,
  source: unknown,
): ApprovalBadge {
  const sourceLabel =
    source === "model" ? "Model-drafted" : source === "fallback" ? "Template draft" : null;
  if (!approval) {
    return { label: "Not submitted for approval", tone: "none", sourceLabel, submittedAt: null };
  }
  const submittedAt = approval.created_at;
  switch (approval.status) {
    case "approved":
      return { label: "Approved by staff", tone: "approved", sourceLabel, submittedAt };
    case "rejected":
      return { label: "Rejected by staff — re-conduct to resubmit", tone: "rejected", sourceLabel, submittedAt };
    case "pending":
    default:
      // `expired` is only ever an older row; as the newest it means the read raced a
      // re-submit. Still unapproved, so it reads as pending.
      return { label: "Draft, pending staff approval", tone: "pending", sourceLabel, submittedAt };
  }
}
