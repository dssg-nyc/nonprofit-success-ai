import { z } from "zod";
import { assessChronicleReadiness, generateChronicleDraft } from "../src/agents/chronicle/draft";
import { CHRONICLE_DRAFT_PROMPT_VERSION, draftChronicleWithModel } from "../src/agents/chronicle/model";
import type { Json } from "../src/lib/database.types";
import { GatewayError } from "../src/model/errors";
import { errorName, log } from "../src/observability/log";
import { chronicleDraftRequestSchema, chronicleDraftResponseSchema } from "../src/schemas";
import type { ChronicleDraft, ChronicleDraftRequest, ChronicleDraftResponse } from "../src/types";
import { authenticate } from "./_auth";
import type { UserClient } from "./_auth";
import { checkModelBudget } from "./_budget";
import { modelKeyConfigured } from "./_env";
import { parseJsonBody } from "./_http";
import { handler } from "./_request";

/**
 * POST /api/chronicle-draft — draft an impact story and submit it for staff approval
 * (L3) in one transaction (`submit_chronicle_draft`, 0004_drafts): a `chronicle_drafts` row, a
 * pending `story` approval, an audit event and the engagement's lesson candidate, upserted
 * beside it; the response carries its `lessonId`. A `not_ready` record saves nothing — no
 * row, no approval (chronicle.md §1) — and answers 200 with null ids.
 *
 * Falls back itself, as `architect-plan` does (design-system.md §2): a model failure — a
 * missing key included — saves the deterministic draft and answers 200 with
 * `source: 'fallback'`. A non-2xx means nothing was saved.
 *
 * Authority is the caller's, never an elevated key's: every query below runs on the
 * user-scoped client from `_auth.ts`. The completion gate is the RPC's, not this
 * handler's: it needs a `membership`-stage engagement on the business (lifecycle.md §5).
 * `readiness` is derived here from the request (`assessChronicleReadiness`), never
 * model-supplied.
 */

export const maxDuration = 30;

const json = (body: unknown, status: number) => Response.json(body, { status });

const rpcResultSchema = z.object({ approval_id: z.guid(), draft_id: z.guid(), lesson_id: z.guid().nullable() });

/** SQLSTATEs `submit_chronicle_draft()` raises (0004_drafts header) -> the status the SPA sees. */
function rpcErrorResponse(code: string | undefined): Response {
  if (code === "42501") return json({ error: "forbidden" }, 403);
  if (code === "P0002") return json({ error: "engagement_not_found" }, 404);
  if (code === "55000") return json({ error: "membership_stage_required" }, 422);
  if (code === "22023" || code?.startsWith("23")) return json({ error: "invalid_draft" }, 400);
  return json({ error: "draft_save_failed" }, 502);
}

/**
 * A replayed idempotency key returns the original result (design-system.md §8.1), read
 * back from the database with no second model call or write. Null when the key is new. A
 * key whose draft was since superseded has no original result left to return: 409.
 */
async function replay(client: UserClient, req: ChronicleDraftRequest): Promise<Response | null> {
  const { data: prior, error } = await client
    .from("approvals")
    .select("id, agent, entity_type, entity_id, status, agent_run_id, draft_id")
    .eq("idempotency_key", req.idempotencyKey)
    .maybeSingle();
  if (error) {
    log("error", "route_failure", { step: "replay_lookup", code: error.code });
    return json({ error: "draft_save_failed" }, 502);
  }
  if (!prior) return null;
  if (
    prior.agent !== "chronicle" ||
    prior.entity_type !== "story" ||
    prior.entity_id !== req.engagementId ||
    !prior.draft_id
  ) {
    return json({ error: "invalid_draft" }, 400);
  }
  if (prior.status === "expired") return json({ error: "draft_superseded" }, 409);

  const { data: row, error: rowErr } = await client
    .from("chronicle_drafts")
    .select("engagement_id, readiness, headline, narrative, outcomes, source_type, success_factors, failure_factors")
    .eq("id", prior.draft_id)
    .maybeSingle();
  if (rowErr || !row) {
    log("error", "route_failure", { step: "replay_read", code: rowErr?.code ?? "no_row" });
    return json({ error: "draft_save_failed" }, 502);
  }

  // The lesson candidate, by engagement. Absent or RLS-hidden is null, not an error.
  const { data: lesson, error: lessonErr } = await client
    .from("lessons")
    .select("id")
    .eq("engagement_id", req.engagementId)
    .maybeSingle();
  if (lessonErr) {
    log("error", "route_failure", { step: "replay_lesson", code: lessonErr.code });
  }

  // Only a recorded 'ai' row claims the model; anything else reads as the deterministic draft.
  const response = chronicleDraftResponseSchema.safeParse({
    engagementId: row.engagement_id,
    readiness: row.readiness,
    headline: row.headline,
    narrative: row.narrative,
    outcomes: row.outcomes,
    successFactors: row.success_factors,
    failureFactors: row.failure_factors,
    hitlTier: "L3",
    source: row.source_type === "ai" ? "model" : "fallback",
    approvalId: prior.id,
    draftId: prior.draft_id,
    lessonId: lesson?.id ?? null,
    runId: prior.agent_run_id,
  });
  if (!response.success) {
    log("error", "route_failure", { step: "replay_schema", code: "draft_schema_mismatch" });
    return json({ error: "draft_save_failed" }, 502);
  }
  return json(response.data, 200);
}

