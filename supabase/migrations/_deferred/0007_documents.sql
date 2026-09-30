-- Documents with provenance — ingest now, retrieve later.
--
-- No chunking, no embeddings, no pgvector. Ingestion with provenance only.
-- Per docs/crm/data-model.md §5: every retrieved item must carry source, version,
-- tenant/scope, document status, and provenance.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table documents (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid references organizations (id),
  engagement_id   uuid references engagements (id),
  source          text not null check (source in ('upload', 'generated', 'external')),
  classification  text,
  title           text not null,
  storage_path    text,
  mime_type       text,
  version         int not null default 1,
  status          text not null default 'active' check (status in ('active', 'archived', 'superseded')),
  provenance      jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index documents_organization_id_idx on documents (organization_id);
create index documents_engagement_id_idx on documents (engagement_id);
create index documents_status_idx on documents (status);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table documents enable row level security;
alter table documents force row level security;

-- Org-scoped read/write. Admin can also update status.

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

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on documents to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table documents;
