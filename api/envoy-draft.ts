import { z } from "zod";
import { generateEnvoyDraft } from "../src/agents/envoy/draft";
import { draftEnvoyWithModel, ENVOY_DRAFT_PROMPT_VERSION } from "../src/agents/envoy/model";
import type { Json } from "../src/lib/database.types";
import { GatewayError } from "../src/model/errors";
import { errorName, log } from "../src/observability/log";
import { envoyDraftRequestSchema, envoyDraftResponseSchema } from "../src/schemas";
import type { EnvoyDraft, EnvoyDraftRequest, EnvoyDraftResponse, EnvoyInput } from "../src/types";
import { authenticate } from "./_auth";
import type { UserClient } from "./_auth";
import { checkModelBudget } from "./_budget";
import { modelKeyConfigured } from "./_env";
import { parseJsonBody } from "./_http";
import { loadEngagementFacts } from "./_engagement";
import { handler } from "./_request";

/**
 * POST /api/envoy-draft — draft a partner-facing message and submit it for staff
 * approval (L3) in one transaction (`submit_envoy_draft`, 0004_drafts): a `communications` row
 * with `status 'draft'`, a pending `communication` approval and an audit event.
 * Nothing is sent: the send path is C3, and no code here can set `sent_at`.
 *
 * Falls back itself, as `architect-plan` does (design-system.md §2): a model failure — a
 * missing key included — saves the occasion template and answers 200 with
 * `source: 'fallback'`. A non-2xx means nothing was saved.
 *
 * Authority is the caller's, never an elevated key's: every query below runs on the
 * user-scoped client from `_auth.ts`, so RLS and the RPC's `is_admin()` see the real
 * actor. Server-derived, never read from the body: `hitlTier` (always L3), the partner's
 * name, plan title and cadence (`_engagement.ts`), and the draft's org, author and
 * provenance (inside the RPC, from the model run).
 */

export const maxDuration = 30;

const json = (body: unknown, status: number) => Response.json(body, { status });

const rpcResultSchema = z.object({ approval_id: z.guid(), draft_id: z.guid() });

/** SQLSTATEs `submit_envoy_draft()` raises (0004_drafts header) -> the status the SPA sees. */
function rpcErrorResponse(code: string | undefined): Response {
  if (code === "42501") return json({ error: "forbidden" }, 403);
  if (code === "P0002") return json({ error: "engagement_not_found" }, 404);
  if (code === "22023" || code?.startsWith("23")) return json({ error: "invalid_draft" }, 400);
  return json({ error: "draft_save_failed" }, 502);
}

/**
 * A replayed idempotency key returns the original result (design-system.md §8.1), read
 * back from the database with no second model call or write. Null when the key is new. A
 * key whose draft was since superseded has no original result left to return: 409.
 */
async function replay(client: UserClient, req: EnvoyDraftRequest): Promise<Response | null> {
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
    prior.agent !== "envoy" ||
    prior.entity_type !== "communication" ||
    prior.entity_id !== req.engagementId ||
    !prior.draft_id
  ) {
    return json({ error: "invalid_draft" }, 400);
  }
  if (prior.status === "expired") return json({ error: "draft_superseded" }, 409);

  const { data: row, error: rowErr } = await client
    .from("communications")
    .select("engagement_id, occasion, subject, body, source_type")
    .eq("id", prior.draft_id)
    .maybeSingle();
  if (rowErr || !row) {
    log("error", "route_failure", { step: "replay_read", code: rowErr?.code ?? "no_row" });
    return json({ error: "draft_save_failed" }, 502);
  }

  // Only a recorded 'ai' row claims the model; anything else reads as the template.
  const response = envoyDraftResponseSchema.safeParse({
    engagementId: row.engagement_id,
    occasion: row.occasion,
    subject: row.subject,
    body: row.body,
    hitlTier: "L3",
    source: row.source_type === "ai" ? "model" : "fallback",
    approvalId: prior.id,
    draftId: prior.draft_id,
    runId: prior.agent_run_id,
  });
  if (!response.success) {
    log("error", "route_failure", { step: "replay_schema", code: "draft_schema_mismatch" });
    return json({ error: "draft_save_failed" }, 502);
  }
  return json(response.data, 200);
}

