-- Organization-scoped tenancy.
--
-- Converts the authorization model from owner-scoped (owner_id = auth.uid()) to
-- org-scoped (membership in the row's organization). One atomic migration per
-- docs/crm/data-model.md §1 — no intermediate state.
--
-- Preserves all existing authorization semantics:
--   * Public intake insert (anonymous, no org context)
--   * Admin-only assessments and intake review
--   * Append-only engagement_events
--   * Terminal-status lock on completed engagements
--   * Immutable owner_id, business_id, created_at on relevant tables
--
-- Adds org-membership checks to every policy that was owner-scoped, and re-points
-- is_admin() at organization_members as the single indirection for role checks.

-- ---------------------------------------------------------------------------
-- Part A — New tables
-- ---------------------------------------------------------------------------

create table organizations (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null check (char_length(name) <= 256),
  created_at timestamptz not null default now()
);

create table organization_members (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            text not null check (role in ('owner', 'admin', 'member')),
  created_at      timestamptz not null default now(),
  constraint organization_members_org_user_key unique (organization_id, user_id)
);

create index organization_members_user_id_idx on organization_members (user_id);

alter table organizations enable row level security;
alter table organizations force row level security;
alter table organization_members enable row level security;
alter table organization_members force row level security;

-- ---------------------------------------------------------------------------
-- Part B — Helper functions
-- ---------------------------------------------------------------------------

-- The set of organization IDs the current user belongs to. Policies use this as
-- `organization_id in (select user_org_ids())`.
--
-- SECURITY DEFINER breaks RLS recursion: policies on org-scoped tables call this
-- function, which reads organization_members. Running as invoker would trigger
-- organization_members' own policies and recurse.
create or replace function user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select organization_id from organization_members
  where user_id = auth.uid();
$$;

revoke execute on function user_org_ids() from public;
grant execute on function user_org_ids() to authenticated;

-- Re-point is_admin() at organization_members. This is the SINGLE INDIRECTION
-- for admin role checks (docs/crm/data-model.md §1). An admin is anyone with
-- role 'admin' or 'owner' in any organization. For DSSG's current single-org
-- model, equivalent to the old users.role = 'admin' check.
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from organization_members
    where user_id = auth.uid()
      and role in ('admin', 'owner')
  );
$$;
-- revoke/grant already exist from 0001.

-- ---------------------------------------------------------------------------
-- Part C — Add organization_id to existing tables
-- ---------------------------------------------------------------------------

-- Nullable at the schema level. Policies enforce non-null on insert for tables
-- that require it (businesses, engagements, engagement_events). scout_intakes
-- is intentionally nullable (anonymous intakes have no org; set during review).

alter table businesses
  add column organization_id uuid references organizations (id);

alter table engagements
  add column organization_id uuid references organizations (id);

alter table scout_intakes
  add column organization_id uuid references organizations (id);

alter table architect_assessments
  add column organization_id uuid references organizations (id);

alter table engagement_events
  add column organization_id uuid references organizations (id);

create index businesses_organization_id_idx on businesses (organization_id);
create index engagements_organization_id_idx on engagements (organization_id);
create index scout_intakes_organization_id_idx on scout_intakes (organization_id);
create index engagement_events_organization_id_idx on engagement_events (organization_id);

-- ---------------------------------------------------------------------------
-- Part D — Rewrite policies on existing tables
--
-- Drop every policy from 0001/0002, recreate with org-scoping. The addition
-- is `organization_id in (select user_org_ids())` on every org-scoped check.
-- ---------------------------------------------------------------------------

-- ---- businesses (rules:105-113) ----

drop policy if exists businesses_select_own on businesses;
drop policy if exists businesses_insert_own on businesses;
drop policy if exists businesses_update_own on businesses;
drop policy if exists businesses_delete_own on businesses;

create policy businesses_select_own on businesses
  for select to authenticated
  using (owner_id = auth.uid()
         and organization_id in (select user_org_ids()));

create policy businesses_insert_own on businesses
  for insert to authenticated
  with check (owner_id = auth.uid()
              and organization_id in (select user_org_ids()));

create policy businesses_update_own on businesses
  for update to authenticated
  using (owner_id = auth.uid()
         and organization_id in (select user_org_ids()))
  with check (owner_id = auth.uid()
              and organization_id in (select user_org_ids()));

create policy businesses_delete_own on businesses
  for delete to authenticated
  using (owner_id = auth.uid()
         and organization_id in (select user_org_ids()));

-- ---- engagements (rules:116-128, 0002 admin read) ----

drop policy if exists engagements_select_own on engagements;
drop policy if exists engagements_select_admin on engagements;
drop policy if exists engagements_insert_own on engagements;
drop policy if exists engagements_update_own on engagements;
drop policy if exists engagements_delete_own on engagements;

create policy engagements_select_own on engagements
  for select to authenticated
  using (owner_id = auth.uid()
         and organization_id in (select user_org_ids()));

-- Staff read all engagements in their org(s). Recreated from 0002 with org-scoping.
create policy engagements_select_admin on engagements
  for select to authenticated
  using (is_admin()
         and organization_id in (select user_org_ids()));

create policy engagements_insert_own on engagements
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and organization_id in (select user_org_ids())
    and exists (
      select 1 from businesses b
      where b.id = engagements.business_id
        and b.owner_id = auth.uid()
        and b.organization_id = engagements.organization_id
    )
  );

