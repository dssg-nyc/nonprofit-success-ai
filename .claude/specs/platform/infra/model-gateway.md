# Model Gateway
**Plate:** C5.2 in docs/nonprofit-success-system-design.html
**Status:** GAP
**PRD sections:** §7

## Responsibility
The single call site where any agent invokes a model — telemetry, error classification, and provider abstraction are centralized here so they are not per-agent decisions.

## Mechanism
Agent modules call `src/model/gateway.ts` → gateway wraps the Vercel AI SDK `generateObject` / `generateText` call → validates structured output against the agent's Zod schema → classifies errors on failure → on success, emits a telemetry event to `src/observability/recorder.ts` → returns the validated output or throws a typed `GatewayError` the agent catches to invoke its deterministic fallback.

One adapter: `@ai-sdk/google` (`google(modelId)`) backed by `GOOGLE_GENERATIVE_AI_API_KEY`. The key is server-only — the gateway module must never be imported from client code. The `vite.config.ts` server-only boundary enforces this; any Vite import of the gateway is a build error.

## Contract
- **Input:** `GatewayRequest<TSchema>` — `agentId` (string), `promptVersion` (string — must be registered in the gateway's prompt registry), `modelId` (string, e.g. `'gemini-2.0-flash'`), `prompt` (string), `schema` (Zod schema for `generateObject`) or `mode: 'text'` for `generateText`, `temperature?` (number, default 0.3), `engagementId?` (string | null)
- **Output:** `GatewayResponse<T>` — `result` (T — parsed object or string), `modelId`, `latencyMs` (number), `inputTokens` (number), `outputTokens` (number), `retried` (boolean)
- **Side effects:** Calls `recorder.record()` with the telemetry payload (fire-and-forget — gateway does not await the write). Throws `GatewayError` on unrecoverable failure.

## Rules
- One adapter. The codebase must not contain direct `@ai-sdk/google` or `@google/genai` calls outside `src/model/`. Any agent or screen calling a model directly is a violation.
- No LangChain, CrewAI, LlamaIndex, or other orchestration middleware. The AI SDK is the only abstraction layer.
- `GOOGLE_GENERATIVE_AI_API_KEY` is read via `process.env` at call time — not at module import time — so the module can be imported in tests without requiring the key to be set.
- Schema validation failures (Zod parse error on model output) are classified as `schema-validation` errors, not retried, and always trigger the agent's deterministic fallback.
- Rate-limit errors (HTTP 429) are retried once after `2^attempt * 500ms` backoff. Second rate-limit → `GatewayError` with `code: 'rate-limited'`.
- `stop_reason = refusal` and `stop_reason = max_tokens` are hard failures — throw, do not return partial output.
- Prompt versions are strings registered in the gateway. Unregistered prompt versions are rejected at runtime to prevent silent stale-prompt drift.
- Telemetry emission is fire-and-forget — a recorder failure must never block the model response from returning to the caller.
- Gateway does not derive HITL tiers — tier derivation happens in `src/guardrails/hitl.ts` after the gateway returns.
- No streaming in the initial implementation. Streaming is a separate delta.

## Dependencies
- **Imports:** `ai` (Vercel AI SDK core); `@ai-sdk/google`; `zod`; `src/observability/recorder.ts`; `src/types/` (`GatewayRequest`, `GatewayResponse`, `GatewayError`)
- **Imported by:** `src/agents/scout/`, `src/agents/architect/`, `src/agents/chronicle/`; `api/route-intake`, `api/architect-assess`, `api/chronicle-draft`; `src/evals/pipelines/judge/` (eval judge calls)
- **Data:** No direct Supabase access. Telemetry delegated to `recorder.ts`. `agent_runs` and `tool_calls` (`_deferred/0004_telemetry.sql`).

## Delta rows
Cited from [`roadmap.md`](../../../roadmap.md) — this spec does not mint numbers.

- **D3** — model gateway: `src/model/gateway.ts`, failure ladder, provider abstraction — SPECIFIED

## Test contract
- Happy path: mock `@ai-sdk/google` returns valid object → `GatewayResponse` with correct `result`, `latencyMs > 0`, `retried = false`.
- Schema validation failure: mock returns object that fails Zod parse → throws `GatewayError` with `code: 'schema-validation'`, no retry attempted.
- Rate-limit retry: mock throws 429 on first call, succeeds on second → `GatewayResponse` with `retried = true`.
- Double rate-limit: mock throws 429 twice → throws `GatewayError` with `code: 'rate-limited'` after one retry.
- Recorder failure: mock recorder throws → gateway returns `GatewayResponse` successfully (recorder failure is swallowed).
- Key absent: `process.env.GOOGLE_GENERATIVE_AI_API_KEY` undefined → throws `GatewayError` with `code: 'config-error'` at call time, not at import time.
- Unregistered prompt version: `promptVersion` not in registry → throws `GatewayError` with `code: 'unknown-prompt'`.
- Client import guard: importing gateway from a Vite client module → build error (verified via `vite.config.ts` server-only boundary).

## Open questions
1. Should `modelId` be configurable per-agent call or fixed per-agent in a gateway mapping (e.g., scout always uses flash, chronicle always uses pro)? A fixed-per-agent mapping avoids ad-hoc model selection drift across the codebase.
2. Token budget enforcement: should the gateway enforce per-agent `maxTokens` limits, or leave that to the caller's `GatewayRequest`?
3. Streaming: when does streaming become a requirement? Chronicle synthesis is the most likely first candidate.
