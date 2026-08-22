-- Engagement observability: staff read access, a link to the assessment, and an
-- activity signal.
--
-- Prerequisite for the Pulse agent (docs/agents/pulse.md). Pulse is specified as
-- weekly and per-engagement across all in-progress engagements, and none of that is
-- possible against 0001's schema: every `engagements` policy is owner-scoped, so a
-- staff session reads zero rows (not an error — a silent empty result); there is no
-- join path from an engagement to the Architect plan it should be measured against;
-- and nothing records that anything ever happened on an engagement.
--
-- Deliberately NOT resolved here: who may *write* `engagements.stage` (U5,
-- docs/ARCHITECTURE.md §5). This migration grants staff read authority only.

-- ---------------------------------------------------------------------------
-- 1. Staff read access to engagements
-- ---------------------------------------------------------------------------

-- SELECT only, alongside the four owner-scoped policies from 0001 (:550-577), which
-- are left intact. Postgres ORs permissive policies together, so this widens reads for
-- admins without narrowing anything for owners.
--
-- Granting an admin policy for UPDATE/INSERT/DELETE here would resolve U5 by accident:
-- staff would silently gain stage-write authority that nobody has assigned. Read and
-- write are separate decisions and this migration takes only the first.
--
-- Note this makes engagement data cross-org readable by any user with role = 'admin'.
-- That is a privacy posture, not only a technical change; it is scoped to the current
-- single-team staff model.
create policy engagements_select_admin on engagements
  for select to authenticated
  using (is_admin());

-- ---------------------------------------------------------------------------
-- 2. Link an engagement to the assessment whose plan it is executing
-- ---------------------------------------------------------------------------

-- Pulse measures health "relative to what the plan committed to" (pulse.md:24-26), but
-- 0001 has no edge from `engagements` to `architect_assessments` — the assessment shares
-- an id with the *scout intake*, not with the engagement.
--
-- Nullable on purpose: an engagement can legitimately predate its assessment, and every
-- existing row has none. Pulse must read null as "no plan to measure against" rather
-- than as an error. Left mutable — `engagements_enforce_transitions` (0001:393-418) is
-- deliberately not extended, since gaining an assessment after the fact is normal.
alter table engagements
  add column assessment_id uuid references architect_assessments (id);

create index engagements_assessment_id_idx on engagements (assessment_id);

-- ---------------------------------------------------------------------------
-- 3. An activity signal
-- ---------------------------------------------------------------------------

-- `engagements.updated_at` is maintained (0001:412) but measures the wrong subject: the
-- only writer is the partner org owner editing their own row through the portal, so an
-- engagement where the partner logs in weekly and nothing else happens looks maximally
-- healthy, while one where the volunteer team ships steadily but the partner never logs
-- in looks stalled. Staleness derived from it is a real signal about the wrong thing.
--
-- An append-only event log measures the engagement itself.

create type engagement_event_kind as enum (
  'milestone_completed',
  'session_held',
  'blocker_raised',
  'note_added'
);

create table engagement_events (
  id            uuid primary key default uuid_generate_v4(),
  engagement_id uuid not null references engagements (id) on delete cascade,
  kind          engagement_event_kind not null,
  detail        text,
  created_by    uuid not null references users (id),
  created_at    timestamptz not null default now()
);

-- Pulse's hot path is "most recent event for this engagement".
create index engagement_events_engagement_id_created_at_idx
  on engagement_events (engagement_id, created_at desc);

alter table engagement_events enable row level security;
-- Defence in depth, matching 0001:497-501 — RLS does not bind the table owner without it.
alter table engagement_events force row level security;

-- An owner reads the history of their own engagements.
create policy engagement_events_select_own on engagement_events
  for select to authenticated
  using (exists (select 1 from engagements e
                 where e.id = engagement_events.engagement_id
                   and e.owner_id = auth.uid()));

-- Staff read all of it — this is the signal Pulse consumes.
create policy engagement_events_select_admin on engagement_events
  for select to authenticated
  using (is_admin());

-- An owner may append to their own engagement, and may only attribute an event to
-- themselves — the same shape as `architect_assessments`' created_by check (0001:619).
create policy engagement_events_insert_own on engagement_events
  for insert to authenticated
  with check (created_by = auth.uid()
              and exists (select 1 from engagements e
                          where e.id = engagement_events.engagement_id
                            and e.owner_id = auth.uid()));

-- No UPDATE or DELETE policy, for anyone. Default-deny makes the table append-only,
-- which is what a history has to be to be trustworthy — and matches the existing
-- "nobody can delete an assessment — audit trail" instinct (0001 architect policies).

-- Privileges are the outer gate; every policy above is unreachable without them
-- (0001:636-644). Mirroring the policy set exactly: SELECT and INSERT only, so UPDATE
-- and DELETE are denied by the absence of a privilege as well as the absence of a
-- policy. Append-only is thus enforced twice, and a future policy added without thought
-- still cannot open a command by itself.
grant select, insert on engagement_events to authenticated;

-- Scope note: nothing in the application writes these events yet. The authoring surface
-- is separate work, so at launch every engagement has an empty history. Pulse must treat
-- that as "no signal", distinct from "stalled".
