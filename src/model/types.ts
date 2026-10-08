import type { ZodType } from 'zod';

/** Which agent is making the call — recorded in agent_runs. */
export type AgentName = 'scout' | 'architect' | 'pulse' | 'envoy' | 'chronicle';

/** The tiers an `agent_runs` row can carry (recorder.ts `hitlTier`). */
export type RecordedHitlTier = 'L2' | 'L3';

export interface GatewayRequest<T = unknown> {
  agent: AgentName;
  schema: ZodType<T>;
  prompt: string;
  /** Optional system prompt (judges use it; agents fold instructions into `prompt`). */
  system?: string;
  /**
   * Override the default model (env GATEWAY_MODEL or gemini-3.5-flash-lite). The id
   * picks the provider: `gpt-*` / `o<digit>*` is OpenAI, anything else Gemini.
   */
  model?: string;
  engagementId?: string;
  organizationId?: string;
  /** Recorded in agent_runs.prompt_version for drift detection. */
  promptVersion?: string;
  /**
   * Total wall-clock budget for the call, retry and backoff included. Defaults to
   * DEFAULT_TIMEOUT_MS, which sits under the 30s `maxDuration` of the /api handlers.
   */
  timeoutMs?: number;
  /** Output-token cap. Defaults to DEFAULT_MAX_OUTPUT_TOKENS. */
  maxOutputTokens?: number;
  /**
   * Maps a validated output to the tier recorded on its `agent_runs` row. The gateway
   * never decides a tier — callers pass a function that delegates to
   * `guardrails/hitl.ts` `deriveHitlTier()`, so the switch stays in one place.
   */
  recordTier?: (object: T) => RecordedHitlTier;
  /**
   * The `agent_runs.status` a failed call is recorded with. `error` (the default) is a
   * failure the caller surfaces as an error. `fallback` is for a caller that serves its
   * deterministic result *server-side* on any failure (Architect: the handler saves the
   * template), so the one row for the call says what the user actually got — instead of
   * an `error` row plus a second `fallback` row for the same request. With `fallback`, a
   * missing key is recorded too: it is a call that fell back, not a call never made.
   */
  failureStatus?: 'error' | 'fallback';
}

export interface GatewayUsage {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
}

export interface GatewayResponse<T = unknown> {
  object: T;
  /** null when the run was not recorded (recorder unconfigured or write failed). */
  runId: string | null;
  /** The model id that wrote `object` — known even when the run was not recorded. */
  model: string;
  usage: GatewayUsage;
  /** True when the first attempt was rate limited and the one permitted retry ran. */
  retried: boolean;
}

/** Model vendors the gateway can call — `providerOf()` picks one from the model id. */
export type ModelProvider = 'google' | 'openai';

export interface ModelConfig {
  provider: ModelProvider;
  modelId: string;
}
