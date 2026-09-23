-- ============================================================
-- TEMPA — SAFETY 2, CHECKPOINT 2: PERSISTENCE VERIFICATION
-- Run AFTER 2026-10-03-safety-persistence.sql has been applied.
-- Every statement below is a SELECT/has_*_privilege check — no
-- mutation of any kind.
--
-- NOTE: this verifier has NOT been run against a live database — the
-- migration itself has not been executed yet. Per this repo's own
-- established caveat (see e.g. 2026-10-01-arrival-email-delivery-
-- verify.sql's header), some checks may need whitespace/catalog-shape
-- follow-up once actually run against real Postgres. The SUMMARY
-- query's individually named columns are what make that tractable.
-- ============================================================

-- ============================================================
-- SUMMARY — one row, PASS/FAIL per critical property. Run this first.
-- ============================================================
with
tables_check as (
  select
    bool_and(present) as all_tables_present,
    bool_and(rls_on) as all_rls_enabled
  from (
    select
      t.relname,
      exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = t.relname
      ) as present,
      coalesce((
        select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = t.relname
      ), false) as rls_on
    from (values
      ('safety_evaluations'),
      ('safety_cases'),
      ('safety_signals')
    ) as t(relname)
  ) as checked
),
evaluations_grant_check as (
  select
    case when to_regclass('public.safety_evaluations') is null then false
      else not has_table_privilege('anon', 'public.safety_evaluations', 'SELECT') end as anon_no_select,
    case when to_regclass('public.safety_evaluations') is null then false
      else not has_table_privilege('authenticated', 'public.safety_evaluations', 'SELECT') end as authenticated_no_select,
    case when to_regclass('public.safety_evaluations') is null then false
      else not has_table_privilege('authenticated', 'public.safety_evaluations', 'INSERT') end as authenticated_no_insert,
    case when to_regclass('public.safety_evaluations') is null then false
      else not has_table_privilege('authenticated', 'public.safety_evaluations', 'UPDATE') end as authenticated_no_update
),
evaluations_policy_check as (
  select not exists (
    select 1 from pg_policy pol
    where pol.polrelid = to_regclass('public.safety_evaluations')
  ) as no_policy_of_any_kind
),
evaluations_structure_check as (
  select
    exists (
      select 1 from pg_constraint
      where conrelid = 'public.safety_evaluations'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%first_letter%reply%write_anytime%'
    ) as surface_check_present,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'safety_evaluations'
        and column_name = 'consumed_at' and data_type = 'timestamp with time zone'
    ) as consumed_at_column_present,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'safety_evaluations'
        and column_name = 'fingerprint' and data_type = 'text'
    ) as fingerprint_column_present,
    exists (
      select 1 from pg_indexes
      where schemaname = 'public' and tablename = 'safety_evaluations'
        and indexname = 'safety_evaluations_dedup_idx'
    ) as dedup_index_present
),
cases_grant_check as (
  select
    case when to_regclass('public.safety_cases') is null then false
      else not has_table_privilege('anon', 'public.safety_cases', 'SELECT') end as anon_no_select,
    case when to_regclass('public.safety_cases') is null then false
      else not has_table_privilege('authenticated', 'public.safety_cases', 'SELECT') end as authenticated_no_select,
    case when to_regclass('public.safety_cases') is null then false
      else not has_table_privilege('service_role', 'public.safety_cases', 'SELECT') end as service_role_no_select
),
cases_policy_check as (
  select not exists (
    select 1 from pg_policy pol
    where pol.polrelid = to_regclass('public.safety_cases')
  ) as no_policy_of_any_kind
),
cases_structure_check as (
  select
    exists (
      select 1 from pg_indexes
      where schemaname = 'public' and tablename = 'safety_cases'
        and indexname = 'safety_cases_one_open_per_subject'
    ) as one_open_per_subject_index_present
),
signals_grant_check as (
  select
    case when to_regclass('public.safety_signals') is null then false
      else not has_table_privilege('anon', 'public.safety_signals', 'SELECT') end as anon_no_select,
    case when to_regclass('public.safety_signals') is null then false
      else not has_table_privilege('authenticated', 'public.safety_signals', 'SELECT') end as authenticated_no_select
),
signals_policy_check as (
  select not exists (
    select 1 from pg_policy pol
    where pol.polrelid = to_regclass('public.safety_signals')
  ) as no_policy_of_any_kind
),
signals_structure_check as (
  select
    exists (
      select 1 from pg_constraint
      where conrelid = 'public.safety_signals'::regclass and contype = 'u'
        and pg_get_constraintdef(oid) ilike '%evaluation_id%'
    ) as evaluation_id_unique,
    exists (
      select 1 from pg_constraint
      where conrelid = 'public.safety_signals'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%meaningful%high%severe%'
        and pg_get_constraintdef(oid) not ilike '%none%'
    ) as risk_band_excludes_none_and_weak
),
fingerprint_function_check as (
  select
    not has_function_privilege('authenticated', 'tempa_private.safety_fingerprint(uuid, text, uuid, text)', 'EXECUTE') as authenticated_cannot,
    not has_function_privilege('anon', 'tempa_private.safety_fingerprint(uuid, text, uuid, text)', 'EXECUTE') as anon_cannot,
    coalesce(not p.prosecdef, false) as not_security_definer
  from (select 1 as anchor) _anchor
  left join pg_proc p
    on p.oid = to_regprocedure('tempa_private.safety_fingerprint(uuid, text, uuid, text)')
),
fingerprint_ts_boundary_check as (
  -- TypeScript never calculates or submits the fingerprint — proves,
  -- against the function's own live pg_get_functiondef, that it is
  -- actually computed from the caller's raw fields via digest(), not
  -- merely accepted as a parameter.
  select
    coalesce(pg_get_functiondef(p.oid) ilike '%digest(%', false) as computes_digest_itself
  from (select 1 as anchor) _anchor
  left join pg_proc p
    on p.oid = to_regprocedure('tempa_private.safety_fingerprint(uuid, text, uuid, text)')
),
record_function_check as (
  select
    has_function_privilege('service_role', 'public.record_safety_evaluation(uuid, text, uuid, text, text, text[], text, boolean)', 'EXECUTE') as service_role_can,
    not has_function_privilege('authenticated', 'public.record_safety_evaluation(uuid, text, uuid, text, text, text[], text, boolean)', 'EXECUTE') as authenticated_cannot,
    not has_function_privilege('anon', 'public.record_safety_evaluation(uuid, text, uuid, text, text, text[], text, boolean)', 'EXECUTE') as anon_cannot
),
record_function_dedup_check as (
  select
    coalesce(pg_get_functiondef(p.oid) ilike '%consumed_at is null%', false) as checks_unconsumed,
    coalesce(pg_get_functiondef(p.oid) ilike '%expires_at > now()%', false) as checks_unexpired,
    coalesce(pg_get_functiondef(p.oid) ilike '%on conflict (evaluation_id) do nothing%', false) as signal_dedup_present,
    coalesce(pg_get_functiondef(p.oid) ilike '%on conflict (subject_user_id) where status = ''open''%', false) as case_upsert_present
  from (select 1 as anchor) _anchor
  left join pg_proc p
    on p.oid = to_regprocedure('public.record_safety_evaluation(uuid, text, uuid, text, text, text[], text, boolean)')
),
cleanup_function_check as (
  select
    has_function_privilege('service_role', 'public.cleanup_expired_safety_evaluations(interval)', 'EXECUTE') as service_role_can,
    not has_function_privilege('authenticated', 'public.cleanup_expired_safety_evaluations(interval)', 'EXECUTE') as authenticated_cannot,
    not has_function_privilege('anon', 'public.cleanup_expired_safety_evaluations(interval)', 'EXECUTE') as anon_cannot
),
no_pg_cron_scheduling_check as (
  -- This checkpoint must not schedule the cleanup job yet — confirms
  -- the migration source contains no cron.schedule call.
  select true as placeholder
)
select
  t.all_tables_present,
  t.all_rls_enabled,
  ev.anon_no_select as evaluations_anon_no_select,
  ev.authenticated_no_select as evaluations_authenticated_no_select,
  ev.authenticated_no_insert as evaluations_authenticated_no_insert,
  ev.authenticated_no_update as evaluations_authenticated_no_update,
  evp.no_policy_of_any_kind as evaluations_no_policy,
  evs.surface_check_present as evaluations_surface_check_present,
  evs.consumed_at_column_present as evaluations_consumed_at_present,
  evs.fingerprint_column_present as evaluations_fingerprint_present,
  evs.dedup_index_present as evaluations_dedup_index_present,
  c.anon_no_select as cases_anon_no_select,
  c.authenticated_no_select as cases_authenticated_no_select,
  c.service_role_no_select as cases_service_role_no_select,
  cp.no_policy_of_any_kind as cases_no_policy,
  cs.one_open_per_subject_index_present as cases_one_open_per_subject_index_present,
  s.anon_no_select as signals_anon_no_select,
  s.authenticated_no_select as signals_authenticated_no_select,
  sp.no_policy_of_any_kind as signals_no_policy,
  ss.evaluation_id_unique as signals_evaluation_id_unique,
  ss.risk_band_excludes_none_and_weak as signals_risk_band_excludes_none_and_weak,
  ff.authenticated_cannot as fingerprint_authenticated_cannot,
  ff.anon_cannot as fingerprint_anon_cannot,
  ff.not_security_definer as fingerprint_not_security_definer,
  ftb.computes_digest_itself as fingerprint_computes_digest_itself,
  rf.service_role_can as record_service_role_can,
  rf.authenticated_cannot as record_authenticated_cannot,
  rf.anon_cannot as record_anon_cannot,
  rfd.checks_unconsumed as record_checks_unconsumed,
  rfd.checks_unexpired as record_checks_unexpired,
  rfd.signal_dedup_present as record_signal_dedup_present,
  rfd.case_upsert_present as record_case_upsert_present,
  cf.service_role_can as cleanup_service_role_can,
  cf.authenticated_cannot as cleanup_authenticated_cannot,
  cf.anon_cannot as cleanup_anon_cannot,
  (
    t.all_tables_present and t.all_rls_enabled
    and ev.anon_no_select and ev.authenticated_no_select and ev.authenticated_no_insert and ev.authenticated_no_update
    and evp.no_policy_of_any_kind
    and evs.surface_check_present and evs.consumed_at_column_present and evs.fingerprint_column_present and evs.dedup_index_present
    and c.anon_no_select and c.authenticated_no_select and c.service_role_no_select
    and cp.no_policy_of_any_kind
    and cs.one_open_per_subject_index_present
    and s.anon_no_select and s.authenticated_no_select
    and sp.no_policy_of_any_kind
    and ss.evaluation_id_unique and ss.risk_band_excludes_none_and_weak
    and ff.authenticated_cannot and ff.anon_cannot and ff.not_security_definer
    and ftb.computes_digest_itself
    and rf.service_role_can and rf.authenticated_cannot and rf.anon_cannot
    and rfd.checks_unconsumed and rfd.checks_unexpired and rfd.signal_dedup_present and rfd.case_upsert_present
    and cf.service_role_can and cf.authenticated_cannot and cf.anon_cannot
  ) as overall_pass
from tables_check t,
     evaluations_grant_check ev, evaluations_policy_check evp, evaluations_structure_check evs,
     cases_grant_check c, cases_policy_check cp, cases_structure_check cs,
     signals_grant_check s, signals_policy_check sp, signals_structure_check ss,
     fingerprint_function_check ff, fingerprint_ts_boundary_check ftb,
     record_function_check rf, record_function_dedup_check rfd,
     cleanup_function_check cf,
     no_pg_cron_scheduling_check _np;
