import { ARCHITECT_PLAN_PROMPT_VERSION, buildTemplate, enrichWithModel } from "../src/agents/architect/model";
import type { PlanGenerationInput } from "../src/agents/architect/plan";
import { scoreAssessment } from "../src/agents/architect/scoring";
import type { ArchitectTemplate } from "../src/agents/architect/schema";
import type { Json } from "../src/lib/database.types";
import { GatewayError } from "../src/model/errors";
import { errorName, log } from "../src/observability/log";
import {
  architectCharterSchema,
  architectPlanRequestSchema,
  maturityResultSchema,
  ninetyDayPlanSchema,
} from "../src/schemas";
import type { ArchitectPlanRequest, ArchitectPlanResponse, MaturityResult, ScoutBucket } from "../src/types";
import { authenticate } from "./_auth";
import type { UserClient } from "./_auth";
import { checkModelBudget } from "./_budget";
import { modelKeyConfigured } from "./_env";
import { parseJsonBody } from "./_http";
import { handler } from "./_request";

/**
 * POST /api/architect-plan — score the CSA, draft the charter + 90-day plan, and submit
 * the draft for staff approval (L3) in one transaction (`submit_architect_draft`, 0004_drafts).
 *
 * Unlike the other agent routes this handler falls back itself: a model failure — a
 * missing key included — saves the deterministic template and answers 200 with
 * `source: 'fallback'` (design-system.md §2, the Architect exception). A non-2xx means
 * nothing was saved, and the SPA shows its local draft as unsaved.
 *
 * Authority is the caller's, never the service role's: every query below runs on the
 * user-scoped client from `_auth.ts`, so RLS and the RPC's `is_admin()` see the real
 * actor. What is server-derived, and therefore never read from the body: maturity (the
 * deterministic rubric over the answers, against the reviewer's `final_bucket`), the plan
 * structure (code's templates), `hitlTier` (always L3) and, inside the RPC, the
 * assessment's id, org, author and Scout handoff fields.
 */

export const maxDuration = 30;

const json = (body: unknown, status: number) => Response.json(body, { status });

/** SQLSTATEs `submit_architect_draft()` raises (0004_drafts header) → the status the SPA sees. */
function rpcErrorResponse(code: string | undefined): Response {
  if (code === "42501") return json({ error: "forbidden" }, 403);
  if (code === "P0002") return json({ error: "intake_not_found" }, 404);
  if (code === "55000") return json({ error: "intake_not_reviewed" }, 422);
  if (code === "22023" || code?.startsWith("23")) return json({ error: "invalid_draft" }, 400);
  return json({ error: "draft_save_failed" }, 502);
}

/** `architect_assessments` columns, snake_case, as 0004_drafts' `p_payload` documents them. */
function toPayload(
  req: ArchitectPlanRequest,
  maturity: MaturityResult,
  draft: ArchitectTemplate,
  source: ArchitectPlanResponse["source"],
  model: string | null,
): Json {
  return {
    scout_intake_id: req.scoutIntakeId,
    ...req.answers,
    di_score: maturity.di_score,
    gov_score: maturity.gov_score,
    tooling_score: maturity.tooling_score,
    dc_score: maturity.dc_score,
    tc_score: maturity.tc_score,
    points: maturity.points,
    composite_level: maturity.compositeLevel,
    override_applied: maturity.overrideApplied,
    flagged_dimensions: maturity.flaggedDimensions,
    remediation_only: maturity.remediationOnly,
    cross_check_flag: maturity.crossCheckFlag,
    charter: draft.charter,
    ninety_day_plan: draft.plan,
    source,
    prompt_version: ARCHITECT_PLAN_PROMPT_VERSION,
    // Named so a model draft whose run went unrecorded is still saved (0004_drafts).
    ...(source === "model" && model ? { model } : {}),
  } as unknown as Json;
}

/**
 * A replayed idempotency key returns the original result (design-system.md §8.1) — read
 * back from the database, without a second model call or a second write. Null when the
 * key is new. A key whose draft was since superseded by a newer submit has no original
 * result left to return (the assessment row holds the newer draft), so it is a 409.
 */
