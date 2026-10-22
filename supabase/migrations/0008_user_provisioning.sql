-- Provision a public.users row for every auth.users signup.
--
-- firestore.rules had no equivalent because the *client* created the profile document
-- (Login.tsx: createUserWithEmailAndPassword, then setDoc('users/{uid}')). That works
-- until a client forgets, crashes between the two calls, or signs up through a path that
-- does not run that code — Google OAuth being exactly such a path, since it never touched
-- the setDoc branch. Every one of those leaves an authenticated user with no profile row,
-- and therefore no role, which every RLS policy depends on.
--
-- A trigger closes that: the profile is a consequence of the signup, not a second write
-- the client is trusted to remember.
--
-- SECURITY DEFINER because the inserting session is the auth service, which has no rights
-- on public.users. search_path is pinned — a definer function without it is a privilege
-- escalation waiting for someone to create a shadowing object in a writable schema.

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
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
  '— never read from client-supplied metadata.';
