import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, TablesInsert } from '../lib/database.types.js';
import type { AgentName } from '../model/types.js';
import { errorName, log } from './log.js';

/**
 * One `agent_runs` row. Telemetry only: no raw prompt text and no model output
 * (observability.md Rules) — those stay in the domain tables.
 */
export interface AgentRunPayload {
  agent: AgentName;
  organizationId?: string | null;
  engagementId?: string | null;
  model: string;
  promptVersion?: string;
  status: 'success' | 'fallback' | 'error';
  errorCode?: string;
  inputTokens?: number;
  outputTokens?: number;
  hitlTier?: 'L2' | 'L3';
  durationMs: number;
  /** List-price cost of the call in cents (`model/pricing.ts`); null when unpriced. */
  costCents?: number | null;
}

/** Never a fabricated id: a run that was not written says so. */
export type RecordResult =
  | { recorded: true; runId: string }
  | { recorded: false; reason: 'not_configured' | 'write_failed' };

type ServiceClient = SupabaseClient<Database>;

/**
 * The service-role client, created once at module load and reused across requests
 * (observability.md Rules). Not exported: this module is the only holder of a
 * service-role client, and it never hands it out.
 *
 * Null when unconfigured. Creation is wrapped because `createClient` throws on a
 * malformed URL, and a recorder that fails at import would take the gateway down with it.
 */
const serviceClient: ServiceClient | null = createServiceClient();

function createServiceClient(): ServiceClient | null {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  try {
    return createClient<Database>(url, key, {
      // Server-side, no user session: nothing to persist or refresh.
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch (err) {
    log('error', 'recorder_client_failed', { errorName: errorName(err) });
    return null;
  }
}

/** "Not configured" is a fact about the process, not the call: said once, not ~75 times an eval run. */
let warnedUnconfigured = false;

function toRow(payload: AgentRunPayload): TablesInsert<'agent_runs'> {
  return {
    agent: payload.agent,
    organization_id: payload.organizationId ?? null,
    engagement_id: payload.engagementId ?? null,
    model: payload.model,
    prompt_version: payload.promptVersion ?? null,
    status: payload.status,
    error_code: payload.errorCode ?? null,
    input_tokens: payload.inputTokens ?? null,
    output_tokens: payload.outputTokens ?? null,
    hitl_tier: payload.hitlTier ?? null,
    duration_ms: payload.durationMs,
    cost_cents: payload.costCents ?? null,
  };
}

/** Postgres: `invalid_text_representation` (not a uuid) and `foreign_key_violation`. */
const UNLINK_CODES = new Set(['22P02', '23503']);

type InsertResult = { recorded: true; runId: string } | { recorded: false; code: string };

async function insertRow(client: ServiceClient, row: TablesInsert<'agent_runs'>): Promise<InsertResult> {
  const { data, error } = await client.from('agent_runs').insert(row).select('id').single();
  // The code only: a Postgres error's `details` can quote the failing row.
  if (error || !data) return { recorded: false, code: error?.code ?? 'no_row_returned' };
  return { recorded: true, runId: data.id };
}

/**
 * Write one `agent_runs` row. Never throws: every failure resolves to
 * `{ recorded: false }` and is logged, so a telemetry outage cannot break an agent call.
 */
export async function recordRun(payload: AgentRunPayload): Promise<RecordResult> {
  if (!serviceClient) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      log('warn', 'recorder_unconfigured', { code: 'not_configured' });
    }
    return { recorded: false, reason: 'not_configured' };
  }

  try {
    const row = toRow(payload);
    const first = await insertRow(serviceClient, row);
    if (first.recorded) return first;

    // The link failed, not the telemetry: the id is not a uuid (22P02) or names no row
    // (23503 — eval fixtures carry ids like "e-101"; a transition can delete an
    // engagement under a run). Write the run unlinked rather than lose it; the row says
    // so through its null ids, and the line below says which link it was.
    if (UNLINK_CODES.has(first.code) && (row.engagement_id !== null || row.organization_id !== null)) {
      log('warn', 'recorder_unlinked', { agent: payload.agent, code: first.code });
      const retry = await insertRow(serviceClient, { ...row, engagement_id: null, organization_id: null });
      if (retry.recorded) return retry;
      log('error', 'recorder_write_failed', { agent: payload.agent, code: retry.code });
      return { recorded: false, reason: 'write_failed' };
    }

    log('error', 'recorder_write_failed', { agent: payload.agent, code: first.code });
    return { recorded: false, reason: 'write_failed' };
  } catch (err) {
    log('error', 'recorder_write_failed', { agent: payload.agent, code: 'recorder_threw', errorName: errorName(err) });
    return { recorded: false, reason: 'write_failed' };
  }
}
