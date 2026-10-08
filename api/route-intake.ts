import { routeScoutIntakeWithModel } from "../src/agents/scout/model";
import { routeScoutIntake } from "../src/agents/scout/routing";
import { GatewayError } from "../src/model/errors";
import { errorName, log } from "../src/observability/log";
import { scoutIntakeRequestSchema, scoutIntakeResponseSchema } from "../src/schemas";
import type { ScoutIntakeResponse, ScoutResult, ScoutRoutingInput } from "../src/types";
import { authenticate } from "./_auth";
import { checkModelBudget } from "./_budget";
import { modelKeyConfigured } from "./_env";
import { parseJsonBody } from "./_http";
import { handler } from "./_request";

export const maxDuration = 30;

/**
 * The public intake, end to end: route the submission (model, else the deterministic
 * heuristic) and file it through `submit_scout_intake()` (0007), the only writer of
 * `scout_intakes`. The browser never writes the row and never chooses the tier: the RPC
 * derives `hitl_tier` from the linked `agent_runs` row, which only the recorder's
 * service role can create, so `L2` cannot be claimed by a client — it can only be
 * earned by a successful model run whose result is still High + Ready.
 *
 * The form is public, but the route is not: the SPA signs the visitor in anonymously
 * and sends that token, so only sessions Supabase Auth issued (and rate-limited per IP)
 * can spend model quota, and each session has an hourly budget (`_budget.ts`).
 *
 * The response's tier is the one filed, not the one computed: a fallback-routed intake
 * is `L3` whatever the heuristic's confidence, because no run backs it.
 */

function json(body: unknown, status: number) {
  return Response.json(body, { status });
}

function rpcErrorResponse(code: string | undefined): Response {
  if (code === "22023" || code === "22P02" || code?.startsWith("23")) {
    return json({ error: "invalid_intake" }, 400);
  }
  return json({ error: "intake_write_failed" }, 502);
}

export const POST = handler("route-intake", async (request: Request) => {
  const auth = await authenticate(request);
  if (!auth.ok) return auth.response;
  const { client } = auth;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const valid = scoutIntakeRequestSchema.safeParse(parsed.body);
  if (!valid.success) return json({ error: "invalid_input" }, 400);
  const intake = valid.data;
  const input: ScoutRoutingInput = {
    scale: intake.scale,
    primary_need: intake.primary_need as ScoutRoutingInput["primary_need"],
    primary_need_other: intake.primary_need_other || undefined,
    problem_description: intake.problem_description,
    current_systems: intake.current_systems,
    contact_name_role: intake.contact_name_role,
    timeline: intake.timeline,
  };

  // The model routes when it can; on any failure the heuristic does, and the intake
  // carries a flag saying so. The flag is for the reviewer (the review queue shows it),
  // not the applicant — the submitted screen is the same either way.
  let result: ScoutResult;
  let runId: string | null = null;
  if (modelKeyConfigured()) {
    const budget = await checkModelBudget(client);
    if (!budget.ok) return budget.response;
    try {
      ({ result, runId } = await routeScoutIntakeWithModel(input));
    } catch (err) {
      if (!(err instanceof GatewayError)) {
        log("error", "route_failure", { agent: "scout", step: "routing", errorName: errorName(err) });
      }
      const code = err instanceof GatewayError ? err.code : "model_call_failed";
      result = fallback(input, code);
    }
  } else {
    result = fallback(input, "model_key_missing");
  }

  const { data, error: rpcErr } = await client.rpc("submit_scout_intake", {
    p_intake: {
      ...intake,
      primary_need_other: intake.primary_need === "something_else" ? (intake.primary_need_other ?? "") : "",
      bucket: result.bucket,
      confidence: result.confidence,
      rationale: result.rationale,
      poc_score: result.poc_score,
      clarity_score: result.clarity_score,
      foothold_score: result.foothold_score,
      composite_signal: result.composite_signal,
      flags: result.flags,
    },
    // A run id is only sent for a model result: the RPC refuses a run that did not
    // succeed, and the fallback's failed run is not the provenance of its result.
    ...(runId ? { p_agent_run_id: runId } : {}),
  });
  const filed = scoutIntakeResponseSchema
    .pick({ intakeId: true, hitlTier: true, routingSource: true })
    .safeParse(
      data && typeof data === "object"
        ? {
            intakeId: (data as Record<string, unknown>).intake_id,
            hitlTier: (data as Record<string, unknown>).hitl_tier,
            routingSource: (data as Record<string, unknown>).routing_source,
          }
        : null,
    );
  if (rpcErr || !filed.success) {
    log("error", "route_failure", { step: "submit_scout_intake", code: rpcErr?.code ?? "bad_result", runId });
    return rpcErrorResponse(rpcErr?.code);
  }

  const response: ScoutIntakeResponse = { ...result, ...filed.data };
  return json(response, 200);
});

function fallback(input: ScoutRoutingInput, code: string): ScoutResult {
  const routed = routeScoutIntake(input);
  return {
    ...routed,
    // No run backs a fallback result, so the RPC files it as L3; say the same here.
    hitlTier: "L3",
    flags: [...routed.flags, `Routed by the deterministic fallback — model unavailable (${code})`],
  };
}
