-- ============================================================
-- TEMPA — ACCOUNT CLOSURE SERVICE-ROLE GRANT — VERIFIER (READ-ONLY)
-- Pairs with docs/sql/2026-10-24-account-closure-service-role-grant.sql.
-- One SELECT; changes nothing. Expect exactly one row with
-- overall_pass = true (every other column true as well).
-- Run BEFORE the migration too: service_role_can_update_progress = false
-- there confirms the production root cause.
-- ============================================================

with t as (
  select to_regclass('public.account_closures') as rel
),
checks as (
  select
    (select rel is not null from t) as table_exists,
    coalesce((select c.relrowsecurity from pg_class c, t where c.oid = t.rel), false) as rls_still_enabled,

    -- THE FIX: exactly what finalizeAccountClosure() needs
    coalesce(has_column_privilege('service_role', 'public.account_closures', 'user_id', 'SELECT'), false)
      and coalesce(has_column_privilege('service_role', 'public.account_closures', 'storage_cleaned_at', 'UPDATE'), false)
      and coalesce(has_column_privilege('service_role', 'public.account_closures', 'auth_disabled_at', 'UPDATE'), false)
      and coalesce(has_column_privilege('service_role', 'public.account_closures', 'last_error', 'UPDATE'), false)
      as service_role_can_update_progress,

    -- and nothing more for service_role
    not coalesce(has_table_privilege('service_role', 'public.account_closures', 'INSERT'), true)
      and not coalesce(has_table_privilege('service_role', 'public.account_closures', 'DELETE'), true)
      as service_role_no_insert_delete,
    not coalesce(has_column_privilege('service_role', 'public.account_closures', 'storage_objects', 'SELECT'), true)
      and not coalesce(has_column_privilege('service_role', 'public.account_closures', 'reason_code', 'SELECT'), true)
      and not coalesce(has_column_privilege('service_role', 'public.account_closures', 'reason_detail', 'SELECT'), true)
      as service_role_cannot_read_closure_contents,
    not coalesce(has_column_privilege('service_role', 'public.account_closures', 'user_id', 'UPDATE'), true)
      and not coalesce(has_column_privilege('service_role', 'public.account_closures', 'closed_at', 'UPDATE'), true)
      as service_role_cannot_rewrite_identity_or_time,

    -- members still have nothing
    not exists (
      select 1 from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'account_closures'
        and grantee in ('anon', 'authenticated', 'PUBLIC')
    ) and not exists (
      select 1 from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'account_closures'
        and grantee in ('anon', 'authenticated', 'PUBLIC')
    ) as no_member_privileges,
    not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'account_closures') as no_policies
)
select *,
  (table_exists and rls_still_enabled and service_role_can_update_progress and service_role_no_insert_delete
   and service_role_cannot_read_closure_contents and service_role_cannot_rewrite_identity_or_time
   and no_member_privileges and no_policies) as overall_pass
from checks;
