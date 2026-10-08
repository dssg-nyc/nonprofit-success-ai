-- Core schema: the firestore.rules port (207 lines) plus tenancy, telemetry and the
-- provenance columns that hang off them.
--
-- This is the squashed form of the nineteen migrations that preceded the first hosted
-- project (0001_init .. 0019_table_privileges, 2026-08 .. 2026-10). Nothing had been
-- pushed anywhere, so the history was folded into six files that each own one concern:
--
--   0001_core        users, businesses, engagements, scout_intakes, architect_assessments,
--                    organizations / organization_members, agent_runs / tool_calls
--   0002_approvals   approvals, audit_events
--   0003_delivery    engagement_events, milestones, tasks, documents
--   0004_drafts      communications, chronicle_drafts, lessons and the submit_* RPCs
--   0005_lifecycle   current_engagement_stage(), transition_engagement()
--   0006_views       agent_run_metrics, provenance_chain
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
-- Two gates on every table. RLS is enabled AND forced (it does not bind the table owner
-- otherwise), and privileges are the outer gate: Supabase's default privileges grant ALL
-- on every new table and function to anon, authenticated and service_role, so each table
-- below revokes first and then grants exactly the commands its policies open. A
-- table/command pair with no policy also gets no privilege, so a future policy added
-- without thought still cannot open a command by itself. service_role has BYPASSRLS, so
-- its privileges are the only thing that binds it.
--
-- Access model: organization-scoped (membership in the row's organization, roles
-- owner/admin/member; `is_admin()` reads the membership). That is known to be the wrong
-- model — the decided one (.claude/specs/db/access-model.md) scopes volunteers by
-- project assignment with three roles (client/diplomat/admin). The redesign is C1
-- (.claude/specs/roadmap.md); this schema must not reach a hosted project before it.
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
--
-- Ids default to gen_random_uuid() (core since Postgres 13); no extension is needed.

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

-- The activity log's vocabulary (engagement_events, 0003_delivery). `stage_advanced` /
-- `stage_reverted` are written only by transition_engagement() (0005_lifecycle).
create type engagement_event_kind as enum (
  'milestone_completed',
  'session_held',
  'blocker_raised',
  'note_added',
  'stage_advanced',
  'stage_reverted'
);

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

-- Provenance (.claude/specs/db/data-model.md §7): who or what produced a row's content.
create type provenance_source as enum ('verified', 'derived', 'ai', 'human');

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
  'bypasses RLS and the immutability trigger by design. Authority checks read '
  'organization_members, not this column (is_admin()).';

-- ---------------------------------------------------------------------------
-- organizations / organization_members — tenancy
--
-- Every org-scoped table carries a nullable `organization_id` referencing organizations;
-- policies require membership through user_org_ids(). Writes to both tables are a
-- service-role operation (org creation is not self-service).
-- ---------------------------------------------------------------------------

create table organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) <= 256),
  created_at timestamptz not null default now()
);

create table organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            text not null check (role in ('owner', 'admin', 'member')),
  created_at      timestamptz not null default now(),
  constraint organization_members_org_user_key unique (organization_id, user_id)
);

create index organization_members_user_id_idx on organization_members (user_id);

-- ---------------------------------------------------------------------------
-- businesses — rules:105–113
-- ---------------------------------------------------------------------------

create table businesses (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(name) <= 256),      -- rules:50
  type            business_type not null,                              -- rules:51
  ein             text check (char_length(ein) <= 64),                 -- rules:53
  industry        text check (char_length(industry) <= 128),           -- rules:54
  owner_id        uuid not null references users (id) on delete cascade,  -- rules:52
  certified       boolean not null default false,                      -- rules:55
  address         text,                                                -- rules:111 (updatable)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  organization_id uuid references organizations (id)
  -- scout_intake_id is added below, after scout_intakes exists.
);

