-- Initial schema — a translation of firestore.rules (207 lines) into Postgres.
--
-- Mapping conventions used throughout:
--   * Firestore "entity validation" functions  -> column types, NOT NULL, CHECK constraints
--   * Firestore allow/deny rules               -> RLS policies
--   * Rules that inspect the *diff* between old and new documents (immutable fields,
--     affectedKeys().hasOnly(...), terminal-state locking) -> BEFORE UPDATE triggers,
--     because a policy's USING/WITH CHECK cannot express "these columns did not change"
--     as readably, and a trigger fails closed for every writer including future ones.
--   * Firestore document IDs (client-supplied strings) -> uuid primary keys, except
--     `users.id` which is auth.users.id, and `architect_assessments.id` which IS the
--     source intake id (rules:200, the 1:1 relationship).
--
-- Field naming: snake_case columns; the TypeScript layer keeps camelCase and maps at the
-- query edge (see `mapKeys` in src/lib/supabase.ts). Columns that are already snake_case
-- in Firestore (`org_name`, `q1_org_context`, ...) keep their exact names, so the mapper
-- is only responsible for the genuinely camelCase ones.
--
-- INTENTIONAL DIVERGENCES from firestore.rules (each one deliberate, not an oversight):
--
--  1. rules:42,73,143 `data.keys().size() <= N` — a Firestore guard against unknown
--     fields being smuggled into a document. Postgres has a fixed column list, so
--     unknown keys are rejected by the schema itself. No constraint needed.
--
--  2. rules:19 `isValidId()` (string, <=128 chars, `^[a-zA-Z0-9_\-]+$`) — a guard against
--     hostile client-supplied document IDs. Ids here are `uuid`, so the type enforces a
--     strictly narrower set than the regex did.
--
--  3. rules:15 `isEmailVerified()` is defined but never called by any rule. Not ported;
--     porting it would ADD an unenforced restriction rather than preserve one.
--
--  4. rules:107,118 `allow list: if isSignedIn() && resource.data.ownerId == uid` — in
--     Firestore, `get` and `list` are distinct verbs. Postgres has only SELECT, and the
--     owner-scoping predicate is identical in both, so `get`+`list` collapse to one
--     SELECT policy per table with no change in who can read what.
--
--  5. rules:126 uses `.hasAny(...)` for engagement updates where businesses:111 uses
--     `.hasOnly(...)`. `hasAny` is almost certainly a bug upstream — it permits changing
--     ANY field as long as one listed field is also touched. Ported as the restrictive
--     `hasOnly` equivalent (an explicit immutable-column trigger). Flagged for review
--     rather than silently reproducing a rule that lets a client rewrite arbitrary
--     columns.
--
--  6. rules:176 `charter is map && ninetyDayPlan is map` — deep validation was declared
--     impractical in rules and remains so here; `jsonb` + a NOT NULL object check is the
--     same shape-only guarantee.
--
--  7. `scout_intakes.confidence` / `bucket` are nullable (rules:85–86 allow null), while
--     `architect_assessments.scout_bucket` is NOT NULL (rules:146 requires a member of
--     the enum). That asymmetry is in the source rules and is preserved.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type user_role as enum ('client', 'admin');                        -- rules:44
create type business_type as enum ('small_business', 'nonprofit');        -- rules:51

-- U7: the six-stage engagement pipeline. rules:62
create type engagement_stage as enum (
  'initial_meeting',
  'budget_check',
  'data_ethics_committee',
  'scoping',
  'hackathon_ready',
  'membership'
);
create type engagement_status as enum ('pending', 'in_progress', 'completed');  -- rules:63

create type scout_bucket as enum (                                        -- rules:85
  'Data Infrastructure',
  'Analytics & Insight',
  'ML / Predictive',
  'Tooling & Automation',
  'Advisory / Strategy'
);
create type scout_confidence as enum ('High', 'Medium', 'Low');           -- rules:86
create type scout_composite_signal as enum ('Ready', 'Conditional', 'Not Ready');  -- rules:89
create type scout_hitl_tier as enum ('L2', 'L3');                         -- rules:91
create type scout_review_status as enum ('pending', 'reviewed');          -- rules:92,188
create type scout_review_action as enum ('approved', 'edited', 'redirected');  -- rules:189

