-- ============================================================
-- TEMPA — PRE-LAUNCH PERFORMANCE VERIFIER (READ-ONLY)
-- Pairs with docs/sql/2026-10-13-prelaunch-performance.sql.
-- Contains only SELECTs against the catalog; changes nothing.
-- Expect a single row with overall_pass = true.
-- ============================================================

with entry_fn as (
  select
    p.oid is not null as present,
    coalesce(not p.prosecdef, false) as security_invoker,
    coalesce(p.proconfig @> array['search_path=pg_catalog'], false) as pinned_search_path,
    -- every table read is keyed to the CALLER; there is no user-id argument
    coalesce(
      pg_get_function_identity_arguments(p.oid) = 'p_terms_version text, p_guidelines_version text',
      false
    ) as no_user_id_argument,
    coalesce(
      (length(pg_get_functiondef(p.oid)) - length(replace(pg_get_functiondef(p.oid), '= auth.uid()', ''))) / length('= auth.uid()') >= 5,
      false
    ) as every_read_self_scoped,
    coalesce(pg_get_functiondef(p.oid) ilike '%public.current_account_status()%', false) as status_from_existing_rpc
  from (select 1) _a
  left join pg_proc p on p.oid = to_regprocedure('public.current_account_entry_state(text, text)')
),
discover_fn as (
  select
    p.oid is not null as present,
    coalesce(not p.prosecdef, false) as security_invoker,
    coalesce(p.proconfig @> array['search_path=pg_catalog'], false) as pinned_search_path,
    -- reads only the existing RLS / block-aware surfaces
    coalesce(pg_get_functiondef(p.oid) ilike '%public.public_profiles%', false) as uses_public_profiles,
    coalesce(pg_get_functiondef(p.oid) ilike '%public.question_answers%', false) as uses_question_answers,
    coalesce(pg_get_functiondef(p.oid) ilike '%public.letters_for_participant%', false) as uses_letters_for_participant,
    coalesce(pg_get_functiondef(p.oid) ilike '%moderation_status = ''visible''%', false) as visible_only,
    coalesce(pg_get_functiondef(p.oid) ilike '%least(greatest(coalesce(p_limit, 6), 1), 24)%', false) as page_size_clamped,
    coalesce(pg_get_functiondef(p.oid) !~* 'random\(\)', false) as no_random_sort
  from (select 1) _a
  left join pg_proc p on p.oid = to_regprocedure('public.discover_people(text, text, text, integer, integer)')
),
visibility_policy as (
  -- the question_answers RLS policy discover_people relies on is still
  -- the Phase 1 one (block + hidden_from_discovery)
  select coalesce(bool_or(
    pol.qual ilike '%is_blocked_pair%' and pol.qual ilike '%hidden_from_discovery%'
  ), false) as answers_policy_enforces_safety
  from pg_policies pol
  where pol.schemaname = 'public'
    and pol.tablename = 'question_answers'
    and pol.cmd = 'SELECT'
),
grants as (
  select
    has_function_privilege('authenticated', 'public.current_account_entry_state(text, text)', 'EXECUTE') as entry_authenticated,
    not has_function_privilege('anon', 'public.current_account_entry_state(text, text)', 'EXECUTE') as entry_not_anon,
    has_function_privilege('authenticated', 'public.discover_people(text, text, text, integer, integer)', 'EXECUTE') as discover_authenticated,
    not has_function_privilege('anon', 'public.discover_people(text, text, text, integer, integer)', 'EXECUTE') as discover_not_anon,
    not exists (
      select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid in (
          to_regprocedure('public.current_account_entry_state(text, text)'),
          to_regprocedure('public.discover_people(text, text, text, integer, integer)')
        )
        and a.grantee = 0 -- PUBLIC
        and a.privilege_type = 'EXECUTE'
    ) as no_public_execute
),
idx as (
  select exists (
    select 1 from pg_indexes i
    where i.schemaname = 'public'
      and i.tablename = 'correspondences'
      and i.indexname = 'correspondences_active_participant_high_idx'
      and i.indexdef ilike '%(participant_high)%'
      and i.indexdef ilike '%status = ''active''%'
  ) as participant_high_index_present
)
select
  e.present as entry_fn_present,
  e.security_invoker as entry_fn_security_invoker,
  e.pinned_search_path as entry_fn_search_path,
  e.no_user_id_argument as entry_fn_no_user_id_argument,
  e.every_read_self_scoped as entry_fn_self_scoped,
  e.status_from_existing_rpc as entry_fn_status_from_current_account_status,
  d.present as discover_fn_present,
  d.security_invoker as discover_fn_security_invoker,
  d.pinned_search_path as discover_fn_search_path,
  d.uses_public_profiles,
  d.uses_question_answers,
  d.uses_letters_for_participant,
  d.visible_only,
  d.page_size_clamped,
  d.no_random_sort,
  v.answers_policy_enforces_safety,
  g.entry_authenticated,
  g.entry_not_anon,
  g.discover_authenticated,
  g.discover_not_anon,
  g.no_public_execute,
  i.participant_high_index_present,
  (
    e.present and e.security_invoker and e.pinned_search_path and e.no_user_id_argument
    and e.every_read_self_scoped and e.status_from_existing_rpc
    and d.present and d.security_invoker and d.pinned_search_path
    and d.uses_public_profiles and d.uses_question_answers and d.uses_letters_for_participant
    and d.visible_only and d.page_size_clamped and d.no_random_sort
    and v.answers_policy_enforces_safety
    and g.entry_authenticated and g.entry_not_anon
    and g.discover_authenticated and g.discover_not_anon and g.no_public_execute
    and i.participant_high_index_present
  ) as overall_pass
from entry_fn e, discover_fn d, visibility_policy v, grants g, idx i;
