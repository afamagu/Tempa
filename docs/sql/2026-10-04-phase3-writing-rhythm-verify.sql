-- ============================================================
-- TEMPA — PHASE 3 WRITING RHYTHM: READ-ONLY VERIFIER
-- Run AFTER docs/sql/2026-10-04-phase3-writing-rhythm.sql.
-- Makes no changes. overall_pass must be true.
-- ============================================================

with checks as (
  select
    'profiles_writing_rhythm_present' as check_name,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'profiles'
        and column_name = 'writing_rhythm'
    ) as pass

  union all
  select
    'profiles_writing_rhythm_constraint_present',
    exists (
      select 1
      from pg_catalog.pg_constraint c
      where c.conrelid = 'public.profiles'::regclass
        and c.conname = 'profiles_writing_rhythm_check'
        and c.contype = 'c'
    )

  union all
  select
    'override_table_present',
    to_regclass('public.correspondence_rhythm_overrides') is not null

  union all
  select
    'override_table_rls_enabled',
    coalesce((
      select c.relrowsecurity
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'correspondence_rhythm_overrides'
    ), false)

  union all
  select
    'override_table_not_anon_readable',
    not has_table_privilege('anon', 'public.correspondence_rhythm_overrides', 'SELECT')

  union all
  select
    'rhythm_days_private_present',
    to_regprocedure('tempa_private.writing_rhythm_days(text)') is not null

  union all
  select
    'effective_rhythm_private_present',
    to_regprocedure('tempa_private.effective_writing_rhythm(uuid,uuid)') is not null

  union all
  select
    'get_my_rhythm_present',
    to_regprocedure('public.get_my_writing_rhythm()') is not null

  union all
  select
    'set_my_rhythm_present',
    to_regprocedure('public.set_my_writing_rhythm(text)') is not null

  union all
  select
    'get_correspondence_rhythm_present',
    to_regprocedure('public.get_correspondence_rhythm(uuid)') is not null

  union all
  select
    'set_correspondence_override_present',
    to_regprocedure('public.set_correspondence_rhythm_override(uuid,text)') is not null

  union all
  select
    'member_rhythm_rpcs_authenticated',
    has_function_privilege('authenticated', 'public.get_my_writing_rhythm()', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.set_my_writing_rhythm(text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.get_correspondence_rhythm(uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.set_correspondence_rhythm_override(uuid,text)', 'EXECUTE')

  union all
  select
    'member_rhythm_rpcs_not_anon',
    not has_function_privilege('anon', 'public.get_my_writing_rhythm()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.set_my_writing_rhythm(text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_correspondence_rhythm(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.set_correspondence_rhythm_override(uuid,text)', 'EXECUTE')

  union all
  select
    'four_canonical_rhythms_map_correctly',
    tempa_private.writing_rhythm_days('few_days') = 4
    and tempa_private.writing_rhythm_days('one_week') = 7
    and tempa_private.writing_rhythm_days('two_weeks') = 14
    and tempa_private.writing_rhythm_days('one_month') = 30
    and tempa_private.writing_rhythm_days('anything_else') is null
)
select
  check_name,
  pass,
  case when pass then 'PASS' else 'FAIL' end as result
from checks
order by check_name;

with checks as (
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'writing_rhythm'
  ) as pass
  union all
  select exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.profiles'::regclass
      and c.conname = 'profiles_writing_rhythm_check'
      and c.contype = 'c'
  )
  union all
  select to_regclass('public.correspondence_rhythm_overrides') is not null
  union all
  select coalesce((
    select c.relrowsecurity
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'correspondence_rhythm_overrides'
  ), false)
  union all
  select not has_table_privilege('anon', 'public.correspondence_rhythm_overrides', 'SELECT')
  union all
  select to_regprocedure('tempa_private.writing_rhythm_days(text)') is not null
  union all
  select to_regprocedure('tempa_private.effective_writing_rhythm(uuid,uuid)') is not null
  union all
  select to_regprocedure('public.get_my_writing_rhythm()') is not null
  union all
  select to_regprocedure('public.set_my_writing_rhythm(text)') is not null
  union all
  select to_regprocedure('public.get_correspondence_rhythm(uuid)') is not null
  union all
  select to_regprocedure('public.set_correspondence_rhythm_override(uuid,text)') is not null
  union all
  select has_function_privilege('authenticated', 'public.get_my_writing_rhythm()', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.set_my_writing_rhythm(text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.get_correspondence_rhythm(uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.set_correspondence_rhythm_override(uuid,text)', 'EXECUTE')
  union all
  select not has_function_privilege('anon', 'public.get_my_writing_rhythm()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.set_my_writing_rhythm(text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_correspondence_rhythm(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.set_correspondence_rhythm_override(uuid,text)', 'EXECUTE')
  union all
  select tempa_private.writing_rhythm_days('few_days') = 4
    and tempa_private.writing_rhythm_days('one_week') = 7
    and tempa_private.writing_rhythm_days('two_weeks') = 14
    and tempa_private.writing_rhythm_days('one_month') = 30
)
select bool_and(pass) as overall_pass
from checks;
