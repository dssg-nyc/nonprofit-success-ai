-- Drafts: the L3-gated outputs of Architect, Envoy and Chronicle, and the lessons that
-- close the loop back to Scout.
--
-- supabase-js has no client-side transactions, so the writes a draft needs — the draft
-- row, expiring the previous pending approval, opening the new one, the audit event —
-- would otherwise be several requests that can half-apply. Each submit_* RPC below does
-- them in one statement. The API handlers call them with a USER-SCOPED client (the
-- caller's JWT), never the service role: `auth.uid()` must be the acting admin, both for
-- the authority checks and for the BEFORE triggers that still fire on these writes.
--
-- `agent_runs` cannot join the transaction (the recorder writes it during the model call,
-- on its own service-role client), so each draft links its run by id, nullable: a
-- fallback draft whose run was not recorded still saves. Provenance (data-model.md §7)
-- comes from the run when there is one, else from the payload's `model`.
--
-- Nothing here sends anything. Envoy's send path is C3: no code path sets `sent_at`.
--
-- Errors raised (SQLSTATE -> what the handler returns):
--   42501  not an admin, or not an admin/owner of the row's org        -> 403
--   P0002  no such intake / engagement / lesson                        -> 404
--   55000  precondition not met (intake unreviewed, stage too early)   -> 409 / 422
--   22023  bad payload / key, wrong run, key reused for another draft  -> 400 / 422
--   23xxx  a column constraint rejected the payload                    -> 400
--
-- Needs Postgres >= 15 (`security_invoker` views).

-- ---------------------------------------------------------------------------
-- a. communications / chronicle_drafts
-- ---------------------------------------------------------------------------

create table communications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  engagement_id   uuid not null references engagements (id),
  occasion        text not null
                  check (occasion in ('kickoff', 'check_in', 'milestone_reached', 'at_risk_follow_up', 'wrap_up')),
  subject         text not null check (char_length(subject) between 1 and 500),
  body            text not null check (char_length(body) between 1 and 20000),
  status          text not null default 'draft'
                  check (status in ('draft', 'approved', 'sent', 'rejected')),
  sent_at         timestamptz,
  -- A human edit is a new row pointing at the one it replaces, never an overwrite.
  supersedes_id   uuid references communications (id),
  created_by      uuid not null references auth.users (id),
  created_at      timestamptz not null default now(),
  -- data-model.md §7
  source_type     provenance_source not null,
  generated_by    text,
  model           text,
  model_version   text,
  prompt_version  text,
  run_id          uuid references agent_runs (id),
  approved_by     uuid references auth.users (id),
  approved_at     timestamptz,
  constraint communications_ai_has_model check (source_type <> 'ai' or model is not null)
);

create table chronicle_drafts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  engagement_id   uuid not null references engagements (id),
  -- 'not_ready' never writes (chronicle.md §1): there is nothing to store.
  readiness       text not null check (readiness in ('thin', 'ready')),
  provisional     boolean not null generated always as (readiness = 'thin') stored,
  headline        text not null check (char_length(headline) between 1 and 300),
  narrative       text not null check (char_length(narrative) between 1 and 20000),
  outcomes        jsonb not null default '[]' check (jsonb_typeof(outcomes) = 'array'),
  status          text not null default 'draft'
                  check (status in ('draft', 'approved', 'rejected')),
  supersedes_id   uuid references chronicle_drafts (id),
  created_by      uuid not null references auth.users (id),
  created_at      timestamptz not null default now(),
  -- data-model.md §7
  source_type     provenance_source not null,
  generated_by    text,
  model           text,
  model_version   text,
  prompt_version  text,
  run_id          uuid references agent_runs (id),
  approved_by     uuid references auth.users (id),
  approved_at     timestamptz,
  -- Model-proposed prose for the lesson (chronicle.md §6); copied onto the lesson row.
  success_factors text[] not null default '{}'
    check (coalesce(array_length(success_factors, 1), 0) <= 10),
  failure_factors text[] not null default '{}'
    check (coalesce(array_length(failure_factors, 1), 0) <= 10),
  constraint chronicle_drafts_ai_has_model check (source_type <> 'ai' or model is not null)
);

create index communications_engagement_id_idx on communications (engagement_id);
create index communications_organization_id_idx on communications (organization_id);
create index communications_status_idx on communications (status);
create index chronicle_drafts_engagement_id_idx on chronicle_drafts (engagement_id);
create index chronicle_drafts_organization_id_idx on chronicle_drafts (organization_id);
create index chronicle_drafts_status_idx on chronicle_drafts (status);

alter table communications enable row level security;
alter table communications force row level security;
alter table chronicle_drafts enable row level security;
alter table chronicle_drafts force row level security;

-- Staff only. A draft is staff-facing until it is approved and sent (envoy.md), so a
-- partner reads neither table. There is no insert/update/delete policy: rows arrive only
-- through the SECURITY DEFINER functions below.
create policy communications_select_admin on communications
  for select to authenticated
  using (is_admin() and organization_id in (select user_org_ids()));

create policy chronicle_drafts_select_admin on chronicle_drafts
  for select to authenticated
  using (is_admin() and organization_id in (select user_org_ids()));

-- Revoke first so the result does not depend on the project's default privileges (which
-- grant everything to anon / authenticated / service_role), then grant exactly SELECT.
-- chronicle.md: no delete on chronicle_drafts, for any API role.
revoke all on communications from anon, authenticated, service_role;
revoke all on chronicle_drafts from anon, authenticated, service_role;
grant select on communications to authenticated;
grant select on chronicle_drafts to authenticated;

-- Content is write-once. A human edit is a new row with `supersedes_id` (data-model.md §7:
-- an edit must not overwrite the AI original, or the record shows a human authoring text a
-- model drafted). Only the decision fields may move: status, and who approved it and when
-- (plus `sent_at` for a communication, which the C3 send path will own). Comparing the
-- row as jsonb minus the allowed keys covers every other column, provenance included.
create or replace function drafts_enforce_immutable_content()
returns trigger
language plpgsql
as $$
declare
  v_allowed text[] := case tg_table_name
    when 'communications' then array['status', 'sent_at', 'approved_by', 'approved_at']
    else array['status', 'approved_by', 'approved_at']
  end;
begin
  if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
    raise exception '%: content and provenance are immutable; a human edit is a new row with supersedes_id',
      tg_table_name using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger communications_immutable_content_trg
  before update on communications
  for each row execute function drafts_enforce_immutable_content();

