# Model Gateway
**Plate:** C5.2 in docs/nonprofit-success-system-design.html
**Status:** see `roadmap.md` D3 (built) — build state lives only in the registry and in CLAUDE.md
**PRD sections:** §7

## Responsibility
The single call site where any agent invokes a model — telemetry, error classification, and provider abstraction are centralized here so they are not per-agent decisions.

## Mechanism
Agent modules call `src/model/gateway.ts` → gateway wraps the Vercel AI SDK `generateObject` / `generateText` call → validates structured output against the agent's Zod schema → classifies errors on failure → on success, emits a telemetry event to `src/observability/recorder.ts` → returns the validated output or throws a typed `GatewayError` the agent catches to invoke its deterministic fallback.

Two adapters, picked by model id (`providerOf()`): `@ai-sdk/google` (`google(modelId)`, `GOOGLE_GENERATIVE_AI_API_KEY`) for every agent, and `@ai-sdk/openai` (`openai(modelId)`, `OPENAI_API_KEY`) for ids starting `gpt-` or `o<digit>` — today only the eval judges (`gpt-5.4-nano`). Both keys are server-only and never `VITE_`-prefixed — the gateway module must never be imported from client code. The `vite.config.ts` server-only boundary enforces this; any Vite import of the gateway is a build error.

## Contract
- **Input:** `GatewayRequest<TSchema>` — `agentId` (string), `promptVersion` (string — free-form, recorded on the `agent_runs` row; there is no registry), `modelId` (string, e.g. `'gemini-3.5-flash-lite'` — the default, overridable by `GATEWAY_MODEL`; `gemini-2.5-flash` was retired for new keys on 2026-10-07, and `gemini-3.8-flash`'s 20 requests/day free tier cannot complete an eval run), `prompt` (string), `schema` (Zod schema for `generateObject`) or `mode: 'text'` for `generateText`, `temperature?` (number, default 0.3), `engagementId?` (string | null)
- **Output:** `GatewayResponse<T>` — `result` (T — parsed object or string), `modelId`, `latencyMs` (number), `inputTokens` (number), `outputTokens` (number), `retried` (boolean)
- **Side effects:** Calls `recorder.recordRun()` and **awaits** it, because the row's id comes back to the caller as `runId` (Architect links it to the approval via `submit_architect_draft(p_agent_run_id)`). The recorder never throws — a write failure resolves to `recorded: false`, `runId: null` — so awaiting cannot block or fail the model response. Throws `GatewayError` on unrecoverable failure. *(Decided 2026-10-07: the earlier "fire-and-forget" wording predates `runId`; the code is the contract.)*

## Rules
- Provider SDKs are imported only here. The codebase must not contain direct `@ai-sdk/google`, `@ai-sdk/openai` or `@google/genai` calls outside `src/model/`. Any agent or screen calling a model directly is a violation.
- No LangChain, CrewAI, LlamaIndex, or other orchestration middleware. The AI SDK is the only abstraction layer.
- The model's provider key (`PROVIDER_KEYS`) is read via `process.env` at call time — not at module import time — so the module can be imported in tests without requiring the key to be set.
- **Error codes** (`GatewayErrorCode`, `src/model/errors.ts`): `model_key_missing` (503), `model_call_failed` (502), `model_timeout` (504), `model_rate_limited` (429), `model_quota_exhausted` (429 — Google's per-day quota, read from the body's `QuotaFailure.quotaId`, or OpenAI's `insufficient_quota`; not retried), `model_unavailable` (503 — provider overloaded), `model_parse_error` (502). A rate-limit error carries `retryAfterMs` when the provider gave one (Google `RetryInfo`, OpenAI `retry-after-ms` / `retry-after`). They double as the `/api` error vocabulary (`{ error: code }`), so they are snake_case like every other handler code. Classification is by error type and status, never by message text.
- Schema validation failures (the SDK's `NoObjectGeneratedError` / `TypeValidationError` / `JSONParseError`) are `model_parse_error`, not retried, and always trigger the agent's deterministic fallback.
- Rate-limit errors (HTTP 429) are retried once after a fixed backoff. Second rate-limit → `GatewayError` with `code: 'model_rate_limited'`. A per-day quota 429 is not retried — it cannot clear within the request.
- Thinking is capped at `GATEWAY_THINKING_LEVEL` (default `low`; Gemini `thinkingLevel`, OpenAI `reasoningEffort`): every call is a structured extraction or a short draft that must land inside the 25s budget.
- `stop_reason = refusal` and `stop_reason = max_tokens` are hard failures — throw, do not return partial output.
- Prompt versions are free strings (`promptVersion`) recorded on the `agent_runs` row; nothing is rejected at runtime. A registry is a possible later delta, not a current rule.
- A recorder failure must never block or fail the model response. The recorder guarantees this by never throwing; the gateway awaits it only to obtain `runId`.
- Every call logs one structured `model_call` line (observability.md Rules) with latency, tokens, outcome and error code — never the error object, prompt or output.
- Gateway does not derive HITL tiers — tier derivation happens in `src/guardrails/hitl.ts` after the gateway returns.
- No streaming in the initial implementation. Streaming is a separate delta.

## Dependencies
- **Imports:** `ai` (Vercel AI SDK core); `@ai-sdk/google`; `@ai-sdk/openai`; `zod`; `src/observability/recorder.ts`; `src/types/` (`GatewayRequest`, `GatewayResponse`, `GatewayError`)
- **Imported by:** `src/agents/scout/`, `src/agents/architect/`, `src/agents/chronicle/`; `api/route-intake`, `api/architect-assess`, `api/chronicle-draft`; `src/evals/pipelines/judge/` (eval judge calls)
- **Data:** No direct Supabase access. Telemetry delegated to `recorder.ts`. `agent_runs` and `tool_calls` (`0004_telemetry.sql`).

## Delta rows
Cited from [`roadmap.md`](../../../roadmap.md) — this spec does not mint numbers.

- **D3** — model gateway: `src/model/gateway.ts`, failure ladder, provider abstraction — SPECIFIED

## Test contract
- Happy path: mock `@ai-sdk/google` returns valid object → `GatewayResponse` with correct `result`, `latencyMs > 0`, `retried = false`.
- Schema validation failure: mock returns object that fails Zod parse → throws `GatewayError` with `code: 'model_parse_error'`, no retry attempted.
- Rate-limit retry: mock throws 429 on first call, succeeds on second → `GatewayResponse` with `retried = true`.
- Double rate-limit: mock throws 429 twice → throws `GatewayError` with `code: 'model_rate_limited'` after one retry.
- Recorder failure: recorder resolves `recorded: false` → gateway returns `GatewayResponse` successfully with `runId: null`.
- Key absent: the model's provider key undefined → throws `GatewayError` with `code: 'model_key_missing'` at call time, not at import time.
- Client import guard: importing gateway from a Vite client module → build error (verified via `vite.config.ts` server-only boundary).

## Open questions
1. Should `modelId` be configurable per-agent call or fixed per-agent in a gateway mapping (e.g., scout always uses flash, chronicle always uses pro)? A fixed-per-agent mapping avoids ad-hoc model selection drift across the codebase.
2. Token budget enforcement: should the gateway enforce per-agent `maxTokens` limits, or leave that to the caller's `GatewayRequest`?
3. Streaming: when does streaming become a requirement? Chronicle synthesis is the most likely first candidate.
