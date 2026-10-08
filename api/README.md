# `api/` — Vercel Functions

The server side of the portal: eight routes under `/api`, deployed as Vercel
serverless functions by filesystem convention (this is a Vite SPA, not Next.js).
Each `.ts` file without a leading underscore is a route; `_env.ts`, `_http.ts`,
`_auth.ts`, `_request.ts` and `_budget.ts` are shared helpers. Tests live in
`__tests__/`: `*.test.ts` are unit tests (`npm test`), `*.int.test.ts` run against the
local Supabase stack (`make api-test`) — see Testing.

Conventions for writing a route are in `.claude/specs/stack/vercel-functions.md`.
This file explains what the routes *do* and how to operate them.

## Routes

| Route | Agent | Model call | Writes | Timeout |
|---|---|---|---|---|
| `GET /api/health` | — | no | — | 10s |
| `POST /api/route-intake` | Scout | yes, with fallback | `submit_scout_intake()` | 30s |
| `POST /api/architect-plan` | Architect | yes, with fallback | `submit_architect_draft()` | 30s |
| `POST /api/envoy-draft` | Envoy | yes, with fallback | `submit_envoy_draft()` | 30s |
| `POST /api/chronicle-draft` | Chronicle | yes, with fallback | `submit_chronicle_draft()` | 30s |
| `GET /api/pulse-health` | Pulse | no | nothing | 10s |
| `POST /api/engagement-transition` | — | no | `transition_engagement()` | 10s |
| `POST /api/scout-approve` | — | no | `approve_scout_intake()` | 10s |

Every route except `health` requires `Authorization: Bearer <supabase access token>`.
Every response carries `x-request-id` (see Observability).

### What each route does

**`health`** — `{ ok, modelKeyConfigured, supabase }`. `supabase` is `ok`,
`unreachable` (Auth's `/health` did not answer 2xx within 3s) or `unconfigured` (no URL
or anon key). `ok` is true only when Supabase is `ok`; otherwise the status is 503, so
an uptime check sees the dependency, not only the function. The model key is reported,
never required: a deployment without one serves every route from the fallbacks.

**`route-intake`** — Scout, end to end. Takes the whole public form
(`ScoutIntakeRequest`), routes it — the model for bucket and rationale, else the
deterministic heuristic (`agents/scout/routing.ts`) with a flag the review queue shows —
and files the row through `submit_scout_intake()` (0007), the only writer of
`scout_intakes`. The browser never writes the row and never chooses the tier: the RPC
derives `hitl_tier` from the linked `agent_runs` row, which only the recorder's service
role can create, so `L2` is earned by a successful model run that is still High + Ready
and cannot be claimed by a client. A fallback-routed intake files as `L3`. The response
is the `ScoutResult` plus `intakeId` and `routingSource` (`ai` / `derived`), with the
tier the database filed. Public visitors reach it with an anonymous Supabase session
(`src/lib/session.ts`, rate-limited per IP by Supabase Auth); without a token nothing
is filed and the form says so.

**`architect-plan`** — Architect. Reads the reviewed intake as the caller, scores the
assessment deterministically (`agents/architect/scoring.ts`), asks the model to enrich
the charter and 90-day plan, and saves the draft beside a pending L3 approval in one
RPC. If the model fails, the deterministic template is saved instead and the response
says `source: 'fallback'`. Replaying an `idempotencyKey` returns the original result
from the database without a second model call.

**`envoy-draft`** / **`chronicle-draft`** — same shape as Architect: lookup as the
caller, staff-membership check, replay check, model call with local fallback, one RPC
that writes the draft and the L3 approval. The body carries only `engagementId` and
`idempotencyKey` (Envoy adds `occasion` and optional `concerns`); every fact the draft is
written from — org name, engagement status, charter title / objectives / success criteria /
cadence, event count — is read through RLS by `_engagement.ts`, never taken from the body,
so a caller cannot make a `not_ready` record read as `ready`. Model prose is capped in
the model-facing schemas (`agents/*/schema.ts`); an over-long answer is a parse-error
fallback. Chronicle additionally refuses a
`not_ready` record (saves nothing, answers 200 with null ids) and requires a
`membership`-stage engagement. Nothing is ever sent to a partner from here; the send
step (`send-communication`, D45) does not exist yet.

**`pulse-health`** — Pulse. Read-only. Reads the engagement and its latest event
through RLS and computes the health signal in code. No model, no `agent_runs` row.

**`engagement-transition`** — the only writer of lifecycle stage. Pre-checks the
structural guards in code (`src/lib/lifecycle.ts`) so the error names the problem,
then calls `transition_engagement()`, which is the authority and re-checks everything.

