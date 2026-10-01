-- ============================================================
-- TEMPA — ROOM / DISCOVERY PRODUCTION REALITY VERIFIER
-- READ ONLY. Safe to run in the Supabase SQL editor.
--
-- Purpose:
--   Reconcile repository migration comments with the ACTUAL production
--   database before Pulse, availability, or destructive Question cleanup.
--   This script changes nothing. It only reports whether the database
--   objects the application may depend on currently exist.
--
-- Expected use:
--   Run against production and keep the result with the PR/release notes.
--   Do not infer "applied" from repository filenames alone: several Tempa
--   migrations have historically been prepared first and executed manually
--   later.
-- ============================================================

-- 1) Bounded discovery / pre-launch performance
select
  'discover_people rpc' as check_name,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'discover_people'
  ) as present;

select
  'current_account_entry_state rpc' as check_name,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'current_account_entry_state'
  ) as present;

-- 2) Retired member-introductions infrastructure.
-- Presence is informational only: the Room PR stops auto-opening it in UI.
select
  'member_introduction_state table' as check_name,
  to_regclass('public.member_introduction_state') is not null as present;

select
  'member_introduction_history table' as check_name,
  to_regclass('public.member_introduction_history') is not null as present;

select
  'get_member_introductions rpc' as check_name,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_member_introductions'
  ) as present;

-- 3) Writing Style. The application is designed to fail soft if absent.
select
  'profiles.writing_style_id column' as check_name,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'writing_style_id'
  ) as present;

select
  'member_writing_styles rpc' as check_name,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'member_writing_styles'
  ) as present;

select
  'set_my_writing_style rpc' as check_name,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'set_my_writing_style'
  ) as present;

-- 4) Topical interests / relevance routing.
select
  'interests table' as check_name,
  to_regclass('public.interests') is not null as present;

select
  'profile_interests table' as check_name,
  to_regclass('public.profile_interests') is not null as present;

select
  'set_profile_interests rpc' as check_name,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'set_profile_interests'
  ) as present;

-- 5) Question inventory. This does NOT modify or decide which Question is
-- communal; it simply reveals current active rows so launch cleanup can be
-- based on production facts rather than repository assumptions.
select
  id,
  prompt,
  is_flagship,
  is_active,
  created_at
from public.questions
where coalesce(is_active, false) = true
order by is_flagship desc, created_at desc;

-- 6) Compact summary of the objects most relevant to the next phase.
select *
from (
  values
    ('discover_people', exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'discover_people'
    )),
    ('member_introductions', to_regclass('public.member_introduction_state') is not null),
    ('writing_style', exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = 'writing_style_id'
    )),
    ('topical_interests', to_regclass('public.profile_interests') is not null)
) as production_reality(feature, present)
order by feature;
