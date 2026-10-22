-- Test scaffolding for `supabase test db`.
--
-- Numbered 0000 so it runs before the schema migration: the pgTAP extension and the
-- `tests` schema must exist before supabase/tests/rls.test.sql can reference them.
--
-- This installs a test harness into every environment the migrations run in, including
-- production. That is deliberate and it is the shape the Supabase CLI expects — pgTAP
-- adds no policies and no tables of its own, and the `tests` schema below is empty
-- except for helper functions the suite defines at runtime. If that tradeoff is ever
-- unwanted, the alternative is to run the suite against a shadow database instead of
-- `supabase test db`.

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

comment on schema tests is
  'Holds helper functions used by supabase/tests/*.sql (login_as, logout, fixtures). '
  'Empty outside of a test run.';

-- The suite calls tests.* helpers while impersonating anon and authenticated (that is the
-- point — a fixture insert must run under the same role as the request it stands in for),
-- so both roles need USAGE on the schema. USAGE alone exposes nothing: the schema holds no
-- functions outside a test run, and each helper the suite creates is dropped with the
-- surrounding transaction's rollback. No EXECUTE is granted here, and none is needed —
-- functions default to EXECUTE for public, which the anon/authenticated roles inherit.
grant usage on schema tests to anon, authenticated;
