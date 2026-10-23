-- 0011: Scout registry enrichment (R19, roadmap D50).
--
-- `api/route-intake` looks the applicant up in the IRS registry (ProPublica Nonprofit
-- Explorer, `api/_scoutRegistry.ts`) before routing and files what it found beside the
-- result: the reduced record (`registry`, provenance `source = 'propublica'` inside it)
-- and how the lookup went (`registry_lookup`). Both are facts the route fetched, never
-- claims the applicant made — the browser never calls the RPC, the route does — so
-- `submit_scout_intake()` copies them as it copies the routing result. Rows filed before
-- this migration, and demo intakes, read `skipped`.

alter table scout_intakes
  add column registry        jsonb,
  add column registry_lookup text not null default 'skipped'
    constraint scout_intakes_registry_lookup_check
      check (registry_lookup in ('matched', 'not_found', 'ambiguous', 'unavailable', 'skipped'));

alter table scout_intakes
  -- `matched` is the one status with a record, and the only way a record gets in.
  add constraint scout_intakes_registry_matched
    check ((registry_lookup = 'matched') = (registry is not null)),
  -- A stored record always says where it came from (data-model.md §7).
  add constraint scout_intakes_registry_source
    check (registry is null or registry ->> 'source' = 'propublica');

comment on column scout_intakes.registry is
  'The applicant''s IRS registry record as `api/_scoutRegistry.ts` reduced it (ScoutRegistry on the wire): ein, name, city, state, nteeCode, subsectionCode, revenue, assets, latestFilingYear, source. Null unless registry_lookup = matched.';
comment on column scout_intakes.registry_lookup is
  'How the server-side registry lookup went before routing: matched / not_found / ambiguous / unavailable, or skipped (no lookup: demo intakes, rows filed before 0011).';

-- submit_scout_intake(): the 0007 body plus the two registry columns.
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
  -- The registry record and lookup status, as the route filed them (0011). A JSON
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
    id, org_name, contact_name_role, contact_email, mission, scale, primary_need,
    primary_need_other, problem_description, current_systems, timeline, referral_source,
    bucket, confidence, rationale, poc_score, clarity_score, foothold_score,
    composite_signal, flags, hitl_tier,
    routing_source, routing_run_id, routing_model, routing_prompt_version,
    registry, registry_lookup
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
    case when v_source = 'ai' then v_run.prompt_version end,
    v_registry,
    v_lookup
  );

  return jsonb_build_object('intake_id', v_id, 'hitl_tier', v_tier, 'routing_source', v_source);
end;
$$;

comment on function submit_scout_intake(jsonb, uuid) is
  'The only writer of scout_intakes. Derives review state, provenance and hitl_tier (L2 only from a successful Scout run); the caller supplies form fields, the routing result and the registry lookup (0011).';
