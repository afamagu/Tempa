-- ============================================================
-- TEMPA — ACCOUNT AUTH STATE — VERIFIER (READ-ONLY)
-- Pairs with docs/sql/2026-10-25-account-auth-state.sql.
-- One SELECT; changes nothing. Expect exactly one row with
-- overall_pass = true (every other column true as well).
-- ============================================================

with f as (
  select
    to_regprocedure('public.account_auth_state(uuid)') as state_fn,
    to_regprocedure('public.account_auth_state_for_email_link(text)') as link_fn
),
checks as (
  select
    f.state_fn is not null and f.link_fn is not null as functions_exist,
    coalesce((select bool_and(p.prosecdef) from pg_proc p where p.oid in (f.state_fn, f.link_fn)), false) as security_definer,
    coalesce((select bool_and('search_path=pg_catalog' = any(p.proconfig)) from pg_proc p where p.oid in (f.state_fn, f.link_fn)), false)
      as search_path_pinned,

    -- service_role only
    coalesce(has_function_privilege('service_role', f.state_fn, 'execute'), false)
      and coalesce(has_function_privilege('service_role', f.link_fn, 'execute'), false) as service_role_can_execute,
    not coalesce(has_function_privilege('authenticated', f.state_fn, 'execute'), true)
      and not coalesce(has_function_privilege('authenticated', f.link_fn, 'execute'), true)
      and not coalesce(has_function_privilege('anon', f.state_fn, 'execute'), true)
      and not coalesce(has_function_privilege('anon', f.link_fn, 'execute'), true) as members_cannot_execute,
    not exists (
      select 1 from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid in (f.state_fn, f.link_fn) and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) as no_public_execute,

    -- the function owner can read what it needs
    has_table_privilege((select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = f.link_fn), 'auth.users', 'SELECT')
      as owner_can_read_auth_users,

    -- behaviour on inputs that can never match a real account
    public.account_auth_state('00000000-0000-0000-0000-000000000000'::uuid) = 'none' as unknown_id_is_none,
    public.account_auth_state_for_email_link('') is null
      and public.account_auth_state_for_email_link(null) is null
      and public.account_auth_state_for_email_link('short') is null as empty_or_short_hash_matches_nothing,

    -- restricted / reported never map to a blocking state
    pg_get_functiondef(f.state_fn) !~* 'restricted|reports|safety_cases' as reports_and_restriction_not_inputs
  from f
)
select *,
  (functions_exist and security_definer and search_path_pinned and service_role_can_execute
   and members_cannot_execute and no_public_execute and owner_can_read_auth_users
   and unknown_id_is_none and empty_or_short_hash_matches_nothing and reports_and_restriction_not_inputs) as overall_pass
from checks;
