# nonprofit-success-ai

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
| Server | Vercel Functions under `/api` *(target — none written yet)* |
| Agents | Vercel AI SDK (`ai` + `@ai-sdk/google`) *(target — `@google/genai` is wired today)* |
| Data / auth | Supabase — Postgres, Auth, RLS, Realtime *(live — `src/lib/supabase.ts`)* |
| Tests | Vitest (`src/**/*.test.ts`, node) — configured, no suites yet |
| Evals | `src/evals/` + `targets.yaml` — heuristic + LLM-judge graders *(target — not ported)* |

The Firebase-to-Supabase migration is **complete**: `firebase` is out of `package.json`,
RLS policies are the access-control layer. Do not add Firebase surface area.

`supabase/reference/` holds the two Firebase source docs (`firestore.rules`,
`firebase-blueprint.json`) the schema was ported from — history, not configuration.
`0001_init.sql` cites `firestore.rules` 98 times by line (`-- rules:NN`), so they stay
until that audit is no longer needed. See `supabase/reference/README.md`.

## Conventions

- **No secrets reach the client.** The `VITE_` prefix is the boundary — only prefixed vars
  reach the browser, and everything in `src/vite-env.d.ts` is public by definition. Adding
  `VITE_` to a model key or a Supabase service-role key publishes it. `vite.config.ts` must
  never `define:` an API key into the bundle (it inlined `GEMINI_API_KEY` until 2026-08-21;
  that block is gone and must not return). Model keys live in server-only env.
- **Every agent path needs a deterministic fallback** — a pure local heuristic used when
  the model call fails. `src/lib/scoutRouting.ts` is the existing instance; it gains a test
  when it moves under `src/agents/scout/`. Four-rule contract: `.claude/specs/design-system.md` §2.
- **Every agent needs at least one eval metric**, registered in `src/evals/registry.ts`
  with a fixture and a `targetsKey`, so `registry.test.ts` fails the build when a roster
  agent has none. Heuristic graders for mechanical correctness, LLM judges for prose.
  `targets.yaml` thresholds come from a measured pass rate — unmeasured metrics stay
  commented out and report `UNGATED`. *(Binds once the harness lands.)*
- **HITL tiering is a contract.** `L2` = high confidence + ready signal, agent acts
  (reversible). `L3` = everything else, agent drafts and a human approves. The tier is
  derived **server-side** so a model cannot grant itself `L2`. *(Arrives with `api/`.)*
- Path alias `@` resolves to the repo root, in both `vite.config.ts` and `vitest.config.ts`.
- Import ordering, naming, and type-strictness follow `~/.claude/refs/typescript.md`.

## Gates

- Never commit, never push. Stage changes on the branch; the user reviews and commits.
- Always on a branch (`NPS-{NUM}-{slug}`), never `main`. Commits carry `(#{num})`.
- No code changes without a GitHub issue.
- Before any commit batch: `make gate` (`type-check lint test build`). CI runs the same
  four jobs per PR; `cd.yml` deploys on push to `main`. The eval gates are commented into
  both workflows and land with the harness.
- `.env*` is unreadable to Claude by policy.

## Local layout

**Target layout, not current.** Today `src/` is `app/`, `components/` (with `architect/`,
`auth/`, `business/`, `dashboard/`, `scout/` subdirs), `lib/`, and a root `types.ts` —
with `App.tsx`/`main.tsx`/`index.css` still at `src/` root. Each gap closes in its own
issue. Follow these rules for new code; migrate existing code only in a refactor issue.

Concept layers are **flat under `src/`** per `~/.claude/refs/naming.md` §1 — no
`platform/` wrapper. The dependency direction is the rule that matters:

```
app/, components/  ──┐
                     ├──> agents/ ──> {model,guardrails,observability,schemas}
api/               ──┘
```

Nothing in the agent layers imports from `app/` or `components/` — that is what lets
`api/` import agent logic without dragging React in.

- `src/app/` — SPA entrypoint: `App.tsx`, `main.tsx`, `index.css`.
- `src/components/` — **flat**, one file per screen or card. Component names already carry
  the prefix (`ScoutReviewQueue`, `ArchitectPlan`), so feature subdirs only repeat it.
