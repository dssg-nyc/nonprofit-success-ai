-- The SECURITY DEFINER commands: submit_architect_draft, submit_envoy_draft /
-- submit_chronicle_draft, transition_engagement (and the revoked direct write), lessons
-- and promote_lesson, and the provenance_chain view over what they wrote. The blocks
-- build on each other's rows, so they share one file and one transaction.

\ir _shared/fixtures.psql

select plan(211);

-- submit_architect_draft() — 0004_drafts (assessment + L3 charter approval + audit, one txn)
-- ---------------------------------------------------------------------------

-- Fixtures, as the superuser: a reviewed intake in the test org (the function's
-- precondition) and an unreviewed one, an Architect run to link, and the draft payload. The payload carries
-- hostile values for the columns the function derives (created_by, organization_id,
-- scout_bucket), which the assessment assertion below proves were ignored.
reset role;

insert into scout_intakes (
  id, org_name, contact_name_role, contact_email, mission, scale, primary_need,
  problem_description, current_systems, timeline, referral_source,
  bucket, confidence, rationale, poc_score, clarity_score, foothold_score,
  composite_signal, flags, hitl_tier,
  review_status, review_action, final_bucket, organization_id
) values (
  'cccccccc-0000-0000-0000-000000000009',
  'Charter Org', 'Sam Lee, ED', 'sam@example.org', 'Food access.',
  '12 sites', 'analyze_data', 'Cannot see shortages.', 'Spreadsheets',
  'Next quarter', 'Referral',
  'Analytics & Insight', 'High', 'Clear need.', 3, 3, 3, 'Ready', '{}', 'L2',
  'reviewed', 'redirected', 'Data Infrastructure', :org_id
), (
  'cccccccc-0000-0000-0000-000000000008',
  'Unreviewed Org', 'Kim Park, ED', 'kim@example.org', 'Tutoring.',
  '200 students', 'analyze_data', 'No outcome data.', 'Paper',
  'Next year', 'Referral',
  'Analytics & Insight', 'High', 'Clear need.', 3, 3, 3, 'Ready', '{}', 'L2',
  'pending', null, null, :org_id
);

insert into agent_runs (id, agent, organization_id, model, prompt_version, status,
                        hitl_tier, duration_ms)
values ('ffffffff-0000-0000-0000-000000000090', 'architect', :org_id,
        'gemini-2.5-flash', 'architect-plan-v1', 'success', 'L3', 4000);

create or replace function tests.architect_draft(intake uuid) returns jsonb
language sql as $$
  select jsonb_build_object(
    'scout_intake_id', intake,
    'source', 'model',
    'q1_org_context', 'ctx', 'q2_org_size', 'size', 'q3_poc', 'poc',
    'q4_collection_scope', 'partial', 'q5_data_locations', 'locations',
    'q6_system_integration', 'some_share', 'q7_integration_familiarity', 'somewhat_familiar',
    'q8_quality_confidence', 'mixed', 'q9_current_decisions', 'now',
    'q10_wished_decisions', 'wished', 'q11_decision_empowerment', 'leadership_managers',
    'q12_reporting_to', 'board', 'q13_reporting_automation', 'semi_automated',
    'q14_tools', jsonb_build_array('spreadsheets'), 'q15_staff_confidence', 'some_adhoc',
    'q16_budget_speed', 'requires_approval', 'q17a_wish_list', 'wish',
    'q17b_biggest_worry', 'worry', 'q18_past_blockers', 'blockers',
    'di_score', 2, 'gov_score', 2, 'tooling_score', 2, 'dc_score', 2, 'tc_score', 2,
    'points', 10, 'composite_level', 'Developing',
    'flagged_dimensions', jsonb_build_array(), 'remediation_only', false,
    'charter', jsonb_build_object('title', 'Charter'),
    'ninety_day_plan', jsonb_build_object('shape', 'build_basics'),
    -- Derived by the function; these must be ignored.
    'created_by', '11111111-1111-1111-1111-111111111111',
    'organization_id', 'eeeeeeee-0000-0000-0000-000000000002',
    'scout_bucket', 'ML / Predictive'
  )
$$;

select tests.logout();

select throws_ok(
  $$ select submit_architect_draft(tests.architect_draft('cccccccc-0000-0000-0000-000000000009'),
                                   'architect-key-anon', null) $$,
  '42501',
  null,
  'anon cannot submit an Architect draft (0004_drafts: execute not granted)'
);

select tests.login_as(:alice_id);

select throws_ok(
  $$ select submit_architect_draft(tests.architect_draft('cccccccc-0000-0000-0000-000000000009'),
                                   'architect-key-alice', null) $$,
  '42501',
  null,
  'a non-admin cannot submit an Architect draft (0004_drafts: is_admin)'
);

select tests.login_as(:rival_id);

select throws_ok(
  $$ select submit_architect_draft(tests.architect_draft('cccccccc-0000-0000-0000-000000000009'),
                                   'architect-key-rival', null) $$,
  '42501',
  null,
  'an admin of another org cannot submit into this org''s intake (0004_drafts)'
);

select tests.as_service();

select throws_ok(
  $$ select public.submit_architect_draft('{}'::jsonb, 'architect-key-service') $$,
  '42501',
  null,
  'service_role cannot submit an Architect draft — the handler uses the caller''s JWT (0004_drafts)'
);

-- service_role has no USAGE on schema tests; switch back via the superuser.
reset role;
select tests.login_as(:admin_id);

select throws_ok(
  $$ select submit_architect_draft(tests.architect_draft('cccccccc-0000-0000-0000-000000000008'),
                                   'architect-key-unreviewed', null) $$,
  '55000',
  null,
  'a draft cannot be submitted against an unreviewed intake (0004_drafts)'
);

select throws_ok(
  $$ select submit_architect_draft(tests.architect_draft('cccccccc-0000-0000-0000-000000000009'),
                                   'architect-key-scoutrun', 'ffffffff-0000-0000-0000-000000000001') $$,
  '22023',
  null,
  'a draft can link only an Architect agent_run, not a Scout one (0004_drafts)'
);

select lives_ok(
  $$ select submit_architect_draft(tests.architect_draft('cccccccc-0000-0000-0000-000000000009'),
                                   'architect-key-0001', 'ffffffff-0000-0000-0000-000000000090') $$,
  'an admin CAN submit an Architect draft (0004_drafts)'
);

select results_eq(
  $$ select hitl_tier, status, agent, entity_type, agent_run_id, organization_id
       from approvals where idempotency_key = 'architect-key-0001' $$,
  $$ values ('L3'::text, 'pending'::text, 'architect'::text, 'charter'::text,
             'ffffffff-0000-0000-0000-000000000090'::uuid,
             'eeeeeeee-0000-0000-0000-000000000001'::uuid) $$,
  'the submit opens a pending L3 charter approval linked to its run, in the intake''s org'
);

select results_eq(
  $$ select submit_architect_draft(tests.architect_draft('cccccccc-0000-0000-0000-000000000009'),
                                   'architect-key-0001', 'ffffffff-0000-0000-0000-000000000090') $$,
  $$ select id from approvals where idempotency_key = 'architect-key-0001' $$,
  'a replayed idempotency key returns the original approval (design-system.md §8.1)'
);

select results_eq(
  $$ select count(*)::int from approvals
      where entity_type = 'charter' and entity_id = 'cccccccc-0000-0000-0000-000000000009' $$,
  $$ values (1) $$,
  'a replay opens no second approval'
);

select results_eq(
  $$ select created_by, organization_id, scout_bucket::text, composite_level::text
       from architect_assessments where id = 'cccccccc-0000-0000-0000-000000000009' $$,
  $$ values ('33333333-3333-3333-3333-333333333333'::uuid,
             'eeeeeeee-0000-0000-0000-000000000001'::uuid,
             'Data Infrastructure'::text, 'Developing'::text) $$,
  'author, org and bucket are derived (acting admin, intake org, final_bucket), not taken from the payload'
);

select lives_ok(
  $$ select submit_architect_draft(tests.architect_draft('cccccccc-0000-0000-0000-000000000009'),
                                   'architect-key-0002', 'ffffffff-0000-0000-0000-000000000090') $$,
  'an admin CAN re-submit a draft under a new key (0004_drafts; 0004_drafts: a model draft names its run)'
);

select results_eq(
  $$ select status from approvals where idempotency_key = 'architect-key-0001' $$,
  $$ values ('expired'::text) $$,
  'a re-submit expires the previous pending approval'
);

select results_eq(
  $$ select idempotency_key from approvals
      where entity_type = 'charter' and status = 'pending'
        and entity_id = 'cccccccc-0000-0000-0000-000000000009' $$,
  $$ values ('architect-key-0002'::text) $$,
  'exactly one pending charter approval remains: the re-submit''s'
);

select results_eq(
  $$ select count(*)::int from audit_events
      where action = 'architect.draft_submitted'
        and entity_id = 'cccccccc-0000-0000-0000-000000000009' $$,
  $$ values (2) $$,
  'each effective submit appends one architect.draft_submitted event; the replay none'
);

select tests.login_as(:alice_id);

select is_empty(
  $$ select id from approvals where entity_type = 'charter' $$,
  'a non-admin cannot read pending charter approvals'
);

select tests.login_as(:rival_id);

select is_empty(
  $$ select id from approvals where entity_type = 'charter' $$,
  'an admin of another org cannot read this org''s charter approvals'
);

-- The partial unique index backs the expire-then-insert step against any other writer.
select tests.as_service();

select throws_ok(
  $$ insert into approvals (organization_id, agent, entity_type, entity_id, hitl_tier, status)
     values ('eeeeeeee-0000-0000-0000-000000000001', 'architect', 'charter',
             'cccccccc-0000-0000-0000-000000000009', 'L3', 'pending') $$,
  '23505',
  null,
  'a second pending charter approval for one assessment is rejected (0004_drafts unique index)'
);

reset role;

-- ---------------------------------------------------------------------------
-- submit_envoy_draft() / submit_chronicle_draft() — 0004_drafts (draft + L3 approval + audit,
-- one txn; provenance columns; write-once content). Also: Architect provenance (0004_drafts §d).
-- ---------------------------------------------------------------------------

-- Fixtures, as the superuser: one run per agent that succeeded, one Envoy run that fell
-- back (a model claim must not ride on it), and a membership-stage engagement on Alice's
-- business so the Chronicle gate passes. Bob's business has no membership row: the gate
-- must refuse it.
reset role;

-- The membership engagement comes first: runs 096 below reference it (agent_runs FK).
insert into engagements (id, business_id, owner_id, stage, status, organization_id) values
  ('aaaaaaaa-0000-0000-0000-000000000020',
   'aaaaaaaa-0000-0000-0000-000000000001', :alice_id, 'membership', 'in_progress', :org_id);

insert into agent_runs (id, agent, organization_id, model, prompt_version, status,
                        hitl_tier, duration_ms)
