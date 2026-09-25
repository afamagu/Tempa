-- ============================================================
-- TEMPA — ACCOUNT DELETION VERIFIER (READ-ONLY)
-- Pairs with docs/sql/2026-10-16-account-deletion.sql.
-- SELECTs only; changes nothing. Expect one row, overall_pass = true.
-- ============================================================

with fns as (
  select
    to_regprocedure('public.close_my_account()') as close_fn,
    to_regprocedure('public.current_account_status()') as status_fn,
    to_regprocedure('tempa_private.account_is_banned(uuid)') as banned_fn,
    to_regprocedure('tempa_private.hidden_from_discovery(uuid, uuid)') as hidden_fn,
    to_regprocedure('tempa_private.author_content_publicly_visible(uuid)') as visible_fn,
    to_regprocedure('tempa_private.account_is_closed(uuid)') as closed_fn
),
state as (
  select
    to_regclass('public.account_closures') is not null as closure_table_exists,
    coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.account_closures')), false) as closure_rls_enabled,
    not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'account_closures') as closure_no_member_policies,
    not has_table_privilege('authenticated', 'public.account_closures', 'SELECT')
      and not has_table_privilege('authenticated', 'public.account_closures', 'INSERT')
      and not has_table_privilege('authenticated', 'public.account_closures', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.account_closures', 'DELETE')
      and not has_table_privilege('anon', 'public.account_closures', 'SELECT') as closure_no_member_privileges
),
rpc as (
  select
    f.close_fn is not null as close_fn_exists,
    coalesce(pg_get_function_identity_arguments(f.close_fn) = '', false) as close_fn_takes_no_target,
    coalesce((select prosecdef from pg_proc where oid = f.close_fn), false) as close_fn_definer,
    coalesce((select proconfig @> array['search_path=pg_catalog'] from pg_proc where oid = f.close_fn), false) as close_fn_search_path,
    coalesce(pg_get_functiondef(f.close_fn) ilike '%v_uid uuid := auth.uid()%'
      and pg_get_functiondef(f.close_fn) ilike '%if v_uid is null then%', false) as close_fn_self_scoped,
    coalesce(has_function_privilege('authenticated', f.close_fn, 'EXECUTE'), false) as authenticated_can_close,
    coalesce(not has_function_privilege('anon', f.close_fn, 'EXECUTE'), false) as anon_cannot_close,
    not exists (
      select 1 from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = f.close_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) as public_cannot_close,
    -- staff / official-content protection
    coalesce(pg_get_functiondef(f.close_fn) ilike '%from public.staff_roles sr where sr.user_id = v_uid%'
      and pg_get_functiondef(f.close_fn) ilike '%d.published_as <> ''member''%', false) as staff_protection,
    -- ACTIVE -> CLOSED is written before any destructive statement
    coalesce(
      position('insert into public.account_closures' in pg_get_functiondef(f.close_fn))
        < position('delete from public.dispatches' in pg_get_functiondef(f.close_fn)),
      false
    ) as closure_recorded_first,
    -- retained records are never touched by the deletion function
    coalesce(not (pg_get_functiondef(f.close_fn) ~* '(delete from|update)\s+public\.(reports|safety_cases|safety_evaluations|safety_signals|safety_attempt_evidence|account_enforcement_state|admin_audit_log|legal_acceptances|letters|blocked_users|member_notices)\M'), false) as safety_and_legal_records_untouched,
    -- only member Dispatches are ever deleted/unpublished
    coalesce(pg_get_functiondef(f.close_fn) ilike '%and d.published_as = ''member''%'
      and pg_get_functiondef(f.close_fn) ilike '%where author_id = v_uid and published_as = ''member''%', false) as only_member_dispatches_affected
  from fns f
),
gates as (
  select
    coalesce(pg_get_functiondef(f.status_fn) ilike '%from public.account_closures c where c.user_id = auth.uid()) then ''banned''%', false) as closed_caller_gated_like_ban,
    coalesce(pg_get_functiondef(f.banned_fn) ilike '%public.account_closures%', false) as public_profiles_excludes_closed,
    coalesce(pg_get_functiondef(f.hidden_fn) ilike '%public.account_closures%', false) as discovery_excludes_closed,
    coalesce(pg_get_functiondef(f.visible_fn) ilike '%public.account_closures%', false) as public_content_hides_closed,
    f.closed_fn is not null as closed_helper_exists,
    -- the discovery / introductions surfaces still read those gated sources
    coalesce((select bool_or(qual ilike '%hidden_from_discovery%') from pg_policies
      where schemaname = 'public' and tablename = 'question_answers' and cmd = 'SELECT'), false) as answers_policy_uses_gate,
    coalesce((select pg_get_viewdef('public.public_profiles'::regclass) ilike '%account_is_banned%'), false) as public_profiles_uses_gate,
    coalesce(pg_get_functiondef(to_regprocedure('public.discover_people(text, text, text, integer, integer)')) ilike '%public.public_profiles%', false) as people_uses_public_profiles,
    coalesce(pg_get_functiondef(to_regprocedure('public.get_member_introductions(integer)')) ilike '%public.public_profiles%', false) as introductions_use_public_profiles
  from fns f
),
writes as (
  -- ordinary member write RPCs still refuse any caller current_account_status() reports as banned
  select
    coalesce(pg_get_functiondef(to_regprocedure('public.publish_dispatch(text, text, uuid, text[], jsonb, jsonb, boolean)'))
      ilike '%current_account_status() in (''restricted'', ''suspended'', ''banned'')%', false) as publish_dispatch_rejects_closed,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and pg_get_functiondef(p.oid) ilike '%current_account_status() in (''restricted'', ''suspended'', ''banned'')%') >= 2 as write_gates_present,
    -- members cannot write the closure state or insert Dispatches directly
    -- (both RPC-only); the migration grants no table privilege at all
    not has_table_privilege('authenticated', 'public.dispatches', 'INSERT')
      and not has_table_privilege('authenticated', 'public.account_closures', 'DELETE')
      and not has_table_privilege('authenticated', 'public.account_closures', 'UPDATE') as no_direct_destructive_writes
)
select
  s.closure_table_exists, s.closure_rls_enabled, s.closure_no_member_policies, s.closure_no_member_privileges,
  r.close_fn_exists, r.close_fn_takes_no_target, r.close_fn_definer, r.close_fn_search_path, r.close_fn_self_scoped,
  r.authenticated_can_close, r.anon_cannot_close, r.public_cannot_close, r.staff_protection, r.closure_recorded_first,
  r.safety_and_legal_records_untouched, r.only_member_dispatches_affected,
  g.closed_caller_gated_like_ban, g.public_profiles_excludes_closed, g.discovery_excludes_closed,
  g.public_content_hides_closed, g.closed_helper_exists, g.answers_policy_uses_gate, g.public_profiles_uses_gate,
  g.people_uses_public_profiles, g.introductions_use_public_profiles,
  w.publish_dispatch_rejects_closed, w.write_gates_present, w.no_direct_destructive_writes,
  coalesce(
    s.closure_table_exists and s.closure_rls_enabled and s.closure_no_member_policies and s.closure_no_member_privileges
    and r.close_fn_exists and r.close_fn_takes_no_target and r.close_fn_definer and r.close_fn_search_path
    and r.close_fn_self_scoped and r.authenticated_can_close and r.anon_cannot_close and r.public_cannot_close
    and r.staff_protection and r.closure_recorded_first and r.safety_and_legal_records_untouched
    and r.only_member_dispatches_affected
    and g.closed_caller_gated_like_ban and g.public_profiles_excludes_closed and g.discovery_excludes_closed
    and g.public_content_hides_closed and g.closed_helper_exists and g.answers_policy_uses_gate
    and g.public_profiles_uses_gate and g.people_uses_public_profiles and g.introductions_use_public_profiles
    and w.publish_dispatch_rejects_closed and w.write_gates_present and w.no_direct_destructive_writes,
    false
  ) as overall_pass
from state s, rpc r, gates g, writes w;
