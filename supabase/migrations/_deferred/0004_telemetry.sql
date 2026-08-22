-- Telemetry tables for agent observability.
--
-- agent_runs and tool_calls capture every model call's input, output, cost, and
-- duration. Per PRD §5.3: separated from operational data — no FK from business
-- tables into telemetry. The gateway (src/model/gateway.ts) writes these
-- via service role; authenticated users can read them if admin.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table agent_runs (
  id              uuid primary key default uuid_generate_v4(),
  agent           text not null check (agent in ('scout', 'architect', 'pulse', 'envoy', 'chronicle')),
  organization_id uuid references organizations (id),
  engagement_id   uuid references engagements (id),
  model           text,
  prompt_version  text,
  input           jsonb,
  output          jsonb,
  error           jsonb,
  duration_ms     int,
  cost_cents      numeric,
  created_at      timestamptz not null default now()
);

create table tool_calls (
  id           uuid primary key default uuid_generate_v4(),
  agent_run_id uuid not null references agent_runs (id) on delete cascade,
  tool         text not null,
  input        jsonb,
  output       jsonb,
  error        jsonb,
  duration_ms  int,
  created_at   timestamptz not null default now()
);

create index agent_runs_agent_idx on agent_runs (agent);
create index agent_runs_organization_id_idx on agent_runs (organization_id);
create index agent_runs_created_at_idx on agent_runs (created_at);
create index tool_calls_agent_run_id_idx on tool_calls (agent_run_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table agent_runs enable row level security;
alter table agent_runs force row level security;
alter table tool_calls enable row level security;
alter table tool_calls force row level security;

-- Admin-only read. Writes go through service role (bypasses RLS).
create policy agent_runs_select_admin on agent_runs
  for select to authenticated
  using (is_admin()
         and (organization_id is null
              or organization_id in (select user_org_ids())));

create policy tool_calls_select_admin on tool_calls
  for select to authenticated
  using (is_admin()
         and exists (
           select 1 from agent_runs ar
           where ar.id = tool_calls.agent_run_id
             and (ar.organization_id is null
                  or ar.organization_id in (select user_org_ids()))
         ));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- Authenticated users can read (gated by RLS to admins only).
-- No INSERT/UPDATE/DELETE grant for authenticated — writes are service-role only.
grant select on agent_runs to authenticated;
grant select on tool_calls to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table agent_runs;