create type primary_need as enum (                                        -- rules:79
  'analyze_data',
  'build_tool',
  'ml_predictive',
  'organize_data',
  'strategy_guidance',
  'something_else'
);

-- Architect CSA answer domains. rules:151–163
create type collection_scope as enum ('systematic', 'partial', 'not_systematic');
create type system_integration as enum ('own_island', 'some_share', 'most_share_auto');
create type integration_familiarity as enum ('not_familiar', 'somewhat_familiar', 'very_familiar');
create type quality_confidence as enum ('not_confident', 'mixed', 'very_confident');
create type decision_empowerment as enum ('not_from_data', 'leadership_managers', 'anyone_with_access');
create type reporting_automation as enum ('none_manual', 'semi_automated', 'mostly_automated');
create type staff_confidence as enum ('low_comfort', 'some_adhoc', 'dedicated_staff');
create type budget_speed as enum ('case_by_case', 'requires_approval', 'fast');
create type composite_level as enum ('Foundational', 'Developing', 'Established');  -- rules:170

-- ---------------------------------------------------------------------------
-- users — rules:96–102
-- ---------------------------------------------------------------------------

create table users (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null check (char_length(email) <= 256),   -- rules:43
  display_name  text check (char_length(display_name) <= 128),     -- rules:45
  role          user_role not null default 'client',               -- rules:44,98
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on column users.role is
  'Immutable after insert (rules:100) and forced to ''client'' on self-insert (rules:98). '
  'Elevation to admin is an out-of-band operation performed with the service role, which '
  'bypasses RLS and the immutability trigger by design.';

-- ---------------------------------------------------------------------------
-- businesses — rules:105–113
-- ---------------------------------------------------------------------------

create table businesses (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null check (char_length(name) <= 256),      -- rules:50
  type        business_type not null,                              -- rules:51
  ein         text check (char_length(ein) <= 64),                 -- rules:53
  industry    text check (char_length(industry) <= 128),           -- rules:54
  owner_id    uuid not null references users (id) on delete cascade,  -- rules:52
  certified   boolean not null default false,                      -- rules:55
  address     text,                                                -- rules:111 (updatable)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index businesses_owner_id_idx on businesses (owner_id);

-- ---------------------------------------------------------------------------
-- engagements — rules:116–128
-- ---------------------------------------------------------------------------

create table engagements (
  id                uuid primary key default uuid_generate_v4(),
  -- rules:120 required the referenced business to exist ("Atomic Guarantee");
  -- a foreign key is the same guarantee enforced by the database.
  business_id       uuid not null references businesses (id) on delete cascade,
  owner_id          uuid not null references users (id) on delete cascade,  -- rules:61
  stage             engagement_stage not null,                     -- rules:62
  status            engagement_status not null,                    -- rules:63
  notes             text,
  budget_amount     numeric check (budget_amount is null or budget_amount >= 0),
  hackathon_project text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index engagements_owner_id_idx on engagements (owner_id);
create index engagements_business_id_idx on engagements (business_id);

-- One engagement per stage per business.
--
-- Not in firestore.rules: the portal enforced this structurally, by writing the
-- engagement to the deterministic document id `{businessId}_{stage}`, so a second write
-- for the same stage overwrote the first instead of adding a row. Surrogate uuid keys
-- lose that property, and without this constraint a double-submit silently creates two
-- engagements for one stage — which the UI then renders as whichever `find()` hits first.
-- Stating it as a constraint also gives the client a conflict target to upsert onto.
alter table engagements
  add constraint engagements_business_stage_key unique (business_id, stage);

-- ---------------------------------------------------------------------------
-- scout_intakes — rules:180–193
-- ---------------------------------------------------------------------------

create table scout_intakes (
  id                  uuid primary key default uuid_generate_v4(),

  -- intake fields (public, write-once). rules:74–84
  org_name            text not null check (char_length(org_name) <= 256),
  contact_name_role   text not null check (char_length(contact_name_role) <= 256),
  contact_email       text not null check (char_length(contact_email) <= 256),
  mission             text not null check (char_length(mission) <= 1000),
  scale               text not null check (char_length(scale) <= 500),
  primary_need        primary_need not null,
  primary_need_other  text check (char_length(primary_need_other) <= 500),
  problem_description text not null check (char_length(problem_description) <= 2000),
  current_systems     text not null check (char_length(current_systems) <= 500),
  timeline            text not null check (char_length(timeline) <= 500),
  referral_source     text not null check (char_length(referral_source) <= 256),
  submitted_at        timestamptz not null default now(),

  -- scout output (computed at submit time). rules:85–91
  bucket              scout_bucket,          -- nullable: rules:85
  confidence          scout_confidence,      -- nullable: rules:86
  rationale           text not null check (char_length(rationale) <= 1000),
  poc_score           smallint not null check (poc_score between 1 and 3),
  clarity_score       smallint not null check (clarity_score between 1 and 3),
  foothold_score      smallint not null check (foothold_score between 1 and 3),
  composite_signal    scout_composite_signal not null,
  flags               text[] not null default '{}' check (array_length(flags, 1) is null
                                                          or array_length(flags, 1) <= 10),
  hitl_tier           scout_hitl_tier not null,

  -- review fields (admin-only). rules:185–191
  review_status       scout_review_status not null default 'pending',
  review_action       scout_review_action,
  final_bucket        scout_bucket,
  reviewed_by         uuid references users (id),
  reviewed_by_email   text check (char_length(reviewed_by_email) <= 256),
  reviewed_at         timestamptz,
  review_notes        text,
  onboarding_kit      text,

  -- rules:188–190 required a reviewed row to carry an action and a final bucket. As a
  -- table constraint this holds for every writer, not only the ones going through the
  -- update policy.
  constraint scout_intakes_review_complete check (
    review_status = 'pending'
    or (review_action is not null and final_bucket is not null)
  )
);

create index scout_intakes_review_status_idx on scout_intakes (review_status);

comment on table scout_intakes is
  'Public intake. Anonymous INSERT is allowed (rules:184) because prospective orgs have '
  'no account yet; everything else is admin-only because rows contain applicant PII.';

-- ---------------------------------------------------------------------------
-- architect_assessments — rules:195–205
-- ---------------------------------------------------------------------------

create table architect_assessments (
  -- rules:200: the assessment id IS the source intake id (1:1). Expressed as a primary
  -- key that is also the foreign key, which additionally guarantees the intake exists.
  id                       uuid primary key references scout_intakes (id) on delete cascade,

  -- handoff, denormalized from the intake at create time. rules:144–147
  scout_intake_id          uuid not null references scout_intakes (id) on delete cascade,
  org_name                 text not null check (char_length(org_name) <= 256),
  scout_bucket             scout_bucket not null,
  scout_confidence         scout_confidence,
  scout_readiness          scout_composite_signal not null,

  -- Section 1 — narrative. rules:148–150
  q1_org_context           text not null check (char_length(q1_org_context) <= 2000),
  q2_org_size              text not null check (char_length(q2_org_size) <= 500),
  q3_poc                   text not null check (char_length(q3_poc) <= 256),

  -- Section 2 — data infrastructure. rules:151–155
  q4_collection_scope      collection_scope not null,
  q5_data_locations        text not null check (char_length(q5_data_locations) <= 1000),
  q6_system_integration    system_integration not null,
  q7_integration_familiarity integration_familiarity not null,
  q8_quality_confidence    quality_confidence not null,

  -- Section 3 — decision culture. rules:156–158
  q9_current_decisions     text not null check (char_length(q9_current_decisions) <= 2000),
  q10_wished_decisions     text not null check (char_length(q10_wished_decisions) <= 2000),
  q11_decision_empowerment decision_empowerment not null,

  -- Section 4 — governance. rules:159–160
  q12_reporting_to         text not null check (char_length(q12_reporting_to) <= 1000),
  q13_reporting_automation reporting_automation not null,

  -- Section 5 — tooling + team capacity. rules:161–163
  q14_tools                text[] not null default '{}' check (array_length(q14_tools, 1) is null
                                                               or array_length(q14_tools, 1) <= 8),
  q15_staff_confidence     staff_confidence not null,
  q16_budget_speed         budget_speed not null,

  -- Section 6 — goals & readiness. rules:164–166
  q17a_wish_list           text not null check (char_length(q17a_wish_list) <= 2000),
  q17b_biggest_worry       text not null check (char_length(q17b_biggest_worry) <= 2000),
  q18_past_blockers        text not null check (char_length(q18_past_blockers) <= 2000),

  -- maturity output. rules:167–173
  di_score                 smallint not null check (di_score between 1 and 3),
  gov_score                smallint not null check (gov_score between 1 and 3),
  tooling_score            smallint not null check (tooling_score between 1 and 3),
  dc_score                 smallint not null check (dc_score between 1 and 3),
  tc_score                 smallint not null check (tc_score between 1 and 3),
  points                   smallint not null check (points between 7 and 21),  -- rules:169
  composite_level          composite_level not null,
  override_applied         boolean not null default false,
  flagged_dimensions       text[] not null default '{}'
                             check (array_length(flagged_dimensions, 1) is null
                                    or array_length(flagged_dimensions, 1) <= 2),  -- rules:172
  remediation_only         boolean not null default false,
  cross_check_flag         text,

  -- generated documents. rules:174–176 — shape-checked only, as in the source rules.
  charter                  jsonb not null check (jsonb_typeof(charter) = 'object'),
  ninety_day_plan          jsonb not null check (jsonb_typeof(ninety_day_plan) = 'object'),

  -- meta. rules:177
  created_by               uuid not null references users (id),
  created_by_email         text not null check (char_length(created_by_email) <= 256),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  -- rules:200 made the doc id the intake id; this keeps the denormalized copy honest.
  constraint architect_assessments_id_matches_intake check (id = scout_intake_id)
);

-- ---------------------------------------------------------------------------
-- Helper: admin check
--
-- Ports rules:34–37 `isAdmin()`. SECURITY DEFINER is required: the function reads
-- `users`, and a policy on another table calling it as the invoker would recurse through
-- that table's own RLS. `search_path` is pinned because SECURITY DEFINER functions
-- otherwise resolve unqualified names against the caller's search_path.
-- ---------------------------------------------------------------------------

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from users
    where users.id = auth.uid()
      and users.role = 'admin'
  );
$$;

revoke execute on function is_admin() from public;
grant execute on function is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers: the diff-based rules
-- ---------------------------------------------------------------------------

-- rules:100 — role is immutable. rules:101 — only display_name/updated_at may change.
create or replace function users_enforce_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role then
    raise exception 'users.role is immutable' using errcode = 'check_violation';
  end if;
  if new.id is distinct from old.id or new.email is distinct from old.email then
    raise exception 'users.id and users.email are immutable' using errcode = 'check_violation';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'users.created_at is immutable' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger users_enforce_immutable_trg
  before update on users
  for each row execute function users_enforce_immutable();

-- rules:110 — owner_id cannot change. rules:111 — hasOnly(name, type, ein, industry,
-- certified, address, updatedAt): id/owner_id/created_at are therefore the immutable set.
create or replace function businesses_enforce_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'businesses.owner_id is immutable' using errcode = 'check_violation';
  end if;
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'businesses.id and created_at are immutable' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger businesses_enforce_immutable_trg
  before update on businesses
  for each row execute function businesses_enforce_immutable();

-- rules:122–123 — owner_id and business_id immutable.
-- rules:125 — terminal-state locking: once completed, status cannot move back.
-- rules:126 — see divergence 5 in the header: ported as hasOnly, not hasAny.
create or replace function engagements_enforce_transitions()
returns trigger
language plpgsql
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'engagements.owner_id is immutable' using errcode = 'check_violation';
  end if;
  if new.business_id is distinct from old.business_id then
    raise exception 'engagements.business_id is immutable' using errcode = 'check_violation';
  end if;
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'engagements.id and created_at are immutable' using errcode = 'check_violation';
  end if;
  if old.status = 'completed' and new.status <> 'completed' then
    raise exception 'engagements.status cannot leave the terminal ''completed'' state'
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger engagements_enforce_transitions_trg
  before update on engagements
  for each row execute function engagements_enforce_transitions();

-- rules:187 — hasOnly(reviewStatus, reviewAction, finalBucket, reviewedBy,
-- reviewedByEmail, reviewedAt, reviewNotes, onboardingKit). Everything the public form
-- wrote is therefore write-once: an admin reviews an intake, it never edits the
-- applicant's own answers.
-- rules:191 — reviewed_by must be the acting admin.
create or replace function scout_intakes_enforce_review_only()
returns trigger
language plpgsql
as $$
begin
  if (new.org_name, new.contact_name_role, new.contact_email, new.mission, new.scale,
      new.primary_need, new.primary_need_other, new.problem_description,
      new.current_systems, new.timeline, new.referral_source, new.submitted_at,
      new.bucket, new.confidence, new.rationale, new.poc_score, new.clarity_score,
      new.foothold_score, new.composite_signal, new.flags, new.hitl_tier, new.id)
     is distinct from
     (old.org_name, old.contact_name_role, old.contact_email, old.mission, old.scale,
      old.primary_need, old.primary_need_other, old.problem_description,
      old.current_systems, old.timeline, old.referral_source, old.submitted_at,
      old.bucket, old.confidence, old.rationale, old.poc_score, old.clarity_score,
      old.foothold_score, old.composite_signal, old.flags, old.hitl_tier, old.id)
  then
    raise exception 'scout_intakes: only review fields may be updated'
      using errcode = 'check_violation';
  end if;

  if new.reviewed_by is distinct from auth.uid() then
    raise exception 'scout_intakes.reviewed_by must be the acting user'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger scout_intakes_enforce_review_only_trg
  before update on scout_intakes
  for each row execute function scout_intakes_enforce_review_only();

-- rules:202 — created_by must be the acting admin, on create and on re-conduct.
create or replace function architect_assessments_enforce_author()
returns trigger
language plpgsql
as $$
begin
  if new.created_by is distinct from auth.uid() then
    raise exception 'architect_assessments.created_by must be the acting user'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger architect_assessments_enforce_author_trg
  before insert or update on architect_assessments
  for each row execute function architect_assessments_enforce_author();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- rules:5–7 default-deny is the Postgres default once RLS is enabled with no permissive
-- policy for a command — every table below therefore starts denied and is opened only by
-- the policies that follow. Any command with no policy (all DELETEs on scout_intakes and
-- architect_assessments, rules:192/204) stays denied.
-- ---------------------------------------------------------------------------

alter table users                  enable row level security;
alter table businesses             enable row level security;
alter table engagements            enable row level security;
alter table scout_intakes          enable row level security;
alter table architect_assessments  enable row level security;

-- Defence in depth: RLS does not apply to the table owner, and `force` closes that gap
-- for any future code that connects as the owning role.
alter table users                  force row level security;
alter table businesses             force row level security;
alter table engagements            force row level security;
alter table scout_intakes          force row level security;
alter table architect_assessments  force row level security;

-- users -----------------------------------------------------------------

-- rules:97 `allow get: if isOwner(userId)`
create policy users_select_self on users
  for select to authenticated
  using (id = auth.uid());

-- rules:98 `allow create: if isOwner(userId) && ... role == 'client'`
create policy users_insert_self on users
  for insert to authenticated
  with check (id = auth.uid() and role = 'client');

-- rules:99–101 `allow update: if isOwner(userId)` (+ immutability, via trigger)
create policy users_update_self on users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No delete policy: rules had none, so default-deny applies.

-- businesses ------------------------------------------------------------

-- rules:106–107 get + list, both owner-scoped (see divergence 4)
create policy businesses_select_own on businesses
  for select to authenticated
  using (owner_id = auth.uid());

-- rules:108 `allow create: if isSignedIn() && isValidBusiness()` — validation includes
-- `ownerId == request.auth.uid` (rules:52)
create policy businesses_insert_own on businesses
  for insert to authenticated
  with check (owner_id = auth.uid());

-- rules:109–111
create policy businesses_update_own on businesses
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- rules:112
create policy businesses_delete_own on businesses
  for delete to authenticated
  using (owner_id = auth.uid());

-- engagements -----------------------------------------------------------

-- rules:117–118
create policy engagements_select_own on engagements
  for select to authenticated
  using (owner_id = auth.uid());

-- rules:119–120. The `exists(businesses/...)` check is the foreign key; this policy adds
-- the part a FK cannot express — the referenced business must belong to the caller, so a
-- client cannot attach an engagement to someone else's business.
create policy engagements_insert_own on engagements
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from businesses b
      where b.id = engagements.business_id
        and b.owner_id = auth.uid()
    )
  );

