-- The lifecycle transition command — the single writer of engagement stage
-- (.claude/specs/db/lifecycle.md §2, §4, §8; D22).
--
-- A partner never writes stage or status (no INSERT/UPDATE privilege on engagements,
-- 0001_core). transition_engagement() authorizes, derives the current stage, classifies
-- the move, checks the guard, and writes the rows, the approval and the event in ONE
-- transaction, called by `POST /api/engagement-transition` with the CALLER's JWT.
--
-- The terminal lock in engagements_enforce_transitions() and the scout_intake_id lock
-- on businesses (0001_core) key on the session role. This function runs as its owner, so
-- its writes pass; nothing an API role does can.

-- ---------------------------------------------------------------------------
-- a. current_engagement_stage()
-- ---------------------------------------------------------------------------

-- lifecycle.md §3: the `in_progress` row; if none, the furthest-along `completed` row;
-- `pending` rows never make a stage current. Several `in_progress` orphans: the furthest.
-- Mirrors deriveCurrentStage() in src/lib/lifecycle.ts. Invoker rights: through the
-- API it sees only the rows the caller's RLS shows; inside the definer function, all.
create or replace function current_engagement_stage(p_business_id uuid)
returns table (stage engagement_stage, engagement_id uuid)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select e.stage, e.id
    from engagements e
   where e.business_id = p_business_id
     and e.status in ('in_progress', 'completed')
   order by (e.status = 'in_progress') desc, e.stage desc
   limit 1;
$$;

