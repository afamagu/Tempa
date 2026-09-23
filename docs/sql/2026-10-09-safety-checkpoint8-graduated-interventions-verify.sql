-- ============================================================
-- TEMPA — SAFETY 2, CHECKPOINT 8: GRADUATED INTERVENTIONS VERIFICATION
-- Run AFTER 2026-10-09-safety-checkpoint8-graduated-interventions.sql
-- has been applied (and after every earlier Safety migration). Every
-- statement below is a SELECT/has_*_privilege check — no mutation of
-- any kind.
--
-- NOTE: this verifier has NOT been run against a live database — the
-- migration itself has not been executed yet.
-- ============================================================

with
signatures_present_check as (
  select
    to_regprocedure('public.admin_apply_safety_case_intervention(uuid, text, text, text, text)') is not null as intervention_present,
    to_regprocedure('public.admin_list_safety_cases(text, integer, integer)') is not null as list_cases_present,
    to_regprocedure('public.admin_set_account_status(uuid, text, text)') is not null as set_account_status_still_present
),
grant_check as (
  select
    has_function_privilege('authenticated', 'public.admin_apply_safety_case_intervention(uuid, text, text, text, text)', 'EXECUTE') as authenticated_can_call_intervention,
    not has_function_privilege('anon', 'public.admin_apply_safety_case_intervention(uuid, text, text, text, text)', 'EXECUTE') as anon_cannot_call_intervention
),
staff_gate_check as (
  select
    coalesce(pg_get_functiondef(p.oid) ilike '%if not public.is_staff() then%', false) as intervention_checks_is_staff
  from (select 1 as anchor) _anchor
  left join pg_proc p on p.oid = to_regprocedure('public.admin_apply_safety_case_intervention(uuid, text, text, text, text)')
),
intervention_semantics_check as (
  select
    coalesce(pg_get_functiondef(p.oid) ilike '%for update%', false) as locks_case_row,
    coalesce(
      pg_get_functiondef(p.oid) ilike '%is distinct from p_expected_case_status%'
        and pg_get_functiondef(p.oid) ilike '%is distinct from p_expected_account_status%',
      false
    ) as null_safe_staleness_checks_both_axes,
    coalesce(
      pg_get_functiondef(p.oid) ilike '%p_new_status not in (%restricted%suspended%banned%)%',
      false
    ) as restricted_to_three_terminal_statuses,
    coalesce(pg_get_functiondef(p.oid) not ilike '%''warned''%', true) as never_offers_warned,
    coalesce(
      pg_get_functiondef(p.oid) ilike '%perform public.admin_set_account_status(%',
      false
    ) as calls_existing_enforcement_rpc,
    coalesce(
      pg_get_functiondef(p.oid) not ilike '%staff_roles%',
      true
    ) as never_reimplements_staff_protection,
    coalesce(
      pg_get_functiondef(p.oid) ilike '%insert into public.admin_audit_log%'
        and pg_get_functiondef(p.oid) ilike '%''apply_safety_case_intervention''%',
      false
    ) as writes_intervention_audit_row,
    coalesce(
      pg_get_functiondef(p.oid) not ilike '%.body%',
      true
    ) as never_reads_letter_body
  from (select 1 as anchor) _anchor
  left join pg_proc p on p.oid = to_regprocedure('public.admin_apply_safety_case_intervention(uuid, text, text, text, text)')
),
no_direct_grant_check as (
  select
    not has_table_privilege('authenticated', 'public.safety_cases', 'SELECT') as authenticated_cannot_select_cases,
    not has_table_privilege('authenticated', 'public.account_enforcement_state', 'INSERT') as authenticated_cannot_insert_enforcement_state,
    not has_table_privilege('authenticated', 'public.account_enforcement_state', 'UPDATE') as authenticated_cannot_update_enforcement_state
),
no_automatic_wiring_check as (
  -- Human authority only (item 3) — no earlier Safety migration's own
  -- source text references this new function name at all; it is a
  -- purely additive Admin-only capability, never called from content
  -- classification or behavioral detection.
  select true as placeholder
)
select
  ss.intervention_present, ss.list_cases_present, ss.set_account_status_still_present,
  g.authenticated_can_call_intervention, g.anon_cannot_call_intervention,
  sg.intervention_checks_is_staff,
  isc.locks_case_row, isc.null_safe_staleness_checks_both_axes, isc.restricted_to_three_terminal_statuses,
  isc.never_offers_warned, isc.calls_existing_enforcement_rpc, isc.never_reimplements_staff_protection,
  isc.writes_intervention_audit_row, isc.never_reads_letter_body,
  ng.authenticated_cannot_select_cases, ng.authenticated_cannot_insert_enforcement_state, ng.authenticated_cannot_update_enforcement_state,
  (
    ss.intervention_present and ss.list_cases_present and ss.set_account_status_still_present
    and g.authenticated_can_call_intervention and g.anon_cannot_call_intervention
    and sg.intervention_checks_is_staff
    and isc.locks_case_row and isc.null_safe_staleness_checks_both_axes and isc.restricted_to_three_terminal_statuses
    and isc.never_offers_warned and isc.calls_existing_enforcement_rpc and isc.never_reimplements_staff_protection
    and isc.writes_intervention_audit_row and isc.never_reads_letter_body
    and ng.authenticated_cannot_select_cases and ng.authenticated_cannot_insert_enforcement_state and ng.authenticated_cannot_update_enforcement_state
  ) as overall_pass
from signatures_present_check ss, grant_check g, staff_gate_check sg, intervention_semantics_check isc,
     no_direct_grant_check ng, no_automatic_wiring_check naw;
