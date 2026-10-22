# Vercel Functions — conventions for this repo

This is a **Vite SPA** deployed to Vercel, not Next.js. Functions are discovered at
`/api` by filesystem convention — each `.ts` file in `api/` becomes a serverless function.

## File conventions

| Pattern | Meaning |
|---------|---------|
| `api/route-intake.ts` | Routable function → `POST /api/route-intake` |
| `api/health.ts` | Routable function → `GET /api/health` |
| `api/_env.ts` | **Leading underscore = shared helper, not a route.** Vercel skips these. |
| `api/_http.ts` | Same — shared request-parsing utilities |

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

## The four-rung failure ladder

Every agent endpoint follows the same shape. The first two rungs are shared via
`api/_http.ts`; the next two are per-endpoint:

| Rung | Check | Response | Shared? |
|------|-------|----------|---------|
| 1. No model key | `readJsonBody()` | `503 { error: 'model_key_missing' }` | Yes (`_http.ts`) |
| 2. Bad JSON | `readJsonBody()` | `400 { error: 'invalid_json' }` | Yes (`_http.ts`) |
| 3. Invalid input | Per-agent field check | `400 { error: 'invalid_input' }` | No — different predicates per agent |
| 4. Model failure | `callModel()` throws | `502 { error: <code> }` via `GatewayError.toResponse()` | No — post-processing differs |

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
a 2xx.

## Environment

- `api/_env.ts` is the single place `/api` reads server-side env.
- `requireModelKey()` returns the key or `null` — never throws.
- `modelKeyConfigured()` returns a boolean for the health endpoint.
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

`@` resolves to the repo root in both `vite.config.ts` and `vitest.config.ts`:

```typescript
alias: { '@': path.resolve(__dirname, '.') }
```

So `import { callModel } from '../src/model/gateway'` from `api/` is correct — the `@`
alias is available but relative paths are the convention in `api/` files.
