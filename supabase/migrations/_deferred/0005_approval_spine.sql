-- Approval spine: approvals + audit_events.
--
-- approvals: HITL surface for L3/L4 decisions across all agents.
-- audit_events: append-only log of all system actions (same enforcement as
-- engagement_events: no UPDATE/DELETE policy + no UPDATE/DELETE grant).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table approvals (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid references organizations (id),
  agent           text not null check (agent in ('scout', 'architect', 'pulse', 'envoy', 'chronicle')),
  agent_run_id    uuid references agent_runs (id),
  entity_type     text not null check (entity_type in ('intake', 'assessment', 'communication', 'story')),
  entity_id       uuid not null,
  hitl_tier       text not null check (hitl_tier in ('L2', 'L3', 'L4')),
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  reviewer_id     uuid references auth.users (id),
  reviewed_at     timestamptz,
  notes           text,
  created_at      timestamptz not null default now()
);

create table audit_events (
  id              uuid primary key default uuid_generate_v4(),
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
create index audit_events_organization_id_idx on audit_events (organization_id);
create index audit_events_created_at_idx on audit_events (created_at);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table approvals enable row level security;
alter table approvals force row level security;
alter table audit_events enable row level security;
alter table audit_events force row level security;

-- Approvals: admin read + status transitions (update).
create policy approvals_select_admin on approvals
  for select to authenticated
  using (is_admin()
         and (organization_id is null
              or organization_id in (select user_org_ids())));

create policy approvals_update_admin on approvals
  for update to authenticated
  using (is_admin()
         and (organization_id is null
              or organization_id in (select user_org_ids())))
  with check (is_admin());

-- Audit events: admin read only. Writes go through service role.
-- Append-only: no UPDATE/DELETE policy AND no UPDATE/DELETE grant.
create policy audit_events_select_admin on audit_events
  for select to authenticated
  using (is_admin()
         and (organization_id is null
              or organization_id in (select user_org_ids())));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- Approvals: admin can read and update status.
grant select, update on approvals to authenticated;

-- Audit events: admin can read only. No INSERT/UPDATE/DELETE for authenticated.
-- Append-only enforcement: same pattern as engagement_events.
grant select on audit_events to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table approvals;
