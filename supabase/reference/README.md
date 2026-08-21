# Port sources — Firebase artifacts, not Supabase config

These two files are **Firebase**, kept here because they are the documents
`../migrations/` was ported from. The Supabase CLI does not read them: it looks for
`config.toml`, `migrations/`, and `tests/` by name, so this directory is inert to it.

| File | What it is | Ported into |
|---|---|---|
| `firestore.rules` | The former Firestore security rules (207 lines) — superseded by Supabase RLS; kept as audit reference only | `../migrations/0001_init.sql` (columns, constraints) and the RLS policies across `0001`–`0002` |
| `firebase-blueprint.json` | Firestore entity/collection schema — 3 entities: Business, Engagement, User | `../migrations/0001_init.sql` tables `businesses`, `engagements`, `users` |

## Why they are still here

**They no longer enforce anything.** As of 2026-08-21 the app runs on Supabase, `firebase`
is out of `package.json`, and RLS is the access control. These are the *source documents*
the schema was derived from, not live configuration.

They earn their place for one reason: `0001_init.sql` carries **98 citations** of the form
`-- rules:53`, each naming the exact line of `firestore.rules` a column or policy came
from. That is what makes the port auditable — you can check any constraint against the rule
it claims to implement. A citation that no longer matches the rule it names is a porting
bug, and without this file there is no way to find one.

## Do not rename these to `supabase-*`

Their contents are Firestore syntax (`allow read: if request.auth.uid == ...`), which
Supabase cannot execute. A file named `supabase-rules` holding Firestore rules is worse
than an honestly-named `firestore.rules`. The Supabase equivalent already exists — it is
the RLS policies in `../migrations/0001_init.sql`.

## When to delete them

Once the port has been audited and you are confident the RLS policies are right, these have
no further use — delete them then. Two conditions first:

1. **They must be committed.** Deleting an uncommitted file destroys it; deleting a
   committed one leaves it in history, recoverable with `git show`.
2. **Strip the citations too**, or accept that 98 `-- rules:NN` comments in `0001_init.sql`
   point at a file nobody can open.

The applied Supabase schema has **6 tables**: `users`, `businesses`, `engagements` (from
`0001_init.sql`), `scout_intakes`, `architect_assessments` (also `0001`), and
`engagement_events` (from `0002`). Nine more tables (`agent_runs`, `tool_calls`,
`approvals`, `audit_events`, `documents`, `milestones`, `tasks`, `organizations`,
`organization_members`) are drafted in `migrations/_deferred/` and are **not yet applied**.