export const POST = handler("chronicle-draft", async (request: Request) => {
  // Staff-only: a draft is requested from inside the portal, so the caller must hold a
  // Supabase session. Without this anyone with the URL could spend model quota.
  const auth = await authenticate(request);
  if (!auth.ok) return auth.response;
  const { client } = auth;

  // With no model key this route still answers, from the deterministic draft, so a missing key is
  // a fallback here rather than a 503.
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const valid = chronicleDraftRequestSchema.safeParse(parsed.body);
  if (!valid.success) return json({ error: "invalid_input" }, 400);
  const req = valid.data;
  const { idempotencyKey, ...input } = req;

  // Read through RLS as the caller: an engagement the caller cannot see is the same 404 as
  // a missing id.
  const { data: engagement, error: engErr } = await client
    .from("engagements")
    .select("id, organization_id, business_id, stage")
    .eq("id", req.engagementId)
    .maybeSingle();
  if (engErr) {
    log("error", "route_failure", { step: "engagement_lookup", code: engErr.code });
    return json({ error: "engagement_lookup_failed" }, 502);
  }
  if (!engagement) return json({ error: "engagement_not_found" }, 404);

  // Staff authority is checked here, before a model call is spent: RLS lets a partner read
  // their own engagement, so the lookup above does not turn them away. The RPC re-checks
  // (42501) as the authority; this read only keeps a non-admin from draining model quota.
  if (!engagement.organization_id) return json({ error: "invalid_draft" }, 400);
  const { data: membership, error: memberErr } = await client
    .from("organization_members")
    .select("role")
    .eq("organization_id", engagement.organization_id)
    .eq("user_id", auth.userId)
    .in("role", ["admin", "owner"])
    .maybeSingle();
  if (memberErr) {
    log("error", "route_failure", { step: "membership_lookup", code: memberErr.code });
    return json({ error: "engagement_lookup_failed" }, 502);
  }
  if (!membership) return json({ error: "forbidden" }, 403);

  const replayed = await replay(client, req);
  if (replayed) return replayed;

  // Nothing to write a story from: the empty draft, no model call, nothing saved.
  if (assessChronicleReadiness(input) === "not_ready") {
    const empty: ChronicleDraftResponse = {
      ...generateChronicleDraft(input),
      source: "fallback",
      approvalId: null,
      draftId: null,
      lessonId: null,
      runId: null,
    };
    return json(empty, 200);
  }

  // The RPC's completion gate (55000), read here so a business with no membership stage
  // does not spend a model call it cannot save (lifecycle.md §5).
  const { data: membershipStage, error: stageErr } = await client
    .from("engagements")
    .select("id")
    .eq("business_id", engagement.business_id)
    .eq("stage", "membership")
    .limit(1)
    .maybeSingle();
  if (stageErr) {
    log("error", "route_failure", { step: "membership_stage_lookup", code: stageErr.code });
    return json({ error: "engagement_lookup_failed" }, 502);
  }
  if (!membershipStage) return json({ error: "membership_stage_required" }, 422);

  // readiness, engagementId and the tier are stamped in agents/chronicle/model.ts — never
  // taken from the model. A fallback saves the deterministic draft.
  // Before the first paid call: the caller's hourly model budget (`_budget.ts`). Only
  // checked when a model call is actually about to be made — with no key configured the
  // template is free, and a 429 for a call that would not have happened is noise.
  if (modelKeyConfigured()) {
    const budget = await checkModelBudget(client);
    if (!budget.ok) return budget.response;
  }

  let draft: ChronicleDraft;
  let source: ChronicleDraftResponse["source"];
  let runId: string | null;
  let model: string | null = null;
  try {
    const result = await draftChronicleWithModel(input);
    draft = result.draft;
    source = "model";
    runId = result.runId;
    model = result.model;
  } catch (err) {
    // The gateway already recorded this call as one `fallback` run and put its id on the
    // error. A non-gateway throw is a bug in the merge, not a model outcome.
    if (!(err instanceof GatewayError)) {
      log("error", "route_failure", { agent: "chronicle", step: "draft", errorName: errorName(err) });
    }
    draft = generateChronicleDraft(input);
    source = "fallback";
    runId = err instanceof GatewayError ? err.runId : null;
  }

  const { data: saved, error: rpcErr } = await client.rpc("submit_chronicle_draft", {
    p_payload: {
      engagement_id: draft.engagementId,
      readiness: draft.readiness,
      headline: draft.headline,
      narrative: draft.narrative,
      outcomes: draft.outcomes,
      success_factors: draft.successFactors,
      failure_factors: draft.failureFactors,
      source,
      prompt_version: CHRONICLE_DRAFT_PROMPT_VERSION,
      // Named so a model draft whose run went unrecorded is still saved (0004_drafts).
      ...(source === "model" && model ? { model } : {}),
    } as Json,
    p_idempotency_key: idempotencyKey,
    ...(runId ? { p_agent_run_id: runId } : {}),
  });
  const ids = rpcResultSchema.safeParse(saved);
  if (rpcErr || !ids.success) {
    // The code alone: the message can carry ids, and the response carries neither.
    log("error", "route_failure", { step: "submit_chronicle_draft", code: rpcErr?.code ?? "bad_result" });
    return rpcErrorResponse(rpcErr?.code);
  }

  const response: ChronicleDraftResponse = {
    ...draft,
    source,
    approvalId: ids.data.approval_id,
    draftId: ids.data.draft_id,
    lessonId: ids.data.lesson_id,
    runId,
  };
  return json(response, 200);
});