-- rules:121–126
create policy engagements_update_own on engagements
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- rules:127
create policy engagements_delete_own on engagements
  for delete to authenticated
  using (owner_id = auth.uid());

-- scout_intakes ---------------------------------------------------------

-- rules:183 `allow get, list: if isAdmin()` — applicant PII, staff-only.
create policy scout_intakes_select_admin on scout_intakes
  for select to authenticated
  using (is_admin());

-- rules:184 `allow create: if isValidScoutIntake(...)` — NO auth predicate. This is the
-- public intake: a prospective org has no account. `anon` and `authenticated` both get
-- it; `review_status = 'pending'` (rules:92) stops a submitter from filing a row that is
-- already marked reviewed.
create policy scout_intakes_insert_public on scout_intakes
  for insert to anon, authenticated
  with check (
    review_status = 'pending'
    and review_action is null
    and final_bucket is null
    and reviewed_by is null
    and reviewed_by_email is null
    and reviewed_at is null
  );

-- rules:185–191 — admin-only, and only into the reviewed state.
create policy scout_intakes_update_admin on scout_intakes
  for update to authenticated
  using (is_admin())
  with check (is_admin() and review_status = 'reviewed');

-- No delete policy — rules:192, the audit trail.

-- architect_assessments -------------------------------------------------

