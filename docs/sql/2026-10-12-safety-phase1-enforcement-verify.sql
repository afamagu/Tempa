-- ============================================================
-- TEMPA — TRUST & SAFETY PHASE 1: VERIFY 2026-10-12-safety-phase1-
-- enforcement.sql
-- Run AFTER that migration has been applied. Every statement is a
-- SELECT / has_*_privilege / catalog check — no mutation of any kind.
--
-- NOTE: this verifier has NOT been run against a live database. It was
-- proven only against a PGlite (WASM PostgreSQL) scaffold outside the
-- repository. Read the single result row: overall_pass must be true.
-- ============================================================

with
tables_check as (
  select
    to_regclass('public.safety_attempt_evidence') is not null as evidence_table_present,
    coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.safety_attempt_evidence')), false) as evidence_rls_enabled,
    not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'safety_attempt_evidence') as evidence_has_no_policies,
    not has_table_privilege('anon', 'public.safety_attempt_evidence', 'SELECT') as evidence_not_readable_by_anon,
    not has_table_privilege('authenticated', 'public.safety_attempt_evidence', 'SELECT') as evidence_not_readable_by_authenticated,
    to_regclass('public.member_notices') is not null as notices_table_present,
    coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.member_notices')), false) as notices_rls_enabled,
    exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'member_notices' and policyname = 'member_notices_select_own') as notices_select_own_policy,
    not has_table_privilege('authenticated', 'public.member_notices', 'INSERT') as notices_not_writable_by_members,
    to_regclass('public.letter_safety_notices') is not null as letter_notices_table_present,
    coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.letter_safety_notices')), false) as letter_notices_rls_enabled,
    exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'letter_safety_notices' and policyname = 'letter_safety_notices_select_recipient') as letter_notices_recipient_policy,
    not has_table_privilege('authenticated', 'public.letter_safety_notices', 'INSERT') as letter_notices_not_writable_by_members,
    exists (
      select 1 from pg_constraint k
      where k.conrelid = to_regclass('public.letter_safety_notices') and k.contype = 'f' and k.condeferrable and k.condeferred
    ) as letter_notices_fk_deferred
),
function_presence as (
  select
    to_regprocedure('tempa_private.safety_target_key(uuid, text, uuid)') is not null as target_key_present,
    to_regprocedure('tempa_private.hidden_from_discovery(uuid, uuid)') is not null as hidden_from_discovery_present,
    to_regprocedure('tempa_private.account_is_banned(uuid)') is not null as account_is_banned_present,
    to_regprocedure('tempa_private.apply_pending_review_restriction(uuid, integer)') is not null as restriction_function_present,
    to_regprocedure('public.admin_get_safety_case_review(uuid)') is not null as review_rpc_present,
    to_regprocedure('public.mark_member_notice_read(uuid)') is not null as mark_read_present
),
definitions as (
  select
    pg_get_functiondef(to_regprocedure('tempa_private.solicitation_reason_codes()')) as codes_def,
    pg_get_functiondef(to_regprocedure('tempa_private.evaluate_behavior(uuid, text, text[], boolean, boolean)')) as behavior_def,
    pg_get_functiondef(to_regprocedure('public.record_safety_evaluation(uuid, text, uuid, uuid, uuid, text, text[], jsonb, text, text, text[], text, boolean)')) as record_def,
    pg_get_functiondef(to_regprocedure('tempa_private.consume_safety_evaluation(uuid, uuid, text, uuid, uuid, uuid, text, text[], jsonb, text, boolean, uuid)')) as consume_def,
    pg_get_functiondef(to_regprocedure('public.admin_set_account_status(uuid, text, text)')) as set_status_def,
    pg_get_functiondef(to_regprocedure('public.cleanup_expired_safety_evaluations(interval)')) as cleanup_def,
    pg_get_functiondef(to_regprocedure('public.get_post_closure_recommendations(uuid)')) as recs_def,
    pg_get_functiondef(to_regprocedure('public.admin_get_safety_case_review(uuid)')) as review_def,
    pg_get_viewdef(to_regclass('public.public_profiles'), true) as profiles_view_def
),
definition_check as (
  select
    d.codes_def ilike '%MONEY_INTERMEDIARY_REQUEST%' as codes_include_intermediary,
    d.codes_def not ilike '%OFF_PLATFORM_ESCALATION%' as codes_exclude_off_platform,
    d.behavior_def ~* 'safety_attempt_evidence' as behavior_counts_evidence,
    d.behavior_def ~* 'count\s*\(\s*distinct\s+e\.target_key\s*\)' as behavior_counts_distinct_targets,
    d.behavior_def ~* 'apply_pending_review_restriction' as behavior_applies_restriction,
    d.record_def ~* 'insert\s+into\s+public\.safety_attempt_evidence' as record_writes_evidence,
    d.record_def ~* 'on\s+conflict\s+on\s+constraint\s+safety_signals_evaluation_id_key\s+do\s+nothing' as record_keeps_42702_repair,
    not (d.record_def ~* 'on\s+conflict\s*\(\s*evaluation_id\s*\)\s*do\s+nothing') as record_has_no_ambiguous_clause,
    d.consume_def ~* 'in\s*\(\s*''restricted''\s*,\s*''suspended''\s*,\s*''banned''\s*\)' as consume_blocks_restricted,
    d.consume_def ~* 'insert\s+into\s+public\.letter_safety_notices' as consume_writes_letter_notice,
    d.set_status_def ~* 'insert\s+into\s+public\.member_notices' as set_status_writes_notices,
    d.cleanup_def ~* 'account_enforcement_state' as cleanup_retains_enforced_evidence,
    d.recs_def ~* 'hidden_from_discovery' as recommendations_exclude_hidden,
    d.profiles_view_def ~* 'account_is_banned' as profiles_view_hides_banned,
    -- the review RPC's first statement after BEGIN is the staff gate
    d.review_def ~* 'begin\s+if\s+not\s+public\.is_staff\(\)' as review_is_staff_gated,
    d.review_def ~* 'view_safety_attempt_evidence' as review_is_audited
  from definitions d
),
policy_check as (
  select
    coalesce((
      select p.qual ilike '%hidden_from_discovery%'
      from pg_policies p
      where p.schemaname = 'public' and p.tablename = 'question_answers'
        and p.policyname = 'Answers to active questions are readable by authenticated users'
      limit 1
    ), false) as discovery_policy_excludes_hidden
),
security_check as (
  select
    coalesce((select p.prosecdef from pg_proc p where p.oid = to_regprocedure('tempa_private.apply_pending_review_restriction(uuid, integer)')), false) as restriction_function_is_definer,
    coalesce((select p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.admin_get_safety_case_review(uuid)')), false) as review_rpc_is_definer,
    not has_function_privilege('anon', 'public.admin_get_safety_case_review(uuid)', 'EXECUTE') as review_rpc_not_for_anon,
    not has_function_privilege('anon', 'public.record_safety_evaluation(uuid, text, uuid, uuid, uuid, text, text[], jsonb, text, text, text[], text, boolean)', 'EXECUTE') as record_not_for_anon,
    not has_function_privilege('authenticated', 'public.record_safety_evaluation(uuid, text, uuid, uuid, uuid, text, text[], jsonb, text, text, text[], text, boolean)', 'EXECUTE') as record_not_for_authenticated,
    has_function_privilege('service_role', 'public.record_safety_evaluation(uuid, text, uuid, uuid, uuid, text, text[], jsonb, text, text, text[], text, boolean)', 'EXECUTE') as record_for_service_role,
    not has_function_privilege('authenticated', 'tempa_private.apply_pending_review_restriction(uuid, integer)', 'EXECUTE') as restriction_function_not_client_callable
)
select
  t.*, f.*, c.*, p.*, s.*,
  (
    t.evidence_table_present and t.evidence_rls_enabled and t.evidence_has_no_policies
    and t.evidence_not_readable_by_anon and t.evidence_not_readable_by_authenticated
    and t.notices_table_present and t.notices_rls_enabled and t.notices_select_own_policy and t.notices_not_writable_by_members
    and t.letter_notices_table_present and t.letter_notices_rls_enabled and t.letter_notices_recipient_policy
    and t.letter_notices_not_writable_by_members and t.letter_notices_fk_deferred
    and f.target_key_present and f.hidden_from_discovery_present and f.account_is_banned_present
    and f.restriction_function_present and f.review_rpc_present and f.mark_read_present
    and c.codes_include_intermediary and c.codes_exclude_off_platform
    and c.behavior_counts_evidence and c.behavior_counts_distinct_targets and c.behavior_applies_restriction
    and c.record_writes_evidence and c.record_keeps_42702_repair and c.record_has_no_ambiguous_clause
    and c.consume_blocks_restricted and c.consume_writes_letter_notice
    and c.set_status_writes_notices and c.cleanup_retains_enforced_evidence
    and c.recommendations_exclude_hidden and c.profiles_view_hides_banned
    and c.review_is_staff_gated and c.review_is_audited
    and p.discovery_policy_excludes_hidden
    and s.restriction_function_is_definer and s.review_rpc_is_definer and s.review_rpc_not_for_anon
    and s.record_not_for_anon and s.record_not_for_authenticated and s.record_for_service_role
    and s.restriction_function_not_client_callable
  ) as overall_pass
from tables_check t, function_presence f, definition_check c, policy_check p, security_check s;
