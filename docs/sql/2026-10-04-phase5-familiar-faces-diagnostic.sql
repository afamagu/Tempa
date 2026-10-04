-- TEMPA — PHASE 5 FAMILIAR FACES / FINITE DISCOVER DIAGNOSTIC
-- READ ONLY. Safe to run before the Phase 5 migration.
--
-- Purpose:
--   Confirm the live introduction-history authority and discovery functions
--   before applying Familiar Faces. This file changes nothing.

-- 1. The encounter/history relations and their columns.
select
  c.table_schema,
  c.table_name,
  c.column_name,
  c.data_type,
  c.is_nullable
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in ('member_introduction_state', 'member_introduction_history')
order by c.table_name, c.ordinal_position;

-- 2. RLS policies on the encounter/history relations.
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('member_introduction_state', 'member_introduction_history')
order by tablename, policyname;

-- 3. Exact live definitions of the introduction/discovery authorities Phase 5 relies on.
select
  n.nspname as function_schema,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  p.prosecdef as security_definer,
  p.provolatile as volatility,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'tempa_private')
  and p.proname in (
    'get_member_introductions',
    'mark_member_introduction_presented',
    'consume_member_introduction',
    'member_introduction_newcomer_ids',
    'discover_people',
    'discover_people_v2',
    'discover_profiles',
    'discover_profile_people',
    'get_relationship_capacity'
  )
order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid);

-- 4. Compact readiness summary. This intentionally does not assume the
-- Familiar Faces RPC exists yet.
select
  to_regclass('public.member_introduction_history') is not null as encounter_history_present,
  to_regprocedure('public.get_member_introductions(integer)') is not null as introductions_reader_present,
  to_regprocedure('public.mark_member_introduction_presented(uuid)') is not null as presentation_recorder_present,
  to_regprocedure('public.consume_member_introduction(uuid,text)') is not null as encounter_action_recorder_present,
  to_regprocedure('public.get_relationship_capacity()') is not null as capacity_authority_present;
