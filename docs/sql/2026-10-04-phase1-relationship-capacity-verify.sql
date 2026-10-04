-- ============================================================
-- TEMPA — PHASE 1 RELATIONSHIP CAPACITY: READ-ONLY VERIFIER
-- Run AFTER docs/sql/2026-10-04-phase1-relationship-capacity.sql.
-- This file makes no changes. overall_pass must be true.
-- ============================================================

with checks as (
  select
    'capacity_override_table_present' as check_name,
    to_regclass('public.correspondence_capacity_overrides') is not null as pass

  union all
  select
    'capacity_override_rls_enabled',
    coalesce((
      select c.relrowsecurity
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'correspondence_capacity_overrides'
    ), false)

  union all
  select
    'capacity_override_not_client_writable',
    not has_table_privilege('authenticated', 'public.correspondence_capacity_overrides', 'INSERT')
    and not has_table_privilege('authenticated', 'public.correspondence_capacity_overrides', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.correspondence_capacity_overrides', 'DELETE')
    and not has_table_privilege('anon', 'public.correspondence_capacity_overrides', 'INSERT')

  union all
  select
    'capacity_state_private_function_present',
    to_regprocedure('tempa_private.relationship_capacity_state(uuid)') is not null

  union all
  select
    'member_capacity_rpc_present',
    to_regprocedure('public.get_relationship_capacity()') is not null

  union all
  select
    'member_capacity_rpc_authenticated_only',
    has_function_privilege('authenticated', 'public.get_relationship_capacity()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_relationship_capacity()', 'EXECUTE')

  union all
  select
    'single_member_lock_present',
    to_regprocedure('tempa_private.lock_relationship_capacity(uuid)') is not null

  union all
  select
    'pair_lock_present',
    to_regprocedure('tempa_private.lock_relationship_capacity_pair(uuid,uuid)') is not null

  union all
  select
    'first_contact_enforcer_present',
    to_regprocedure('tempa_private.enforce_first_contact_capacity()') is not null

  union all
  select
    'establishment_enforcer_present',
    to_regprocedure('tempa_private.enforce_correspondence_establishment_capacity()') is not null

  union all
  select
    'letters_first_contact_trigger_present_enabled',
    exists (
      select 1
      from pg_catalog.pg_trigger t
      where t.tgrelid = 'public.letters'::regclass
        and t.tgname = 'letters_enforce_first_contact_capacity'
        and not t.tgisinternal
        and t.tgenabled <> 'D'
    )

  union all
  select
    'correspondence_establishment_trigger_present_enabled',
    exists (
      select 1
      from pg_catalog.pg_trigger t
      where t.tgrelid = 'public.correspondences'::regclass
        and t.tgname = 'correspondences_enforce_establishment_capacity'
        and not t.tgisinternal
        and t.tgenabled <> 'D'
    )

  union all
  select
    'override_limit_constraint_present',
    exists (
      select 1
      from pg_catalog.pg_constraint c
      where c.conrelid = 'public.correspondence_capacity_overrides'::regclass
        and c.contype = 'c'
        and pg_catalog.pg_get_constraintdef(c.oid, true)
          like '%active_correspondence_limit%5%10%'
    )

  union all
  select
    'pending_lifecycle_still_canonical',
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'correspondences'
        and column_name = 'status'
        and column_default = '''pending''::text'
    )
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'correspondences'
        and column_name = 'established_at'
    )
)
select
  check_name,
  pass,
  case when pass then 'PASS' else 'FAIL' end as result
from checks
order by check_name;

with checks as (
  select to_regclass('public.correspondence_capacity_overrides') is not null as pass
  union all
  select coalesce((
    select c.relrowsecurity
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'correspondence_capacity_overrides'
  ), false)
  union all
  select not has_table_privilege('authenticated', 'public.correspondence_capacity_overrides', 'INSERT')
    and not has_table_privilege('authenticated', 'public.correspondence_capacity_overrides', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.correspondence_capacity_overrides', 'DELETE')
    and not has_table_privilege('anon', 'public.correspondence_capacity_overrides', 'INSERT')
  union all
  select to_regprocedure('tempa_private.relationship_capacity_state(uuid)') is not null
  union all
  select to_regprocedure('public.get_relationship_capacity()') is not null
  union all
  select has_function_privilege('authenticated', 'public.get_relationship_capacity()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_relationship_capacity()', 'EXECUTE')
  union all
  select to_regprocedure('tempa_private.lock_relationship_capacity(uuid)') is not null
  union all
  select to_regprocedure('tempa_private.lock_relationship_capacity_pair(uuid,uuid)') is not null
  union all
  select to_regprocedure('tempa_private.enforce_first_contact_capacity()') is not null
  union all
  select to_regprocedure('tempa_private.enforce_correspondence_establishment_capacity()') is not null
  union all
  select exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.letters'::regclass
      and t.tgname = 'letters_enforce_first_contact_capacity'
      and not t.tgisinternal and t.tgenabled <> 'D'
  )
  union all
  select exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.correspondences'::regclass
      and t.tgname = 'correspondences_enforce_establishment_capacity'
      and not t.tgisinternal and t.tgenabled <> 'D'
  )
  union all
  select exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.correspondence_capacity_overrides'::regclass
      and c.contype = 'c'
      and pg_catalog.pg_get_constraintdef(c.oid, true)
        like '%active_correspondence_limit%5%10%'
  )
  union all
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'correspondences'
      and column_name = 'status' and column_default = '''pending''::text'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'correspondences'
      and column_name = 'established_at'
  )
)
select bool_and(pass) as overall_pass
from checks;
