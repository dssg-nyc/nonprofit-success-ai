-- Read models: production metrics and the provenance chain.
--
-- Both are `security_invoker` views (Postgres >= 15): they read their source tables as
-- the caller, so the tables' RLS is the authority. An admin sees their orgs' rows (plus
-- null-org rows where the policy allows); a partner sees nothing; anon has no grant. No
-- new policy.

-- ---------------------------------------------------------------------------
-- a. agent_run_metrics — errors, latency, cost and staff override rate (Q5, I-23)
--
-- One row per (agent, organization, day):
--
--   runs, successes, fallbacks, errors  counts over agent_runs.created_at::date
--   error_rate, fallback_rate           errors / runs, fallbacks / runs (null when runs = 0)
--   p50_ms, p95_ms                      percentile_cont over agent_runs.duration_ms
--   input_tokens, output_tokens         sums (null tokens are skipped by sum)
--   cost_cents, runs_costed             sum of the NON-NULL cost_cents, and how many rows had
--                                       one — a sum over few costed rows is not the total
--   approved, rejected                  approvals decided that day (reviewed_at::date)
--   override_rate                       rejected / (approved + rejected), null when neither
--
-- Override rate is the share of human decisions that overruled the agent. 'pending' and
-- 'expired' approvals are excluded from numerator and denominator, and the day is the day
-- the human DECIDED, not the day the agent proposed. "Edited" is NOT observable: an edit is
-- a new draft row, not an approval state; provenance_chain below is where that is traced.
-- `approvals.agent` also admits 'system' (transitions); those rows surface here with
-- runs = 0, which is accurate: a transition is not an agent run.
--
-- Drift is deliberately not here. Judge pass rate per run lives in the eval harness's
-- src/evals/experiments/log.jsonl (eval-harness.md "Runs are experiments").
--
-- Both source tables carry a nullable organization_id (a Scout run before any org exists).
-- The two halves are joined on coalesce(organization_id, <zero uuid>) = ..., not on
-- `is not distinct from`: a FULL JOIN needs a merge- or hash-joinable condition and
-- Postgres rejects IS NOT DISTINCT FROM there (0A000).
-- ---------------------------------------------------------------------------

create view agent_run_metrics with (security_invoker = true) as
with runs as (
  select agent,
         organization_id,
         created_at::date                                    as day,
         count(*)                                            as runs,
         count(*) filter (where status = 'success')          as successes,
         count(*) filter (where status = 'fallback')         as fallbacks,
         count(*) filter (where status = 'error')            as errors,
         percentile_cont(0.5)  within group (order by duration_ms) as p50_ms,
         percentile_cont(0.95) within group (order by duration_ms) as p95_ms,
         sum(input_tokens)                                   as input_tokens,
         sum(output_tokens)                                  as output_tokens,
         sum(cost_cents)                                     as cost_cents,
         count(cost_cents)                                   as runs_costed
    from agent_runs
   group by agent, organization_id, created_at::date
),
reviews as (
  select agent,
         organization_id,
         reviewed_at::date                                   as day,
         count(*) filter (where status = 'approved')         as approved,
         count(*) filter (where status = 'rejected')         as rejected
    from approvals
   where reviewed_at is not null and status in ('approved', 'rejected')
   group by agent, organization_id, reviewed_at::date
)
select coalesce(r.agent, v.agent)                     as agent,
       coalesce(r.organization_id, v.organization_id) as organization_id,
       coalesce(r.day, v.day)                         as day,
       coalesce(r.runs, 0)                            as runs,
       coalesce(r.successes, 0)                       as successes,
       coalesce(r.fallbacks, 0)                       as fallbacks,
       coalesce(r.errors, 0)                          as errors,
       case when coalesce(r.runs, 0) > 0 then r.errors::numeric    / r.runs end as error_rate,
       case when coalesce(r.runs, 0) > 0 then r.fallbacks::numeric / r.runs end as fallback_rate,
       r.p50_ms, r.p95_ms, r.input_tokens, r.output_tokens, r.cost_cents,
       coalesce(r.runs_costed, 0)                     as runs_costed,
       coalesce(v.approved, 0)                        as approved,
       coalesce(v.rejected, 0)                        as rejected,
       case when coalesce(v.approved, 0) + coalesce(v.rejected, 0) > 0
            then v.rejected::numeric / (v.approved + v.rejected) end as override_rate
  from runs r
  full outer join reviews v
    on v.agent = r.agent
   and v.day = r.day
   and coalesce(v.organization_id, '00000000-0000-0000-0000-000000000000'::uuid)
     = coalesce(r.organization_id, '00000000-0000-0000-0000-000000000000'::uuid);

