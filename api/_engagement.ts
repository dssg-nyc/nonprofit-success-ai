import { z } from "zod";
import { log } from "../src/observability/log";
import { architectCharterSchema } from "../src/schemas";
import type { UserClient } from "./_auth";

/**
 * The engagement facts the draft routes (Envoy, Chronicle) write from, read through the
 * caller's user-scoped client so RLS decides what is visible. Nothing here comes from
 * the request body: Chronicle's readiness is derived from `status`, `hasPlan` and
 * `eventCount`, and Envoy addresses `orgName`, so a caller who could supply them could
 * get a "ready" story for an empty engagement or a message addressed to the wrong
 * partner. The route still reads the engagement row itself for authority checks; this
 * helper adds the business name, the event count and the linked charter.
 */

export interface EngagementFacts {
  /** `engagements.status` — Chronicle's completion gate. */
  status: string;
  /** `businesses.name` of the engagement's partner. */
  orgName: string;
  /** Whether `engagements.assessment_id` points at an Architect assessment. */
  hasPlan: boolean;
  /** `engagement_events` rows for this engagement. */
  eventCount: number;
  /** From the linked charter, when one exists and parses. */
  planTitle?: string;
  objectives?: string[];
  successCriteria?: string[];
  cadence?: string;
}

/** The charter fields the drafts use; the rest of the JSON is ignored, and a malformed one reads as no charter. */
const charterFactsSchema = architectCharterSchema
  .pick({ title: true, objectives: true, successCriteria: true, cadence: true })
  .partial();

export type FactsResult =
  | { ok: true; facts: EngagementFacts }
  | { ok: false; response: Response };

function fail(step: string, code: string | undefined): FactsResult {
  log("error", "route_failure", { step, code: code ?? "no_row" });
  return { ok: false, response: Response.json({ error: "engagement_lookup_failed" }, { status: 502 }) };
}

export async function loadEngagementFacts(
  client: UserClient,
  engagement: { id: string; business_id: string; status: string; assessment_id: string | null },
): Promise<FactsResult> {
  const { data: business, error: bizErr } = await client
    .from("businesses")
    .select("name")
    .eq("id", engagement.business_id)
    .maybeSingle();
  if (bizErr || !business) return fail("business_lookup", bizErr?.code);

  const { count, error: countErr } = await client
    .from("engagement_events")
    .select("id", { count: "exact", head: true })
    .eq("engagement_id", engagement.id);
  if (countErr) return fail("event_count", countErr.code);

  let charter: z.infer<typeof charterFactsSchema> = {};
  if (engagement.assessment_id) {
    const { data: assessment, error: planErr } = await client
      .from("architect_assessments")
      .select("charter")
      .eq("id", engagement.assessment_id)
      .maybeSingle();
    if (planErr) return fail("charter_lookup", planErr.code);
    // An assessment the caller cannot see (or a charter that does not parse) is a plan
    // with no usable facts, not an error: `hasPlan` is the link, the facts are extra.
    const parsed = charterFactsSchema.safeParse(assessment?.charter ?? {});
    if (parsed.success) charter = parsed.data;
  }

  return {
    ok: true,
    facts: {
      status: engagement.status,
      orgName: business.name,
      hasPlan: engagement.assessment_id !== null,
      eventCount: count ?? 0,
      ...(charter.title ? { planTitle: charter.title } : {}),
      ...(charter.objectives?.length ? { objectives: charter.objectives } : {}),
      ...(charter.successCriteria?.length ? { successCriteria: charter.successCriteria } : {}),
      ...(charter.cadence ? { cadence: charter.cadence } : {}),
    },
  };
}
