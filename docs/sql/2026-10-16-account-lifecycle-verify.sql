-- ============================================================
-- TEMPA — ACCOUNT LIFECYCLE VERIFIER (READ-ONLY)
-- Pairs with docs/sql/2026-10-16-account-lifecycle.sql.
-- SELECTs only; changes nothing. Expect one row, overall_pass = true.
-- ============================================================

with fns as (
  select
    to_regprocedure('public.close_my_account(text, text)') as close_fn,
    to_regprocedure('public.deactivate_my_account(text, text)') as deactivate_fn,
    to_regprocedure('public.reactivate_my_account()') as reactivate_fn,
    to_regprocedure('public.my_account_lifecycle()') as lifecycle_fn,
    to_regprocedure('public.current_account_status()') as status_fn,
    to_regprocedure('public.current_account_entry_state(text, text)') as entry_fn,
    to_regprocedure('tempa_private.account_is_closed(uuid)') as closed_fn,
    to_regprocedure('tempa_private.account_is_banned(uuid)') as banned_fn,
    to_regprocedure('tempa_private.hidden_from_discovery(uuid, uuid)') as hidden_fn,
    to_regprocedure('tempa_private.author_content_publicly_visible(uuid)') as visible_fn,
    to_regprocedure('public.close_letter(uuid, text, text)') as close_letter_fn,
    to_regprocedure('public.admin_account_exit_feedback(timestamptz)') as feedback_fn,
    to_regprocedure('public.correspondents_on_break(uuid[])') as on_break_fn,
    to_regprocedure('public.resolve_arrival_email_context(uuid)') as arrival_fn,
    to_regprocedure('public.get_shared_dispatch(uuid)') as shared_fn
),
exec_priv as (
  -- helper: who may execute each lifecycle function
  select
    f.*,
    (select bool_and(not exists (
        select 1 from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = x and a.grantee = 0 and a.privilege_type = 'EXECUTE'))
     from unnest(array[f.close_fn, f.deactivate_fn, f.reactivate_fn, f.lifecycle_fn, f.close_letter_fn,
                       f.feedback_fn, f.on_break_fn, f.closed_fn]::oid[]) x) as no_public_execute
  from fns f
),
tables as (
  select
    to_regclass('public.account_closures') is not null
      and to_regclass('public.account_deactivations') is not null
      and to_regclass('public.letter_close_feedback') is not null as lifecycle_tables_exist,
    coalesce((select bool_and(relrowsecurity) from pg_class where oid in (
      to_regclass('public.account_closures'), to_regclass('public.account_deactivations'), to_regclass('public.letter_close_feedback'))), false) as lifecycle_rls_enabled,
    not exists (select 1 from pg_policies where schemaname = 'public'
      and tablename in ('account_closures', 'account_deactivations', 'letter_close_feedback')) as no_member_policies,
    not exists (
      select 1 from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name in ('account_closures', 'account_deactivations', 'letter_close_feedback')
        and grantee in ('anon', 'authenticated', 'PUBLIC')
    ) as no_member_table_privileges,
    exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'account_deactivations_one_open'
      and indexdef ilike '%unique%' and indexdef ilike '%reactivated_at IS NULL%') as one_open_break_per_member,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'account_closures' and column_name = 'reason_code')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'account_deactivations' and column_name = 'reason_detail') as feedback_columns_exist
),
self_only as (
  select
    e.close_fn is not null and e.deactivate_fn is not null and e.reactivate_fn is not null and e.lifecycle_fn is not null as member_rpcs_exist,
    -- the security invariant: no TARGET account argument on any member lifecycle RPC
    coalesce(pg_get_function_identity_arguments(e.close_fn) = 'p_reason_code text, p_reason_detail text'
      and pg_get_function_identity_arguments(e.deactivate_fn) = 'p_reason_code text, p_reason_detail text'
      and pg_get_function_identity_arguments(e.reactivate_fn) = ''
      and pg_get_function_identity_arguments(e.lifecycle_fn) = '', false) as no_target_account_argument,
    coalesce(pg_get_functiondef(e.close_fn) ilike '%v_uid uuid := auth.uid()%'
      and pg_get_functiondef(e.deactivate_fn) ilike '%v_uid uuid := auth.uid()%'
      and pg_get_functiondef(e.reactivate_fn) ilike '%v_uid uuid := auth.uid()%', false) as self_scoped,
    coalesce(has_function_privilege('authenticated', e.close_fn, 'EXECUTE')
      and has_function_privilege('authenticated', e.deactivate_fn, 'EXECUTE')
      and has_function_privilege('authenticated', e.reactivate_fn, 'EXECUTE'), false) as authenticated_can_call,
    coalesce(not has_function_privilege('anon', e.close_fn, 'EXECUTE')
      and not has_function_privilege('anon', e.deactivate_fn, 'EXECUTE')
      and not has_function_privilege('anon', e.reactivate_fn, 'EXECUTE')
      and not has_function_privilege('anon', e.close_letter_fn, 'EXECUTE')
      and not has_function_privilege('anon', e.feedback_fn, 'EXECUTE'), false) as anon_cannot_call,
    e.no_public_execute,
    coalesce(pg_get_functiondef(e.close_fn) ilike '%from public.staff_roles sr where sr.user_id = v_uid%'
      and pg_get_functiondef(e.deactivate_fn) ilike '%from public.staff_roles sr where sr.user_id = v_uid%', false) as staff_protection,
    -- deactivation never writes Safety enforcement state
    coalesce(not (pg_get_functiondef(e.deactivate_fn) ilike '%account_enforcement_state%')
      and not (pg_get_functiondef(e.reactivate_fn) ilike '%account_enforcement_state%'), false) as deactivation_separate_from_safety,
    coalesce(not (pg_get_functiondef(e.close_fn) ~* '(delete from|update)\s+public\.(reports|safety_cases|safety_evaluations|safety_signals|safety_attempt_evidence|account_enforcement_state|admin_audit_log|legal_acceptances|letters|blocked_users|member_notices)\M'), false) as deletion_retains_safety_and_legal,
    coalesce(position('insert into public.account_closures' in pg_get_functiondef(e.close_fn))
      < position('delete from public.dispatches' in pg_get_functiondef(e.close_fn)), false) as closure_recorded_first,
    coalesce(pg_get_functiondef(e.close_fn) ilike '%where author_id = v_uid and published_as = ''member''%', false) as only_member_dispatches_affected
  from exec_priv e
),
closed_helper as (
  -- Part 5: the private closure helper is internal only
  select
    f.closed_fn is not null as closed_helper_exists,
    coalesce(not has_function_privilege('authenticated', f.closed_fn, 'EXECUTE'), false) as closed_helper_not_authenticated,
    coalesce(not has_function_privilege('anon', f.closed_fn, 'EXECUTE'), false) as closed_helper_not_anon
  from fns f
),
gates as (
  select
    coalesce(pg_get_functiondef(f.status_fn) ilike '%public.account_closures%then ''banned''%'
      and pg_get_functiondef(f.status_fn) ilike '%public.account_deactivations%then ''suspended''%', false) as write_gates_refuse_closed_and_deactivated,
    coalesce(pg_get_functiondef(f.entry_fn) ilike '%public.my_account_lifecycle()%', false) as proxy_sees_real_lifecycle,
    coalesce(pg_get_functiondef(f.banned_fn) ilike '%public.account_closures%', false) as public_profiles_excludes_closed,
    coalesce(pg_get_functiondef(f.hidden_fn) ilike '%public.account_closures%'
      and pg_get_functiondef(f.hidden_fn) ilike '%public.account_deactivations%', false) as discovery_excludes_closed_and_deactivated,
    coalesce(pg_get_functiondef(f.visible_fn) ilike '%public.account_closures%'
      and pg_get_functiondef(f.visible_fn) ilike '%public.account_deactivations%', false) as public_content_hides_closed_and_deactivated,
    coalesce(pg_get_viewdef('public.public_profiles'::regclass) ilike '%account_deactivations%', false) as profiles_view_break_aware,
    coalesce(pg_get_functiondef(f.shared_fn) ilike '%author_content_publicly_visible%', false) as share_links_respect_author_state,
    coalesce(pg_get_functiondef(f.arrival_fn) ilike '%recipient_on_break%'
      and pg_get_functiondef(f.arrival_fn) ilike '%recipient_account_closed%'
      and not (pg_get_functiondef(f.arrival_fn) ~* 'update\s+public\.arrival_email_preferences'), false) as emails_suppressed_preference_kept,
    exists (select 1 from pg_trigger where tgrelid = 'public.correspondences'::regclass
      and tgname = 'correspondences_lifecycle_guard' and tgenabled <> 'D' and not tgisinternal) as no_new_correspondence_with_break_or_closed,
    coalesce((select bool_or(qual ilike '%hidden_from_discovery%') from pg_policies
      where schemaname = 'public' and tablename = 'question_answers' and cmd = 'SELECT'), false) as answers_policy_uses_gate,
    coalesce(pg_get_functiondef(to_regprocedure('public.discover_people(text, text, text, integer, integer)')) ilike '%public.public_profiles%', false) as people_uses_public_profiles,
    coalesce(pg_get_functiondef(to_regprocedure('public.get_member_introductions(integer)')) ilike '%public.public_profiles%', false) as introductions_use_public_profiles,
    coalesce(pg_get_functiondef(to_regprocedure('public.publish_dispatch(text, text, uuid, text[], jsonb, jsonb, boolean)'))
      ilike '%current_account_status() in (''restricted'', ''suspended'', ''banned'')%', false) as publish_dispatch_gated
  from fns f
),
letters_close as (
  select
    exists (select 1 from pg_constraint where conrelid = 'public.letters'::regclass
      and conname = 'letters_closed_fields_consistent' and convalidated
      and pg_get_constraintdef(oid) ilike '%Something else%') as something_else_allowed,
    not (pg_get_viewdef('public.letters_for_participant'::regclass) ilike '%letter_close_feedback%') as private_detail_not_in_participant_view,
    coalesce(pg_get_functiondef(f.close_letter_fn) ilike '%recipient_id = auth.uid()%'
      and pg_get_functiondef(f.close_letter_fn) ilike '%insert into public.letter_close_feedback%'
      and pg_get_functiondef(f.close_letter_fn) ilike '%only accepted with Something else%', false) as close_letter_recipient_scoped_and_private,
    to_regprocedure('public.close_letter(uuid, text)') is null as old_close_letter_removed,
    coalesce(has_function_privilege('authenticated', f.close_letter_fn, 'EXECUTE'), false) as close_letter_authenticated
  from fns f
),
admin_feedback as (
  select
    coalesce(pg_get_functiondef(f.feedback_fn) ilike '%if not public.is_staff() then%', false) as feedback_staff_gated,
    coalesce(not (pg_get_functiondef(f.feedback_fn) ~* '(user_id|recipient_id|email|date_of_birth)''\s*,'), false) as feedback_returns_no_identity,
    coalesce(pg_get_functiondef(f.on_break_fn) ilike '%l.sender_id = auth.uid()%', false) as break_status_only_for_own_correspondents
  from fns f
)
select
  t.*, s.member_rpcs_exist, s.no_target_account_argument, s.self_scoped, s.authenticated_can_call, s.anon_cannot_call,
  s.no_public_execute, s.staff_protection, s.deactivation_separate_from_safety, s.deletion_retains_safety_and_legal,
  s.closure_recorded_first, s.only_member_dispatches_affected,
  c.closed_helper_exists, c.closed_helper_not_authenticated, c.closed_helper_not_anon,
  g.*, l.*, a.*,
  coalesce(
    t.lifecycle_tables_exist and t.lifecycle_rls_enabled and t.no_member_policies and t.no_member_table_privileges
    and t.one_open_break_per_member and t.feedback_columns_exist
    and s.member_rpcs_exist and s.no_target_account_argument and s.self_scoped and s.authenticated_can_call
    and s.anon_cannot_call and s.no_public_execute and s.staff_protection and s.deactivation_separate_from_safety
    and s.deletion_retains_safety_and_legal and s.closure_recorded_first and s.only_member_dispatches_affected
    and c.closed_helper_exists and c.closed_helper_not_authenticated and c.closed_helper_not_anon
    and g.write_gates_refuse_closed_and_deactivated and g.proxy_sees_real_lifecycle and g.public_profiles_excludes_closed
    and g.discovery_excludes_closed_and_deactivated and g.public_content_hides_closed_and_deactivated
    and g.profiles_view_break_aware and g.share_links_respect_author_state and g.emails_suppressed_preference_kept
    and g.no_new_correspondence_with_break_or_closed and g.answers_policy_uses_gate and g.people_uses_public_profiles
    and g.introductions_use_public_profiles and g.publish_dispatch_gated
    and l.something_else_allowed and l.private_detail_not_in_participant_view and l.close_letter_recipient_scoped_and_private
    and l.old_close_letter_removed and l.close_letter_authenticated
    and a.feedback_staff_gated and a.feedback_returns_no_identity and a.break_status_only_for_own_correspondents,
    false
  ) as overall_pass
from tables t, self_only s, closed_helper c, gates g, letters_close l, admin_feedback a;
