-- ============================================================
-- YOUR MARK PRODUCTION FOUNDATION — READ-ONLY VERIFIER
-- Run only AFTER 2026-09-29-your-mark-production.sql is approved and
-- applied. Every statement in this file is SELECT-only.
-- ============================================================

with
flagship_index as (
  select
    i.indisunique,
    i.indisvalid,
    i.indisready,
    i.indislive,
    pg_get_expr(i.indpred, i.indrelid) as predicate,
    pg_get_indexdef(i.indexrelid) as definition
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'questions_is_flagship_unique'
),
profile_columns as (
  select
    count(*) filter (where column_name = 'onboarding_stage') = 1 as has_stage,
    count(*) filter (where column_name = 'mark_id') = 1 as has_mark_id
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles'
),
profile_privileges as (
  select
    not has_table_privilege('authenticated', 'public.profiles', 'UPDATE') as no_table_update,
    not exists (
      select 1 from information_schema.column_privileges cp
      where cp.table_schema = 'public' and cp.table_name = 'profiles'
        and cp.grantee = 'authenticated' and cp.privilege_type = 'UPDATE'
    ) as no_column_update
),
mark_indexes as (
  select
    to_regclass('public.profile_marks_one_pending_per_owner') is not null as one_pending,
    to_regclass('public.profile_marks_one_active_per_owner') is not null as one_active
),
mark_privileges as (
  select
    not has_table_privilege('authenticated', 'public.profile_marks', 'SELECT')
    and not has_table_privilege('authenticated', 'public.profile_marks', 'INSERT')
    and not has_table_privilege('authenticated', 'public.profile_marks', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.profile_marks', 'DELETE')
      as no_direct_access
),
rpc_checks as (
  select
    to_regprocedure('public.reserve_profile_mark()') is not null as reserve_exists,
    to_regprocedure('public.discard_profile_mark(uuid)') is not null as discard_exists,
    to_regprocedure('public.finalize_profile_mark(uuid)') is not null as finalize_exists,
    to_regprocedure('public.complete_flagship_onboarding()') is not null as recovery_exists,
    has_function_privilege('authenticated', 'public.reserve_profile_mark()', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.discard_profile_mark(uuid)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.finalize_profile_mark(uuid)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.complete_flagship_onboarding()', 'EXECUTE')
      as authenticated_exec
),
view_checks as (
  select
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'public_profiles' and column_name = 'mark_id'
    ) as exposes_mark_id,
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'public_profiles'
        and column_name in ('owner_id', 'onboarding_stage')
    ) as hides_private_state,
    pg_get_viewdef('public.public_profiles'::regclass, true) ilike '%tempa_private.is_blocked_pair%'
      as remains_block_aware
),
bucket_checks as (
  select
    coalesce(bool_and(
      b.public = true
      and b.file_size_limit = 1048576
      and b.allowed_mime_types = array['image/png']::text[]
    ), false) as configured
  from storage.buckets b where b.id = 'profile-marks'
),
policy_checks as (
  select
    count(*) filter (where policyname = 'profile_marks_insert' and cmd = 'INSERT') = 1 as insert_policy,
    count(*) filter (where policyname = 'profile_marks_delete' and cmd = 'DELETE') = 1 as delete_policy,
    count(*) filter (where policyname in ('profile_marks_update', 'profile_marks_select')) = 0
      as no_update_or_select_policy
  from pg_policies where schemaname = 'storage' and tablename = 'objects'
),
publish_check as (
  select
    pg_get_functiondef('public.publish_question_answer(uuid,text)'::regprocedure)
      ilike '%q.is_flagship = true%'
    and pg_get_functiondef('public.publish_question_answer(uuid,text)'::regprocedure)
      ilike '%onboarding_stage = ''question''%'
    as atomic_flagship_completion
)
select
  pc.has_stage and pc.has_mark_id as profile_columns_ok,
  pp.no_table_update and pp.no_column_update as profile_update_boundary_ok,
  mi.one_pending and mi.one_active as pending_active_uniqueness_ok,
  mp.no_direct_access as private_ownership_table_ok,
  rc.reserve_exists and rc.discard_exists and rc.finalize_exists
    and rc.recovery_exists and rc.authenticated_exec as mark_rpcs_ok,
  vc.exposes_mark_id and vc.hides_private_state and vc.remains_block_aware
    as public_profiles_ok,
  bc.configured as bucket_ok,
  plc.insert_policy and plc.delete_policy and plc.no_update_or_select_policy
    as storage_policies_ok,
  pub.atomic_flagship_completion as flagship_completion_ok,
  coalesce(fi.indisunique and fi.indisvalid and fi.indisready and fi.indislive
    and fi.definition ilike '%public.questions%'
    and fi.definition ilike '%(is_flagship)%'
    and regexp_replace(lower(fi.predicate), '[[:space:]()]', '', 'g') = 'is_flagship=true', false)
    as flagship_prerequisite_ok
from profile_columns pc
cross join profile_privileges pp
cross join mark_indexes mi
cross join mark_privileges mp
cross join rpc_checks rc
cross join view_checks vc
cross join bucket_checks bc
cross join policy_checks plc
cross join publish_check pub
left join flagship_index fi on true;

-- Detailed diagnostic rows follow the one-row summary.
select ordinal_position, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name in ('profiles', 'public_profiles')
order by table_name, ordinal_position;

select policyname, roles, cmd, qual, with_check
from pg_policies
where (schemaname = 'public' and tablename in ('profiles', 'profile_marks'))
   or (schemaname = 'storage' and tablename = 'objects' and policyname like 'profile_marks_%')
order by schemaname, tablename, policyname;