**`scout-approve`** — the Scout-approve command (lifecycle §4 row 1), the way a
business enters the pipeline. One call to `approve_scout_intake()` (0008): reviews a
pending intake as `approved` (or `edited` when a different `finalBucket` is given), or
takes one the review queue already approved; creates the `businesses` row linked by
`scout_intake_id` if absent — the one column the 0001_core trigger lets only a non-API
role set, which is why the browser cannot do this; then opens `initial_meeting` through
`transition_engagement()` under the caller's `idempotencyKey`, so the event, the audit
row and replay come from the single writer of stage. A `redirected` intake is refused
(422 `guard_unmet` / `intake_approved`); an intake already in the pipeline under a new
key is 422 `already_approved`. The business is owned by the approving staff member
until the partner has an account. The review queue's Approve and Edit buttons call
this route (`approveScoutIntake` in `src/lib/api.ts`, one `idempotencyKey` per click);
Redirect stays a direct admin update of `scout_intakes`, since a redirected intake
never enters the pipeline.

## Request lifecycle

Every handler follows the same ladder, in this order:

1. **Auth** (`_auth.ts`). The bearer token is verified against Supabase Auth
   (`auth.getUser`), not decoded locally, so a signed-out session is rejected. The
   result is a **user-scoped** Supabase client: anon key + the caller's token. Every
   query and RPC in a handler runs as that user, so RLS and `is_admin()` see the real
   actor. No handler holds the service-role key.
2. **Body** (`_http.ts`). `parseJsonBody` → 400 `invalid_json`. No route 503s on a
   missing model key any more: every agent route answers from its fallback.
3. **Validation**. Zod schema from `src/schemas/` → 400 `invalid_input`.
4. **Lookups as the caller.** A row the caller cannot see is the same 404 as a missing
   id. Staff-only routes then check `organization_members` so a partner is turned away
   before any model quota is spent (the RPC re-checks as the authority).
5. **Replay.** If the `idempotencyKey` was seen, the original result is read back.
6. **Budget** (`_budget.ts`), only when a model key is configured. `check_model_budget()`
   (0007) counts the caller's calls this clock hour; over `MODEL_CALLS_PER_HOUR` it is
   429 `model_budget_exceeded` with `Retry-After`, and no call is made. Any other error
   from the budget RPC is logged (`route_failure`, step `budget`) and the request
   continues — a budget is never the reason a healthy request fails.
7. **Model call** through `src/model/gateway.ts` (25s budget, one retry on 429,
   structured output). Every route catches `GatewayError` and builds the fallback.
8. **One RPC** that writes the domain row, the approval and the audit event in a
   transaction. Postgres SQLSTATEs are mapped to HTTP in each route's
   `rpcErrorResponse`.

Every handler is wrapped by `handler()` in `_request.ts`, which assigns the request id,
runs the handler inside that log context, turns an uncaught throw into a logged 500
`internal_error` (never a stack trace in the body) and echoes `x-request-id`.

### Error codes

The body of every non-2xx is `{ error: <code> }`, nothing else. The SPA reads the code
to explain why it fell back and treats a non-2xx as "no result", never as data.

| Status | Codes |
|---|---|
| 400 | `invalid_json`, `invalid_input`, `invalid_draft`, `invalid_intake`, `invalid_transition` |
| 401 | `unauthorized` |
| 403 | `forbidden` |
| 404 | `intake_not_found`, `engagement_not_found`, `business_not_found`, `not_found` |
| 409 | `draft_superseded`, `terminal_stage`, `conflict` |
| 422 | `intake_not_reviewed`, `membership_stage_required`, `stage_skipped`, `reason_required`, `guard_unmet` |
| 429 | `model_budget_exceeded` (with `Retry-After`), `model_rate_limited`, `model_quota_exhausted` |
| 500 | `internal_error` — an uncaught throw, logged with the request id |
| 502 | `model_call_failed`, `model_parse_error`, `draft_save_failed`, `intake_write_failed`, `transition_failed`, `*_lookup_failed` |
| 503 | `model_unavailable`, `auth_not_configured`, `auth_unavailable`, `lookup_failed` |
| 504 | `model_timeout` |

The model codes (`model_*`) are what the gateway raises; since every route falls back,
they reach the body only through `pulse-health`-style routes that have no fallback —
today none — and otherwise appear in the `model_call` log line and the fallback flag.

## Server-derived fields

A model can never set these; the handler stamps them after the call:

- `hitlTier` — Scout: computed by `deriveHitlTier()` for the recorded run, then
  re-derived inside `submit_scout_intake()` from that run (service-role written) — a
  caller cannot pass a tier at all. Architect, Envoy and Chronicle are fixed `L3` inside
  their RPC.
- Architect `maturity` (the rubric over the answers, against the reviewer's
  `final_bucket`), Chronicle `readiness`, Pulse's whole signal.
- Org, author, provenance (`agent_run_id`, `prompt_version`, `model`) — set inside the
  RPCs from the caller's identity and the gateway's run.

