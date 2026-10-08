-- Core tables: provisioning, default deny, scout_intakes, users, organizations,
-- businesses, engagements (immutability + terminal lock), staff access, engagement_events,
-- architect_assessments, the routine-privilege allow-list and routing provenance.
-- One assertion per allow/deny branch in firestore.rules (`rules:NN`).

\ir _shared/fixtures.psql

select plan(105);

-- user provisioning — the auth.users trigger
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select role::text from users where id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values ('client'::text) $$,
  'a signup gets a public.users profile with role = client (provisioning trigger)'
);

-- Two statements, not a CTE: rows written by the AFTER trigger are not visible to the
-- statement that fired it.
insert into auth.users (id, email, raw_user_meta_data)
values ('66666666-6666-6666-6666-666666666666', 'eve@example.org',
        '{"role": "admin", "full_name": "Eve"}'::jsonb);

select results_eq(
  $$ select role::text, display_name from users
      where id = '66666666-6666-6666-6666-666666666666' $$,
  $$ values ('client'::text, 'Eve'::text) $$,
  'signup metadata cannot choose the role, but does carry the name (provisioning trigger)'
);

-- The public intake form's anonymous sign-in (seeded above) is a token, not a member.
select is(
  (select count(*)::int from users where id = :anon_user_id),
  0,
  'an anonymous sign-in creates no public.users profile (0001_core)'
);

-- ---------------------------------------------------------------------------
-- Default deny — rules:5-7
-- ---------------------------------------------------------------------------

select tests.logout();

-- `anon` holds no SELECT privilege on users at all (see the grants block in the init
-- migration), so this is denied by privilege before RLS is ever consulted and raises
-- 42501 rather than returning zero rows. That is strictly stronger than the empty result
-- rules:5-7 asks for; PostgREST surfaces it as HTTP 401.
select throws_ok(
  $$ select id from users $$,
  '42501',
  null,
  'anon cannot read users (default deny, rules:5-7)'
);

select throws_ok(
  $$ insert into users (id, email, role)
     values ('55555555-5555-5555-5555-555555555555', 'x@example.org', 'admin') $$,
  '42501',
  null,
  'anon cannot create a user row'
);

-- ---------------------------------------------------------------------------
-- scout_intakes — the public intake. rules:182-193
-- ---------------------------------------------------------------------------

