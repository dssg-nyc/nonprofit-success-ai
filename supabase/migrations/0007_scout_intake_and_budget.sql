-- 0007 — the Scout intake becomes a server-written row, and model calls get a per-user budget.
--
-- Until now the public form inserted its own `scout_intakes` row, with `hitl_tier` and the
-- routing result exactly as the browser sent them: the tier the server derived in
-- /api/route-intake was advisory, and a tampered client could file an `L2` intake with a
-- heuristic result of its own. Two changes close that:
--
--   1. `submit_scout_intake()` is the only way an intake is created. It is SECURITY
--      DEFINER, callable by `anon` and `authenticated` (the public form's anonymous
--      session), and derives everything a submitter must not choose: the review fields,
--      `organization_id`, the routing provenance, and `hitl_tier`. The tier is `L2` only
--      when a successful Scout `agent_runs` row — written by the recorder's service role,
--      so unforgeable from a client — recorded `L2` for a result that is still High +
--      Ready; everything else is `L3` (hitl.ts: "a model cannot grant itself a tier").
--      The direct INSERT privilege and its policy go away.
--
--   2. `check_model_budget(p_limit)` counts the caller's model calls per clock hour and
--      raises 53400 once the limit is reached. Handlers call it before the gateway, so one
--      session cannot loop the intake form (or any draft route) through paid model calls.
--      Supabase Auth's anonymous sign-in limit (30/hour/IP, config.toml) bounds sessions;
--      this bounds calls per session.
--
-- Errors (SQLSTATE -> what the handler returns):
--   submit_scout_intake
--     22023  payload not an object, run not a successful Scout run, run already behind
--            another intake                                               -> 400
--     22P02 / 23xxx  an enum or column constraint rejected a field          -> 400
--   check_model_budget
--     42501  no caller (auth.uid() null)                                   -> 401
--     53400  limit reached for this hour                                   -> 429
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. submit_scout_intake(p_intake jsonb, p_agent_run_id uuid) -> jsonb
--
--   p_intake        jsonb  the form fields (org_name, contact_name_role, contact_email,
--                          mission, scale, primary_need, primary_need_other,
--                          problem_description, current_systems, timeline,
--                          referral_source) and the routing result (bucket, confidence,
--                          rationale, poc_score, clarity_score, foothold_score,
--                          composite_signal, flags). Unknown keys are ignored; `hitl_tier`
--                          and every review/provenance key are ignored on purpose.
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
    id, org_name, contact_name_role, contact_email, mission, scale, primary_need,
    primary_need_other, problem_description, current_systems, timeline, referral_source,
    bucket, confidence, rationale, poc_score, clarity_score, foothold_score,
    composite_signal, flags, hitl_tier,
    routing_source, routing_run_id, routing_model, routing_prompt_version
  ) values (
    v_id,
    p_intake ->> 'org_name',
    p_intake ->> 'contact_name_role',
    p_intake ->> 'contact_email',
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
    case when v_source = 'ai' then v_run.prompt_version end
  );

  return jsonb_build_object('intake_id', v_id, 'hitl_tier', v_tier, 'routing_source', v_source);
end;
$$;

comment on function submit_scout_intake(jsonb, uuid) is
  'The only writer of scout_intakes. Derives review state, provenance and hitl_tier (L2 only from a successful Scout run); the caller supplies form fields and the routing result.';

revoke all on function submit_scout_intake(jsonb, uuid) from public, service_role;
grant execute on function submit_scout_intake(jsonb, uuid) to anon, authenticated;

-- The direct door closes: no role inserts an intake row by itself any more.
drop policy if exists scout_intakes_insert_public on scout_intakes;
revoke insert on scout_intakes from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Per-user model-call budget
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
