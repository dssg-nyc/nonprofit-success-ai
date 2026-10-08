-- The Scout-approve command — lifecycle.md §4 row 1 (T2): the "System" transition
-- that opens the pipeline. Called by `POST /api/scout-approve` with the CALLER's JWT.
--
-- Before this migration the first transition was unreachable from /api:
-- transition_engagement()'s initial_meeting guard needs businesses.scout_intake_id, and the
-- 0001_core trigger lets only a non-API role set that column. This function runs as its
-- owner, so it can; it is the one writer of the intake -> business link.
--
-- In ONE transaction, approve_scout_intake():
--   1. authorizes the caller as an admin/owner of the organization the intake lands in;
--   2. marks a `pending` intake reviewed (action `approved`, or `edited` when a different
--      final bucket is given), or accepts an intake the review queue already reviewed
--      approved/edited — a `redirected` intake never opens an engagement;
--   3. creates the `businesses` row for the intake if none exists (owner: the caller, a
--      staff member, until the partner has an account), linked by scout_intake_id;
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
--
-- Returns (snake_case jsonb; the handler maps it to the wire shape):
--   { intake_id, business_id, business_created, review_action, final_bucket,
--     engagement_id, event_id, transitioned_at, replayed }
--
-- Errors (SQLSTATE -> what the handler returns):
--   42501  not an admin, or not an admin/owner of the organization             -> 403
--   P0002  no such intake                                                       -> 404
--   55000  'guard:intake_approved' (the intake was reviewed `redirected`)       -> 422
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
  p_organization_id uuid default null
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

  -- 2. The review. A pending intake is reviewed here; a reviewed one is taken as is.
  if v_intake.review_status = 'pending' then
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
           reviewed_by_email = nullif(auth.jwt() ->> 'email', ''),
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

  -- 3. The business, created if absent (§4 row 1 side effect). The trigger's
  -- scout_intake_id lock passes because this function runs as its owner.
  select id into v_biz_id from businesses
   where scout_intake_id = p_intake_id
   order by created_at
   limit 1;
  if not found then
    v_biz_id := gen_random_uuid();
    insert into businesses (id, name, type, owner_id, organization_id, scout_intake_id)
    values (v_biz_id, v_intake.org_name, p_business_type, v_uid, v_org, p_intake_id);
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
    'engagement_id', v_transition -> 'engagement_id',
    'event_id', v_transition -> 'event_id',
    'transitioned_at', v_transition -> 'transitioned_at',
    'replayed', v_transition -> 'replayed'
  );
end;
$$;

comment on function approve_scout_intake(uuid, text, scout_bucket, text, business_type, uuid) is
  'The Scout-approve command (lifecycle.md §4 row 1): reviews a pending intake (or takes a reviewed approved/edited one), creates the linked business if absent, and opens initial_meeting through transition_engagement().';

-- Only a signed-in user may call this. anon has no auth.uid(), and the service role must
-- not — the handler is required to act as the caller.
revoke all on function approve_scout_intake(uuid, text, scout_bucket, text, business_type, uuid)
  from public, anon, service_role;
grant execute on function approve_scout_intake(uuid, text, scout_bucket, text, business_type, uuid)
  to authenticated;
