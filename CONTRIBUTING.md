# Contributing

The DSSG Success Portal is built by a volunteer cohort. This page is the short version of
how work moves from an idea to `main`. Read [README.md](README.md) for what the product is
and [.claude/specs/design-system.md](.claude/specs/design-system.md) for how it is put together.

## Local setup

```bash
git clone https://github.com/dssg-nyc/nonprofit-success-ai.git
cd nonprofit-success-ai
npm ci
cp .env.example .env        # then fill in the Supabase values
npm run dev                 # http://localhost:3000
```

You do not need a Supabase account to look around — the login screen has a **Demo Mode**
entry point that fakes a signed-in admin and serves static mock data, so every screen is
explorable without a database.

For the local Postgres stack, per-environment variables, and how migrations move from
local to staging to production, see [docs/environments.md](docs/environments.md).

## The workflow

1. **Start from an issue.** Every code change needs one — open it with the
   [issue templates](.github/ISSUE_TEMPLATE) (Bug, Feature, Chore, Refactor). The template
   fields are not ceremony: each one seeds a section of the implementation plan, so a
   thorough issue is less work later, not more. Blank issues are disabled on purpose.
2. **Claim it.** Comment on the issue before starting so two people do not build the same
   thing. Ask questions in the issue thread rather than in DMs — the next contributor
   reads the thread, not your inbox.
3. **Branch.** Never commit to `main`.
4. **Build, then run the gate** (below) before you open the PR.
5. **Open a PR** against `main` using the template. Code owners are requested
   automatically.
6. **Address review, then a maintainer merges.** Do not merge your own PR.

## Branch and commit conventions

| Artifact | Format | Example |
|---|---|---|
| Branch (from an issue) | `NPS-{NUM}-{slug}` | `NPS-42-scout-status-filter` |
| Branch (quick fix, no issue) | `bug/{slug}` | `bug/login-redirect-loop` |
| Branch (exploration) | `spike/{slug}` | `spike/realtime-presence` |
| Commit | `{type}({scope}): {description} (#{num})` | `feat(scout): add status filter (#42)` |
| PR title | `NPS-{NUM} {description}` | `NPS-42 Scout status filter` |

Commit types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, `style`.

Create the branch without tracking `main`, or pushes get confusing later:

```bash
git checkout -b NPS-42-scout-status-filter --no-track
```

## The gate — run this before every PR

CI runs these same four jobs on every pull request. Running them locally first turns a
red PR into a thirty-second fix.

```bash
npm run lint
npm run type-check
npm run test
npm run build
```

Keep the PR description honest about what you actually verified. An unchecked box is
useful information; a checked box that was not run costs a reviewer their afternoon.

## What reviewers look for

- **Scope matches the issue.** An unrelated drive-by fix belongs in its own PR, even when
  it is obviously correct — mixed PRs are the hardest kind to review or revert.
- **No secrets in client code.** Only `VITE_`-prefixed variables reach the browser, which
  means the prefix *is* the security boundary. Never add `VITE_` to a model API key or a
  Supabase service-role key — that publishes it to every visitor. Client-side config is
  declared in `src/vite-env.d.ts`; everything in that interface is public by definition.
- **Migrations are append-only.** Once a migration has been applied anywhere beyond your
  laptop, do not edit it — add a new one. Say in the PR whether it is reversible and what
  RLS policies changed.
- **Access control lives in RLS.** A check that exists only in a React component is a
  suggestion, not a guard; assume a caller can reach the database directly.
- **Refactors change structure, not behavior.** If a test had to change to make a
  "refactor" pass, it is a feature or a bug fix — relabel it.

## Documentation

- `docs/` is tracked and shared — architecture, specs, requirements. Changes here get
  reviewed like code.
- `.claude/docs/` is git-ignored, so nothing in it reaches other contributors. Anything a
  teammate needs belongs under `docs/`.

## Getting help

Open a draft PR early if you want feedback on direction before polishing. A question in
an issue thread is always cheaper than a rewrite after review.
