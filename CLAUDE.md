# nonprofit-success-ai

Refs: typescript.md, agent-architecture.md, agent-safety.md, agent-runtime.md, agent-eval.md

Repo-local refs (`.claude/refs/`): vercel-ai-sdk.md, vercel-functions.md, react-vite.md

Read global refs from `~/.claude/refs/` and repo-local refs from `.claude/refs/` before
writing code here.

## What this repo is

The **NYC-DSSG partner portal** — a single-repo TypeScript SPA, being extended with five
agents. It is not a service that talks to a separate portal; the portal *is* this repo.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the direction decision, the agent
roster, the container/data models, and the open items (U4, U5, U7).

`project-mgmt-ai` was the prototype where this setup — the agent roster, the Supabase
schema, the eval harness, the workflow skills — was worked out ahead of landing it here.
Treat it as reference, not as an upstream: this repo is the one that ships. Anything
still pointing at `project-mgmt-ai` is legacy and should be corrected.

### Not present yet

The setup below is being landed one piece at a time. Do not assume a section describes
something that exists — check the tree first. Currently **absent**:

- `api/` — Vercel Functions. No functions yet; the SPA calls Firebase directly.
- `src/agents/`, `src/model/`, `src/guardrails/`, `src/observability/`, `src/schemas/` —
  the agent layers. Today `src/` is `app/`, `components/` (nested, not yet flat), `lib/`,
  and `types.ts`.
- `src/evals/` and `targets.yaml` — the eval harness. No `eval:*` npm scripts, no eval
  job in CI or CD.
- Supabase *client* wiring. `supabase/` (config, migrations, pgTAP suite) is present and
  the `db-*` Makefile targets work, but nothing in `src/` reads from it yet.

`src/` is refactored by issue, not wholesale. The layout rules below are the target the
refactors move toward.

## Stack