-- rules:198
create policy architect_assessments_select_admin on architect_assessments
  for select to authenticated
  using (is_admin());

-- rules:199–202
create policy architect_assessments_insert_admin on architect_assessments
  for insert to authenticated
  with check (is_admin() and created_by = auth.uid());

-- rules:203 — re-conduct allowed.
create policy architect_assessments_update_admin on architect_assessments
  for update to authenticated
  using (is_admin())
  with check (is_admin());

-- No delete policy — rules:204, the audit trail.

-- ---------------------------------------------------------------------------
-- Table privileges
--
-- RLS and GRANT are two independent gates and a request must clear both: a policy
-- filters *which rows* a role may touch, but the privilege decides whether the role may
-- issue the command at all. Supabase's default privileges cover tables that exist when
-- the project is initialised, so tables created by a migration arrive with only
-- REFERENCES/TRIGGER/TRUNCATE and every policy above is unreachable until these grants
-- are issued.
--
-- The grants deliberately mirror the policy set rather than granting ALL: privileges are
-- the outer gate, so a table/command pair with no policy also gets no privilege, and a
-- future policy added without thought still cannot open a command by itself. DELETE is
-- withheld from scout_intakes and architect_assessments to match rules:192/204 (audit
-- trail), and `anon` gets exactly one privilege — INSERT on the public intake.
-- ---------------------------------------------------------------------------

grant select, insert, update          on users                 to authenticated;
grant select, insert, update, delete  on businesses            to authenticated;
grant select, insert, update, delete  on engagements           to authenticated;
grant select, insert, update          on scout_intakes         to authenticated;
grant select, insert, update          on architect_assessments to authenticated;

-- rules:184 — the public intake form, submitted by orgs with no account.
grant insert on scout_intakes to anon;

-- ---------------------------------------------------------------------------
-- Realtime
--
-- The client subscribes to these five tables (Dashboard businesses, BusinessPortal
-- engagements, ScoutReviewQueue intakes + assessments). Realtime respects RLS, so a
-- subscriber only receives changes to rows it could already SELECT.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table users;
alter publication supabase_realtime add table businesses;
alter publication supabase_realtime add table engagements;
alter publication supabase_realtime add table scout_intakes;
alter publication supabase_realtime add table architect_assessments;
