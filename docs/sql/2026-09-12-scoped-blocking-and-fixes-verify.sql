-- ============================================================
-- TEMPA — SAFETY & TRUST, CHECKPOINT 1C: READ-ONLY VERIFICATION
-- Run AFTER 2026-09-12-scoped-blocking-and-fixes.sql has been applied.
-- Every statement below is a SELECT/has_*_privilege check — no
-- mutation of any kind.
--
-- Revision note: corrected per an independent PostgreSQL-level audit of
-- an earlier draft. That draft incorrectly expected
-- tempa_private.is_blocked_pair to be unreachable by `authenticated`
-- (it must NOT be — public RLS policies call it directly under the
-- querying user's own role) and checked block_user as if it were a
-- single function (it is now two overloads, block_user(uuid) and
-- block_user(uuid, text), which a scalar subquery keyed only on
-- proname='block_user' would silently break against). Both are fixed
-- below, the letter-RPC and photo-visibility checks now assert an exact
-- expected function count so a missing function can't accidentally
-- read as a PASS, and publish_dispatch's SECURITY INVOKER mode is now
-- actually asserted rather than only captured and unused.
-- ============================================================

-- ============================================================
-- SUMMARY — one row, PASS/FAIL per critical property. Run this first.
-- ============================================================
with
scope_column_check as (
  select
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'blocked_users' and column_name = 'scope'
    ) as column_exists,
    (select count(*) from public.blocked_users where scope not in ('letters', 'full')) as invalid_scope_rows,
    (select count(*) from public.blocked_users where scope is null) as null_scope_rows
),
-- is_blocked_pair must remain reachable by `authenticated` — public RLS
-- policies (dispatches_select_published, the question_answers policy,
-- etc.) call it directly under the querying user's own role. Only
-- `anon` must be unreachable. The Data-API-exposure boundary (confirmed
-- manually — tempa_private is not in Supabase's Exposed Schemas list)
-- is what actually prevents a client from calling this by name; EXECUTE
-- itself is correctly granted to authenticated.
is_blocked_pair_check as (
  select
    pg_get_functiondef(p.oid) ilike '%scope = ''full''%' as means_full_only,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'tempa_private' and p.proname = 'is_blocked_pair'
),
-- is_correspondence_blocked_pair is the opposite: unreachable by BOTH
-- anon and authenticated. It is only ever called internally, from
-- inside the SECURITY DEFINER correspondence RPCs.
is_corr_blocked_pair_check as (
  select
    p.oid is not null as exists_at_all,
    not (pg_get_functiondef(p.oid) ilike '%scope = ''full''%') as means_any_scope,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'tempa_private' and p.proname = 'is_correspondence_blocked_pair'
),
-- block_user is now TWO overloads, resolved independently by exact
-- signature via to_regprocedure — never a scalar subquery keyed only on
-- proname, which would error ("more than one row returned by a subquery
-- used as an expression") the moment a second overload exists.
block_user_oids as (
  select
    to_regprocedure('public.block_user(uuid)') as one_arg_oid,
    to_regprocedure('public.block_user(uuid, text)') as two_arg_oid
),
block_user_check as (
  select
    one_arg_oid is not null as one_arg_exists,
    two_arg_oid is not null as two_arg_exists,
    case when two_arg_oid is not null then pg_get_function_arguments(two_arg_oid) end as two_arg_signature,
    case when one_arg_oid is not null then pg_get_functiondef(one_arg_oid) end as one_arg_definition,
    case when one_arg_oid is not null then has_function_privilege('anon', one_arg_oid, 'EXECUTE') end as one_arg_anon_exec,
    case when one_arg_oid is not null then has_function_privilege('authenticated', one_arg_oid, 'EXECUTE') end as one_arg_authenticated_exec,
    case when two_arg_oid is not null then has_function_privilege('anon', two_arg_oid, 'EXECUTE') end as two_arg_anon_exec,
    case when two_arg_oid is not null then has_function_privilege('authenticated', two_arg_oid, 'EXECUTE') end as two_arg_authenticated_exec
  from block_user_oids
),
get_blocked_profiles_check as (
  select
    exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'get_blocked_profiles'
        and pg_get_function_result(p.oid) ilike '%scope text%'
    ) as returns_scope,
    has_function_privilege('anon', 'public.get_blocked_profiles()', 'EXECUTE') as anon_exec,
    has_function_privilege('authenticated', 'public.get_blocked_profiles()', 'EXECUTE') as authenticated_exec
),
-- All FIVE correspondence RPCs that gate NEW private interaction must
-- use the any-block helper. function_count is asserted = 5 explicitly
-- so a renamed/dropped function reads as a hard [FAIL], not a silent
-- pass from bool_and/bool_or over a smaller-than-expected set.
letter_rpc_check as (
  select
    count(*) as function_count,
    bool_and(pg_get_functiondef(p.oid) ilike '%is_correspondence_blocked_pair%') as all_use_correspondence_check,
    bool_or(pg_get_functiondef(p.oid) ilike '%is_blocked_pair(auth.uid()%') as any_still_use_full_only_check
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'send_first_letter', 'reply_to_letter', 'write_letter',
      'request_photo_sharing', 'respond_photo_sharing'
    )
),
-- can_view_letter_photo / dispatch_photo_is_visible must still use
-- is_blocked_pair (full-only) — a deliberate, unchanged design
-- decision, not an oversight. function_count is asserted = 2 explicitly
-- for the same reason as letter_rpc_check above.
photo_visibility_unchanged_check as (
  select
    count(*) as function_count,
    bool_and(
      pg_get_functiondef(p.oid) ilike '%is_blocked_pair%'
      and pg_get_functiondef(p.oid) not ilike '%is_correspondence_blocked_pair%'
    ) as both_still_full_only
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('can_view_letter_photo', 'dispatch_photo_is_visible')
),
publish_dispatch_check as (
  select
    pg_get_functiondef(p.oid) ilike '%status, published_at%'
      and pg_get_functiondef(p.oid) ilike '%''published'', now()%' as insert_is_explicit,
    p.prosecdef as is_security_definer,
    has_function_privilege('authenticated', 'public.publish_dispatch(text, text, text[], jsonb)', 'EXECUTE') as authenticated_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'publish_dispatch'
),
dispatches_constraint_check as (
  select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
  where conrelid = 'public.dispatches'::regclass
    and conname ilike '%published_at%'
)
select
  case when (select column_exists from scope_column_check) then '[OK]' else '[FAIL]' end as blocked_users_has_scope_column,
  case when (select invalid_scope_rows from scope_column_check) = 0 then '[OK]' else '[FAIL]' end as no_invalid_scope_values,
  case when (select null_scope_rows from scope_column_check) = 0 then '[OK]' else '[FAIL]' end as no_null_scope_values,

  case when (select means_full_only from is_blocked_pair_check) then '[OK]' else '[FAIL]' end as is_blocked_pair_now_full_only,
  case when (select not anon_exec from is_blocked_pair_check) then '[OK]' else '[FAIL]' end as is_blocked_pair_anon_unreachable,
  case when (select authenticated_exec from is_blocked_pair_check) then '[OK]' else '[FAIL]' end as is_blocked_pair_authenticated_reachable,

  case when (select exists_at_all from is_corr_blocked_pair_check) then '[OK]' else '[FAIL]' end as is_correspondence_blocked_pair_exists,
  case when (select means_any_scope from is_corr_blocked_pair_check) then '[OK]' else '[FAIL]' end as is_correspondence_blocked_pair_means_any_scope,
  case when (select not anon_exec and not authenticated_exec from is_corr_blocked_pair_check) then '[OK]' else '[FAIL]' end as is_correspondence_blocked_pair_unreachable_by_either_role,

  case when (select one_arg_exists and two_arg_exists from block_user_check) then '[OK]' else '[FAIL]' end as block_user_both_overloads_exist,
  case when (select coalesce(two_arg_signature not ilike '%default%', false) from block_user_check) then '[OK]' else '[FAIL]' end as block_user_two_arg_has_no_default,
  case when (select coalesce(one_arg_definition ilike '%block_user(p_blocked_id, ''full'')%', false) from block_user_check) then '[OK]' else '[FAIL — inspect one_arg_definition manually]' end as block_user_one_arg_delegates_to_full,
  case when (select not coalesce(one_arg_anon_exec, true) and not coalesce(two_arg_anon_exec, true) from block_user_check) then '[OK]' else '[FAIL]' end as block_user_neither_overload_anon_reachable,
  case when (select coalesce(one_arg_authenticated_exec, false) and coalesce(two_arg_authenticated_exec, false) from block_user_check) then '[OK]' else '[FAIL]' end as block_user_both_overloads_authenticated_reachable,

  case when (select returns_scope from get_blocked_profiles_check) then '[OK]' else '[FAIL]' end as get_blocked_profiles_returns_scope,
  case when (select not anon_exec and authenticated_exec from get_blocked_profiles_check) then '[OK]' else '[FAIL]' end as get_blocked_profiles_grants_correct,

  case when (select function_count from letter_rpc_check) = 5 then '[OK]' else '[FAIL — expected exactly 5 functions]' end as letter_rpc_function_count_is_5,
  case when (select all_use_correspondence_check from letter_rpc_check) then '[OK]' else '[FAIL]' end as letter_rpcs_use_any_block_check,
  case when (select not any_still_use_full_only_check from letter_rpc_check) then '[OK]' else '[FAIL]' end as no_letter_rpc_still_full_only,

  case when (select function_count from photo_visibility_unchanged_check) = 2 then '[OK]' else '[FAIL — expected exactly 2 functions]' end as photo_visibility_function_count_is_2,
  case when (select both_still_full_only from photo_visibility_unchanged_check) then '[OK]' else '[FAIL]' end as photo_visibility_still_full_only_as_designed,

  case when (select insert_is_explicit from publish_dispatch_check) then '[OK]' else '[FAIL]' end as publish_dispatch_insert_is_explicit,
  case when (select not is_security_definer from publish_dispatch_check) then '[OK]' else '[FAIL — must remain SECURITY INVOKER]' end as publish_dispatch_is_security_invoker,
  case when (select authenticated_exec from publish_dispatch_check) then '[OK]' else '[FAIL]' end as publish_dispatch_grant_intact,

  case when exists (select 1 from dispatches_constraint_check) then '[OK — see detail query below]' else '[NOT FOUND — constraint may predate tracked migrations; confirm manually]' end as published_at_constraint_located;

