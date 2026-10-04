-- ============================================================
-- TEMPA — PHASE 1 RELATIONSHIP HEALTH MEASUREMENT: READ-ONLY VERIFIER
-- Run AFTER docs/sql/2026-10-04-phase1-relationship-metrics.sql.
-- This file makes no changes. overall_pass must be true.
-- ============================================================

with checks as (
  select
    'snapshot_table_present' as check_name,
    to_regclass('public.relationship_establishment_snapshots') is not null as pass

  union all
  select
    'snapshot_rls_enabled',
    coalesce((
      select c.relrowsecurity
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'relationship_establishment_snapshots'
    ), false)

  union all
  select
    'snapshot_not_client_readable',
    not has_table_privilege('authenticated', 'public.relationship_establishment_snapshots', 'SELECT')
    and not has_table_privilege('anon', 'public.relationship_establishment_snapshots', 'SELECT')

  union all
  select
    'snapshot_not_client_writable',
    not has_table_privilege('authenticated', 'public.relationship_establishment_snapshots', 'INSERT')
    and not has_table_privilege('authenticated', 'public.relationship_establishment_snapshots', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.relationship_establishment_snapshots', 'DELETE')
    and not has_table_privilege('anon', 'public.relationship_establishment_snapshots', 'INSERT')

  union all
  select
    'snapshot_capture_function_present',
    to_regprocedure('tempa_private.capture_relationship_establishment_snapshot()') is not null

  union all
  select
    'snapshot_trigger_present_enabled',
    exists (
      select 1
      from pg_catalog.pg_trigger t
      where t.tgrelid = 'public.correspondences'::regclass
        and t.tgname = 'correspondences_capture_relationship_establishment_snapshot'
        and not t.tgisinternal
        and t.tgenabled <> 'D'
    )

  union all
  select
    'pilot_metrics_function_present',
    to_regprocedure('public.get_relationship_pilot_metrics()') is not null

  union all
  select
    'pilot_metrics_service_only',
    has_function_privilege('service_role', 'public.get_relationship_pilot_metrics()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.get_relationship_pilot_metrics()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_relationship_pilot_metrics()', 'EXECUTE')

  union all
  select
    'first_contact_funnel_present',
    to_regprocedure('public.get_relationship_first_contact_funnel(timestamptz)') is not null

  union all
  select
    'first_contact_funnel_service_only',
    has_function_privilege('service_role', 'public.get_relationship_first_contact_funnel(timestamptz)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.get_relationship_first_contact_funnel(timestamptz)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_relationship_first_contact_funnel(timestamptz)', 'EXECUTE')
)
select
  check_name,
  pass,
  case when pass then 'PASS' else 'FAIL' end as result
from checks
order by check_name;

with checks as (
  select to_regclass('public.relationship_establishment_snapshots') is not null as pass
  union all
  select coalesce((
    select c.relrowsecurity
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'relationship_establishment_snapshots'
  ), false)
  union all
  select not has_table_privilege('authenticated', 'public.relationship_establishment_snapshots', 'SELECT')
    and not has_table_privilege('anon', 'public.relationship_establishment_snapshots', 'SELECT')
  union all
  select not has_table_privilege('authenticated', 'public.relationship_establishment_snapshots', 'INSERT')
    and not has_table_privilege('authenticated', 'public.relationship_establishment_snapshots', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.relationship_establishment_snapshots', 'DELETE')
    and not has_table_privilege('anon', 'public.relationship_establishment_snapshots', 'INSERT')
  union all
  select to_regprocedure('tempa_private.capture_relationship_establishment_snapshot()') is not null
  union all
  select exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.correspondences'::regclass
      and t.tgname = 'correspondences_capture_relationship_establishment_snapshot'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  )
  union all
  select to_regprocedure('public.get_relationship_pilot_metrics()') is not null
  union all
  select has_function_privilege('service_role', 'public.get_relationship_pilot_metrics()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.get_relationship_pilot_metrics()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_relationship_pilot_metrics()', 'EXECUTE')
  union all
  select to_regprocedure('public.get_relationship_first_contact_funnel(timestamptz)') is not null
  union all
  select has_function_privilege('service_role', 'public.get_relationship_first_contact_funnel(timestamptz)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.get_relationship_first_contact_funnel(timestamptz)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_relationship_first_contact_funnel(timestamptz)', 'EXECUTE')
)
select bool_and(pass) as overall_pass
from checks;