create trigger chronicle_drafts_immutable_content_trg
  before update on chronicle_drafts
  for each row execute function drafts_enforce_immutable_content();

revoke execute on function drafts_enforce_immutable_content() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- b. lessons — Scout's prediction against what happened (D21, D15)
--
-- One candidate per engagement, written by submit_chronicle_draft(); `prediction_correct`
-- is GENERATED (computed, never judged). Staff read; no API role writes. `promoted_lessons`
-- is the only lessons surface Scout-side code may read (chronicle.md §6), and
-- promote_lesson() the only way promoted_by / promoted_at get set.
-- ---------------------------------------------------------------------------

create table lessons (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations (id),
  engagement_id         uuid not null unique references engagements (id),
  business_id           uuid not null references businesses (id),
  draft_id              uuid not null references chronicle_drafts (id),
  scout_intake_id       uuid references scout_intakes (id),
  predicted_bucket      text,
  predicted_readiness   text check (predicted_readiness in ('Ready', 'Conditional', 'Not Ready')),
  outcome               text not null check (outcome in ('delivered', 'partial', 'abandoned')),
  prediction_correct    boolean generated always as (
    case
      when predicted_readiness is null then null
      when predicted_readiness = 'Ready'       then outcome = 'delivered'
      when predicted_readiness = 'Not Ready'   then outcome <> 'delivered'
      when predicted_readiness = 'Conditional' then outcome = 'partial'
    end) stored,
  success_factors       text[] not null default '{}'
    check (coalesce(array_length(success_factors, 1), 0) <= 10),
  failure_factors       text[] not null default '{}'
    check (coalesce(array_length(failure_factors, 1), 0) <= 10),
  promoted_by           uuid references auth.users (id),
  promoted_at           timestamptz,
  promotion_approval_id uuid references approvals (id),
  created_by            uuid not null references auth.users (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint lessons_promotion_complete check (
    (promoted_by is null) = (promoted_at is null)
    and (promoted_by is null) = (promotion_approval_id is null))
);

create index lessons_organization_id_idx on lessons (organization_id);
create index lessons_business_id_idx on lessons (business_id);
create index lessons_promoted_bucket_idx on lessons (predicted_bucket) where promoted_at is not null;

comment on table lessons is
  'One lesson CANDIDATE per engagement (chronicle.md §6): what Scout predicted at intake, what happened, and model-proposed factors. Staff-visible and Scout-invisible until a human promotes it via promote_lesson(). prediction_correct is a generated column: computed from predicted_readiness and outcome, never judged.';

-- ---------------------------------------------------------------------------
-- d. RLS
-- ---------------------------------------------------------------------------

alter table lessons enable row level security;
alter table lessons force row level security;

-- Staff only; a partner never sees lessons. No insert/update/delete policy: rows arrive
-- only through submit_chronicle_draft() and promote_lesson().
create policy lessons_select_staff on lessons
  for select to authenticated
  using (is_admin() and organization_id in (select user_org_ids()));

revoke all on lessons from anon, authenticated, service_role;
grant select on lessons to authenticated;

-- ---------------------------------------------------------------------------
-- e. promoted_lessons
-- ---------------------------------------------------------------------------

-- security_invoker: the lessons RLS applies to whoever reads the view, so staff see only
-- the promoted rows of their own orgs and a partner sees none.
create view promoted_lessons with (security_invoker = true) as
  select id, organization_id, engagement_id, business_id, scout_intake_id,
         predicted_bucket, predicted_readiness, outcome, prediction_correct,
         success_factors, failure_factors, promoted_by, promoted_at
    from lessons
   where promoted_at is not null;

comment on view promoted_lessons is
  'The only lessons surface Scout-side code may read (chronicle.md §6): promoted rows only, RLS of lessons applied to the caller.';

revoke all on promoted_lessons from anon, authenticated, service_role;
grant select on promoted_lessons to authenticated;

-- ---------------------------------------------------------------------------
-- c. submit_architect_draft()
--
--
--   p_payload          jsonb  `architect_assessments` columns, snake_case
--                             (src/lib/supabase.ts `toColumns()` output): `scout_intake_id`,
--                             the 18 CSA answers, the maturity fields, `charter`,
--                             `ninety_day_plan`. Optional `source` ('model' | 'fallback')
--                             is recorded in the audit event. Unknown keys are ignored.
--   p_idempotency_key  text   8-200 chars, client-generated per submit
--   p_agent_run_id     uuid   the Architect `agent_runs` row, or null (the default)
--
-- Returns the approval id — the original one on a replayed key.
--
-- Derived here, never taken from the payload: `id` (= the intake id), the denormalized
-- handoff (`org_name`, `scout_bucket` = the reviewer's `final_bucket`, `scout_confidence`,
-- `scout_readiness`), `organization_id` (the intake's), `created_by` (auth.uid()) and
-- `created_by_email`. The maturity fields and documents are the handler's: the rubric is
-- TypeScript (agents/architect/scoring.ts), and the column checks bound what can be stored.
--
-- Errors (SQLSTATE -> what the handler should return):
--   42501  not an admin, or not an admin/owner of the intake's org      -> 403
--   P0002  no such intake                                                -> 404
--   55000  intake not yet reviewed (no final bucket to chart against)    -> 422
--   22023  bad payload / key, run not an Architect run, or the key was
--          already used for a different draft                           -> 400 / 422
--   23xxx  a column constraint rejected the payload                      -> 400
--
-- Provenance: v_source_type / v_model / v_prompt come from the run (an Architect run of
-- the intake's org, not already behind another assessment) or from `payload.model` when
-- the run was not recorded; 22023 otherwise. A re-conduct updates the provenance columns
-- and clears approved_by / approved_at: the new content has not been approved.
-- ---------------------------------------------------------------------------

create or replace function submit_architect_draft(
  p_payload jsonb,
  p_idempotency_key text,
  p_agent_run_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid         uuid := auth.uid();
  v_intake_id   uuid;
  v_intake      scout_intakes%rowtype;
  v_draft       architect_assessments%rowtype;
  v_existing    approvals%rowtype;
  v_email       text;
  v_approval_id uuid := gen_random_uuid();
  v_superseded  uuid[];
  v_source_type provenance_source;
  v_model       text;
  v_prompt      text;
  v_run         agent_runs%rowtype;
  v_unrecorded  boolean := false;
begin
  -- Authority first, before anything about the target is revealed.
  if v_uid is null or not is_admin() then
    raise exception 'submit_architect_draft: admin only' using errcode = '42501';
  end if;

  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200 then
    raise exception 'submit_architect_draft: idempotency key must be 8-200 characters'
      using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'submit_architect_draft: payload must be a JSON object'
      using errcode = '22023';
  end if;

  v_intake_id := nullif(p_payload ->> 'scout_intake_id', '')::uuid;
  if v_intake_id is null then
    raise exception 'submit_architect_draft: payload.scout_intake_id is required'
      using errcode = '22023';
  end if;

  -- Serialize submissions for one assessment, so two concurrent submits cannot both
  -- expire-then-insert and leave two pending approvals (the partial unique index above
  -- would reject the second; the lock makes it wait and replay or supersede instead).
  perform pg_advisory_xact_lock(hashtextextended('submit_architect_draft:' || v_intake_id::text, 0));

  select * into v_intake from scout_intakes where id = v_intake_id;
  if not found then
    raise exception 'submit_architect_draft: no intake %', v_intake_id using errcode = 'P0002';
  end if;

  -- is_admin() (0001_core) is true for an admin of ANY org. The draft lands in the intake's
  -- org, so the caller must hold admin authority in that org specifically. An intake with
  -- no org (anonymous, not yet assigned) falls back to is_admin() alone, as the 0001_core
  -- architect_assessments policies do.
  if v_intake.organization_id is not null and not exists (
    select 1 from organization_members
     where organization_id = v_intake.organization_id
       and user_id = v_uid
       and role in ('admin', 'owner')
  ) then
    raise exception 'submit_architect_draft: not an admin of this intake''s organization'
      using errcode = '42501';
  end if;

  -- Replay: the original result, not a second effect (design-system.md §8.1).
  select * into v_existing from approvals where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.agent <> 'architect'
       or v_existing.entity_type <> 'charter'
       or v_existing.entity_id <> v_intake_id then
      raise exception 'submit_architect_draft: idempotency key already used for a different draft'
        using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  -- The same precondition ArchitectAssessment.tsx enforces client-side: an assessment is
  -- built on a reviewed, bucketed intake (scout_intakes_review_complete guarantees the
  -- final bucket once reviewed).
  if v_intake.review_status <> 'reviewed' then
    raise exception 'submit_architect_draft: intake % has not been reviewed', v_intake_id
      using errcode = '55000';
  end if;

  -- A run id, when given, must be a run of this agent, for this intake's organization, not
  -- already spent on another assessment. Content stays caller-supplied: this binds the provenance to a
  -- real run, it cannot prove the run produced this text.
  if p_agent_run_id is not null then
    select * into v_run from agent_runs where id = p_agent_run_id and agent = 'architect';
    if not found then
      raise exception 'submit_architect_draft: % is not an Architect agent run', p_agent_run_id
        using errcode = '22023';
    end if;
    if v_run.organization_id is not null
       and v_run.organization_id is distinct from v_intake.organization_id then
      raise exception 'submit_architect_draft: run % belongs to another organization', p_agent_run_id
        using errcode = '22023';
    end if;
    if exists (
      select 1 from architect_assessments
       where run_id = p_agent_run_id and id <> v_intake_id
    ) then
      raise exception 'submit_architect_draft: run % already produced another assessment', p_agent_run_id
        using errcode = '22023';
    end if;
  end if;

  -- Provenance. 'model' is believed when a successful run proves it, or, when the run was
  -- not recorded (recorder outage: the paid output must not be lost, file header), when the
  -- handler names the model. The audit event flags that case as `run_unrecorded`.
  v_source_type := case when p_payload ->> 'source' = 'model' then 'ai' else 'derived' end;
  v_prompt := p_payload ->> 'prompt_version';
  if v_source_type = 'ai' then
    if p_agent_run_id is not null then
      if v_run.status <> 'success' then
        raise exception 'submit_architect_draft: source ''model'' needs a successful Architect run'
          using errcode = '22023';
      end if;
      v_model := v_run.model;
      v_prompt := coalesce(v_run.prompt_version, v_prompt);
    else
      v_model := nullif(btrim(p_payload ->> 'model'), '');
      if v_model is null then
        raise exception 'submit_architect_draft: source ''model'' with no run needs payload.model'
          using errcode = '22023';
      end if;
      v_unrecorded := true;
    end if;
  end if;

  v_draft := jsonb_populate_record(null::architect_assessments, p_payload);
  select email into v_email from auth.users where id = v_uid;

  insert into architect_assessments (
    id, scout_intake_id, organization_id,
    org_name, scout_bucket, scout_confidence, scout_readiness,
    q1_org_context, q2_org_size, q3_poc,
    q4_collection_scope, q5_data_locations, q6_system_integration,
    q7_integration_familiarity, q8_quality_confidence,
    q9_current_decisions, q10_wished_decisions, q11_decision_empowerment,
    q12_reporting_to, q13_reporting_automation,
    q14_tools, q15_staff_confidence, q16_budget_speed,
    q17a_wish_list, q17b_biggest_worry, q18_past_blockers,
    di_score, gov_score, tooling_score, dc_score, tc_score,
    points, composite_level, override_applied, flagged_dimensions,
    remediation_only, cross_check_flag,
    charter, ninety_day_plan,
    created_by, created_by_email,
    source_type, generated_by, model, prompt_version, run_id
  ) values (
    v_intake_id, v_intake_id, v_intake.organization_id,
    v_intake.org_name, v_intake.final_bucket, v_intake.confidence, v_intake.composite_signal,
    v_draft.q1_org_context, v_draft.q2_org_size, v_draft.q3_poc,
    v_draft.q4_collection_scope, v_draft.q5_data_locations, v_draft.q6_system_integration,
    v_draft.q7_integration_familiarity, v_draft.q8_quality_confidence,
    v_draft.q9_current_decisions, v_draft.q10_wished_decisions, v_draft.q11_decision_empowerment,
    v_draft.q12_reporting_to, v_draft.q13_reporting_automation,
    coalesce(v_draft.q14_tools, '{}'), v_draft.q15_staff_confidence, v_draft.q16_budget_speed,
    v_draft.q17a_wish_list, v_draft.q17b_biggest_worry, v_draft.q18_past_blockers,
    v_draft.di_score, v_draft.gov_score, v_draft.tooling_score, v_draft.dc_score, v_draft.tc_score,
    v_draft.points, v_draft.composite_level, coalesce(v_draft.override_applied, false),
    coalesce(v_draft.flagged_dimensions, '{}'),
    coalesce(v_draft.remediation_only, false), v_draft.cross_check_flag,
    v_draft.charter, v_draft.ninety_day_plan,
    v_uid, coalesce(v_email, ''),
    v_source_type, 'architect', v_model, v_prompt,
    case when v_source_type = 'ai' then p_agent_run_id end
  )
  -- Re-conduct (rules:203). created_at is kept; the author trigger stamps updated_at.
  on conflict (id) do update set
    organization_id            = excluded.organization_id,
    org_name                   = excluded.org_name,
    scout_bucket               = excluded.scout_bucket,
    scout_confidence           = excluded.scout_confidence,
    scout_readiness            = excluded.scout_readiness,
    q1_org_context             = excluded.q1_org_context,
    q2_org_size                = excluded.q2_org_size,
    q3_poc                     = excluded.q3_poc,
    q4_collection_scope        = excluded.q4_collection_scope,
    q5_data_locations          = excluded.q5_data_locations,
    q6_system_integration      = excluded.q6_system_integration,
    q7_integration_familiarity = excluded.q7_integration_familiarity,
    q8_quality_confidence      = excluded.q8_quality_confidence,
    q9_current_decisions       = excluded.q9_current_decisions,
    q10_wished_decisions       = excluded.q10_wished_decisions,
    q11_decision_empowerment   = excluded.q11_decision_empowerment,
    q12_reporting_to           = excluded.q12_reporting_to,
    q13_reporting_automation   = excluded.q13_reporting_automation,
    q14_tools                  = excluded.q14_tools,
    q15_staff_confidence       = excluded.q15_staff_confidence,
    q16_budget_speed           = excluded.q16_budget_speed,
    q17a_wish_list             = excluded.q17a_wish_list,
    q17b_biggest_worry         = excluded.q17b_biggest_worry,
    q18_past_blockers          = excluded.q18_past_blockers,
    di_score                   = excluded.di_score,
    gov_score                  = excluded.gov_score,
    tooling_score              = excluded.tooling_score,
    dc_score                   = excluded.dc_score,
    tc_score                   = excluded.tc_score,
    points                     = excluded.points,
    composite_level            = excluded.composite_level,
    override_applied           = excluded.override_applied,
    flagged_dimensions         = excluded.flagged_dimensions,
    remediation_only           = excluded.remediation_only,
    cross_check_flag           = excluded.cross_check_flag,
    charter                    = excluded.charter,
    ninety_day_plan            = excluded.ninety_day_plan,
    created_by                 = excluded.created_by,
    created_by_email           = excluded.created_by_email,
    -- Provenance follows the new content. A re-conduct supersedes the old draft, so a
    -- stamp from an approval of that old content must not survive on the new one.
    source_type                = excluded.source_type,
    generated_by               = excluded.generated_by,
    model                      = excluded.model,
    model_version              = null,
    prompt_version             = excluded.prompt_version,
    run_id                     = excluded.run_id,
    approved_by                = null,
    approved_at                = null;

  -- A re-submit supersedes the draft staff had not yet acted on. Approved and rejected
  -- rows are decisions already made and stay as they are.
  with expired as (
    update approvals
       set status = 'expired',
           notes  = 'superseded by approval ' || v_approval_id::text
     where agent = 'architect'
       and entity_type = 'charter'
       and entity_id = v_intake_id
       and status = 'pending'
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_superseded from expired;

  insert into approvals (
    id, organization_id, agent, agent_run_id, entity_type, entity_id,
    hitl_tier, status, idempotency_key
  ) values (
    v_approval_id, v_intake.organization_id, 'architect', p_agent_run_id, 'charter', v_intake_id,
    'L3', 'pending', p_idempotency_key
  );

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, detail)
  values (
    v_intake.organization_id, v_uid, 'architect.draft_submitted', 'charter', v_intake_id,
    jsonb_build_object(
      'approval_id', v_approval_id,
      'agent_run_id', p_agent_run_id,
      'superseded_approval_ids', to_jsonb(v_superseded),
      'source', p_payload ->> 'source',
      'run_unrecorded', v_unrecorded,
      'composite_level', v_draft.composite_level,
      'plan_shape', v_draft.ninety_day_plan ->> 'shape'
    )
  );

  return v_approval_id;
end;
$$;

revoke all on function submit_architect_draft(jsonb, text, uuid) from public, anon, service_role;
grant execute on function submit_architect_draft(jsonb, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- c. submit_envoy_draft() / submit_chronicle_draft()
--
--   p_payload          jsonb  Envoy: `engagement_id`, `occasion`, `subject`, `body`,
--                             `source` ('model' | 'fallback'), `prompt_version`, and
--                             `model` (required for 'model' with no run).
--                             Chronicle: `engagement_id`, `readiness` ('thin' | 'ready'),
--                             `headline`, `narrative`, `outcomes` (array), `source`,
--                             `prompt_version`, `model`. Unknown keys are ignored.
--   p_idempotency_key  text   8-200 chars, client-generated per submit
--   p_agent_run_id     uuid   the agent's `agent_runs` row, or null (the default)
--
-- Returns { "approval_id": uuid, "draft_id": uuid } — the original pair on a replayed key.
--
-- Derived here, never taken from the payload: the draft id, `organization_id` (the
-- engagement's), `created_by` (auth.uid()), `status`, `supersedes_id`, and all provenance
-- (source_type, generated_by, model, run_id). `source = 'model'` is a claim with two ways to
-- hold. (1) `p_agent_run_id` names a successful run of that agent, for this engagement and
-- org (a run's own engagement/org may be null), not already behind another draft in the
-- same table: model and prompt version are copied from `agent_runs`. (2) No run id, because
-- the recorder failed to write one: the draft is still saved, as 'ai', with `payload.model`
-- (required, else 22023), `payload.prompt_version`, run_id null and `run_unrecorded: true`
-- in the audit event — a recorder outage must not discard paid model output (file header).
-- Content is still caller-supplied: a run binds provenance, it cannot prove authorship of
-- this text. A 'fallback' draft is 'derived' and carries no model/run_id (data-model.md §7:
-- null unless 'ai'); its approval still links the run that failed.
--
-- Errors (SQLSTATE -> what the handler should return):
--   42501  not an admin, or not an admin/owner of the engagement's org   -> 403
--   P0002  no such engagement                                             -> 404
--   55000  Chronicle only: the business has no `membership`-stage row     -> 422
--   22023  bad payload / key / readiness / occasion / source, run not of
--          this agent / engagement / org, a run already behind another
--          draft, 'model' claimed on a run that did not succeed, or with
--          neither a run nor payload.model, the engagement has no
--          organization, or the key was already used for a different
--          draft                                                         -> 400
--   23xxx  a column constraint rejected the payload                       -> 400
-- ---------------------------------------------------------------------------

create or replace function submit_envoy_draft(
  p_payload jsonb,
  p_idempotency_key text,
  p_agent_run_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid           uuid := auth.uid();
  v_eng_id        uuid;
  v_eng           engagements%rowtype;
  v_existing      approvals%rowtype;
  v_occasion      text;
  v_source_type   provenance_source;
  v_model         text;
  v_prompt        text;
  v_run           agent_runs%rowtype;
  v_unrecorded    boolean := false;
  v_prior_id      uuid;
  v_draft_id      uuid := gen_random_uuid();
  v_approval_id   uuid := gen_random_uuid();
begin
  -- Authority first, before anything about the target is revealed.
  if v_uid is null or not is_admin() then
    raise exception 'submit_envoy_draft: admin only' using errcode = '42501';
  end if;

  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200 then
    raise exception 'submit_envoy_draft: idempotency key must be 8-200 characters'
      using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'submit_envoy_draft: payload must be a JSON object' using errcode = '22023';
  end if;

  v_eng_id := nullif(p_payload ->> 'engagement_id', '')::uuid;
  if v_eng_id is null then
    raise exception 'submit_envoy_draft: payload.engagement_id is required' using errcode = '22023';
  end if;

  -- Serialize submissions for one engagement, so two concurrent submits cannot both pick
  -- the same draft to supersede.
  perform pg_advisory_xact_lock(hashtextextended('submit_envoy_draft:' || v_eng_id::text, 0));

  select * into v_eng from engagements where id = v_eng_id;
  if not found then
    raise exception 'submit_envoy_draft: no engagement %', v_eng_id using errcode = 'P0002';
  end if;

  -- is_admin() is true for an admin of ANY org; the draft lands in the engagement's org, so
  -- the caller must hold admin authority there specifically (submit_architect_draft does the same).
  if v_eng.organization_id is null then
    raise exception 'submit_envoy_draft: engagement % has no organization', v_eng_id
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from organization_members
     where organization_id = v_eng.organization_id
       and user_id = v_uid
       and role in ('admin', 'owner')
  ) then
    raise exception 'submit_envoy_draft: not an admin of this engagement''s organization'
      using errcode = '42501';
  end if;

  -- Replay: the original result, not a second effect (design-system.md §8.1).
  select * into v_existing from approvals where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.agent <> 'envoy'
       or v_existing.entity_type <> 'communication'
       or v_existing.entity_id <> v_eng_id
       or v_existing.draft_id is null then
      raise exception 'submit_envoy_draft: idempotency key already used for a different draft'
        using errcode = '22023';
    end if;
    return jsonb_build_object('approval_id', v_existing.id, 'draft_id', v_existing.draft_id);
  end if;

  v_occasion := p_payload ->> 'occasion';
  if v_occasion is null
     or v_occasion not in ('kickoff', 'check_in', 'milestone_reached', 'at_risk_follow_up', 'wrap_up') then
    raise exception 'submit_envoy_draft: unknown occasion' using errcode = '22023';
  end if;
  if p_payload ->> 'source' is null or p_payload ->> 'source' not in ('model', 'fallback') then
    raise exception 'submit_envoy_draft: payload.source must be ''model'' or ''fallback'''
      using errcode = '22023';
  end if;

  -- A run id, when given, must be a run of this agent, for this engagement, not already
  -- spent on another draft. Content stays caller-supplied: this binds the provenance to a
  -- real run, it cannot prove the run produced this text.
  if p_agent_run_id is not null then
    select * into v_run from agent_runs where id = p_agent_run_id and agent = 'envoy';
    if not found then
      raise exception 'submit_envoy_draft: % is not an Envoy agent run', p_agent_run_id
        using errcode = '22023';
    end if;
    if (v_run.engagement_id is not null and v_run.engagement_id <> v_eng_id)
       or (v_run.organization_id is not null
           and v_run.organization_id <> v_eng.organization_id) then
      raise exception 'submit_envoy_draft: run % belongs to another engagement', p_agent_run_id
        using errcode = '22023';
    end if;
    if exists (select 1 from communications where run_id = p_agent_run_id) then
      raise exception 'submit_envoy_draft: run % already produced another draft', p_agent_run_id
        using errcode = '22023';
    end if;
  end if;

  -- Provenance. 'model' is believed when a successful run proves it, or, when the run was
  -- not recorded (recorder outage: the paid output must not be lost, file header), when the
  -- handler names the model. The audit event flags that case as `run_unrecorded`.
  v_source_type := case when p_payload ->> 'source' = 'model' then 'ai' else 'derived' end;
  v_prompt := p_payload ->> 'prompt_version';
  if v_source_type = 'ai' then
    if p_agent_run_id is not null then
      if v_run.status <> 'success' then
        raise exception 'submit_envoy_draft: source ''model'' needs a successful Envoy run'
          using errcode = '22023';
      end if;
      v_model := v_run.model;
      v_prompt := coalesce(v_run.prompt_version, v_prompt);
    else
      v_model := nullif(btrim(p_payload ->> 'model'), '');
      if v_model is null then
        raise exception 'submit_envoy_draft: source ''model'' with no run needs payload.model'
          using errcode = '22023';
      end if;
      v_unrecorded := true;
    end if;
  end if;

  -- Per occasion: a new kickoff supersedes the previous kickoff draft, not a check-in.
  select id into v_prior_id from communications
   where engagement_id = v_eng_id and occasion = v_occasion and status = 'draft'
   order by created_at desc, id desc
   limit 1;

  insert into communications (
    id, organization_id, engagement_id, occasion, subject, body, status, supersedes_id,
    created_by, source_type, generated_by, model, prompt_version, run_id
  ) values (
    v_draft_id, v_eng.organization_id, v_eng_id, v_occasion,
    p_payload ->> 'subject', p_payload ->> 'body', 'draft', v_prior_id,
    v_uid, v_source_type, 'envoy', v_model, v_prompt,
    case when v_source_type = 'ai' then p_agent_run_id end
  );

  -- The staff member had not yet acted on the superseded draft's approval; decisions
  -- already made (approved/rejected) stay as they are.
  if v_prior_id is not null then
    update approvals
       set status = 'expired',
           notes  = 'superseded by approval ' || v_approval_id::text
     where agent = 'envoy'
       and entity_type = 'communication'
       and draft_id = v_prior_id
       and status = 'pending';
  end if;

  insert into approvals (
    id, organization_id, agent, agent_run_id, entity_type, entity_id,
    hitl_tier, status, idempotency_key, draft_id
  ) values (
    v_approval_id, v_eng.organization_id, 'envoy', p_agent_run_id, 'communication', v_eng_id,
    'L3', 'pending', p_idempotency_key, v_draft_id
  );

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, detail)
  values (
    v_eng.organization_id, v_uid, 'envoy.draft_submitted', 'communication', v_eng_id,
    jsonb_build_object(
      'approval_id', v_approval_id,
      'draft_id', v_draft_id,
      'agent_run_id', p_agent_run_id,
      'superseded_draft_id', v_prior_id,
      'source', p_payload ->> 'source',
      'run_unrecorded', v_unrecorded,
      'occasion', v_occasion
    )
  );

  return jsonb_build_object('approval_id', v_approval_id, 'draft_id', v_draft_id);
end;
$$;

-- submit_chronicle_draft(): the payload, errors and provenance rules above, plus the
-- factor columns (payload keys `success_factors` / `failure_factors`, arrays of text,
-- default empty), the lesson upsert before the audit insert (the audit names it),
-- `lesson_id` in the replay and the result, and `lesson_id` / `lesson_frozen` /
-- `prediction_missing` in the audit detail. A re-submitted draft updates the candidate in
-- place while it is un-promoted; a promoted lesson is never rewritten (lesson_frozen).
--
-- Returns { "approval_id": uuid, "draft_id": uuid, "lesson_id": uuid }.

create or replace function submit_chronicle_draft(
  p_payload jsonb,
  p_idempotency_key text,
  p_agent_run_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid           uuid := auth.uid();
  v_eng_id        uuid;
  v_eng           engagements%rowtype;
  v_existing      approvals%rowtype;
  v_readiness     text;
  v_source_type   provenance_source;
  v_model         text;
  v_prompt        text;
  v_run           agent_runs%rowtype;
  v_unrecorded    boolean := false;
  v_prior_id      uuid;
  v_draft_id      uuid := gen_random_uuid();
  v_approval_id   uuid := gen_random_uuid();
  v_success       text[];
  v_failure       text[];
  v_biz           businesses%rowtype;
  v_intake        scout_intakes%rowtype;
  v_intake_found  boolean := false;
  v_outcome       text;
  v_lesson        lessons%rowtype;
  v_lesson_id     uuid;
  v_lesson_frozen boolean := false;
begin
  if v_uid is null or not is_admin() then
    raise exception 'submit_chronicle_draft: admin only' using errcode = '42501';
  end if;

  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200 then
    raise exception 'submit_chronicle_draft: idempotency key must be 8-200 characters'
      using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'submit_chronicle_draft: payload must be a JSON object' using errcode = '22023';
  end if;

  v_eng_id := nullif(p_payload ->> 'engagement_id', '')::uuid;
  if v_eng_id is null then
    raise exception 'submit_chronicle_draft: payload.engagement_id is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('submit_chronicle_draft:' || v_eng_id::text, 0));

  select * into v_eng from engagements where id = v_eng_id;
  if not found then
    raise exception 'submit_chronicle_draft: no engagement %', v_eng_id using errcode = 'P0002';
  end if;

  if v_eng.organization_id is null then
    raise exception 'submit_chronicle_draft: engagement % has no organization', v_eng_id
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from organization_members
     where organization_id = v_eng.organization_id
       and user_id = v_uid
       and role in ('admin', 'owner')
  ) then
    raise exception 'submit_chronicle_draft: not an admin of this engagement''s organization'
      using errcode = '42501';
  end if;

  select * into v_existing from approvals where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.agent <> 'chronicle'
       or v_existing.entity_type <> 'story'
       or v_existing.entity_id <> v_eng_id
       or v_existing.draft_id is null then
      raise exception 'submit_chronicle_draft: idempotency key already used for a different draft'
        using errcode = '22023';
    end if;
    -- The replay also names the lesson candidate (null if none exists).
    select id into v_lesson_id from lessons where engagement_id = v_eng_id;
    return jsonb_build_object(
      'approval_id', v_existing.id,
      'draft_id', v_existing.draft_id,
      'lesson_id', v_lesson_id
    );
  end if;

  -- Completion gate (lifecycle.md §5). `engagements.status` is per stage row, so
  -- "completed" is not a property of the business; the engagement is chronicle-eligible
  -- once the business has reached the membership stage.
  if not exists (
    select 1 from engagements
     where business_id = v_eng.business_id and stage = 'membership'
  ) then
    raise exception 'submit_chronicle_draft: business has no membership-stage engagement'
      using errcode = '55000';
  end if;

  -- 'not_ready' is the handler's answer to an engagement with nothing to write from; it
  -- saves no row and no approval, so it must never arrive here.
  v_readiness := p_payload ->> 'readiness';
  if v_readiness is null or v_readiness not in ('thin', 'ready') then
    raise exception 'submit_chronicle_draft: readiness must be ''thin'' or ''ready'''
      using errcode = '22023';
  end if;
  if p_payload ->> 'source' is null or p_payload ->> 'source' not in ('model', 'fallback') then
    raise exception 'submit_chronicle_draft: payload.source must be ''model'' or ''fallback'''
      using errcode = '22023';
  end if;

  -- A run id, when given, must be a run of this agent, for this engagement, not already
  -- spent on another draft. Content stays caller-supplied: this binds the provenance to a
  -- real run, it cannot prove the run produced this text.
  if p_agent_run_id is not null then
    select * into v_run from agent_runs where id = p_agent_run_id and agent = 'chronicle';
    if not found then
      raise exception 'submit_chronicle_draft: % is not a Chronicle agent run', p_agent_run_id
        using errcode = '22023';
    end if;
    if (v_run.engagement_id is not null and v_run.engagement_id <> v_eng_id)
       or (v_run.organization_id is not null
           and v_run.organization_id <> v_eng.organization_id) then
      raise exception 'submit_chronicle_draft: run % belongs to another engagement', p_agent_run_id
        using errcode = '22023';
    end if;
    if exists (select 1 from chronicle_drafts where run_id = p_agent_run_id) then
      raise exception 'submit_chronicle_draft: run % already produced another draft', p_agent_run_id
        using errcode = '22023';
    end if;
  end if;

  -- Provenance. 'model' is believed when a successful run proves it, or, when the run was
  -- not recorded (recorder outage: the paid output must not be lost, file header), when the
  -- handler names the model. The audit event flags that case as `run_unrecorded`.
  v_source_type := case when p_payload ->> 'source' = 'model' then 'ai' else 'derived' end;
  v_prompt := p_payload ->> 'prompt_version';
  if v_source_type = 'ai' then
    if p_agent_run_id is not null then
      if v_run.status <> 'success' then
        raise exception 'submit_chronicle_draft: source ''model'' needs a successful Chronicle run'
          using errcode = '22023';
      end if;
      v_model := v_run.model;
      v_prompt := coalesce(v_run.prompt_version, v_prompt);
    else
      v_model := nullif(btrim(p_payload ->> 'model'), '');
      if v_model is null then
        raise exception 'submit_chronicle_draft: source ''model'' with no run needs payload.model'
          using errcode = '22023';
      end if;
      v_unrecorded := true;
    end if;
  end if;

  -- Factors are model-proposed prose, stored on the draft and copied to the lesson.
  -- A missing/null key is empty; a non-array raises 22023 from jsonb_array_elements_text;
  -- more than ten trips the column check (23514).
  select coalesce(array_agg(x), '{}') into v_success
    from jsonb_array_elements_text(p_payload -> 'success_factors') x;
  select coalesce(array_agg(x), '{}') into v_failure
    from jsonb_array_elements_text(p_payload -> 'failure_factors') x;

  select id into v_prior_id from chronicle_drafts
   where engagement_id = v_eng_id and status = 'draft'
   order by created_at desc, id desc
   limit 1;

  insert into chronicle_drafts (
    id, organization_id, engagement_id, readiness, headline, narrative, outcomes,
    status, supersedes_id, created_by, source_type, generated_by, model, prompt_version, run_id,
    success_factors, failure_factors
  ) values (
    v_draft_id, v_eng.organization_id, v_eng_id, v_readiness,
    p_payload ->> 'headline', p_payload ->> 'narrative',
    coalesce(p_payload -> 'outcomes', '[]'::jsonb),
    'draft', v_prior_id, v_uid, v_source_type, 'chronicle', v_model, v_prompt,
    case when v_source_type = 'ai' then p_agent_run_id end,
    v_success, v_failure
  );

  if v_prior_id is not null then
    update approvals
       set status = 'expired',
           notes  = 'superseded by approval ' || v_approval_id::text
     where agent = 'chronicle'
       and entity_type = 'story'
       and draft_id = v_prior_id
       and status = 'pending';
  end if;

  insert into approvals (
    id, organization_id, agent, agent_run_id, entity_type, entity_id,
    hitl_tier, status, idempotency_key, draft_id
  ) values (
    v_approval_id, v_eng.organization_id, 'chronicle', p_agent_run_id, 'story', v_eng_id,
    'L3', 'pending', p_idempotency_key, v_draft_id
  );

  -- The lesson candidate. What Scout predicted at intake comes from the intake the
  -- business was created from (businesses.scout_intake_id, 0001_core); a business with none
  -- (every pre-R7 business) still gets a candidate, with null predictions.
  select * into v_biz from businesses where id = v_eng.business_id;
  if v_biz.scout_intake_id is not null then
    select * into v_intake from scout_intakes where id = v_biz.scout_intake_id;
    v_intake_found := found;
  end if;

  select * into v_lesson from lessons where engagement_id = v_eng_id;
  if found and v_lesson.promoted_at is not null then
    -- A promoted lesson is a human decision; a later draft never rewrites it.
    v_lesson_id := v_lesson.id;
    v_lesson_frozen := true;
  else
    v_outcome := derive_engagement_outcome(v_eng.business_id, v_eng_id);
    insert into lessons (
      organization_id, engagement_id, business_id, draft_id, scout_intake_id,
      predicted_bucket, predicted_readiness, outcome,
      success_factors, failure_factors, created_by
    ) values (
      v_eng.organization_id, v_eng_id, v_eng.business_id, v_draft_id,
      case when v_intake_found then v_intake.id end,
      case when v_intake_found then coalesce(v_intake.final_bucket, v_intake.bucket)::text end,
      case when v_intake_found then v_intake.composite_signal::text end,
      v_outcome, v_success, v_failure, v_uid
    )
    on conflict (engagement_id) do update set
      draft_id            = excluded.draft_id,
      scout_intake_id     = excluded.scout_intake_id,
      predicted_bucket    = excluded.predicted_bucket,
      predicted_readiness = excluded.predicted_readiness,
      outcome             = excluded.outcome,
      success_factors     = excluded.success_factors,
      failure_factors     = excluded.failure_factors,
      updated_at          = now()
    -- promote_lesson() takes a different advisory lock, so a promotion can commit between
    -- the read above and this write; the predicate keeps that promoted row untouched.
    where lessons.promoted_at is null
    returning id into v_lesson_id;
    if v_lesson_id is null then
      select id into v_lesson_id from lessons where engagement_id = v_eng_id;
      v_lesson_frozen := true;
    end if;
  end if;

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, detail)
  values (
    v_eng.organization_id, v_uid, 'chronicle.draft_submitted', 'story', v_eng_id,
    jsonb_build_object(
      'approval_id', v_approval_id,
      'draft_id', v_draft_id,
      'agent_run_id', p_agent_run_id,
      'superseded_draft_id', v_prior_id,
      'source', p_payload ->> 'source',
      'run_unrecorded', v_unrecorded,
      'readiness', v_readiness,
      'lesson_id', v_lesson_id,
      'lesson_frozen', v_lesson_frozen,
      'prediction_missing', not v_intake_found
    )
  );

  return jsonb_build_object(
    'approval_id', v_approval_id,
    'draft_id', v_draft_id,
    'lesson_id', v_lesson_id
  );
end;
$$;

-- The handlers call these as the user; the service role must not — the handler is
-- required to act as the caller.
revoke all on function submit_envoy_draft(jsonb, text, uuid) from public, anon, service_role;
grant execute on function submit_envoy_draft(jsonb, text, uuid) to authenticated;
revoke all on function submit_chronicle_draft(jsonb, text, uuid) from public, anon, service_role;
grant execute on function submit_chronicle_draft(jsonb, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- f. derive_engagement_outcome()
--
-- The outcome rule (chronicle.md §6), in this precedence:
--   1. 'abandoned' — the business's latest stage_advanced / stage_reverted event is a
--      stage_reverted (no later advance), OR the newest engagement_events row for the
--      business is older than 90 days;
--   2. else, when the engagement has >= 1 milestone: 'delivered' if every milestone is
--      'completed', 'partial' otherwise. (milestones has no 'waived' status, 0003_delivery, so
--      "completed or waived" collapses to 'completed'.)
--   3. else (no milestones): 'delivered' — reaching `membership` is the lifecycle's own
--      definition of completion, and submit_chronicle_draft() gates on it.
--
-- Definer functions bypass RLS, so the caller's authority is checked here: staff of the
-- engagement's organization, 42501 otherwise.
-- ---------------------------------------------------------------------------

create or replace function derive_engagement_outcome(p_business_id uuid, p_engagement_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid         uuid := auth.uid();
  v_eng         engagements%rowtype;
  v_last_kind   text;
  v_newest      timestamptz;
  v_milestones  integer;
  v_open        integer;
begin
  if v_uid is null or not is_admin() then
    raise exception 'derive_engagement_outcome: admin only' using errcode = '42501';
  end if;

  select * into v_eng from engagements where id = p_engagement_id;
  if not found then
    raise exception 'derive_engagement_outcome: no engagement %', p_engagement_id using errcode = 'P0002';
  end if;
  if v_eng.business_id is distinct from p_business_id then
    raise exception 'derive_engagement_outcome: engagement % is not of business %', p_engagement_id, p_business_id
      using errcode = '22023';
  end if;
  if v_eng.organization_id is null or not exists (
    select 1 from organization_members
     where organization_id = v_eng.organization_id
       and user_id = v_uid
       and role in ('admin', 'owner')
  ) then
    raise exception 'derive_engagement_outcome: not an admin of this engagement''s organization'
      using errcode = '42501';
  end if;

  -- 1. abandoned. kind is compared as text: it keeps this function independent of when the
  -- enum values exist (0001_core).
  select ev.kind::text into v_last_kind
    from engagement_events ev
    join engagements e on e.id = ev.engagement_id
   where e.business_id = p_business_id
     and ev.kind::text in ('stage_advanced', 'stage_reverted')
   order by ev.created_at desc, ev.id desc
   limit 1;
  if v_last_kind = 'stage_reverted' then
    return 'abandoned';
  end if;

  -- Staleness counts only before the business has reached membership: a finished
  -- engagement chronicled late is quiet because it is done, not abandoned.
  if not exists (
    select 1 from engagements where business_id = p_business_id and stage = 'membership'
  ) then
    select max(ev.created_at) into v_newest
      from engagement_events ev
      join engagements e on e.id = ev.engagement_id
     where e.business_id = p_business_id;
    if v_newest is not null and v_newest < now() - interval '90 days' then
      return 'abandoned';
    end if;
  end if;

  -- 2. milestones.
  select count(*), count(*) filter (where status <> 'completed')
    into v_milestones, v_open
    from milestones
   where engagement_id = p_engagement_id;
  if v_milestones >= 1 then
    return case when v_open = 0 then 'delivered' else 'partial' end;
  end if;

  -- 3. no milestones.
  return 'delivered';
end;
$$;

revoke all on function derive_engagement_outcome(uuid, uuid) from public, anon, service_role;
grant execute on function derive_engagement_outcome(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- h. promote_lesson()
--
--   p_lesson_id  uuid  the candidate to promote
--   p_notes      text  optional reviewer note, stored on the approval
--
-- Returns { "lesson_id", "approval_id", "promoted_at" }; an already-promoted lesson
-- returns its existing values and writes nothing (idempotent).
--
-- Called from the client with the user's JWT (T5's UI); there is no model call, so no
-- route. The lesson UPDATE runs as the function owner, so the revoke in (d) does not block it.
-- ---------------------------------------------------------------------------

create or replace function promote_lesson(
  p_lesson_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid         uuid := auth.uid();
  v_now         timestamptz := now();
  v_lesson      lessons%rowtype;
  v_approval_id uuid := gen_random_uuid();
begin
  if v_uid is null or not is_admin() then
    raise exception 'promote_lesson: admin only' using errcode = '42501';
  end if;

  select * into v_lesson from lessons where id = p_lesson_id;
  if not found then
    raise exception 'promote_lesson: no lesson %', p_lesson_id using errcode = 'P0002';
  end if;

  -- is_admin() is true for an admin of ANY org; the caller must hold authority in this one.
  if not exists (
    select 1 from organization_members
     where organization_id = v_lesson.organization_id
       and user_id = v_uid
       and role in ('admin', 'owner')
  ) then
    raise exception 'promote_lesson: not an admin of this lesson''s organization'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('promote_lesson:' || p_lesson_id::text, 0));

  -- Re-read under the lock: a concurrent promotion may have won.
  select * into v_lesson from lessons where id = p_lesson_id;
  if v_lesson.promoted_at is not null then
    return jsonb_build_object(
      'lesson_id', v_lesson.id,
      'approval_id', v_lesson.promotion_approval_id,
      'promoted_at', v_lesson.promoted_at
    );
  end if;

  insert into approvals (
    id, organization_id, agent, entity_type, entity_id, hitl_tier, status,
    reviewer_id, reviewed_at, notes, draft_id
  ) values (
    v_approval_id, v_lesson.organization_id, 'chronicle', 'lesson', v_lesson.id, 'L3', 'approved',
    v_uid, v_now, p_notes, v_lesson.draft_id
  );

  update lessons
     set promoted_by = v_uid,
         promoted_at = v_now,
         promotion_approval_id = v_approval_id,
         updated_at = v_now
   where id = v_lesson.id;

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, detail)
  values (
    v_lesson.organization_id, v_uid, 'chronicle.lesson_promoted', 'lesson', v_lesson.id,
    jsonb_build_object(
      'lesson_id', v_lesson.id,
      'approval_id', v_approval_id,
      'draft_id', v_lesson.draft_id,
      'engagement_id', v_lesson.engagement_id
    )
  );

  return jsonb_build_object(
    'lesson_id', v_lesson.id,
    'approval_id', v_approval_id,
    'promoted_at', v_now
  );
end;
$$;

revoke all on function promote_lesson(uuid, text) from public, anon, service_role;
grant execute on function promote_lesson(uuid, text) to authenticated;
