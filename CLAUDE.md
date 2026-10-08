# nonprofit-success-ai

Refs: typescript.md

## What this repo is

The **NYC-DSSG partner portal** — a single-repo TypeScript SPA, being extended with five
agents. The portal *is* this repo, not a service that talks to one. See
[.claude/specs/design-system.md](.claude/specs/design-system.md) for the direction decision, agent roster,
data models, and open items (U4, U5, U7).

**Check the tree before trusting a section here.** The setup lands one piece at a time;
`*(target)*` marks what does not exist yet. `src/` is refactored by issue, not wholesale.

## Stack

| Concern | Choice |
|---|---|
| UI | React 19 + Vite 6 + TypeScript + Tailwind 4 (SPA — **not** Next.js) |
| Server | Vercel Functions under `/api` — 8 routes (`health`, `route-intake`, `architect-plan`, `envoy-draft`, `chronicle-draft`, `pulse-health`, `engagement-transition`, `scout-approve`) + `_env.ts`/`_http.ts`/`_auth.ts`/`_request.ts`/`_budget.ts` helpers; tests in `api/__tests__/`. Every route but `health` requires a Supabase bearer token (`_auth.ts`); the public intake form gets one by anonymous sign-in (`src/lib/session.ts`, 0001_core) and the route files the intake via `submit_scout_intake()` (0007) — the browser never writes `scout_intakes`. Every handler is wrapped by `handler()` (`_request.ts`): request id in every log line + `x-request-id`; model routes check the caller's hourly budget (`_budget.ts`) first. See `api/README.md` |
| Agents | Vercel AI SDK (`ai` + `@ai-sdk/google`), called only through `src/model/gateway.ts` |
| Data / auth | Supabase — Postgres, Auth, RLS, Realtime *(live — `src/lib/supabase.ts`)*. Stage changes go only through `transition_engagement()` (0005_lifecycle; partners hold no write on `engagements`); a business enters the pipeline only through `approve_scout_intake()` (0008, `POST /api/scout-approve`), the one writer of `businesses.scout_intake_id`. Migrations were squashed 2026-10-08 into `0001_core`–`0006_views`; `0007` onward is post-squash |
| Tests | Vitest (`src/**/*.test.ts` + `api/**/*.test.ts`, node) — 47 files in `__tests__/` dirs; integration suite `api/__tests__/*.int.test.ts` (`vitest.integration.config.ts`, `make api-test`, CI `api-test` job) runs the handlers against the local stack with only the model mocked; `cd.yml` polls `/api/health` after every deploy; pgTAP suite in `supabase/tests/` (`core` / `spine` / `rpcs.test.sql` + `_shared/fixtures.psql`, one transaction per file, counts scoped to fixture ids; `make db-test`, runs in CI as the `db-test` job; `make metrics` prints the `agent_run_metrics` view (0006_views), needs `psql` — `brew install libpq`) |
| Evals | `src/evals/` + `targets.yaml` — heuristic + LLM-judge graders. `npm run eval:grade -- --gate` gates `scoutRouting`, `architectScoring`, `architectPlanStructure`, `pulseHealth`, `envoyDraftStructure`, `chronicleReadiness` at 1.0; judges stay `UNGATED` until a keyed run measures them; not yet a CI job |

The Firebase-to-Supabase migration is **complete**: `firebase` is out of `package.json`,
RLS policies are the access-control layer. Do not add Firebase surface area.

`supabase/migrations/reference/` holds the two Firebase source docs (`firestore.rules`,
`firebase-blueprint.json`) the schema was ported from — history, not configuration.
`0001_init.sql` cites `firestore.rules` 98 times by line (`-- rules:NN`), so they stay
until that audit is no longer needed. See `supabase/migrations/reference/README.md`.

## Conventions

- **No secrets reach the client.** The `VITE_` prefix is the boundary — only prefixed vars
  reach the browser, and everything in `src/app/vite-env.d.ts` is public by definition. Adding
  `VITE_` to a model key or a Supabase service-role key publishes it. `vite.config.ts` must
  never `define:` an API key into the bundle (it inlined `GEMINI_API_KEY` until 2026-08-21;
  that block is gone and must not return). Model keys live in server-only env.
- **Every agent path needs a deterministic fallback** — a pure local heuristic used when
  the model call fails. `src/agents/scout/routing.ts` is the reference instance, covered by
  `src/agents/scout/__tests__/routing.test.ts`. Four-rule contract: `.claude/specs/design-system.md` §2.
- **Every agent needs at least one eval metric**, registered in `src/evals/registry.ts`
  with a fixture and a `targetsKey`, so `registry.test.ts` fails the build when a roster
  agent has none. Heuristic graders for mechanical correctness, LLM judges for prose.
  `targets.yaml` thresholds come from a measured pass rate — unmeasured metrics stay
  commented out and report `UNGATED`.
