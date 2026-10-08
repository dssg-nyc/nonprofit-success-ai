-- Telemetry (agent_runs / tool_calls), approvals, audit_events, milestones / tasks,
-- documents and the agent_run_metrics view.

\ir _shared/fixtures.psql

select plan(75);

-- agent_runs + tool_calls — telemetry
--
-- Written only by the recorder's service-role client. Admin-only read. Append-only
-- for every API role, service_role included: UPDATE/DELETE are withheld at the
-- privilege layer, so they raise 42501 rather than matching zero rows.
-- ---------------------------------------------------------------------------

-- Shape: no raw model I/O columns (observability.md Rules).
select hasnt_column('public', 'agent_runs', 'input',  'agent_runs has no raw input column');
select hasnt_column('public', 'agent_runs', 'output', 'agent_runs has no raw output column');
select hasnt_column('public', 'tool_calls', 'input',  'tool_calls has no raw input column');
select hasnt_column('public', 'tool_calls', 'output', 'tool_calls has no raw output column');

select tests.as_service();

-- organization_id and engagement_id are real FKs. is_admin() in the admin reads below is
-- 0001_core's membership-based definition, and reads are scoped to the admin's orgs.
select lives_ok(
  $$ insert into agent_runs (id, agent, organization_id, engagement_id, model,
                             prompt_version, status, input_tokens, output_tokens,
                             hitl_tier, duration_ms)
     values ('ffffffff-0000-0000-0000-000000000001', 'scout',
             'eeeeeeee-0000-0000-0000-000000000001',
             'aaaaaaaa-0000-0000-0000-000000000010',
             'gemini-2.5-flash', 'scout@1', 'success', 120, 40, 'L3', 150) $$,
  'service_role CAN insert an agent_run (the recorder write)'
);

select lives_ok(
  $$ insert into agent_runs (id, agent, model, status, error_code, duration_ms)
     values ('ffffffff-0000-0000-0000-000000000003',
             'scout', 'gemini-2.5-flash', 'fallback', 'timeout', 9000) $$,
  'service_role CAN insert a fallback run with null engagement and org (Scout pre-intake)'
);

select lives_ok(
  $$ insert into tool_calls (id, agent_run_id, tool, duration_ms)
     values ('ffffffff-0000-0000-0000-000000000002',
             'ffffffff-0000-0000-0000-000000000001', 'generateObject', 100) $$,
  'service_role CAN insert a tool_call'
);

select throws_ok(
  $$ insert into agent_runs (agent, model, status, duration_ms)
     values ('scout', 'gemini-2.5-flash', 'ok', 10) $$,
  '23514',
  null,
  'agent_runs.status is constrained to success|fallback|error'
);

select throws_ok(
  $$ insert into agent_runs (agent, model, status, hitl_tier, duration_ms)
     values ('scout', 'gemini-2.5-flash', 'success', 'L1', 10) $$,
  '23514',
  null,
  'agent_runs.hitl_tier is constrained to L2|L3'
);

select throws_ok(
  $$ update agent_runs set status = 'error' $$,
  '42501',
  null,
  'service_role cannot update agent_runs — append-only'
);

select throws_ok(
  $$ delete from agent_runs $$,
  '42501',
  null,
  'service_role cannot delete agent_runs — append-only'
);

select throws_ok(
  $$ update tool_calls set tool = 'rewritten' $$,
  '42501',
  null,
  'service_role cannot update tool_calls — append-only'
);

-- service_role has no USAGE on schema tests; switch back via the superuser.
reset role;
select tests.logout();

select throws_ok(
  $$ select id from agent_runs $$,
  '42501',
  null,
  'anon cannot read agent_runs'
);

select throws_ok(
  $$ update agent_runs set status = 'error' $$,
  '42501',
  null,
  'anon cannot update agent_runs — append-only'
);

select throws_ok(
  $$ delete from agent_runs $$,
  '42501',
  null,
  'anon cannot delete agent_runs — append-only'
);

select tests.login_as(:alice_id);

select is_empty(
  $$ select id from agent_runs $$,
  'a non-admin cannot read agent_runs (admin-only)'
);

select is_empty(
  $$ select id from tool_calls $$,
  'a non-admin cannot read tool_calls (admin-only)'
);

