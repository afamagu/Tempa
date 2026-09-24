-- ============================================================
-- TEMPA — SAFETY 2, CHECKPOINT 5: BEHAVIORAL SIGNALS VERIFICATION
-- Run AFTER 2026-10-07-safety-checkpoint5-behavior-signals.sql has been
-- applied (and after 2026-10-03-safety-persistence.sql). Every
-- statement below is a SELECT/has_*_privilege check — no mutation of
-- any kind.
--
-- NOTE: this verifier has NOT been run against a live database — the
-- migration itself has not been executed yet.
-- ============================================================

with
signatures_present_check as (
  select
    to_regprocedure('public.report_content(text, uuid, text, text)') is not null as report_content_present,
    to_regprocedure('public.block_user(uuid, text)') is not null as block_user_present,
    to_regprocedure('tempa_private.evaluate_behavior(uuid, text, text[], boolean, boolean)') is not null as evaluate_behavior_present,
    to_regprocedure('tempa_private.record_behavior_signal(uuid, text, text, interval, jsonb, boolean)') is not null as record_behavior_signal_present,
    to_regprocedure('tempa_private.behavior_policy()') is not null as behavior_policy_present,
    to_regprocedure('tempa_private.outreach_fingerprint(uuid, text)') is not null as outreach_fingerprint_present,
    to_regprocedure('tempa_private.solicitation_reason_codes()') is not null as solicitation_reason_codes_present
),
grant_check as (
  select
    has_function_privilege('authenticated', 'public.report_content(text, uuid, text, text)', 'EXECUTE') as authenticated_can_report_content,
    has_function_privilege('authenticated', 'public.block_user(uuid, text)', 'EXECUTE') as authenticated_can_block_user,
    not has_function_privilege('anon', 'public.report_content(text, uuid, text, text)', 'EXECUTE') as anon_cannot_report_content,
    not has_function_privilege('anon', 'public.block_user(uuid, text)', 'EXECUTE') as anon_cannot_block_user,
    not has_function_privilege('authenticated', 'tempa_private.evaluate_behavior(uuid, text, text[], boolean, boolean)', 'EXECUTE') as authenticated_cannot_call_evaluate_behavior,
    not has_function_privilege('authenticated', 'tempa_private.record_behavior_signal(uuid, text, text, interval, jsonb, boolean)', 'EXECUTE') as authenticated_cannot_call_record_behavior_signal,
    not has_function_privilege('service_role', 'tempa_private.evaluate_behavior(uuid, text, text[], boolean, boolean)', 'EXECUTE') as service_role_not_specifically_granted_evaluate_behavior
),
wiring_semantics_check as (
  select
    coalesce(
      pg_get_functiondef(p1.oid) ilike '%tempa_private.evaluate_behavior(%'
        and pg_get_functiondef(p1.oid) ilike '%p_report_check%',
      false
    ) as report_content_calls_evaluate_behavior,
    coalesce(
      pg_get_functiondef(p2.oid) ilike '%tempa_private.evaluate_behavior(%'
        and pg_get_functiondef(p2.oid) ilike '%p_block_check%',
      false
    ) as block_user_calls_evaluate_behavior,
    coalesce(pg_get_functiondef(p1.oid) ilike '%exception when others then%', false) as report_content_guards_behavior_call,
    coalesce(pg_get_functiondef(p2.oid) ilike '%exception when others then%', false) as block_user_guards_behavior_call
  from (select 1 as anchor) _anchor
  left join pg_proc p1 on p1.oid = to_regprocedure('public.report_content(text, uuid, text, text)')
  left join pg_proc p2 on p2.oid = to_regprocedure('public.block_user(uuid, text)')
),
surface_domain_check as (
  select
    exists (
      select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      where t.relname = 'safety_evaluations'
        and c.contype = 'c'
        and pg_get_constraintdef(c.oid) ilike '%behavior_mass_first_contact%'
        and pg_get_constraintdef(c.oid) ilike '%behavior_account_velocity%'
    ) as surface_check_widened_for_behavior,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'safety_evaluations' and column_name = 'outreach_fingerprint'
    ) as outreach_fingerprint_column_present,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'safety_signals' and column_name = 'observed_counts'
    ) as observed_counts_column_present
)
select
  ss.report_content_present,
  ss.block_user_present,
  ss.evaluate_behavior_present,
  ss.record_behavior_signal_present,
  ss.behavior_policy_present,
  ss.outreach_fingerprint_present,
  ss.solicitation_reason_codes_present,
  g.authenticated_can_report_content,
  g.authenticated_can_block_user,
  g.anon_cannot_report_content,
  g.anon_cannot_block_user,
  g.authenticated_cannot_call_evaluate_behavior,
  g.authenticated_cannot_call_record_behavior_signal,
  g.service_role_not_specifically_granted_evaluate_behavior,
  ws.report_content_calls_evaluate_behavior,
  ws.block_user_calls_evaluate_behavior,
  ws.report_content_guards_behavior_call,
  ws.block_user_guards_behavior_call,
  sd.surface_check_widened_for_behavior,
  sd.outreach_fingerprint_column_present,
  sd.observed_counts_column_present,
  (
    ss.report_content_present and ss.block_user_present and ss.evaluate_behavior_present
    and ss.record_behavior_signal_present and ss.behavior_policy_present
    and ss.outreach_fingerprint_present and ss.solicitation_reason_codes_present
    and g.authenticated_can_report_content and g.authenticated_can_block_user
    and g.anon_cannot_report_content and g.anon_cannot_block_user
    and g.authenticated_cannot_call_evaluate_behavior and g.authenticated_cannot_call_record_behavior_signal
    and g.service_role_not_specifically_granted_evaluate_behavior
    and ws.report_content_calls_evaluate_behavior and ws.block_user_calls_evaluate_behavior
    and ws.report_content_guards_behavior_call and ws.block_user_guards_behavior_call
    and sd.surface_check_widened_for_behavior and sd.outreach_fingerprint_column_present
    and sd.observed_counts_column_present
  ) as overall_pass
from signatures_present_check ss, grant_check g, wiring_semantics_check ws, surface_domain_check sd;
