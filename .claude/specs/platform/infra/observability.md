# Observability / Recorder
**Plate:** C5.3 in docs/nonprofit-success-system-design.html
**Status:** GAP
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
- Recorder failures are caught internally and logged to `console.error` — they must never throw to the caller. The gateway's fire-and-forget pattern depends on this.
- `agent_runs` and `tool_calls` rows are append-only. RLS policy must deny UPDATE and DELETE for all roles including service-role on these tables.
- `engagementId` is nullable — Scout intake runs before an engagement record exists, so the Scout path writes `null` here.
- No PII and no raw model I/O in telemetry rows. `agent_runs` must not store raw prompt text or model output — those stay in the domain tables (`scout_intakes`, `architect_assessments`, etc.).
- Admin-only read: RLS policies on `agent_runs` and `tool_calls` gate reads to `is_admin()` users in the correct org.

## Dependencies
- **Imports:** Supabase service-role client (`@supabase/supabase-js`); `src/types/` (`AgentRunPayload`, `ToolCallPayload`)
- **Imported by:** `src/model/gateway.ts` (sole caller in production); `src/evals/pipelines/judge/` (judge calls record via gateway, which calls recorder)
- **Data:** `agent_runs` table and `tool_calls` table (deferred `supabase/migrations/_deferred/0004_telemetry.sql`)

## Delta rows
Cited from [`roadmap.md`](../../../roadmap.md) — this spec does not mint numbers.

- **D4** — observability: `agent_runs` + `tool_calls` + recorder — SPECIFIED
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
1. `0004_telemetry.sql` is in `_deferred/` — what columns does `agent_runs` currently define? The `AgentRunPayload` type must align with that schema before this delta lands. Confirm whether `promptVersion` and `organizationId` are in the current deferred schema.
2. Should `tool_calls` remain a separate table or collapse to a JSONB column on `agent_runs`? Separate table is queryable per-tool; JSONB is simpler. Current deferred migration uses separate table — confirm that stays.
3. Log aggregation: is Vercel's default function logging sufficient for MVP recorder failures, or do we need external log drains from day one?