select throws_ok(
  $$ insert into agent_runs (agent, model, status, duration_ms)
     values ('scout', 'test', 'success', 100) $$,
  '42501',
  null,
  'a non-admin cannot insert agent_runs (service-role only)'
);

select throws_ok(
  $$ insert into tool_calls (agent_run_id, tool, duration_ms)
     values ('ffffffff-0000-0000-0000-000000000001', 'test', 50) $$,
  '42501',
  null,
  'a non-admin cannot insert tool_calls (service-role only)'
);

select throws_ok(
  $$ update agent_runs set status = 'error' $$,
  '42501',
  null,
  'authenticated cannot update agent_runs — append-only'
);

select throws_ok(
  $$ delete from agent_runs $$,
  '42501',
  null,
  'authenticated cannot delete agent_runs — append-only'
);

select tests.login_as(:admin_id);

select results_eq(
  $$ select count(*)::int from agent_runs
       where id in ('ffffffff-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000003') $$,
  $$ values (2) $$,
  'an admin CAN read agent_runs'
);

select results_eq(
  $$ select count(*)::int from tool_calls
       where agent_run_id in ('ffffffff-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000002') $$,
  $$ values (1) $$,
  'an admin CAN read tool_calls'
);

select throws_ok(
  $$ update agent_runs set status = 'error' $$,
  '42501',
  null,
  'even an admin cannot update agent_runs — append-only'
);

select throws_ok(
  $$ delete from agent_runs $$,
  '42501',
  null,
  'even an admin cannot delete agent_runs — append-only'
);

-- ---------------------------------------------------------------------------
-- approvals — approval spine
-- ---------------------------------------------------------------------------

select tests.as_service();

select lives_ok(
  $$ insert into approvals (id, organization_id, agent, agent_run_id, entity_type,
                            entity_id, hitl_tier, status)
     values ('ffffffff-0000-0000-0000-000000000010',
             'eeeeeeee-0000-0000-0000-000000000001', 'envoy',
             'ffffffff-0000-0000-0000-000000000001', 'communication',
             'aaaaaaaa-0000-0000-0000-000000000010', 'L3', 'pending') $$,
  'service_role CAN open an approval linked to an agent_run'
);

-- service_role has no USAGE on schema tests; switch back via the superuser.
reset role;
select tests.logout();

select throws_ok(
  $$ select id from approvals $$,
  '42501',
  null,
  'anon cannot read approvals'
);

select tests.login_as(:alice_id);

select is_empty(
  $$ select id from approvals $$,
  'a non-admin cannot read approvals (admin-only)'
);

-- Non-admin cannot update approvals (invisible via USING).
select is(
  tests.affected(
    $$ update approvals set status = 'approved'
        where id = 'ffffffff-0000-0000-0000-000000000010' $$),
  0,
  'a non-admin cannot update approval status (admin-only)'
);

select tests.login_as(:admin_id);

select results_eq(
  $$ select count(*)::int from approvals where id = 'ffffffff-0000-0000-0000-000000000010' $$,
  $$ values (1) $$,
  'an admin CAN read approvals'
);

-- 0001_core: the update must name the caller as reviewer and carry reviewed_at.
select throws_ok(
  $$ update approvals set status = 'approved'
      where id = 'ffffffff-0000-0000-0000-000000000010' $$,
  '42501', null,
  'an admin cannot decide an approval without naming a reviewer (0001_core)'
);

select throws_ok(
  $$ update approvals set status = 'approved',
         reviewer_id = '11111111-1111-1111-1111-111111111111',
         reviewed_at = now()
     where id = 'ffffffff-0000-0000-0000-000000000010' $$,
  '42501', null,
  'an admin cannot record another user as the reviewer (0001_core)'
);

select throws_ok(
  $$ update approvals set status = 'approved',
         reviewer_id = '33333333-3333-3333-3333-333333333333'
     where id = 'ffffffff-0000-0000-0000-000000000010' $$,
  '42501', null,
  'an admin cannot decide an approval without reviewed_at (0001_core)'
);

select lives_ok(
  $$ update approvals set status = 'approved',
         reviewer_id = '33333333-3333-3333-3333-333333333333',
         reviewed_at = now()
     where id = 'ffffffff-0000-0000-0000-000000000010' $$,
  'an admin CAN approve a pending approval (status transition)'
);

