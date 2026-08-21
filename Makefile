# `lint` and `test` are the two targets Makefile.common's `ship` chain requires.
# Everything else here is the local gate + the Supabase stack.

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

# Override Makefile.common's ship: use lint-check (no autofix) and add the
# typecheck/build gates this repo's CLAUDE.md requires before a commit batch.
ship: lint-check type-check test build check-review pull push quick-pr  ## strict gates -> review check -> pull -> push -> PR

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
