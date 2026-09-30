-- Delivery tables: milestones + tasks.
--
-- Makes engagement health computable: Pulse can measure milestone progress
-- instead of relying only on activity signals.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table milestones (
  id              uuid primary key default uuid_generate_v4(),
  engagement_id   uuid not null references engagements (id) on delete cascade,
  organization_id uuid references organizations (id),
  title           text not null,
  description     text,
  due_date        date,
  status          text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'blocked')),
  completed_at    timestamptz,
  created_at      timestamptz not null default now()
);

create table tasks (
  id              uuid primary key default uuid_generate_v4(),
  milestone_id    uuid references milestones (id) on delete cascade,
  engagement_id   uuid not null references engagements (id) on delete cascade,
  organization_id uuid references organizations (id),
  title           text not null,
  assignee_id     uuid references auth.users (id),
  status          text not null default 'pending' check (status in ('pending', 'in_progress', 'completed')),
  created_at      timestamptz not null default now()
);

create index milestones_engagement_id_idx on milestones (engagement_id);
create index milestones_organization_id_idx on milestones (organization_id);
create index tasks_milestone_id_idx on tasks (milestone_id);
create index tasks_engagement_id_idx on tasks (engagement_id);
create index tasks_organization_id_idx on tasks (organization_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table milestones enable row level security;
alter table milestones force row level security;
alter table tasks enable row level security;
alter table tasks force row level security;

-- Owner can CRUD milestones/tasks on their own engagements. Admin can read all in org.

create policy milestones_select_own on milestones
  for select to authenticated
  using (organization_id in (select user_org_ids())
         and exists (select 1 from engagements e
                     where e.id = milestones.engagement_id
                       and e.owner_id = auth.uid()));

create policy milestones_select_admin on milestones
  for select to authenticated
  using (is_admin()
         and (organization_id is null
              or organization_id in (select user_org_ids())));

create policy milestones_insert_own on milestones
  for insert to authenticated
  with check (organization_id in (select user_org_ids())
              and exists (select 1 from engagements e
                          where e.id = milestones.engagement_id
                            and e.owner_id = auth.uid()));

create policy milestones_update_own on milestones
  for update to authenticated
  using (organization_id in (select user_org_ids())
         and exists (select 1 from engagements e
                     where e.id = milestones.engagement_id
                       and e.owner_id = auth.uid()))
  with check (organization_id in (select user_org_ids()));

create policy milestones_delete_own on milestones
  for delete to authenticated
  using (organization_id in (select user_org_ids())
         and exists (select 1 from engagements e
                     where e.id = milestones.engagement_id
                       and e.owner_id = auth.uid()));

-- Tasks follow the same pattern.
create policy tasks_select_own on tasks
  for select to authenticated
  using (organization_id in (select user_org_ids())
         and exists (select 1 from engagements e
                     where e.id = tasks.engagement_id
                       and e.owner_id = auth.uid()));

create policy tasks_select_admin on tasks
  for select to authenticated
  using (is_admin()
         and (organization_id is null
              or organization_id in (select user_org_ids())));

create policy tasks_insert_own on tasks
  for insert to authenticated
  with check (organization_id in (select user_org_ids())
              and exists (select 1 from engagements e
                          where e.id = tasks.engagement_id
                            and e.owner_id = auth.uid()));

create policy tasks_update_own on tasks
  for update to authenticated
  using (organization_id in (select user_org_ids())
         and exists (select 1 from engagements e
                     where e.id = tasks.engagement_id
                       and e.owner_id = auth.uid()))
  with check (organization_id in (select user_org_ids()));

create policy tasks_delete_own on tasks
  for delete to authenticated
  using (organization_id in (select user_org_ids())
         and exists (select 1 from engagements e
                     where e.id = tasks.engagement_id
                       and e.owner_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on milestones to authenticated;
grant select, insert, update, delete on tasks to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table milestones;
alter publication supabase_realtime add table tasks;