- `src/agents/` — one directory per agent (`scout/`, `architect/`, `pulse/`, `envoy/`,
  `chronicle/`), pure logic, whether or not the path calls a model. No barrel `index.ts` —
  import the module (`agents/pulse/health`) so exports can't drift from a re-export list.
- `src/model/` — the gateway. The single place an agent calls a model, so telemetry and
  error classification are not per-agent decisions.
- `src/guardrails/hitl.ts` — L1–L4 tiering. `deriveHitlTier()` is one switch over the whole
  roster precisely so a model cannot grant itself a tier by living in its own file.
- `src/observability/recorder.ts` — writes `agent_runs`. Service role, server-only.
- `src/schemas/` — versioned wire contracts crossing `/api`.
- `src/evals/` — the grading harness. Imports agents; nothing imports it.
- `src/types/` — wire-contract types, re-exported from `src/types/index.ts`.
- `src/lib/` — cross-cutting infrastructure (`supabase.ts`, `demoStore.ts`), not agent
  logic. Also holds agent logic that has not moved yet (`scoutRouting.ts`,
  `architectPlan.ts`, `architectScoring.ts`).
- `api/` — Vercel Functions. Root-level by necessity: a non-Next Vercel project discovers
  functions at `/api` by filesystem convention. Leading-underscore files (`_env.ts`,
  `_http.ts`) are shared helpers, not routes.
- `docs/` — tracked documentation: architecture, CRM specs, platform/agent specs, UX specs.
- `.claude/docs/` — plans, research, archive. **Git-ignored**, so nothing here is visible
  to collaborators; anything that must be shared belongs under `docs/`.

### Tests colocate

Vitest picks up `src/**/*.test.ts`; there is no root `tests/`. Every test lives in a
`__tests__/` directory beside its source — `src/agents/{agent}/__tests__/`,
`src/evals/__tests__/`. A test file sitting directly beside its source is the drift this
prevents. New `__tests__/` directories need no config change.

`test` carries `--passWithNoTests` because there are no suites yet. **Drop that flag with
the first suite**, so a later test-glob mistake fails loudly instead of reporting green.
First test to land: the routing fallback's, with the `src/agents/scout/` move.

### Where a type goes

The test is **who imports it**, not what it describes:

- **Crosses the `/api` wire → `src/types/`.** If a handler in `api/` and a caller in `src/`
  must agree on the shape, it is a shared contract — `ScoutRoutingInput`, `ScoutResult`,
  `PulseInput`, `EnvoyInput`, `ChronicleInput`.
- **Read only by one agent's internals → stays with the agent.** `MaturityResult` and
  `CsaScoredAnswers` (`architect/scoring.ts`) have no importer in `api/` or `src/lib/`.

By the same test, `src/evals/types.ts` — Zod schemas validating JSONL fixtures at runtime,
never crossing the wire — is a different concern from `src/types/` and does not merge into it.

Import shared types from the barrel (`../types`), not the module (`../types/scout`). It
resolves to `src/types.ts` today and to `src/types/` later, without changing import sites.
Agent directories have no barrel; only `src/types/` does.

## Refs

Global (`~/.claude/refs/`): typescript.md, agent-architecture.md, agent-safety.md,
agent-runtime.md, agent-eval.md

Repo-local (`.claude/specs/`):

| Path | What it covers |
|------|----------------|
| `design-system.md` | Scope, direction decision, container model — the root doc |
| `environments.md` | Deployment config (local / staging / prod) |
| `design-scope.md` | Initiative framing — what we're building and why |
| `design-requirements.md` | PRD — deliverables, requirements, acceptance criteria |
| `design-interface.md` | Visual language, typography, palette, component patterns |
| `stack/` | How to write code: `react-vite.md`, `vercel-ai-sdk.md`, `vercel-functions.md` |
| `crm/` | Data model, security, access model, Supabase conventions, integrations |
| `platform/agents/` | One spec per agent: `scout.md`, `architect.md`, `chronicle.md` |
| `platform/services/` | `health-service.md`, `communications-service.md`, `contract-consent.md` |
| `platform/infra/` | `eval-harness.md`, `model-gateway.md`, `observability.md` |
| `platform/knowledge.md` | Knowledge base design (PROPOSED) |

Read stack refs + the relevant component spec before writing code here.
