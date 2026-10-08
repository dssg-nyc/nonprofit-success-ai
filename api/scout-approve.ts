import { z } from "zod";
import { log } from "../src/observability/log";
import { scoutApproveRequestSchema, scoutApproveResponseSchema } from "../src/schemas";
import { authenticate } from "./_auth";
import { parseJsonBody } from "./_http";
import { handler } from "./_request";

/**
 * POST /api/scout-approve — the Scout-approve command (crm/lifecycle.md §4 row 1): the
 * "System" transition that opens the pipeline. One call to `approve_scout_intake()`
 * (0008_scout_approve): it reviews a pending intake (or takes one the review queue already
 * approved/edited), creates the `businesses` row linked by `scout_intake_id` if absent —
 * the column only a non-API role may set, which is why this cannot be done from the
 * browser — and opens `initial_meeting` through `transition_engagement()`, so the event,
 * the audit row and replay come from the single writer of stage. No model call: approving
 * is a staff decision, so it belongs to deterministic code, not an agent.
 *
 * Authority is the caller's, never an elevated key's: the lookups run on the user-scoped
 * client from `_auth.ts`, and the function is SECURITY DEFINER with its own `is_admin()`
 * and per-organization checks. The handler pre-checks only what names the problem
 * before any write (intake visible, caller is staff); the function is the authority.
 */

export const maxDuration = 10;

const json = (body: unknown, status: number) => Response.json(body, { status });

const rpcResultSchema = z.object({
  intake_id: z.guid(),
  business_id: z.guid(),
  business_created: z.boolean(),
  review_action: z.enum(["approved", "edited"]),
  final_bucket: z.string(),
  engagement_id: z.guid(),
  event_id: z.guid(),
  transitioned_at: z.string(),
  replayed: z.boolean(),
});

const MESSAGE_TOKENS = [
  "bucket_required",
  "already_reviewed",
  "already_approved",
  "organization_required",
] as const;

/** SQLSTATEs `approve_scout_intake()` raises (0008 header) -> the status the SPA sees. */
function rpcErrorResponse(code: string | undefined, message: string | undefined): Response {
  if (code === "42501") return json({ error: "forbidden" }, 403);
  if (code === "P0002") return json({ error: "intake_not_found" }, 404);
  if (code === "55000" && message?.startsWith("guard:")) {
    return json({ error: "guard_unmet", condition: message.slice("guard:".length) }, 422);
  }
  if (code === "22023") {
    const token = MESSAGE_TOKENS.find((t) => t === message);
    return token ? json({ error: token }, 422) : json({ error: "invalid_input" }, 400);
  }
  if (code === "23505") return json({ error: "conflict" }, 409);
  return json({ error: "approve_failed" }, 502);
}

export const POST = handler("scout-approve", async (request: Request) => {
  const auth = await authenticate(request);
  if (!auth.ok) return auth.response;
  const { client } = auth;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const valid = scoutApproveRequestSchema.safeParse(parsed.body);
  if (!valid.success) return json({ error: "invalid_input" }, 400);
  const req = valid.data;

  // Read through RLS as the caller: scout_intakes is admin-only, and an intake filed
  // under another organization is the same 404 as a missing id.
  const { data: intake, error: intakeErr } = await client
    .from("scout_intakes")
    .select("id, organization_id")
    .eq("id", req.intakeId)
    .maybeSingle();
  if (intakeErr) {
    log("error", "route_failure", { step: "intake_lookup", code: intakeErr.code });
    return json({ error: "approve_failed" }, 502);
  }
  if (!intake) return json({ error: "intake_not_found" }, 404);

  // Staff authority in the organization the engagement lands in, checked here so the
  // answer is a 403 before anything is written. The RPC re-checks (42501) as the authority.
  const organizationId = intake.organization_id ?? req.organizationId ?? null;
  let membership = client
    .from("organization_members")
    .select("role")
    .eq("user_id", auth.userId)
    .in("role", ["admin", "owner"]);
  if (organizationId) membership = membership.eq("organization_id", organizationId);
  const { data: roles, error: memberErr } = await membership.limit(1);
  if (memberErr) {
    log("error", "route_failure", { step: "membership_lookup", code: memberErr.code });
    return json({ error: "approve_failed" }, 502);
  }
  if (!roles || roles.length === 0) return json({ error: "forbidden" }, 403);

  const { data: result, error: rpcErr } = await client.rpc("approve_scout_intake", {
    p_intake_id: req.intakeId,
    p_idempotency_key: req.idempotencyKey,
    ...(req.finalBucket ? { p_final_bucket: req.finalBucket } : {}),
    ...(req.reviewNotes ? { p_review_notes: req.reviewNotes } : {}),
    ...(req.businessType ? { p_business_type: req.businessType } : {}),
    ...(req.organizationId ? { p_organization_id: req.organizationId } : {}),
  });
  const out = rpcResultSchema.safeParse(result);
  if (rpcErr || !out.success) {
    // The code alone: the message can carry ids, and the response carries neither.
    log("error", "route_failure", {
      step: "approve_scout_intake",
      code: rpcErr?.code ?? "bad_result",
    });
    return rpcErrorResponse(rpcErr?.code, rpcErr?.message);
  }

  const response = scoutApproveResponseSchema.safeParse({
    intakeId: out.data.intake_id,
    businessId: out.data.business_id,
    businessCreated: out.data.business_created,
    reviewAction: out.data.review_action,
    finalBucket: out.data.final_bucket,
    engagementId: out.data.engagement_id,
    eventId: out.data.event_id,
    transitionedAt: out.data.transitioned_at,
    replayed: out.data.replayed,
  });
  if (!response.success) {
    log("error", "route_failure", { step: "response_schema", code: "approve_schema_mismatch" });
    return json({ error: "approve_failed" }, 502);
  }
  return json(response.data, 201);
});