- **HITL tiering is a contract.** `L2` = high confidence + ready signal, agent acts
  (reversible). `L3` = everything else, agent drafts and a human approves. The tier is
  derived **server-side** so a model cannot grant itself `L2` — Scout through
  `deriveHitlTier()`, Architect as fixed `L3` via `submit_architect_draft()` (0004_drafts), which writes
  the draft beside a pending `charter` approval; Envoy and Chronicle the same way through
  `submit_envoy_draft()` / `submit_chronicle_draft()` (0004_drafts), each beside a pending L3 approval.
- Path alias `@` resolves to `src/`, in `tsconfig.json`, `vite.config.ts` and `vitest.config.ts`.
  `tsconfig.json` is `strict`.
- Import ordering, naming, and type-strictness follow `~/.claude/refs/typescript.md`.

## Gates

- Never commit, never push. Stage changes on the branch; the user reviews and commits.
- Always on a branch (`NPS-{NUM}-{slug}`), never `main`. Commits carry `(#{num})`.
- No code changes without a GitHub issue.
- Before any commit batch: `make gate` (`type-check lint test build`). CI runs the same
  four jobs per PR, plus `eval-heuristics` and `db-test` in `ci.yml`; `cd.yml` calls `ci.yml` as a reusable workflow and deploys (preview on
  PRs, `--prod` on push to `main`) only after it passes. Six metrics are gated locally
  (`eval:grade --gate`); the heuristic eval job is live in `ci.yml`, the judge job is J3.
- `.env*` is unreadable to Claude by policy.

## Local layout

**Target layout, reached.** `src/` is `app/`, `components/`, `agents/`, `model/`,
`guardrails/`, `observability/`, `evals/`, `lib/`, `schemas/`, `types/`.
Follow these rules for new code; migrate existing code only in a refactor issue.

Concept layers are **flat under `src/`** — no `platform/` wrapper. Three zones, each with an owner:

| Zone | Layers | Owner |
|---|---|---|
| UI | `app/`, `components/` | Tony |
| Agents | `agents/`, `model/`, `guardrails/`, `observability/`, `evals/` | Ramsey |
| Shared | `lib/`, `schemas/`, `types/` | both — a change here is reviewed by both zones |

`api/` handlers belong to whoever owns the route (agent routes: Ramsey). The dependency
direction is the rule that matters:

```
app/, components/  ──┐
                     ├──> agents/ ──> {model,guardrails,observability}
api/               ──┘        │                    │
                              └──> {lib,schemas,types} <──┘   (UI imports these too)
```

Nothing in the agent layers imports from `app/` or `components/` — that is what lets
`api/` import agent logic without dragging React in. Shared layers import nothing above
them: no React, no agent code. *(All of these are lint-enforced in `eslint.config.mjs`: the agent-side arrows,
UI → `model/`/`observability/`/agent `model.ts`, and `lib/` → agents/UI.)*

