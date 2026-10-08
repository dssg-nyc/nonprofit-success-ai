# Vercel AI SDK — conventions for this repo

Packages: `ai` (^7.x) + `@ai-sdk/google` (^4.x) + `@ai-sdk/openai` (^4.x). Default model:
`gemini-3.5-flash-lite` (`DEFAULT_MODEL` in `src/model/gateway.ts`; env `GATEWAY_MODEL` overrides).

## The gateway pattern

All model calls go through `src/model/gateway.ts:callModel()`. Never import
`generateText` (or any `ai` call) directly in an endpoint or agent module.

```typescript
import { callModel } from '../src/model/gateway';

const { object, runId } = await callModel({
  agent: 'scout',           // AgentName — recorded in agent_runs
  schema: scoutModelSchema, // Zod schema — the SDK validates the response
  prompt: buildRoutingPrompt(input, readiness),
  promptVersion: 'scout-routing-0.04', // SCOUT_ROUTING_PROMPT_VERSION, agents/scout/model.ts
  engagementId: input.engagementId,   // optional, for telemetry
  organizationId: input.organizationId, // optional, for telemetry
});
```

### What the gateway does

1. Checks for model key (throws `GatewayError` with code `model_key_missing` if absent)
2. Calls `generateText()` with `output: Output.object({ schema })`, on the provider
   `providerOf(modelId)` picks — `gpt-*` / `o<digit>*` ids go to OpenAI, everything else to Gemini
3. On success: writes `agent_runs` telemetry via `recordRun()`, returns `{ object, runId }`
4. On failure: classifies error via `classifyModelError()`, records the failed run, throws `GatewayError`

### What the gateway does NOT do

- Response assembly — the endpoint stamps server-derived fields (`hitlTier`, `composite_signal`)
- Input validation — the endpoint validates before calling the gateway
- Fallback selection — the endpoint decides whether to degrade to heuristics

## Structured output with Zod

Always use structured output (`generateText` + `Output.object`, via the gateway), never
free text + manual parsing. The SDK validates the model response against the Zod schema
at parse time.

```typescript
// agents/scout/schema.ts — the wire schema (schemas/scout.ts) minus what code derives
export const scoutModelSchema = scoutResultSchema.omit({
  hitlTier: true,         // guardrails/hitl.ts deriveHitlTier()
  composite_signal: true, // routing.ts scoreReadiness()
  poc_score: true,        // each score is 1..3, derived in routing.ts
  clarity_score: true,
  foothold_score: true,
});
```

### Schema rules

- **Never include server-derived fields in the model schema.** `hitlTier`,
  `composite_signal`, `engagementId`, `occasion` — these are stamped by the endpoint
  after the model call. Including them would let the model set its own tier.
- **Zod 4.x** in this repo (not 3.x) — check import paths.
- Export schemas from `src/agents/<agent>/schema.ts` alongside the prompt builder.

## Error handling

The gateway classifies errors into `GatewayErrorCode`:

| Code | HTTP | When |
|------|------|------|
| `model_key_missing` | 503 | No key configured — supported state, not a bug |
| `model_call_failed` | 502 | Generic model failure |
| `model_timeout` | 504 | Deadline exceeded |
| `model_rate_limited` | 429 | Per-minute rate limit hit (retryable) |
| `model_quota_exhausted` | 429 | Per-day quota exhausted — not retryable until the reset |
| `model_unavailable` | 503 | Provider overloaded ("high demand") — transient |
| `model_parse_error` | 502 | Model returned something the schema couldn't parse |

Endpoints catch `GatewayError` and return `err.toResponse()`:

```typescript
try {
  const { object } = await callModel({ ... });
  return Response.json({ ...object, hitlTier: 'L3' });
} catch (err) {
  if (err instanceof GatewayError) return err.toResponse();
  return Response.json({ error: 'model_call_failed' }, { status: 502 });
}
```

## The deterministic fallback contract

Every model-backed path has a pure local counterpart. The client calls the `/api`
endpoint; if it gets a non-2xx (no result body), it falls back to the heuristic.
The heuristic produces a usable result with no network call.

- Scout: `routeScoutIntake()` in `src/agents/scout/routing.ts`
- Architect: `generateNinetyDayPlan()` / `generateCharter()` in `src/agents/architect/plan.ts`
- Envoy: `generateEnvoyDraft()` in `src/agents/envoy/draft.ts`
- Chronicle: `generateChronicleDraft()` in `src/agents/chronicle/draft.ts`

A missing model key is a **supported state**: local dev has no key and the fallback
covers it. Never throw on boot for a missing key.

## Prompt construction

Prompts are built by pure functions in `src/agents/<agent>/schema.ts`:

```typescript
export function buildRoutingPrompt(input: ScoutRoutingInput): string {
  return `You are Scout, a nonprofit intake routing agent...
  Primary need: ${input.primary_need}
  ...`;
}
```

- Prompt builders are pure functions (no side effects, no model calls)
- They live alongside the schema in the agent's `schema.ts`
- Version the prompt via `promptVersion` in the gateway call — recorded in `agent_runs`

## What this repo does NOT use

- `streamText` / `streamObject` — no streaming endpoints yet
- `useChat` / `useCompletion` — no client-side AI SDK hooks
- `tool()` / function calling — no tool use yet
- Multi-step agents — each endpoint is a single model call
- `@ai-sdk/anthropic` — agents run on Google; `@ai-sdk/openai` is used, but only for the
  eval judges (default `gpt-5.4-nano`, `src/evals/graders/judges/base.ts`; `EVAL_JUDGE_MODEL` overrides)
