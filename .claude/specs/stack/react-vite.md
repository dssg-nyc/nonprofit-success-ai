# React + Vite + Tailwind — conventions for this repo

React 19, Vite 6, Tailwind 4 (via `@tailwindcss/vite`), TypeScript strict mode.
This is a **SPA, not Next.js** — the fork stays diffable against upstream.

## Project shape

```
src/
  app/           App.tsx, main.tsx, index.css (SPA entrypoint)
  components/    one subdir per feature (auth/, dashboard/, business/, scout/, architect/)
  agents/        one dir per agent, pure logic (no React)
  model/         gateway, errors, types
  guardrails/    HITL tiering
  observability/ telemetry recorder
  schemas/       versioned wire contracts
  evals/         grading harness
  types/         shared types (barrel index.ts)
  lib/           cross-cutting infra (supabase.ts, api.ts, session.ts, demoStore.ts,
                 lessons.ts, lifecycle.ts, database.types.ts)
```

## Component conventions

- **One `components/{feature}/` subdirectory per feature**, one file per screen or card:
  `scout/ScoutIntakeForm.tsx`, `architect/ArchitectPlan.tsx`. A new agent's screens get a
  new subdir (`pulse/`, `envoy/`, `chronicle/`). Cross-feature pieces (`ErrorBanner.tsx`,
  `supabaseErrors.ts`) sit at the `components/` root.
- **No barrel `index.ts` in agent dirs.** Import the module you need:
  `import { routeScoutIntake } from '../agents/scout/routing'`.
- **Types barrel exists** at `src/types/index.ts` — import shared types from `../types`,
  not `../types/scout`.

## React 19 patterns

- Function components only — no class components.
- `use()` hook for promise unwrapping where applicable.
- No error boundaries yet — none at route level or elsewhere *(not built)*.
- `react-router-dom` v7 for routing.

## Tailwind 4

- Uses `@tailwindcss/vite` plugin (not PostCSS).
- Import in `src/app/index.css` with `@import "tailwindcss"`.
- Tailwind 4 uses CSS-first configuration — `@theme` in CSS, not `tailwind.config.js`.
- Utility-first; extract components only when genuinely reused 3+ times.

## State management

- No Redux, Zustand, or Jotai — React state + Supabase Realtime.
- Supabase client in `src/lib/supabase.ts` — one instance, session-authed; it also
  exports `onAuthChange()`, `fetchRole()`, `signOut()` and `liveQuery()`. There is no
  org-membership cache *(not built)*.

## API calls from the SPA

The SPA calls `/api/*` through `postJson` / `getJson` and `withFallback` in
`src/lib/api.ts`. Every route except `health` requires a Supabase bearer token, which
`accessToken()` in `src/lib/session.ts` supplies (`anonymous: true` signs a visitor in
anonymously, for the public intake form). Pattern (`scout/ScoutIntakeForm.tsx`):

```typescript
const token = await accessToken(supabase.auth, { anonymous: true });
const routed = await withFallback(
  () =>
    token
      ? postJson('/api/route-intake', input, scoutResultSchema, {
          headers: { Authorization: `Bearer ${token}` },
        })
      : Promise.reject(new ApiError('unauthorized', null)),
  () => routeScoutIntake(input),
);
// routed.source is 'api' or 'fallback'; on fallback, routed.error.code says why.
```

- Non-2xx means "fall back to the deterministic path" — the error body is read for its
  `error` code only, never as a result. A 2xx that fails the zod schema is treated the same.
- No token means no call: the heuristic fallback runs client-side with no network call.

## Dependency direction

```
app/, components/  ──┐
                     ├──> agents/ ──> {model, guardrails, observability, schemas}
api/               ──┘
```

Nothing in the agent layers imports from `app/` or `components/`. This lets `api/`
import agent logic without dragging in React.

## Build and dev

| Command | What |
|---------|------|
| `npm run dev` | Vite dev server on `:3000` |
| `npm run build` | `vite build` → `dist/` |
| `npm run type-check` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test` | Vitest |

Local gate: `npm run type-check && npm run lint && npm run test && npm run build`.

## Testing

- **Vitest** with node environment (not jsdom — agent logic is server-side).
- Tests colocate in `__tests__/` dirs beside source: `src/agents/scout/__tests__/`.
- No root `tests/` directory.
- Component tests would use jsdom but none exist yet — agent logic is the priority.

## Don'ts

- No `VITE_` prefix for secrets — those end up in the client bundle.
- No `vite.config.ts` `define:` for API keys.
- No flat feature screens at the `components/` root — they go in `components/{feature}/`.
- No barrel `index.ts` in agent directories.
- No `next/` patterns (getServerSideProps, app router, etc.) — this is Vite, not Next.