create index businesses_owner_id_idx on businesses (owner_id);
create index businesses_organization_id_idx on businesses (organization_id);

-- ---------------------------------------------------------------------------
-- engagements — rules:116–128
-- ---------------------------------------------------------------------------

create table engagements (
  id                uuid primary key default gen_random_uuid(),
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
  updated_at        timestamptz not null default now(),
  organization_id   uuid references organizations (id)
  -- assessment_id is added below, after architect_assessments exists.
);

create index engagements_owner_id_idx on engagements (owner_id);
create index engagements_business_id_idx on engagements (business_id);
create index engagements_organization_id_idx on engagements (organization_id);

-- One engagement per stage per business.
--
-- Not in firestore.rules: the portal enforced this structurally, by writing the
-- engagement to the deterministic document id `{businessId}_{stage}`, so a second write
-- for the same stage overwrote the first instead of adding a row. Surrogate uuid keys
-- lose that property, and without this constraint a double-submit silently creates two
-- engagements for one stage — which the UI then renders as whichever `find()` hits first.
-- It is also the backstop transition_engagement() relies on for two writers to one stage.
alter table engagements
  add constraint engagements_business_stage_key unique (business_id, stage);

-- ---------------------------------------------------------------------------
-- agent_runs / tool_calls — telemetry
--
-- Shaped to the recorder contract (.claude/specs/platform/infra/observability.md,
-- src/observability/recorder.ts). No raw model I/O: prompt text and model output stay in
-- the domain tables, and the columns do not exist here so nothing can start writing them.
-- `error_code text`, not an error payload, for the same reason. Written only by the
-- recorder's service-role client; append-only for every API role.
--
-- Telemetry sits in the core file because the provenance columns below (an assessment's
-- or an intake's `run_id`) reference it.
-- ---------------------------------------------------------------------------

create table agent_runs (
  id              uuid primary key default gen_random_uuid(),
  agent           text not null
                  check (agent in ('scout', 'architect', 'pulse', 'envoy', 'chronicle')),
  -- Nullable: not every run belongs to an org yet.
  organization_id uuid references organizations (id),
  -- Nullable: Scout intake runs before any engagement exists. `on delete set null`
  -- because an owner may delete their engagement (engagements_delete_own) and a
  -- restrict FK would make that fail once telemetry exists. This is the one mutation a
  -- telemetry row can undergo, and it is performed by the FK machinery, not by a role.
  engagement_id   uuid references engagements (id) on delete set null,
  model           text not null,
  prompt_version  text,
  status          text not null check (status in ('success', 'fallback', 'error')),
  error_code      text,
  input_tokens    int check (input_tokens >= 0),
  output_tokens   int check (output_tokens >= 0),
  hitl_tier       text check (hitl_tier in ('L2', 'L3')),
  duration_ms     int not null check (duration_ms >= 0),
  cost_cents      numeric check (cost_cents >= 0),
  created_at      timestamptz not null default now()
);

-- One row per tool invocation inside a run. Same rule as agent_runs: no raw tool
-- input/output — a tool's arguments are model output, and its result is frequently
-- domain data with PII in it.
create table tool_calls (
  id           uuid primary key default gen_random_uuid(),
  agent_run_id uuid not null references agent_runs (id) on delete cascade,
  tool         text not null,
  status       text not null default 'success' check (status in ('success', 'error')),
  error_code   text,
  duration_ms  int check (duration_ms >= 0),
  created_at   timestamptz not null default now()
);

create index agent_runs_agent_idx on agent_runs (agent);
create index agent_runs_organization_id_idx on agent_runs (organization_id);
create index agent_runs_engagement_id_idx on agent_runs (engagement_id);
create index agent_runs_created_at_idx on agent_runs (created_at);
create index tool_calls_agent_run_id_idx on tool_calls (agent_run_id);

-- ---------------------------------------------------------------------------
-- scout_intakes — rules:180–193
-- ---------------------------------------------------------------------------

create table scout_intakes (
  id                  uuid primary key default gen_random_uuid(),

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

  -- Nullable: an anonymous intake has no org; the reviewer's org is set during review.
  organization_id     uuid references organizations (id),

  -- Routing provenance (data-model.md §7): what produced bucket/confidence/rationale.
  -- 'ai' holds exactly when a run is named; the public form is forced to 'derived' by
  -- its insert policy, so a submitter cannot self-assert model provenance.
  routing_source         provenance_source not null default 'derived',
  routing_run_id         uuid references agent_runs (id),
  routing_model          text,
  routing_prompt_version text,

  -- rules:188–190 required a reviewed row to carry an action and a final bucket. As a
  -- table constraint this holds for every writer, not only the ones going through the
  -- update policy.
  constraint scout_intakes_review_complete check (
    review_status = 'pending'
    or (review_action is not null and final_bucket is not null)
  ),
  constraint scout_intakes_routing_provenance check (
    routing_source in ('derived', 'ai')
    and (routing_source = 'ai') = (routing_run_id is not null)
  )
);

create index scout_intakes_review_status_idx on scout_intakes (review_status);
create index scout_intakes_organization_id_idx on scout_intakes (organization_id);
create index scout_intakes_routing_run_id_idx
  on scout_intakes (routing_run_id) where routing_run_id is not null;

comment on table scout_intakes is
  'Public intake. Anonymous INSERT is allowed (rules:184) because prospective orgs have '
  'no account yet; everything else is admin-only because rows contain applicant PII.';

-- The scout intake a business came from. Set by the Scout-approve transition (T2, not
-- built), read by transition_engagement()'s initial_meeting guard and by the lesson.
alter table businesses
  add column scout_intake_id uuid references scout_intakes (id) on delete set null;
create index businesses_scout_intake_id_idx on businesses (scout_intake_id);

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
  organization_id          uuid references organizations (id),

  -- Provenance (data-model.md §7). The maturity rubric is deterministic, so a row reads
  -- 'derived' unless a model wrote its charter. No "ai => run_id" rule: a run the
  -- recorder failed to write must not block the save (submit_architect_draft header).
  -- What an AI row cannot lack is the model that wrote it.
  source_type              provenance_source not null default 'derived',
  generated_by             text,
  model                    text,
  model_version            text,
  prompt_version           text,
  run_id                   uuid references agent_runs (id),
  approved_by              uuid references auth.users (id),
  approved_at              timestamptz,

  -- rules:200 made the doc id the intake id; this keeps the denormalized copy honest.
  constraint architect_assessments_id_matches_intake check (id = scout_intake_id),
  constraint architect_assessments_ai_has_model check (source_type <> 'ai' or model is not null)
);

