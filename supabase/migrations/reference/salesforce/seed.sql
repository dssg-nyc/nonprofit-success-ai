-- Salesforce stand-in rows — LOCAL ONLY, all fictional (example.org addresses, 555
-- numbers). Loaded after schema.sql by config.toml [db.seed]; never pushed.
--
-- The ids are fixed so Supabase rows can point at them: supabase/seed.sql (git-ignored)
-- and the test fixtures file intakes and businesses against these Accounts/Contacts.
--   001DS000000000{0..5}AAA  Accounts   (0 = DSSG NYC; 1–5 the partner applicants)
--   003DS000000000{1..5}AAA  their primary Contacts
--   003DS00000000V{1..3}AAA  volunteers · 003DS00000000D{1..2}AAA donors
-- New applicants filed through the app get random ids from upsert_applicant().

begin;

insert into salesforce.account
  (id, name, ein, applicant_status, registry_source, billing_street, billing_city,
   billing_state, billing_postal_code, phone, website, ntee_code)
values
  ('001DS0000000000AAA', 'DSSG NYC', null, 'Not Applicable', 'Manual',
   '1 Example Plaza', 'New York', 'NY', '10001', '212-555-0100', 'https://dssg.example.org', null),
  ('001DS0000000001AAA', 'Harlem Community Pantry', '131111111', 'Active Client', 'ProPublica',
   '100 Example Ave', 'New York', 'NY', '10027', '212-555-0101', 'https://pantry.example.org', 'K31'),
  ('001DS0000000002AAA', 'Bronx Youth Coding Collective', '132222222', 'Unverified Applicant', 'ProPublica',
   '200 Example St', 'Bronx', 'NY', '10451', '718-555-0102', 'https://bxcode.example.org', 'B90'),
  ('001DS0000000003AAA', 'Queens Neighborhood Kitchen', null, 'Unverified Applicant', 'Manual',
   null, 'Queens', 'NY', null, null, null, null),
  ('001DS0000000004AAA', 'Brooklyn Tenants Union', '134444444', 'Active Client', 'ProPublica',
   '400 Example Blvd', 'Brooklyn', 'NY', '11221', '718-555-0104', 'https://tenants.example.org', 'L80'),
  ('001DS0000000005AAA', 'Staten Island Dog Rescue', '135555555', 'Declined', 'ProPublica',
   null, 'Staten Island', 'NY', '10301', null, null, 'D20')
on conflict (id) do nothing;

insert into salesforce.contact
  (id, account_id, first_name, last_name, title, email, phone, lead_source, contact_type, email_verified)
values
  ('003DS0000000001AAA', '001DS0000000001AAA', 'Dana',  'Reyes',  'Executive Director', 'dana@pantry.example.org',  '212-555-0111', 'Scout Intake', 'Partner Contact',   true),
  ('003DS0000000002AAA', '001DS0000000002AAA', 'Marcus','Lee',    'Program Manager',    'marcus@bxcode.example.org', null,          'Scout Intake', 'Applicant Contact', false),
  ('003DS0000000003AAA', '001DS0000000003AAA', null,    'Sam',    null,                 'sam@kitchen.example.org',   null,          'Scout Intake', 'Applicant Contact', false),
  ('003DS0000000004AAA', '001DS0000000004AAA', 'Priya', 'Nair',   'Organizing Director','priya@tenants.example.org', '718-555-0114', 'Scout Intake', 'Partner Contact',   true),
  ('003DS0000000005AAA', '001DS0000000005AAA', 'Jo',    'Marino', 'Founder',            'jo@dogrescue.example.org',  null,          'Scout Intake', 'Applicant Contact', false),
  ('003DS00000000V1AAA', '001DS0000000000AAA', 'Alex',  'Kim',    null,                 'alex.kim@example.org',      null,          'Volunteer Form', 'Volunteer', true),
  ('003DS00000000V2AAA', '001DS0000000000AAA', 'Bea',   'Okafor', null,                 'bea.okafor@example.org',    null,          'Volunteer Form', 'Volunteer', true),
  ('003DS00000000V3AAA', '001DS0000000000AAA', 'Chen',  'Wu',     null,                 'chen.wu@example.org',       null,          'Volunteer Form', 'Volunteer', true),
  ('003DS00000000D1AAA', null,                 'Riley', 'Morgan', null,                 'riley.morgan@example.org',  null,          'Givebutter',     'Donor',     true),
  ('003DS00000000D2AAA', null,                 'Sky',   'Patel',  null,                 'sky.patel@example.org',     null,          'Givebutter',     'Donor',     true)
