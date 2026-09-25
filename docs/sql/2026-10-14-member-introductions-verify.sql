-- ============================================================
-- TEMPA — MEMBER INTRODUCTIONS VERIFIER (READ-ONLY)
-- Pairs with docs/sql/2026-10-14-member-introductions.sql.
-- Contains only SELECTs against the catalog; changes nothing.
-- Expect a single row with overall_pass = true.
-- ============================================================

with fns as (
  select
    to_regprocedure('public.get_member_introductions(integer)') as get_fn,
    to_regprocedure('public.mark_member_introduction_presented(uuid)') as presented_fn,
    to_regprocedure('public.consume_member_introduction(uuid, text)') as consume_fn,
    to_regprocedure('tempa_private.member_introduction_newcomer_ids()') as newcomer_fn
),
tables as (
  select
    to_regclass('public.member_introduction_state') is not null as state_exists,
    to_regclass('public.member_introduction_history') is not null as history_exists,
    coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.member_introduction_state')), false) as state_rls,
    coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.member_introduction_history')), false) as history_rls
),
policies as (
  -- every policy on both tables is scoped to the caller's own viewer_id
  -- and applies to authenticated only
  select
    count(*) filter (where tablename = 'member_introduction_state') = 2 as state_policy_count_ok,
    count(*) filter (where tablename = 'member_introduction_history') = 3 as history_policy_count_ok,
    bool_and(
      coalesce(qual, '') || coalesce(with_check, '') ilike '%viewer_id = auth.uid()%'
      and roles = array['authenticated']::name[]
    ) as all_policies_own_viewer,
    not bool_or(cmd = 'DELETE' or cmd = 'ALL') as no_delete_or_all_policy
  from pg_policies
  where schemaname = 'public'
    and tablename in ('member_introduction_state', 'member_introduction_history')
),
table_grants as (
  select
    not has_table_privilege('anon', 'public.member_introduction_state', 'SELECT') as anon_no_state,
    not has_table_privilege('anon', 'public.member_introduction_history', 'SELECT') as anon_no_history,
    not has_table_privilege('authenticated', 'public.member_introduction_history', 'DELETE') as auth_no_history_delete,
    not has_table_privilege('authenticated', 'public.member_introduction_state', 'UPDATE') as auth_no_state_update
),
fn_shape as (
  select
    f.get_fn is not null and f.presented_fn is not null and f.consume_fn is not null and f.newcomer_fn is not null as all_present,
    -- no viewer-id argument anywhere
    pg_get_function_identity_arguments(f.get_fn) = 'p_limit integer'
      and pg_get_function_identity_arguments(f.presented_fn) = 'p_candidate_id uuid'
      and pg_get_function_identity_arguments(f.consume_fn) = 'p_candidate_id uuid, p_reason text'
      and pg_get_function_identity_arguments(f.newcomer_fn) = '' as no_viewer_argument,
    pg_get_functiondef(f.get_fn) ilike '%least(greatest(coalesce(p_limit, 7), 1), 7)%' as limit_clamped_to_7,
    (select not p.prosecdef from pg_proc p where p.oid = f.get_fn)
      and (select not p.prosecdef from pg_proc p where p.oid = f.presented_fn)
      and (select not p.prosecdef from pg_proc p where p.oid = f.consume_fn) as public_fns_security_invoker,
    (select p.prosecdef from pg_proc p where p.oid = f.newcomer_fn) as newcomer_helper_definer,
    (select coalesce(bool_and(p.proconfig @> array['search_path=pg_catalog']), false)
       from pg_proc p where p.oid in (f.get_fn, f.presented_fn, f.consume_fn, f.newcomer_fn)) as search_path_pinned,
    pg_get_functiondef(f.presented_fn) ilike '%values (auth.uid(), p_candidate_id%'
      and pg_get_functiondef(f.consume_fn) ilike '%values (auth.uid(), p_candidate_id%' as mutations_self_scoped,
    pg_get_functiondef(f.newcomer_fn) ilike '%s.viewer_id = auth.uid()%' as newcomer_helper_self_scoped,
    -- eligibility comes from the current Safety/discovery surfaces
    pg_get_functiondef(f.get_fn) ilike '%public.public_profiles%'
      and pg_get_functiondef(f.get_fn) ilike '%public.question_answers%'
      and pg_get_functiondef(f.get_fn) ilike '%public.letters_for_participant%'
      and pg_get_functiondef(f.get_fn) ilike '%public.correspondences%'
      and pg_get_functiondef(f.get_fn) ilike '%moderation_status = ''visible''%' as uses_discovery_surfaces,
    -- Reading Interests are never a matching input
    not (pg_get_functiondef(f.get_fn) ilike '%interest%') as no_reading_interests
  from fns f
),
fn_grants as (
  select
    has_function_privilege('authenticated', f.get_fn, 'EXECUTE')
      and has_function_privilege('authenticated', f.presented_fn, 'EXECUTE')
      and has_function_privilege('authenticated', f.consume_fn, 'EXECUTE') as authenticated_can_execute,
    not has_function_privilege('anon', f.get_fn, 'EXECUTE')
      and not has_function_privilege('anon', f.presented_fn, 'EXECUTE')
      and not has_function_privilege('anon', f.consume_fn, 'EXECUTE') as anon_cannot_execute,
    not exists (
      select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid in (f.get_fn, f.presented_fn, f.consume_fn, f.newcomer_fn)
        and a.grantee = 0
        and a.privilege_type = 'EXECUTE'
    ) as public_execute_revoked
  from fns f
),
safety_policy as (
  -- the question_answers RLS policy the retrieval relies on still carries
  -- the Phase 1 block + hidden_from_discovery checks
  select coalesce(bool_or(pol.qual ilike '%is_blocked_pair%' and pol.qual ilike '%hidden_from_discovery%'), false)
    as answers_policy_enforces_safety
  from pg_policies pol
  where pol.schemaname = 'public' and pol.tablename = 'question_answers' and pol.cmd = 'SELECT'
),
idx as (
  select
    exists (
      select 1 from pg_indexes i
      where i.schemaname = 'public' and i.tablename = 'member_introduction_history'
        and i.indexdef ilike '%(viewer_id, candidate_id)%' and i.indexdef ilike '%unique%'
    ) as history_viewer_candidate_unique,
    exists (
      select 1 from pg_indexes i
      where i.schemaname = 'public' and i.tablename = 'member_introduction_history'
        and i.indexname = 'member_introduction_history_candidate_idx'
    ) as history_candidate_idx
)
select
  t.state_exists, t.history_exists, t.state_rls, t.history_rls,
  p.state_policy_count_ok, p.history_policy_count_ok, p.all_policies_own_viewer, p.no_delete_or_all_policy,
  g.anon_no_state, g.anon_no_history, g.auth_no_history_delete, g.auth_no_state_update,
  s.all_present, s.no_viewer_argument, s.limit_clamped_to_7, s.public_fns_security_invoker,
  s.newcomer_helper_definer, s.search_path_pinned, s.mutations_self_scoped, s.newcomer_helper_self_scoped,
  s.uses_discovery_surfaces, s.no_reading_interests,
  fg.authenticated_can_execute, fg.anon_cannot_execute, fg.public_execute_revoked,
  sp.answers_policy_enforces_safety,
  i.history_viewer_candidate_unique, i.history_candidate_idx,
  coalesce(
    t.state_exists and t.history_exists and t.state_rls and t.history_rls
    and p.state_policy_count_ok and p.history_policy_count_ok and p.all_policies_own_viewer and p.no_delete_or_all_policy
    and g.anon_no_state and g.anon_no_history and g.auth_no_history_delete and g.auth_no_state_update
    and s.all_present and s.no_viewer_argument and s.limit_clamped_to_7 and s.public_fns_security_invoker
    and s.newcomer_helper_definer and s.search_path_pinned and s.mutations_self_scoped and s.newcomer_helper_self_scoped
    and s.uses_discovery_surfaces and s.no_reading_interests
    and fg.authenticated_can_execute and fg.anon_cannot_execute and fg.public_execute_revoked
    and sp.answers_policy_enforces_safety
    and i.history_viewer_candidate_unique and i.history_candidate_idx,
    false
  ) as overall_pass
from tables t, policies p, table_grants g, fn_shape s, fn_grants fg, safety_policy sp, idx i;
