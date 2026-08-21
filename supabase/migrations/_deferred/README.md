# Deferred migrations

Written and verified, deliberately **not** in the apply path. `supabase db reset` and
`db push` ignore this directory.

Held back on 2026-08-21 after establishing that the app needs only `0001`+`0002` to leave
Firebase, and that the role model these assume is wrong (see below).

| File | Adds | Why held |
|---|---|---|
| `0003_tenancy.sql` | `organizations`, `organization_members` | **Wrong model** — see below |
| `0004_telemetry.sql` | `agent_runs`, `tool_calls` | For agents that do not exist yet |
| `0005_approval_spine.sql` | `approvals`, `audit_events` | HITL surface, no agent to approve for |
| `0006_delivery.sql` | `milestones`, `tasks` | Delivery tracking, unbuilt |
| `0007_documents.sql` | `documents` | Document provenance, unbuilt |

0004–0007 are simply early: apply them when the feature that needs them is built.

## 0003 is not just early — it is the wrong shape

It scopes access by **organization**, granting every member access to every row in their
org. The decided model ([docs/crm-specs/access-model.md](../../../docs/crm-specs/access-model.md))
scopes volunteers by **project assignment**, with three roles rather than two.

Applying 0003 as-is would give a volunteer added to the DSSG organization visibility of
**every client engagement** — the opposite of the intent. It needs rewriting, not
unblocking.

Worth salvaging from it: the `SECURITY DEFINER` helper pattern (`user_org_ids()`). Policies
checking membership must use a definer function or they recurse through the membership
table's own policies. The replacement needs the same shape over a project-membership table.

## The RLS suite is deferred with them

`../../tests/_deferred/rls.test.sql.deferred` — 81 assertions covering all 8 migrations, so
it cannot run against the 3 now applied (53 references to deferred tables). Renamed with a
`.deferred` suffix because the CLI globs `tests/` recursively and a plain move was still
picked up.

**It passed in full** against all 8 migrations before deferral. It is not broken — it is
scoped to a schema that is no longer applied.

## Restoring one

```bash
git mv supabase/migrations/_deferred/000N_name.sql supabase/migrations/
make db-reset
```

Renumber if an earlier number has since been taken. Once pushed to a hosted project,
migrations are append-only — a change means a new file, never an edit to an applied one.