create index architect_assessments_run_id_idx on architect_assessments (run_id);

-- The assessment whose plan an engagement is executing. Nullable on purpose: an
-- engagement can legitimately predate its assessment. Pulse must read null as "no plan to
-- measure against" rather than as an error. Left mutable — gaining an assessment after
-- the fact is normal.
alter table engagements
  add column assessment_id uuid references architect_assessments (id);
create index engagements_assessment_id_idx on engagements (assessment_id);

-- ---------------------------------------------------------------------------
-- Helpers: membership and the admin check
--
-- SECURITY DEFINER is required: both read organization_members, and a policy on another
-- table calling them as the invoker would recurse through the membership table's own
-- policies. `search_path` is pinned because a definer function otherwise resolves
-- unqualified names against the caller's search_path.
--
-- Executable by `authenticated` only. Supabase's default privileges would also grant
-- `anon`; no policy that applies to anon calls either (anon's one door is the public
-- intake insert), so anon has no reason to hold them.
-- ---------------------------------------------------------------------------

-- The set of organization ids the current user belongs to. Policies use this as
-- `organization_id in (select user_org_ids())`.
create or replace function user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select organization_id from organization_members
  where user_id = auth.uid();
$$;

-- Ports rules:34–37 `isAdmin()`. The SINGLE INDIRECTION for admin role checks
-- (data-model.md §1): anyone with role 'admin' or 'owner' in any organization. Per-org
-- authority is checked by the RPCs themselves (an admin of org A is not an admin of org B).
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from organization_members
    where user_id = auth.uid()
      and role in ('admin', 'owner')
  );
