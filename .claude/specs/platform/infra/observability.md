# Observability / Recorder
**Plate:** C5.3 in docs/nonprofit-success-system-design.html
**Status:** see `roadmap.md` D4 (built) — build state lives only in the registry and in CLAUDE.md
**PRD sections:** §8

## Responsibility
Writes structured telemetry for every agent run to `agent_runs` and `tool_calls` — the audit and quality-monitoring trail for every model call in the system.

## Mechanism
`src/observability/recorder.ts` exports `record(payload: AgentRunPayload)` → writes one `agent_runs` row via service-role Supabase client → for each tool invocation in `payload.toolCalls[]`, writes one `tool_calls` row (FK to `agent_runs.id`). Called fire-and-forget from `src/model/gateway.ts` — the gateway does not await the write, so a recorder failure never blocks the agent response. The recorder is the only module that holds a service-role client; all other server code uses the anon client with RLS.

## Contract
- **Input:** `AgentRunPayload` — `agentId` (string), `engagementId?` (string | null), `organizationId?` (string | null), `modelId` (string), `promptVersion` (string), `inputTokens` (number), `outputTokens` (number), `latencyMs` (number), `hitlTier` ('L2' | 'L3'), `status` ('success' | 'fallback' | 'error'), `errorCode?` (string), `toolCalls?` (ToolCallPayload[])
- **Output:** `{ runId: string }` — UUID of the written `agent_runs` row, returned for correlation logging. Not surfaced to the agent caller.
- **Side effects:** Writes one `agent_runs` row; writes N `tool_calls` rows (N = `toolCalls.length`). Both are append-only — no update or delete.

## Rules
- Service-role Supabase client is instantiated once at module load and reused across requests — not per-call. The module must never export the client instance.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only. The recorder module must not be importable from client code (same Vite server-only boundary as the model gateway).
- Recorder failures are caught internally and logged (`recorder_write_failed`, error code only) — they must never throw to the caller. An unconfigured recorder logs `recorder_unconfigured` once per process, not per call.
- **Server logs are structured** (`src/observability/log.ts`): one JSON line per event — `ts`, `level`, `event`, then fields from a closed set (`agent`, `route`, `step`, `model`, `provider`, `promptVersion`, `status`, `code`, `providerStatus`, `durationMs`, `retried`, `inputTokens`, `outputTokens`, `runId`, ids, `errorName`, `detail` ≤200 chars). Every gateway call logs one `model_call` line, success `info`, absorbed failures (`model_timeout`, `model_rate_limited`, `model_quota_exhausted`, `model_unavailable`, `model_parse_error`) `warn`, `model_key_missing` / `model_call_failed` `error`. `LOG_LEVEL` (`info` default, `warn`, `error`, `silent`) filters the console only. `addLogSink()` delivers every line, below the level too, to an in-process sink; the eval harness uses it to write `calls.jsonl`. A sink receives the same closed-field `LogLine` the console would, so it cannot widen what a line carries.
- **No intake data in logs.** Never pass an error object, request, prompt, model output or Supabase row to a log call: an `APICallError` carries the full request body, and a Postgres error's `details` can quote the row. Log the class (`errorName`) and the code. *(2026-10-07: the gateway logged `gwErr.cause` whole; `gateway.test.ts` "never logs the prompt" pins the fix.)*
- `agent_runs` and `tool_calls` rows are append-only. RLS policy must deny UPDATE and DELETE for all roles including service-role on these tables.
- `engagementId` is nullable — Scout intake runs before an engagement record exists, so the Scout path writes `null` here.
- No PII and no raw model I/O in telemetry rows. `agent_runs` must not store raw prompt text or model output — those stay in the domain tables (`scout_intakes`, `architect_assessments`, etc.).
- Admin-only read: RLS policies on `agent_runs` and `tool_calls` gate reads to `is_admin()` users in the correct org.

