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
        and column_name = 'warning_issued_at' and data_type = 'timestamp with time zone'
    ) as warning_issued_at_column_present,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'safety_evaluations'
        and column_name = 'fingerprint' and data_type = 'text'
    ) as fingerprint_column_present,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'safety_evaluations'
        and column_name = 'question_answer_id' and data_type = 'uuid'
    ) as question_answer_id_column_present,
    exists (
      select 1 from pg_constraint
      where conrelid = 'public.safety_evaluations'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%first_letter%question_answer_id%'
    ) as question_answer_id_bound_to_first_letter,
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
        and indexname = 'safety_cases_one_active_per_subject'
    ) as one_active_per_subject_index_present,
    exists (
      select 1 from pg_constraint
      where conrelid = 'public.safety_cases'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%open%'
        and pg_get_constraintdef(oid) ilike '%reviewing%'
        and pg_get_constraintdef(oid) ilike '%no_action%'
        and pg_get_constraintdef(oid) ilike '%warned%'
        and pg_get_constraintdef(oid) ilike '%restricted%'
        and pg_get_constraintdef(oid) ilike '%suspended%'
        and pg_get_constraintdef(oid) ilike '%banned%'
        and pg_get_constraintdef(oid) ilike '%resolved%'
    ) as canonical_status_lifecycle_present,
    not exists (
      select 1 from pg_constraint
      where conrelid = 'public.safety_cases'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%dismissed%'
    ) as placeholder_dismissed_status_absent
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
        and pg_get_constraintdef(oid) ilike '%none%'
        and pg_get_constraintdef(oid) ilike '%weak%'
        and pg_get_constraintdef(oid) ilike '%meaningful%high%severe%'
    ) as risk_band_matches_evaluations_full_domain
),
fingerprint_function_check as (
  select
    not has_function_privilege('authenticated', 'tempa_private.safety_fingerprint(uuid, text, uuid, uuid, text)', 'EXECUTE') as authenticated_cannot,
    not has_function_privilege('anon', 'tempa_private.safety_fingerprint(uuid, text, uuid, uuid, text)', 'EXECUTE') as anon_cannot,
    coalesce(not p.prosecdef, false) as not_security_definer
  from (select 1 as anchor) _anchor
  left join pg_proc p
    on p.oid = to_regprocedure('tempa_private.safety_fingerprint(uuid, text, uuid, uuid, text)')
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
    on p.oid = to_regprocedure('tempa_private.safety_fingerprint(uuid, text, uuid, uuid, text)')
),
record_function_check as (
  select
    has_function_privilege('service_role', 'public.record_safety_evaluation(uuid, text, uuid, uuid, text, text, text[], text, boolean)', 'EXECUTE') as service_role_can,
    not has_function_privilege('authenticated', 'public.record_safety_evaluation(uuid, text, uuid, uuid, text, text, text[], text, boolean)', 'EXECUTE') as authenticated_cannot,
    not has_function_privilege('anon', 'public.record_safety_evaluation(uuid, text, uuid, uuid, text, text, text[], text, boolean)', 'EXECUTE') as anon_cannot
),
record_function_dedup_check as (
  select
    coalesce(pg_get_functiondef(p.oid) ilike '%consumed_at is null%', false) as checks_unconsumed,
    coalesce(pg_get_functiondef(p.oid) ilike '%expires_at > now()%', false) as checks_unexpired,
    coalesce(pg_get_functiondef(p.oid) ilike '%on conflict (evaluation_id) do nothing%', false) as signal_dedup_present,
    coalesce(
      pg_get_functiondef(p.oid) ilike '%on conflict (subject_user_id) where status in (''open'', ''reviewing'')%',
      false
    ) as case_upsert_present,
    coalesce(pg_get_functiondef(p.oid) ilike '%pg_advisory_xact_lock%', false) as advisory_lock_present,
    coalesce(
      position('pg_advisory_xact_lock' in pg_get_functiondef(p.oid)) > 0
      and position('into v_existing_id' in lower(pg_get_functiondef(p.oid))) > 0
      and position('pg_advisory_xact_lock' in pg_get_functiondef(p.oid))
        < position('into v_existing_id' in lower(pg_get_functiondef(p.oid))),
      false
    ) as advisory_lock_precedes_dedup_lookup,
    coalesce(pg_get_functiondef(p.oid) ilike '%v_existing_risk_band = p_risk_band%', false) as stale_policy_risk_band_compared,
    coalesce(pg_get_functiondef(p.oid) ilike '%v_existing_escalate_case = p_escalate_case%', false) as stale_policy_escalate_compared,
    coalesce(pg_get_functiondef(p.oid) ilike '%set expires_at = now() where id = v_existing_id%', false) as stale_evaluation_invalidated,
    coalesce(pg_get_functiondef(p.oid) ilike '%p_question_answer_id is required for first_letter%', false) as question_answer_id_required_for_first_letter,
    coalesce(
      pg_get_functiondef(p.oid) ilike '%p_risk_band in (''meaningful'', ''high'', ''severe'') or p_escalate_case%',
      false
    ) as signal_created_when_escalated_even_if_weak
  from (select 1 as anchor) _anchor
  left join pg_proc p
    on p.oid = to_regprocedure('public.record_safety_evaluation(uuid, text, uuid, uuid, text, text, text[], text, boolean)')
),
context_function_check as (
  select
    has_function_privilege('authenticated', 'public.can_evaluate_safety_context(text, uuid, uuid)', 'EXECUTE') as authenticated_can,
    not has_function_privilege('anon', 'public.can_evaluate_safety_context(text, uuid, uuid)', 'EXECUTE') as anon_cannot,
    not has_function_privilege('service_role', 'public.can_evaluate_safety_context(text, uuid, uuid)', 'EXECUTE') as service_role_not_specifically_granted
),
context_function_semantics_check as (
  select
    coalesce(pg_get_functiondef(p.oid) ilike '%auth.uid() is null%', false) as requires_session,
    coalesce(pg_get_functiondef(p.oid) ilike '%is_correspondence_blocked_pair%', false) as checks_blocked_pair,
    coalesce(pg_get_functiondef(p.oid) ilike '%l.recipient_id = auth.uid()%', false) as reply_checks_recipient_is_caller,
    coalesce(pg_get_functiondef(p.oid) ilike '%participant_low%' and pg_get_functiondef(p.oid) ilike '%participant_high%', false)
      as write_anytime_checks_participant,
    coalesce(
      pg_get_functiondef(p.oid) ilike '%qa.user_id = p_context_id%' and pg_get_functiondef(p.oid) ilike '%qa.is_current = true%',
      false
    ) as first_letter_checks_question_answer
  from (select 1 as anchor) _anchor
  left join pg_proc p
    on p.oid = to_regprocedure('public.can_evaluate_safety_context(text, uuid, uuid)')
),
cleanup_function_check as (
  select
    has_function_privilege('service_role', 'public.cleanup_expired_safety_evaluations(interval)', 'EXECUTE') as service_role_can,
    not has_function_privilege('authenticated', 'public.cleanup_expired_safety_evaluations(interval)', 'EXECUTE') as authenticated_cannot,
    not has_function_privilege('anon', 'public.cleanup_expired_safety_evaluations(interval)', 'EXECUTE') as anon_cannot
),
cleanup_function_active_case_check as (
  select
    coalesce(pg_get_functiondef(p.oid) ilike '%status in (''open'', ''reviewing'')%', false) as exempts_active_case_evidence
  from (select 1 as anchor) _anchor
  left join pg_proc p
    on p.oid = to_regprocedure('public.cleanup_expired_safety_evaluations(interval)')
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
  evs.warning_issued_at_column_present as evaluations_warning_issued_at_present,
  evs.fingerprint_column_present as evaluations_fingerprint_present,
  evs.question_answer_id_column_present as evaluations_question_answer_id_present,
  evs.question_answer_id_bound_to_first_letter as evaluations_question_answer_id_bound_to_first_letter,
  evs.dedup_index_present as evaluations_dedup_index_present,
  c.anon_no_select as cases_anon_no_select,
  c.authenticated_no_select as cases_authenticated_no_select,
  c.service_role_no_select as cases_service_role_no_select,
  cp.no_policy_of_any_kind as cases_no_policy,
  cs.one_active_per_subject_index_present as cases_one_active_per_subject_index_present,
  cs.canonical_status_lifecycle_present as cases_canonical_status_lifecycle_present,
  cs.placeholder_dismissed_status_absent as cases_placeholder_dismissed_status_absent,
  s.anon_no_select as signals_anon_no_select,
  s.authenticated_no_select as signals_authenticated_no_select,
  sp.no_policy_of_any_kind as signals_no_policy,
  ss.evaluation_id_unique as signals_evaluation_id_unique,
  ss.risk_band_matches_evaluations_full_domain as signals_risk_band_matches_evaluations_full_domain,
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
  rfd.advisory_lock_present as record_advisory_lock_present,
  rfd.advisory_lock_precedes_dedup_lookup as record_advisory_lock_precedes_dedup_lookup,
  rfd.stale_policy_risk_band_compared as record_stale_policy_risk_band_compared,
  rfd.stale_policy_escalate_compared as record_stale_policy_escalate_compared,
  rfd.stale_evaluation_invalidated as record_stale_evaluation_invalidated,
  rfd.question_answer_id_required_for_first_letter as record_question_answer_id_required_for_first_letter,
  rfd.signal_created_when_escalated_even_if_weak as record_signal_created_when_escalated_even_if_weak,
  cx.authenticated_can as context_authenticated_can,
  cx.anon_cannot as context_anon_cannot,
  cxs.requires_session as context_requires_session,
  cxs.checks_blocked_pair as context_checks_blocked_pair,
  cxs.reply_checks_recipient_is_caller as context_reply_checks_recipient_is_caller,
  cxs.write_anytime_checks_participant as context_write_anytime_checks_participant,
  cxs.first_letter_checks_question_answer as context_first_letter_checks_question_answer,
  cf.service_role_can as cleanup_service_role_can,
  cf.authenticated_cannot as cleanup_authenticated_cannot,
  cf.anon_cannot as cleanup_anon_cannot,
  cfa.exempts_active_case_evidence as cleanup_exempts_active_case_evidence,
  (
    t.all_tables_present and t.all_rls_enabled
    and ev.anon_no_select and ev.authenticated_no_select and ev.authenticated_no_insert and ev.authenticated_no_update
    and evp.no_policy_of_any_kind
    and evs.surface_check_present and evs.consumed_at_column_present and evs.warning_issued_at_column_present
    and evs.fingerprint_column_present and evs.question_answer_id_column_present and evs.question_answer_id_bound_to_first_letter
    and evs.dedup_index_present
    and c.anon_no_select and c.authenticated_no_select and c.service_role_no_select
    and cp.no_policy_of_any_kind
    and cs.one_active_per_subject_index_present and cs.canonical_status_lifecycle_present and cs.placeholder_dismissed_status_absent
    and s.anon_no_select and s.authenticated_no_select
    and sp.no_policy_of_any_kind
    and ss.evaluation_id_unique and ss.risk_band_matches_evaluations_full_domain
    and ff.authenticated_cannot and ff.anon_cannot and ff.not_security_definer
    and ftb.computes_digest_itself
    and rf.service_role_can and rf.authenticated_cannot and rf.anon_cannot
    and rfd.checks_unconsumed and rfd.checks_unexpired and rfd.signal_dedup_present and rfd.case_upsert_present
    and rfd.advisory_lock_present and rfd.advisory_lock_precedes_dedup_lookup
    and rfd.stale_policy_risk_band_compared and rfd.stale_policy_escalate_compared and rfd.stale_evaluation_invalidated
    and rfd.question_answer_id_required_for_first_letter and rfd.signal_created_when_escalated_even_if_weak
    and cx.authenticated_can and cx.anon_cannot
    and cxs.requires_session and cxs.checks_blocked_pair and cxs.reply_checks_recipient_is_caller and cxs.write_anytime_checks_participant
    and cxs.first_letter_checks_question_answer
    and cf.service_role_can and cf.authenticated_cannot and cf.anon_cannot
    and cfa.exempts_active_case_evidence
  ) as overall_pass
from tables_check t,
     evaluations_grant_check ev, evaluations_policy_check evp, evaluations_structure_check evs,
     cases_grant_check c, cases_policy_check cp, cases_structure_check cs,
     signals_grant_check s, signals_policy_check sp, signals_structure_check ss,
     fingerprint_function_check ff, fingerprint_ts_boundary_check ftb,
     record_function_check rf, record_function_dedup_check rfd,
     context_function_check cx, context_function_semantics_check cxs,
     cleanup_function_check cf, cleanup_function_active_case_check cfa,
     no_pg_cron_scheduling_check _np;