values
  ('ffffffff-0000-0000-0000-000000000091', 'envoy', :org_id,
   'gemini-2.5-flash', 'envoy-draft-v2', 'success', 'L3', 1500),
  ('ffffffff-0000-0000-0000-000000000092', 'chronicle', :org_id,
   'gemini-2.5-flash', 'chronicle-draft-v2', 'success', 'L3', 1800),
  ('ffffffff-0000-0000-0000-000000000093', 'envoy', :org_id,
   'gemini-2.5-flash', 'envoy-draft-v2', 'fallback', 'L3', 900),
  -- spare successful runs: a run may back only one draft, so each later submit gets its own
  ('ffffffff-0000-0000-0000-000000000094', 'envoy', :org_id,
   'gemini-2.5-flash', 'envoy-draft-v2', 'success', 'L3', 1500),
  ('ffffffff-0000-0000-0000-000000000095', 'envoy', :org_id,
   'gemini-2.5-flash', 'envoy-draft-v2', 'success', 'L3', 1500);

-- Runs scoped to another engagement / another org: neither may back a draft here.
insert into agent_runs (id, agent, organization_id, engagement_id, model, prompt_version,
                        status, hitl_tier, duration_ms)
values
  ('ffffffff-0000-0000-0000-000000000096', 'envoy', :org_id,
   'aaaaaaaa-0000-0000-0000-000000000020',
   'gemini-2.5-flash', 'envoy-draft-v2', 'success', 'L3', 1500),
  ('ffffffff-0000-0000-0000-000000000097', 'chronicle', :org_id,
   'aaaaaaaa-0000-0000-0000-000000000010',
   'gemini-2.5-flash', 'chronicle-draft-v2', 'success', 'L3', 1800),
  ('ffffffff-0000-0000-0000-000000000098', 'architect', :rival_org_id, null,
   'gemini-2.5-flash', 'architect-plan-v1', 'success', 'L3', 4000);

-- A second reviewed intake, for the "run already behind another assessment" rejection.
insert into scout_intakes (
  id, org_name, contact_name_role, contact_email, mission, scale, primary_need,
  problem_description, current_systems, timeline, referral_source,
  bucket, confidence, rationale, poc_score, clarity_score, foothold_score,
  composite_signal, flags, hitl_tier,
  review_status, review_action, final_bucket, organization_id
) values (
  'cccccccc-0000-0000-0000-000000000007',
  'Second Charter Org', 'Pat Doe, ED', 'pat@example.org', 'Housing.',
  '4 sites', 'analyze_data', 'Cannot see waitlists.', 'Spreadsheets',
  'Next quarter', 'Referral',
  'Analytics & Insight', 'High', 'Clear need.', 3, 3, 3, 'Ready', '{}', 'L2',
  'reviewed', 'redirected', 'Data Infrastructure', :org_id
);

create or replace function tests.envoy_payload(eng uuid, src text default 'model') returns jsonb
language sql as $$
  select jsonb_build_object(
    'engagement_id', eng, 'occasion', 'kickoff',
    'subject', 'Kicking off', 'body', 'Hi team, we are glad to begin.',
    'source', src, 'prompt_version', 'envoy-draft-v2'
  )
$$;

create or replace function tests.chronicle_payload(eng uuid, readiness text default 'ready',
                                                   src text default 'model') returns jsonb
language sql as $$
  select jsonb_build_object(
    'engagement_id', eng, 'readiness', readiness,
    'headline', 'Working with Alice Nonprofit', 'narrative', 'They completed an engagement.',
    'outcomes', jsonb_build_array('Reporting in place'),
    'source', src, 'prompt_version', 'chronicle-draft-v2'
  )
$$;

-- Who may call ---------------------------------------------------------------

select tests.logout();

select throws_ok(
  $$ select submit_envoy_draft(tests.envoy_payload('aaaaaaaa-0000-0000-0000-000000000010'),
                               'envoy-key-anon', null) $$,
  '42501', null,
  'anon cannot submit an Envoy draft (0004_drafts: execute not granted)'
);
select throws_ok(
  $$ select submit_chronicle_draft(tests.chronicle_payload('aaaaaaaa-0000-0000-0000-000000000020'),
                                   'chronicle-key-anon', null) $$,
  '42501', null,
  'anon cannot submit a Chronicle draft (0004_drafts: execute not granted)'
);

select tests.login_as(:alice_id);

select throws_ok(
  $$ select submit_envoy_draft(tests.envoy_payload('aaaaaaaa-0000-0000-0000-000000000010'),
                               'envoy-key-alice', null) $$,
  '42501', null,
  'a non-admin cannot submit an Envoy draft (0004_drafts: is_admin)'
);
select throws_ok(
  $$ select submit_chronicle_draft(tests.chronicle_payload('aaaaaaaa-0000-0000-0000-000000000020'),
                                   'chronicle-key-alice', null) $$,
  '42501', null,
  'a non-admin cannot submit a Chronicle draft (0004_drafts: is_admin)'
);

select tests.login_as(:rival_id);

select throws_ok(
  $$ select submit_envoy_draft(tests.envoy_payload('aaaaaaaa-0000-0000-0000-000000000010'),
                               'envoy-key-rival', null) $$,
  '42501', null,
  'an admin of another org cannot submit into this org''s engagement (0004_drafts: Envoy)'
);
select throws_ok(
  $$ select submit_chronicle_draft(tests.chronicle_payload('aaaaaaaa-0000-0000-0000-000000000020'),
                                   'chronicle-key-rival', null) $$,
  '42501', null,
  'an admin of another org cannot submit into this org''s engagement (0004_drafts: Chronicle)'
);

select tests.as_service();

select throws_ok(
  $$ select public.submit_envoy_draft('{}'::jsonb, 'envoy-key-service') $$,
  '42501', null,
  'service_role cannot submit an Envoy draft — the handler uses the caller''s JWT (0004_drafts)'
);
select throws_ok(
  $$ select public.submit_chronicle_draft('{}'::jsonb, 'chronicle-key-service') $$,
  '42501', null,
  'service_role cannot submit a Chronicle draft — the handler uses the caller''s JWT (0004_drafts)'
);

reset role;
select tests.login_as(:admin_id);

-- Rejected inputs ------------------------------------------------------------

select throws_ok(
  $$ select submit_envoy_draft(tests.envoy_payload('aaaaaaaa-0000-0000-0000-0000000000ff'),
                               'envoy-key-unknown', null) $$,
  'P0002', null,
  'an Envoy draft for an unknown engagement is refused (0004_drafts)'
);
select throws_ok(
  $$ select submit_chronicle_draft(tests.chronicle_payload('aaaaaaaa-0000-0000-0000-0000000000ff'),
                                   'chronicle-key-unknown', null) $$,
  'P0002', null,
  'a Chronicle draft for an unknown engagement is refused (0004_drafts)'
);
select throws_ok(
  $$ select submit_chronicle_draft(tests.chronicle_payload('bbbbbbbb-0000-0000-0000-000000000010'),
                                   'chronicle-key-nomember', null) $$,
  '55000', null,
  'a Chronicle draft needs a membership-stage engagement on the business (0004_drafts gate)'
);
select throws_ok(
  $$ select submit_chronicle_draft(tests.chronicle_payload('aaaaaaaa-0000-0000-0000-000000000020',
                                                           'not_ready', 'fallback'),
                                   'chronicle-key-notready', null) $$,
  '22023', null,
  'a not_ready Chronicle draft is refused — it saves nothing (chronicle.md §1)'
);
select throws_ok(
  $$ select submit_envoy_draft(tests.envoy_payload('aaaaaaaa-0000-0000-0000-000000000010'),
                               'envoy-key-wrongrun', 'ffffffff-0000-0000-0000-000000000092') $$,
  '22023', null,
  'an Envoy draft can link only an Envoy agent_run, not a Chronicle one (0004_drafts)'
);
select throws_ok(
  $$ select submit_chronicle_draft(tests.chronicle_payload('aaaaaaaa-0000-0000-0000-000000000020'),
                                   'chronicle-key-wrongrun', 'ffffffff-0000-0000-0000-000000000091') $$,
  '22023', null,
  'a Chronicle draft can link only a Chronicle agent_run, not an Envoy one (0004_drafts)'
);
select throws_ok(
  $$ select submit_envoy_draft(tests.envoy_payload('aaaaaaaa-0000-0000-0000-000000000010'),
                               'envoy-key-norun', null) $$,
  '22023', null,
  'source ''model'' with no run and no payload.model is refused for Envoy (0004_drafts)'
);
select throws_ok(
  $$ select submit_chronicle_draft(tests.chronicle_payload('aaaaaaaa-0000-0000-0000-000000000020'),
                                   'chronicle-key-norun', null) $$,
  '22023', null,
  'source ''model'' with no run and no payload.model is refused for Chronicle (0004_drafts)'
);
select throws_ok(
  $$ select submit_envoy_draft(tests.envoy_payload('aaaaaaaa-0000-0000-0000-000000000010'),
                               'envoy-key-failedrun', 'ffffffff-0000-0000-0000-000000000093') $$,
  '22023', null,
  'source ''model'' cannot ride on a run that fell back (0004_drafts)'
);
select throws_ok(
  $$ select submit_envoy_draft(tests.envoy_payload('aaaaaaaa-0000-0000-0000-000000000010'),
                               'envoy-key-otherengrun', 'ffffffff-0000-0000-0000-000000000096') $$,
  '22023', null,
  'an Envoy draft cannot link a run recorded for another engagement (0004_drafts)'
);
select throws_ok(
  $$ select submit_chronicle_draft(tests.chronicle_payload('aaaaaaaa-0000-0000-0000-000000000020'),
                                   'chronicle-key-otherengrun', 'ffffffff-0000-0000-0000-000000000097') $$,
  '22023', null,
  'a Chronicle draft cannot link a run recorded for another engagement (0004_drafts)'
);

-- The happy path ---------------------------------------------------------------

select lives_ok(
  $$ select submit_envoy_draft(tests.envoy_payload('aaaaaaaa-0000-0000-0000-000000000010'),
                               'envoy-key-0001', 'ffffffff-0000-0000-0000-000000000091') $$,
  'an admin CAN submit an Envoy draft (0004_drafts)'
);
select lives_ok(
  $$ select submit_chronicle_draft(tests.chronicle_payload('aaaaaaaa-0000-0000-0000-000000000020'),
                                   'chronicle-key-0001', 'ffffffff-0000-0000-0000-000000000092') $$,
  'an admin CAN submit a Chronicle draft (0004_drafts)'
);

select results_eq(
  $$ select hitl_tier, status, agent, entity_type, entity_id, draft_id is not null
       from approvals where idempotency_key = 'envoy-key-0001' $$,
  $$ values ('L3'::text, 'pending'::text, 'envoy'::text, 'communication'::text,
             'aaaaaaaa-0000-0000-0000-000000000010'::uuid, true) $$,
  'the Envoy submit opens a pending L3 communication approval on the engagement, pointing at the draft'
);
select results_eq(
  $$ select hitl_tier, status, agent, entity_type, entity_id, draft_id is not null
       from approvals where idempotency_key = 'chronicle-key-0001' $$,
  $$ values ('L3'::text, 'pending'::text, 'chronicle'::text, 'story'::text,
             'aaaaaaaa-0000-0000-0000-000000000020'::uuid, true) $$,
  'the Chronicle submit opens a pending L3 story approval on the engagement, pointing at the draft'
);