-- The override-rate join observability.md names: runs whose approval was rejected.
select results_eq(
  $$ select count(*)::int from agent_runs ar
       join approvals ap on ap.agent_run_id = ar.id
      where ap.status = 'approved' and ap.id = 'ffffffff-0000-0000-0000-000000000010' $$,
  $$ values (1) $$,
  'agent_runs joins to approvals on agent_run_id (override-rate query shape)'
);

select throws_ok(
  $$ delete from approvals $$,
  '42501',
  null,
  'nobody can delete an approval'
);

-- ---------------------------------------------------------------------------
-- audit_events — approval spine (append-only)
-- ---------------------------------------------------------------------------

select tests.as_service();

select lives_ok(
  $$ insert into audit_events (id, organization_id, actor_id, action, entity_type, entity_id)
     values ('ffffffff-0000-0000-0000-000000000020',
             'eeeeeeee-0000-0000-0000-000000000001',
             '33333333-3333-3333-3333-333333333333', 'approval.approved',
             'communication', 'aaaaaaaa-0000-0000-0000-000000000010') $$,
  'service_role CAN append an audit_event'
);

select throws_ok(
  $$ update audit_events set action = 'rewritten' $$,
  '42501',
  null,
  'service_role cannot update audit_events — append-only'
);

-- service_role has no USAGE on schema tests; switch back via the superuser.
reset role;
select tests.login_as(:alice_id);

select is_empty(
  $$ select id from audit_events $$,
  'a non-admin cannot read audit_events (admin-only)'
);

select tests.login_as(:admin_id);

select results_eq(
  $$ select count(*)::int from audit_events where id = 'ffffffff-0000-0000-0000-000000000020' $$,
  $$ values (1) $$,
  'an admin CAN read audit_events'
);

-- Org scoping (0001_core/0002_approvals via user_org_ids()): an admin of another org sees none of
-- this org's telemetry or approvals.
select tests.login_as(:rival_id);

select results_eq(
  $$ select count(*)::int from agent_runs
     where organization_id = 'eeeeeeee-0000-0000-0000-000000000001' $$,
  $$ values (0) $$,
  'an admin of another org cannot read this org''s agent_runs'
);

select results_eq(
  $$ select count(*)::int from approvals
     where organization_id = 'eeeeeeee-0000-0000-0000-000000000001' $$,
  $$ values (0) $$,
  'an admin of another org cannot read this org''s approvals'
);

select results_eq(
  $$ select count(*)::int from audit_events
     where organization_id = 'eeeeeeee-0000-0000-0000-000000000001' $$,
  $$ values (0) $$,
  'an admin of another org cannot read this org''s audit_events'
);

select tests.login_as(:admin_id);

-- Append-only enforcement: no INSERT/UPDATE/DELETE grant for authenticated.
select throws_ok(
  $$ insert into audit_events (action) values ('test') $$,
  '42501',
  null,
  'authenticated cannot insert audit_events (service-role only)'
);

select throws_ok(
  $$ update audit_events set action = 'rewritten' $$,
  '42501',
  null,
  'audit_events cannot be updated — append-only'
);

select throws_ok(
  $$ delete from audit_events $$,
  '42501',
  null,
  'audit_events cannot be deleted — append-only'
);

-- ---------------------------------------------------------------------------
-- milestones + tasks — 0003_delivery delivery (org-scoped, owner via the engagement)
-- ---------------------------------------------------------------------------

select tests.login_as(:alice_id);

select lives_ok(
  $$ insert into milestones (id, engagement_id, organization_id, title)
     values ('ffffffff-0000-0000-0000-000000000030',
             'aaaaaaaa-0000-0000-0000-000000000010',
             'eeeeeeee-0000-0000-0000-000000000001', 'Kick-off') $$,
  'an owner CAN create a milestone on their engagement (0003_delivery)'
);

select lives_ok(
  $$ insert into tasks (id, milestone_id, engagement_id, organization_id, title)
     values ('ffffffff-0000-0000-0000-000000000031',
             'ffffffff-0000-0000-0000-000000000030',
             'aaaaaaaa-0000-0000-0000-000000000010',
             'eeeeeeee-0000-0000-0000-000000000001', 'Gather data sources') $$,
  'an owner CAN create a task on their milestone (0003_delivery)'
);

