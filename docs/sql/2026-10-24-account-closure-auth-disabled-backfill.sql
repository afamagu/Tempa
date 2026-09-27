-- ============================================================
-- TEMPA — ACCOUNT CLOSURE auth_disabled_at: OWNER QUERIES
-- STATUS: NOT RUN. Nothing in this file has been executed anywhere.
-- Pairs with 2026-10-24-account-closure-service-role-grant.sql.
-- Run PART A as often as you like. Run PART B only after reviewing
-- PART A's output. Neither part changes the ban on any account.
-- ============================================================


-- ------------------------------------------------------------
-- PART A — READ-ONLY. Closures whose auth_disabled_at was never
-- recorded. Ids and timestamps only (no email, no reason, no metadata).
--   auth_banned_until: from auth.users; ~100 years ahead means the
--     closure ban was applied. NULL/past = NOT banned — investigate
--     those by hand and do NOT backfill them.
--   auth_ban_applied_at: banned_until minus the app's fixed
--     876000h ban duration = when the ban was actually applied.
-- ------------------------------------------------------------
select
  c.user_id,
  c.closed_at,
  c.storage_cleaned_at,
  c.auth_disabled_at,
  u.banned_until as auth_banned_until,
  u.banned_until - interval '876000 hours' as auth_ban_applied_at,
  (u.banned_until > now() + interval '50 years') as closure_ban_in_place
from public.account_closures c
left join auth.users u on u.id = c.user_id
where c.auth_disabled_at is null
order by c.closed_at;


-- ------------------------------------------------------------
-- PART B — BACKFILL. !!! WRITES DATA — REVIEW PART A FIRST !!!
-- Stamps auth_disabled_at ONLY for closures whose Auth user really
-- carries the closure ban, using the time the ban was applied (not
-- now()). Leaves every other row, and every other column, untouched.
-- Idempotent (only touches auth_disabled_at IS NULL). Wrapped in a
-- transaction: check the reported row count matches PART A's
-- closure_ban_in_place = true count, then COMMIT (or ROLLBACK).
-- storage_cleaned_at is deliberately NOT backfilled: the database
-- cannot prove the storage objects were removed.
-- ------------------------------------------------------------
-- begin;
--
-- update public.account_closures c
-- set auth_disabled_at = u.banned_until - interval '876000 hours'
-- from auth.users u
-- where u.id = c.user_id
--   and c.auth_disabled_at is null
--   and u.banned_until > now() + interval '50 years';
--
-- -- commit;   -- or: rollback;
