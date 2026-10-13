-- Delivery: the activity log, milestones, tasks and documents.
--
-- engagement_events is the per-engagement feed the partner portal renders and Pulse
-- reads. Lifecycle kinds (`stage_advanced`, `stage_reverted`) are written only by
-- transition_engagement() (0005_lifecycle), which also stamps approval_id and an
-- idempotency key; clients write the other kinds with neither.

create table engagement_events (
  id              uuid primary key default gen_random_uuid(),
  engagement_id   uuid not null references engagements (id) on delete cascade,
  organization_id uuid references organizations (id),
  kind            engagement_event_kind not null,
  -- A JSON object, or null. A note is `{"text": ...}`; a lifecycle event is
  -- `{from, to, reason, guard_deferred, approval_id, evidence}` (0005_lifecycle).
  detail          jsonb check (detail is null or jsonb_typeof(detail) = 'object'),
  created_by      uuid not null references users (id),
  created_at      timestamptz not null default now(),
  -- Set by transition_engagement() only (the insert policies require null).
  idempotency_key text
                  check (idempotency_key is null
                         or char_length(idempotency_key) between 8 and 128),
  -- The approval a lifecycle event was executed under, when one was required.
  approval_id     uuid references approvals (id)
);

create index engagement_events_engagement_id_created_at_idx
  on engagement_events (engagement_id, created_at desc);
create index engagement_events_organization_id_idx on engagement_events (organization_id);
create unique index engagement_events_idempotency_key_key
  on engagement_events (idempotency_key) where idempotency_key is not null;
create index engagement_events_approval_id_idx
  on engagement_events (approval_id) where approval_id is not null;

create table milestones (
  id              uuid primary key default gen_random_uuid(),
  engagement_id   uuid not null references engagements (id) on delete cascade,
  organization_id uuid references organizations (id),
  title           text not null,
  description     text,
  due_date        date,
  status          text not null default 'pending'
                  check (status in ('pending', 'in_progress', 'completed', 'blocked')),
  completed_at    timestamptz,
  created_at      timestamptz not null default now()
);

create table tasks (
  id              uuid primary key default gen_random_uuid(),
  milestone_id    uuid references milestones (id) on delete cascade,
  engagement_id   uuid not null references engagements (id) on delete cascade,
  organization_id uuid references organizations (id),
  title           text not null,
  assignee_id     uuid references auth.users (id),
  status          text not null default 'pending'
                  check (status in ('pending', 'in_progress', 'completed')),
  created_at      timestamptz not null default now()
);

-- Documents: metadata only. The bytes live in Storage (config.toml [storage]); this row
-- is the index of them. `provenance` is the free-form record of where a generated or
-- external document came from.
create table documents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations (id),
  engagement_id   uuid references engagements (id),
  source          text not null check (source in ('upload', 'generated', 'external')),
  classification  text,
  title           text not null,
  storage_path    text,
  mime_type       text,
  version         int not null default 1,
  status          text not null default 'active'
                  check (status in ('active', 'archived', 'superseded')),
  provenance      jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index milestones_engagement_id_idx on milestones (engagement_id);
create index milestones_organization_id_idx on milestones (organization_id);
create index tasks_milestone_id_idx on tasks (milestone_id);
create index tasks_engagement_id_idx on tasks (engagement_id);
create index tasks_organization_id_idx on tasks (organization_id);
create index documents_organization_id_idx on documents (organization_id);
create index documents_engagement_id_idx on documents (engagement_id);
create index documents_status_idx on documents (status);

alter table engagement_events enable row level security;
alter table milestones        enable row level security;
alter table tasks             enable row level security;
alter table documents         enable row level security;
alter table engagement_events force row level security;
alter table milestones        force row level security;
alter table tasks             force row level security;
alter table documents         force row level security;

-- engagement_events -----------------------------------------------------

create policy engagement_events_select_own on engagement_events
  for select to authenticated
  using (organization_id in (select user_org_ids())
         and exists (
           select 1 from engagements e
           where e.id = engagement_events.engagement_id
             and e.owner_id = auth.uid()
         ));

create policy engagement_events_select_admin on engagement_events
  for select to authenticated
  using (is_admin()
         and organization_id in (select user_org_ids()));

