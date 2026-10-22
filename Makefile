# This Makefile is self-contained -- there is no shared include. `gate` and `ship` are
# the two entry points; everything else is the dev loop + the Supabase stack.

install: hooks  ## Install node dependencies and the git hooks
	npm install

hooks:  ## Install the pre-commit hooks (one-time, per clone)
	@command -v pre-commit >/dev/null 2>&1 || { \
		echo "pre-commit not found. Install it first:"; \
		echo "  brew install pre-commit"; \
		exit 1; \
	}
	pre-commit install

dev:  ## Vite dev server (heuristic fallback only, no /api)
	npm run dev

dev-api:  ## Vercel dev server (serves /api too)
	npx vercel dev

type-check:  ## tsc --noEmit
	npm run type-check

lint:  ## eslint --fix
	npm run lint -- --fix

test:  ## vitest run
	npm run test

build:  ## Production build
	npm run build

gate: type-check lint test build

lint-check:  ## eslint, no autofix (the gate `ship` uses)
	npm run lint

# `ship` is a strict gate only -- it does not pull, push, or open a PR. It was written
# against a `Makefile.common` include that this repo does not have and that exists
# nowhere in the workspace, so `lint-check`, `check-review`, `pull`, `push` and
# `quick-pr` were all undefined and `make ship` died on the first missing prerequisite
# before running a single check. The git steps are deliberately not reinstated here:
# CLAUDE.md's gate is that Claude never pushes, so pushing stays a manual step.
#
# Differs from `gate` only in lint-check vs lint: no --fix, so the diff reviewed is the
# diff committed -- same reasoning as the pre-commit eslint hook.
ship: lint-check type-check test build  ## strict gates (no autofix); push manually after

# --- Supabase local stack -----------------------------------------------------
# There is no Dockerfile in this repo and there should not be: the Supabase CLI
# orchestrates its own container set (Postgres, GoTrue, PostgREST, Realtime,
# Storage, Studio) from supabase/config.toml. Docker only has to be running.
# The CLI is a pinned devDependency so everyone runs the same version.

db-start:  ## Start the local Supabase stack (requires Docker running)
	@docker info >/dev/null 2>&1 || { \
		echo "Docker daemon is not running. Start Docker Desktop first:"; \
		echo "  open -a Docker"; \
		exit 1; \
	}
	npx supabase start

db-stop:  ## Stop the local Supabase stack
	npx supabase stop

db-reset:  ## Drop and re-apply all migrations from scratch
	npx supabase db reset

db-test:  ## Run the pgTAP RLS suite (supabase/tests/)
	npx supabase test db

db-status:  ## Show local stack status and connection details
	npx supabase status