-- If every column above reads [OK] (the last one may legitimately read
-- the bracketed "confirm manually" text — see its own note), the
-- migration's critical properties are confirmed. Investigate any [FAIL]
-- with the detailed queries below.


-- ============================================================
-- DETAILED DIAGNOSTICS
-- ============================================================

-- 1. blocked_users.scope column, values, and default.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'blocked_users'
order by ordinal_position;

select scope, count(*) from public.blocked_users group by scope;
-- Expect: every existing row reads 'full' (or zero rows if none exist
-- yet in this environment).

-- 2. is_blocked_pair full definition and privileges — confirm
-- scope = 'full' is present in the body, and confirm the exact expected
-- privilege state directly (anon=false, authenticated=true).
select pg_get_functiondef(p.oid) as is_blocked_pair_definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'tempa_private' and p.proname = 'is_blocked_pair';

select
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'tempa_private' and p.proname = 'is_blocked_pair';
-- Expect: anon_can_execute = false, authenticated_can_execute = true.

-- 3. is_correspondence_blocked_pair full definition and privileges.
select pg_get_functiondef(p.oid) as is_correspondence_blocked_pair_definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'tempa_private' and p.proname = 'is_correspondence_blocked_pair';

select
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'tempa_private' and p.proname = 'is_correspondence_blocked_pair';
-- Expect: anon_can_execute = false, authenticated_can_execute = false.