-- 0007 closed the direct door: the public form's row is written by submit_scout_intake(),
-- the only writer, so no role holds INSERT on the table any more (rules:184 still holds —
-- a prospective org with no account can file an intake — through the RPC).
select throws_ok(
  $$ select tests.intake_values('dddddddd-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'anon cannot insert an intake row directly (0007: submit_scout_intake is the only writer)'
);

select lives_ok(
  $$ select submit_scout_intake(tests.intake_payload()) $$,
  'anon CAN file a pending intake through submit_scout_intake (rules:184 — the public form)'
);

-- anon can INSERT here but holds no SELECT privilege, so a read-back is refused at the
-- privilege gate (42501) rather than filtered to empty by RLS. Write-only is exactly what
-- rules:183 wants for a public form: submit, never read another applicant's PII.
select throws_ok(
  $$ select id from scout_intakes $$,
  '42501',
  null,
  'anon cannot read intakes back, not even its own (rules:183 — applicant PII)'
);

select throws_ok(
  $$ insert into scout_intakes (
       id, org_name, contact_name_role, contact_email, mission, scale, primary_need,
       problem_description, current_systems, timeline, referral_source,
       rationale, poc_score, clarity_score, foothold_score, composite_signal, hitl_tier,
       review_status, review_action, final_bucket
     ) values (
       'dddddddd-0000-0000-0000-000000000002', 'Sneaky Org', 'X', 'x@example.org', 'M',
       'S', 'build_tool', 'P', 'C', 'T', 'R', 'Rat', 2, 2, 2, 'Conditional', 'L3',
       'reviewed', 'approved', 'ML / Predictive'
     ) $$,
  '42501',
  null,
  'anon cannot self-approve by inserting an already-reviewed intake (rules:92,188)'
);

select throws_ok(
  $$ update scout_intakes set review_status = 'reviewed'
     where id = 'cccccccc-0000-0000-0000-000000000001' $$,
  null,
  null,
  'anon cannot update an intake (rules:185 — admin only)'
);

-- The intake form's anonymous session (0001_core): a token for /api/route-intake, nothing
-- more. It gets what anon gets — one pending intake — and no reads, no reviews.
select tests.login_anonymous(:anon_user_id);

select throws_ok(
  $$ select tests.intake_values('dddddddd-0000-0000-0000-000000000003') $$,
  '42501',
  null,
  'an anonymous session cannot insert an intake row directly (0007)'
);

select lives_ok(
  $$ select submit_scout_intake(tests.intake_payload()) $$,
  'an anonymous session CAN file a pending intake through submit_scout_intake (the public form, signed in)'
);

select is_empty(
  $$ select id from scout_intakes $$,
  'an anonymous session reads no intakes, not even its own'
);

select is(
  tests.affected(
    $$ update scout_intakes set review_status = 'reviewed', review_action = 'approved',
       final_bucket = 'ML / Predictive'
       where id = 'cccccccc-0000-0000-0000-000000000001' $$
  ),
  0,
  'an anonymous session cannot review an intake'
);

-- A signed-in non-admin is no better off than anon here.
select tests.login_as(:alice_id);

select is_empty(
  $$ select id from scout_intakes $$,
  'a signed-in non-admin cannot read intakes (rules:183)'
);

-- RLS denies an UPDATE by making the row invisible, not by raising: the statement matches
-- zero rows and "succeeds". Asserting the affected-row count is what proves the denial —
-- and unlike throws_ok, it also proves nothing was modified.
select is(
  tests.affected(
    $$ update scout_intakes set review_status = 'reviewed', review_action = 'approved',
              final_bucket = 'ML / Predictive'
        where id = 'cccccccc-0000-0000-0000-000000000001' $$),
  0,
  'a non-admin cannot review an intake (rules:185)'
);

-- Admin path. is_admin() is true here via the 'owner' org membership (0001_core).
select tests.login_as(:admin_id);

select isnt_empty(
  $$ select id from scout_intakes where id = 'cccccccc-0000-0000-0000-000000000001' $$,
  'an admin CAN read intakes (rules:183)'
);

select lives_ok(
  $$ update scout_intakes
        set review_status = 'reviewed',
            review_action = 'approved',
            final_bucket  = 'Analytics & Insight',
            reviewed_by   = '33333333-3333-3333-3333-333333333333',
            reviewed_by_email = 'admin@dssg.nyc',
            reviewed_at   = now(),
            -- 0001_core: review also assigns the intake to the reviewer's org (null -> org).
            organization_id = 'eeeeeeee-0000-0000-0000-000000000001'
      where id = 'cccccccc-0000-0000-0000-000000000001' $$,
  'an admin CAN review an intake and assign it to their org (rules:185-191, 0001_core)'
);

select throws_ok(
  $$ update scout_intakes set org_name = 'Rewritten Org'
     where id = 'cccccccc-0000-0000-0000-000000000001' $$,
  null,
  null,
  'even an admin cannot rewrite the applicant''s own answers (rules:187 hasOnly)'
);

select throws_ok(
  $$ update scout_intakes set reviewed_by = '11111111-1111-1111-1111-111111111111'
     where id = 'cccccccc-0000-0000-0000-000000000001' $$,
  null,
  null,
  'reviewed_by must be the acting admin (rules:191)'
);

select throws_ok(
  $$ delete from scout_intakes where id = 'cccccccc-0000-0000-0000-000000000001' $$,
  null,
  null,
  'nobody can delete an intake — audit trail (rules:192)'
);

-- ---------------------------------------------------------------------------
-- users — rules:96-102
-- ---------------------------------------------------------------------------

select tests.login_as(:alice_id);

select results_eq(
  $$ select email from users $$,
  $$ values ('alice@example.org'::text) $$,
  'a user sees only their own profile row (rules:97)'
);

select throws_ok(
  $$ update users set role = 'admin' where id = '11111111-1111-1111-1111-111111111111' $$,
  null,
  null,
  'role is immutable — no self-elevation to admin (rules:100)'
);

select lives_ok(
  $$ update users set display_name = 'Alice A.'
     where id = '11111111-1111-1111-1111-111111111111' $$,
  'a user CAN update their own display_name (rules:101)'
);

select throws_ok(
  $$ insert into users (id, email, role)
     values ('55555555-5555-5555-5555-555555555555', 'mallory@example.org', 'client') $$,
  '42501',
  null,
  'a user cannot create a profile row for somebody else (rules:98)'
);

-- ---------------------------------------------------------------------------
-- organizations + organization_members — 0001_core
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select name from organizations $$,
  $$ values ('DSSG Test Org'::text) $$,
  'a member CAN read their own organization (0001_core: organizations_select_member)'
);

-- Four: alice, bob, the admin and the volunteer.
select results_eq(
  $$ select count(*)::int from organization_members $$,
  $$ values (4) $$,
  'a member CAN see co-members in their org (0001_core: org_members_select)'
);

select tests.login_as(:outsider_id);

select is_empty(
  $$ select id from organizations $$,
  'an outsider cannot see any organization (0001_core: cross-org isolation)'
);

select is_empty(
  $$ select id from organization_members $$,
  'an outsider cannot see any org members (0001_core: cross-org isolation)'
);

select tests.login_as(:alice_id);

-- ---------------------------------------------------------------------------
-- businesses — rules:105-113, org-scoped by 0001_core
--
-- Every insert carries organization_id: 0001_core's insert policy requires it to be one of the
-- caller's orgs, so a write without it is refused before ownership is even considered.
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select name from businesses $$,
  $$ values ('Alice Nonprofit'::text) $$,
  'owner-scoping: alice sees her business and not bob''s (rules:106-107)'
);

select lives_ok(
  $$ insert into businesses (id, name, type, owner_id, organization_id)
     values ('aaaaaaaa-0000-0000-0000-000000000002', 'Alice Second', 'small_business',
             '11111111-1111-1111-1111-111111111111',
             'eeeeeeee-0000-0000-0000-000000000001') $$,
  'a user CAN create a business they own in their org (rules:108)'
);