select results_eq(
  $$ select c.source_type::text, c.generated_by, c.model, c.prompt_version, c.run_id,
            c.status, c.sent_at is null, c.created_by
       from communications c join approvals a on a.draft_id = c.id
      where a.idempotency_key = 'envoy-key-0001' $$,
  $$ values ('ai'::text, 'envoy'::text, 'gemini-2.5-flash'::text, 'envoy-draft-v2'::text,
             'ffffffff-0000-0000-0000-000000000091'::uuid, 'draft'::text, true,
             '33333333-3333-3333-3333-333333333333'::uuid) $$,
  'the communication carries provenance copied from its run, is a draft and is unsent (0004_drafts)'
);
select results_eq(
  $$ select d.source_type::text, d.generated_by, d.model, d.prompt_version, d.run_id,
            d.status, d.provisional
       from chronicle_drafts d join approvals a on a.draft_id = d.id
      where a.idempotency_key = 'chronicle-key-0001' $$,
  $$ values ('ai'::text, 'chronicle'::text, 'gemini-2.5-flash'::text, 'chronicle-draft-v2'::text,
             'ffffffff-0000-0000-0000-000000000092'::uuid, 'draft'::text, false) $$,
  'the Chronicle draft carries provenance copied from its run; ready is not provisional (0004_drafts)'
);

-- Replay -----------------------------------------------------------------------

select results_eq(
  $$ select submit_envoy_draft(tests.envoy_payload('aaaaaaaa-0000-0000-0000-000000000010'),
                               'envoy-key-0001', 'ffffffff-0000-0000-0000-000000000091') $$,
  $$ select jsonb_build_object('approval_id', id, 'draft_id', draft_id)
       from approvals where idempotency_key = 'envoy-key-0001' $$,
  'a replayed Envoy key returns the original approval and draft (design-system.md §8.1)'
);
select results_eq(
  $$ select submit_chronicle_draft(tests.chronicle_payload('aaaaaaaa-0000-0000-0000-000000000020'),
                                   'chronicle-key-0001', 'ffffffff-0000-0000-0000-000000000092') $$,
  $$ select jsonb_build_object('approval_id', id, 'draft_id', draft_id,
                               'lesson_id', (select l.id from lessons l
                                              where l.engagement_id = 'aaaaaaaa-0000-0000-0000-000000000020'))
       from approvals where idempotency_key = 'chronicle-key-0001' $$,
  'a replayed Chronicle key returns the original approval, draft and (0004_drafts) lesson (design-system.md §8.1)'
);
select results_eq(
  $$ select (select count(*) from communications)::int,
            (select count(*) from chronicle_drafts)::int $$,
  $$ values (1, 1) $$,
  'a replay writes no second draft row'
);
select throws_ok(
  $$ select submit_envoy_draft(tests.envoy_payload('aaaaaaaa-0000-0000-0000-000000000010'),
                               'chronicle-key-0001', 'ffffffff-0000-0000-0000-000000000091') $$,
  '22023', null,
  'a key already used for a Chronicle draft cannot be replayed as an Envoy one (0004_drafts)'
);

-- A run already behind a draft cannot back another one.
select throws_ok(
  $$ select submit_envoy_draft(tests.envoy_payload('aaaaaaaa-0000-0000-0000-000000000010'),
                               'envoy-key-reuse', 'ffffffff-0000-0000-0000-000000000091') $$,
  '22023', null,
  'an Envoy run that already backs a draft cannot back a second (0004_drafts)'
);
select throws_ok(
  $$ select submit_chronicle_draft(tests.chronicle_payload('aaaaaaaa-0000-0000-0000-000000000020'),
                                   'chronicle-key-reuse', 'ffffffff-0000-0000-0000-000000000092') $$,
  '22023', null,
  'a Chronicle run that already backs a draft cannot back a second (0004_drafts)'
);

-- Supersede --------------------------------------------------------------------

select lives_ok(
  $$ select submit_envoy_draft(tests.envoy_payload('aaaaaaaa-0000-0000-0000-000000000010'),
                               'envoy-key-0002', 'ffffffff-0000-0000-0000-000000000094') $$,
  'an admin CAN re-submit an Envoy draft under a new key (0004_drafts)'
);
select results_eq(
  $$ select status from approvals where idempotency_key = 'envoy-key-0001' $$,
  $$ values ('expired'::text) $$,
  'an Envoy re-submit expires the previous pending approval'
);
select results_eq(
  $$ select count(*)::int
       from communications c join approvals a on a.draft_id = c.id
      where a.idempotency_key = 'envoy-key-0002'
        and c.supersedes_id = (select draft_id from approvals
                                where idempotency_key = 'envoy-key-0001') $$,
  $$ values (1) $$,
  'the new communication points at the one it supersedes'
);

-- A different occasion is a different thread: it supersedes nothing.
select lives_ok(
  $$ select submit_envoy_draft(
       tests.envoy_payload('aaaaaaaa-0000-0000-0000-000000000010') || '{"occasion":"check_in"}',
       'envoy-key-0003', 'ffffffff-0000-0000-0000-000000000095') $$,
  'an admin CAN draft a second occasion for the same engagement (0004_drafts)'
);
select results_eq(
  $$ select count(*)::int from approvals
      where agent = 'envoy' and status = 'pending'
        and entity_id = 'aaaaaaaa-0000-0000-0000-000000000010' $$,
  $$ values (2) $$,
  'a draft for another occasion leaves the kickoff approval pending'
);

select lives_ok(
  $$ select submit_chronicle_draft(
       tests.chronicle_payload('aaaaaaaa-0000-0000-0000-000000000020', 'thin', 'fallback'),
       'chronicle-key-0002', null) $$,
  'an admin CAN re-submit a Chronicle draft as a fallback with no run (0004_drafts)'
);
select results_eq(
  $$ select status from approvals where idempotency_key = 'chronicle-key-0001' $$,
  $$ values ('expired'::text) $$,
  'a Chronicle re-submit expires the previous pending approval'
);
select results_eq(
  $$ select count(*)::int
       from chronicle_drafts d join approvals a on a.draft_id = d.id
      where a.idempotency_key = 'chronicle-key-0002'
        and d.supersedes_id = (select draft_id from approvals
                                where idempotency_key = 'chronicle-key-0001') $$,
  $$ values (1) $$,
  'the new Chronicle draft points at the one it supersedes'
);
select results_eq(
  $$ select d.source_type::text, d.model, d.run_id, d.provisional
       from chronicle_drafts d join approvals a on a.draft_id = d.id
      where a.idempotency_key = 'chronicle-key-0002' $$,
  $$ values ('derived'::text, null::text, null::uuid, true) $$,
  'a fallback draft is derived with no model or run, and thin is provisional (0004_drafts)'
);

-- A model draft whose run the recorder failed to write is still saved (0004_drafts header): the
-- handler names the model, the row is 'ai' with no run, the audit event flags it.
select lives_ok(
  $$ select submit_envoy_draft(
       tests.envoy_payload('aaaaaaaa-0000-0000-0000-000000000010')
         || '{"occasion":"wrap_up","model":"gemini-2.5-flash"}',
       'envoy-key-unrecorded', null) $$,
  'an Envoy model draft with no recorded run but a named model is saved (0004_drafts)'
);
select results_eq(
  $$ select c.source_type::text, c.model, c.run_id
       from communications c join approvals a on a.draft_id = c.id
      where a.idempotency_key = 'envoy-key-unrecorded' $$,
  $$ values ('ai'::text, 'gemini-2.5-flash'::text, null::uuid) $$,
  'an unrecorded-run Envoy draft is ai with the named model and no run_id (0004_drafts)'
);
select lives_ok(
  $$ select submit_chronicle_draft(
       tests.chronicle_payload('aaaaaaaa-0000-0000-0000-000000000020')
         || '{"model":"gemini-2.5-flash"}',
       'chronicle-key-unrecorded', null) $$,
  'a Chronicle model draft with no recorded run but a named model is saved (0004_drafts)'
);
select results_eq(
  $$ select d.source_type::text, d.model, d.run_id
       from chronicle_drafts d join approvals a on a.draft_id = d.id
      where a.idempotency_key = 'chronicle-key-unrecorded' $$,
  $$ values ('ai'::text, 'gemini-2.5-flash'::text, null::uuid) $$,
  'an unrecorded-run Chronicle draft is ai with the named model and no run_id (0004_drafts)'
);

-- Architect provenance (0004_drafts §d) -------------------------------------------------

select results_eq(
  $$ select source_type::text, generated_by, model, prompt_version, run_id
       from architect_assessments where id = 'cccccccc-0000-0000-0000-000000000009' $$,
  $$ values ('ai'::text, 'architect'::text, 'gemini-2.5-flash'::text, 'architect-plan-v1'::text,
             'ffffffff-0000-0000-0000-000000000090'::uuid) $$,
  'an Architect draft carries provenance copied from its run (0004_drafts)'
);
select throws_ok(
  $$ select submit_architect_draft(tests.architect_draft('cccccccc-0000-0000-0000-000000000009'),
                                   'architect-key-norun', null) $$,
  '22023', null,
  'an Architect draft claiming ''model'' with no run and no payload.model is refused (0004_drafts)'
);
select throws_ok(
  $$ select submit_architect_draft(tests.architect_draft('cccccccc-0000-0000-0000-000000000009'),
                                   'architect-key-otherorg', 'ffffffff-0000-0000-0000-000000000098') $$,
  '22023', null,
  'an Architect draft cannot link a run recorded for another organization (0004_drafts)'
);
select throws_ok(
  $$ select submit_architect_draft(tests.architect_draft('cccccccc-0000-0000-0000-000000000007'),
                                   'architect-key-reuse', 'ffffffff-0000-0000-0000-000000000090') $$,
  '22023', null,
  'an Architect run already behind another assessment cannot back a second (0004_drafts)'
);
select lives_ok(
  $$ select submit_architect_draft(
       tests.architect_draft('cccccccc-0000-0000-0000-000000000009')
         || '{"model":"gemini-2.5-flash","prompt_version":"architect-plan-v1"}',
       'architect-key-unrecorded', null) $$,
  'an Architect model draft with no recorded run but a named model is saved (0004_drafts)'
);
select results_eq(
  $$ select source_type::text, model, run_id
       from architect_assessments where id = 'cccccccc-0000-0000-0000-000000000009' $$,
  $$ values ('ai'::text, 'gemini-2.5-flash'::text, null::uuid) $$,
  'an unrecorded-run Architect draft is ai with the named model and no run_id (0004_drafts)'
);
select lives_ok(
  $$ select submit_architect_draft(
       tests.architect_draft('cccccccc-0000-0000-0000-000000000009') || '{"source":"fallback"}',
       'architect-key-fallback', null) $$,
  'an Architect fallback draft needs no run (0004_drafts)'
);
select results_eq(
  $$ select source_type::text, model, run_id
       from architect_assessments where id = 'cccccccc-0000-0000-0000-000000000009' $$,
  $$ values ('derived'::text, null::text, null::uuid) $$,
  'a re-conduct as a fallback replaces the AI provenance with derived (0004_drafts)'
);

