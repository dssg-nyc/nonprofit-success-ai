-- Approvals and the audit log: the HITL spine.
--
-- An agent's output that a human must sign off on (HITL L3/L4 — design-system.md §2,
-- .claude/specs/db/lifecycle.md) lands in its own table as a draft beside a *pending
-- approval*. The approval is the unit of work for the review queue; the draft table is
-- where the content lives. Nothing here stores prompt text or model output.
--
-- `approvals.agent` and `entity_type` are closed vocabularies: 'system' is the agent for
-- transitions that no roster agent proposed; 'transition' is the entity a reversal
-- approval names, 'lesson' a promoted lesson, 'charter' an architect draft. See
-- 0004_drafts and 0005_lifecycle for who writes which.

create table approvals (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations (id),
  agent           text not null
                  check (agent in ('scout', 'architect', 'pulse', 'envoy', 'chronicle', 'system')),
  agent_run_id    uuid references agent_runs (id),
  entity_type     text not null
                  check (entity_type in ('intake', 'assessment', 'communication', 'story',
                                         'charter', 'transition', 'lesson')),
  entity_id       uuid not null,
  hitl_tier       text not null check (hitl_tier in ('L2', 'L3', 'L4')),
  status          text not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected', 'expired')),
  reviewer_id     uuid references auth.users (id),
  reviewed_at     timestamptz,
  notes           text,
  created_at      timestamptz not null default now(),

  -- Retry safety for the submit_* RPCs: a caller that retries after a timeout passes
  -- the same key and gets the same approval back, not a second pending row.
  idempotency_key text
                  check (idempotency_key is null
                         or char_length(idempotency_key) between 8 and 200),

  -- The draft row this approval reviews (communications / chronicle_drafts /
  -- architect_assessments by id). entity_id names the *subject* (the engagement or the
  -- intake); draft_id names the draft. No FK because the draft lives in one of several
  -- tables; each submit_* RPC sets it inside the transaction that creates the draft.
  draft_id        uuid
);

create table audit_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations (id),
  actor_id        uuid references auth.users (id),
  action          text not null,
  entity_type     text,
  entity_id       uuid,
  detail          jsonb,
  created_at      timestamptz not null default now()
);

create index approvals_organization_id_idx on approvals (organization_id);
create index approvals_status_idx on approvals (status);
create index approvals_entity_idx on approvals (entity_type, entity_id);
create index approvals_agent_run_id_idx on approvals (agent_run_id);
create unique index approvals_idempotency_key_key
  on approvals (idempotency_key) where idempotency_key is not null;
-- One open charter review per intake: a second submit while one is pending is a
-- conflict (submit_architect_draft maps 23505 on this index to 409).
create unique index approvals_one_pending_charter_idx
  on approvals (entity_id) where entity_type = 'charter' and status = 'pending';
create index approvals_draft_id_idx on approvals (draft_id) where draft_id is not null;

create index audit_events_organization_id_idx on audit_events (organization_id);
create index audit_events_created_at_idx on audit_events (created_at);

alter table approvals    enable row level security;
alter table audit_events enable row level security;
alter table approvals    force row level security;
alter table audit_events force row level security;

-- Staff read approvals in their orgs (plus unassigned ones).
create policy approvals_select_admin on approvals
  for select to authenticated
  using (is_admin()
         and (organization_id is null
              or organization_id in (select user_org_ids())));

-- The review decision. An admin resolving an approval must name themself as the
-- reviewer and stamp the time: a row cannot be approved anonymously, and a client
-- cannot approve "as" another admin. Status transitions themselves (pending -> approved
-- only, no un-approve) are the SPA's contract today; the RPCs check `status = 'pending'`
-- on their side.
create policy approvals_update_admin on approvals
  for update to authenticated
  using (is_admin()
         and (organization_id is null
              or organization_id in (select user_org_ids())))
  with check (is_admin()
              and reviewer_id = auth.uid()
              and reviewed_at is not null);

create policy audit_events_select_admin on audit_events
  for select to authenticated
  using (is_admin()
         and (organization_id is null
              or organization_id in (select user_org_ids())));

-- Approvals are created by the RPCs (owner) and the recorder (service_role), never by a
-- client. The audit log is append-only for everyone.
revoke all on approvals, audit_events from anon, authenticated, service_role;
grant select, update on approvals    to authenticated;
grant select         on audit_events to authenticated;
grant select, insert, update on approvals    to service_role;
grant select, insert         on audit_events to service_role;

-- The review queue subscribes to approvals.
alter publication supabase_realtime add table approvals;