select results_eq(
  $$ select count(*)::int from milestones $$,
  $$ values (1) $$,
  'an owner sees milestones on their engagement (0003_delivery)'
);

select results_eq(
  $$ select count(*)::int from tasks $$,
  $$ values (1) $$,
  'an owner sees tasks on their engagement (0003_delivery)'
);

select tests.login_as(:outsider_id);

select is_empty(
  $$ select id from milestones $$,
  'an outsider cannot see milestones in another org (0003_delivery: cross-org)'
);

select is_empty(
  $$ select id from tasks $$,
  'an outsider cannot see tasks in another org (0003_delivery: cross-org)'
);

-- ---------------------------------------------------------------------------
-- documents — 0003_delivery (org-scoped only: no owner or engagement check)
-- ---------------------------------------------------------------------------

select tests.login_as(:alice_id);

select lives_ok(
  $$ insert into documents (id, organization_id, engagement_id, source, title)
     values ('ffffffff-0000-0000-0000-000000000040',
             'eeeeeeee-0000-0000-0000-000000000001',
             'aaaaaaaa-0000-0000-0000-000000000010', 'upload', 'Data inventory') $$,
  'a member CAN add a document to their org (0003_delivery: documents_insert_own)'
);

select throws_ok(
  $$ insert into documents (id, organization_id, source, title)
     values ('ffffffff-0000-0000-0000-000000000041', null, 'upload', 'Orphan') $$,
  '42501',
  null,
  'a document cannot be added outside the caller''s orgs (0003_delivery: documents_insert_own)'
);

-- Follows 0001_core's org model: documents are scoped by org alone, so bob — a member of the
-- same org with no stake in alice's engagement — reads her engagement's document. The
-- same overreach as the KNOWN WRONG engagement read; C1 should narrow it too.
select tests.login_as(:bob_id);

select results_eq(
  $$ select count(*)::int from documents $$,
  $$ values (1) $$,
  'any member reads every document in their org (0003_delivery, follows 0001_core''s org model)'
);

select tests.login_as(:outsider_id);

select is_empty(
  $$ select id from documents $$,
  'an outsider cannot see documents in another org (0003_delivery: cross-org)'
);

-- agent_run_metrics — 0006_views (R10: Q5 production metrics).
--
-- Own fixtures on 2020-02-02 / 2020-02-03, days no other block uses, so the expected numbers
-- do not depend on the earlier sections. Pulse, four runs in :org_id: durations 100, 200,
-- 300, 1000 -> p50 = 250, p95 = 300 + 0.85 * 700 = 895. Reviews: two approved, one rejected
-- (override 1/3), plus a pending and an expired that must be ignored.
-- ---------------------------------------------------------------------------

reset role;

insert into agent_runs (agent, organization_id, model, status, input_tokens, output_tokens,
                        duration_ms, cost_cents, created_at) values
  ('pulse', :org_id, 'test-model', 'success',  10, 5,  100, 1,    '2020-02-02 10:00:00+00'),
  ('pulse', :org_id, 'test-model', 'success',  10, 5,  200, 1,    '2020-02-02 11:00:00+00'),
  ('pulse', :org_id, 'test-model', 'fallback', 10, 5,  300, null, '2020-02-02 12:00:00+00'),
  ('pulse', :org_id, 'test-model', 'error',    null, null, 1000, null, '2020-02-02 13:00:00+00');

insert into approvals (organization_id, agent, entity_type, entity_id, hitl_tier, status, reviewed_at) values
  (:org_id, 'pulse', 'intake', 'abcd0016-0000-0000-0000-000000000001', 'L2', 'approved', '2020-02-02 14:00:00+00'),
  (:org_id, 'pulse', 'intake', 'abcd0016-0000-0000-0000-000000000002', 'L2', 'approved', '2020-02-02 14:05:00+00'),
  (:org_id, 'pulse', 'intake', 'abcd0016-0000-0000-0000-000000000003', 'L2', 'rejected', '2020-02-02 14:10:00+00'),
  (:org_id, 'pulse', 'intake', 'abcd0016-0000-0000-0000-000000000004', 'L2', 'pending',  null),
  (:org_id, 'pulse', 'intake', 'abcd0016-0000-0000-0000-000000000005', 'L2', 'expired',  '2020-02-02 14:15:00+00'),
  (:org_id, 'envoy', 'communication', 'abcd0016-0000-0000-0000-000000000006', 'L3', 'approved', '2020-02-03 09:00:00+00');

