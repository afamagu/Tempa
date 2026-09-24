-- ============================================================
-- TEMPA — SAFETY 2, CHECKPOINT 7: ADMIN NEEDS ATTENTION VERIFICATION
-- Run AFTER 2026-10-08-safety-checkpoint7-admin-needs-attention.sql has
-- been applied (and after every earlier Safety migration). Every
-- statement below is a SELECT/has_*_privilege check — no mutation of
-- any kind.
--
-- NOTE: this verifier has NOT been run against a live database — the
-- migration itself has not been executed yet.
-- ============================================================

with
signatures_present_check as (
  select
    to_regprocedure('public.admin_list_safety_cases(text, integer, integer)') is not null as list_cases_present,
    to_regprocedure('public.admin_get_safety_case(uuid)') is not null as get_case_present,
    to_regprocedure('public.admin_list_case_signals(uuid)') is not null as list_signals_present,
    to_regprocedure('public.admin_get_safety_signal_evidence(uuid, uuid)') is not null as get_evidence_present,
    to_regprocedure('public.admin_transition_safety_case(uuid, text, text, text)') is not null as transition_case_present
),
grant_check as (
  select
    has_function_privilege('authenticated', 'public.admin_list_safety_cases(text, integer, integer)', 'EXECUTE') as authenticated_can_call_list_cases,
    has_function_privilege('authenticated', 'public.admin_get_safety_case(uuid)', 'EXECUTE') as authenticated_can_call_get_case,
    has_function_privilege('authenticated', 'public.admin_list_case_signals(uuid)', 'EXECUTE') as authenticated_can_call_list_signals,
    has_function_privilege('authenticated', 'public.admin_get_safety_signal_evidence(uuid, uuid)', 'EXECUTE') as authenticated_can_call_get_evidence,
    has_function_privilege('authenticated', 'public.admin_transition_safety_case(uuid, text, text, text)', 'EXECUTE') as authenticated_can_call_transition,
    not has_function_privilege('anon', 'public.admin_list_safety_cases(text, integer, integer)', 'EXECUTE') as anon_cannot_call_list_cases,
    not has_function_privilege('anon', 'public.admin_get_safety_signal_evidence(uuid, uuid)', 'EXECUTE') as anon_cannot_call_get_evidence,
    not has_function_privilege('anon', 'public.admin_transition_safety_case(uuid, text, text, text)', 'EXECUTE') as anon_cannot_call_transition
),
-- The load-bearing guarantee (item 10): granting EXECUTE to
-- `authenticated` is only ever the outer ceiling — is_staff() inside
-- each function body is the actual gate. This check proves that gate
-- is textually present in every one of the five new functions, not
-- merely that a grant exists (a grant alone would let ANY authenticated
-- member call these).
staff_gate_check as (
  select
    coalesce(pg_get_functiondef(p1.oid) ilike '%if not public.is_staff() then%', false) as list_cases_checks_is_staff,
    coalesce(pg_get_functiondef(p2.oid) ilike '%if not public.is_staff() then%', false) as get_case_checks_is_staff,
    coalesce(pg_get_functiondef(p3.oid) ilike '%if not public.is_staff() then%', false) as list_signals_checks_is_staff,
    coalesce(pg_get_functiondef(p4.oid) ilike '%if not public.is_staff() then%', false) as get_evidence_checks_is_staff,
    coalesce(pg_get_functiondef(p5.oid) ilike '%if not public.is_staff() then%', false) as transition_checks_is_staff
  from (select 1 as anchor) _anchor
  left join pg_proc p1 on p1.oid = to_regprocedure('public.admin_list_safety_cases(text, integer, integer)')
  left join pg_proc p2 on p2.oid = to_regprocedure('public.admin_get_safety_case(uuid)')
  left join pg_proc p3 on p3.oid = to_regprocedure('public.admin_list_case_signals(uuid)')
  left join pg_proc p4 on p4.oid = to_regprocedure('public.admin_get_safety_signal_evidence(uuid, uuid)')
  left join pg_proc p5 on p5.oid = to_regprocedure('public.admin_transition_safety_case(uuid, text, text, text)')
),
-- The private-table-grant guarantee (item 10): safety_cases/
-- safety_signals/safety_evaluations must STILL have zero client SELECT
-- grant — this file's own RPCs are SECURITY DEFINER and bypass RLS as
-- their owner, so they need no table grant at all to work correctly.
no_direct_grant_check as (
  select
    not has_table_privilege('authenticated', 'public.safety_cases', 'SELECT') as authenticated_cannot_select_cases,
    not has_table_privilege('authenticated', 'public.safety_signals', 'SELECT') as authenticated_cannot_select_signals,
    not has_table_privilege('authenticated', 'public.safety_evaluations', 'SELECT') as authenticated_cannot_select_evaluations,
    not has_table_privilege('anon', 'public.safety_cases', 'SELECT') as anon_cannot_select_cases,
    not has_table_privilege('anon', 'public.safety_signals', 'SELECT') as anon_cannot_select_signals
),
evidence_wiring_check as (
  select
    coalesce(
      pg_get_functiondef(p.oid) ilike '%insert into public.admin_audit_log%'
        and pg_get_functiondef(p.oid) ilike '%''view_safety_evidence''%',
      false
    ) as evidence_view_is_audited,
    -- No parameter anywhere in this function's signature accepts a raw
    -- content id — the ONLY inputs are the case id and the signal id,
    -- per the independent-audit correction requiring the full case ->
    -- signal -> content chain (never merely "does this signal id exist").
    coalesce(pg_get_function_arguments(p.oid) = 'p_case_id uuid, p_signal_id uuid', false) as evidence_takes_only_case_and_signal_id,
    -- The actual fix: the signal lookup requires case_id = p_case_id in
    -- the same WHERE clause as the signal id — a signal with a null
    -- case_id or a different case's id can never match.
    coalesce(pg_get_functiondef(p.oid) ilike '%where id = p_signal_id%and case_id = p_case_id%', false) as evidence_requires_case_signal_match,
    coalesce(pg_get_functiondef(p.oid) ilike '%case not found%', false) as evidence_verifies_case_exists
  from (select 1 as anchor) _anchor
  left join pg_proc p on p.oid = to_regprocedure('public.admin_get_safety_signal_evidence(uuid, uuid)')
),
transition_wiring_check as (
  select
    coalesce(pg_get_functiondef(p.oid) ilike '%for update%', false) as locks_case_row,
    coalesce(pg_get_functiondef(p.oid) ilike '%is distinct from p_expected_status%', false) as null_safe_staleness_check,
    coalesce(pg_get_functiondef(p.oid) ilike '%insert into public.admin_audit_log%', false) as transition_is_audited,
    coalesce(
      pg_get_functiondef(p.oid) not ilike '%''warned''%'
        and pg_get_functiondef(p.oid) not ilike '%''restricted''%'
        and pg_get_functiondef(p.oid) not ilike '%''suspended''%'
        and pg_get_functiondef(p.oid) not ilike '%''banned''%',
      true
    ) as never_sets_checkpoint8_statuses
  from (select 1 as anchor) _anchor
  left join pg_proc p on p.oid = to_regprocedure('public.admin_transition_safety_case(uuid, text, text, text)')
)
select
  ss.list_cases_present, ss.get_case_present, ss.list_signals_present, ss.get_evidence_present, ss.transition_case_present,
  g.authenticated_can_call_list_cases, g.authenticated_can_call_get_case, g.authenticated_can_call_list_signals,
  g.authenticated_can_call_get_evidence, g.authenticated_can_call_transition,
  g.anon_cannot_call_list_cases, g.anon_cannot_call_get_evidence, g.anon_cannot_call_transition,
  sg.list_cases_checks_is_staff, sg.get_case_checks_is_staff, sg.list_signals_checks_is_staff,
  sg.get_evidence_checks_is_staff, sg.transition_checks_is_staff,
  ng.authenticated_cannot_select_cases, ng.authenticated_cannot_select_signals, ng.authenticated_cannot_select_evaluations,
  ng.anon_cannot_select_cases, ng.anon_cannot_select_signals,
  ew.evidence_view_is_audited, ew.evidence_takes_only_case_and_signal_id,
  ew.evidence_requires_case_signal_match, ew.evidence_verifies_case_exists,
  tw.locks_case_row, tw.null_safe_staleness_check, tw.transition_is_audited, tw.never_sets_checkpoint8_statuses,
  (
    ss.list_cases_present and ss.get_case_present and ss.list_signals_present and ss.get_evidence_present and ss.transition_case_present
    and g.authenticated_can_call_list_cases and g.authenticated_can_call_get_case and g.authenticated_can_call_list_signals
    and g.authenticated_can_call_get_evidence and g.authenticated_can_call_transition
    and g.anon_cannot_call_list_cases and g.anon_cannot_call_get_evidence and g.anon_cannot_call_transition
    and sg.list_cases_checks_is_staff and sg.get_case_checks_is_staff and sg.list_signals_checks_is_staff
    and sg.get_evidence_checks_is_staff and sg.transition_checks_is_staff
    and ng.authenticated_cannot_select_cases and ng.authenticated_cannot_select_signals and ng.authenticated_cannot_select_evaluations
    and ng.anon_cannot_select_cases and ng.anon_cannot_select_signals
    and ew.evidence_view_is_audited and ew.evidence_takes_only_case_and_signal_id
    and ew.evidence_requires_case_signal_match and ew.evidence_verifies_case_exists
    and tw.locks_case_row and tw.null_safe_staleness_check and tw.transition_is_audited and tw.never_sets_checkpoint8_statuses
  ) as overall_pass
from signatures_present_check ss, grant_check g, staff_gate_check sg, no_direct_grant_check ng,
     evidence_wiring_check ew, transition_wiring_check tw;