-- 4. block_user — BOTH overloads' exact signatures, definitions, and
-- grants. This intentionally returns 2 rows (not a scalar subquery), so
-- the two-overload design is visible directly rather than assumed.
select
  p.oid::regprocedure as full_signature,
  pg_get_function_arguments(p.oid) as arguments,
  p.prosecdef as is_security_definer
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'block_user'
order by pg_get_function_arguments(p.oid);

select grantee, routine_name, specific_name, privilege_type
from information_schema.role_routine_grants
where routine_schema = 'public' and routine_name = 'block_user'
order by specific_name, grantee;

select pg_get_functiondef(to_regprocedure('public.block_user(uuid)')) as one_arg_wrapper_definition;
select pg_get_functiondef(to_regprocedure('public.block_user(uuid, text)')) as two_arg_implementation_definition;
-- Expect: the one-argument wrapper's body calls
-- public.block_user(p_blocked_id, 'full') and nothing else; the
-- two-argument version's arguments string does NOT contain "DEFAULT".

-- 5. get_blocked_profiles's exact return shape.
select pg_get_function_result(p.oid) as return_columns
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'get_blocked_profiles';

-- 6. Every letter/photo-consent RPC's security mode + which helper it
-- calls (for manual eyeballing alongside the summary row above).
select
  n.nspname as schema, p.proname,
  p.prosecdef as is_security_definer,
  case
    when pg_get_functiondef(p.oid) ilike '%is_correspondence_blocked_pair%' then 'is_correspondence_blocked_pair (any block)'
    when pg_get_functiondef(p.oid) ilike '%is_blocked_pair%' then 'is_blocked_pair (full only)'
    else '(no block check found)'
  end as block_helper_used
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'send_first_letter', 'reply_to_letter', 'write_letter',
    'request_photo_sharing', 'respond_photo_sharing',
    'can_view_letter_photo', 'dispatch_photo_is_visible',
    'keep_mind', 'publish_dispatch'
  )
order by p.proname;

-- 7. publish_dispatch's full current definition, to eyeball the INSERT
-- statement and confirm SECURITY INVOKER directly.
select
  p.prosecdef as is_security_definer,
  pg_get_functiondef(p.oid) as publish_dispatch_definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'publish_dispatch';
-- Expect: is_security_definer = false (SECURITY INVOKER).

-- 8. The actual constraint that failed during live testing — locate it
-- (it predates tracked migration history, same as several other
-- constraints/columns discovered this engagement) and confirm its
-- exact definition.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.dispatches'::regclass
order by conname;

-- 9. Functional checks (run as a real authenticated user, via the
-- auth-impersonation pattern already used earlier this session):
-- select * from public.publish_dispatch('Verification test', 'Body text for a live verification publish.', '{}', '[]'::jsonb);
-- Expect: a row with status = 'published' and a non-null published_at,
-- no constraint violation.
--
-- select public.block_user('<some-other-user-id>'::uuid);
-- Expect: succeeds, and the resulting blocked_users row reads scope = 'full'.
--
-- select public.block_user('<some-other-user-id>'::uuid, 'letters');
-- Expect: succeeds, resulting row reads scope = 'letters', no kept_minds
-- row between the pair is removed.
--
-- select public.block_user('<some-other-user-id>'::uuid, null);
-- Expect: raises "Unknown block scope." rather than silently succeeding.
