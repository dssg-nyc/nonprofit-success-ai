import type { ZodType } from 'zod';

/** Which agent is making the call — recorded in agent_runs. */
export type AgentName = 'scout' | 'architect' | 'pulse' | 'envoy' | 'chronicle';

export interface GatewayRequest<T = unknown> {
  agent: AgentName;
  schema: ZodType<T>;
  prompt: string;
  /** Override the default model (env GATEWAY_MODEL or gemini-2.5-flash). */
  model?: string;
  engagementId?: string;
  organizationId?: string;
  /** Recorded in agent_runs.prompt_version for drift detection. */
  promptVersion?: string;
}

export interface GatewayResponse<T = unknown> {
  object: T;
  runId: string;
}

export interface ModelConfig {
  provider: 'google';
  modelId: string;
}
