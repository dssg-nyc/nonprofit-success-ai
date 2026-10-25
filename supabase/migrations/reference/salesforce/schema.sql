-- Salesforce stand-in — LOCAL ONLY. Not a migration; never pushed to the hosted project.
--
-- Salesforce (Agentforce Nonprofit, formerly Nonprofit Cloud) is the source of truth for
-- relationship data: accounts, contacts, affiliations, campaigns, gifts, volunteers
-- (NPS #52). Supabase keeps the operational state and stores only Salesforce ids
-- (`salesforce_id` domain, 0001_core). Until the real integration exists, this schema
-- plays the Salesforce org: the same objects, the same id shapes, fake rows
-- (supabase/migrations/reference/salesforce/seed.sql), and the two calls the app makes, as RPCs:
--
--   salesforce.upsert_applicant(...)  the two-stage recording's first stage: upsert the
--                                     applicant Account (matched by EIN) and its primary
--                                     Contact, both flagged unverified; return the ids.
--   salesforce.get_contacts(ids)      read Contacts back by id, for staff.
--
-- api/_salesforce.ts is the only caller. When the integration lands, that adapter
-- switches to the Salesforce REST API (an integration user, server-side) and this file
-- is deleted; nothing in public.* changes, because nothing there references this schema.
--
-- Loaded by `supabase db reset` / `supabase start` through config.toml [db.seed]
-- (sql_paths), after the migrations. `supabase db push` applies migrations only, so the
-- hosted project never has it — there, /api/route-intake fails with 502
-- (salesforce_unavailable) until the adapter talks to the real org.
--
-- Naming: snake_case columns, each commented with the Salesforce API name it stands for.
-- Ids are 18-character Salesforce ids with the real key prefix where the object is
-- standard (001 Account, 003 Contact, 07k AccountContactRelation, 701 Campaign). Nonprofit
-- Cloud objects get their prefix from the org; the stand-in uses `0gT` (GiftTransaction)
-- and `0vI` (VolunteerInitiative) — placeholders, confirmed in #52 Phase 1.

create schema if not exists salesforce;
comment on schema salesforce is
  'LOCAL-ONLY Salesforce stand-in (supabase/migrations/reference/salesforce/). Not a migration; the hosted project has no such schema.';

-- An 18-char id: the key prefix and 15 random alphanumerics. Real ids encode the org
-- and a checksum; nothing in the app reads more than the prefix.
create or replace function salesforce.new_id(p_prefix text)
returns text
language sql
volatile
as $$
  select p_prefix || upper(substr(md5(gen_random_uuid()::text), 1, 15));
$$;

-- ---------------------------------------------------------------------------
-- Account — organizations (nonprofits/NGOs, and DSSG NYC itself)
-- ---------------------------------------------------------------------------
create table salesforce.account (
  id                   text primary key default salesforce.new_id('001'),   -- Id
  name                 text not null,                                       -- Name
  ein                  text,                                                -- EIN__c (digits only)
  record_type          text not null default 'Organization'                 -- RecordType.DeveloperName
                       check (record_type in ('Organization', 'Household')),
  -- Two-stage recording (#52): an applicant is created unverified at intake, and approval
  -- is a status change on the same record, never a second Account.
  applicant_status     text not null default 'Unverified Applicant'         -- Applicant_Status__c
                       check (applicant_status in ('Unverified Applicant', 'Active Client', 'Declined', 'Not Applicable')),
  registry_source      text,                                                -- Registry_Source__c ('ProPublica' | 'Manual')
  billing_street       text,                                                -- BillingStreet
  billing_city         text,                                                -- BillingCity
  billing_state        text,                                                -- BillingState
  billing_postal_code  text,                                                -- BillingPostalCode
  phone                text,                                                -- Phone
  website              text,                                                -- Website
  ntee_code            text,                                                -- NTEE_Code__c
  created_date         timestamptz not null default now(),                  -- CreatedDate
  last_modified_date   timestamptz not null default now()                   -- LastModifiedDate
);
create unique index account_ein_key on salesforce.account (ein) where ein is not null;

-- ---------------------------------------------------------------------------
-- Contact — people: applicant contacts, volunteers, donors, staff
-- ---------------------------------------------------------------------------
create table salesforce.contact (
  id                   text primary key default salesforce.new_id('003'),   -- Id
  account_id           text references salesforce.account (id),             -- AccountId (primary affiliation)
  first_name           text,                                                -- FirstName
  last_name            text not null,                                       -- LastName
  title                text,                                                -- Title
  email                text,                                                -- Email
  phone                text,                                                -- Phone
  lead_source          text,                                                -- LeadSource ('Scout Intake', 'Volunteer Form', 'Givebutter', ...)
  contact_type         text not null default 'Applicant Contact'            -- Contact_Type__c
                       check (contact_type in ('Applicant Contact', 'Partner Contact', 'Volunteer', 'Donor', 'Staff')),
  email_verified       boolean not null default false,                      -- Email_Verified__c
  created_date         timestamptz not null default now(),                  -- CreatedDate
  last_modified_date   timestamptz not null default now()                   -- LastModifiedDate
);
create unique index contact_email_key on salesforce.contact (lower(email)) where email is not null;

-- ---------------------------------------------------------------------------
-- AccountContactRelation — affiliations (a Contact's roles at an Account)
-- ---------------------------------------------------------------------------
create table salesforce.account_contact_relation (
  id                   text primary key default salesforce.new_id('07k'),   -- Id
  account_id           text not null references salesforce.account (id),    -- AccountId
  contact_id           text not null references salesforce.contact (id),    -- ContactId
  roles                text,                                                -- Roles (multi-select, ';'-joined)
  is_primary           boolean not null default false,                      -- IsPrimary__c
  is_active            boolean not null default true,                       -- IsActive
  unique (account_id, contact_id)
);

-- ---------------------------------------------------------------------------
-- Campaign — fundraising and outreach campaigns (Givebutter campaigns map here)
-- ---------------------------------------------------------------------------
create table salesforce.campaign (
  id                   text primary key default salesforce.new_id('701'),   -- Id
  name                 text not null,                                       -- Name
  type                 text,                                                -- Type ('Fundraising', 'Volunteer Drive', ...)
  status               text not null default 'Planned',                     -- Status
  start_date           date,                                                -- StartDate
  end_date             date,                                                -- EndDate
  givebutter_campaign_id text                                               -- Givebutter_Campaign_Id__c
);

-- ---------------------------------------------------------------------------
-- GiftTransaction — donations (Fundraising). Card data never reaches Salesforce.
-- ---------------------------------------------------------------------------
create table salesforce.gift_transaction (
  id                   text primary key default salesforce.new_id('0gT'),   -- Id
  donor_id             text not null references salesforce.contact (id),    -- DonorId
  campaign_id          text references salesforce.campaign (id),            -- CampaignId
  original_amount      numeric(12, 2) not null check (original_amount >= 0),-- OriginalAmount
  currency_iso_code    text not null default 'USD',                         -- CurrencyIsoCode
  transaction_date     date not null,                                       -- TransactionDate
  status               text not null default 'Paid'                         -- Status
                       check (status in ('Paid', 'Pending', 'Refunded', 'Failed')),
  givebutter_transaction_id text unique                                     -- Givebutter_Transaction_Id__c (idempotency)
);

-- ---------------------------------------------------------------------------
-- VolunteerInitiative + volunteer roster (Volunteer Management). The roster stands in
-- for the position/shift objects, whose exact set is confirmed in #52 Phase 1.
-- ---------------------------------------------------------------------------
create table salesforce.volunteer_initiative (
  id                   text primary key default salesforce.new_id('0vI'),   -- Id
  name                 text not null,                                       -- Name
  status               text not null default 'Active',                      -- Status
  start_date           date,                                                -- StartDate
  end_date             date,                                                -- EndDate
  partner_account_id   text references salesforce.account (id)              -- Partner_Account__c
);

create table salesforce.volunteer_assignment (
  initiative_id        text not null references salesforce.volunteer_initiative (id),
  contact_id           text not null references salesforce.contact (id),
  role                 text,
  primary key (initiative_id, contact_id)
);

-- No API role touches the tables: the stand-in is reached only through its RPCs, the way
-- the real org is reached only through the integration user.
do $$
declare t text;
begin
  foreach t in array array['account', 'contact', 'account_contact_relation', 'campaign',
                           'gift_transaction', 'volunteer_initiative', 'volunteer_assignment']
  loop
    execute format('alter table salesforce.%I enable row level security', t);
    execute format('revoke all on salesforce.%I from public, anon, authenticated', t);
  end loop;
end $$;

grant usage on schema salesforce to anon, authenticated;
revoke execute on function salesforce.new_id(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- salesforce.upsert_applicant(org_name, ein, contact_name_role, contact_email) -> jsonb
--
-- Stage one of the two-stage recording (#52 flow 2). Idempotent, like the real upsert
-- on an external id: the Account matches by normalized EIN (else by name among
-- unverified applicants), the Contact by email; a resubmission returns the same ids and
-- refreshes the contact's name and title. `contact_name_role` is the form's one field
-- ("Dana Reyes, Executive Director"): the part before the first comma is the name,
-- the rest the title.
--
-- Returns { "account_id": '001…', "contact_id": '003…' }. 22023 on a blank org or email.
-- ---------------------------------------------------------------------------
create or replace function salesforce.upsert_applicant(
  p_org_name text,
  p_ein text,
  p_contact_name_role text,
  p_contact_email text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = salesforce, pg_temp
as $$
declare
  v_ein     text := nullif(regexp_replace(coalesce(p_ein, ''), '\D', '', 'g'), '');
  v_name    text := btrim(coalesce(p_org_name, ''));
  v_email   text := lower(btrim(coalesce(p_contact_email, '')));
  v_person  text := btrim(split_part(coalesce(p_contact_name_role, ''), ',', 1));
  v_title   text := nullif(btrim(substr(coalesce(p_contact_name_role, ''),
                                        length(split_part(coalesce(p_contact_name_role, ''), ',', 1)) + 2)), '');
  v_first   text;
  v_last    text;
  v_account text;
  v_contact text;
begin
  if v_name = '' or v_email = '' then
    raise exception 'upsert_applicant: org name and email are required' using errcode = '22023';
  end if;
  if v_person = '' then
    v_person := split_part(v_email, '@', 1);
  end if;
  -- LastName is required in Salesforce; a single word is a last name.
  if position(' ' in v_person) > 0 then
    v_first := regexp_replace(v_person, '\s+\S+$', '');
    v_last  := regexp_replace(v_person, '^.*\s', '');
  else
    v_last := v_person;
  end if;

  if v_ein is not null then
    select id into v_account from account where ein = v_ein;
  end if;
  if v_account is null then
    select id into v_account from account
     where lower(name) = lower(v_name) and applicant_status = 'Unverified Applicant'
       and (ein is null or v_ein is null)
     order by created_date
     limit 1;
  end if;
  if v_account is null then
    insert into account (name, ein, registry_source)
    values (v_name, v_ein, case when v_ein is not null then 'ProPublica' else 'Manual' end)
    returning id into v_account;
  else
    update account
       set ein = coalesce(ein, v_ein), last_modified_date = now()
     where id = v_account;
  end if;

  select id into v_contact from contact where lower(email) = v_email;
  if v_contact is null then
    insert into contact (account_id, first_name, last_name, title, email, lead_source)
    values (v_account, v_first, v_last, v_title, v_email, 'Scout Intake')
    returning id into v_contact;
  else
    update contact
       set first_name = v_first, last_name = v_last, title = coalesce(v_title, title),
           last_modified_date = now()
     where id = v_contact;
  end if;

  insert into account_contact_relation (account_id, contact_id, roles, is_primary)
  values (v_account, v_contact, coalesce(v_title, 'Applicant Contact'), true)
  on conflict (account_id, contact_id) do nothing;

  return jsonb_build_object('account_id', v_account, 'contact_id', v_contact);
end;
$$;

comment on function salesforce.upsert_applicant(text, text, text, text) is
  'Stand-in for the Salesforce applicant upsert (#52): unverified Account by EIN + primary Contact by email; returns their ids.';

-- The intake route calls it with the visitor's anonymous session, as it calls
-- submit_scout_intake(). The real adapter will hold a server-side integration credential
-- instead; the visitor's token never reaches Salesforce.
revoke all on function salesforce.upsert_applicant(text, text, text, text) from public;
grant execute on function salesforce.upsert_applicant(text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- salesforce.get_contacts(ids) -> setof rows
--
-- Reads Contacts back by id for staff — the review queue's "who applied" until the real
-- read path exists. Admin only (public.is_admin(), 0001_core): a contact is PII.
-- ---------------------------------------------------------------------------
create or replace function salesforce.get_contacts(p_ids text[])
returns table (
  id text,
  account_id text,
  first_name text,
  last_name text,
  title text,
  email text
)
language plpgsql
stable
security definer
set search_path = salesforce, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'get_contacts: admin only' using errcode = '42501';
  end if;
  return query
    select c.id, c.account_id, c.first_name, c.last_name, c.title, c.email
      from contact c
     where c.id = any (p_ids);
end;
$$;

comment on function salesforce.get_contacts(text[]) is
  'Stand-in for a Salesforce Contact read by id. Admin only.';

revoke all on function salesforce.get_contacts(text[]) from public, anon;
grant execute on function salesforce.get_contacts(text[]) to authenticated;
