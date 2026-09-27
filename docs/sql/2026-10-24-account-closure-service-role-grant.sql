-- ============================================================
-- TEMPA — ACCOUNT CLOSURE: LET THE SERVER RECORD CLEANUP PROGRESS
-- STATUS: NOT YET APPLIED. For the owner to review and run in the
-- Supabase SQL editor, then run
-- 2026-10-24-account-closure-service-role-grant-verify.sql and expect
-- overall_pass = true. Forward-only. Does NOT edit the applied
-- 2026-10-16 migration. No app deploy is required for the database fix.
-- ============================================================
--
-- PRODUCTION SYMPTOM: accounts deleted via You → Account → Delete
-- account were correctly Auth-banned ("User is banned" on sign-in), yet
-- account_closures.auth_disabled_at (and storage_cleaned_at /
-- last_error) stayed NULL.
--
-- ROOT CAUSE: 2026-10-16 created public.account_closures with
--   revoke all on public.account_closures from public, anon, authenticated;
-- and granted nothing to service_role. This project does not rely on
-- default table privileges for service_role (see the Checkpoint 1B note
-- in 2026-09-11-safety-blocking-foundation.sql and the explicit
-- service_role grant in 2026-10-01-arrival-email-delivery.sql; the
-- safety_cases verifier even asserts service_role has NO privilege on a
-- table created this same way). service_role bypasses RLS, but bypassing
-- RLS is not a table privilege, so finalizeAccountClosure()'s
--   service.from('account_closures').update({...}).eq('user_id', uid)
-- was refused (42501 permission denied) and the error was never checked.
-- The ban itself goes through the Auth admin API, not this table, so it
-- succeeded. The column list and the user_id filter were correct.
--
-- FIX: the narrowest privilege the server write needs, and nothing else:
--   - UPDATE on exactly the three progress columns it sets;
--   - SELECT on user_id only, which Postgres requires for the WHERE
--     user_id = ... filter.
-- No INSERT/DELETE, no access to storage_objects, reason_code or
-- reason_detail, no policy, and nothing for anon/authenticated. The
-- closure row itself is still only ever created by close_my_account().

begin;

grant select (user_id) on public.account_closures to service_role;
grant update (storage_cleaned_at, auth_disabled_at, last_error) on public.account_closures to service_role;

commit;
