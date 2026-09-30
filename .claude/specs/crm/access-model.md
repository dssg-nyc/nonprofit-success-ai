# Access model — three roles, project-scoped

**Status:** Decided 2026-08-21. Not yet implemented — no applied migration writes
this. Supersedes the two-role model inherited from `firestore.rules` and the
organization-scoped design in `_deferred/0003_tenancy.sql`.

## What a project is

**A project is a unit of work a client organization requests.** FOIA is one example.

- A client organization **has many projects**.
- Each project has a **diplomat assigned to deliver it**.
- A diplomat sees the projects they are assigned to, not all projects.

This is a new concept. The current schema has no table for it — `engagements` is
*stage-scoped* (`unique (business_id, stage)`, one row per business per lifecycle stage),
which models a business's journey, not a deliverable. A business with three concurrent FOIA
projects cannot be expressed by it.

So `projects` is a new table sitting between `businesses` and the work, and `engagements`
either becomes a property of a project or stays as the org-level lifecycle alongside it.
**That relationship is the open question below.**

## The three roles

| Role | Who | Sees |
|---|---|---|
| **Client** | Staff at a partner nonprofit / small business | Their organization's projects |
| **Diplomat** | Volunteer delivering a project | **Only assigned projects** — same dashboard view as the client for those |
| **Admin** | Platform / meta level | All projects, all organizations |

Decided 2026-08-21:

- **Diplomats get the same dashboard view as clients**, scoped to assigned projects. Not a
  reduced view — the same one.
- **Clients can see the diplomat assigned to their project.** The assignment is not hidden.
- **Access is cohort-bounded.** DSSG volunteers work in time-boxed cohorts, and access ends
  with the cohort. Assignment therefore needs a validity window, not a plain membership row
  — a diplomat from a finished cohort must lose access without anyone remembering to
  revoke it.

## Messaging (wanted, not yet designed)

An inbox so clients and diplomats can communicate about a project. Noted as desirable, not
specified. When it is:

- Messages are **project-scoped** — the same assignment that grants project access grants
  the thread.
- A future volunteer portal implies **visibility control**: a diplomat may post something
  clients see, or something only staff/admins see. That is a per-message visibility flag,
  and it is far cheaper to include from the start than to retrofit onto existing rows.
- Admins see all threads.

## Why the current schema cannot express this

`0001_init.sql` defines `user_role as enum ('client', 'admin')` — a faithful port of
`firestore.rules`, which never modeled volunteers. Twelve RLS policies branch on
`is_admin()`, which reads that enum.

The diplomat tier is the expensive part: a volunteer is neither the **owner** of a record
(the client is) nor a **global admin**. Their access is a per-project, time-bounded grant,
requiring a membership relation no applied migration provides.

## Why `_deferred/0003_tenancy.sql` is the wrong shape

Worth stating plainly, because at a glance it looks like it solves this.

| | 0003 as written | What this model needs |
|---|---|---|
| Scope unit | organization | **project** |
| Roles | `owner` / `admin` / `member` | `client` / `diplomat` / `admin` |
| Grants | every row in your org | only assigned projects |
| Time bound | none | **cohort window** |

Under 0003 a volunteer added to the DSSG organization would see **every client
engagement** — the opposite of the intent. It needs rewriting, not unblocking.

Worth salvaging: the `SECURITY DEFINER` helper pattern (`user_org_ids()`). A policy that
checks membership must call a definer function, or it recurses through the membership
table's own policies. The replacement is the same shape over project assignments.

## Remaining open question

**How do `projects` and `engagements` relate?** Three candidates:

1. **Project belongs to an engagement** — the engagement is the org relationship, projects
   are deliverables within it.
2. **Engagement belongs to a project** — each project runs its own six-stage lifecycle.
3. **Parallel** — engagement tracks the org relationship; projects are separate work items
   referencing the business directly.

(1) reads closest to how the six stages are described (`initial_meeting` → `membership` is
clearly an *org* journey, not a per-deliverable one), but this needs confirming before any
table is written.

## Sequencing

Roles must be settled **before** pushing to a hosted project. Postgres enums are awkward to
alter once data exists, and every RLS policy branches on the role.

**Do not write the tenancy migration yet unless necessary.** The
immediate goal is the app running on Supabase for the tables that already exist; the role
and project model lands as its own piece of work.
