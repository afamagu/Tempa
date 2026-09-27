-- ============================================================
-- TEMPA — ACCOUNT AUTH STATE: DELETED vs SUSPENDED vs PERMANENTLY BANNED
-- STATUS: NOT YET APPLIED. For the owner to review and run in the
-- Supabase SQL editor, then run 2026-10-25-account-auth-state-verify.sql
-- and expect overall_pass = true. Forward-only; creates two functions,
-- changes no table, no data, no existing function.
-- Apply BEFORE deploying the app change that calls these functions.
-- ============================================================
--
-- WHY: Supabase Auth answers every refused sign-in with the same generic
-- `user_banned`, and self-service deletion (lib/account-deletion.ts)
-- used to Auth-ban every deleted account. A member who voluntarily
-- deleted their account was therefore treated exactly like a permanently
-- banned one, and told their magic link had expired.
--
-- Tempa's own tables are the source of truth instead:
--   account_enforcement_state.status = 'banned'     -> permanently banned
--   account_enforcement_state.status = 'suspended'  -> active suspension
--   account_closures row                            -> voluntarily deleted
-- Reports, Safety cases and 'restricted' are deliberately NOT inputs:
-- none of them may block a deleted member from returning.
--
-- account_auth_state(user_id) returns exactly one of:
--   'permanently_banned'  banned (closed or not) — never returns
--   'deleted_suspended'   deleted while under an active suspension
--   'deleted'             voluntarily deleted, no suspension/ban
--   'suspended'           not deleted, suspended
--   'none'                anything else (active / restricted / unknown id)
--
-- account_auth_state_for_email_link(token_hash) is the same answer for
-- the Auth user a magic link belongs to. GoTrue's verify endpoint looks
-- the user up by this token hash and refuses a banned user BEFORE it
-- checks expiry or consumes the token (supabase/auth
-- internal/api/verify.go verifyTokenHash), so on `user_banned` the link
-- the person just clicked still identifies them. Only the holder of the
-- emailed link can present the hash, so this reveals nothing to anyone
-- else; it returns the state word only — never an id or email. An empty
-- or implausibly short/long hash matches nothing (GoTrue stores '' for
-- cleared tokens).
--
-- Both are SECURITY DEFINER, pinned search_path, and executable by
-- service_role ONLY — never anon/authenticated.

begin;

create or replace function public.account_auth_state(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path to 'pg_catalog'
as $function$
  select case
    when es.status = 'banned' then 'permanently_banned'
    when c.user_id is not null and es.status = 'suspended' then 'deleted_suspended'
    when c.user_id is not null then 'deleted'
    when es.status = 'suspended' then 'suspended'
    else 'none'
  end
  from (select p_user_id as id) u
  left join public.account_enforcement_state es on es.user_id = u.id
  left join public.account_closures c on c.user_id = u.id
$function$;

revoke all on function public.account_auth_state(uuid) from public, anon, authenticated;
grant execute on function public.account_auth_state(uuid) to service_role;

create or replace function public.account_auth_state_for_email_link(p_token_hash text)
returns text
language sql
stable
security definer
set search_path to 'pg_catalog'
as $function$
  select public.account_auth_state(u.id)
  from auth.users u
  where p_token_hash is not null
    and char_length(p_token_hash) between 40 and 128
    and (u.recovery_token = p_token_hash or u.confirmation_token = p_token_hash)
  limit 1
$function$;

revoke all on function public.account_auth_state_for_email_link(text) from public, anon, authenticated;
grant execute on function public.account_auth_state_for_email_link(text) to service_role;

commit;
