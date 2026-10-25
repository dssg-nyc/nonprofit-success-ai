import { routeScoutIntakeWithModel } from "../src/agents/scout/model.js";
import { routeScoutIntake } from "../src/agents/scout/routing.js";
import { GatewayError } from "../src/model/errors.js";
import { errorName, log } from "../src/observability/log.js";
import { scoutIntakeRequestSchema, scoutIntakeResponseSchema } from "../src/schemas/index.js";
import type { ScoutIntakeResponse, ScoutResult, ScoutRoutingInput } from "../src/types/index.js";
import { authenticate } from "./_auth.js";
import { checkModelBudget } from "./_budget.js";
import { modelKeyConfigured } from "./_env.js";
import { parseJsonBody } from "./_http.js";
import { handler } from "./_request.js";
import { upsertApplicant } from "./_salesforce.js";
import { lookupScoutRegistry } from "./_scoutRegistry.js";

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
 *
 * Before routing, the applicant's IRS registry record is looked up from ProPublica
 * (`_scoutRegistry.ts`, R19) and handed to both routing paths as a fact and to the row
 * with its provenance. The lookup is best-effort: `unavailable` files the intake exactly
 * as it was filed before the record existed.
 *
 * The applicant's name and email are not filed: they go to Salesforce first
 * (`_salesforce.ts`, NPS #52 — an unverified applicant Account and its primary Contact),
 * and the row keeps the two ids. They still reach the router in memory (the POC score
 * reads the contact's role), but never the database. If Salesforce cannot take them the
 * route answers 502 before any model call: an intake with nobody to contact is not one
 * a reviewer can act on.
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
  // `ein` is a lookup hint, not a column: the record carries the EIN ProPublica confirmed.
  // The contact fields are split off so the RPC payload below cannot carry them.
  const { ein, contact_name_role: contactNameRole, contact_email: contactEmail, ...intake } = valid.data;
  // Normalised once, used twice: the free-text need only means something beside
  // `something_else`, so the model and the row see the same value — never a stray
  // string under a fixed need, never a `undefined` the model sees but the row drops.
  const primaryNeedOther =
    intake.primary_need === "something_else" ? (intake.primary_need_other ?? "").trim() : "";
  const applicant = await upsertApplicant(client, {
    orgName: intake.org_name,
    ein,
    contactNameRole,
    contactEmail,
  });
  if (!applicant.ok) return json({ error: "salesforce_unavailable" }, 502);

  const lookup = await lookupScoutRegistry(intake.org_name, ein);
  const input: ScoutRoutingInput = {
    scale: intake.scale,
    primary_need: intake.primary_need as ScoutRoutingInput["primary_need"],
    primary_need_other: primaryNeedOther || undefined,
    problem_description: intake.problem_description,
    current_systems: intake.current_systems,
    contact_name_role: contactNameRole,
    timeline: intake.timeline,
    // `null` only when the lookup ran and found nothing: `ambiguous` and `unavailable`
    // leave the router as uninformed as a skipped lookup, so neither earns the
    // "no record matched" flag.
    registry: lookup.status === "matched" || lookup.status === "not_found" ? lookup.registry : undefined,
  };

  // The model routes when it can; on any failure the heuristic does, and the intake
  // carries a flag saying so. The flag is for the reviewer (the review queue shows it),
  // not the applicant — the submitted screen is the same either way. A spent budget is
  // one more such failure: the public form must never turn an applicant away over a
  // quota they cannot see, so the intake is still filed, routed by the heuristic. Only a
  // caller the database cannot identify (401) is refused.
  let result: ScoutResult;
  let runId: string | null = null;
  if (modelKeyConfigured()) {
    const budget = await checkModelBudget(client);
    if (!budget.ok) {
      if (budget.status !== 429) return budget.response;
      result = fallback(input, "model_budget_exceeded");
    } else {
      try {
        ({ result, runId } = await routeScoutIntakeWithModel(input));
      } catch (err) {
        if (!(err instanceof GatewayError)) {
          log("error", "route_failure", { agent: "scout", step: "routing", errorName: errorName(err) });
        }
        const code = err instanceof GatewayError ? err.code : "model_call_failed";
        result = fallback(input, code);
      }
    }
  } else {
    result = fallback(input, "model_key_missing");
  }

  const { data, error: rpcErr } = await client.rpc("submit_scout_intake", {
    p_intake: {
      ...intake,
      salesforce_account_id: applicant.value.accountId,
      salesforce_contact_id: applicant.value.contactId,
      primary_need_other: primaryNeedOther,
      bucket: result.bucket,
      confidence: result.confidence,
      rationale: result.rationale,
      poc_score: result.poc_score,
      clarity_score: result.clarity_score,
      foothold_score: result.foothold_score,
      composite_signal: result.composite_signal,
      flags: result.flags,
      registry: lookup.registry,
      registry_lookup: lookup.status,
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

  const response: ScoutIntakeResponse = {
    ...result,
    ...filed.data,
    registry: lookup.registry,
    registryLookup: lookup.status,
  };
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
