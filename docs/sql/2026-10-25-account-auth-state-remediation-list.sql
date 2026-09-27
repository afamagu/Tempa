-- ============================================================
-- TEMPA — EXISTING ACCOUNTS UNDER THE OLD "DELETION = 100-YEAR BAN"
-- STATUS: READ-ONLY. NOT RUN. Every statement below is a SELECT; nothing
-- here changes data. Ids and timestamps only — no email, no metadata,
-- no reasons.
--
-- Run after 2026-10-25-account-auth-state.sql is applied. The one-time
-- remediation itself is NOT SQL: it is scripts/remediate-account-auth.mjs
-- (dry run by default), which re-checks each id with
-- public.account_auth_state() and uses the same Supabase Auth admin
-- calls the app now uses. Do not edit auth.users by hand.
-- ============================================================


-- ------------------------------------------------------------
-- LIST 1 — voluntarily deleted, NOT under an active suspension or a
-- permanent ban, whose Auth identity still exists (not soft-deleted).
-- These are the accounts to retire so the same email / Google account
-- can create a new account. Expect the old ~100-year banned_until.
-- ------------------------------------------------------------
select
  c.user_id,
  c.closed_at,
  c.auth_disabled_at,
  u.banned_until as auth_banned_until,
  u.deleted_at as auth_soft_deleted_at
from public.account_closures c
join auth.users u on u.id = c.user_id
left join public.account_enforcement_state es on es.user_id = c.user_id
where coalesce(es.status, 'active') not in ('suspended', 'banned')
  and u.deleted_at is null
order by c.closed_at;

-- Same list as one comma-separated line, to paste into the script's
-- --ids argument after reviewing LIST 1.
select string_agg(c.user_id::text, ',' order by c.closed_at) as ids_to_retire
from public.account_closures c
join auth.users u on u.id = c.user_id
left join public.account_enforcement_state es on es.user_id = c.user_id
where coalesce(es.status, 'active') not in ('suspended', 'banned')
  and u.deleted_at is null;


-- ------------------------------------------------------------
-- LIST 2 — deleted while suspended or permanently banned. For
-- visibility only: these STAY banned with their identity kept. Do not
-- pass these ids to the script (it would refuse them anyway).
-- ------------------------------------------------------------
select
  c.user_id,
  c.closed_at,
  es.status as enforcement_status,
  es.changed_at as enforcement_changed_at,
  u.banned_until as auth_banned_until
from public.account_closures c
join auth.users u on u.id = c.user_id
join public.account_enforcement_state es on es.user_id = c.user_id
where es.status in ('suspended', 'banned')
order by c.closed_at;


-- ------------------------------------------------------------
-- LIST 3 — permanently banned by Tempa (not deleted) but NOT refused by
-- Supabase Auth (admin bans were never mirrored before this change).
-- They are still blocked inside Tempa; mirroring the ban makes sign-in
-- itself refuse them. Optional; the same script handles these ids.
-- ------------------------------------------------------------
select
  es.user_id,
  es.changed_at as banned_at,
  u.banned_until as auth_banned_until
from public.account_enforcement_state es
join auth.users u on u.id = es.user_id
where es.status = 'banned'
  and not exists (select 1 from public.account_closures c where c.user_id = es.user_id)
  and (u.banned_until is null or u.banned_until < now() + interval '50 years')
order by es.changed_at;