-- The direct write path is closed ------------------------------------------------

select throws_ok(
  $$ insert into communications (organization_id, engagement_id, occasion, subject, body,
                                 created_by, source_type)
     values ('eeeeeeee-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000010',
             'kickoff', 's', 'b', '33333333-3333-3333-3333-333333333333', 'derived') $$,
  '42501', null,
  'an admin cannot insert a communication directly — only submit_envoy_draft() writes (0004_drafts)'
);
select throws_ok(
  $$ insert into chronicle_drafts (organization_id, engagement_id, readiness, headline, narrative,
                                   created_by, source_type)
     values ('eeeeeeee-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000020',
             'ready', 'h', 'n', '33333333-3333-3333-3333-333333333333', 'derived') $$,
  '42501', null,
  'an admin cannot insert a Chronicle draft directly — only submit_chronicle_draft() writes (0004_drafts)'
);
select throws_ok(
  $$ update communications set body = 'edited' $$,
  '42501', null,
  'an admin cannot update a communication directly (0004_drafts)'
);
select throws_ok(
  $$ delete from communications $$,
  '42501', null,
  'an admin cannot delete a communication (0004_drafts)'
);
select throws_ok(
  $$ delete from chronicle_drafts $$,
  '42501', null,
  'an admin cannot delete a Chronicle draft (chronicle.md, 0004_drafts)'
);

-- Who may read -----------------------------------------------------------------

select results_eq(
  $$ select (select count(*) from communications) > 0,
            (select count(*) from chronicle_drafts) > 0 $$,
  $$ values (true, true) $$,
  'an admin of the org reads its drafts (0004_drafts)'
);

select tests.login_as(:alice_id);

select is_empty(
  $$ select id from communications $$,
  'a partner cannot read communication drafts — staff-facing until sent (0004_drafts)'
);
select is_empty(
  $$ select id from chronicle_drafts $$,
  'a partner cannot read Chronicle drafts — staff-facing until approved (0004_drafts)'
);

select tests.login_as(:rival_id);

select is_empty(
  $$ select id from communications $$,
  'an admin of another org cannot read this org''s communication drafts (0004_drafts)'
);
select is_empty(
  $$ select id from chronicle_drafts $$,
  'an admin of another org cannot read this org''s Chronicle drafts (0004_drafts)'
);

-- Write-once content: the trigger holds even for the superuser (RLS and grants do not
-- apply to it), so it is the last line against an edit that skips the supersedes chain.
reset role;

select throws_ok(
  $$ update communications set body = 'edited' $$,
  '23514', null,
  'communication content is immutable — an edit is a new row with supersedes_id (0004_drafts trigger)'
);
select throws_ok(
  $$ update chronicle_drafts set narrative = 'edited' $$,
  '23514', null,
  'Chronicle content is immutable — an edit is a new row with supersedes_id (0004_drafts trigger)'
);
select throws_ok(
  $$ update communications set model = null, source_type = 'human' $$,
  '23514', null,
  'communication provenance is immutable — a human edit cannot rewrite the AI original (0004_drafts trigger)'
);
select lives_ok(
  $$ update communications set status = 'approved', approved_by = '33333333-3333-3333-3333-333333333333',
                               approved_at = now() $$,
  'the decision fields of a communication can still move (0004_drafts trigger)'
);


-- ---------------------------------------------------------------------------
-- transition_engagement() / current_engagement_stage() — 0005_lifecycle (R7: the single writer of
-- engagement stage; crm/lifecycle.md §2-§5).
--
-- Fixtures, as the superuser. Alice's business BIZ has NO engagement rows and a reviewed,
-- approved intake: the first transition creates its row. BIZ2 has no intake (the row-1
-- guard must refuse it). BIZ3-5 are hand-built row sets for the derivation rule.
-- ---------------------------------------------------------------------------

reset role;

insert into scout_intakes (
  id, org_name, contact_name_role, contact_email, mission, scale, primary_need,
  problem_description, current_systems, timeline, referral_source,
  bucket, confidence, rationale, poc_score, clarity_score, foothold_score,
  composite_signal, flags, hitl_tier,
  review_status, review_action, final_bucket, organization_id
) values (
  'abcd0013-0000-0000-0000-0000000000a1',
  'Transition Org', 'Lee Kim, ED', 'lee@example.org', 'Youth programs.',
  '300 youth', 'analyze_data', 'Cannot show outcomes.', 'Spreadsheets',
  'Next quarter', 'Referral',
  'Analytics & Insight', 'High', 'Clear need.', 3, 3, 3, 'Ready', '{}', 'L2',
  'reviewed', 'approved', 'Analytics & Insight', :org_id
);

-- The assessment for that intake (its id IS the intake id, 0001_core). Inserted with the admin's
-- claim set so the author trigger sees the admin, as the 0001_core section above does.
select tests.login_as(:admin_id);
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
       'abcd0013-0000-0000-0000-0000000000a1', 'abcd0013-0000-0000-0000-0000000000a1',
       'Transition Org', 'Analytics & Insight', 'Ready',
       'ctx', 'size', 'poc', 'partial', 'locations', 'some_share',
       'somewhat_familiar', 'mixed', 'now', 'wished', 'leadership_managers',
       'board', 'semi_automated', '{spreadsheets}', 'some_adhoc', 'requires_approval',
       'wish', 'worry', 'blockers', 2, 2, 2, 2, 2, 10, 'Developing',
       '{}'::jsonb, '{}'::jsonb,
       '33333333-3333-3333-3333-333333333333', 'admin@dssg.nyc'
     );

-- scout_intake_id is writable only by a non-API role (0001_core trigger); the fixture is the
-- superuser standing in for the future Scout-approve definer function (T2).
insert into businesses (id, name, type, owner_id, organization_id, scout_intake_id) values
  ('abcd0013-0000-0000-0000-000000000001', 'Transition Org', 'nonprofit', :alice_id, :org_id,
   'abcd0013-0000-0000-0000-0000000000a1'),
  ('abcd0013-0000-0000-0000-000000000002', 'No Intake Org', 'nonprofit', :alice_id, :org_id, null),
  ('abcd0013-0000-0000-0000-000000000003', 'Two Completed', 'nonprofit', :alice_id, :org_id, null),
  ('abcd0013-0000-0000-0000-000000000004', 'Stale In Progress', 'nonprofit', :alice_id, :org_id, null),
  ('abcd0013-0000-0000-0000-000000000005', 'Pending Only', 'nonprofit', :alice_id, :org_id, null);

insert into engagements (business_id, owner_id, stage, status, organization_id) values
  ('abcd0013-0000-0000-0000-000000000003', :alice_id, 'initial_meeting', 'completed', :org_id),
  ('abcd0013-0000-0000-0000-000000000003', :alice_id, 'budget_check',    'completed', :org_id),
  ('abcd0013-0000-0000-0000-000000000004', :alice_id, 'initial_meeting', 'in_progress', :org_id),
  ('abcd0013-0000-0000-0000-000000000004', :alice_id, 'budget_check',    'completed', :org_id),
  ('abcd0013-0000-0000-0000-000000000005', :alice_id, 'initial_meeting', 'pending', :org_id),
  ('abcd0013-0000-0000-0000-000000000005', :alice_id, 'budget_check',    'pending', :org_id);

-- Who may call ---------------------------------------------------------------

select tests.logout();

select throws_ok(
  $$ select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                  'initial_meeting', null, 'tx-key-anon-0001') $$,
  '42501', null,
  'anon cannot transition an engagement (0005_lifecycle: execute not granted)'
);

select tests.login_as(:alice_id);

select throws_ok(
  $$ select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                  'initial_meeting', null, 'tx-key-alice-0001') $$,
  '42501', null,
  'a partner cannot transition their own engagement (0005_lifecycle: is_admin)'
);

select tests.login_as(:rival_id);

select throws_ok(
  $$ select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                  'initial_meeting', null, 'tx-key-rival-0001') $$,
  '42501', null,
  'an admin of another org cannot transition this org''s business (0005_lifecycle)'
);

select tests.as_service();

select throws_ok(
  $$ select public.transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                         'initial_meeting', null, 'tx-key-service-0001') $$,
  '42501', null,
  'service_role cannot transition an engagement — the handler uses the caller''s JWT (0005_lifecycle)'
);

reset role;
select tests.login_as(:admin_id);

-- Rejected inputs ------------------------------------------------------------

select throws_ok(
  $$ select transition_engagement('abcd0013-0000-0000-0000-0000000000ff',
                                  'initial_meeting', null, 'tx-key-nobiz-0001') $$,
  'P0002', null,
  'transitioning a business that does not exist is P0002 (0005_lifecycle)'
);

select throws_ok(
  $$ select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                  'initial_meeting', null, 'short') $$,
  '22023', null,
  'an idempotency key under 8 characters is refused (0005_lifecycle)'
);

select throws_ok(
  $$ select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                  'budget_check', 'skipping ahead', 'tx-key-skip-0000') $$,
  '22023', 'stage_skipped',
  'with no stage yet, only initial_meeting is a valid first move (0005_lifecycle)'
);

select throws_ok(
  $$ select transition_engagement('abcd0013-0000-0000-0000-000000000002',
                                  'initial_meeting', null, 'tx-key-nointake-0001') $$,
  '55000', 'guard:intake_approved',
  'initial_meeting is refused without a reviewed approved/edited intake (0005_lifecycle guard)'
);

select is_empty(
  $$ select id from engagements where business_id = 'abcd0013-0000-0000-0000-000000000002' $$,
  'a refused transition writes nothing (0005_lifecycle)'
);

-- First transition: row 1, pre-approved, so no approvals row ----------------------

select is(
  (select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                'initial_meeting', null, 'tx-first-0001')->>'to_stage'),
  'initial_meeting',
  'an admin opens initial_meeting for a business with no rows (0005_lifecycle)'
);

select results_eq(
  $$ select stage::text, status::text from engagements
      where business_id = 'abcd0013-0000-0000-0000-000000000001' $$,
  $$ values ('initial_meeting'::text, 'in_progress'::text) $$,
  'the first transition inserts the initial_meeting row at in_progress (0005_lifecycle)'
);

select is(
  (select count(*)::int from engagement_events
    where kind = 'stage_advanced'
      and engagement_id in (select id from engagements
                             where business_id = 'abcd0013-0000-0000-0000-000000000001')),
  1,
  'the first transition writes one stage_advanced event (0005_lifecycle)'
);

select is(
  (select count(*)::int from audit_events
    where action = 'engagement.transition'
      and entity_id in (select id from engagements
                         where business_id = 'abcd0013-0000-0000-0000-000000000001')),
  1,
  'the first transition writes one engagement.transition audit event (0005_lifecycle)'
);

