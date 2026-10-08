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
| `api/_env.ts` | **Leading underscore = shared helper, not a route.** Vercel skips these. |
| `api/_http.ts` | Same — shared request-parsing utilities |
| `api/_auth.ts` | Same — `authenticate()`, the caller's bearer token → user-scoped Supabase client |

## Function signature

Vercel Functions for non-Next projects export named HTTP method handlers:

```typescript
// GET endpoint
export function GET(request: Request) {
  return Response.json({ ok: true });
}

// POST endpoint
export async function POST(request: Request) {
  const body = await request.json();
  return Response.json({ result: '...' });
}
```

- Use the Web API `Request` and `Response` — not `req`/`res` from Node.
- Export `maxDuration` to set the function timeout (default 10s, max depends on plan):
  ```typescript
  export const maxDuration = 30;
  ```

## The failure ladder

Every agent endpoint follows the same shape. Rung 0 runs first in every route except
`health`; the next two are shared via `api/_http.ts`; the last two are per-endpoint:

| Rung | Check | Response | Shared? |
|------|-------|----------|---------|
| 0. No / bad caller | `authenticate()` | `401 { error: 'unauthorized' }`; `503 auth_not_configured` (no Supabase URL/anon key) or `503 auth_unavailable` (Auth down) | Yes (`_auth.ts`) |
| 1. No model key | `readJsonBody()` | `503 { error: 'model_key_missing' }` | Yes (`_http.ts`) |
| 2. Bad JSON | `readJsonBody()` / `parseJsonBody()` | `400 { error: 'invalid_json' }` | Yes (`_http.ts`) |
| 3. Invalid input | Per-agent field check | `400 { error: 'invalid_input' }` | No — different predicates per agent |
| 4. Model failure | `callModel()` throws | `{ error: <code> }` at the code's status via `GatewayError.toResponse()` | No — post-processing differs |

Rung 1 applies only where the model is the sole path (`route-intake`). Architect, Envoy
and Chronicle use `parseJsonBody()` (rung 2 alone) because without a key they still
answer — they save the deterministic template — so a missing key is a fallback there,
not a 503. `pulse-health` is a GET with no model call and no body.

### Why rungs 3-4 are NOT shared

A `withModelHandler(schema, prompt, postProcess)` wrapper would hide the single thing a
reviewer most needs to see: which fields the model supplied and which were stamped
server-side. The omit-then-restamp split stops a model granting itself a HITL tier.
The ~12 duplicated lines are worth the auditability.

## The `readJsonBody()` helper

```typescript
import { readJsonBody } from './_http';

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const input = parsed.body as MyInputType;
  // ... validate, call model, return
}
```

Returns `{ ok: true, body: unknown }` or `{ ok: false, response: Response }`. The
failure arm carries a `Response` so a caller cannot accidentally answer a failure with
a 2xx. `parseJsonBody()` has the same return shape without the model-key check, and
`authenticate()` the same pattern (`{ ok: true, userId, client }` or a `response`).

## Environment

- `api/_env.ts` is the single place `/api` reads server-side env.
- `requireModelKey()` returns the key or `null` — never throws.
- `modelKeyConfigured()` returns a boolean for the health endpoint.
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
- Environment: set `GOOGLE_GENERATIVE_AI_API_KEY` and Supabase keys in Vercel dashboard.

## Path alias

`@` resolves to `src/` in `tsconfig.json`, `vite.config.ts` and `vitest.config.ts`:

```typescript
alias: { '@': path.resolve(__dirname, './src') }
```

So `import { callModel } from '../src/model/gateway'` from `api/` is correct — the `@`
alias is available but relative paths are the convention in `api/` files.