select throws_ok(
  $$ insert into businesses (id, name, type, owner_id, organization_id)
     values ('aaaaaaaa-0000-0000-0000-000000000003', 'Planted', 'nonprofit',
             '22222222-2222-2222-2222-222222222222',
             'eeeeeeee-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'a user cannot create a business owned by somebody else (rules:52,108)'
);

-- organization_id is nullable on the column; the policy is what requires it to be one of
-- the caller's orgs. A real org alice is not in would be refused the same way.
select throws_ok(
  $$ insert into businesses (id, name, type, owner_id, organization_id)
     values ('aaaaaaaa-0000-0000-0000-000000000005', 'Elsewhere', 'nonprofit',
             '11111111-1111-1111-1111-111111111111', null) $$,
  '42501',
  null,
  'a user cannot create a business outside an org they belong to (0001_core: businesses_insert_own)'
);

-- Bob's row is outside alice's USING clause, so it is invisible and the update matches
-- nothing. The immutability trigger never even runs — RLS refuses first.
select is(
  tests.affected(
    $$ update businesses set owner_id = '11111111-1111-1111-1111-111111111111'
        where id = 'bbbbbbbb-0000-0000-0000-000000000001' $$),
  0,
  'a user cannot steal another owner''s business (rules:109)'
);

select throws_ok(
  $$ update businesses set owner_id = '22222222-2222-2222-2222-222222222222'
     where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  null,
  null,
  'owner_id is immutable even for the owner (rules:110)'
);

-- 23514 is the trigger's check_violation: BEFORE UPDATE triggers run ahead of the policy
-- WITH CHECK, so this proves the immutability guard itself, not RLS.
select throws_ok(
  $$ update businesses set organization_id = '99999999-9999-9999-9999-999999999999'
     where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '23514',
  null,
  'organization_id is immutable on businesses (0001_core: immutability trigger)'
);

select lives_ok(
  $$ update businesses set name = 'Alice Nonprofit Inc.'
     where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'an owner CAN rename their business (rules:111)'
);

select lives_ok(
  $$ delete from businesses where id = 'aaaaaaaa-0000-0000-0000-000000000002' $$,
  'an owner CAN delete their own business (rules:112)'
);

-- A signed-in client who owns nothing sees nothing. The outsider is also in no org, so
-- this doubles as the cross-org isolation check for businesses (0001_core).
select tests.login_as(:outsider_id);

select is_empty(
  $$ select id from businesses $$,
  'a client with no businesses sees none (rules:106-107)'
);

-- ---------------------------------------------------------------------------
-- engagements — rules:116-128
-- ---------------------------------------------------------------------------

select tests.login_as(:alice_id);

select results_eq(
  $$ select count(*)::int from engagements $$,
  $$ values (1) $$,
  'owner-scoping: alice sees only her own engagement (rules:117-118)'
);

-- 0001_core revoked INSERT/UPDATE on engagements from `authenticated`: stage rows are written by
-- transition_engagement() only. The partner's old direct writes are asserted refused, and
-- the rows the rest of this suite builds on are seeded as the superuser, as the fixtures are.
select throws_ok(
  $$ insert into engagements (id, business_id, owner_id, stage, status, organization_id)
     values ('aaaaaaaa-0000-0000-0000-000000000011',
             'aaaaaaaa-0000-0000-0000-000000000001',
             '11111111-1111-1111-1111-111111111111', 'scoping', 'pending',
             'eeeeeeee-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'a user can NO LONGER create an engagement directly — only transition_engagement() writes (0001_core; was rules:119-120)'
);

reset role;
insert into engagements (id, business_id, owner_id, stage, status, organization_id)
values ('aaaaaaaa-0000-0000-0000-000000000011',
        'aaaaaaaa-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'scoping', 'pending',
        'eeeeeeee-0000-0000-0000-000000000001');
select tests.login_as(:alice_id);

select throws_ok(
  $$ insert into engagements (id, business_id, owner_id, stage, status, organization_id)
     values ('aaaaaaaa-0000-0000-0000-000000000012',
             'bbbbbbbb-0000-0000-0000-000000000001',
             '11111111-1111-1111-1111-111111111111', 'scoping', 'pending',
             'eeeeeeee-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'a user cannot attach an engagement to a business they do not own — 42501 from the 0001_core privilege revoke (was rules:120)'
);

-- As the superuser since 0001_core (a partner now fails on the privilege, 42501, before the FK
-- is ever checked): the FK itself still refuses a nonexistent business.
reset role;
select throws_ok(
  $$ insert into engagements (id, business_id, owner_id, stage, status, organization_id)
     values ('aaaaaaaa-0000-0000-0000-000000000013',
             '99999999-9999-9999-9999-999999999999',
             '11111111-1111-1111-1111-111111111111', 'scoping', 'pending',
             'eeeeeeee-0000-0000-0000-000000000001') $$,
  '23503',
  null,
  'an engagement cannot reference a nonexistent business (rules:120 atomic guarantee; FK 23503)'
);
select tests.login_as(:alice_id);

select throws_ok(
  $$ update engagements set stage = 'budget_check'
     where id = 'aaaaaaaa-0000-0000-0000-000000000010' $$,
  '42501',
  null,
  'an owner can NO LONGER write the stage — the lifecycle self-advancement hole is closed (0001_core; was rules:126)'
);

-- The suite below was built on this row having moved to budget_check; seed it as the superuser.
reset role;
update engagements set stage = 'budget_check'
 where id = 'aaaaaaaa-0000-0000-0000-000000000010';
select tests.login_as(:alice_id);

-- The target must be a *different* business that alice also owns, otherwise the update is
-- a no-op: engagement ...011 was created on ...001, so re-assigning it to ...001 leaves
-- `is distinct from` false and the trigger correctly allows it — the assertion would pass
-- against a schema with no immutability guard at all. ...002 was deleted by the businesses
-- section above, so create a fresh one to move to.
select lives_ok(
  $$ insert into businesses (id, name, type, owner_id, organization_id)
     values ('aaaaaaaa-0000-0000-0000-000000000004', 'Alice Third', 'nonprofit',
             '11111111-1111-1111-1111-111111111111',
             'eeeeeeee-0000-0000-0000-000000000001') $$,
  'fixture: a second business alice owns, to attempt a real business_id change'
);

-- Run as the superuser since 0001_core: `authenticated` holds no UPDATE, so as alice these would
-- raise 42501 from the privilege check and never reach the trigger they exist to pin.
reset role;

select throws_ok(
  $$ update engagements set business_id = 'aaaaaaaa-0000-0000-0000-000000000004'
     where id = 'aaaaaaaa-0000-0000-0000-000000000011' $$,
  '23514',
  null,
  'business_id is immutable after create (rules:123)'
);

select throws_ok(
  $$ update engagements set organization_id = '99999999-9999-9999-9999-999999999999'
     where id = 'aaaaaaaa-0000-0000-0000-000000000010' $$,
  '23514',
  null,
  'organization_id is immutable on engagements (0001_core: immutability trigger)'
);

-- Terminal-state locking, checked against bob's completed engagement. The lock keys on
-- the session role: every API role is refused (service_role holds UPDATE, so it reaches
-- the trigger and proves the lock); the superuser, like a definer function, passes.
select tests.as_service();

select throws_ok(
  $$ update engagements set status = 'in_progress'
     where id = 'bbbbbbbb-0000-0000-0000-000000000010' $$,
  '23514',
  null,
  'service_role cannot return a completed engagement to in_progress: the lock keys on the session role (rules:125)'
);

reset role;

select lives_ok(
  $$ update engagements set status = 'in_progress'
     where id = 'bbbbbbbb-0000-0000-0000-000000000010' $$,
  'the superuser (as a definer function would) can reopen a completed engagement with no setting'
);

update engagements set status = 'completed' where id = 'bbbbbbbb-0000-0000-0000-000000000010';

select lives_ok(
  $$ update engagements set notes = 'wrapped up'
     where id = 'bbbbbbbb-0000-0000-0000-000000000010' $$,
  'a completed engagement can still be annotated by the superuser (rules:125 allows status = completed)'
);

select tests.login_as(:bob_id);

-- The outsider is in no org: also the cross-org isolation check for engagements (0001_core).
select tests.login_as(:outsider_id);

select is_empty(
  $$ select id from engagements $$,
  'a client with no engagements sees none (rules:117-118)'
);

-- ---------------------------------------------------------------------------
-- engagements: staff read access — staff_engagement_access step 1
--
-- The whole point of the policy: Pulse runs as staff and must see every engagement.
-- Without it a staff session reads zero rows and silently reports that nothing is at
-- risk, because it can see nothing at all. Since 0001_core "every" means every engagement in
-- the admin's org(s); all fixture engagements are in the one org, so the counts hold.
-- ---------------------------------------------------------------------------

select tests.login_as(:admin_id);

-- Three, not two: alice created ...011 earlier in this suite, on top of the two seeded
-- rows. Asserting the exact count (rather than >= 2) is what makes this fail if the
-- policy ever narrows to a subset.
select results_eq(
  $$ select count(*)::int from engagements $$,
  $$ values (3) $$,
  'an admin CAN read every engagement in their org (0003_delivery+0001_core: engagements_select_admin)'
);

select results_eq(
  $$ select count(*)::int from engagements
     where owner_id = '22222222-2222-2222-2222-222222222222' $$,
  $$ values (1) $$,
  'an admin sees engagements they do not own'
);

-- Read authority only. If this ever starts passing, U5 has been resolved by accident.
-- Since 0001_core this raises 42501 (no UPDATE privilege) instead of matching zero rows: the
-- admin's only write path is transition_engagement() (U5 / D18 resolved, lifecycle.md §2).
select throws_ok(
  $$ update engagements set stage = 'budget_check'
     where id = 'bbbbbbbb-0000-0000-0000-000000000010' $$,
  '42501',
  null,
  'an admin CANNOT write engagements directly — transition_engagement() is the only writer (0001_core)'
);

-- KNOWN WRONG — 0001_core model, replaced by C1.
-- A DSSG volunteer can only be granted engagement access under 0001_core by an org role, and
-- the org role that grants any ('admin') grants all of them: the volunteer, assigned to no
-- project, reads every client engagement in the DSSG org. The decided model
-- (access-model.md) scopes a diplomat to assigned projects only. When C1 lands this
-- expectation must flip to "only assigned engagements" — change it on purpose.
select tests.login_as(:volunteer_id);

select results_eq(
  $$ select count(*)::int from engagements $$,
  $$ values (3) $$,
  'KNOWN WRONG — 0001_core model, replaced by C1: a DSSG org volunteer reads every engagement in the org'
);

-- Regression guard: widening reads for admins must not widen them for owners. alice is a
-- plain 'member' of the same org, and 0001_core does not widen member reads beyond ownership.
select tests.login_as(:alice_id);

select results_eq(
  $$ select count(*)::int from engagements $$,
  $$ values (2) $$,
  'owner-scoping still holds for a non-admin after staff access (rules:117-118)'
);

-- ---------------------------------------------------------------------------
-- engagement_events — staff_engagement_access step 3, org-scoped by 0001_core
--
-- Inserts carry organization_id: 0001_core requires it to match the caller's org and the
-- engagement's org.
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into engagement_events (engagement_id, kind, detail, created_by, organization_id)
     values ('aaaaaaaa-0000-0000-0000-000000000010', 'session_held', '{"text": "kickoff call"}',
             '11111111-1111-1111-1111-111111111111',
             'eeeeeeee-0000-0000-0000-000000000001') $$,
  'an owner CAN append an event to their own engagement (insert_own)'
);

select throws_ok(
  $$ insert into engagement_events (engagement_id, kind, detail, created_by, organization_id)
     values ('aaaaaaaa-0000-0000-0000-000000000010', 'note_added', '"a bare string"',
             '11111111-1111-1111-1111-111111111111',
             'eeeeeeee-0000-0000-0000-000000000001') $$,
  '23514',
  null,
  'engagement_events.detail must be a JSON object, not a scalar (0003_delivery check)'
);

select throws_ok(
  $$ insert into engagement_events (engagement_id, kind, created_by, organization_id)
     values ('bbbbbbbb-0000-0000-0000-000000000010', 'session_held',
             '11111111-1111-1111-1111-111111111111',
             'eeeeeeee-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'a user cannot append an event to someone else''s engagement'
);

-- created_by is the attribution field Pulse trusts; forging it must be impossible.
select throws_ok(
  $$ insert into engagement_events (engagement_id, kind, created_by, organization_id)
     values ('aaaaaaaa-0000-0000-0000-000000000010', 'note_added',
             '22222222-2222-2222-2222-222222222222',
             'eeeeeeee-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'a user cannot attribute an event to another user'
);

-- Append-only, enforced at the privilege layer rather than by policy: only SELECT and
-- INSERT are granted, so these raise 42501 (permission denied) rather than matching zero
-- rows. That is the stronger of the two failures — it cannot be reopened by adding a
-- policy alone.
select throws_ok(
  $$ update engagement_events set detail = '{"text": "rewritten"}' $$,
  '42501',
  null,
  'events cannot be edited — append-only history'
);

select throws_ok(
  $$ delete from engagement_events $$,
  '42501',
  null,
  'events cannot be deleted — append-only history'
);

select tests.login_as(:admin_id);

select results_eq(
  $$ select count(*)::int from engagement_events $$,
  $$ values (1) $$,
  'an admin CAN read events in their org — this is Pulse''s input signal'
);

select tests.login_as(:outsider_id);

select is_empty(
  $$ select id from engagement_events $$,
  'a non-owner client cannot see engagement events'
);

-- ---------------------------------------------------------------------------
-- architect_assessments — rules:195-205
-- ---------------------------------------------------------------------------

select tests.login_as(:alice_id);

select is_empty(
  $$ select id from architect_assessments $$,
  'a non-admin cannot read assessments (rules:198)'
);

select throws_ok(
  $$ insert into architect_assessments (
       id, scout_intake_id, org_name, scout_bucket, scout_readiness,
       q1_org_context, q2_org_size, q3_poc,
       q4_collection_scope, q5_data_locations, q6_system_integration,
       q7_integration_familiarity, q8_quality_confidence,
       q9_current_decisions, q10_wished_decisions, q11_decision_empowerment,
       q12_reporting_to, q13_reporting_automation,
       q14_tools, q15_staff_confidence, q16_budget_speed,
       q17a_wish_list, q17b_biggest_worry, q18_past_blockers,
       di_score, gov_score, tooling_score, dc_score, tc_score,
       points, composite_level, charter, ninety_day_plan,
       created_by, created_by_email
     ) values (
       'cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
       'Seeded Org', 'Analytics & Insight', 'Ready',
       'ctx', 'size', 'poc', 'partial', 'locations', 'some_share',
       'somewhat_familiar', 'mixed', 'now', 'wished', 'leadership_managers',
       'board', 'semi_automated', '{spreadsheets}', 'some_adhoc', 'requires_approval',
       'wish', 'worry', 'blockers', 2, 2, 2, 2, 2, 10, 'Developing',
       '{}'::jsonb, '{}'::jsonb,
       '11111111-1111-1111-1111-111111111111', 'alice@example.org'
     ) $$,
  '42501',
  null,
  'a non-admin cannot create an assessment (rules:199)'
);

select tests.login_as(:admin_id);

-- 0001_core revoked INSERT/UPDATE from `authenticated`: an admin's only write path is
-- submit_architect_draft() (0004_drafts), which saves the assessment together with its pending
-- L3 approval. A direct write — which would skip the approval — fails at the privilege
-- layer, before RLS or the author trigger is consulted.
select throws_ok(
  $$ insert into architect_assessments (
       id, scout_intake_id, org_name, scout_bucket, scout_readiness,
       q1_org_context, q2_org_size, q3_poc,
       q4_collection_scope, q5_data_locations, q6_system_integration,
       q7_integration_familiarity, q8_quality_confidence,
       q9_current_decisions, q10_wished_decisions, q11_decision_empowerment,
       q12_reporting_to, q13_reporting_automation,
       q14_tools, q15_staff_confidence, q16_budget_speed,
       q17a_wish_list, q17b_biggest_worry, q18_past_blockers,
       di_score, gov_score, tooling_score, dc_score, tc_score,
       points, composite_level, charter, ninety_day_plan,
       created_by, created_by_email
     ) values (
       'cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
       'Seeded Org', 'Analytics & Insight', 'Ready',
       'ctx', 'size', 'poc', 'partial', 'locations', 'some_share',
       'somewhat_familiar', 'mixed', 'now', 'wished', 'leadership_managers',
       'board', 'semi_automated', '{spreadsheets}', 'some_adhoc', 'requires_approval',
       'wish', 'worry', 'blockers', 2, 2, 2, 2, 2, 10, 'Developing',
       '{}'::jsonb, '{}'::jsonb,
       '33333333-3333-3333-3333-333333333333', 'admin@dssg.nyc'
     ) $$,
  '42501',
  null,
  'an admin cannot insert an assessment directly — only submit_architect_draft() writes (0001_core)'
);

select ok(
  not has_table_privilege('authenticated', 'architect_assessments', 'INSERT')
    and not has_table_privilege('authenticated', 'architect_assessments', 'UPDATE'),
  'authenticated holds no INSERT/UPDATE on architect_assessments (0001_core)'
);

select ok(
  has_table_privilege('authenticated', 'architect_assessments', 'SELECT'),
  'authenticated keeps SELECT on architect_assessments (ArchitectPlan, Realtime)'
);

-- Seed the row the rest of the suite needs (engagements.assessment_id below, the RPC
-- re-submit block later) as the superuser, as the fixtures are. The admin's JWT claim is
-- still set, so the author trigger (rules:202) sees the admin as the actor.
reset role;
insert into architect_assessments (
       id, scout_intake_id, org_name, scout_bucket, scout_readiness,
       q1_org_context, q2_org_size, q3_poc,
       q4_collection_scope, q5_data_locations, q6_system_integration,
       q7_integration_familiarity, q8_quality_confidence,
       q9_current_decisions, q10_wished_decisions, q11_decision_empowerment,
       q12_reporting_to, q13_reporting_automation,
       q14_tools, q15_staff_confidence, q16_budget_speed,
       q17a_wish_list, q17b_biggest_worry, q18_past_blockers,
       di_score, gov_score, tooling_score, dc_score, tc_score,
       points, composite_level, charter, ninety_day_plan,
       created_by, created_by_email
     ) values (
       'cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
       'Seeded Org', 'Analytics & Insight', 'Ready',
       'ctx', 'size', 'poc', 'partial', 'locations', 'some_share',
       'somewhat_familiar', 'mixed', 'now', 'wished', 'leadership_managers',
       'board', 'semi_automated', '{spreadsheets}', 'some_adhoc', 'requires_approval',
       'wish', 'worry', 'blockers', 2, 2, 2, 2, 2, 10, 'Developing',
       '{}'::jsonb, '{}'::jsonb,
       '33333333-3333-3333-3333-333333333333', 'admin@dssg.nyc'
     );
select tests.login_as(:admin_id);

select throws_ok(
  $$ update architect_assessments set created_by = '11111111-1111-1111-1111-111111111111'
     where id = 'cccccccc-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'an admin cannot rewrite created_by directly (rules:202; no UPDATE since 0001_core)'
);

select throws_ok(
  $$ update architect_assessments set composite_level = 'Established', points = 14
     where id = 'cccccccc-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'an admin cannot re-conduct an assessment directly — a re-submit goes through submit_architect_draft() (0001_core)'
);

select throws_ok(
  $$ delete from architect_assessments where id = 'cccccccc-0000-0000-0000-000000000001' $$,
  null,
  null,
  'nobody can delete an assessment — audit trail (rules:204)'
);

-- ---------------------------------------------------------------------------
-- engagements.assessment_id — staff_engagement_access step 2
--
-- Placed after the architect block on purpose: assessment cccc...0001_core does not exist
-- until that block seeds it, and the block's own first assertion requires the table
-- to be empty, so this cannot be seeded as a fixture instead.
-- ---------------------------------------------------------------------------

-- As the superuser since 0001_core: `authenticated` cannot UPDATE engagements. C2 will write
-- assessment_id on plan acceptance; until then only fixtures do.
reset role;

select lives_ok(
  $$ update engagements
     set assessment_id = 'cccccccc-0000-0000-0000-000000000001'
     where id = 'aaaaaaaa-0000-0000-0000-000000000010' $$,
  'an engagement can be linked to an assessment (assessment_id)'
);

select throws_ok(
  $$ update engagements
     set assessment_id = '99999999-9999-9999-9999-999999999999'
     where id = 'aaaaaaaa-0000-0000-0000-000000000010' $$,
  '23503',
  null,
  'assessment_id cannot reference a nonexistent assessment (FK)'
);

-- ---------------------------------------------------------------------------
-- Routine privileges (0001_core): the exact set of public functions a client role can execute.
-- Supabase's default privileges grant EXECUTE on every new public function to anon and
-- authenticated; only an explicit revoke removes it. A new function that nobody revoked
-- shows up here as an extra row, which is the point. Extension-owned functions (uuid-ossp,
-- if installed into public) are excluded: they are not ours to revoke.
-- ---------------------------------------------------------------------------

reset role;

select results_eq(
  $$ select distinct routine_name::text collate "default"
       from information_schema.routine_privileges
      where routine_schema = 'public' and grantee = 'anon' and privilege_type = 'EXECUTE'
        and routine_name not in (select p.proname from pg_proc p
                                   join pg_depend d on d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
                                  where p.pronamespace = 'public'::regnamespace)
      order by 1 $$,
  $$ values
       ('submit_scout_intake')  -- 0007: the public form's one door
  $$,
  'anon can execute exactly submit_scout_intake() (0001_core revoked is_admin / user_org_ids; 0007 allow-list)'
);
select results_eq(
  $$ select distinct routine_name::text collate "default"
       from information_schema.routine_privileges
      where routine_schema = 'public' and grantee = 'authenticated'
        and privilege_type = 'EXECUTE'
        and routine_name not in (select p.proname from pg_proc p
                                   join pg_depend d on d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
                                  where p.pronamespace = 'public'::regnamespace)
      order by 1 $$,
  $$ values
       ('approve_scout_intake'),       -- 0008: explicit grant
       ('check_model_budget'),         -- 0007: explicit grant
       ('current_engagement_stage'),   -- 0005_lifecycle: explicit grant
       ('derive_engagement_outcome'),  -- 0004_drafts: explicit grant
       ('is_admin'),                   -- 0001_core: explicit grant
       ('promote_lesson'),             -- 0004_drafts: explicit grant
       ('submit_architect_draft'),     -- 0004_drafts/0004_drafts: explicit grant
       ('submit_chronicle_draft'),     -- 0004_drafts/0004_drafts: explicit grant
       ('submit_envoy_draft'),         -- 0004_drafts: explicit grant
       ('submit_scout_intake'),        -- 0007: explicit grant
       ('transition_engagement'),      -- 0005_lifecycle: explicit grant
       ('user_org_ids')                -- 0001_core: explicit grant
  $$,
  'authenticated can execute exactly the granted RPCs and helpers (0001_core allow-list)'
);

select is_empty(
  $$ select 1 from information_schema.routine_privileges
      where routine_schema = 'public' and routine_name = 'handle_new_user'
        and grantee in ('anon', 'authenticated') $$,
  'neither anon nor authenticated holds EXECUTE on handle_new_user() (0001_core)'
);

create or replace function tests.intake_routing(intake_id uuid, src provenance_source, run uuid)
returns void language plpgsql as $$
begin
  insert into scout_intakes (
    id, org_name, contact_name_role, contact_email, mission, scale, primary_need,
    problem_description, current_systems, timeline, referral_source,
    rationale, poc_score, clarity_score, foothold_score, composite_signal, hitl_tier,
    routing_source, routing_run_id
  ) values (
    intake_id, 'Routed Org', 'Sam Lee, ED', 'sam@example.org', 'Mission text.',
    '100 clients/year', 'build_tool', 'We need a dashboard.', 'Sheets', 'Q3', 'Referral',
    'Reasoning.', 2, 2, 2, 'Conditional', 'L3', src, run
  );
end;
$$;

insert into agent_runs (id, agent, organization_id, model, prompt_version, status, hitl_tier, duration_ms)
values ('ffffffff-0000-0000-0000-0000000000a8', 'scout', null,
        'gemini-2.5-flash', 'scout-routing-v1', 'success', 'L3', 700);

select is(
  (select routing_source::text from scout_intakes where id = 'cccccccc-0000-0000-0000-000000000001'),
  'derived',
  'an existing intake reads routing_source ''derived'' by default (0001_core)'
);

select throws_ok(
  $$ select tests.intake_routing('abcd0018-0000-0000-0000-0000000000a1', 'ai', null) $$,
  '23514', null,
  'routing_source ''ai'' with no routing_run_id is refused (0001_core)'
);

select throws_ok(
  $$ select tests.intake_routing('abcd0018-0000-0000-0000-0000000000a2', 'derived',
                                 'ffffffff-0000-0000-0000-0000000000a8') $$,
  '23514', null,
  'a routing_run_id on a ''derived'' intake is refused (0001_core)'
);

select throws_ok(
  $$ select tests.intake_routing('abcd0018-0000-0000-0000-0000000000a3', 'human', null) $$,
  '23514', null,
  'routing_source admits only ''derived'' and ''ai'' (0001_core)'
);

select lives_ok(
  $$ select tests.intake_routing('abcd0018-0000-0000-0000-0000000000a4', 'ai',
                                 'ffffffff-0000-0000-0000-0000000000a8') $$,
  'routing_source ''ai'' with a routing_run_id is accepted (0001_core)'
);

-- The public form cannot assert provenance: since 0007 it holds no INSERT at all, and the
-- RPC it does hold derives provenance from the run (asserted in the 0007 block below).
select tests.logout();
select throws_ok(
  $$ select tests.intake_routing('abcd0018-0000-0000-0000-0000000000a5', 'ai',
                                 'ffffffff-0000-0000-0000-0000000000a8') $$,
  '42501',
  null,
  'anon cannot insert an intake claiming ''ai'' routing provenance (0007: no INSERT privilege)'
);

-- A review is the only update an admin may make, and it cannot rewrite the routing record.
select tests.login_as(:admin_id);
select throws_ok(
  $$ update scout_intakes
        set review_status = 'reviewed', review_action = 'approved',
            final_bucket = 'Analytics & Insight', reviewed_by = '33333333-3333-3333-3333-333333333333',
            reviewed_at = now(), routing_model = 'rewritten'
      where id = 'cccccccc-0000-0000-0000-000000000001' $$,
  '23514', null,
  'an admin review cannot rewrite routing provenance (0001_core review-only trigger)'
);

reset role;

-- ---------------------------------------------------------------------------
-- submit_scout_intake() and check_model_budget() — 0007.
--
-- The RPC is the public form's only writer, so what it refuses to take from the payload
-- is the whole point: review state, provenance and hitl_tier are derived; L2 needs a
-- successful Scout run that recorded L2 for a result still High + Ready.
-- ---------------------------------------------------------------------------

reset role;

-- A successful run that recorded L2, a failed one, and one of another agent.
insert into agent_runs (id, agent, model, prompt_version, status, hitl_tier, duration_ms)
values ('ffffffff-0000-0000-0000-0000000000a9', 'scout', 'gemini-3.5-flash-lite', 'scout-routing-0.05', 'success', 'L2', 500),
       ('ffffffff-0000-0000-0000-0000000000b0', 'scout', 'gemini-3.5-flash-lite', 'scout-routing-0.05', 'fallback', null, 500),
       ('ffffffff-0000-0000-0000-0000000000b1', 'envoy', 'gemini-3.5-flash-lite', 'envoy-0.1', 'success', 'L3', 500);

select tests.logout();

-- A submitter claiming a reviewed, L2, model-routed row gets a pending, L3, derived one:
-- the keys are ignored, not refused, because the form never sends them on purpose.
select is(
  (select r ->> 'hitl_tier' || '/' || (r ->> 'routing_source')
     from submit_scout_intake(tests.intake_payload()
       || '{"hitl_tier": "L2", "review_status": "reviewed", "review_action": "approved",
            "final_bucket": "ML / Predictive", "routing_source": "ai", "organization_id": "eeeeeeee-0000-0000-0000-000000000001"}'::jsonb) r),
  'L3/derived',
  'submit_scout_intake ignores a payload''s tier, review and provenance claims (0007)'
);

reset role;  -- anon cannot read intakes back; the row check runs as the superuser
select results_eq(
  $$ select review_status::text, hitl_tier::text, routing_source::text, routing_run_id::text,
            organization_id::text, reviewed_by::text
       from scout_intakes where org_name = 'Payload Org' order by submitted_at desc limit 1 $$,
  $$ values ('pending', 'L3', 'derived', null, null, null) $$,
  'the row it writes is pending, L3, derived, unlinked and org-less (0007)'
);
select tests.logout();

-- Provenance from the run, never the payload.
select is(
  (select r ->> 'hitl_tier' || '/' || (r ->> 'routing_source')
     from submit_scout_intake(tests.intake_payload() || '{"confidence": "High", "composite_signal": "Ready"}'::jsonb,
                              'ffffffff-0000-0000-0000-0000000000a9') r),
  'L2/ai',
  'a successful Scout run that recorded L2, with a High + Ready result, yields L2 / ai (0007)'
);

reset role;
select results_eq(
  $$ select routing_model, routing_prompt_version from scout_intakes
      where routing_run_id = 'ffffffff-0000-0000-0000-0000000000a9' $$,
  $$ values ('gemini-3.5-flash-lite'::text, 'scout-routing-0.05'::text) $$,
  'model and prompt version are copied from the run, not the payload (0007)'
);
select tests.logout();

select throws_ok(
  $$ select submit_scout_intake(tests.intake_payload(), 'ffffffff-0000-0000-0000-0000000000a9') $$,
  '22023', null,
  'a run already behind another intake is refused (0007)'
);

select throws_ok(
  $$ select submit_scout_intake(tests.intake_payload(), 'ffffffff-0000-0000-0000-0000000000b0') $$,
  '22023', null,
  'a run that did not succeed cannot back an intake (0007)'
);

select throws_ok(
  $$ select submit_scout_intake(tests.intake_payload(), 'ffffffff-0000-0000-0000-0000000000b1') $$,
  '22023', null,
  'a run of another agent cannot back a Scout intake (0007)'
);

select throws_ok(
  $$ select submit_scout_intake(tests.intake_payload(), '00000000-0000-0000-0000-000000000000') $$,
  '22023', null,
  'an unknown run id is refused (0007)'
);

-- L2 is the recorded tier AND the L2 contract on the result as filed. A new L2 run with a
-- result that is no longer High + Ready lands as L3.
reset role;
insert into agent_runs (id, agent, model, status, hitl_tier, duration_ms)
values ('ffffffff-0000-0000-0000-0000000000b2', 'scout', 'gemini-3.5-flash-lite', 'success', 'L2', 500);
select tests.logout();

select is(
  (select r ->> 'hitl_tier'
     from submit_scout_intake(tests.intake_payload() || '{"confidence": "High", "composite_signal": "Conditional"}'::jsonb,
                              'ffffffff-0000-0000-0000-0000000000b2') r),
  'L3',
  'an L2 run filed with a result that is not High + Ready lands as L3 (0007)'
);

select throws_ok(
  $$ select submit_scout_intake(tests.intake_payload() || '{"primary_need": "world_peace"}'::jsonb) $$,
  '22P02', null,
  'an unknown primary_need is refused by the enum (0007)'
);

select throws_ok(
  $$ select submit_scout_intake('[]'::jsonb) $$,
  '22023', null,
  'a payload that is not an object is refused (0007)'
);

select throws_ok(
  $$ select submit_scout_intake(tests.intake_payload() || '{"poc_score": 7}'::jsonb) $$,
  '23514', null,
  'column constraints still apply through the RPC (0007)'
);

-- check_model_budget: per caller, per hour; refused calls do not count.
select throws_ok(
  $$ select check_model_budget(5) $$,
  '42501', null,
  'anon (no auth.uid) has no model budget to spend (0007)'
);

select tests.login_anonymous(:anon_user_id);

select results_eq(
  $$ select check_model_budget(2) $$,
  $$ values (1) $$,
  'the first call in the hour returns the remainder (0007)'
);
select results_eq(
  $$ select check_model_budget(2) $$,
  $$ values (0) $$,
  'the last allowed call returns zero remaining (0007)'
);
select throws_ok(
  $$ select check_model_budget(2) $$,
  '53400', null,
  'the call past the limit raises 53400 (0007)'
);
select throws_ok(
  $$ select check_model_budget(2) $$,
  '53400', null,
  'and keeps raising — the refused call was not counted toward a longer lockout (0007)'
);

select throws_ok(
  $$ select check_model_budget(0) $$,
  '22023', null,
  'a limit outside 1-1000 is refused (0007)'
);

select throws_ok(
  $$ select * from model_call_budget $$,
  '42501', null,
  'an anonymous session cannot read the budget table (0007)'
);

select tests.login_as(:alice_id);

select results_eq(
  $$ select check_model_budget(1) $$,
  $$ values (0) $$,
  'another user''s counter starts fresh — the budget is per caller (0007)'
);

select throws_ok(
  $$ select * from model_call_budget $$,
  '42501', null,
  'a signed-in user cannot read the budget table (0007)'
);

reset role;

select * from finish();

rollback;