$$;

revoke execute on function user_org_ids() from public, anon;
revoke execute on function is_admin()     from public, anon;
grant execute on function user_org_ids() to authenticated;
grant execute on function is_admin()     to authenticated;

-- ---------------------------------------------------------------------------
-- Provisioning: a public.users row for every auth.users signup
--
-- firestore.rules had no equivalent because the *client* created the profile document
-- (createUserWithEmailAndPassword, then setDoc('users/{uid}')). That works until a client
-- forgets, crashes between the two calls, or signs up through a path that never ran that
-- code — Google OAuth being exactly such a path. Each leaves an authenticated user with
-- no profile row. A trigger makes the profile a consequence of the signup.
--
-- SECURITY DEFINER because the inserting session is the auth service, which has no rights
-- on public.users. Anonymous sign-ins (the public intake form's session,
-- config.toml enable_anonymous_sign_ins; src/lib/session.ts) get no profile: such a user
-- is role `authenticated` with `is_anonymous = true` and no email — not a member, so no
-- role, so is_admin() is false and no membership policy matches. RLS then grants exactly
-- what `anon` has: insert one pending intake. If the visitor later signs up for real,
-- GoTrue links the identity to the same row (an UPDATE this after-insert trigger never
-- sees); the SPA path that handles a missing profile covers that case.
-- ---------------------------------------------------------------------------

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- An anonymous session is a token for the public intake form, not a member. No profile.
  if new.is_anonymous then
    return new;
  end if;

  insert into public.users (id, email, display_name, role)
  values (
    new.id,
    new.email,
    -- Google returns a display name in raw_user_meta_data; email/password signups do not.
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      null
    ),
    -- Always 'client'. rules:98 forced the same on self-insert, and users.role is
    -- immutable after insert (rules:100), so elevation to admin stays an out-of-band
    -- service-role operation. A trigger that honoured a client-supplied role would hand
    -- every new signup the ability to make itself an admin.
    'client'
  )
  -- A repeated signup for an existing id must not fail the auth transaction.
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function handle_new_user();

comment on function handle_new_user is
  'Creates the public.users profile for a new auth.users row. Role is forced to ''client'' '
  '— never read from client-supplied metadata. Skips anonymous sign-ins: they are the '
  'public intake form''s token, not members.';

-- ---------------------------------------------------------------------------
-- Triggers: the diff-based rules
--
-- Two of them hold a lifecycle lock (a completed engagement cannot reopen; a business's
-- scout_intake_id is not a partner's to set) that transition_engagement() and the future
-- Scout-approve RPC legitimately pass through. The lock keys on the session role: an API
-- role (anon / authenticated / service_role) never passes, whatever it sets; a SECURITY
-- DEFINER function runs as its owner, so its writes do. There is no setting a client
-- could flip to get through.
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
-- certified, address, updatedAt): id/owner_id/created_at are therefore the immutable set,
-- plus organization_id. scout_intake_id is the initial_meeting guard's input, so it is
-- set only by the lifecycle writers (see the lock note above).
create or replace function businesses_enforce_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'businesses.owner_id is immutable' using errcode = 'check_violation';
  end if;
  if new.organization_id is distinct from old.organization_id then
    raise exception 'businesses.organization_id is immutable' using errcode = 'check_violation';
  end if;
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'businesses.id and created_at are immutable' using errcode = 'check_violation';
  end if;
  if new.scout_intake_id is distinct from old.scout_intake_id
     and current_user in ('anon', 'authenticated', 'service_role') then
    raise exception 'businesses.scout_intake_id is set only by the lifecycle command'
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger businesses_enforce_immutable_trg
  before update on businesses
  for each row execute function businesses_enforce_immutable();