select has_view('public', 'agent_run_metrics', 'the agent_run_metrics view exists (0006_views)');

select tests.login_as(:admin_id);

select is(
  (select count(*)::int from agent_run_metrics where agent = 'pulse' and day = '2020-02-02'),
  1,
  'an admin sees exactly one metrics row for pulse on the fixture day (0006_views)'
);
select is((select runs from agent_run_metrics where agent = 'pulse' and day = '2020-02-02')::int, 4,
  'metrics: runs counts every agent_runs row of the day (0006_views)');
select is((select errors from agent_run_metrics where agent = 'pulse' and day = '2020-02-02')::int, 1,
  'metrics: errors counts status = error (0006_views)');
select is((select fallbacks from agent_run_metrics where agent = 'pulse' and day = '2020-02-02')::int, 1,
  'metrics: fallbacks counts status = fallback (0006_views)');
select is((select error_rate from agent_run_metrics where agent = 'pulse' and day = '2020-02-02'), 0.25,
  'metrics: error_rate = errors / runs (0006_views)');
select is((select fallback_rate from agent_run_metrics where agent = 'pulse' and day = '2020-02-02'), 0.25,
  'metrics: fallback_rate = fallbacks / runs (0006_views)');
select is((select round(p50_ms::numeric, 3) from agent_run_metrics where agent = 'pulse' and day = '2020-02-02'), 250.000,
  'metrics: p50_ms is percentile_cont(0.5) over 100,200,300,1000 (0006_views)');
select is((select round(p95_ms::numeric, 3) from agent_run_metrics where agent = 'pulse' and day = '2020-02-02'), 895.000,
  'metrics: p95_ms is percentile_cont(0.95) over 100,200,300,1000 (0006_views)');
select is((select cost_cents from agent_run_metrics where agent = 'pulse' and day = '2020-02-02'), 2::numeric,
  'metrics: cost_cents sums the non-null costs (0006_views)');
select is((select runs_costed from agent_run_metrics where agent = 'pulse' and day = '2020-02-02')::int, 2,
  'metrics: runs_costed counts only the rows that carried a cost (0006_views)');
select is((select approved from agent_run_metrics where agent = 'pulse' and day = '2020-02-02')::int, 2,
  'metrics: approved counts approved decisions of the day; pending and expired are ignored (0006_views)');
select is((select rejected from agent_run_metrics where agent = 'pulse' and day = '2020-02-02')::int, 1,
  'metrics: rejected counts rejected decisions of the day (0006_views)');
select is((select round(override_rate, 4) from agent_run_metrics where agent = 'pulse' and day = '2020-02-02'), 0.3333,
  'metrics: override_rate = rejected / (approved + rejected) (0006_views)');

-- A day with a review and no runs still appears.
select is(
  (select runs::int from agent_run_metrics where agent = 'envoy' and day = '2020-02-03'),
  0,
  'a day with reviews but no runs still appears, with runs = 0 (0006_views)'
);
select is(
  (select override_rate from agent_run_metrics where agent = 'envoy' and day = '2020-02-03'),
  0::numeric,
  'a review-only day carries its override_rate (one approval, none rejected = 0) (0006_views)'
);

select tests.login_as(:rival_id);

select is(
  (select count(*)::int from agent_run_metrics where day in ('2020-02-02', '2020-02-03')),
  0,
  'an admin of another org sees none of this org''s metrics (0006_views: security_invoker)'
);

select tests.login_as(:alice_id);

select is(
  (select count(*)::int from agent_run_metrics where day in ('2020-02-02', '2020-02-03')),
  0,
  'a partner sees no metrics rows, and no error (0006_views)'
);

select tests.logout();

select throws_ok(
  $$ select count(*) from agent_run_metrics $$,
  '42501', null,
  'anon cannot select from agent_run_metrics (0006_views: no grant)'
);

reset role;



select * from finish();

rollback;