comment on view agent_run_metrics is
  'Q5 production metrics per agent, organization and day: error/fallback rate, p50/p95 latency, tokens and cost (runs_costed = rows that had a cost), staff override rate = rejected/(approved+rejected) by decision day. Drift is not here: see src/evals/experiments/log.jsonl. RLS of agent_runs and approvals applies to the caller.';

revoke all on agent_run_metrics from anon, authenticated, service_role;
grant select on agent_run_metrics to authenticated;

-- ---------------------------------------------------------------------------
-- b. provenance_chain — data-model.md §7 as a query
--
-- One row per approval, the hops as columns: draft -> run -> approval (reviewer) ->
-- state transition (engagement_events.approval_id) -> audit event.
--
-- Which audit inserts carry `approval_id`: all of them. architect.draft_submitted,
-- envoy.draft_submitted, chronicle.draft_submitted, engagement.transition and
-- chronicle.lesson_promoted put it in detail as a uuid inside jsonb. So `audit_event_id`
-- is the earliest audit_events row whose detail ->> 'approval_id' equals the approval. It
-- is a text comparison (no cast, nothing to fail) and has no index on audit_events.
--
-- How the draft hop is found. communications / chronicle_drafts: approvals.draft_id.
-- Architect writes no draft_id; its approval has entity_type 'charter' (the submit) or
-- 'assessment' (the ethics-committee approval transition_engagement reads) and entity_id =
-- the assessment id (= the intake id), so that join is on entity_id. architect_assessments
-- holds only the LATEST draft per intake (an upsert), so an older, superseded charter
-- approval shows the current assessment's provenance, not the one it gated.
-- Communications and chronicle drafts keep every version (supersedes_id), so those rows
-- are exact.
--
-- engagement_id is approvals.entity_id for communication / story / transition approvals
-- (all engagement ids) and null for charter / assessment / intake (entity_id is an intake).
-- ---------------------------------------------------------------------------

create view provenance_chain with (security_invoker = true) as
select
  case when a.entity_type in ('communication', 'story', 'transition')
       then a.entity_id end                                         as engagement_id,
  a.organization_id,
  a.id                                                              as approval_id,
  a.status                                                          as approval_status,
  a.reviewer_id,
  a.reviewed_at,
  a.agent                                                           as approval_agent,
  a.entity_type,
  case when comm.id is not null then 'communication'
       when cd.id   is not null then 'chronicle_draft'
       when aa.id   is not null then 'architect_assessment' end     as draft_kind,
  coalesce(comm.id, cd.id, aa.id)                                   as draft_id,
  coalesce(comm.source_type, cd.source_type, aa.source_type)        as draft_source_type,
  coalesce(comm.supersedes_id, cd.supersedes_id)                    as draft_supersedes_id,
  coalesce(comm.model, cd.model, aa.model)                          as draft_model,
  coalesce(comm.prompt_version, cd.prompt_version, aa.prompt_version) as draft_prompt_version,
  coalesce(comm.run_id, cd.run_id, aa.run_id, a.agent_run_id)       as run_id,
  r.status                                                          as run_status,
  r.model                                                           as run_model,
  r.prompt_version                                                  as run_prompt_version,
  r.created_at                                                      as run_created_at,
  ev.id                                                             as transition_event_id,
  ev.detail ->> 'from'                                              as transition_from,
  ev.detail ->> 'to'                                                as transition_to,
  ev.created_at                                                     as transition_at,
  au.id                                                             as audit_event_id
  from approvals a
  left join communications comm
    on a.entity_type = 'communication' and comm.id = a.draft_id
  left join chronicle_drafts cd
    on a.entity_type = 'story' and cd.id = a.draft_id
  left join architect_assessments aa
    on a.entity_type in ('charter', 'assessment') and aa.id = a.entity_id
  left join agent_runs r
    on r.id = coalesce(comm.run_id, cd.run_id, aa.run_id, a.agent_run_id)
  left join engagement_events ev
    on ev.approval_id = a.id
  left join lateral (
    select x.id
      from audit_events x
     where x.detail ->> 'approval_id' = a.id::text
     order by x.created_at, x.id
     limit 1
  ) au on true;

comment on view provenance_chain is
  'One row per approval with the hops of data-model.md §7 as columns: draft (communication / chronicle_draft / architect_assessment) -> run -> approval (reviewer) -> state transition (engagement_events.approval_id) -> audit event. Query: select * from provenance_chain where engagement_id = $1 order by reviewed_at. Architect rows join the latest assessment (it is upserted, not versioned). RLS of the underlying tables applies to the caller.';

revoke all on provenance_chain from anon, authenticated, service_role;
grant select on provenance_chain to authenticated;