create or replace function businesses_guard_scout_intake_insert()
returns trigger
language plpgsql
as $$
begin
  if new.scout_intake_id is not null
     and current_user in ('anon', 'authenticated', 'service_role') then
    raise exception 'businesses.scout_intake_id is set only by the lifecycle command'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger businesses_guard_scout_intake_insert_trg
  before insert on businesses
  for each row execute function businesses_guard_scout_intake_insert();

-- rules:122–123 — owner_id and business_id immutable (and organization_id).
-- rules:125 — terminal-state locking: once completed, status cannot move back. The one
-- exception is a REVERSAL inside transition_engagement(), which reopens a completed row
-- as in_progress; it runs as the function owner, never as an API role.
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
  if new.organization_id is distinct from old.organization_id then
    raise exception 'engagements.organization_id is immutable' using errcode = 'check_violation';
  end if;
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'engagements.id and created_at are immutable' using errcode = 'check_violation';
  end if;
  if old.status = 'completed' and new.status <> 'completed'
     and not (new.status = 'in_progress'
              and current_user not in ('anon', 'authenticated', 'service_role')) then
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
-- applicant's own answers. The routing provenance columns are write-once for the same
-- reason: a review must not rewrite the record of what produced the routing.
-- organization_id is NOT listed: it starts null and is set during review.
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
      new.foothold_score, new.composite_signal, new.flags, new.hitl_tier, new.id,
      new.routing_source, new.routing_run_id, new.routing_model, new.routing_prompt_version)
     is distinct from
     (old.org_name, old.contact_name_role, old.contact_email, old.mission, old.scale,
      old.primary_need, old.primary_need_other, old.problem_description,
      old.current_systems, old.timeline, old.referral_source, old.submitted_at,
      old.bucket, old.confidence, old.rationale, old.poc_score, old.clarity_score,
      old.foothold_score, old.composite_signal, old.flags, old.hitl_tier, old.id,
      old.routing_source, old.routing_run_id, old.routing_model, old.routing_prompt_version)
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

-- Trigger functions are never called directly. Postgres checks EXECUTE on one only at
-- CREATE TRIGGER, so revoking the default grants leaves the triggers working and takes
-- the functions off PostgREST's /rpc surface.
revoke execute on function handle_new_user()                      from public, anon, authenticated;
revoke execute on function users_enforce_immutable()              from public, anon, authenticated;
revoke execute on function businesses_enforce_immutable()         from public, anon, authenticated;
revoke execute on function businesses_guard_scout_intake_insert() from public, anon, authenticated;
revoke execute on function engagements_enforce_transitions()      from public, anon, authenticated;
revoke execute on function scout_intakes_enforce_review_only()    from public, anon, authenticated;
revoke execute on function architect_assessments_enforce_author() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- rules:5–7 default-deny is the Postgres default once RLS is enabled with no permissive
-- policy for a command — every table below therefore starts denied and is opened only by
-- the policies that follow. Any command with no policy (all DELETEs on scout_intakes and
-- architect_assessments, rules:192/204) stays denied.
-- ---------------------------------------------------------------------------

alter table users                  enable row level security;
alter table organizations          enable row level security;
alter table organization_members   enable row level security;
alter table businesses             enable row level security;
alter table engagements            enable row level security;
alter table agent_runs             enable row level security;
alter table tool_calls             enable row level security;
alter table scout_intakes          enable row level security;
alter table architect_assessments  enable row level security;

-- Defence in depth: RLS does not apply to the table owner, and `force` closes that gap
-- for any future code that connects as the owning role.
alter table users                  force row level security;
alter table organizations          force row level security;
alter table organization_members   force row level security;
alter table businesses             force row level security;
alter table engagements            force row level security;
alter table agent_runs             force row level security;
alter table tool_calls             force row level security;
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

