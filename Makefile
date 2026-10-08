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

# --- Evals --------------------------------------------------------------------
# Heuristic graders always run. Judges run only when OPENAI_API_KEY is exported in the
# calling shell, the agents' model paths only when GOOGLE_GENERATIVE_AI_API_KEY is (never
# read from a file here); without its key each prints `skipped`, not 0. Output: src/evals/reports/output/
# (git-ignored): runs/<id>/ per run (never overwritten), copied up as the latest summary.json,
# graded.jsonl, calls.jsonl; report.html. Keyed runs also append to the tracked
# src/evals/experiments/log.jsonl. A run is labelled with the prompt versions it measured
# (scout 0.03, architect 0.02, …); EVAL_LABEL="what changed" make eval overrides that.
#
# `eval` and `eval-gate` depend on `gate`: a keyed run spends real model calls, and a
# run over code that does not type-check, lint, test or build measures nothing worth
# keeping. `eval` renders the report in the same step so report.html is never stale.

eval: gate  ## Gate, then grade every metric (judges + model path when a key is exported), render the report and the review CSVs
	npm run eval:grade
	npm run eval:report
	npm run eval:review

eval-gate: gate  ## Gate, then grade and exit non-zero on any targets.yaml miss (what CI will run)
	npm run eval:grade -- --gate
	npm run eval:report

eval-report: ## Render reports/output/report.html from the last grade run
	npm run eval:report

# The review notebook is git-ignored and built from build_review.py; it needs pandas,
# matplotlib and jinja2, which this repo does not install. `eval-notebook` lets uv supply
# them per launch; `eval-kernel` makes a .venv for VS Code's notebook editor (pick ".venv"
# as the kernel). Either way nothing Python lands in package.json.
NOTEBOOK := src/evals/notebooks/review.ipynb

$(NOTEBOOK): src/evals/notebooks/build_review.py
	python3 $< $@

eval-notebook: $(NOTEBOOK) ## Build (if stale) and open the review notebook in JupyterLab
	uv run --with-requirements src/evals/notebooks/requirements.txt --with jupyterlab jupyter lab $(NOTEBOOK)

eval-kernel: $(NOTEBOOK) ## Create .venv with the notebook's deps, for VS Code (select the .venv kernel)
	uv venv --allow-existing .venv
	uv pip install --python .venv -r src/evals/notebooks/requirements.txt

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

# Every target honours SUPABASE_WORKDIR, for running against a copy of supabase/ (e.g.
# with shifted ports when another project's stack already holds 54321/54322):
#   make db-reset SUPABASE_WORKDIR=/path/containing/supabase
SUPABASE := npx supabase$(if $(SUPABASE_WORKDIR), --workdir $(SUPABASE_WORKDIR))
DB_TESTS := $(or $(SUPABASE_WORKDIR),.)/supabase/tests

# Migrations are supabase/migrations/NNNN_<name>.sql, applied in numeric order.
# supabase/migrations/reference/ is not in the apply path.

db-start:  ## Start the local Supabase stack (requires Docker running)
	@docker info >/dev/null 2>&1 || { \
		echo "Docker daemon is not running. Start Docker Desktop first:"; \
		echo "  open -a Docker"; \
		exit 1; \
	}
	$(SUPABASE) start

db-stop:  ## Stop the local Supabase stack
	$(SUPABASE) stop

db-reset:  ## Drop and re-apply all migrations from scratch
	$(SUPABASE) db reset

# Guarded twice: a missing suite and a suite that ran zero assertions both fail. Without
# the guard, `supabase test db` against an empty tests/ dir reports success -- the same
# silent-green failure that dropping vitest's --passWithNoTests prevents.
db-test:  ## Run the pgTAP RLS suite (supabase/tests/*.test.sql); fails on zero tests
	@ls $(DB_TESTS)/*.test.sql >/dev/null 2>&1 || { \
		echo "db-test: no $(DB_TESTS)/*.test.sql files -- refusing to report green"; \
		exit 1; \
	}
	@out=$$(mktemp); \
	$(SUPABASE) test db >$$out 2>&1; status=$$?; cat $$out; \
	if [ $$status -ne 0 ]; then rm -f $$out; exit $$status; fi; \
	if ! grep -Eq 'Tests=[1-9][0-9]*' $$out; then \
		echo "db-test: zero assertions ran -- refusing to report green"; rm -f $$out; exit 1; \
	fi; \
	rm -f $$out

db-types:  ## Regenerate src/lib/database.types.ts from the local stack's schema
	@tmp=$$(mktemp); \
	$(SUPABASE) gen types typescript --local --schema public > $$tmp && \
	mv $$tmp src/lib/database.types.ts || { rm -f $$tmp; exit 1; }; \
	npx --yes oxfmt src/lib/database.types.ts >/dev/null 2>&1 || true

db-status:  ## Show local stack status and connection details
	$(SUPABASE) status

# Q5 production metrics (observability.md): the agent_run_metrics view (0016) read straight
# from the local stack with psql as the local superuser, so RLS is bypassed -- local only.
metrics:  ## Q5 metrics from the local stack: agent_run_metrics, newest day first (local superuser, RLS bypassed)
	@command -v psql >/dev/null 2>&1 || { \
		echo "psql not found. Install the client first:"; \
		echo "  brew install libpq && brew link --force libpq"; \
		exit 1; \
	}
	@url=$$($(SUPABASE) status -o env 2>/dev/null | sed -n 's/^DB_URL="\{0,1\}\([^"]*\)"\{0,1\}$$/\1/p'); \
	[ -n "$$url" ] || { echo "metrics: local stack not running (make db-start)"; exit 1; }; \
	psql "$$url" -P pager=off -c "select agent, day, runs, errors, fallbacks, round(error_rate, 3) as error_rate, round(fallback_rate, 3) as fallback_rate, p50_ms, p95_ms, input_tokens, output_tokens, cost_cents, runs_costed, approved, rejected, round(override_rate, 3) as override_rate from agent_run_metrics order by day desc, agent limit 60"
