-- Read-only verification after 2026-09-20-letter-archive-removals.sql.
-- Expected: every assertion returns true.

select
  to_regclass('public.letter_archive_removals') is not null as removal_table_exists,
  to_regprocedure('public.remove_my_archive_letters(uuid[])') is not null as removal_rpc_exists;

select
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'letter_archive_removals';

select
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'letter_archive_removals'
      and policyname = 'letter_archive_removals_select_own'
  ) as own_select_policy_exists;

select
  has_table_privilege('authenticated', 'public.letter_archive_removals', 'select') as authenticated_can_select,
  not has_table_privilege('authenticated', 'public.letter_archive_removals', 'insert') as authenticated_cannot_insert,
  not has_table_privilege('authenticated', 'public.letter_archive_removals', 'update') as authenticated_cannot_update,
  not has_table_privilege('authenticated', 'public.letter_archive_removals', 'delete') as authenticated_cannot_delete,
  has_function_privilege('authenticated', 'public.remove_my_archive_letters(uuid[])', 'execute') as authenticated_can_execute_rpc;