-- organizations / organization_members ----------------------------------

-- Members read their own org and their co-members. No write policy for any API role.
create policy organizations_select_member on organizations
  for select to authenticated
  using (id in (select user_org_ids()));

create policy org_members_select on organization_members
  for select to authenticated
  using (organization_id in (select user_org_ids()));

-- businesses ------------------------------------------------------------

-- rules:106–107 get + list, both owner-scoped (see divergence 4), within the caller's org.
create policy businesses_select_own on businesses
  for select to authenticated
  using (owner_id = auth.uid()
         and organization_id in (select user_org_ids()));

-- rules:108 `allow create: if isSignedIn() && isValidBusiness()` — validation includes
-- `ownerId == request.auth.uid` (rules:52)
create policy businesses_insert_own on businesses
  for insert to authenticated
  with check (owner_id = auth.uid()
              and organization_id in (select user_org_ids()));

-- rules:109–111
create policy businesses_update_own on businesses
  for update to authenticated
  using (owner_id = auth.uid()
         and organization_id in (select user_org_ids()))
  with check (owner_id = auth.uid()
              and organization_id in (select user_org_ids()));

-- rules:112
create policy businesses_delete_own on businesses
  for delete to authenticated
  using (owner_id = auth.uid()
         and organization_id in (select user_org_ids()));

-- engagements -----------------------------------------------------------

-- rules:117–118
create policy engagements_select_own on engagements
  for select to authenticated
  using (owner_id = auth.uid()
         and organization_id in (select user_org_ids()));

-- Staff read every engagement in their org(s) — the rows Pulse measures. Read and write
-- are separate decisions: there is no admin write policy.
create policy engagements_select_admin on engagements
  for select to authenticated
  using (is_admin()
         and organization_id in (select user_org_ids()));

-- No INSERT or UPDATE policy for anyone (rules:119–126 are superseded): stage and status
-- are written only by transition_engagement() (0005_lifecycle, D22), which runs as its
-- owner. A partner's notes are `note_added` engagement_events.

-- rules:127
create policy engagements_delete_own on engagements
  for delete to authenticated
  using (owner_id = auth.uid()
         and organization_id in (select user_org_ids()));

-- agent_runs / tool_calls -----------------------------------------------

-- Admin-only read, scoped to the admin's orgs; a null org (a run before any engagement
-- exists) is readable by any admin. No INSERT/UPDATE/DELETE policy for anyone: writes come
-- from the service role, which bypasses RLS, so the privilege block below bounds it.
create policy agent_runs_select_admin on agent_runs
  for select to authenticated
  using (is_admin()
         and (organization_id is null
              or organization_id in (select user_org_ids())));

create policy tool_calls_select_admin on tool_calls
  for select to authenticated
  using (is_admin()
         and exists (
           select 1 from agent_runs ar
           where ar.id = tool_calls.agent_run_id
             and (ar.organization_id is null
                  or ar.organization_id in (select user_org_ids()))
         ));

-- scout_intakes ---------------------------------------------------------

-- rules:183 `allow get, list: if isAdmin()` — applicant PII, staff-only. Unassigned
-- intakes (org null, awaiting review) and the admin's own orgs.
create policy scout_intakes_select_admin on scout_intakes
  for select to authenticated
  using (is_admin()
         and (organization_id is null
              or organization_id in (select user_org_ids())));