revoke all on function current_engagement_stage(uuid) from public, anon, service_role;
grant execute on function current_engagement_stage(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- b. transition_engagement()
--
--   p_business_id      uuid              the business whose engagement moves
--   p_to_stage         engagement_stage  the target; the caller never supplies the source
--   p_reason           text              mandatory for a reversal and for budget_check
--   p_idempotency_key  text              8-128 chars, client-generated per user action
--   p_evidence         jsonb             free-form supporting facts, stored on the event
--
-- Returns (snake_case jsonb; the handler maps it to the wire shape):
--   { engagement_id, from_stage, to_stage, transitioned_at, event_id, approval_id,
--     replayed }
-- `engagement_id` is the TARGET stage's row. On a replayed key it is the original result
-- with `replayed: true`.
--
-- Actors are staff only. §4 rows 1 and 2 are "System" transitions (Scout approve, contract
-- sign) whose callers do not exist yet, so an admin drives them through here with the
-- guard that can be checked: row 1 needs the business's scout intake reviewed
-- approved/edited; row 2's guard (engagement_contracts) has no table, so it is ATTESTED —
-- a non-empty reason, and the event detail records guard_deferred: 'contract'. Delete the
-- attestation branch when contract-sign (C2) lands.
--
-- Guards (target stage -> unmet condition, raised as 55000 with message 'guard:<name>'):
--   initial_meeting         intake_approved      reviewed approved/edited intake on the business
--   budget_check            contract_signed      no reason (attestation)
--   data_ethics_committee   budget_confirmed     budget_amount >= 0 on the budget_check row
--   scoping                 ethics_approved      approved 'assessment' approval for an assessment
--                                                of this business
--   hackathon_ready         plan_accepted        scoping row has assessment_id and >= 1 milestone
--   membership              milestones_complete  every milestone of the business is completed
-- L3 (an approvals row: agent 'system', entity 'transition', approved by the caller):
-- scoping, hackathon_ready, membership, and every reversal.
--
-- engagement_events.detail is a jsonb object:
--   {"from","to","reason","guard_deferred","approval_id","evidence"}.
--
-- Errors (SQLSTATE -> what the handler should return):
--   42501  not an admin, or not an admin/owner of the business's org      -> 403
--   P0002  no such business                                               -> 404
--   55000  'terminal' (out of membership)                                 -> 409
--          'guard:<name>' (a guard is unmet)                              -> 422
--   22023  messages 'stage_skipped', 'reason_required', 'invalid_transition'
--          (target is the current stage), or a bad key / evidence / a key
--          already used for a different business or target / a business
--          with no organization                                           -> 422 / 400
--   23505  a concurrent writer took the target stage                      -> 409
-- ---------------------------------------------------------------------------

create or replace function transition_engagement(
  p_business_id uuid,
  p_to_stage engagement_stage,
  p_reason text,
  p_idempotency_key text,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid           uuid := auth.uid();
  v_now           timestamptz := now();
  v_biz           businesses%rowtype;
  v_org           uuid;
  v_prior         engagement_events%rowtype;
  v_prior_biz     uuid;
  v_prior_detail  jsonb;
  v_cur_stage     engagement_stage;
  v_cur_id        uuid;
  v_cur           engagements%rowtype;
  v_target        engagements%rowtype;
  v_target_id     uuid;
  v_kind          text;
  v_reason        text := nullif(btrim(coalesce(p_reason, '')), '');
  v_deferred      text;
  v_l3            boolean;
  v_approval_id   uuid;
  v_event_id      uuid := gen_random_uuid();
  v_detail        jsonb;
begin
  -- Authority first, before anything about the target is revealed (the submit_* RPCs do the same).
  if v_uid is null or not is_admin() then
    raise exception 'transition_engagement: admin only' using errcode = '42501';
  end if;

  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 128 then
    raise exception 'transition_engagement: idempotency key must be 8-128 characters'
      using errcode = '22023';
  end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'object'
     or octet_length(p_evidence::text) > 8192 then
    raise exception 'transition_engagement: evidence must be a JSON object under 8KB'
      using errcode = '22023';
  end if;

  select * into v_biz from businesses where id = p_business_id;
  if not found then
    raise exception 'transition_engagement: no business %', p_business_id using errcode = 'P0002';
  end if;

  -- businesses.organization_id is nullable; the transition lands in that org,
  -- and is_admin() is true for an admin of ANY org, so the caller must hold admin
  -- authority in this one specifically.
  v_org := v_biz.organization_id;
  if v_org is null then
    raise exception 'transition_engagement: business % has no organization', p_business_id
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from organization_members
     where organization_id = v_org
       and user_id = v_uid
       and role in ('admin', 'owner')
  ) then
    raise exception 'transition_engagement: not an admin of this business''s organization'
      using errcode = '42501';
  end if;

  -- Serialize transitions for one business: the unique (business_id, stage) backstop
  -- (lifecycle.md §2) catches two writers to the SAME stage, this catches different ones.
  perform pg_advisory_xact_lock(hashtextextended('transition_engagement:' || p_business_id::text, 0));

  -- Replay: the original result, not a second transition.
  select * into v_prior from engagement_events where idempotency_key = p_idempotency_key;
  if found then
    select e.business_id into v_prior_biz from engagements e where e.id = v_prior.engagement_id;
    if v_prior_biz is distinct from p_business_id
       or v_prior.kind::text not in ('stage_advanced', 'stage_reverted') then
      raise exception 'transition_engagement: idempotency key already used for a different transition'
        using errcode = '22023';
    end if;
    v_prior_detail := v_prior.detail;
    if v_prior_detail ->> 'to' is distinct from p_to_stage::text then
      raise exception 'transition_engagement: idempotency key already used for a different transition'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'engagement_id', v_prior.engagement_id,
      'from_stage', v_prior_detail ->> 'from',
      'to_stage', v_prior_detail ->> 'to',
      'transitioned_at', v_prior.created_at,
      'event_id', v_prior.id,
      'approval_id', v_prior_detail ->> 'approval_id',
      'replayed', true
    );
  end if;

  -- Derive the source (§3). The caller never supplies it: a client-supplied fromStage is
  -- a lost-update race waiting to happen.
  select s.stage, s.engagement_id into v_cur_stage, v_cur_id
    from current_engagement_stage(p_business_id) s;

  -- Classify (§4). Mirrors classifyTransition() in src/lib/lifecycle.ts.
  if v_cur_stage is null then
    if p_to_stage <> 'initial_meeting' then
      raise exception 'stage_skipped' using errcode = '22023';
    end if;
    v_kind := 'first';
  elsif v_cur_stage = 'membership' then
    raise exception 'terminal' using errcode = '55000';
  elsif p_to_stage = v_cur_stage then
    raise exception 'invalid_transition' using errcode = '22023';
  elsif p_to_stage < v_cur_stage then
    if v_reason is null then
      raise exception 'reason_required' using errcode = '22023';
    end if;
    v_kind := 'reversal';
  elsif p_to_stage = (enum_range(v_cur_stage, null))[2] then
    v_kind := 'advance';
  else
    raise exception 'stage_skipped' using errcode = '22023';
  end if;

  -- Guards. A reversal has none beyond its reason: a passed gate no longer holds.
  if v_kind in ('first', 'advance') then
    case p_to_stage
      when 'initial_meeting' then
        if v_biz.scout_intake_id is null or not exists (
          select 1 from scout_intakes i
           where i.id = v_biz.scout_intake_id
             and i.review_status = 'reviewed'
             and i.review_action in ('approved', 'edited')
        ) then
          raise exception 'guard:intake_approved' using errcode = '55000';
        end if;
      when 'budget_check' then
        -- Attested until engagement_contracts exists (C2); delete this branch then.
        if v_reason is null then
          raise exception 'guard:contract_signed' using errcode = '55000';
        end if;
        v_deferred := 'contract';
      when 'data_ethics_committee' then
        if not exists (
          select 1 from engagements e
           where e.business_id = p_business_id
             and e.stage = 'budget_check'
             and e.budget_amount is not null
             and e.budget_amount >= 0
        ) then
          raise exception 'guard:budget_confirmed' using errcode = '55000';
        end if;
      when 'scoping' then
        if not exists (
          select 1 from approvals a
           where a.entity_type = 'assessment'
             and a.status = 'approved'
             and (a.organization_id is null or a.organization_id = v_org)
             and a.entity_id in (
               select e.assessment_id from engagements e
                where e.business_id = p_business_id and e.assessment_id is not null
               union
               select aa.id from architect_assessments aa
                where aa.scout_intake_id = v_biz.scout_intake_id
             )
        ) then
          raise exception 'guard:ethics_approved' using errcode = '55000';
        end if;
      when 'hackathon_ready' then
        if not exists (
          select 1 from engagements e
           where e.business_id = p_business_id
             and e.stage = 'scoping'
             and e.assessment_id is not null
        ) or not exists (
          select 1 from milestones m
            join engagements e on e.id = m.engagement_id
           where e.business_id = p_business_id
        ) then
          raise exception 'guard:plan_accepted' using errcode = '55000';
        end if;
      when 'membership' then
        -- No `waived` status exists (lifecycle.md §10): every milestone must be completed.
        if exists (
          select 1 from milestones m
            join engagements e on e.id = m.engagement_id
           where e.business_id = p_business_id
             and m.status <> 'completed'
        ) then
          raise exception 'guard:milestones_complete' using errcode = '55000';
        end if;
      else
        null;
    end case;
  end if;

  v_l3 := v_kind = 'reversal' or p_to_stage in ('scoping', 'hackathon_ready', 'membership');

  -- Writes. The source row completes, the target opens; the triggers' terminal and
  -- scout_intake_id locks pass because this function runs as its owner, not as the
  -- caller's API role.

  -- The source row completes. When the source is the furthest `completed` row (no
  -- in_progress row existed) there is nothing to complete.
  if v_cur_id is not null then
    update engagements set status = 'completed'
     where id = v_cur_id and status = 'in_progress';
    select * into v_cur from engagements where id = v_cur_id;
  end if;

  -- The target opens: an existing row (re-advance after a reversal, or a pending row)
  -- flips to in_progress; otherwise it is inserted. Intervening rows are untouched.
  select * into v_target from engagements
   where business_id = p_business_id and stage = p_to_stage;
  if found then
    update engagements set status = 'in_progress' where id = v_target.id;
    v_target_id := v_target.id;
  else
    v_target_id := gen_random_uuid();
    insert into engagements (id, business_id, owner_id, organization_id, stage, status)
    values (
      v_target_id, p_business_id,
      coalesce(v_cur.owner_id, v_biz.owner_id),
      coalesce(v_cur.organization_id, v_org),
      p_to_stage, 'in_progress'
    );
  end if;

  -- L3 is recorded, not implied: the staff member who drove the transition is the
  -- approver. Written before the event so the event can name it.
  if v_l3 then
    v_approval_id := gen_random_uuid();
    insert into approvals (
      id, organization_id, agent, entity_type, entity_id, hitl_tier, status,
      reviewer_id, reviewed_at, notes
    ) values (
      v_approval_id, v_org, 'system', 'transition', v_target_id, 'L3', 'approved',
      v_uid, v_now, v_reason
    );
  end if;

  v_detail := jsonb_strip_nulls(jsonb_build_object(
    'from', v_cur_stage,
    'to', p_to_stage,
    'reason', v_reason,
    'guard_deferred', v_deferred,
    'approval_id', v_approval_id,
    'evidence', case when p_evidence = '{}'::jsonb then null else p_evidence end
  ));

  insert into engagement_events (
    id, engagement_id, organization_id, kind, detail, created_by, created_at, idempotency_key,
    approval_id
  ) values (
    v_event_id, v_target_id, v_org,
    case when v_kind = 'reversal' then 'stage_reverted' else 'stage_advanced' end
      ::engagement_event_kind,
    v_detail, v_uid, v_now, p_idempotency_key, v_approval_id
  );

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, detail)
  values (
    v_org, v_uid, 'engagement.transition', 'engagement', v_target_id,
    jsonb_build_object(
      'from', v_cur_stage,
      'to', p_to_stage,
      'reason', v_reason,
      'guard_deferred', v_deferred,
      'approval_id', v_approval_id,
      'replayed', false
    )
  );

  return jsonb_build_object(
    'engagement_id', v_target_id,
    'from_stage', v_cur_stage,
    'to_stage', p_to_stage,
    'transitioned_at', v_now,
    'event_id', v_event_id,
    'approval_id', v_approval_id,
    'replayed', false
  );
end;
$$;

-- Only a signed-in user may call this. anon has no auth.uid(), and the service role must
-- not — the handler is required to act as the caller.
revoke all on function transition_engagement(uuid, engagement_stage, text, text, jsonb)
  from public, anon, service_role;
grant execute on function transition_engagement(uuid, engagement_stage, text, text, jsonb)
  to authenticated;