on conflict (id) do nothing;

insert into salesforce.account_contact_relation (id, account_id, contact_id, roles, is_primary)
values
  ('07kDS0000000001AAA', '001DS0000000001AAA', '003DS0000000001AAA', 'Executive Director', true),
  ('07kDS0000000002AAA', '001DS0000000002AAA', '003DS0000000002AAA', 'Program Manager',    true),
  ('07kDS0000000003AAA', '001DS0000000003AAA', '003DS0000000003AAA', 'Applicant Contact',  true),
  ('07kDS0000000004AAA', '001DS0000000004AAA', '003DS0000000004AAA', 'Organizing Director', true),
  ('07kDS0000000005AAA', '001DS0000000005AAA', '003DS0000000005AAA', 'Founder',            true),
  ('07kDS00000000V1AAA', '001DS0000000000AAA', '003DS00000000V1AAA', 'Data Diplomat',      false),
  ('07kDS00000000V2AAA', '001DS0000000000AAA', '003DS00000000V2AAA', 'Data Diplomat',      false),
  ('07kDS00000000V3AAA', '001DS0000000000AAA', '003DS00000000V3AAA', 'Data Diplomat',      false)
on conflict (id) do nothing;

insert into salesforce.campaign (id, name, type, status, start_date, end_date, givebutter_campaign_id)
values
  ('701DS0000000001AAA', 'Fall 2026 Appeal', 'Fundraising', 'In Progress', '2026-09-01', '2026-12-31', 'gb-camp-example-1'),
  ('701DS0000000002AAA', 'Data Diplomats Cohort 3', 'Volunteer Drive', 'Completed', '2026-06-01', '2026-07-15', null)
on conflict (id) do nothing;

insert into salesforce.gift_transaction
  (id, donor_id, campaign_id, original_amount, transaction_date, status, givebutter_transaction_id)
values
  ('0gTDS0000000001AAA', '003DS00000000D1AAA', '701DS0000000001AAA', 100.00, '2026-09-14', 'Paid',     'gb-txn-example-1'),
  ('0gTDS0000000002AAA', '003DS00000000D2AAA', '701DS0000000001AAA',  25.00, '2026-10-02', 'Paid',     'gb-txn-example-2'),
  ('0gTDS0000000003AAA', '003DS00000000D1AAA', '701DS0000000001AAA',  50.00, '2026-10-20', 'Refunded', 'gb-txn-example-3')
on conflict (id) do nothing;

insert into salesforce.volunteer_initiative (id, name, status, start_date, end_date, partner_account_id)
values
  ('0vIDS0000000001AAA', 'Harlem Pantry reporting dashboard', 'Active', '2026-10-01', '2026-12-15', '001DS0000000001AAA'),
  ('0vIDS0000000002AAA', 'Tenants Union complaint tracker',   'Planned', '2026-11-01', null,        '001DS0000000004AAA')
on conflict (id) do nothing;

insert into salesforce.volunteer_assignment (initiative_id, contact_id, role)
values
  ('0vIDS0000000001AAA', '003DS00000000V1AAA', 'Lead'),
  ('0vIDS0000000001AAA', '003DS00000000V2AAA', 'Analyst'),
  ('0vIDS0000000002AAA', '003DS00000000V3AAA', 'Lead')
on conflict do nothing;

commit;