-- rules:184 `allow create: if isValidScoutIntake(...)` — NO auth predicate. This is the
-- public intake: a prospective org has no account. `anon` and `authenticated` (the
-- anonymous session) both get it; `review_status = 'pending'` (rules:92) stops a
-- submitter from filing a row that is already marked reviewed, organization_id is null
-- until review, and the routing provenance is forced to 'derived' with no run, model or
-- prompt version — T2 writes real routing provenance through a definer RPC, never from
-- the client.
create policy scout_intakes_insert_public on scout_intakes
  for insert to anon, authenticated
  with check (
    review_status = 'pending'
    and review_action is null
    and final_bucket is null
    and reviewed_by is null
    and reviewed_by_email is null
    and reviewed_at is null
    and organization_id is null
    and routing_source = 'derived'
    and routing_run_id is null
    and routing_model is null
    and routing_prompt_version is null
  );

-- rules:185–191 — admin-only, and only into the reviewed state. The with-check allows
-- organization_id to be set during review (null -> the reviewer's org).
create policy scout_intakes_update_admin on scout_intakes
  for update to authenticated
  using (is_admin()
         and (organization_id is null
              or organization_id in (select user_org_ids())))
  with check (is_admin()
              and review_status = 'reviewed'
              and (organization_id is null
                   or organization_id in (select user_org_ids())));

-- No delete policy — rules:192, the audit trail.

-- architect_assessments -------------------------------------------------

-- rules:198
create policy architect_assessments_select_admin on architect_assessments
  for select to authenticated
  using (is_admin()
         and (organization_id is null
              or organization_id in (select user_org_ids())));

-- rules:199–203 — insert and re-conduct. These policies are unreachable from the client:
-- INSERT/UPDATE privileges are withheld below, because every draft reaches the table
-- through submit_architect_draft() (0004_drafts) beside its pending approval. They stay
-- so that a future re-grant is still constrained by them rather than opening the table.
create policy architect_assessments_insert_admin on architect_assessments
  for insert to authenticated
  with check (is_admin()
              and created_by = auth.uid());

create policy architect_assessments_update_admin on architect_assessments
  for update to authenticated
  using (is_admin()
         and (organization_id is null
              or organization_id in (select user_org_ids())))
  with check (is_admin());

-- No delete policy — rules:204, the audit trail.

-- ---------------------------------------------------------------------------
-- Table privileges
--
-- Revoke first (the default privileges granted ALL), then grant exactly the commands the
-- policies open. DELETE is withheld from scout_intakes and architect_assessments to match
-- rules:192/204 (audit trail); INSERT/UPDATE on engagements and architect_assessments go
-- only through their RPCs; `anon` gets exactly one privilege — INSERT on the public
-- intake (rules:184). Telemetry is append-only for every API role, service_role included
-- (observability.md: "deny UPDATE and DELETE for all roles including service-role").
-- ---------------------------------------------------------------------------

revoke all on users, organizations, organization_members, businesses, engagements,
              scout_intakes, architect_assessments
  from anon, authenticated;
revoke all on agent_runs, tool_calls from anon, authenticated, service_role;

grant select, insert, update          on users                 to authenticated;
grant select                          on organizations         to authenticated;
grant select                          on organization_members  to authenticated;
grant select, insert, update, delete  on businesses            to authenticated;
grant select, delete                  on engagements           to authenticated;
grant select, insert, update          on scout_intakes         to authenticated;
grant select                          on architect_assessments to authenticated;

grant insert on scout_intakes to anon;

grant select         on agent_runs, tool_calls to authenticated;
grant select, insert on agent_runs, tool_calls to service_role;

-- ---------------------------------------------------------------------------
-- Realtime
--
-- The client subscribes to these tables (Dashboard businesses, BusinessPortal
-- engagements, ScoutReviewQueue intakes + assessments). Realtime respects RLS, so a
-- subscriber only receives changes to rows it could already SELECT.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table users;
alter publication supabase_realtime add table organizations;
alter publication supabase_realtime add table organization_members;
alter publication supabase_realtime add table businesses;
alter publication supabase_realtime add table engagements;
alter publication supabase_realtime add table scout_intakes;
alter publication supabase_realtime add table architect_assessments;
alter publication supabase_realtime add table agent_runs;
