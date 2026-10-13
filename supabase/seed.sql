-- Local development seed. Loaded by `supabase db reset` when `[db.seed]` is enabled in
-- config.toml (it is), and safe to apply by hand to a running stack:
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/seed.sql
--
-- Every row carries a fixed id and every insert is `on conflict do nothing`, so applying
-- it twice is a no-op. It never ships: `supabase db push` applies migrations only, and the
-- hosted project is seeded by real signups.
--
-- What it gives the UI (see supabase/README.md "Local seed"):
--
--   * one organization, DSSG NYC, that every seeded account belongs to;
--   * five staff accounts promoted to admin (profile role + org membership — the SPA reads
--     the first for the Review Queue link, is_admin() reads the second for every policy);
--   * two client accounts, each owning one business created from an approved Scout intake
--     (Harlem Community Pantry two stages in, Brooklyn Tenants Union at the first), so the
--     Architect path has reviewed intakes to start from and an admin's dashboard shows
--     every partner while each client sees only their own;
--   * two pending Scout intakes (one L2 ready, one L3) for the Review Queue, and one
--     declined intake for the Decisions page.
--
-- Shapes mirror supabase/tests/_shared/fixtures.psql; ids use a different prefix (dd..)
-- so the pgTAP suite's fixture-scoped counts never see these rows.
--
-- Every account signs in with the same local password: dssg-admin-2026
-- (local-only; the stack's keys are fixed dev values and this database is never exposed).

begin;

-- ---------------------------------------------------------------------------
-- Accounts (auth.users + the email identity GoTrue needs for password sign-in)
-- ---------------------------------------------------------------------------
-- handle_new_user (0001_core) fires on each insert and creates the 'client' profile row.
-- The empty-string token columns matter: GoTrue scans them as Go strings and a NULL
-- there fails sign-in with "converting NULL to string is unsupported".

create temp table seed_accounts (id uuid, email text, full_name text, org_role text) on commit drop;
insert into seed_accounts values
  ('dddddddd-0000-0000-0000-000000000001', 'ramsey.wise@gmail.com', 'Ramsey Wise',   'owner'),
  ('dddddddd-0000-0000-0000-000000000002', 'jianyinroachell@gmail.com',      'Jian Roachell',        'admin'),
  ('dddddddd-0000-0000-0000-000000000003', 'tony.j.amodeo@gmail.com',        'Tony Amodeo',          'admin'),
  ('dddddddd-0000-0000-0000-000000000004', 'carlosfc@umich.edu',             'Carlos',               'admin'),
  ('dddddddd-0000-0000-0000-000000000005', 'karthik.chakravartula@gmail.com', 'Karthik Chakravartula', 'admin'),
  -- The clients: one each at the two seeded partner nonprofits. Neither sees the other's rows.
  ('dddddddd-0000-0000-0000-000000000010', 'dana@harlempantry.org', 'Dana Reyes',    'member'),
  ('dddddddd-0000-0000-0000-000000000011', 'priya@bktenants.org',   'Priya Nair',    'member');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
  extensions.crypt('dssg-admin-2026', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', full_name),
  now(), now(), '', '', '', ''
from seed_accounts
on conflict (id) do nothing;

insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select
  gen_random_uuid(), id::text, id,
  jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
  'email', now(), now(), now()
from seed_accounts
on conflict (provider_id, provider) do nothing;

-- ---------------------------------------------------------------------------
-- Staff promotion — the out-of-band operation a real admin goes through
-- ---------------------------------------------------------------------------
-- users.role is immutable to every API role; the seed runs as the database owner, so it
-- can lift the trigger exactly as the pgTAP fixtures do.
alter table users disable trigger user;
update users set role = 'admin'
  where id in (select id from seed_accounts where org_role in ('owner', 'admin'));
alter table users enable trigger user;

-- ---------------------------------------------------------------------------
-- Organization and memberships
-- ---------------------------------------------------------------------------
insert into organizations (id, name) values
  ('dddddddd-0000-0000-0000-00000000aa01', 'DSSG NYC')
on conflict (id) do nothing;

insert into organization_members (organization_id, user_id, role)
select 'dddddddd-0000-0000-0000-00000000aa01', id, org_role from seed_accounts
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Scout intakes
-- ---------------------------------------------------------------------------
-- Two reviewed + approved (one per client), two pending for the queue, one declined. Scores and flags are
-- what src/agents/scout/routing.ts would derive for these answers; routing_source stays
-- 'derived' because no agent run backs them.
insert into scout_intakes (
  id, org_name, contact_name_role, contact_email, mission, scale, primary_need,
  problem_description, current_systems, timeline, referral_source,
  bucket, confidence, rationale, poc_score, clarity_score, foothold_score,
  composite_signal, flags, hitl_tier,
  review_status, review_action, final_bucket, reviewed_by, reviewed_by_email, reviewed_at,
  review_notes, onboarding_kit, organization_id
) values
  (
    'dddddddd-0000-0000-0000-00000000cc01',
    'Harlem Community Pantry', 'Dana Reyes, Executive Director', 'dana@harlempantry.org',
    'We run a food pantry and weekly hot-meal service for families in Central Harlem.',
    'About 400 families a week, 3 staff and 60 volunteers',
    'analyze_data',
    'We log every visit in a spreadsheet but cannot tell our funders which neighborhoods we reach or how demand changes month to month.',
    'Google Sheets, a Mailchimp list and paper sign-in sheets',
    'Before our March grant report', 'Referred by a DSSG volunteer',
    'Analytics & Insight', 'High',
    'Clear reporting need, an engaged executive director and existing visit data make this a strong analytics fit.',
    3, 3, 3, 'Ready', '{}', 'L2',
    'reviewed', 'approved', 'Analytics & Insight',
    'dddddddd-0000-0000-0000-000000000001', 'ramsey.wise@gmail.com', now() - interval '2 days',
    'Approved as submitted.', 'Analytics & Insight Starter Kit',
    'dddddddd-0000-0000-0000-00000000aa01'
  ),
  (
    'dddddddd-0000-0000-0000-00000000cc02',
    'Bronx Youth Coding Collective', 'Marcus Lee, Program Manager', 'marcus@bronxyouthcode.org',
    'After-school coding classes for middle schoolers in the South Bronx.',
    'About 250 students a year across 4 schools',
    'build_tool',
    'Attendance and progress live in six different spreadsheets, one per instructor, and we re-key everything for the board each quarter.',
    'Google Sheets and Airtable', 'Next semester', 'Web search',
    'Tooling & Automation', 'High',
    'A concrete workflow pain with named systems and a committed point of contact.',
    3, 3, 2, 'Ready', '{}', 'L2',
    'pending', null, null, null, null, null, null, null,
    null
  ),
  (
    'dddddddd-0000-0000-0000-00000000cc03',
    'Queens Neighborhood Kitchen', 'Sam', 'sam@qnkitchen.org',
    'Community meals.',
    'All-volunteer, 2 people, ~50 families/year',
    'strategy_guidance',
    'We want to understand our community better and use data more.',
    'Just a shared Google spreadsheet.', 'Not sure yet.', 'Instagram',
    'Advisory / Strategy', 'Low',
    'The description does not point to one area, and a two-person volunteer org on a single spreadsheet is better served starting in Advisory / Strategy.',
    1, 2, 1, 'Not Ready',
    '{"Vague problem description","Small org + minimal systems — routed to Advisory regardless of stated ask"}',
    'L3',
    'pending', null, null, null, null, null, null, null,
    null
  ),
  (
    'dddddddd-0000-0000-0000-00000000cc04',
    'Brooklyn Tenants Union', 'Priya Nair, Organizing Director', 'priya@bktenants.org',
    'We organize tenant associations in Bushwick and Bed-Stuy and track housing-code complaints.',
    'About 1,200 households across 40 buildings, 5 staff',
    'build_tool',
    'Complaints come in by text, email and paper and we lose track of which ones the city has answered.',
    'A shared Gmail inbox, Google Sheets and 311 export CSVs',
    'Before the summer heat season', 'Referred by Harlem Community Pantry',
    'Tooling & Automation', 'High',
    'A clear intake-tracking workflow, named systems and a committed organizer make this a strong tooling fit.',
    3, 3, 2, 'Ready', '{}', 'L2',
    'reviewed', 'approved', 'Tooling & Automation',
    'dddddddd-0000-0000-0000-000000000003', 'tony.j.amodeo@gmail.com', now() - interval '5 days',
    'Approved; start with the complaint tracker.', 'Tooling & Automation Starter Kit',
    'dddddddd-0000-0000-0000-00000000aa01'
  ),
  (
    'dddddddd-0000-0000-0000-00000000cc05',
    'Staten Island Dog Rescue', 'Jo Marino, Founder', 'jo@sidogrescue.org',
    'We foster and rehome dogs on Staten Island.',
    'Volunteer-run, about 80 adoptions a year',
    'ml_predictive',
    'We would like an AI that tells us which dogs will get adopted fastest.',
    'A Facebook page and a notebook.', 'Whenever', 'Instagram',
    'ML / Predictive', 'Low',
    'The stated ask is predictive, but there is no recorded data to learn from and no system to build on; the description is thin.',
    2, 2, 1, 'Conditional',
    '{"Low foothold: no data system to build on"}',
    'L3',
    'reviewed', 'redirected', 'Advisory / Strategy',
    'dddddddd-0000-0000-0000-000000000002', 'jianyinroachell@gmail.com', now() - interval '3 days',
    'Nothing recorded to work from yet. Suggested they log adoptions in a sheet for six months and come back.', 'Advisory / Strategy Starter Kit',
    'dddddddd-0000-0000-0000-00000000aa01'
  )
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- The clients' businesses and engagements
-- ---------------------------------------------------------------------------
-- scout_intake_id is normally written only by approve_scout_intake(); the guard trigger
-- lets the database owner through, which is what the seed runs as.
insert into businesses (id, name, type, industry, address, owner_id, certified, organization_id, scout_intake_id) values
  ('dddddddd-0000-0000-0000-00000000bb01', 'Harlem Community Pantry', 'nonprofit', 'Food Security',
   '2110 Adam Clayton Powell Jr Blvd, New York, NY 10027',
   'dddddddd-0000-0000-0000-000000000010', true,
   'dddddddd-0000-0000-0000-00000000aa01', 'dddddddd-0000-0000-0000-00000000cc01'),
  ('dddddddd-0000-0000-0000-00000000bb02', 'Brooklyn Tenants Union', 'nonprofit', 'Housing',
   '1456 Broadway, Brooklyn, NY 11221',
   'dddddddd-0000-0000-0000-000000000011', false,
   'dddddddd-0000-0000-0000-00000000aa01', 'dddddddd-0000-0000-0000-00000000cc04')
on conflict (id) do nothing;

insert into engagements (id, business_id, owner_id, stage, status, notes, budget_amount, organization_id) values
  ('dddddddd-0000-0000-0000-00000000ee01', 'dddddddd-0000-0000-0000-00000000bb01',
   'dddddddd-0000-0000-0000-000000000010', 'initial_meeting', 'completed',
   'Kickoff held with Dana; visit log and funder template shared.', null,
   'dddddddd-0000-0000-0000-00000000aa01'),
  ('dddddddd-0000-0000-0000-00000000ee02', 'dddddddd-0000-0000-0000-00000000bb01',
   'dddddddd-0000-0000-0000-000000000010', 'budget_check', 'in_progress',
   null, 12500,
   'dddddddd-0000-0000-0000-00000000aa01'),
  ('dddddddd-0000-0000-0000-00000000ee03', 'dddddddd-0000-0000-0000-00000000bb02',
   'dddddddd-0000-0000-0000-000000000011', 'initial_meeting', 'in_progress',
   'Kickoff scheduled with Priya for next week.', null,
   'dddddddd-0000-0000-0000-00000000aa01')
on conflict (id) do nothing;

insert into engagement_events (id, engagement_id, organization_id, kind, detail, created_by, created_at) values
  ('dddddddd-0000-0000-0000-00000000ef01', 'dddddddd-0000-0000-0000-00000000ee01',
   'dddddddd-0000-0000-0000-00000000aa01', 'note_added',
   '{"text": "Dana will export the last 12 months of visit logs before the next call."}',
   'dddddddd-0000-0000-0000-000000000001', now() - interval '1 day')
on conflict (id) do nothing;

commit;
