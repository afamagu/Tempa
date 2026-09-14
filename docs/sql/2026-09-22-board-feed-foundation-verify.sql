-- ============================================================
-- TEMPA — BOARD EXPERIENCE, PHASE 2A: READ-ONLY VERIFICATION
-- Run AFTER 2026-09-22-board-feed-foundation.sql has been applied.
-- Every statement below is a SELECT/has_*_privilege check — no
-- mutation of any kind.
-- ============================================================
-- STATUS: run live against the applied migration on 2026-09-15. The
-- FIRST run returned overall_pass=false, traced to three false
-- negatives IN THIS FILE (never in the underlying migration's own
-- executable SQL, which was independently confirmed correct throughout)
-- and corrected below (schema-USAGE check, regex-tolerant author-own
-- policy check, corrected tgtype bitmask). The CORRECTED version of
-- this file was then re-run live and returned overall_pass=true. The
-- final dispatch_views spot-check at the bottom of this file also ran
-- clean: total_rows=7, null_first_viewed_at=0,
-- impossible_first_after_latest=0. See docs/sql/2026-09-22-board-feed-
-- foundation.sql's own STATUS line for the full list of properties
-- confirmed against the live database.
-- ============================================================

-- ============================================================
-- SUMMARY — one row, PASS/FAIL per critical property. Run this first.
-- ============================================================
with
-- author_content_publicly_visible must exclude ONLY suspended/banned —
-- never restricted, never active (both stay publicly visible, unchanged
-- from before this migration) — and must remain reachable by
-- `authenticated`, since dispatches_select_published's own RLS calls it
-- directly under the querying user's own role (the same treatment as
-- tempa_private.is_blocked_pair, not tempa_private.
-- is_correspondence_blocked_pair).
--
-- Preflight correction #1 (live verification found this): this function
-- deliberately keeps its default PUBLIC EXECUTE grant (see the
-- migration's own comment on why — the RLS policy calls it directly as
-- `authenticated`, and revoking that would break the policy). That
-- means `anon` genuinely DOES hold function-level EXECUTE too, inherited
-- from PUBLIC, exactly as designed — checking `not
-- has_function_privilege('anon', ..., 'EXECUTE')` was therefore always
-- going to read false on a correctly-applied migration, a false
-- negative, not a real gap. The actual security boundary for anything
-- under tempa_private is SCHEMA USAGE (`revoke all on schema
-- tempa_private from public, anon, authenticated`, docs/sql/2026-09-11-
-- safety-blocking-foundation.sql) — confirmed live: authenticated holds
-- USAGE on tempa_private, anon does not, so anon cannot reach this
-- function by name regardless of its function-level EXECUTE grant. That
-- is the property checked below instead.
author_visibility_check as (
  select
    p.oid is not null as exists_at_all,
    pg_get_functiondef(p.oid) ilike '%not in (''suspended'', ''banned'')%' as excludes_exactly_suspended_and_banned,
    not (pg_get_functiondef(p.oid) ilike '%''restricted''%') as never_mentions_restricted,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
    has_schema_privilege('authenticated', 'tempa_private', 'USAGE') as authenticated_schema_usage,
    has_schema_privilege('anon', 'tempa_private', 'USAGE') as anon_schema_usage
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'tempa_private' and p.proname = 'author_content_publicly_visible'
),
-- dispatches_select_published must call the new helper inside its
-- general-visibility branch while leaving the author-owns-it branch
-- (`or author_id = auth.uid()`) completely untouched — an author must
-- still see their own content regardless of their own account status.
--
-- Preflight correction #2 (live verification found this): pg_get_expr's
-- deparser normalizes/re-parenthesizes stored expressions for
-- unambiguous re-parsing — the live policy's author-own branch prints
-- as `OR (author_id = auth.uid())`, with parentheses the original
-- exact-substring ILIKE check ('%or author_id = auth.uid()%') never
-- anticipated, so it always read false on a correctly-applied policy. A
-- regex tolerant of optional wrapping parens/whitespace around the
-- equality — but still requiring "or" immediately followed by
-- "author_id = auth.uid()" as one connected phrase, not two
-- independently-matched tokens — proves the same thing robustly against
-- however pg_get_expr chooses to punctuate it.
dispatches_policy_check as (
  select
    pol.polname is not null as exists_at_all,
    pg_get_expr(pol.polqual, pol.polrelid) ilike '%author_content_publicly_visible%' as calls_new_helper,
    pg_get_expr(pol.polqual, pol.polrelid) ~* 'or\s*\(*\s*author_id\s*=\s*auth\.uid\(\)\s*\)*' as author_exception_preserved,
    pg_get_expr(pol.polqual, pol.polrelid) ilike '%is_blocked_pair%' as blocking_preserved,
    pg_get_expr(pol.polqual, pol.polrelid) ilike '%moderation_status = ''visible''%' as moderation_check_preserved
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  where c.relname = 'dispatches' and pol.polname = 'dispatches_select_published'
),
-- search_dispatches: still SECURITY INVOKER, still no ranking, now with
-- an explicit hard cap.
search_dispatches_check as (
  select
    p.oid is not null as exists_at_all,
    p.prosecdef as is_security_definer,
    pg_get_functiondef(p.oid) ilike '%limit 50%' as has_hard_cap,
    pg_get_functiondef(p.oid) ilike '%order by d.published_at desc%' as still_newest_first,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'search_dispatches'
),
-- Session-stability correction: dispatch_views must carry a genuinely
-- immutable first_viewed_at — present, not null, defaulted for future
-- inserts, and protected by a BEFORE UPDATE trigger that discards any
-- attempt (client, RPC, or otherwise) to change an existing row's value.
-- No pre-existing row may be left with a null first_viewed_at after the
-- migration's own backfill step.
first_viewed_at_column_check as (
  select
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'dispatch_views' and column_name = 'first_viewed_at'
    ) as column_exists,
    (
      select is_nullable = 'NO'
      from information_schema.columns
      where table_schema = 'public' and table_name = 'dispatch_views' and column_name = 'first_viewed_at'
    ) as column_not_null,
    (
      select column_default ilike '%now()%'
      from information_schema.columns
      where table_schema = 'public' and table_name = 'dispatch_views' and column_name = 'first_viewed_at'
    ) as has_now_default,
    (select count(*) from public.dispatch_views where first_viewed_at is null) as null_first_viewed_at_rows
),
-- Preflight correction #3 (live verification found this): pg_trigger.
-- tgtype's actual bit layout (catalog/pg_trigger.h, unchanged across
-- Postgres versions) is TRIGGER_TYPE_ROW = 1 (bit 0), TRIGGER_TYPE_
-- BEFORE = 2 (bit 1), TRIGGER_TYPE_UPDATE = 16 (bit 4) — the original
-- version of this check used 16/2/4 for BEFORE/ROW/UPDATE respectively,
-- an incorrect bit mapping that happened to pass the ROW and BEFORE
-- checks by coincidence (their swapped values still overlapped a set
-- bit) but always failed the UPDATE check (bit 4 is never set on a
-- pure BEFORE UPDATE FOR EACH ROW trigger, whose real tgtype is
-- 1 + 2 + 16 = 19), producing a false negative on the live, correct
-- trigger. Corrected below.
first_viewed_at_trigger_check as (
  select
    p.oid is not null as trigger_function_exists,
    pg_get_functiondef(p.oid) ilike '%new.first_viewed_at := old.first_viewed_at%' as function_preserves_old_value,
    exists (
      select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      where c.relname = 'dispatch_views'
        and t.tgname = 'dispatch_views_first_viewed_at_immutable'
        and not t.tgisinternal
        and t.tgtype & 1 = 1    -- ROW
        and t.tgtype & 2 = 2    -- BEFORE
        and t.tgtype & 16 = 16  -- UPDATE
    ) as trigger_attached_before_update_row
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'tempa_private' and p.proname = 'dispatch_views_preserve_first_viewed_at'
),
-- board_feed_page: SECURITY INVOKER (never DEFINER — it must inherit
-- RLS, not bypass it), no random(), uses hashtext() for its seeded
-- tie-break, uses row_number() for author diversity, filters on
-- published_at against the session cutoff, classifies "seen" using the
-- IMMUTABLE first_viewed_at (not the mutable viewed_at — the exact
-- session-stability bug this correction fixes), pins the Keep-ADD
-- direction to session start via kept_minds.created_at, and is
-- reachable by `authenticated` only (never anon — Board is
-- authenticated-only content).
-- Exact-signature check, same idiom as the precedent verifier's own
-- block_user_check (docs/sql/2026-09-12-scoped-blocking-and-fixes-
-- verify.sql) for an overloaded function — board_feed_page has only one
-- overload today, but pinning the exact parameter list here still
-- catches a signature drift (wrong type/order/count) that a bare
-- proname lookup alone would miss.
board_feed_page_signature_check as (
  select
    to_regprocedure(
      'public.board_feed_page(timestamptz, text, integer, integer, bigint, integer, uuid)'
    ) is not null as exact_signature_exists
),
board_feed_page_check as (
  select
    p.oid is not null as exists_at_all,
    not p.prosecdef as is_security_invoker,
    not (pg_get_functiondef(p.oid) ilike '%random()%') as never_uses_random,
    pg_get_functiondef(p.oid) ilike '%hashtext(%' as uses_seeded_hash,
    pg_get_functiondef(p.oid) ilike '%row_number() over%' as uses_author_windowing,
    pg_get_functiondef(p.oid) ilike '%published_at <= p_session_started_at%' as enforces_publish_cutoff,
    pg_get_functiondef(p.oid) ilike '%first_viewed_at < p_session_started_at%' as pins_seen_to_session_start,
    not (pg_get_functiondef(p.oid) ilike '%dv.viewed_at < p_session_started_at%') as never_uses_mutable_viewed_at_for_tiering,
    pg_get_functiondef(p.oid) ilike '%km.created_at < p_session_started_at%' as pins_kept_add_to_session_start,
    pg_get_functiondef(p.oid) ilike '%limit p_limit%' as respects_caller_limit,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'board_feed_page'
),
-- No Replies/Worth-Reading/impression/Postcard object was introduced by
-- this migration — the only NEW relations this checkpoint could
-- possibly have added are checked here by name; all four must be
-- absent (this migration creates no tables at all).
no_scope_creep_check as (
  select
    not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in (
          'dispatch_replies', 'replies', 'worth_reading', 'dispatch_impressions',
          'dispatch_worth_reading', 'board_sessions'
        )
    ) as no_new_relations_of_concern
)
select
  a.exists_at_all as author_visibility_fn_exists,
  a.excludes_exactly_suspended_and_banned,
  a.never_mentions_restricted,
  a.authenticated_exec as author_visibility_fn_authenticated_exec,
  a.authenticated_schema_usage as tempa_private_authenticated_schema_usage,
  a.anon_schema_usage as tempa_private_anon_schema_usage_should_be_false,
  d.exists_at_all as dispatches_policy_exists,
  d.calls_new_helper,
  d.author_exception_preserved,
  d.blocking_preserved,
  d.moderation_check_preserved,
  s.exists_at_all as search_dispatches_exists,
  s.is_security_definer as search_dispatches_is_security_definer_should_be_false,
  s.has_hard_cap,
  s.still_newest_first,
  s.authenticated_exec as search_authenticated_exec,
  s.anon_exec as search_anon_exec_should_be_false,
  fc.column_exists as first_viewed_at_column_exists,
  fc.column_not_null as first_viewed_at_not_null,
  fc.has_now_default as first_viewed_at_has_now_default,
  fc.null_first_viewed_at_rows as first_viewed_at_null_rows_should_be_zero,
  ft.trigger_function_exists as first_viewed_at_trigger_function_exists,
  ft.function_preserves_old_value,
  ft.trigger_attached_before_update_row,
  bs.exact_signature_exists as board_feed_page_exact_signature_exists,
  b.exists_at_all as board_feed_page_exists,
  b.is_security_invoker,
  b.never_uses_random,
  b.uses_seeded_hash,
  b.uses_author_windowing,
  b.enforces_publish_cutoff,
  b.pins_seen_to_session_start,
  b.never_uses_mutable_viewed_at_for_tiering,
  b.pins_kept_add_to_session_start,
  b.respects_caller_limit,
  b.authenticated_exec as board_feed_authenticated_exec,
  b.anon_exec as board_feed_anon_exec_should_be_false,
  n.no_new_relations_of_concern,
  (
    a.exists_at_all and a.excludes_exactly_suspended_and_banned and a.never_mentions_restricted
    and a.authenticated_exec and a.authenticated_schema_usage and not a.anon_schema_usage
    and d.exists_at_all and d.calls_new_helper and d.author_exception_preserved
    and d.blocking_preserved and d.moderation_check_preserved
    and s.exists_at_all and not s.is_security_definer and s.has_hard_cap and s.still_newest_first
    and s.authenticated_exec and not s.anon_exec
    and fc.column_exists and fc.column_not_null and fc.has_now_default and fc.null_first_viewed_at_rows = 0
    and ft.trigger_function_exists and ft.function_preserves_old_value and ft.trigger_attached_before_update_row
    and bs.exact_signature_exists
    and b.exists_at_all and b.is_security_invoker and b.never_uses_random and b.uses_seeded_hash
    and b.uses_author_windowing and b.enforces_publish_cutoff and b.pins_seen_to_session_start
    and b.never_uses_mutable_viewed_at_for_tiering and b.pins_kept_add_to_session_start
    and b.respects_caller_limit and b.authenticated_exec and not b.anon_exec
    and n.no_new_relations_of_concern
  ) as overall_pass
