-- The Salesforce stand-in (supabase/migrations/reference/salesforce/schema.sql, NPS #28 / #52): the PII the app
-- tables no longer hold lives here, reachable only through its two RPCs. LOCAL ONLY — the
-- hosted project has no `salesforce` schema — so this file guards the shape the adapter
-- (api/_salesforce.ts) depends on, not production.

\ir _shared/fixtures.psql

select plan(12);

-- ---------------------------------------------------------------------------
-- No direct reads: every table is closed to the API roles
-- ---------------------------------------------------------------------------

select tests.logout();

select throws_ok(
  $$ select id from salesforce.contact $$,
  '42501',
  null,
  'anon cannot read salesforce.contact'
);

select tests.login_as(:admin_id);

select throws_ok(
  $$ select id from salesforce.contact $$,
  '42501',
  null,
  'not even an admin reads salesforce.contact directly — only through get_contacts()'
);

select throws_ok(
  $$ select salesforce.new_id('003') $$,
  '42501',
  null,
  'new_id() is internal to the stand-in'
);

-- ---------------------------------------------------------------------------
-- upsert_applicant — stage one of the two-stage recording (#52)
-- ---------------------------------------------------------------------------

select tests.login_anonymous(:anon_user_id);

create temp table sf_first on commit drop as
  select salesforce.upsert_applicant('Pgtap Applicant Org', '13-9999999',
                                     'Ana Maria Ruiz, Board Chair', 'Ana@Example.org') as r;
grant select on sf_first to authenticated;

select matches(
  (select r ->> 'account_id' from sf_first),
  '^001[a-zA-Z0-9]{15}$',
  'the anonymous intake session gets an Account id (001) back'
);

select matches(
  (select r ->> 'contact_id' from sf_first),
  '^003[a-zA-Z0-9]{15}$',
  'and a Contact id (003)'
);

select is(
  salesforce.upsert_applicant('Pgtap Applicant Org', '139999999',
                              'Ana Maria Ruiz, Board Chair', 'ana@example.org'),
  (select r from sf_first),
  'a resubmission (same EIN, same email in another case) returns the same ids'
);

select throws_ok(
  $$ select salesforce.upsert_applicant('Pgtap Org', null, 'Someone', '  ') $$,
  '22023',
  null,
  'a blank email is refused'
);

reset role;

select results_eq(
  $$ select c.first_name, c.last_name, c.title, c.email, a.applicant_status, a.ein
       from salesforce.contact c join salesforce.account a on a.id = c.account_id
      where c.id = (select r ->> 'contact_id' from sf_first) $$,
  $$ values ('Ana Maria'::text, 'Ruiz'::text, 'Board Chair'::text, 'ana@example.org'::text,
             'Unverified Applicant'::text, '139999999'::text) $$,
  'the form''s "Name, Role" splits on the first comma; the Account is an unverified applicant'
);

select is(
  (select count(*)::int from salesforce.account_contact_relation
    where contact_id = (select r ->> 'contact_id' from sf_first) and is_primary),
  1,
  'one primary relation, however many times the applicant resubmits'
);

-- ---------------------------------------------------------------------------
-- get_contacts — staff read path, admin only
-- ---------------------------------------------------------------------------

select tests.logout();

select throws_ok(
  $$ select * from salesforce.get_contacts(array['003DS0000000001AAA']) $$,
  '42501',
  null,
  'anon cannot call get_contacts()'
);

select tests.login_as(:alice_id);

select throws_ok(
  $$ select * from salesforce.get_contacts(array['003DS0000000001AAA']) $$,
  '42501',
  null,
  'a member who is not an admin cannot read contacts'
);

select tests.login_as(:admin_id);

select is(
  (select email from salesforce.get_contacts(array[(select r ->> 'contact_id' from sf_first)])),
  'ana@example.org',
  'an admin reads a contact back by id'
);

select * from finish();

rollback;