select is(
  (select count(*)::int from approvals
    where entity_type = 'transition'
      and entity_id in (select id from engagements
                         where business_id = 'abcd0013-0000-0000-0000-000000000001')),
  0,
  'row 1 is pre-approved by the Scout review: no approvals row (0005_lifecycle)'
);

-- Replay ---------------------------------------------------------------------

select is(
  (select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                'initial_meeting', null, 'tx-first-0001')->>'replayed'),
  'true',
  'replaying an idempotency key reports replayed = true (0005_lifecycle)'
);

select is(
  (select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                'initial_meeting', null, 'tx-first-0001')->>'event_id'),
  (select id::text from engagement_events where idempotency_key = 'tx-first-0001'),
  'a replay returns the original event id (0005_lifecycle)'
);

select is(
  (select count(*)::int from engagements where business_id = 'abcd0013-0000-0000-0000-000000000001'),
  1,
  'a replay writes no second row (0005_lifecycle)'
);

select throws_ok(
  $$ select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                  'budget_check', 'reuse', 'tx-first-0001') $$,
  '22023', null,
  'an idempotency key reused for a different target is refused (0005_lifecycle)'
);

select throws_ok(
  $$ select transition_engagement('abcd0013-0000-0000-0000-000000000002',
                                  'initial_meeting', null, 'tx-first-0001') $$,
  '22023', null,
  'an idempotency key reused for a different business is refused (0005_lifecycle)'
);

-- Classification -------------------------------------------------------------

select throws_ok(
  $$ select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                  'initial_meeting', null, 'tx-key-same-0001') $$,
  '22023', 'invalid_transition',
  'moving to the current stage is invalid_transition (0005_lifecycle)'
);

select throws_ok(
  $$ select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                  'data_ethics_committee', 'skip', 'tx-key-skip-0001') $$,
  '22023', 'stage_skipped',
  'initial_meeting -> data_ethics_committee skips a stage (0005_lifecycle)'
);

-- budget_check: attested until engagement_contracts exists ---------------------------

select throws_ok(
  $$ select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                  'budget_check', null, 'tx-key-budget-0000') $$,
  '55000', 'guard:contract_signed',
  'budget_check without a reason fails the attested contract guard (0005_lifecycle)'
);

select is(
  (select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                'budget_check', 'Charter signed 2026-10-01',
                                'tx-budget-0001')->>'to_stage'),
  'budget_check',
  'budget_check advances with an attestation reason (0005_lifecycle)'
);

select is(
  (select detail->>'guard_deferred' from engagement_events
    where idempotency_key = 'tx-budget-0001'),
  'contract',
  'the attested move records guard_deferred = contract on the event (0005_lifecycle)'
);

select is(
  (select detail->>'guard_deferred' from audit_events
    where action = 'engagement.transition'
      and entity_id = (select engagement_id from engagement_events
                        where idempotency_key = 'tx-budget-0001')),
  'contract',
  'the audit_events detail records guard_deferred = contract too (0005_lifecycle)'
);

-- data_ethics_committee: budget confirmed -----------------------------------------------

select throws_ok(
  $$ select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                  'data_ethics_committee', null, 'tx-key-dec-0000') $$,
  '55000', 'guard:budget_confirmed',
  'data_ethics_committee needs budget_amount on the budget_check row (0005_lifecycle)'
);

reset role;
update engagements set budget_amount = 25000
 where business_id = 'abcd0013-0000-0000-0000-000000000001' and stage = 'budget_check';
select tests.login_as(:admin_id);

select is(
  (select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                'data_ethics_committee', null, 'tx-dec-0001')->>'to_stage'),
  'data_ethics_committee',
  'data_ethics_committee advances once the budget is confirmed (0005_lifecycle)'
);

-- scoping: an approved assessment approval; L3 recorded ----------------------------------

select throws_ok(
  $$ select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                  'scoping', null, 'tx-key-scoping-0000') $$,
  '55000', 'guard:ethics_approved',
  'scoping needs an approved assessment approval for this business (0005_lifecycle)'
);

-- The ethics committee's approval, as the superuser (no writer exists yet, lifecycle.md §4).
reset role;
insert into approvals (organization_id, agent, entity_type, entity_id, hitl_tier, status,
                       reviewer_id, reviewed_at)
values (:org_id, 'architect', 'assessment', 'abcd0013-0000-0000-0000-0000000000a1', 'L3',
        'approved', :admin_id, now());
select tests.login_as(:admin_id);

select is(
  (select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                'scoping', null, 'tx-scoping-0001')->>'to_stage'),
  'scoping',
  'scoping advances once the committee approval exists (0005_lifecycle)'
);

select results_eq(
  $$ select agent, entity_type, status, reviewer_id::text, hitl_tier from approvals
      where entity_type = 'transition'
        and entity_id = (select id from engagements
                          where business_id = 'abcd0013-0000-0000-0000-000000000001'
                            and stage = 'scoping') $$,
  $$ values ('system'::text, 'transition'::text, 'approved'::text,
             '33333333-3333-3333-3333-333333333333'::text, 'L3'::text) $$,
  'an L3 transition records a system/transition approval, approved by the caller (0005_lifecycle)'
);

select is(
  (select detail->>'approval_id' from engagement_events
    where idempotency_key = 'tx-scoping-0001'),
  (select id::text from approvals
    where entity_type = 'transition'
      and entity_id = (select id from engagements
                        where business_id = 'abcd0013-0000-0000-0000-000000000001'
                          and stage = 'scoping')),
  'the event names the approval it recorded (0005_lifecycle)'
);

-- Reversal: a named, recorded move; history is kept ----------------------------------

select throws_ok(
  $$ select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                  'budget_check', null, 'tx-key-revert-0000') $$,
  '22023', 'reason_required',
  'a reversal without a reason is refused (0005_lifecycle)'
);

select is(
  (select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                'budget_check', 'Budget withdrawn by the board',
                                'tx-revert-0001')->>'to_stage'),
  'budget_check',
  'a reversal with a reason moves back to the earlier stage (0005_lifecycle)'
);

select results_eq(
  $$ select stage::text, status::text from engagements
      where business_id = 'abcd0013-0000-0000-0000-000000000001'
      order by engagements.stage $$,  -- the enum, not the text alias
  $$ values ('initial_meeting'::text, 'completed'::text),
            ('budget_check'::text, 'in_progress'::text),
            ('data_ethics_committee'::text, 'completed'::text),
            ('scoping'::text, 'completed'::text) $$,
  'a reversal reopens the target, completes the source and leaves the rest alone (0005_lifecycle)'
);

select is(
  (select count(*)::int from engagement_events
    where kind = 'stage_reverted'
      and engagement_id in (select id from engagements
                             where business_id = 'abcd0013-0000-0000-0000-000000000001')),
  1,
  'a reversal writes a stage_reverted event (0005_lifecycle)'
);

select is(
  (select count(*)::int from approvals
    where entity_type = 'transition'
      and entity_id in (select id from engagements
                         where business_id = 'abcd0013-0000-0000-0000-000000000001')),
  2,
  'the L3 advance and the reversal each recorded an approval; no L2 move did (0005_lifecycle)'
);

-- Re-advance over rows that already exist: flipped back, never duplicated ------------------

select is(
  (select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                'data_ethics_committee', null, 'tx-dec-0002')->>'to_stage'),
  'data_ethics_committee',
  'a re-advance after a reversal reopens the existing completed row (0005_lifecycle)'
);

select is(
  (select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                'scoping', null, 'tx-scoping-0002')->>'to_stage'),
  'scoping',
  'a second advance into scoping reopens its completed row (0005_lifecycle)'
);

select is(
  (select count(*)::int from engagements where business_id = 'abcd0013-0000-0000-0000-000000000001'),
  4,
  'reversals and re-advances never create a second row for a stage (0005_lifecycle)'
);

-- The terminal lock is intact outside the command. As service_role: an admin's own UPDATE
-- is filtered by RLS before the trigger sees a row, and the superuser (like the definer
-- function) is let through, so service_role is the role that proves the lock.
select tests.as_service();

select throws_ok(
  $$ update engagements set status = 'in_progress'
      where business_id = 'abcd0013-0000-0000-0000-000000000001' and stage = 'initial_meeting' $$,
  '23514', null,
  'completed -> in_progress is refused outside transition_engagement(): the lock keys on the session role (0001_core trigger)'
);

reset role;
select tests.login_as(:admin_id);

-- current_engagement_stage(): the same rule as src/lib/lifecycle.ts ------------------------

select results_eq(
  $$ select stage::text from current_engagement_stage('abcd0013-0000-0000-0000-000000000003') $$,
  $$ values ('budget_check'::text) $$,
  'with no in_progress row, the current stage is the furthest completed one (0005_lifecycle; lifecycle.md §3)'
);

select results_eq(
  $$ select stage::text from current_engagement_stage('abcd0013-0000-0000-0000-000000000004') $$,
  $$ values ('initial_meeting'::text) $$,
  'an in_progress row wins over a later completed row (0005_lifecycle; lifecycle.md §3)'
);

select is_empty(
  $$ select stage from current_engagement_stage('abcd0013-0000-0000-0000-000000000005') $$,
  'pending rows never make a stage current (0005_lifecycle)'
);

-- Staff append events -----------------------------------------------------------------

select lives_ok(
  $$ insert into engagement_events (engagement_id, organization_id, kind, created_by)
     select id, organization_id, 'session_held', '33333333-3333-3333-3333-333333333333'
       from engagements
      where business_id = 'abcd0013-0000-0000-0000-000000000001' and stage = 'scoping' $$,
  'an admin can append a session_held event to an engagement in their org (0005_lifecycle)'
);

select throws_ok(
  $$ insert into engagement_events (engagement_id, organization_id, kind, created_by)
     select id, organization_id, 'session_held', '11111111-1111-1111-1111-111111111111'
       from engagements
      where business_id = 'abcd0013-0000-0000-0000-000000000001' and stage = 'scoping' $$,
  '42501', null,
  'an admin cannot attribute an event to someone else (0005_lifecycle)'
);

-- The rival cannot SELECT this org's engagements, so an insert-select would insert zero
-- rows and raise nothing. Carry the row id across as a custom setting instead.
select set_config('tests.scoping_id',
                  (select id::text from engagements
                    where business_id = 'abcd0013-0000-0000-0000-000000000001'
                      and stage = 'scoping'),
                  true);

select tests.login_as(:rival_id);

select throws_ok(
  $$ insert into engagement_events (engagement_id, organization_id, kind, created_by)
     values (current_setting('tests.scoping_id')::uuid, 'eeeeeeee-0000-0000-0000-000000000001',
             'session_held', '88888888-8888-8888-8888-888888888888') $$,
  '42501', null,
  'an admin of another org cannot append events to this org''s engagement (0005_lifecycle)'
);

select tests.login_as(:alice_id);

