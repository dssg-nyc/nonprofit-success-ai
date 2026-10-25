-- 0007_scout — the Scout intake door, the approve command and the model-call budget.
--
-- Second squash, 2026-10-25 (NPS #28): folds archived 0007–0011
-- (supabase/migrations/reference/archived/) into one file, with the applicant's contact
-- fields replaced by Salesforce ids. The table side (scout_intakes columns, the
-- needs_info state, the registry columns, businesses_select_admin) moved into 0001_core;
-- this file holds the commands.
--
--   1. submit_scout_intake() is the only way an intake is created. SECURITY DEFINER,
--      callable by `anon` and `authenticated` (the public form's anonymous session), it
--      derives everything a submitter must not choose: the review fields,
--      `organization_id`, the routing provenance, and `hitl_tier`. The tier is `L2` only
--      when a successful Scout `agent_runs` row — written by the recorder's service role,
--      so unforgeable from a client — recorded `L2` for a result that is still High +
--      Ready; everything else is `L3` (hitl.ts: "a model cannot grant itself a tier").
--      The applicant's name and email never reach it: /api/route-intake records them in
--      Salesforce first (api/_salesforce.ts) and passes `salesforce_account_id` /
--      `salesforce_contact_id`. The ids are format-checked (the salesforce_id domain and
--      the key-prefix checks); whether they resolve is Salesforce's question, not this
--      database's — there is no foreign key across the boundary.
--
--   2. check_model_budget(p_limit) counts the caller's model calls per clock hour and
--      raises 53400 once the limit is reached. Handlers call it before the gateway, so one
--      session cannot loop the intake form (or any draft route) through paid model calls.
--      Supabase Auth's anonymous sign-in limit (30/hour/IP, config.toml) bounds sessions;
--      this bounds calls per session.
--
--   3. approve_scout_intake() — lifecycle.md §4 row 1 (T2): the "System" transition that
--      opens the pipeline, called by `POST /api/scout-approve` with the CALLER's JWT.
--      transition_engagement()'s initial_meeting guard needs businesses.scout_intake_id,
--      and the 0001_core trigger lets only a non-API role set that column. This function
--      runs as its owner, so it can; it is the one writer of the intake -> business link.
--
-- Errors (SQLSTATE -> what the handler returns):
--   submit_scout_intake
--     22023  payload not an object, run not a successful Scout run, run already behind
--            another intake                                               -> 400
--     22P02 / 23xxx  an enum, domain or column constraint rejected a field  -> 400
--   check_model_budget
--     42501  no caller (auth.uid() null)                                   -> 401
--     53400  limit reached for this hour                                   -> 429
--   approve_scout_intake — see section 3.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. submit_scout_intake(p_intake jsonb, p_agent_run_id uuid) -> jsonb
--
--   p_intake        jsonb  the form fields (org_name, mission, scale, primary_need,
--                          primary_need_other, problem_description, current_systems,
--                          timeline, referral_source), the applicant's Salesforce ids
--                          (salesforce_account_id, salesforce_contact_id), the routing
--                          result (bucket, confidence, rationale, poc_score,
--                          clarity_score, foothold_score, composite_signal, flags) and the
--                          registry lookup (registry, registry_lookup). Unknown keys are
--                          ignored — a stray contact_email is dropped, never stored;
--                          `hitl_tier` and every review/provenance key are ignored on
--                          purpose.
--   p_agent_run_id  uuid   the successful Scout run that produced the result, or null
--                          when the deterministic fallback routed it.
--
-- Returns { "intake_id": uuid, "hitl_tier": 'L2'|'L3', "routing_source": 'ai'|'derived' }.
-- ---------------------------------------------------------------------------

create or replace function submit_scout_intake(
  p_intake jsonb,
  p_agent_run_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_run        agent_runs%rowtype;
  v_source     provenance_source := 'derived';
  v_tier       scout_hitl_tier := 'L3';
  v_confidence scout_confidence;
  v_signal     scout_composite_signal;
  v_flags      text[];
  v_registry   jsonb;
  v_lookup     text;
  v_id         uuid := gen_random_uuid();
begin
  if p_intake is null or jsonb_typeof(p_intake) <> 'object' then
    raise exception 'submit_scout_intake: intake must be a JSON object' using errcode = '22023';
  end if;

  v_confidence := nullif(p_intake ->> 'confidence', '')::scout_confidence;
  v_signal     := (p_intake ->> 'composite_signal')::scout_composite_signal;
  v_flags      := coalesce(
    (select array_agg(value) from jsonb_array_elements_text(
       case when jsonb_typeof(p_intake -> 'flags') = 'array' then p_intake -> 'flags' else '[]'::jsonb end)),
    '{}'::text[]);
  -- The registry record and lookup status, as the route filed them. A JSON
  -- `null` record is no record; the table checks the pair is consistent.
  v_registry := case when jsonb_typeof(p_intake -> 'registry') = 'object' then p_intake -> 'registry' end;
  v_lookup   := coalesce(nullif(p_intake ->> 'registry_lookup', ''), 'skipped');

  -- Provenance and tier come from the run, never from the payload. A run must be a
  -- successful Scout run not already behind another intake; the tier it recorded is
  -- honoured only while the result it is filed with still meets the L2 contract
  -- (High + Ready) — so neither half can be swapped after the fact.
  if p_agent_run_id is not null then
    select * into v_run from agent_runs where id = p_agent_run_id and agent = 'scout';
    if not found then
      raise exception 'submit_scout_intake: % is not a Scout agent run', p_agent_run_id
        using errcode = '22023';
    end if;
    if v_run.status <> 'success' then
      raise exception 'submit_scout_intake: run % did not succeed', p_agent_run_id
        using errcode = '22023';
    end if;
    if exists (select 1 from scout_intakes where routing_run_id = p_agent_run_id) then
      raise exception 'submit_scout_intake: run % already routed another intake', p_agent_run_id
        using errcode = '22023';
    end if;
    v_source := 'ai';
    if v_run.hitl_tier = 'L2' and v_confidence = 'High' and v_signal = 'Ready' then
      v_tier := 'L2';
    end if;
  end if;

  insert into scout_intakes (
    id, org_name, salesforce_account_id, salesforce_contact_id, mission, scale, primary_need,
    primary_need_other, problem_description, current_systems, timeline, referral_source,
    bucket, confidence, rationale, poc_score, clarity_score, foothold_score,
    composite_signal, flags, hitl_tier,
    routing_source, routing_run_id, routing_model, routing_prompt_version,
    registry, registry_lookup
  ) values (
    v_id,
    p_intake ->> 'org_name',
    p_intake ->> 'salesforce_account_id',
    p_intake ->> 'salesforce_contact_id',
    p_intake ->> 'mission',
    p_intake ->> 'scale',
    (p_intake ->> 'primary_need')::primary_need,
    nullif(p_intake ->> 'primary_need_other', ''),
    p_intake ->> 'problem_description',
    p_intake ->> 'current_systems',
    p_intake ->> 'timeline',
    coalesce(p_intake ->> 'referral_source', ''),
    nullif(p_intake ->> 'bucket', '')::scout_bucket,
    v_confidence,
    p_intake ->> 'rationale',
    (p_intake ->> 'poc_score')::smallint,
    (p_intake ->> 'clarity_score')::smallint,
    (p_intake ->> 'foothold_score')::smallint,
    v_signal,
    v_flags,
    v_tier,
    v_source,
    case when v_source = 'ai' then p_agent_run_id end,
    case when v_source = 'ai' then v_run.model end,
    case when v_source = 'ai' then v_run.prompt_version end,
    v_registry,
    v_lookup
  );

  return jsonb_build_object('intake_id', v_id, 'hitl_tier', v_tier, 'routing_source', v_source);
end;
$$;

comment on function submit_scout_intake(jsonb, uuid) is
  'The only writer of scout_intakes. Derives review state, provenance and hitl_tier (L2 only from a successful Scout run); the caller supplies form fields, the applicant''s Salesforce ids, the routing result and the registry lookup.';

revoke all on function submit_scout_intake(jsonb, uuid) from public, service_role;
grant execute on function submit_scout_intake(jsonb, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Per-user model-call budget (archived 0007)
-- ---------------------------------------------------------------------------

create table model_call_budget (
  user_id      uuid not null,
  window_start timestamptz not null,
  calls        int not null default 0 check (calls >= 0),
  primary key (user_id, window_start)
);

comment on table model_call_budget is
  'Model calls per user per clock hour, maintained by check_model_budget(). No role reads or writes it directly.';

create index model_call_budget_window_idx on model_call_budget (window_start);

alter table model_call_budget enable row level security;
revoke all on model_call_budget from public, anon, authenticated, service_role;

-- Counts this call and returns how many remain in the hour; raises 53400 when the
-- limit is already spent. Raising aborts the increment, so refused calls do not extend
-- the window. Rows older than a day are swept on each call — at these volumes a sweep
-- is cheaper than a scheduler. `p_limit` is the handler's policy (env), capped so a
-- client calling the RPC directly can only inflate its own counter, never lift it.
create or replace function check_model_budget(p_limit int default 20)
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_calls int;
begin
  if v_uid is null then
    raise exception 'check_model_budget: no caller' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'check_model_budget: limit must be 1-1000' using errcode = '22023';
  end if;

  delete from model_call_budget where window_start < now() - interval '1 day';

  insert into model_call_budget (user_id, window_start, calls)
  values (v_uid, date_trunc('hour', now()), 1)
  on conflict (user_id, window_start)
    do update set calls = model_call_budget.calls + 1
  returning calls into v_calls;

  if v_calls > p_limit then
    raise exception 'check_model_budget: hourly model-call limit reached' using errcode = '53400';
  end if;
  return p_limit - v_calls;
end;
$$;

comment on function check_model_budget(int) is
  'Counts one model call for auth.uid() in the current hour and returns the remainder; 53400 once p_limit is spent.';

revoke all on function check_model_budget(int) from public, anon, service_role;
grant execute on function check_model_budget(int) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. approve_scout_intake(...) -> jsonb
--
-- In ONE transaction, approve_scout_intake():
--   1. authorizes the caller as an admin/owner of the organization the intake lands in;
--   2. marks a `pending` or `needs_info` intake reviewed (action `approved`, or `edited`
--      when a different final bucket is given), or accepts an intake the review queue
--      already reviewed approved/edited. A `redirected` intake opens an engagement only
--      when the caller reopens it (p_reopen => true; `reopened: true` in the audit row);
--   3. creates the `businesses` row for the intake if none exists (owner: the caller, a
--      staff member, until the partner has an account), linked by scout_intake_id and
--      carrying the intake's salesforce_account_id;
--   4. calls transition_engagement(business, 'initial_meeting', ...) under the caller's
--      idempotency key, so the event, the audit row and replay come from the single writer
--      of stage, not a second implementation.
--
-- Parameters:
--   p_intake_id        uuid           the scout_intakes row
--   p_idempotency_key  text           8-128 chars, client-generated per user action;
--                                     passed through to transition_engagement()
--   p_final_bucket     scout_bucket   the reviewer's bucket; null keeps Scout's (`approved`)
--   p_review_notes     text           optional reviewer notes (only when this call reviews)
--   p_business_type    business_type  default 'nonprofit'
--   p_organization_id  uuid           which org to file under, when the intake has none
--                                     and the caller administers more than one
--   p_reopen           boolean        re-review a `redirected` intake (default false)
--
-- Returns (snake_case jsonb; the handler maps it to the wire shape):
--   { intake_id, business_id, business_created, review_action, final_bucket,
--     reopened, engagement_id, event_id, transitioned_at, replayed }
--
-- Errors (SQLSTATE -> what the handler returns):
--   42501  not an admin, or not an admin/owner of the organization             -> 403
--   P0002  no such intake                                                       -> 404
--   55000  'guard:intake_approved' (reviewed `redirected`, no p_reopen)        -> 422
--   22023  'bucket_required'       pending intake with no bucket and none given -> 422
--          'already_reviewed'      a reviewed intake and a different bucket     -> 422
--          'already_approved'      the business already has an engagement, and
--                                  the key is new                               -> 422
--          'organization_required' no org on the intake, caller admins several -> 422
--          anything else (bad key, transition_engagement's own 22023)           -> 400
-- ---------------------------------------------------------------------------

create or replace function approve_scout_intake(
  p_intake_id uuid,
  p_idempotency_key text,
  p_final_bucket scout_bucket default null,
  p_review_notes text default null,
  p_business_type business_type default 'nonprofit',
  p_organization_id uuid default null,
  p_reopen boolean default false
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
  v_intake      scout_intakes%rowtype;
  v_org         uuid;
  v_action      scout_review_action;
  v_bucket      scout_bucket;
  v_reviewed    boolean := false;
  v_reopened    boolean := false;
  v_biz_id      uuid;
  v_created     boolean := false;
  v_transition  jsonb;
begin
  -- Authority first, before anything about the intake is revealed.
  if v_uid is null or not is_admin() then
    raise exception 'approve_scout_intake: admin only' using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 128 then
    raise exception 'approve_scout_intake: idempotency key must be 8-128 characters'
      using errcode = '22023';
  end if;

  select * into v_intake from scout_intakes where id = p_intake_id for update;
  if not found then
    raise exception 'approve_scout_intake: no intake %', p_intake_id using errcode = 'P0002';
  end if;

  -- The organization the engagement lands in: the intake's, once set during review;
  -- else the caller's choice; else the caller's only org. is_admin() is true for an
  -- admin of ANY org, so the caller must hold admin authority in this one specifically.
  v_org := coalesce(v_intake.organization_id, p_organization_id);
  if v_org is null then
    select organization_id into v_org
      from organization_members
     where user_id = v_uid and role in ('admin', 'owner');
    if not found then
      raise exception 'approve_scout_intake: admin only' using errcode = '42501';
    end if;
    if (select count(*) from organization_members
         where user_id = v_uid and role in ('admin', 'owner')) > 1 then
      raise exception 'organization_required' using errcode = '22023';
    end if;
  end if;
  if not exists (
    select 1 from organization_members
     where organization_id = v_org and user_id = v_uid and role in ('admin', 'owner')
  ) then
    raise exception 'approve_scout_intake: not an admin of this organization'
      using errcode = '42501';
  end if;

  -- 2. The review. A pending or parked (needs_info) intake is reviewed here; a declined
  -- one only when the caller reopens it explicitly; an approved one is taken as is.
  v_reopened := v_intake.review_status = 'reviewed'
                and v_intake.review_action = 'redirected'
                and p_reopen;
  if v_intake.review_status <> 'reviewed' or v_reopened then
    v_bucket := coalesce(p_final_bucket, v_intake.bucket);
    if v_bucket is null then
      raise exception 'bucket_required' using errcode = '22023';
    end if;
    v_action := case when p_final_bucket is null or p_final_bucket = v_intake.bucket
                     then 'approved' else 'edited' end;
    update scout_intakes
       set review_status = 'reviewed',
           review_action = v_action,
           final_bucket = v_bucket,
           reviewed_by = v_uid,
           reviewed_at = v_now,
           review_notes = nullif(btrim(coalesce(p_review_notes, '')), ''),
           organization_id = v_org
     where id = p_intake_id;
    v_reviewed := true;
  else
    if v_intake.review_action not in ('approved', 'edited') then
      raise exception 'guard:intake_approved' using errcode = '55000';
    end if;
    if p_final_bucket is not null and p_final_bucket <> v_intake.final_bucket then
      raise exception 'already_reviewed' using errcode = '22023';
    end if;
    v_action := v_intake.review_action;
    v_bucket := v_intake.final_bucket;
    if v_intake.organization_id is null then
      update scout_intakes set organization_id = v_org where id = p_intake_id;
    end if;
  end if;

  -- 3. The business, created if absent (§4 row 1 side effect). It inherits the intake's
  -- Salesforce Account, so the partner's record and the pipeline row point at the same
  -- organization. The triggers' scout_intake_id / salesforce_account_id locks pass
  -- because this function runs as its owner.
  select id into v_biz_id from businesses
   where scout_intake_id = p_intake_id
   order by created_at
   limit 1;
  if not found then
    v_biz_id := gen_random_uuid();
    insert into businesses (id, name, type, owner_id, organization_id, scout_intake_id,
                            salesforce_account_id)
    values (v_biz_id, v_intake.org_name, p_business_type, v_uid, v_org, p_intake_id,
            v_intake.salesforce_account_id);
    v_created := true;
  end if;

  -- 4. The first transition. A business already in the pipeline is refused unless the
  -- key is a replay, which transition_engagement() answers with the original result.
  if exists (select 1 from current_engagement_stage(v_biz_id))
     and not exists (select 1 from engagement_events where idempotency_key = p_idempotency_key) then
    raise exception 'already_approved' using errcode = '22023';
  end if;

  v_transition := transition_engagement(
    v_biz_id, 'initial_meeting', null, p_idempotency_key,
    jsonb_build_object('scout_intake_id', p_intake_id, 'review_action', v_action)
  );

  if v_reviewed or v_created then
    insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, detail)
    values (
      v_org, v_uid, 'scout_intake.approve', 'scout_intake', p_intake_id,
      jsonb_build_object(
        'review_action', v_action,
        'final_bucket', v_bucket,
        'reviewed_here', v_reviewed,
        'reopened', v_reopened,
        'business_id', v_biz_id,
        'business_created', v_created
      )
    );
  end if;

  return jsonb_build_object(
    'intake_id', p_intake_id,
    'business_id', v_biz_id,
    'business_created', v_created,
    'review_action', v_action,
    'final_bucket', v_bucket,
    'reopened', v_reopened,
    'engagement_id', v_transition -> 'engagement_id',
    'event_id', v_transition -> 'event_id',
    'transitioned_at', v_transition -> 'transitioned_at',
    'replayed', v_transition -> 'replayed'
  );
end;
$$;

comment on function approve_scout_intake(uuid, text, scout_bucket, text, business_type, uuid, boolean) is
  'The Scout-approve command (lifecycle.md §4 row 1): reviews a pending or needs_info intake (or a redirected one when p_reopen), takes an approved/edited one as is, creates the linked business if absent, and opens initial_meeting through transition_engagement().';

revoke all on function approve_scout_intake(uuid, text, scout_bucket, text, business_type, uuid, boolean)
  from public, anon, service_role;
grant execute on function approve_scout_intake(uuid, text, scout_bucket, text, business_type, uuid, boolean)
  to authenticated;
