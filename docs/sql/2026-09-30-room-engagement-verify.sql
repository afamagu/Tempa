-- TEMPA — ROOM ENGAGEMENT / FAIRNESS VERIFIER
-- READ ONLY. Safe to run in the production Supabase SQL editor.
-- Verifies object presence, privileges/config, and current Room Question state.

-- 1. Required private tables.
select
  to_regclass('private.room_member_exposure') is not null as room_member_exposure_exists,
  to_regclass('private.room_candidate_week_exposure') is not null as room_candidate_week_exposure_exists,
  to_regclass('private.room_exposure_events') is not null as room_exposure_events_exists,
  to_regclass('private.room_discovery_config') is not null as room_discovery_config_exists;

-- 2. Expected discovery/admin functions.
select
  to_regprocedure('public.room_discovery_rank_facts(uuid,uuid[])') is not null as rank_facts_exists,
  to_regprocedure('public.record_room_exposures(uuid,uuid[],text)') is not null as exposure_recorder_exists,
  to_regprocedure('public.discover_people_v2(text,text,text,uuid,uuid[],integer,integer)') is not null as discover_people_v2_exists,
  to_regprocedure('public.room_fairness_snapshot()') is not null as fairness_snapshot_exists,
  to_regprocedure('public.admin_make_current_room_question(uuid)') is not null as make_current_room_question_exists;

-- 3. RLS state on private exposure tables.
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'private'
  and c.relname in (
    'room_member_exposure',
    'room_candidate_week_exposure',
    'room_exposure_events'
  )
order by c.relname;

-- 4. Ordinary authenticated users must not have direct table privileges.
select
  table_schema,
  table_name,
  privilege_type,
  grantee
from information_schema.role_table_grants
where table_schema = 'private'
  and table_name in (
    'room_member_exposure',
    'room_candidate_week_exposure',
    'room_exposure_events',
    'room_discovery_config'
  )
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;
-- Expected: zero rows.

-- 5. Discovery configuration. Expected initial values: 7 days / 6 distinct viewers.
select new_member_window_days, new_member_floor_distinct_viewers
from private.room_discovery_config
where singleton = true;

-- 6. Active Question inventory and live Room state.
select
  id,
  prompt,
  is_flagship,
  current_position,
  is_active
from public.questions
where is_active = true
order by is_flagship desc, current_position nulls last, created_at desc nulls last;

select
  count(*) filter (
    where is_active = true
      and is_flagship = false
      and current_position is not null
  ) as live_room_question_count,
  count(*) filter (
    where is_active = true
      and is_flagship = true
  ) as active_flagship_count
from public.questions;
-- Expected after editorial selection: live_room_question_count = 1,
-- active_flagship_count = 1.

-- 7. Index inventory for exposure accounting.
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'private'
  and tablename in (
    'room_member_exposure',
    'room_candidate_week_exposure',
    'room_exposure_events'
  )
order by tablename, indexname;

-- 8. Function execution grants. Inspect that discovery/rank facts are not public,
-- recorder/fairness snapshot are service-role only, and admin action is authenticated
-- with its own is_staff('admin') guard.
select
  routine_schema,
  routine_name,
  grantee,
  privilege_type
from information_schema.role_routine_grants
where routine_schema = 'public'
  and routine_name in (
    'room_discovery_rank_facts',
    'record_room_exposures',
    'discover_people_v2',
    'room_fairness_snapshot',
    'admin_make_current_room_question'
  )
order by routine_name, grantee;
