# Vercel Functions — conventions for this repo

This is a **Vite SPA** deployed to Vercel, not Next.js. Functions are discovered at
`/api` by filesystem convention — each `.ts` file in `api/` becomes a serverless function.

## File conventions

| Pattern | Meaning |
|---------|---------|
| `api/health.ts` | Routable function → `GET /api/health` (the only unauthenticated route) |
| `api/route-intake.ts` | `POST /api/route-intake` — Scout |
| `api/architect-plan.ts` | `POST /api/architect-plan` — Architect |
| `api/envoy-draft.ts` | `POST /api/envoy-draft` — Envoy |
| `api/chronicle-draft.ts` | `POST /api/chronicle-draft` — Chronicle |
| `api/pulse-health.ts` | `GET /api/pulse-health?engagementId=` — Pulse; no model call |
| `api/engagement-transition.ts` | `POST /api/engagement-transition` — calls `transition_engagement()`; no model call |
| `api/scout-approve.ts` | `POST /api/scout-approve` — the Scout-approve command, calls `approve_scout_intake()` (0008); no model call |
| `api/_env.ts` | **Leading underscore = shared helper, not a route.** Vercel skips these. |
| `api/_http.ts` | Same — shared request-parsing utilities |
| `api/_auth.ts` | Same — `authenticate()`, the caller's bearer token → user-scoped Supabase client |
| `api/_request.ts` | Same — `handler()`: request id (`x-vercel-id`, else UUID) into the log context, uncaught throw → logged 500 `internal_error`, `x-request-id` on every response |
| `api/_budget.ts` | Same — `checkModelBudget()`: the caller's hourly model-call budget (`check_model_budget()`, 0007) before a paid call |

## Function signature

Vercel Functions for non-Next projects export named HTTP method handlers. Here every
one is wrapped by `handler()` from `_request.ts`, which names the route for the logs:

```typescript
import { handler } from './_request';

export const GET = handler('health', async (request: Request) => {
  return Response.json({ ok: true });
});

export const POST = handler('envoy-draft', async (request: Request) => {
  const auth = await authenticate(request);
  if (!auth.ok) return auth.response;
  // ...
});
```

- Use the Web API `Request` and `Response` — not `req`/`res` from Node.
- Never export a bare `async function POST`: outside `handler()` a thrown error is
  Vercel's generic 500 with no log line and no request id, and the log lines the
  handler did write carry no `requestId` to join them by.
- Export `maxDuration` to set the function timeout (default 10s, max depends on plan):
  ```typescript
  export const maxDuration = 30;
  ```

## The failure ladder

Every agent endpoint follows the same shape. Rung 0 runs first in every route except
`health`; rungs 1 and 3 are shared helpers; the others are per-endpoint:

| Rung | Check | Response | Shared? |
|------|-------|----------|---------|
| 0. No / bad caller | `authenticate()` | `401 { error: 'unauthorized' }`; `503 auth_not_configured` (no Supabase URL/anon key) or `503 auth_unavailable` (Auth down) | Yes (`_auth.ts`) |
| 1. Bad JSON | `parseJsonBody()` | `400 { error: 'invalid_json' }` | Yes (`_http.ts`) |
| 2. Invalid input | Zod schema from `src/schemas/` | `400 { error: 'invalid_input' }` | No — a schema per route |
| 3. Budget spent | `checkModelBudget()`, only with a model key configured | `429 { error: 'model_budget_exceeded' }` + `Retry-After` | Yes (`_budget.ts`) |
| 4. Model failure | `callModel()` throws `GatewayError` | caught: the deterministic fallback is saved and answered, with the run id the gateway recorded | No — the fallback differs per agent |

There is no "no model key" rung: every agent route has a deterministic fallback
(design-system.md §2), so a missing key is a fallback everywhere, never a 503 — Scout
files the heuristic's result as `L3` with a flag, the draft routes save their template.
`pulse-health` is a GET with no model call and no body.

### Why rungs 3-4 are NOT shared

