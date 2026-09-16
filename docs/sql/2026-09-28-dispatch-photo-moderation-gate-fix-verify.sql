-- ============================================================
-- COHORT SAFETY READINESS — CHECKPOINT 1 CONTRACT VERIFIER (CORRECTED)
-- Run AFTER 2026-09-28-dispatch-photo-moderation-gate-fix.sql has been
-- applied. Every statement below is a SELECT/has_*_privilege check —
-- no INSERT/UPDATE/DELETE/CREATE/ALTER/DROP/GRANT/REVOKE of any kind.
--
-- This supersedes the original Checkpoint 1 verifier (never committed
-- to a file — it only ever existed as chat text), which returned
-- overall_pass = false on exactly three columns when run live:
--   blocked_users_select_own_policy_correct
--   dispatch_photo_is_visible_checks_moderation_status
--   dispatch_photo_is_externally_shared_checks_moderation_status
--
-- Live diagnosis (confirmed by direct inspection of the returned
-- policy/function definitions, see chat history):
--   1. blocked_users_select_own — the LIVE policy (qual: `auth.uid() =
--      blocker_id`) was and remains CORRECT. The original verifier's
--      ILIKE pattern assumed `blocker_id` appears before `auth.uid()`
--      in the textual expression, which is backwards from the actual,
--      equally-correct predicate. This was a VERIFIER bug, not a
--      database defect — fixed below by normalizing the qual text
--      (whitespace/parens stripped) and accepting EITHER textual
--      operand order for the same equality, never depending on which
--      side Postgres happens to print first.
--   2 & 3. dispatch_photo_is_visible / dispatch_photo_is_externally_
--      shared — both were GENUINE gaps: neither checked
--      d.moderation_status, unlike every other Dispatch read path
--      (dispatches_select_published, get_shared_dispatch,
--      search_dispatches). Fixed by 2026-09-28-dispatch-photo-
--      moderation-gate-fix.sql; this file proves the fix.
-- ============================================================

