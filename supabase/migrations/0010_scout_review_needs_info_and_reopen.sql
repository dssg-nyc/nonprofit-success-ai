-- Two review decisions the queue had no way to record (NPS #28 / #29, 2026-10-13):
--
--   1. "Needs more info" — a thin application is parked, not declined. New
--      scout_review_status value `needs_info`: the intake stays out of the pipeline and
--      review_notes carries what the reviewer asked for. approve_scout_intake() treats it
--      exactly like `pending` (the review happens on approve), so it is a queue state,
--      not a decision. The update policy's with-check (0001_core: only INTO `reviewed`)
--      and the completeness constraint (0001_core: a non-pending row carries an action and
--      a bucket) both learn the new state. `pending` stays the only insertable state.
--
--   2. Reopening a declined intake — approve_scout_intake(p_reopen => true) re-reviews a
--      `redirected` intake as approved/edited under the caller's name and opens the
--      pipeline. Without the flag a redirected intake is refused as before
--      ('guard:intake_approved'); reopening is an explicit act, never the default, and it
--      writes `reopened: true` into the audit row.
--
-- The new enum value is referenced here only through `<> 'reviewed'` / `<> 'pending'`
-- comparisons, so nothing in this file needs the value committed first.

alter type scout_review_status add value if not exists 'needs_info';

alter table scout_intakes drop constraint scout_intakes_review_complete;
alter table scout_intakes add constraint scout_intakes_review_complete check (
  review_status <> 'reviewed'
  or (review_action is not null and final_bucket is not null)
);

drop policy scout_intakes_update_admin on scout_intakes;
create policy scout_intakes_update_admin on scout_intakes
  for update to authenticated
  using (is_admin()
         and (organization_id is null
              or organization_id in (select user_org_ids())))
  with check (is_admin()
              and review_status <> 'pending'
              and (organization_id is null
                   or organization_id in (select user_org_ids())));

-- The one-door rule for the parked state: a `needs_info` row never carries a decision.
-- (review_notes, reviewed_by/_email/_at are the reviewer's request; the action and
-- bucket arrive only with the approve, decline or reopen that ends the wait.)
alter table scout_intakes add constraint scout_intakes_needs_info_undecided check (
  review_status = 'reviewed' or (review_action is null and final_bucket is null)
);

drop function approve_scout_intake(uuid, text, scout_bucket, text, business_type, uuid);

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