## Environment

Read only in `_env.ts` and the gateway. All server-only; none carries `VITE_`.

| Variable | Used by | Missing → |
|---|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | gateway (agents) | every agent route answers from its deterministic fallback; no budget check |
| `OPENAI_API_KEY` | gateway (eval judges only) | judges skip |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` (fall back to the `VITE_` names) | `_auth.ts` | every authed route 503 `auth_not_configured` |
| `SUPABASE_SERVICE_ROLE_KEY` | `src/observability/recorder.ts` only | `agent_runs` not written; logged once as `recorder_unconfigured` |
| `GATEWAY_MODEL`, `GATEWAY_THINKING_LEVEL` | gateway | defaults (`gemini-3.5-flash-lite`, `low`) |
| `GATEWAY_PRICING` | `src/model/pricing.ts` | the built-in list prices; JSON `{ "<model id>": [inputUsdPerM, outputUsdPerM] }` adds or overrides a model |
| `MODEL_CALLS_PER_HOUR` | `_budget.ts` | 20 per user per clock hour (1–1000) |
| `LOG_LEVEL` | `log.ts` | `info` |

Local: `make dev-api` (`vercel dev`) serves the routes; `make dev` serves the SPA alone
and every agent runs its fallback.

## Observability

Two sinks, both populated by code in `src/`, not here:

**Structured logs** (`src/observability/log.ts`). One JSON line per event to stdout,
which Vercel captures as function logs. The field set is closed: ids, codes, numbers,
model names. No error objects, prompts, rows or intake text can reach a line.

Every line a handler emits carries `requestId` and `route`, set once per request by
`_request.ts` (Vercel's `x-vercel-id`, else a UUID) and propagated through
`AsyncLocalStorage`, so the `model_call` line, a `route_failure` and a `recorder_*`
line from one request can be joined. The same id is returned as the `x-request-id`
response header. `src/lib/api.ts` puts it on `ApiError.requestId`, and the intake form
shows it as "Reference: …" under an error, so a user's report leads to the exact lines.

| `event` | When | Level |
|---|---|---|
| `model_call` | every gateway call, success or failure: `agent`, `model`, `status`, `code`, `durationMs`, `inputTokens`, `outputTokens`, `retried`, `runId` | `info` success; `warn` absorbed failures (timeout, 429, 503, parse); `error` missing key / unclassified |
| `route_failure` | a handler step failed outside the gateway: `step`, `code`; `step: unhandled` is an uncaught throw (500) | `error` |
| `recorder_*` | the `agent_runs` write failed or is unconfigured | `warn` / `error` |

Successful requests on model-free routes (`pulse-health`, `engagement-transition`) and
successful RPC writes emit no line of their own; Vercel's request log carries their
status and duration.

**`agent_runs` table** (`src/observability/recorder.ts`, service role). One row per
gateway call: agent, org, engagement, model, prompt version, status
(`success` / `fallback` / `error`), error code, tokens, HITL tier, latency and
`cost_cents` — list price × tokens from `src/model/pricing.ts`, null for a model the
list does not know (`GATEWAY_PRICING` extends it) or a call that returned no usage. Append-only,
admin-read via RLS. The `agent_run_metrics` view (0006_views) aggregates it per
agent, org and day: error rate, fallback rate, p50/p95 latency, token sums, and the
staff override rate from `approvals`. `make metrics` prints it from the local stack.

Each draft's `agent_run_id` links the domain row to its run, so a saved draft can be
traced to the call that produced it.

## Testing

Four layers, each catching what the one below cannot. Only the first two run in
`make gate`; the third runs in CI as its own job and locally on demand; the fourth is a
person with a deployment URL.

| Layer | What is real | What is mocked | Run | CI |
|---|---|---|---|---|
| **Unit** — `api/__tests__/*.test.ts`, `src/**/__tests__/` | handler logic, zod schemas, HTTP mapping, log lines (`addLogSink`) | Supabase client, model gateway | `npm test` (in `make gate`) | `ci` job |
| **Database** — `supabase/tests/*.test.sql` (pgTAP) | schema, RLS, triggers, every RPC, `agent_run_metrics` | nothing (runs as each role inside a rolled-back transaction) | `make db-test` | `db-test` job |
| **Integration** — `api/__tests__/*.int.test.ts` | handlers in-process against the **running local stack**: Auth sessions, RLS, RPCs, the rows filed, `x-request-id` | the model only (`agents/scout/model`) | `make api-test` (after `make db-start`) | `api-test` job |

### Unit

Hermetic: `vitest.config.ts` excludes `*.int.test.ts`, so `npm test` never needs
Docker or a key. Logging is asserted through `addLogSink()` (`src/observability/log.ts`)
or by parsing the JSON `console.error` lines — see `route-intake.test.ts` `logged()` —
so a step that must log (`route_failure` with `step: budget`, `model_call_failed` with
`errorName`) is pinned by a test, not by reading the code.

### Database

Runs each file as the API roles (`set role anon|authenticated|service_role`) with the
JWT claims PostgREST would set, inside one transaction that rolls back, so nothing it
seeds survives. Everything that is "derived server-side" above — tier from the run,
provenance, org scoping, the lifecycle guards, the budget counter — has its
assertions here (`rpcs.test.sql`), including the `agent_run_metrics` view
(`spine.test.sql`). The pgTAP suite is the authority on what the schema does; the
integration suite checks that the handlers drive it correctly.

### Integration

`make api-test` reads the local stack's URL and keys from `supabase status`, drops any
model key from the environment (a test must never reach a real model), and runs
`vitest.integration.config.ts`: the `api/` handlers called directly with a `Request`,
as Vercel would call them, against the real local Postgres, Auth and PostgREST. Each
file opens real sessions (anonymous for the intake form, an email+password staff user
owning a fresh organization for staff routes), calls the handler, then reads back with
the service role what the handler filed. It fails on zero tests, like `db-test`.

What it covers today (21 tests): `health` 200 + `supabase: ok`; `route-intake` 401 /
400 / the fallback path filed as `L3` + `derived` / a seeded `success` + `L2`
`agent_runs` row filed as `L2` + `ai` with model and prompt version carried over / a
run recorded as `L3` filed as `L3` **whatever the result says** / a `fallback` run
refused by the RPC (`invalid_intake`, nothing filed) / a gateway error filed with no
run / the hourly budget spent on the real counter and `429` with `Retry-After`;
`pulse-health` as staff, as a session RLS hides the row from (404), and with no token;
`engagement-transition` the attested advance `initial_meeting → budget_check` (source
row completed, target opened, event detail carries `guard_deferred: contract`, replay
on the same key returns the same ids), the missing attestation (422), the first
transition on a business with no intake (422 `intake_approved`), and a business in
another organization (404); `scout-approve` an intake filed by a real anonymous
session through `submit_scout_intake()` reviewed, its business created and linked,
`initial_meeting` opened with the event carrying the key (then replayed on the same
key, refused on a new one), the business it opened advancing through
`engagement-transition`, a redirected intake refused with nothing created, the
submitter's own session (404: RLS hides the row) and no token (401), and an intake
under another organization (404).

Rows are cleaned up by `Cleanup` in `_stack.ts` except where no API role may delete:
`agent_runs` (append-only) keeps the seeded runs, tagged model `integration-model`;
`model_call_budget` prunes itself after a day; `audit_events` pins the organization and
staff user of any file that made a transition. Every leftover carries a fresh random
id, so it cannot change a later run; `make db-reset` clears them.

The file-level `vi.mock` of `agents/scout/model` is the one seam: `_stack.ts` refuses a
non-local `SUPABASE_URL`, and the model key is unset by the Make target, so the suite
cannot be pointed at a hosted project or a paid model by accident.

### Deploy check

`cd.yml` captures the URL `vercel deploy` prints and polls `GET /api/health` (up to a
minute) until it answers 200. Because `health` probes Supabase Auth with the
deployment's own env, a project with a missing or wrong `SUPABASE_URL` / anon key
fails the workflow here, not on the first visitor. A preview behind Vercel Deployment
Protection needs the project's bypass secret in `VERCEL_AUTOMATION_BYPASS_SECRET`.

## Known gaps

- **Nothing is hosted yet.** Vercel envs and the Supabase project are issue #27;
  migration sign-off and `db push` are #28.
- **No log retention or alerting.** Vercel keeps function logs for a short window
  unless a log drain is configured. Drain, alerts on `agent_run_metrics` and a
  dashboard are roadmap D44, not filed. The request id and `cost_cents` are there for
  it to use.
- **The budget is per user, not per IP or global.** Anonymous intake sessions are
  limited per IP by Supabase Auth (30 sign-ins/hour), and each session by
  `MODEL_CALLS_PER_HOUR`; a global daily cap on model spend is still a provider-side
  setting.
- **`cost_cents` is a list-price estimate**, not a bill: no caching discounts, no
  thinking-token surcharge, and `GATEWAY_PRICING` must be kept current when the model
  changes.
- **No CORS config.** Same-origin only, by Vercel default.
- **0007 and 0008 are applied locally only** (as is everything else) until #27 / #28.
- **The model path is measured only by eval runs** — CI never calls a model, and
  `cd.yml` only polls `/api/health` after a deploy. Posting one real intake to a
  deployment is a hand step (sign in anonymously, `POST /api/route-intake`, then check
  the `model_call` log line and the `agent_runs` row by `x-request-id`).
