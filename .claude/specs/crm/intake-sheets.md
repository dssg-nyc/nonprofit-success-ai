# Intake — Google Sheets, synced into Supabase

**Status:** Decided 2026-08-21 — Sheets remain the entry point; a sync imports
rows into Supabase. Not yet implemented.

## Current state

Two forms write to Google Sheets:

| Form | Sheet | Notes |
|---|---|---|
| Client intake | [`1OnUk-KQ…`](https://docs.google.com/spreadsheets/d/1OnUk-KQDjgz0b45dinhPP3KDwW7cCJQlAk9QXZZRhsA/edit?gid=182868027) gid 182868027 | From the website |
| Diplomat intake | [`1AyvBMU8…`](https://docs.google.com/spreadsheets/d/1AyvBMU87yUHmn9m74-NX6yDrTERYVVOXs8McvrKFqP4/edit?gid=1257108654) gid 1257108654 | Volunteers |

Both are private — their column structure has not been mapped against
`scout_intakes` (31 columns). **That mapping is the first task**, and until it is done
nobody should assume the schema matches what the forms collect.

There is also a third path: the in-app `ScoutIntakeForm` writes directly to Firestore
`scoutIntakes`. So intake currently has two unrelated destinations, and the sync has to
account for both without double-creating records.

## Decision

Sheets stay as the entry point. A sync job reads new rows and writes them into Supabase.

**Why:** the forms are embedded in the website and used by people outside this app.
Repointing them is a coordination problem, not a code problem, and it would break whoever
reads those spreadsheets today.

**The cost, stated plainly:** two sources of truth. A row edited in Sheets after import
diverges from its Supabase copy unless the sync reconciles rather than just appends. Decide
whether Sheets or Supabase wins on conflict *before* building the sync — retrofitting that
answer means reprocessing history.

## Design questions

1. **Trigger.** Apps Script on form submit (immediate, per row) or a polling job (simpler,
   delayed)? Apps Script pushing to a Supabase endpoint avoids granting the app broad
   Sheets access.
2. **Idempotency.** A sync that re-reads a row must not create a second intake. Needs a
   stable key — a form response id or a hash of the row — and a unique constraint behind
   it.
3. **Which sheet feeds which table.** Client intake plausibly maps to `scout_intakes`.
   Diplomat intake is volunteer onboarding, which under the three-role model
   ([access-model.md](access-model.md)) is closer to user + project assignment than to an
   intake record. **These two probably do not share a destination table.**
4. **Auth for volunteers.** If diplomat intake creates a user, it intersects with the role
   model directly — a volunteer needs an account and project assignments, not a
   `scout_intakes` row.
5. **Validation.** Sheets accept anything typed into a cell; `scout_intakes` has NOT NULL
   and enum constraints. The sync needs a rejection path — a row that fails validation must
   surface somewhere, not vanish.

## Next step

Map both sheets' columns against `scout_intakes` before writing any sync code. Until the
schema is confirmed to fit the real data, the sync's shape is guesswork.
