import { z } from "zod";
import { computePulseSignal } from "../src/agents/pulse/health";
import { toPulseInput } from "../src/agents/pulse/input";
import { log } from "../src/observability/log";
import { authenticate } from "./_auth";
import { handler } from "./_request";

export const maxDuration = 10;

const engagementIdSchema = z.string().uuid();

/**
 * GET /api/pulse-health?engagementId=<uuid> — Pulse's staff-facing health signal.
 *
 * Read-only and model-free: every query runs on the caller's client, so RLS decides
 * which engagements exist for them. A missing and a hidden engagement are the same 404.
 * No `agent_runs` write — Pulse is L2 by construction.
 */
export const GET = handler("pulse-health", async (request: Request) => {
  const auth = await authenticate(request);
  if (!auth.ok) return auth.response;

  const parsedId = engagementIdSchema.safeParse(
    new URL(request.url).searchParams.get("engagementId"),
  );
  if (!parsedId.success) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const engagementId = parsedId.data;

  // `engagements` has no stage-entered timestamp, so `updated_at` stands in (see
  // toPulseInput); R7's stage_advanced event is the precise source.
  const { data: engagement, error: engagementError } = await auth.client
    .from("engagements")
    .select("id, stage, updated_at, created_at, assessment_id")
    .eq("id", engagementId)
    .maybeSingle();
  if (engagementError) {
    log("error", "route_failure", {
      step: "engagement_lookup",
      code: engagementError.code,
      engagementId,
    });
    return Response.json({ error: "lookup_failed" }, { status: 503 });
  }
  if (!engagement) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const { data: latestEvent, error: eventsError } = await auth.client
    .from("engagement_events")
    .select("kind, created_at")
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (eventsError) {
    log("error", "route_failure", {
      step: "events_lookup",
      code: eventsError.code,
      engagementId,
    });
    return Response.json({ error: "lookup_failed" }, { status: 503 });
  }

  const now = new Date();
  return Response.json(computePulseSignal(toPulseInput(engagement, latestEvent, now), now), {
    status: 200,
  });
});