## Q5 — production monitoring
The PRD (§15) Q5 asks five questions. Four are answered by the `agent_run_metrics` view (`0016_agent_run_metrics.sql`, `security_invoker`: one row per agent, organization and day, read through the RLS of `agent_runs` and `approvals`). Drift is the eval harness's job, not the database's.

| Question | Where it is answered | How |
|---|---|---|
| Drift | `src/evals/experiments/log.jsonl` | Judge pass rate per keyed run, by prompt version and prompt hash (`make eval`; eval-harness.md "Runs are experiments"). No `eval_runs` table. |
| Errors | `agent_run_metrics` | `error_rate` = errors / runs, `fallback_rate` = fallbacks / runs, per agent per day (`agent_runs.created_at::date`) |
| Latency | `agent_run_metrics` | `p50_ms`, `p95_ms` = `percentile_cont(0.5 / 0.95)` over `duration_ms` |
| Cost | `agent_run_metrics` | `cost_cents` (sum of non-null) with `runs_costed` (rows that carried a cost, so a sum over few rows is not read as the total); `input_tokens`, `output_tokens` |
| Staff override rate | `agent_run_metrics` | `override_rate` = rejected / (approved + rejected) over `approvals`, bucketed on `reviewed_at::date` (the day the human decided). `pending` and `expired` count in neither term. **"Edited" is not observable**: an edit is a new draft row, not an approval state; counting it needs the K2/C3 provenance chain. |

Local: `make metrics` prints the view from the local stack via `psql` as the local superuser (RLS bypassed, local only). An admin sees their orgs' rows; a partner sees nothing; anon has no grant. Alerting and hosted dashboards are J4. 0016 was written without a local database: `make db-reset && make db-test` is owed.

## Dependencies
- **Imports:** Supabase service-role client (`@supabase/supabase-js`); `src/types/` (`AgentRunPayload`, `ToolCallPayload`)
- **Imported by:** `src/model/gateway.ts` (sole caller in production); `src/evals/pipelines/judge/` (judge calls record via gateway, which calls recorder)
- **Data:** `agent_runs` table and `tool_calls` table (deferred `supabase/migrations/0004_telemetry.sql`)

## Delta rows
Cited from [`roadmap.md`](../../../roadmap.md) — this spec does not mint numbers.

- **D4** — observability: `agent_runs` + `tool_calls` + recorder — SPECIFIED
- **D4** (Q5 monitoring, I-23) — also carries `agent_run_metrics` (0016) and `make metrics`; hosted alerting is J4
- **D20** — provenance columns + the run→approval→transition chain — GAP

## Test contract
- Happy path: valid `AgentRunPayload` with two tool calls → `agent_runs` row written, two `tool_calls` rows written, `runId` returned.
- No tool calls: `toolCalls` omitted or empty array → `agent_runs` row written, no `tool_calls` rows, no error.
- Null `engagementId`: Scout payload with `engagementId = null` → row written successfully with null FK.
- Supabase insert failure: mock client throws on insert → recorder catches, logs to `console.error`, does not throw to caller.
- Append-only: attempt to UPDATE an `agent_runs` row via service-role client → RLS blocks (integration test against local Supabase).
- No PII: `AgentRunPayload` type must not include a `rawPrompt` or `rawOutput` field — TypeScript compile error if added.
- Module isolation: importing recorder from a Vite client module → build error.
- Override rate query: join `agent_runs` with `approvals` where `status = 'rejected'` — verify the join is possible with the written row schema (integration test).

## Open questions
1. `0004_telemetry.sql` is applied — the `AgentRunPayload` type must align with its `agent_runs` columns (`prompt_version` and `organization_id` are both present; `organization_id` has no FK until C1) before this delta lands.
2. Should `tool_calls` remain a separate table or collapse to a JSONB column on `agent_runs`? Separate table is queryable per-tool; JSONB is simpler. `0004_telemetry.sql` uses a separate table — confirm that stays.
3. Log aggregation: is Vercel's default function logging sufficient for MVP recorder failures, or do we need external log drains from day one?