select lives_ok(
  $$ insert into engagement_events (engagement_id, organization_id, kind, created_by)
     select id, organization_id, 'note_added', '11111111-1111-1111-1111-111111111111'
       from engagements
      where business_id = 'abcd0013-0000-0000-0000-000000000001' and stage = 'scoping' $$,
  'a partner can still append note_added to their own engagement (engagement_events_insert_own)'
);

-- Lifecycle kinds and idempotency keys belong to transition_engagement() alone.
select throws_ok(
  $$ insert into engagement_events (engagement_id, organization_id, kind, created_by)
     select id, organization_id, 'stage_advanced', '11111111-1111-1111-1111-111111111111'
       from engagements
      where business_id = 'abcd0013-0000-0000-0000-000000000001' and stage = 'scoping' $$,
  '42501', null,
  'a partner cannot forge a stage_advanced event (0005_lifecycle: insert_own excludes lifecycle kinds)'
);

select throws_ok(
  $$ insert into engagement_events (engagement_id, organization_id, kind, created_by)
     select id, organization_id, 'stage_reverted', '11111111-1111-1111-1111-111111111111'
       from engagements
      where business_id = 'abcd0013-0000-0000-0000-000000000001' and stage = 'scoping' $$,
  '42501', null,
  'a partner cannot forge a stage_reverted event (0005_lifecycle)'
);

select throws_ok(
  $$ insert into engagement_events (engagement_id, organization_id, kind, created_by, idempotency_key)
     select id, organization_id, 'note_added', '11111111-1111-1111-1111-111111111111', 'squat-key-0001'
       from engagements
      where business_id = 'abcd0013-0000-0000-0000-000000000001' and stage = 'scoping' $$,
  '42501', null,
  'a partner cannot set an idempotency_key on an event (0005_lifecycle)'
);

-- businesses.scout_intake_id is the row-1 guard input: a partner cannot set it.
select throws_ok(
  $$ update businesses set scout_intake_id = 'abcd0013-0000-0000-0000-0000000000a1'
      where id = 'abcd0013-0000-0000-0000-000000000002' $$,
  '23514', null,
  'a partner cannot set businesses.scout_intake_id by update (0001_core trigger)'
);

select throws_ok(
  $$ insert into businesses (id, name, type, owner_id, organization_id, scout_intake_id)
     values ('abcd0013-0000-0000-0000-000000000006', 'Forged Intake', 'nonprofit',
             '11111111-1111-1111-1111-111111111111', 'eeeeeeee-0000-0000-0000-000000000001',
             'abcd0013-0000-0000-0000-0000000000a1') $$,
  '23514', null,
  'a partner cannot insert a business with a scout_intake_id (0001_core trigger)'
);

select tests.login_as(:admin_id);

select throws_ok(
  $$ insert into engagement_events (engagement_id, organization_id, kind, created_by)
     select id, organization_id, 'stage_advanced', '33333333-3333-3333-3333-333333333333'
       from engagements
      where business_id = 'abcd0013-0000-0000-0000-000000000001' and stage = 'scoping' $$,
  '42501', null,
  'an admin cannot forge a stage_advanced event either — only the command writes it (0005_lifecycle)'
);

-- hackathon_ready and membership: guards read the milestones ---------------------------------

select throws_ok(
  $$ select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                  'hackathon_ready', null, 'tx-key-hack-0000') $$,
  '55000', 'guard:plan_accepted',
  'hackathon_ready needs the scoping row linked to an assessment (0005_lifecycle)'
);

-- Nothing sets engagements.assessment_id yet (C2 does, on plan acceptance), so the
-- fixture does, as the superuser.
reset role;
update engagements set assessment_id = 'abcd0013-0000-0000-0000-0000000000a1'
 where business_id = 'abcd0013-0000-0000-0000-000000000001' and stage = 'scoping';
select tests.login_as(:admin_id);

select throws_ok(
  $$ select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                  'hackathon_ready', null, 'tx-key-hack-0001') $$,
  '55000', 'guard:plan_accepted',
  'hackathon_ready also needs at least one milestone (0005_lifecycle)'
);

reset role;
insert into milestones (id, engagement_id, organization_id, title, status)
select 'abcd0013-0000-0000-0000-0000000000b1', id, organization_id, 'Dashboard live', 'in_progress'
  from engagements
 where business_id = 'abcd0013-0000-0000-0000-000000000001' and stage = 'scoping';
select tests.login_as(:admin_id);

select is(
  (select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                'hackathon_ready', null, 'tx-hack-0001')->>'to_stage'),
  'hackathon_ready',
  'hackathon_ready advances with a linked assessment and a milestone (0005_lifecycle)'
);

select throws_ok(
  $$ select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                  'membership', null, 'tx-key-member-0000') $$,
  '55000', 'guard:milestones_complete',
  'membership is refused while a milestone is incomplete (0005_lifecycle)'
);

reset role;
update milestones set status = 'completed', completed_at = now()
 where id = 'abcd0013-0000-0000-0000-0000000000b1';
select tests.login_as(:admin_id);

select is(
  (select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                'membership', null, 'tx-member-0001')->>'to_stage'),
  'membership',
  'membership advances once every milestone is completed (0005_lifecycle)'
);

select throws_ok(
  $$ select transition_engagement('abcd0013-0000-0000-0000-000000000001',
                                  'scoping', 'reopening the plan', 'tx-key-out-0001') $$,
  '55000', 'terminal',
  'nothing leaves membership, a reversal included (0005_lifecycle)'
);


-- ---------------------------------------------------------------------------
-- engagements: the direct write is revoked — 0001_core (R7 PR 2, D22). transition_engagement() is the only writer; the partner's old upsert (and the
-- GUC hole 0005_lifecycle left open until now) is closed by the privilege, not by a policy alone.
-- ---------------------------------------------------------------------------

reset role;
select tests.login_as(:alice_id);

select throws_ok(
  $$ insert into engagements (business_id, owner_id, stage, status, organization_id)
     values ('abcd0013-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
             'initial_meeting', 'in_progress', 'eeeeeeee-0000-0000-0000-000000000001') $$,
  '42501', null,
  'a partner cannot INSERT an engagement row on their own business (0001_core)'
);

select throws_ok(
  $$ update engagements set notes = 'hello'
      where business_id = 'abcd0013-0000-0000-0000-000000000001' and stage = 'scoping' $$,
  '42501', null,
  'a partner cannot UPDATE their own engagement row (0001_core)'
);

-- The terminal lock keys on the session role. A partner is stopped by the missing UPDATE
-- privilege first; service_role holds UPDATE and is stopped by the trigger itself.
select throws_ok(
  $$ update engagements set status = 'in_progress'
      where business_id = 'abcd0013-0000-0000-0000-000000000001' and stage = 'initial_meeting' $$,
  '42501', null,
  'a partner cannot reopen a completed row (no UPDATE privilege)'
);

select tests.as_service();

select throws_ok(
  $$ update engagements set status = 'in_progress'
      where business_id = 'abcd0013-0000-0000-0000-000000000001' and stage = 'initial_meeting' $$,
  '23514', null,
  'service_role cannot reopen a completed row: the terminal lock keys on the session role (0001_core trigger)'
);

select throws_ok(
  $$ update businesses set scout_intake_id = null
      where id = 'abcd0013-0000-0000-0000-000000000001' $$,
  '23514', null,
  'service_role cannot change businesses.scout_intake_id: the lock keys on the session role (0001_core trigger)'
);

reset role;

select tests.login_as(:admin_id);

select throws_ok(
  $$ update engagements set status = 'in_progress'
      where business_id = 'abcd0013-0000-0000-0000-000000000001' and stage = 'initial_meeting' $$,
  '42501', null,
  'an admin cannot write engagements directly either — the function is the only writer (0001_core)'
);

-- Business 4: initial_meeting in_progress (stale) and budget_check already completed, so
-- this advance reopens an existing completed row — the write that needs the GUC — as the
-- definer function, after the revoke.
select is(
  (select transition_engagement('abcd0013-0000-0000-0000-000000000004',
                                'budget_check', 'Charter signed 2026-10-02',
                                'tx-postrevoke-0001')->>'to_stage'),
  'budget_check',
  'transition_engagement() still writes after the revoke: SECURITY DEFINER (0001_core)'
);

select tests.login_as(:alice_id);

select is(
  (select count(*)::int from engagements where business_id = 'abcd0013-0000-0000-0000-000000000004'),
  2,
  'a partner still reads their own engagement rows: the SELECT policies are kept (0001_core)'
);

select ok(
  not has_table_privilege('authenticated', 'engagements', 'INSERT')
    and not has_table_privilege('authenticated', 'engagements', 'UPDATE'),
  'authenticated holds no INSERT/UPDATE on engagements (0001_core)'
);

reset role;


-- ---------------------------------------------------------------------------
-- lessons / promoted_lessons / promote_lesson() / derive_engagement_outcome() — 0004_drafts (R9:
-- Scout's prediction against what happened; chronicle.md §6).
--
-- State on entry: the 0004_drafts section already submitted Chronicle drafts for Alice's
-- membership-stage engagement ...0020, so ONE lesson candidate exists for it, written
-- while her business had no scout_intake_id (null predictions). Fixtures below, as the
-- superuser: throwaway engagements on Bob's business for the generated-column and outcome
-- cases (their stages are unused there; status 'pending' keeps them out of the stage
-- derivation), and a business whose only event is 100 days old.
-- ---------------------------------------------------------------------------

reset role;

\set eng20 '''aaaaaaaa-0000-0000-0000-000000000020'''
\set bob_biz '''bbbbbbbb-0000-0000-0000-000000000001'''

insert into engagements (id, business_id, owner_id, stage, status, organization_id) values
  ('abcd0015-0000-0000-0000-0000000000e1', :bob_biz, :bob_id, 'budget_check',          'pending', :org_id),
  ('abcd0015-0000-0000-0000-0000000000e2', :bob_biz, :bob_id, 'data_ethics_committee', 'pending', :org_id),
  ('abcd0015-0000-0000-0000-0000000000e3', :bob_biz, :bob_id, 'scoping',               'pending', :org_id),
  ('abcd0015-0000-0000-0000-0000000000e4', :bob_biz, :bob_id, 'hackathon_ready',       'pending', :org_id);

insert into businesses (id, name, type, owner_id, organization_id) values
  ('abcd0015-0000-0000-0000-0000000000b2', 'Stale Nonprofit', 'nonprofit', :bob_id, :org_id);
insert into engagements (id, business_id, owner_id, stage, status, organization_id) values
  ('abcd0015-0000-0000-0000-0000000000e5', 'abcd0015-0000-0000-0000-0000000000b2', :bob_id,
   'initial_meeting', 'in_progress', :org_id);
insert into engagement_events (engagement_id, organization_id, kind, created_by, created_at) values
  ('abcd0015-0000-0000-0000-0000000000e5', :org_id, 'note_added', :admin_id, now() - interval '100 days');

-- Test helpers. lesson20_id() is SECURITY DEFINER so a caller who cannot see the lesson
-- (a partner, another org) can still name it in a call that must be refused.
create or replace function tests.lesson20_id() returns uuid
language sql security definer as $$
  select id from public.lessons where engagement_id = 'aaaaaaaa-0000-0000-0000-000000000020'
$$;

create or replace function tests.chronicle_payload15(eng uuid, success text[], failure text[])
returns jsonb
language sql as $$
  select tests.chronicle_payload(eng, 'ready', 'fallback')
         || jsonb_build_object('success_factors', to_jsonb(success), 'failure_factors', to_jsonb(failure))
$$;

-- Existence, RLS and who may write ------------------------------------------------

select has_table('public', 'lessons', 'the lessons table exists (0004_drafts)');
select has_view('public', 'promoted_lessons', 'the promoted_lessons view exists (0004_drafts)');
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.lessons'::regclass),
  'lessons has row level security forced (0004_drafts)'
);