export const POST = handler("envoy-draft", async (request: Request) => {
  // Staff-only: a draft is requested from inside the portal, so the caller must hold a
  // Supabase session. Without this anyone with the URL could spend model quota.
  const auth = await authenticate(request);
  if (!auth.ok) return auth.response;
  const { client } = auth;

  // With no model key this route still answers, from the template, so a missing key is
  // a fallback here rather than a 503.
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const valid = envoyDraftRequestSchema.safeParse(parsed.body);
  if (!valid.success) return json({ error: "invalid_input" }, 400);
  const req = valid.data;
  const { idempotencyKey } = req;

  // Read through RLS as the caller: an engagement the caller cannot see is the same 404 as
  // a missing id.
  const { data: engagement, error: engErr } = await client
    .from("engagements")
    .select("id, organization_id, business_id, stage, status, assessment_id")
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

  // The partner's name, the plan title and the cadence are read here, through RLS, never
  // from the body, so a draft cannot be addressed to an organisation or a plan that is
  // not this engagement's. `concerns` stays the caller's: staff choose what Pulse context
  // may be paraphrased to the partner.
  const loaded = await loadEngagementFacts(client, engagement);
  if (!loaded.ok) return loaded.response;
  const { orgName, planTitle, cadence } = loaded.facts;
  const input: EnvoyInput = {
    engagementId: req.engagementId,
    occasion: req.occasion,
    orgName,
    ...(planTitle ? { planTitle } : {}),
    ...(cadence ? { cadence } : {}),
    ...(req.concerns ? { concerns: req.concerns } : {}),
  };

  // Before the first paid call: the caller's hourly model budget (`_budget.ts`). Only
  // checked when a model call is actually about to be made — with no key configured the
  // template is free, and a 429 for a call that would not have happened is noise.
  if (modelKeyConfigured()) {
    const budget = await checkModelBudget(client);
    if (!budget.ok) return budget.response;
  }

  // engagementId, occasion and the HITL tier are stamped in agents/envoy/model.ts (tier
  // via guardrails/hitl.ts) — never taken from the model. A fallback saves the template.
  let draft: EnvoyDraft;
  let source: EnvoyDraftResponse["source"];
  let runId: string | null;
  let model: string | null = null;
  try {
    const result = await draftEnvoyWithModel(input);
    draft = result.draft;
    source = "model";
    runId = result.runId;
    model = result.model;
  } catch (err) {
    // The gateway already recorded this call as one `fallback` run and put its id on the
    // error. A non-gateway throw is a bug in the merge, not a model outcome.
    if (!(err instanceof GatewayError)) {
      log("error", "route_failure", { agent: "envoy", step: "draft", errorName: errorName(err) });
    }
    draft = generateEnvoyDraft(input);
    source = "fallback";
    runId = err instanceof GatewayError ? err.runId : null;
  }

  const { data: saved, error: rpcErr } = await client.rpc("submit_envoy_draft", {
    p_payload: {
      engagement_id: draft.engagementId,
      occasion: draft.occasion,
      subject: draft.subject,
      body: draft.body,
      source,
      prompt_version: ENVOY_DRAFT_PROMPT_VERSION,
      // Named so a model draft whose run went unrecorded is still saved (0004_drafts).
      ...(source === "model" && model ? { model } : {}),
    } as Json,
    p_idempotency_key: idempotencyKey,
    ...(runId ? { p_agent_run_id: runId } : {}),
  });
  const ids = rpcResultSchema.safeParse(saved);
  if (rpcErr || !ids.success) {
    // The code alone: the message can carry ids, and the response carries neither.
    log("error", "route_failure", { step: "submit_envoy_draft", code: rpcErr?.code ?? "bad_result" });
    return rpcErrorResponse(rpcErr?.code);
  }

  const response: EnvoyDraftResponse = {
    ...draft,
    source,
    approvalId: ids.data.approval_id,
    draftId: ids.data.draft_id,
    runId,
  };
  return json(response, 200);
});