create policy engagements_update_own on engagements
  for update to authenticated
  using (owner_id = auth.uid()
         and organization_id in (select user_org_ids()))
  with check (owner_id = auth.uid()
              and organization_id in (select user_org_ids()));

create policy engagements_delete_own on engagements
  for delete to authenticated
  using (owner_id = auth.uid()
         and organization_id in (select user_org_ids()));

-- ---- scout_intakes (rules:182-193) ----

drop policy if exists scout_intakes_select_admin on scout_intakes;
drop policy if exists scout_intakes_insert_public on scout_intakes;
drop policy if exists scout_intakes_update_admin on scout_intakes;

-- Admin reads intakes: unassigned (org_id null — awaiting review) OR in their org.
create policy scout_intakes_select_admin on scout_intakes
  for select to authenticated
  using (is_admin()
         and (organization_id is null
              or organization_id in (select user_org_ids())));

-- Public intake: anonymous insert, no org context. organization_id must be null —
-- the org is assigned when a reviewer approves the intake.
create policy scout_intakes_insert_public on scout_intakes
  for insert to anon, authenticated
  with check (
    review_status = 'pending'
    and review_action is null
    and final_bucket is null
    and reviewed_by is null
    and reviewed_by_email is null
    and reviewed_at is null
    and organization_id is null
  );

-- Admin review. The with-check allows organization_id to be set during review
-- (transitioning from null to the reviewer's org).
create policy scout_intakes_update_admin on scout_intakes
  for update to authenticated
  using (is_admin()
         and (organization_id is null
              or organization_id in (select user_org_ids())))
  with check (is_admin()
              and review_status = 'reviewed'
              and (organization_id is null
                   or organization_id in (select user_org_ids())));

-- ---- architect_assessments (rules:195-205) ----

drop policy if exists architect_assessments_select_admin on architect_assessments;
drop policy if exists architect_assessments_insert_admin on architect_assessments;
drop policy if exists architect_assessments_update_admin on architect_assessments;

create policy architect_assessments_select_admin on architect_assessments
  for select to authenticated
  using (is_admin()
         and (organization_id is null
              or organization_id in (select user_org_ids())));

create policy architect_assessments_insert_admin on architect_assessments
  for insert to authenticated
  with check (is_admin()
              and created_by = auth.uid());

create policy architect_assessments_update_admin on architect_assessments
  for update to authenticated
  using (is_admin()
         and (organization_id is null
              or organization_id in (select user_org_ids())))
  with check (is_admin());

-- ---- engagement_events (0002 step 3) ----

drop policy if exists engagement_events_select_own on engagement_events;
drop policy if exists engagement_events_select_admin on engagement_events;
drop policy if exists engagement_events_insert_own on engagement_events;

create policy engagement_events_select_own on engagement_events
  for select to authenticated
  using (organization_id in (select user_org_ids())
         and exists (select 1 from engagements e
                     where e.id = engagement_events.engagement_id
                       and e.owner_id = auth.uid()));

create policy engagement_events_select_admin on engagement_events
  for select to authenticated
  using (is_admin()
         and organization_id in (select user_org_ids()));

create policy engagement_events_insert_own on engagement_events
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and organization_id in (select user_org_ids())
    and exists (select 1 from engagements e
                where e.id = engagement_events.engagement_id
                  and e.owner_id = auth.uid()
                  and e.organization_id = engagement_events.organization_id)
  );

-- ---------------------------------------------------------------------------
-- Part E — Update immutability triggers
-- ---------------------------------------------------------------------------

-- businesses: organization_id is immutable after insert.
create or replace function businesses_enforce_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'businesses.owner_id is immutable' using errcode = 'check_violation';
  end if;
  if new.organization_id is distinct from old.organization_id then
    raise exception 'businesses.organization_id is immutable' using errcode = 'check_violation';
  end if;
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'businesses.id and created_at are immutable' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- engagements: organization_id is immutable after insert.
create or replace function engagements_enforce_transitions()
returns trigger
language plpgsql
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'engagements.owner_id is immutable' using errcode = 'check_violation';
  end if;
  if new.business_id is distinct from old.business_id then
    raise exception 'engagements.business_id is immutable' using errcode = 'check_violation';
  end if;
  if new.organization_id is distinct from old.organization_id then
    raise exception 'engagements.organization_id is immutable' using errcode = 'check_violation';
  end if;
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'engagements.id and created_at are immutable' using errcode = 'check_violation';
  end if;
  if old.status = 'completed' and new.status <> 'completed' then
    raise exception 'engagements.status cannot leave the terminal ''completed'' state'
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- scout_intakes: organization_id is a review field (starts null, set during review).
-- No trigger change needed — scout_intakes_enforce_review_only checks intake fields
-- by explicit listing, and organization_id is NOT in that list, so it is automatically
-- allowed to change during review.

-- ---------------------------------------------------------------------------
-- Part F — Policies and grants on new tables
-- ---------------------------------------------------------------------------

-- Organizations: members can read their own org. Writes go through service role
-- (org creation is an admin operation, not a self-service flow for MVP).
create policy organizations_select_member on organizations
  for select to authenticated
  using (id in (select user_org_ids()));

-- Organization members: members can see co-members in their org.
create policy org_members_select on organization_members
  for select to authenticated
  using (organization_id in (select user_org_ids()));

-- Read-only grants for authenticated. Service role handles writes (bypasses RLS).
grant select on organizations to authenticated;
grant select on organization_members to authenticated;

-- ---------------------------------------------------------------------------
-- Part G — Realtime
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table organizations;
alter publication supabase_realtime add table organization_members;