select tests.login_as(:admin_id);

select throws_ok(
  $$ insert into lessons (organization_id, engagement_id, business_id, draft_id, outcome, created_by)
     values ('eeeeeeee-0000-0000-0000-000000000001', 'abcd0015-0000-0000-0000-0000000000e1',
             'bbbbbbbb-0000-0000-0000-000000000001',
             (select id from chronicle_drafts limit 1), 'delivered',
             '33333333-3333-3333-3333-333333333333') $$,
  '42501', null,
  'an admin cannot insert a lesson directly — only the definer functions write (0004_drafts)'
);

select tests.login_as(:alice_id);

select throws_ok(
  $$ insert into lessons (organization_id, engagement_id, business_id, draft_id, outcome, created_by)
     values ('eeeeeeee-0000-0000-0000-000000000001', 'abcd0015-0000-0000-0000-0000000000e1',
             'bbbbbbbb-0000-0000-0000-000000000001',
             (select id from chronicle_drafts limit 1), 'delivered',
             '11111111-1111-1111-1111-111111111111') $$,
  '42501', null,
  'a partner cannot insert a lesson directly (0004_drafts)'
);

reset role;

-- The 0012-era submissions wrote one candidate, with no prediction -----------------

select is(
  (select count(*)::int from lessons where engagement_id = :eng20),
  1,
  'the earlier Chronicle submissions left exactly one lesson candidate for the engagement (0004_drafts)'
);

select results_eq(
  $$ select predicted_bucket, predicted_readiness, prediction_correct, outcome
       from lessons where engagement_id = 'aaaaaaaa-0000-0000-0000-000000000020' $$,
  $$ values (null::text, null::text, null::boolean, 'delivered'::text) $$,
  'with no scout_intake_id the candidate has null predictions and prediction_correct; no milestones and recent events read as delivered (0004_drafts)'
);

select results_eq(
  $$ select (detail ->> 'prediction_missing')::boolean, (detail ->> 'lesson_frozen')::boolean
       from audit_events
      where action = 'chronicle.draft_submitted'
        and detail ->> 'draft_id' = (select draft_id::text from approvals
                                      where idempotency_key = 'chronicle-key-0001') $$,
  $$ values (true, false) $$,
  'the audit event flags prediction_missing and not lesson_frozen (0004_drafts)'
);

-- The business gains a scout intake (written as the superuser: an API role cannot) --

update businesses set scout_intake_id = 'cccccccc-0000-0000-0000-000000000007'
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';

select tests.login_as(:admin_id);

select ok(
  (select submit_chronicle_draft(
            tests.chronicle_payload15('aaaaaaaa-0000-0000-0000-000000000020',
                                      array['Clear success criteria'], array['Sparse event log']),
            'chronicle-key-0015-a', null) ->> 'lesson_id') is not null,
  'the submit result carries a lesson_id (0004_drafts)'
);

select is(
  (select submit_chronicle_draft(
            tests.chronicle_payload15('aaaaaaaa-0000-0000-0000-000000000020',
                                      array['Clear success criteria'], array['Sparse event log']),
            'chronicle-key-0015-a', null) ->> 'lesson_id'),
  (select id::text from lessons where engagement_id = :eng20),
  'a replayed key returns the same lesson_id (0004_drafts)'
);

select results_eq(
  $$ select predicted_bucket, predicted_readiness, prediction_correct, scout_intake_id,
            success_factors, failure_factors
       from lessons where engagement_id = 'aaaaaaaa-0000-0000-0000-000000000020' $$,
  $$ values ('Data Infrastructure'::text, 'Ready'::text, true,
             'cccccccc-0000-0000-0000-000000000007'::uuid,
             array['Clear success criteria']::text[], array['Sparse event log']::text[]) $$,
  'the candidate is updated in place: prediction from the intake (final_bucket first), Ready + delivered is correct, factors copied (0004_drafts)'
);

reset role;

select is(
  (select (detail ->> 'prediction_missing')::boolean from audit_events
    where action = 'chronicle.draft_submitted'
      and detail ->> 'draft_id' = (select draft_id::text from approvals
                                    where idempotency_key = 'chronicle-key-0015-a')),
  false,
  'the audit event no longer flags prediction_missing once the business has an intake (0004_drafts)'
);

-- A re-submission under a new key updates the same row ------------------------------

select tests.login_as(:admin_id);

select lives_ok(
  $$ select submit_chronicle_draft(
       tests.chronicle_payload15('aaaaaaaa-0000-0000-0000-000000000020',
                                 array['Second pass'], array[]::text[]),
       'chronicle-key-0015-b', null) $$,
  'a Chronicle re-submit under a new key succeeds (0004_drafts)'
);

select is(
  (select count(*)::int from lessons where engagement_id = :eng20),
  1,
  'a re-submit does not add a second lesson: one candidate per engagement (0004_drafts)'
);

select results_eq(
  $$ select l.draft_id = a.draft_id, l.success_factors, l.failure_factors,
            d.success_factors, d.failure_factors
       from lessons l
       join approvals a on a.idempotency_key = 'chronicle-key-0015-b'
       join chronicle_drafts d on d.id = a.draft_id
      where l.engagement_id = 'aaaaaaaa-0000-0000-0000-000000000020' $$,
  $$ values (true, array['Second pass']::text[], array[]::text[],
             array['Second pass']::text[], array[]::text[]) $$,
  'the candidate points at the newest draft and carries its factors, which are also stored on the draft (0004_drafts)'
);

select throws_ok(
  $$ select submit_chronicle_draft(
       tests.chronicle_payload('aaaaaaaa-0000-0000-0000-000000000020', 'ready', 'fallback')
         || jsonb_build_object('success_factors', to_jsonb(array_fill('x'::text, array[11]))),
       'chronicle-key-0015-many', null) $$,
  '23514', null,
  'more than ten factors is rejected by the column check (0004_drafts)'
);

reset role;

-- The generated column: real inserts, one throwaway engagement each ------------------

insert into lessons (organization_id, engagement_id, business_id, draft_id,
                     predicted_readiness, outcome, created_by)
select :org_id, v.eng, :bob_biz, (select id from chronicle_drafts limit 1),
       v.readiness, v.outcome, :admin_id
  from (values
    ('abcd0015-0000-0000-0000-0000000000e1'::uuid, 'Ready',       'delivered'),
    ('abcd0015-0000-0000-0000-0000000000e2'::uuid, 'Not Ready',   'partial'),
    ('abcd0015-0000-0000-0000-0000000000e3'::uuid, 'Conditional', 'delivered'),
    ('abcd0015-0000-0000-0000-0000000000e4'::uuid, null,          'delivered')
  ) as v(eng, readiness, outcome);

select results_eq(
  $$ select prediction_correct from lessons
      where engagement_id = 'abcd0015-0000-0000-0000-0000000000e1' $$,
  $$ values (true) $$,
  'prediction_correct: Ready + delivered is true (0004_drafts)'
);
select results_eq(
  $$ select prediction_correct from lessons
      where engagement_id = 'abcd0015-0000-0000-0000-0000000000e2' $$,
  $$ values (true) $$,
  'prediction_correct: Not Ready + partial is true (0004_drafts)'
);
select results_eq(
  $$ select prediction_correct from lessons
      where engagement_id = 'abcd0015-0000-0000-0000-0000000000e3' $$,
  $$ values (false) $$,
  'prediction_correct: Conditional + delivered is false (0004_drafts)'
);
select results_eq(
  $$ select prediction_correct from lessons
      where engagement_id = 'abcd0015-0000-0000-0000-0000000000e4' $$,
  $$ values (null::boolean) $$,
  'prediction_correct: a null predicted_readiness gives null (0004_drafts)'
);

-- derive_engagement_outcome() --------------------------------------------------------

insert into milestones (id, engagement_id, organization_id, title, status) values
  ('abcd0015-0000-0000-0000-0000000000c1', 'abcd0015-0000-0000-0000-0000000000e1', :org_id, 'Done',        'completed'),
  ('abcd0015-0000-0000-0000-0000000000c2', 'abcd0015-0000-0000-0000-0000000000e1', :org_id, 'Still going', 'in_progress');

select tests.login_as(:admin_id);

select is(
  derive_engagement_outcome(:bob_biz, 'abcd0015-0000-0000-0000-0000000000e1'),
  'partial',
  'outcome: a milestone that is not completed makes it partial (0004_drafts)'
);

reset role;
update milestones set status = 'completed', completed_at = now()
 where id = 'abcd0015-0000-0000-0000-0000000000c2';
select tests.login_as(:admin_id);

select is(
  derive_engagement_outcome(:bob_biz, 'abcd0015-0000-0000-0000-0000000000e1'),
  'delivered',
  'outcome: every milestone completed is delivered (0004_drafts)'
);

-- A reversal as the business's latest transition event: abandoned.
reset role;
insert into engagement_events (engagement_id, organization_id, kind, created_by, created_at) values
  ('abcd0015-0000-0000-0000-0000000000e2', :org_id, 'stage_reverted', :admin_id,
   now() - interval '1 hour');
select tests.login_as(:admin_id);

select is(
  derive_engagement_outcome(:bob_biz, 'abcd0015-0000-0000-0000-0000000000e1'),
  'abandoned',
  'outcome: a stage_reverted as the latest transition event is abandoned (0004_drafts)'
);

-- A later advance clears it.
reset role;
insert into engagement_events (engagement_id, organization_id, kind, created_by, created_at) values
  ('abcd0015-0000-0000-0000-0000000000e2', :org_id, 'stage_advanced', :admin_id, now());
select tests.login_as(:admin_id);

select is(
  derive_engagement_outcome(:bob_biz, 'abcd0015-0000-0000-0000-0000000000e1'),
  'delivered',
  'outcome: a later stage_advanced clears the reversal (0004_drafts)'
);

select is(
  derive_engagement_outcome('abcd0015-0000-0000-0000-0000000000b2',
                            'abcd0015-0000-0000-0000-0000000000e5'),
  'abandoned',
  'outcome: no event for more than 90 days is abandoned (0004_drafts)'
);

select tests.login_as(:alice_id);