| Concern | Choice |
|---|---|
| UI | React 19 + Vite 6 + TypeScript + Tailwind 4 (SPA — **not** Next.js) |
| Server | Vercel Functions under `/api` *(target — none written yet)* |
| Agents | Vercel AI SDK (`ai` + `@ai-sdk/google`) *(target — `@google/genai` is what's wired today)* |
| Data / auth | Supabase — Postgres, Auth, RLS, Realtime *(migrations landed; client not wired)* |
| Tests | Vitest (`src/**/*.test.ts`, node environment) — configured, no suites yet |
| Evals | `src/evals/` — heuristic + LLM-judge graders, gated by `targets.yaml` *(not ported)* |

Firebase/Firestore is being fully replaced by Supabase, but that migration has not started
here — `src/lib/firebase.ts` is still the live data path, and every screen reads and writes
Firestore. Do not add **new** Firebase surface area; do not rip out the existing one
outside a migration issue, because nothing reads from Supabase yet.

The Firestore schema is already ported: `supabase/reference/firestore.rules` (207 lines)
became `supabase/migrations/0001_init.sql`, which cites the rule line it implements on each
column (`-- rules:NN`). `firebase-blueprint.json`'s three entities — Business, Engagement,
User — are all present as tables, alongside eleven more the blueprint never had. Both
Firebase files live in `supabase/reference/` as the source documents for that port (the
CLI does not read that directory) and are deleted when the migration lands, not before.
`firestore.rules` is still the **live** access control, not history — it is what governs
production until `src/` reads from Supabase.

### Auth domains must be registered with Firebase

`Login.tsx` uses `signInWithPopup` with a Google provider, and Firebase rejects that popup
from any origin not on its authorized-domains list (`auth/unauthorized-domain`). Email and
password sign-in is unaffected, so a missing domain reads as "Google sign-in is broken"
rather than "the site is misconfigured" — which is why it is worth stating here.

Authorized as of 2026-08-21 (Firebase console → Authentication → Settings → Authorized
domains — there is no CLI for this list):

- `localhost` — local dev, authorized by default
- `nonprofit-success-ai-chi.vercel.app` — production
- `nonprofit-success-ai-ramseywises-projects.vercel.app`
- `nonprofit-success-ai-git-main-ramseywises-projects.vercel.app`

**Any new deployment URL — a custom domain, a renamed project — needs adding here too.**
PR preview deploys are deliberately *not* covered: their URLs change every push, and the
only way to cover them is the `vercel.app` wildcard, which would authorize every site on
Vercel against this Firebase project. Google sign-in therefore fails on previews by
design; use email/password to test there, or add that one preview URL by hand.

## Conventions

- **No secrets reach the client.** Model keys live in server-only env (a Vercel Function),
  never in client code. `vite.config.ts` must never `define:` an API key into the bundle —
  it did until 2026-08-21, inlining `GEMINI_API_KEY`; that block is gone and must not come
  back. The `VITE_` prefix is the boundary: only prefixed vars reach the browser, so a
  secret is safe precisely as long as nobody prefixes it. Adding `VITE_` to a model key or
  a Supabase service-role key publishes it. Client-side config is declared in
  `src/vite-env.d.ts`; everything in that interface is public by definition.
- **Every agent path needs a deterministic fallback.** A pure local heuristic the client
  falls back to when the model call fails. `src/lib/scoutRouting.ts` is the existing
  instance; it has no test yet, and gains one when it moves under `src/agents/scout/`.
  The full four-rule contract is in `docs/ARCHITECTURE.md` §2.
- **Every agent needs at least one eval metric.** Registered in `src/evals/registry.ts`
  with a fixture file and a `targetsKey`, so that `registry.test.ts` fails the build when
  an agent in the roster has no metric. Heuristic graders where correctness is mechanical;
  LLM judges where the output is prose. Thresholds in `targets.yaml` are set from a
  measured pass rate — a metric with no measurement stays commented out and reports
  `UNGATED`. *(The harness is not ported yet; this binds once it lands.)*
- **HITL tiering is a contract, not a suggestion.** `L2` = high confidence + ready signal,
  agent acts (reversible). `L3` = everything else, agent drafts and a human approves.
  The tier must be derived **server-side**, so a model cannot grant itself `L2`. That
  server derivation does not exist here yet — it arrives with `api/`.
- Path alias `@` resolves to the repo root, in both `vite.config.ts` and `vitest.config.ts`.
- Import ordering, naming, and type-strictness follow `~/.claude/refs/typescript.md`.

## Gates

- Never commit, never push. Stage changes on the branch; Ramsey reviews and commits.
- Always on a branch (`NPS-{NUM}-{slug}`), never `main`. Commits carry `(#{num})`.
- No code changes without a GitHub issue.
- Before any commit batch: `npm run type-check && npm run lint && npm run test && npm run build`.
- `.env*` is unreadable to Claude by policy. Verifying `.env.example` holds placeholders
  only is Ramsey's visual check, not an agent step.

## Local layout

**This section is the target layout, not the current one.** `src/` today is `app/`,
`components/` (with `architect/`, `auth/`, `business/`, `dashboard/`, `scout/`
subdirectories), `lib/`, and a root `types.ts` — plus `App.tsx`/`main.tsx`/`index.css`
still at `src/` root rather than under `app/`. Each gap below closes in its own issue.
Follow these rules for new code; do not migrate existing code outside a refactor issue.

Concept layers are **flat under `src/`**, following the canonical vocabulary in
`~/.claude/refs/naming.md` §1. There is no `platform/` wrapper. The dependency direction
between the SPA layers and the agent layers is the rule that matters:

```
app/, components/  ──┐
                     ├──> agents/ ──> {model,guardrails,observability,schemas}
api/               ──┘
```

Nothing in the agent layers imports from `app/` or `components/`. That is what lets `api/`
— server functions that never load React — import agent logic without dragging the SPA in.

- `src/app/` — the SPA entrypoint: `App.tsx`, `main.tsx`, `index.css`.
- `src/components/` — a **flat** components directory, one file per screen or card. No
  feature subdirectories: the component names already carry the prefix (`ScoutReviewQueue`,
  `ArchitectPlan`), so a `scout/` directory would only repeat it.
- The agent layers below are everything both the SPA and `/api` depend on. They are
  many-to-one: one HITL policy, one model gateway, one recorder, shared by all five agents.
  Baking them into each agent would fork the contract five ways — and `deriveHitlTier()` is
  a single switch over the whole roster precisely so a model cannot grant itself a tier by
  living in its own file.
  - `src/agents/` — one directory per agent (`scout/`, `architect/`, `pulse/`, `envoy/`,
    `chronicle/`), holding the pure logic. An agent lives here whether or not its path
    calls a model. No barrel `index.ts` — import the module you need
    (`agents/pulse/health`), so adding an export can't silently drift from a re-export list.
    Tests colocate in `agents/{agent}/__tests__/`.
  - `src/model/` — the gateway. The single place an agent calls a model, so telemetry and
    error classification are not per-agent decisions.
  - `src/guardrails/hitl.ts` — L1–L4 tiering, derived server-side.
  - `src/observability/recorder.ts` — writes `agent_runs`. Service role, server-only.
  - `src/schemas/` — versioned wire contracts crossing `/api`.
  - `src/evals/` — the grading harness. Imports agents; nothing imports it.
- `src/types/` — wire-contract types, re-exported from `src/types/index.ts`. Distinct from
  `src/evals/types.ts`, which holds Zod schemas that validate JSONL fixtures at
  runtime and never cross the wire — by the "who imports it" test below, they are not the
  same concern and should not be merged.
- `src/lib/` — cross-cutting infrastructure (Supabase client, API client), not agent logic.
  Currently also holds agent logic that has not moved yet (`scoutRouting.ts`,
  `architectPlan.ts`, `architectScoring.ts`) plus `firebase.ts` and `demoStore.ts`.
- `api/` — Vercel Functions (agent endpoints). Root-level by necessity, not preference: for
  a non-Next Vercel project, functions are discovered at `/api` by filesystem convention.
  Leading-underscore files (`_env.ts`, `_http.ts`) are shared helpers, not routes.

### Tests colocate

Vitest picks up `src/**/*.test.ts`; there is no root `tests/` directory. Every test lives
in a `__tests__/` directory beside the source it covers — `src/agents/{agent}/__tests__/`
for agent suites, `src/evals/__tests__/` and `src/evals/pipelines/__tests__/` for the eval
harness. A test file sitting directly beside its source is the drift this rule prevents.
A new `__tests__/` directory needs no config change to be run.

There are no suites yet, so `test` carries `--passWithNoTests` — without it vitest exits 1
on an empty run and reds the CI gate. **Drop that flag with the first suite**, so that a
later test-glob mistake fails loudly instead of reporting green. The first test to land is
the routing fallback's, with the `src/agents/scout/` move.

Local gate: `make gate` = `type-check lint test build`. CI runs the same four jobs on
every PR; `cd.yml` deploys on push to `main`. The eval gates (`eval-heuristics` on PR,
the full judge harness before deploy) are commented into both workflows and land with
the harness.

### Where a type goes

The test is **who imports it**, not what it describes:

- **Crosses the `/api` wire → `src/types/`.** If both a handler in `api/` and a caller in
  `src/` must agree on the shape, it is a shared contract. `ScoutRoutingInput`,
  `ScoutResult`, `PulseInput`, `EnvoyInput`, and `ChronicleInput` are all this.
- **Read only by one agent's internals → stays with the agent.** `MaturityResult` and
  `CsaScoredAnswers` (`architect/scoring.ts`) have no importer in `api/` or `src/lib/`;
  moving them would widen a private vocabulary into a public one for no reason.

Import shared types from the barrel (`../types`), not the module (`../types/scout`). Today
that resolves to the single-file `src/types.ts`; when it becomes a `src/types/` directory
the import sites do not change, which is the point of importing the barrel.

Agent directories have no `index.ts`; the barrel exists only for `src/types/`.

- `docs/` — shared, tracked documentation: architecture, CRM specs, platform/agent specs,
  UX specs, and the product/technical requirements HTML.
- `.claude/docs/` — plans, research, archive. **Git-ignored globally**, so nothing here is
  visible to collaborators; anything that must be shared belongs under `docs/` instead.