-- ============================================================
-- SUMMARY — one row, PASS/FAIL per property. Run this first.
-- ============================================================
with
-- ------------------------------------------------------------
-- 1. blocked_users_select_own — order-independent equality proof
-- ------------------------------------------------------------
blocked_users_check as (
  select
    pol.polname is not null as exists_at_all,
    coalesce(pol.polcmd = 'r', false) as is_select_cmd,
    coalesce(
      (select array_agg(rolname order by rolname) from pg_roles where oid = any(pol.polroles))
        = array['authenticated']::name[],
      false
    ) as roles_correct,
    pg_get_expr(pol.polqual, pol.polrelid) as raw_qual,
    -- Strip whitespace and parentheses, lowercase, then accept EITHER
    -- textual operand order for the same equality — a policy meaning
    -- "blocker_id = auth.uid()" is exactly as correct as "auth.uid() =
    -- blocker_id", and this must never depend on which side Postgres's
    -- own pg_get_expr happens to print first.
    coalesce(
      regexp_replace(lower(pg_get_expr(pol.polqual, pol.polrelid)), '[[:space:]()]', '', 'g')
        in ('auth.uid=blocker_id', 'blocker_id=auth.uid'),
      false
    ) as qual_is_own_row_equality
  from (select 1 as anchor) _anchor
  left join pg_policy pol
    on pol.polname = 'blocked_users_select_own'
    and pol.polrelid = to_regclass('public.blocked_users')
),
-- ------------------------------------------------------------
-- 2. dispatch_photo_is_visible(text)
-- ------------------------------------------------------------
dispatch_photo_visible_check as (
  select
    to_regprocedure('public.dispatch_photo_is_visible(text)') is not null as exact_signature_exists,
    p.oid is not null as exists_at_all,
    coalesce(not p.prosecdef, false) as is_security_invoker,
    coalesce(p.provolatile = 's', false) as is_stable,
    coalesce(
      exists (select 1 from unnest(p.proconfig) cfg where cfg = 'search_path=public'),
      false
    ) as search_path_fixed,
    coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as authenticated_exec,
    coalesce(not has_function_privilege('anon', p.oid, 'EXECUTE'), false) as anon_no_exec,
    coalesce(
      pg_get_functiondef(p.oid) ilike '%auth.uid()::text = (storage.foldername(p_path))[1]%',
      false
    ) as preserves_owner_path,
    coalesce(pg_get_functiondef(p.oid) ilike '%d.status = ''published''%', false) as requires_published,
    coalesce(pg_get_functiondef(p.oid) ilike '%d.moderation_status = ''visible''%', false) as requires_moderation_visible,
    coalesce(pg_get_functiondef(p.oid) ilike '%tempa_private.is_blocked_pair%', false) as uses_full_block_helper,
    coalesce(not (pg_get_functiondef(p.oid) ilike '%is_correspondence_blocked_pair%'), false) as never_uses_stop_letters_helper,
    -- Structural proof, not merely presence: published, then
    -- moderation-visible, then the block check — all three inside the
    -- same non-owner branch, in the order the migration actually wrote
    -- them.
    coalesce(
      position('d.status = ''published''' in pg_get_functiondef(p.oid)) > 0
      and position('d.moderation_status = ''visible''' in pg_get_functiondef(p.oid)) > 0
      and position('tempa_private.is_blocked_pair' in pg_get_functiondef(p.oid)) > 0
      and position('d.status = ''published''' in pg_get_functiondef(p.oid))
        < position('d.moderation_status = ''visible''' in pg_get_functiondef(p.oid))
      and position('d.moderation_status = ''visible''' in pg_get_functiondef(p.oid))
        < position('tempa_private.is_blocked_pair' in pg_get_functiondef(p.oid)),
      false
    ) as moderation_check_ordered_correctly
  from (select 1 as anchor) _anchor
  left join pg_proc p
    on p.oid = to_regprocedure('public.dispatch_photo_is_visible(text)')
),
-- ------------------------------------------------------------
-- 3. dispatch_photo_is_externally_shared(text)
-- ------------------------------------------------------------
dispatch_photo_externally_shared_check as (
  select
    to_regprocedure('public.dispatch_photo_is_externally_shared(text)') is not null as exact_signature_exists,
    p.oid is not null as exists_at_all,
    coalesce(p.prosecdef, false) as is_security_definer,
    coalesce(p.provolatile = 's', false) as is_stable,
    coalesce(
      exists (select 1 from unnest(p.proconfig) cfg where cfg = 'search_path=pg_catalog'),
      false
    ) as search_path_fixed,
    coalesce(has_function_privilege('anon', p.oid, 'EXECUTE'), false) as anon_exec,
    coalesce(pg_get_functiondef(p.oid) ilike '%d.status = ''published''%', false) as requires_published,
    coalesce(pg_get_functiondef(p.oid) ilike '%d.moderation_status = ''visible''%', false) as requires_moderation_visible,
    coalesce(pg_get_functiondef(p.oid) ilike '%ds.revoked_at is null%', false) as requires_share_not_revoked,
    -- Structural proof: published, then moderation-visible, then
    -- not-revoked — all three inside the one exists() predicate, in
    -- the order the migration actually wrote them.
    coalesce(
      position('d.status = ''published''' in pg_get_functiondef(p.oid)) > 0
      and position('d.moderation_status = ''visible''' in pg_get_functiondef(p.oid)) > 0
      and position('ds.revoked_at is null' in pg_get_functiondef(p.oid)) > 0
      and position('d.status = ''published''' in pg_get_functiondef(p.oid))
        < position('d.moderation_status = ''visible''' in pg_get_functiondef(p.oid))
      and position('d.moderation_status = ''visible''' in pg_get_functiondef(p.oid))
        < position('ds.revoked_at is null' in pg_get_functiondef(p.oid)),
      false
    ) as moderation_check_ordered_correctly
  from (select 1 as anchor) _anchor
  left join pg_proc p
    on p.oid = to_regprocedure('public.dispatch_photo_is_externally_shared(text)')
),
-- ------------------------------------------------------------
-- 4. storage policies still call these two functions by name only —
--    this migration must not have needed to touch them.
-- ------------------------------------------------------------
storage_policy_check as (
  select
    bool_and(present) as both_policies_intact
  from (
    select exists (
      select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and policyname = pname
    ) as present
    from (values ('dispatch_photos_select'), ('dispatch_photos_select_shared')) as expected(pname)
  ) as checked
)
select
  bu.exists_at_all as blocked_users_policy_exists,
  bu.is_select_cmd as blocked_users_is_select_cmd,
  bu.roles_correct as blocked_users_roles_correct,
  bu.qual_is_own_row_equality as blocked_users_select_own_policy_correct,
  dv.exact_signature_exists as dispatch_photo_is_visible_signature_exists,
  dv.is_security_invoker as dispatch_photo_is_visible_is_security_invoker,
  dv.is_stable as dispatch_photo_is_visible_is_stable,
  dv.search_path_fixed as dispatch_photo_is_visible_search_path_fixed,
  dv.authenticated_exec as dispatch_photo_is_visible_authenticated_exec,
  dv.anon_no_exec as dispatch_photo_is_visible_anon_no_exec,
  dv.preserves_owner_path as dispatch_photo_is_visible_preserves_owner_path,
  dv.requires_published as dispatch_photo_is_visible_requires_published,
  dv.requires_moderation_visible as dispatch_photo_is_visible_checks_moderation_status,
  dv.uses_full_block_helper as dispatch_photo_is_visible_uses_full_block_helper,
  dv.never_uses_stop_letters_helper as dispatch_photo_is_visible_never_uses_stop_letters_helper,
  dv.moderation_check_ordered_correctly as dispatch_photo_is_visible_moderation_check_ordered_correctly,
  de.exact_signature_exists as dispatch_photo_is_externally_shared_signature_exists,
  de.is_security_definer as dispatch_photo_is_externally_shared_is_security_definer,
  de.is_stable as dispatch_photo_is_externally_shared_is_stable,
  de.search_path_fixed as dispatch_photo_is_externally_shared_search_path_fixed,
  de.anon_exec as dispatch_photo_is_externally_shared_anon_exec,
  de.requires_published as dispatch_photo_is_externally_shared_requires_published,
  de.requires_moderation_visible as dispatch_photo_is_externally_shared_checks_moderation_status,
  de.requires_share_not_revoked as dispatch_photo_is_externally_shared_requires_share_not_revoked,
  de.moderation_check_ordered_correctly as dispatch_photo_is_externally_shared_moderation_check_ordered_correctly,
  sp.both_policies_intact as storage_policies_intact,
  (
    bu.exists_at_all and bu.is_select_cmd and bu.roles_correct and bu.qual_is_own_row_equality
    and dv.exact_signature_exists and dv.is_security_invoker and dv.is_stable and dv.search_path_fixed
    and dv.authenticated_exec and dv.anon_no_exec and dv.preserves_owner_path and dv.requires_published
    and dv.requires_moderation_visible and dv.uses_full_block_helper and dv.never_uses_stop_letters_helper
    and dv.moderation_check_ordered_correctly
    and de.exact_signature_exists and de.is_security_definer and de.is_stable and de.search_path_fixed
    and de.anon_exec and de.requires_published and de.requires_moderation_visible
    and de.requires_share_not_revoked and de.moderation_check_ordered_correctly
    and sp.both_policies_intact
  ) as overall_pass
from blocked_users_check bu, dispatch_photo_visible_check dv,
     dispatch_photo_externally_shared_check de, storage_policy_check sp;

-- ============================================================
-- DETAIL — full source of the corrected objects, for manual reading
-- alongside the migration file itself.
-- ============================================================
select pg_get_expr(pol.polqual, pol.polrelid) as blocked_users_select_own_using_clause
from pg_policy pol
where pol.polname = 'blocked_users_select_own'
  and pol.polrelid = to_regclass('public.blocked_users');

select pg_get_functiondef(p.oid) as dispatch_photo_is_visible_definition
from pg_proc p
where p.oid = to_regprocedure('public.dispatch_photo_is_visible(text)');

select pg_get_functiondef(p.oid) as dispatch_photo_is_externally_shared_definition
from pg_proc p
where p.oid = to_regprocedure('public.dispatch_photo_is_externally_shared(text)');
