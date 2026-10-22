import { createClient } from '@supabase/supabase-js';
import type { AgentName } from '../model/types';

export interface RunRecord {
  agent: AgentName;
  organizationId?: string;
  engagementId?: string;
  model?: string;
  promptVersion?: string;
  input: unknown;
  output: unknown;
  error: unknown;
  durationMs: number;
}

let serviceClient: ReturnType<typeof createClient> | null = null;

function getServiceClient(): ReturnType<typeof createClient> | null {
  if (serviceClient) return serviceClient;

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return null;
  serviceClient = createClient(url, key);
  return serviceClient;
}

export async function recordRun(record: RunRecord): Promise<string> {
  const client = getServiceClient();
  if (!client) {
    return crypto.randomUUID();
  }

  try {
    const row = {
      agent: record.agent,
      organization_id: record.organizationId ?? null,
      engagement_id: record.engagementId ?? null,
      model: record.model ?? null,
      prompt_version: record.promptVersion ?? null,
      input: record.input as Record<string, unknown>,
      output: record.output as Record<string, unknown> | null,
      error: record.error as Record<string, unknown> | null,
      duration_ms: record.durationMs,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped Supabase client (no codegen)
    const { data, error } = await (client as any)
      .from('agent_runs')
      .insert(row)
      .select('id')
      .single();

    if (error) {
      console.error('recorder: failed to write agent_run', error);
      return crypto.randomUUID();
    }
    return (data as { id: string }).id;
  } catch (err) {
    console.error('recorder: unexpected error', err);
    return crypto.randomUUID();
  }
}