async function replay(
  client: UserClient,
  req: ArchitectPlanRequest,
): Promise<Response | null> {
  const { data: prior, error } = await client
    .from("approvals")
    .select("id, entity_id, agent, entity_type, agent_run_id, status")
    .eq("idempotency_key", req.idempotencyKey)
    .maybeSingle();
  if (error) {
    log("error", "route_failure", { step: "replay_lookup", code: error.code });
    return json({ error: "draft_save_failed" }, 502);
  }
  if (!prior) return null;
  if (prior.agent !== "architect" || prior.entity_type !== "charter" || prior.entity_id !== req.scoutIntakeId) {
    return json({ error: "invalid_draft" }, 400);
  }
  if (prior.status === "expired") return json({ error: "draft_superseded" }, 409);

  const [{ data: row, error: rowErr }, { data: event }] = await Promise.all([
    client.from("architect_assessments").select("*").eq("id", req.scoutIntakeId).maybeSingle(),
    client
      .from("audit_events")
      .select("detail")
      .eq("action", "architect.draft_submitted")
      .eq("detail->>approval_id", prior.id)
      .maybeSingle(),
  ]);
  if (rowErr || !row) {
    log("error", "route_failure", { step: "replay_read", code: rowErr?.code ?? "no_row" });
    return json({ error: "draft_save_failed" }, 502);
  }

  const maturity = maturityResultSchema.safeParse({
    di_score: row.di_score,
    gov_score: row.gov_score,
    tooling_score: row.tooling_score,
    dc_score: row.dc_score,
    tc_score: row.tc_score,
    points: row.points,
    compositeLevel: row.composite_level,
    overrideApplied: row.override_applied,
    flaggedDimensions: row.flagged_dimensions,
    remediationOnly: row.remediation_only,
    crossCheckFlag: row.cross_check_flag,
  });
  const charter = architectCharterSchema.safeParse(row.charter);
  const plan = ninetyDayPlanSchema.safeParse(row.ninety_day_plan);
  if (!maturity.success || !charter.success || !plan.success) {
    log("error", "route_failure", { step: "replay_schema", code: "draft_schema_mismatch", intakeId: req.scoutIntakeId });
    return json({ error: "draft_save_failed" }, 502);
  }

  // Only a recorded `model` claims the model; anything unreadable reads as the template.
  const detail = event?.detail as { source?: unknown } | null | undefined;
  const response: ArchitectPlanResponse = {
    maturity: maturity.data,
    charter: charter.data,
    plan: plan.data,
    hitlTier: "L3",
    approvalId: prior.id,
    source: detail?.source === "model" ? "model" : "fallback",
    runId: prior.agent_run_id,
  };
  return json(response, 200);
}

export const POST = handler("architect-plan", async (request: Request) => {
  const auth = await authenticate(request);
  if (!auth.ok) return auth.response;
  const { client } = auth;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const valid = architectPlanRequestSchema.safeParse(parsed.body);
  if (!valid.success) return json({ error: "invalid_input" }, 400);
  const req = valid.data;

  // Read through RLS as the caller. A non-admin sees no intake, so they are turned away
  // here — before a model call is spent on them — with the same 404 as a missing id.
  const { data: intake, error: intakeErr } = await client
    .from("scout_intakes")
    .select("org_name, final_bucket, review_status, organization_id")
    .eq("id", req.scoutIntakeId)
    .maybeSingle();
  if (intakeErr) {
    log("error", "route_failure", { step: "intake_lookup", code: intakeErr.code });
    return json({ error: "intake_lookup_failed" }, 502);
  }
  if (!intake) return json({ error: "intake_not_found" }, 404);
  if (intake.review_status !== "reviewed" || !intake.final_bucket) {
    return json({ error: "intake_not_reviewed" }, 422);
  }

  const replayed = await replay(client, req);
  if (replayed) return replayed;

  // Scoring is deterministic and server-side (architect.md §2): the reviewer's bucket,
  // not anything the body says, feeds the Scout cross-check.
  const bucket = intake.final_bucket as ScoutBucket;
  const maturity = scoreAssessment(req.answers, bucket);
  const input: PlanGenerationInput = {
    orgName: intake.org_name,
    bucket,
    maturity,
    q1_org_context: req.answers.q1_org_context,
    q9_current_decisions: req.answers.q9_current_decisions,
    q10_wished_decisions: req.answers.q10_wished_decisions,
    q17a_wish_list: req.answers.q17a_wish_list,
    q17b_biggest_worry: req.answers.q17b_biggest_worry,
    q18_past_blockers: req.answers.q18_past_blockers,
  };

  // Before the first paid call: the caller's hourly model budget (`_budget.ts`). Only
  // checked when a model call is actually about to be made — with no key configured the
  // template is free, and a 429 for a call that would not have happened is noise.
  if (modelKeyConfigured()) {
    const budget = await checkModelBudget(client);
    if (!budget.ok) return budget.response;
  }

  let draft: ArchitectTemplate;
  let source: ArchitectPlanResponse["source"];
  let runId: string | null;
  let model: string | null = null;
  try {
    const enriched = await enrichWithModel(input, {
      organizationId: intake.organization_id ?? undefined,
    });
    draft = { charter: enriched.charter, plan: enriched.plan };
    source = "model";
    runId = enriched.runId;
    model = enriched.model;
  } catch (err) {
    // The gateway already recorded this call as one `fallback` run (failureStatus) and
    // put its id on the error; nothing is recorded twice. A non-gateway throw is a bug
    // in the merge, not a model outcome — it still falls back, with no run to link.
    if (!(err instanceof GatewayError)) {
      log("error", "route_failure", { agent: "architect", step: "enrichment", errorName: errorName(err) });
    }
    draft = buildTemplate(input);
    source = "fallback";
    runId = err instanceof GatewayError ? err.runId : null;
  }

  const { data: approvalId, error: rpcErr } = await client.rpc("submit_architect_draft", {
    p_payload: toPayload(req, maturity, draft, source, model),
    p_idempotency_key: req.idempotencyKey,
    ...(runId ? { p_agent_run_id: runId } : {}),
  });
  if (rpcErr || typeof approvalId !== "string") {
    // The code alone: the message can carry ids, and the response carries neither.
    log("error", "route_failure", { step: "submit_architect_draft", code: rpcErr?.code ?? "no_id_returned" });
    return rpcErrorResponse(rpcErr?.code);
  }

  const response: ArchitectPlanResponse = {
    maturity,
    charter: draft.charter,
    plan: draft.plan,
    hitlTier: "L3",
    approvalId,
    source,
    runId,
  };
  return json(response, 200);
});
