-- ============================================================
-- TEMPA — ACCOUNT CLOSURE OWN-REPLIES FIX — VERIFIER (READ-ONLY)
-- Pairs with docs/sql/2026-10-18-account-closure-own-replies-fix.sql.
-- One SELECT; changes nothing. Expect exactly one row with
-- overall_pass = true (every other column true as well).
-- ============================================================

with fn as (
  select
    coalesce(pg_get_functiondef(to_regprocedure('public.close_my_account(text, text)')), '') as def,
    (select p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.close_my_account(text, text)')) as secdef,
    (select p.proconfig from pg_proc p where p.oid = to_regprocedure('public.close_my_account(text, text)')) as config
),
checks as (
  select
    -- signature, security and grants unchanged
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'close_my_account') = 1
      and to_regprocedure('public.close_my_account(text, text)') is not null as single_unchanged_signature,
    coalesce((select secdef from fn), false) as security_definer,
    coalesce((select 'search_path=pg_catalog' = any(config) from fn), false) as search_path_pg_catalog,
    coalesce(has_function_privilege('authenticated', to_regprocedure('public.close_my_account(text, text)'), 'execute'), false) as authenticated_can_execute,
    not coalesce(has_function_privilege('anon', to_regprocedure('public.close_my_account(text, text)'), 'execute'), false) as anon_cannot_execute,

    -- THE FIX
    (select def ~* 'delete from public\.dispatch_replies\s+where dispatch_id = any \(v_deletable\) and author_id = v_uid' from fn) as own_replies_deleted_scoped_to_self,
    (select strpos(def, 'delete from public.dispatch_replies') > 0
        and strpos(def, 'delete from public.dispatch_replies') < strpos(def, 'delete from public.dispatches where id = any (v_deletable)')
       from fn) as own_replies_deleted_before_dispatches,
    (select def ~* 'r\.target_type = ''reply'' and dr\.dispatch_id = d\.id' from fn) as reported_reply_keeps_dispatch,

    -- every previous guarantee still present
    (select def ~* 'dr\.author_id <> v_uid' from fn) as others_replies_keep_dispatch,
    (select def ~* 'r\.target_type = ''dispatch'' and r\.target_id = d\.id' and def ~* 'r\.target_type = ''photo_moment''' from fn) as reported_dispatch_or_photo_kept,
    (select def ~* 'v_uid uuid := auth\.uid\(\)' and def !~* 'p_user_id|p_target' from fn) as self_only,
    (select def ~* 'Staff accounts are closed by Tempa administrators\.'
        and def ~* 'This account created official Tempa content and is closed by Tempa administrators\.' from fn) as staff_and_official_refused,
    (select def ~* '''already_closed'', true' from fn) as idempotent_retry,
    (select strpos(def, 'insert into public.account_closures') > 0
        and strpos(def, 'insert into public.account_closures') < strpos(def, 'delete from public.dispatch_replies') from fn) as closure_recorded_first,
    (select def ~* 'set deleted_at = now\(\), body = ''''\s+where author_id = v_uid and deleted_at is null' from fn) as remaining_replies_tombstoned,
    (select def ~* 'delete from public\.profiles where id = v_uid' and def !~* 'delete from auth\.users' from fn) as auth_user_retained,
    (select def ~* '''dispatch-photos'', v_photos' from fn) as storage_list_returned
)
select *,
  (single_unchanged_signature and security_definer and search_path_pg_catalog and authenticated_can_execute
   and anon_cannot_execute and own_replies_deleted_scoped_to_self and own_replies_deleted_before_dispatches
   and reported_reply_keeps_dispatch and others_replies_keep_dispatch and reported_dispatch_or_photo_kept
   and self_only and staff_and_official_refused and idempotent_retry and closure_recorded_first
   and remaining_replies_tombstoned and auth_user_retained and storage_list_returned) as overall_pass
from checks;