- `src/app/` — SPA entrypoint: `App.tsx`, `main.tsx`, `index.css`, `vite-env.d.ts`.
- `src/components/{feature}/` — one subdirectory per feature (`architect/`, `auth/`,
  `business/`, `dashboard/`, `scout/`), one file per screen or card. A new agent's screens
  get a new subdir (`pulse/`, `envoy/`, `chronicle/`). Components reach agents only
  through `/api` (with the agent's fallback on error) or pure agent functions — never
  `model/` or `observability/` directly.
- `src/agents/` — one directory per agent (`scout/`, `architect/`, `pulse/`, `envoy/`,
  `chronicle/`), pure logic, whether or not the path calls a model. No barrel `index.ts` —
  import the module (`agents/pulse/health`) so exports can't drift from a re-export list.
- `src/model/` — the gateway. The single place an agent calls a model, so telemetry and
  error classification are not per-agent decisions.
- `src/guardrails/hitl.ts` — L1–L4 tiering. `deriveHitlTier()` is one switch over the whole
  roster precisely so a model cannot grant itself a tier by living in its own file.
- `src/observability/recorder.ts` — writes `agent_runs`. Service role, server-only.
  `log.ts` — structured JSON server logs from a closed field set; never pass it an error
  object, prompt or row (they carry intake data).
- `src/schemas/` — versioned zod wire contracts crossing `/api`. The source of truth for
  any shape validated at runtime.
- `src/evals/` — the grading harness. Imports agents; nothing imports it.
- `src/types/` — the import surface for shared types, re-exported from `src/types/index.ts`.
  See "Where a type goes".
- `src/lib/` — cross-cutting infrastructure (`supabase.ts`, `demoStore.ts`, `api.ts`, `lessons.ts`), not agent
  logic. `supabase.ts` is the browser (anon, `VITE_`) client. `api.ts` is the SPA's `/api` caller:
  `postJson` (bearer token attached) and `withFallback`, which runs the agent's local
  heuristic when the route fails (Pulse; Scout's fallback now runs inside the route). The only service-role client lives inside
  `src/observability/recorder.ts` and is never exported; `api/` routes act as the caller
  (anon key + the user's JWT, `api/_auth.ts`).
  The former `scoutRouting.ts`, `architectPlan.ts` and `architectScoring.ts` now
  live at `src/agents/scout/routing.ts`, `src/agents/architect/plan.ts` and `scoring.ts`.
- `api/` — Vercel Functions. Root-level by necessity: a non-Next Vercel project discovers
  functions at `/api` by filesystem convention. Leading-underscore files (`_env.ts`,
  `_http.ts`) are shared helpers, not routes.
- `docs/` — tracked, shared documentation: the PRD (pdf + html), the generated system-design
  record (html) and `architect-design.md`, the superseded Architect source spec. Build contracts
  live in `.claude/specs/`, not here.
- `.claude/docs/` — plans, research, archive. **Git-ignored**, so nothing here is visible
  to collaborators; anything that must be shared belongs under `docs/`.

### Tests colocate

Vitest picks up `src/**/*.test.ts`; there is no root `tests/`. Every test lives in a
`__tests__/` directory beside its source — `src/agents/{agent}/__tests__/`,
`src/evals/__tests__/`. A test file sitting directly beside its source is the drift this
prevents. New `__tests__/` directories need no config change.

`test` is plain `vitest run` — no `--passWithNoTests` — so a test-glob mistake fails loudly
instead of reporting green. Keep it that way.

### Where a type goes

The test is **who imports it**, not what it describes:

- **Crosses the `/api` wire → `src/types/`.** If a handler in `api/` and a caller in `src/`
  must agree on the shape, it is a shared contract — `ScoutRoutingInput`, `ScoutResult`,
  `MaturityResult`, `ArchitectPlanRequest`, `PulseInput`, `EnvoyInput`, `ChronicleInput`.
- **Read only by one agent's internals → stays with the agent.** `CsaScoredAnswers`
  (`architect/scoring.ts`) has no importer in `api/` or `src/lib/`.

**One definition per shape.** If a wire shape has a zod schema in `src/schemas/`, its type
is inferred, never hand-written beside it — e.g. `src/types/scout.ts` holding
`export type ScoutResult = z.infer<typeof scoutResultSchema>` (a type-only import, so the
`schemas → types` constant import does not form a runtime cycle). Shapes with no runtime
validation (UI-only view models, `ScoutIntake`) stay hand-written interfaces; DB row types
come from `supabase gen types`. Migrate per agent as its wire schema lands, not wholesale
(Scout, Architect, Envoy and Chronicle done).

By the same test, `src/evals/types.ts` — Zod schemas validating JSONL fixtures at runtime,
never crossing the wire — is a different concern from `src/types/` and does not merge into it.

Import shared types from the barrel (`../types`), not the module (`../types/scout`). It
resolves to `src/types/index.ts`.
Agent directories have no barrel; only `src/types/` does.

## Refs

Global (`~/.claude/refs/`): typescript.md

Repo-local (`.claude/specs/`):

| Path | What it covers |
|------|----------------|
| `roadmap.md` | **The delta registry** — owns every `D{n}`/`C{n}`. Specs and the design record cite it; neither mints |
| `design-system.md` | Scope, direction decision, container model, execution semantics (§8) — the root doc |
| `stack/environments.md` | Deployment config (local / staging / prod) |
| `stack/` | How to write code: `react-vite.md`, `vercel-ai-sdk.md`, `vercel-functions.md` |
| `crm/` | Data model (incl. provenance §7), security + trust boundaries, access model, `lifecycle.md` (the state machine), Supabase conventions |
| `platform/agents/` | One spec per agent: `scout.md`, `architect.md`, `pulse.md`, `envoy.md`, `chronicle.md` |
| `platform/services/` | `contract-consent.md` |
| `platform/infra/` | `eval-harness.md`, `model-gateway.md`, `observability.md` |
| `platform/knowledge.md` | Knowledge base design (PROPOSED — D30–D41, nothing built) |

The initiative doc and PRD are frozen; the shared copies are the HTML in `docs/`, and the
markdown sources sit in `.claude/docs/archive/specs/` (git-ignored). Specs cite the PRD by
section (`PRD §8`), never by line. `src/app/index.css` is the styling source of truth; the
old `design-interface.md` had drifted and was retired 2026-10-08.

Read stack refs + the relevant component spec before writing code here.