from author_visibility_check a, dispatches_policy_check d, search_dispatches_check s,
     first_viewed_at_column_check fc, first_viewed_at_trigger_check ft,
     board_feed_page_signature_check bs, board_feed_page_check b, no_scope_creep_check n;


-- ============================================================
-- DETAIL — full source of the three changed/added objects, for manual
-- reading alongside the migration file itself.
-- ============================================================
select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'tempa_private' and p.proname = 'author_content_publicly_visible';

select pg_get_expr(pol.polqual, pol.polrelid) as dispatches_select_published_using_clause
from pg_policy pol join pg_class c on c.oid = pol.polrelid
where c.relname = 'dispatches' and pol.polname = 'dispatches_select_published';

select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'search_dispatches';

select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'board_feed_page';

select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'tempa_private' and p.proname = 'dispatch_views_preserve_first_viewed_at';

-- Live data spot-check: confirms the backfill actually ran and that
-- first_viewed_at never exceeds the row's own viewed_at (it should
-- always be <=, since it's either equal, for a never-updated row, or
-- earlier, for a row that has since received later progress updates).
select
  count(*) as total_rows,
  count(*) filter (where first_viewed_at is null) as null_first_viewed_at,
  count(*) filter (where first_viewed_at > viewed_at) as impossible_first_after_latest
from public.dispatch_views;
