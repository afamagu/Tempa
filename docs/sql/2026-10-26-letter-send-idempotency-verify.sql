-- ============================================================
-- TEMPA — LETTER SEND IDEMPOTENCY — VERIFIER (READ-ONLY)
-- Pairs with docs/sql/2026-10-26-letter-send-idempotency.sql.
-- One SELECT; changes nothing. Expect exactly one row with
-- overall_pass = true (every other column true as well).
-- ============================================================

with f as (
  select to_regprocedure('public.write_letter_once(uuid, uuid, text, uuid, uuid, jsonb, jsonb, boolean)') as once_fn,
         to_regprocedure('public.write_letter(uuid, text, uuid, uuid, jsonb, jsonb, boolean)') as write_fn
),
checks as (
  select
    to_regclass('public.letter_submissions') is not null as table_exists,
    coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.letter_submissions')), false) as rls_enabled,
    not exists (
      select 1 from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'letter_submissions'
        and grantee in ('anon', 'authenticated', 'PUBLIC')
    ) as no_member_table_privileges,
    exists (
      select 1 from pg_constraint
      where conrelid = to_regclass('public.letter_submissions') and contype = 'p'
        and pg_get_constraintdef(oid) = 'PRIMARY KEY (sender_id, client_submission_id)'
    ) as one_letter_per_submission,
    f.once_fn is not null as wrapper_exists,
    f.write_fn is not null as write_letter_unchanged_signature,
    coalesce((select prosecdef from pg_proc where oid = f.once_fn), false) as security_definer,
    coalesce((select 'search_path=pg_catalog' = any(proconfig) from pg_proc where oid = f.once_fn), false) as search_path_pinned,
    coalesce(has_function_privilege('authenticated', f.once_fn, 'execute'), false) as authenticated_can_execute,
    not coalesce(has_function_privilege('anon', f.once_fn, 'execute'), true) as anon_cannot_execute,
    coalesce(pg_get_functiondef(f.once_fn) ~* 'from public\.correspondences where id = p_correspondence_id for update', false) as locks_correspondence,
    coalesce(pg_get_functiondef(f.once_fn) ~* 'public\.write_letter\(', false) as delegates_to_write_letter
  from f
)
select *,
  (table_exists and rls_enabled and no_member_table_privileges and one_letter_per_submission and wrapper_exists
   and write_letter_unchanged_signature and security_definer and search_path_pinned and authenticated_can_execute
   and anon_cannot_execute and locks_correspondence and delegates_to_write_letter) as overall_pass
from checks;