A `withModelHandler(schema, prompt, postProcess)` wrapper would hide the single thing a
reviewer most needs to see: which fields the model supplied and which were stamped
server-side. The omit-then-restamp split stops a model granting itself a HITL tier.
The ~12 duplicated lines are worth the auditability.

## The `{ ok, response }` helpers

```typescript
import { parseJsonBody } from './_http';

export const POST = handler('my-route', async (request: Request) => {
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const valid = myRequestSchema.safeParse(parsed.body);
  // ... lookups, budget, model, RPC
});
```

Returns `{ ok: true, body: unknown }` or `{ ok: false, response: Response }`. The
failure arm carries a `Response` so a caller cannot accidentally answer a failure with
a 2xx. `authenticate()` (`{ ok: true, userId, client }`) and `checkModelBudget()`
(`{ ok: true, remaining }`) follow the same pattern.

## Environment

- `api/_env.ts` is the single place `/api` reads server-side env.
- `requireModelKey()` returns the key or `null` — never throws.
- `modelKeyConfigured()` returns a boolean: the health endpoint reports it, and the
  routes skip the budget check when it is false (no paid call is about to happen).
- `MODEL_CALLS_PER_HOUR` (read in `_budget.ts`) and `GATEWAY_PRICING` (read in
  `src/model/pricing.ts`) are the two other server-only tunables; see `api/README.md`.
- `supabasePublicConfig()` returns `{ url, anonKey }` or `null` — `SUPABASE_URL` /
  `SUPABASE_ANON_KEY`, falling back to the public `VITE_` names. `_auth.ts` builds the
  user-scoped client from it. The service-role key is not read here; it lives only in
  `src/observability/recorder.ts`.
- A missing key is **supported state**: local dev has no key, fallbacks cover it.

## Security rules

- **No secrets in the client bundle.** `vite.config.ts` must never `define:` an API key.
  Model keys live in Vercel Function env only.
- **Server-derived fields are stamped after the model call**, never included in the model
  schema. `hitlTier`, `composite_signal`, `engagementId` — the endpoint controls these.
- **No CORS configuration in this repo yet** — Vercel handles it for same-origin.
  If adding cross-origin support, use Vercel's `vercel.json` headers, not per-function.

## Deployment

- `vercel.json` is absent — using defaults (auto-detect Vite, `/api` functions).
- Build: `vite build` → `dist/` for the SPA.
- Functions: each `api/*.ts` file (no underscore) is deployed as a serverless function.
- Environment: set `GOOGLE_GENERATIVE_AI_API_KEY` and Supabase keys in Vercel dashboard;
  `GET /api/health` answers 503 until Supabase is reachable from the function.

## Path alias

`@` resolves to `src/` in `tsconfig.json`, `vite.config.ts`, `vitest.config.ts` and
`vitest.integration.config.ts`:

```typescript
alias: { '@': path.resolve(__dirname, './src') }
```

So `import { callModel } from '../src/model/gateway'` from `api/` is correct — the `@`
alias is available but relative paths are the convention in `api/` files.

## Testing a route

Two files per route, both in `api/__tests__/`:

- `<route>.test.ts` — unit, hermetic. Mock `@supabase/supabase-js` and the agent's
  `model.ts`; assert the status, the body, the RPC arguments and the log lines
  (`addLogSink()` or the parsed `console.error` JSON). Runs in `npm test`.
- `<route>.int.test.ts` — integration, against the running local stack. Build real
  sessions with `_stack.ts` (`anonymousSession`, `staffSession`), call the exported
  handler with a `Request`, read back with the service client what it filed, register
  rows with `Cleanup`. Mock only the model. Runs in `make api-test` and the `api-test`
  CI job; excluded from `npm test` by `vitest.config.ts`.

A route that writes must have an integration test proving the write went through the
RPC as the caller (RLS, tier, provenance) — a unit test can only show the RPC was
called with the right arguments. api/README.md › Testing describes the four layers.