select throws_ok(
  $$ select derive_engagement_outcome('bbbbbbbb-0000-0000-0000-000000000001',
                                      'abcd0015-0000-0000-0000-0000000000e1') $$,
  '42501', null,
  'a partner cannot derive an outcome (0004_drafts)'
);

select tests.login_as(:rival_id);

select throws_ok(
  $$ select derive_engagement_outcome('bbbbbbbb-0000-0000-0000-000000000001',
                                      'abcd0015-0000-0000-0000-0000000000e1') $$,
  '42501', null,
  'an admin of another org cannot derive an outcome (0004_drafts)'
);

-- Who can read lessons -----------------------------------------------------------------

select tests.login_as(:alice_id);

select is((select count(*)::int from lessons), 0, 'a partner sees no lessons: 0 rows, not an error (0004_drafts)');
select is((select count(*)::int from promoted_lessons), 0, 'a partner sees nothing through promoted_lessons (0004_drafts)');

select tests.login_as(:rival_id);

select is((select count(*)::int from lessons), 0, 'an admin of another org sees no lessons (0004_drafts)');

select tests.login_as(:admin_id);

select is(
  (select count(*)::int from lessons where engagement_id = :eng20),
  1,
  'an admin of the org sees the candidate (0004_drafts)'
);

-- Promotion ----------------------------------------------------------------------------

select is(
  (select count(*)::int from promoted_lessons),
  0,
  'promoted_lessons is empty before any promotion: candidates are Scout-invisible (0004_drafts)'
);

select throws_ok(
  $$ select promote_lesson('abcd0015-0000-0000-0000-0000000000ff') $$,
  'P0002', null,
  'promoting a lesson that does not exist is P0002 (0004_drafts)'
);

select is(
  (select promote_lesson((select id from lessons where engagement_id = :eng20),
                         'Held up against the outcome') ->> 'lesson_id'),
  (select id::text from lessons where engagement_id = :eng20),
  'promote_lesson() returns the lesson id (0004_drafts)'
);

select results_eq(
  $$ select promoted_by, promoted_at is not null, promotion_approval_id is not null
       from lessons where engagement_id = 'aaaaaaaa-0000-0000-0000-000000000020' $$,
  $$ values ('33333333-3333-3333-3333-333333333333'::uuid, true, true) $$,
  'promotion stamps promoted_by from auth.uid() and links the approval (0004_drafts)'
);

select results_eq(
  $$ select a.status, a.agent, a.hitl_tier, a.reviewer_id, a.reviewed_at is not null, a.notes,
            a.id = l.promotion_approval_id
       from approvals a join lessons l on l.id = a.entity_id
      where a.entity_type = 'lesson'
        and l.engagement_id = 'aaaaaaaa-0000-0000-0000-000000000020' $$,
  $$ values ('approved'::text, 'chronicle'::text, 'L3'::text,
             '33333333-3333-3333-3333-333333333333'::uuid, true,
             'Held up against the outcome'::text, true) $$,
  'promotion writes one already-approved L3 lesson approval — the promotion record (0004_drafts)'
);

select is(
  (select count(*)::int from promoted_lessons where engagement_id = :eng20),
  1,
  'the promoted lesson now appears in promoted_lessons (0004_drafts)'
);

select is(
  (select promote_lesson((select id from lessons where engagement_id = :eng20)) ->> 'approval_id'),
  (select promotion_approval_id::text from lessons where engagement_id = :eng20),
  'a second promote_lesson() is idempotent: the same approval (0004_drafts)'
);

select is(
  (select count(*)::int from approvals where entity_type = 'lesson'
     and entity_id = (select id from lessons where engagement_id = :eng20)),
  1,
  'a second promote_lesson() writes no new approval (0004_drafts)'
);

reset role;

select is(
  (select count(*)::int from audit_events
    where action = 'chronicle.lesson_promoted'
      and entity_id = (select id from lessons where engagement_id = :eng20)),
  1,
  'promotion writes exactly one chronicle.lesson_promoted audit event, even when called twice (0004_drafts)'
);

-- Who may promote ----------------------------------------------------------------------

select tests.login_as(:alice_id);

select throws_ok(
  $$ select promote_lesson(tests.lesson20_id()) $$,
  '42501', null,
  'a partner cannot promote a lesson (0004_drafts)'
);

select tests.login_as(:rival_id);

select throws_ok(
  $$ select promote_lesson(tests.lesson20_id()) $$,
  '42501', null,
  'an admin of another org cannot promote this org''s lesson (0004_drafts)'
);

select tests.logout();

select throws_ok(
  $$ select promote_lesson(tests.lesson20_id()) $$,
  '42501', null,
  'anon cannot promote a lesson (0004_drafts: execute not granted)'
);

select tests.as_service();

select throws_ok(
  $$ select public.promote_lesson(tests.lesson20_id()) $$,
  '42501', null,
  'service_role cannot promote a lesson (0004_drafts)'
);

reset role;

-- A promoted lesson is frozen -----------------------------------------------------------

select tests.login_as(:admin_id);

select lives_ok(
  $$ select submit_chronicle_draft(
       tests.chronicle_payload15('aaaaaaaa-0000-0000-0000-000000000020',
                                 array['Third pass'], array['Late change']),
       'chronicle-key-0015-c', null) $$,
  'a Chronicle draft can still be submitted after the lesson was promoted (0004_drafts)'
);

select results_eq(
  $$ select l.draft_id = (select draft_id from approvals where idempotency_key = 'chronicle-key-0015-b'),
            l.success_factors, l.failure_factors
       from lessons l where l.engagement_id = 'aaaaaaaa-0000-0000-0000-000000000020' $$,
  $$ values (true, array['Second pass']::text[], array[]::text[]) $$,
  'a promoted lesson is not rewritten by a later draft: same draft, same factors (0004_drafts)'
);

reset role;

select is(
  (select (detail ->> 'lesson_frozen')::boolean from audit_events
    where action = 'chronicle.draft_submitted'
      and detail ->> 'draft_id' = (select draft_id::text from approvals
                                    where idempotency_key = 'chronicle-key-0015-c')),
  true,
  'the audit event of a draft submitted after promotion says lesson_frozen (0004_drafts)'
);


-- Provenance chain — 0006_views (R12).
--
-- Leans on fixtures earlier blocks left in this transaction: the 0005_lifecycle transitions
-- (tx-scoping-0001 is an L3 advance, tx-revert-0001 an L3 reversal) and the 0004_drafts Envoy draft
-- (approval 'envoy-key-0001', run ...091 — already 'expired' and superseded by the 0004_drafts block's
-- re-submit under envoy-key-0002; this block flips it to 'approved' as the superuser purely to
-- have a decided chain to assert against, a state the app itself never produces).
-- ---------------------------------------------------------------------------

reset role;

-- engagement_events.approval_id ------------------------------------------------

select results_eq(
  $$ select a.id::text = e.detail ->> 'approval_id', a.entity_type,
            a.entity_id = e.engagement_id, a.status
       from engagement_events e join approvals a on a.id = e.approval_id
      where e.idempotency_key = 'tx-scoping-0001' $$,
  $$ values (true, 'transition'::text, true, 'approved'::text) $$,
  'an L3 advance names its approval in engagement_events.approval_id, matching the detail JSON (0006_views)'
);

select results_eq(
  $$ select a.entity_type, a.entity_id = e.engagement_id, a.status
       from engagement_events e join approvals a on a.id = e.approval_id
      where e.idempotency_key = 'tx-revert-0001' $$,
  $$ values ('transition'::text, true, 'approved'::text) $$,
  'a reversal names its own approved transition approval, on the event''s engagement (0006_views)'
);

select is_empty(
  $$ select 1 from engagement_events
      where kind in ('stage_advanced', 'stage_reverted') and idempotency_key is not null
        and (approval_id is not null)
            is distinct from (detail ? 'approval_id') $$,
  'the approval_id column mirrors the approval_id key of every transition event''s detail (0006_views)'
);

select ok(
  exists (select 1 from engagement_events
           where kind = 'stage_advanced' and idempotency_key is not null and approval_id is null),
  'an L2 transition has no approval, so its approval_id stays null (0006_views)'
);

-- provenance_chain: an Envoy draft, decided by the admin ---------------------------

update approvals
   set status = 'approved', reviewer_id = :admin_id, reviewed_at = now()
 where idempotency_key = 'envoy-key-0001';

select has_view('public', 'provenance_chain', 'the provenance_chain view exists (0006_views)');

select tests.login_as(:admin_id);

select is(
  (select count(*)::int from provenance_chain
    where approval_id = (select id from approvals where idempotency_key = 'envoy-key-0001')),
  1,
  'provenance_chain returns exactly one row for the Envoy approval (0006_views)'
);

select results_eq(
  $$ select p.draft_kind, p.draft_id = c.id, p.run_id, p.reviewer_id, p.approval_status,
            p.draft_source_type::text, p.run_model, p.run_prompt_version,
            p.engagement_id, p.transition_event_id is null
       from provenance_chain p
       join approvals a on a.id = p.approval_id
       join communications c on c.id = a.draft_id
      where a.idempotency_key = 'envoy-key-0001' $$,
  $$ values ('communication'::text, true,
             'ffffffff-0000-0000-0000-000000000091'::uuid,
             '33333333-3333-3333-3333-333333333333'::uuid, 'approved'::text,
             'ai'::text, 'gemini-2.5-flash'::text, 'envoy-draft-v2'::text,
             'aaaaaaaa-0000-0000-0000-000000000010'::uuid, true) $$,
  'the chain row names the draft, the run, the reviewer and the engagement of the Envoy approval (0006_views)'
);

select ok(
  (select audit_event_id is not null from provenance_chain
    where approval_id = (select id from approvals where idempotency_key = 'envoy-key-0001')),
  'the chain row links the audit event that recorded the draft submit (0006_views)'
);

select results_eq(
  $$ select p.approval_agent, p.draft_kind is null, p.transition_to, p.transition_event_id = e.id,
            p.audit_event_id is not null
       from provenance_chain p
       join engagement_events e on e.approval_id = p.approval_id
      where e.idempotency_key = 'tx-scoping-0001' $$,
  $$ values ('system'::text, true, 'scoping'::text, true, true) $$,
  'a transition approval chains to its event (stage and id) and its audit event, with no draft (0006_views)'
);

select tests.login_as(:rival_id);

select is(
  (select count(*)::int from provenance_chain
    where approval_id = (select id from approvals where idempotency_key = 'envoy-key-0001')),
  0,
  'an admin of another org sees none of this org''s chain rows (0006_views: security_invoker)'
);

select tests.login_as(:alice_id);

select is(
  (select count(*)::int from provenance_chain),
  0,
  'a partner sees no provenance_chain rows, and no error (0006_views)'
);

select tests.logout();

select throws_ok(
  $$ select count(*) from provenance_chain $$,
  '42501', null,
  'anon cannot select from provenance_chain (0006_views: no grant)'
);

reset role;

-- scout_intakes routing provenance ---------------------------------------------------


select * from finish();

rollback;