-- A partner logs activity on their own engagement; staff on any engagement in their
-- org. Neither may write a lifecycle kind, an idempotency key or (by privilege, below)
-- an approval_id: those are the transition command's.
create policy engagement_events_insert_own on engagement_events
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and kind::text not in ('stage_advanced', 'stage_reverted')
    and idempotency_key is null
    and organization_id in (select user_org_ids())
    and exists (
      select 1 from engagements e
      where e.id = engagement_events.engagement_id
        and e.owner_id = auth.uid()
        and e.organization_id = engagement_events.organization_id
    )
  );

create policy engagement_events_insert_admin on engagement_events
  for insert to authenticated
  with check (
    is_admin()
    and created_by = auth.uid()
    and kind::text not in ('stage_advanced', 'stage_reverted')
    and idempotency_key is null
    and organization_id in (select user_org_ids())
    and exists (
      select 1 from engagements e
      where e.id = engagement_events.engagement_id
        and e.organization_id = engagement_events.organization_id
    )
  );

-- No update or delete: the activity log is append-only.

-- milestones / tasks ----------------------------------------------------

create policy milestones_select_own on milestones
  for select to authenticated
  using (organization_id in (select user_org_ids())
         and exists (select 1 from engagements e
                     where e.id = milestones.engagement_id and e.owner_id = auth.uid()));

create policy milestones_select_admin on milestones
  for select to authenticated
  using (is_admin()
         and (organization_id is null
              or organization_id in (select user_org_ids())));

create policy milestones_insert_own on milestones
  for insert to authenticated
  with check (organization_id in (select user_org_ids())
              and exists (select 1 from engagements e
                          where e.id = milestones.engagement_id and e.owner_id = auth.uid()));

create policy milestones_update_own on milestones
  for update to authenticated
  using (organization_id in (select user_org_ids())
         and exists (select 1 from engagements e
                     where e.id = milestones.engagement_id and e.owner_id = auth.uid()))
  with check (organization_id in (select user_org_ids()));

create policy milestones_delete_own on milestones
  for delete to authenticated
  using (organization_id in (select user_org_ids())
         and exists (select 1 from engagements e
                     where e.id = milestones.engagement_id and e.owner_id = auth.uid()));

create policy tasks_select_own on tasks
  for select to authenticated
  using (organization_id in (select user_org_ids())
         and exists (select 1 from engagements e
                     where e.id = tasks.engagement_id and e.owner_id = auth.uid()));

create policy tasks_select_admin on tasks
  for select to authenticated
  using (is_admin()
         and (organization_id is null
              or organization_id in (select user_org_ids())));

create policy tasks_insert_own on tasks
  for insert to authenticated
  with check (organization_id in (select user_org_ids())
              and exists (select 1 from engagements e
                          where e.id = tasks.engagement_id and e.owner_id = auth.uid()));

create policy tasks_update_own on tasks
  for update to authenticated
  using (organization_id in (select user_org_ids())
         and exists (select 1 from engagements e
                     where e.id = tasks.engagement_id and e.owner_id = auth.uid()))
  with check (organization_id in (select user_org_ids()));

create policy tasks_delete_own on tasks
  for delete to authenticated
  using (organization_id in (select user_org_ids())
         and exists (select 1 from engagements e
                     where e.id = tasks.engagement_id and e.owner_id = auth.uid()));

-- documents -------------------------------------------------------------
--
-- KNOWN OVERREACH. These policies are org-wide: any member of an organization can read,
-- write and delete every document in it, with no owner or engagement check. Every other
-- table scopes a partner to their own engagements. This is the clearest instance of why
-- the org-membership model is being replaced (C1, access-model.md) and must be fixed in
-- that rewrite; the table is not used by the SPA yet. Do not host before then.

create policy documents_select_own on documents
  for select to authenticated
  using (organization_id in (select user_org_ids()));

create policy documents_insert_own on documents
  for insert to authenticated
  with check (organization_id in (select user_org_ids()));

create policy documents_update_own on documents
  for update to authenticated
  using (organization_id in (select user_org_ids()))
  with check (organization_id in (select user_org_ids()));

create policy documents_delete_own on documents
  for delete to authenticated
  using (organization_id in (select user_org_ids()));

-- privileges --------------------------------------------------------------

revoke all on engagement_events, milestones, tasks, documents from anon, authenticated;
grant select, insert                 on engagement_events to authenticated;
grant select, insert, update, delete on milestones        to authenticated;
grant select, insert, update, delete on tasks             to authenticated;
grant select, insert, update, delete on documents         to authenticated;

alter publication supabase_realtime add table milestones;
alter publication supabase_realtime add table tasks;
alter publication supabase_realtime add table documents;
