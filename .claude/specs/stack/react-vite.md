# React + Vite + Tailwind — conventions for this repo

React 19, Vite 6, Tailwind 4 (via `@tailwindcss/vite`), TypeScript strict mode.
This is a **SPA, not Next.js** — the fork stays diffable against upstream.

## Project shape

```
src/
  app/           App.tsx, main.tsx, index.css (SPA entrypoint)
  components/    flat — one file per screen or card, no feature subdirectories
  agents/        one dir per agent, pure logic (no React)
  model/         gateway, errors, types
  guardrails/    HITL tiering
  observability/ telemetry recorder
  schemas/       versioned wire contracts
  evals/         grading harness
  types/         shared types (barrel index.ts)
  lib/           cross-cutting infra (Supabase client, API client)
```

## Component conventions

- **Flat `components/` directory.** Component names carry the prefix (`ScoutIntakeForm`,
  `ArchitectPlan`, `PulseHealthCard`), so a `scout/` subdirectory would repeat it.
- **No barrel `index.ts` in agent dirs.** Import the module you need:
  `import { routeScoutIntake } from '../agents/scout/routing'`.
- **Types barrel exists** at `src/types/index.ts` — import shared types from `../types`,
  not `../types/scout`.

## React 19 patterns

- Function components only — no class components.
- `use()` hook for promise unwrapping where applicable.
- Error boundaries at route level.
- `react-router-dom` v7 for routing.

## Tailwind 4

- Uses `@tailwindcss/vite` plugin (not PostCSS).
- Import in `src/app/index.css` with `@import "tailwindcss"`.
- Tailwind 4 uses CSS-first configuration — `@theme` in CSS, not `tailwind.config.js`.
- Utility-first; extract components only when genuinely reused 3+ times.

## State management

- No Redux, Zustand, or Jotai — React state + Supabase Realtime.
- `getCurrentOrgId()` in `src/lib/supabase.ts` caches org membership.
- `clearOrgCache()` on sign-out.
- Supabase client in `src/lib/supabase.ts` — one instance, session-authed.

## API calls from the SPA

The SPA calls `/api/*` endpoints. Pattern:

```typescript
const response = await fetch('/api/route-intake', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(input),
});

if (!response.ok) {
  // Non-2xx = no result body. Fall back to heuristic.
  return routeScoutIntake(input);
}

return response.json();
```

- Non-2xx means "fall back to the deterministic path" — never parse the error body as a result.
- The heuristic fallback runs client-side with no network call.

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
- No feature subdirectories in `components/` — keep it flat.
- No barrel `index.ts` in agent directories.
- No `next/` patterns (getServerSideProps, app router, etc.) — this is Vite, not Next.
