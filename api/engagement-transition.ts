import { z } from "zod";
import type { Json } from "../src/lib/database.types";
import { classifyTransition, deriveCurrentStage } from "../src/lib/lifecycle";
import { log } from "../src/observability/log";
import {
  engagementStageSchema,
  engagementTransitionRequestSchema,
  engagementTransitionResponseSchema,
} from "../src/schemas";
import { authenticate } from "./_auth";
import { parseJsonBody } from "./_http";
import { handler } from "./_request";

/**
 * POST /api/engagement-transition — the only writer of engagement lifecycle state
 * (crm/lifecycle.md §2). One call to `transition_engagement()` (0005_lifecycle): it derives the
 * current stage, authorizes the actor, evaluates the §4 guard and, in one transaction,
 * completes the source row, opens the target, and writes the event, the audit row and (for
 * an L3 transition) the approval. No model call anywhere: a transition is a decision, so
 * it belongs to deterministic code, not an agent.
 *
 * Authority is the caller's, never an elevated key's: every query below runs on the
 * user-scoped client from `_auth.ts`, and the function is SECURITY DEFINER with its own
 * `is_admin()` check. Partners get 403 on every transition. The handler pre-checks only
 * the structural conditions (skip, terminal, same, reason missing) so the response names
 * the problem before any write; the function re-checks all of it and is the authority.
 */

export const maxDuration = 10;

const json = (body: unknown, status: number) => Response.json(body, { status });

const rpcResultSchema = z.object({
  engagement_id: z.guid(),
  from_stage: engagementStageSchema.nullable(),
  to_stage: engagementStageSchema,
  transitioned_at: z.string(),
  event_id: z.guid(),
  approval_id: z.guid().nullable(),
  replayed: z.boolean(),
});

const MESSAGE_TOKENS = ["stage_skipped", "reason_required", "invalid_transition"] as const;

/** SQLSTATEs `transition_engagement()` raises (0005_lifecycle header) -> the status the SPA sees. */
function rpcErrorResponse(code: string | undefined, message: string | undefined): Response {
  if (code === "42501") return json({ error: "forbidden" }, 403);
  if (code === "P0002") return json({ error: "business_not_found" }, 404);
  if (code === "55000") {
    if (message === "terminal") return json({ error: "terminal_stage" }, 409);
    if (message?.startsWith("guard:")) {
      return json({ error: "guard_unmet", condition: message.slice("guard:".length) }, 422);
    }
  }
  if (code === "22023") {
    const token = MESSAGE_TOKENS.find((t) => t === message);
    return token ? json({ error: token }, 422) : json({ error: "invalid_transition" }, 400);
  }
  if (code === "23505") return json({ error: "conflict" }, 409);
  return json({ error: "transition_failed" }, 502);
}

export const POST = handler("engagement-transition", async (request: Request) => {
  const auth = await authenticate(request);
  if (!auth.ok) return auth.response;
  const { client } = auth;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const valid = engagementTransitionRequestSchema.safeParse(parsed.body);
  if (!valid.success) return json({ error: "invalid_input" }, 400);
  const req = valid.data;

  // Read through RLS as the caller: a business the caller cannot see is the same 404 as a
  // missing id.
  const { data: business, error: bizErr } = await client
    .from("businesses")
    .select("id, organization_id")
    .eq("id", req.businessId)
    .maybeSingle();
  if (bizErr) {
    log("error", "route_failure", { step: "business_lookup", code: bizErr.code });
    return json({ error: "transition_failed" }, 502);
  }
  if (!business) return json({ error: "business_not_found" }, 404);

  // Staff authority, checked here so a partner is turned away before anything else is
  // read. RLS lets a partner read their own business, so the lookup above does not. The
  // RPC re-checks (42501) as the authority.
  if (!business.organization_id) return json({ error: "invalid_transition" }, 400);
  const { data: membership, error: memberErr } = await client
    .from("organization_members")
    .select("role")
    .eq("organization_id", business.organization_id)
    .eq("user_id", auth.userId)
    .in("role", ["admin", "owner"])
    .maybeSingle();
  if (memberErr) {
    log("error", "route_failure", { step: "membership_lookup", code: memberErr.code });
    return json({ error: "transition_failed" }, 502);
  }
  if (!membership) return json({ error: "forbidden" }, 403);

  // A replayed key skips the pre-check: the transition already happened, so the current
  // stage no longer matches and the check would wrongly refuse it. The function returns
  // the original result.
  const { data: prior, error: priorErr } = await client
    .from("engagement_events")
    .select("id")
    .eq("idempotency_key", req.idempotencyKey)
    .maybeSingle();
  if (priorErr) {
    log("error", "route_failure", { step: "replay_lookup", code: priorErr.code });
    return json({ error: "transition_failed" }, 502);
  }

  if (!prior) {
    const { data: rows, error: rowsErr } = await client
      .from("engagements")
      .select("id, stage, status")
      .eq("business_id", req.businessId);
    if (rowsErr) {
      log("error", "route_failure", { step: "engagements_lookup", code: rowsErr.code });
      return json({ error: "transition_failed" }, 502);
    }
    const current = deriveCurrentStage(rows ?? []);
    const kind = classifyTransition(current?.stage ?? null, req.toStage);
    if (kind === "terminal") return json({ error: "terminal_stage" }, 409);
    if (kind === "skip") return json({ error: "stage_skipped" }, 422);
    if (kind === "same") return json({ error: "invalid_transition" }, 422);
    if (kind === "reversal" && !req.reason) return json({ error: "reason_required" }, 422);
  }

  const { data: result, error: rpcErr } = await client.rpc("transition_engagement", {
    p_business_id: req.businessId,
    p_to_stage: req.toStage,
    p_reason: req.reason ?? "",
    p_idempotency_key: req.idempotencyKey,
    p_evidence: (req.evidence ?? {}) as Json,
  });
  const out = rpcResultSchema.safeParse(result);
  if (rpcErr || !out.success) {
    // The code alone: the message can carry ids, and the response carries neither.
    log("error", "route_failure", {
      step: "transition_engagement",
      code: rpcErr?.code ?? "bad_result",
    });
    return rpcErrorResponse(rpcErr?.code, rpcErr?.message);
  }

  const response = engagementTransitionResponseSchema.safeParse({
    engagementId: out.data.engagement_id,
    fromStage: out.data.from_stage,
    toStage: out.data.to_stage,
    transitionedAt: out.data.transitioned_at,
    eventId: out.data.event_id,
    approvalId: out.data.approval_id,
    replayed: out.data.replayed,
  });
  if (!response.success) {
    log("error", "route_failure", { step: "response_schema", code: "transition_schema_mismatch" });
    return json({ error: "transition_failed" }, 502);
  }
  return json(response.data, 201);
});
