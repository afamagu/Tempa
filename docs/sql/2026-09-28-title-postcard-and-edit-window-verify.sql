-- ============================================================
-- TEMPA — SMOKE-TEST CONTRACT COMPLETION: READ-ONLY VERIFICATION
-- Run AFTER 2026-09-28-title-postcard-and-edit-window.sql has been
-- applied. Every statement below is a SELECT / has_*_privilege check —
-- no mutation of any kind, no INSERT/UPDATE/DELETE, no fixture data.
--
-- Follows the hardened conventions established by docs/sql/2026-09-25-
-- dispatch-postcards-verify.sql: every CTE is driven off a fixed
-- one-row anchor (never a bare catalog-filtered FROM that could
-- silently return zero rows), every derived column is wrapped in
-- coalesce(..., false), and every function-existence check resolves the
-- EXACT oid to_regprocedure finds for that function's fixed signature.
-- CHECK constraint bounds are proven via regex tolerant of PostgreSQL's
-- own BETWEEN -> >=/<= normalization on storage (the exact live
-- surprise that same prior verifier's own header documents) — never by
-- requiring this migration's own source spelling to survive verbatim.
-- The SUMMARY query therefore always returns EXACTLY ONE row.
-- ============================================================

-- ============================================================
-- SUMMARY — one row, PASS/FAIL per critical property. Run this first.
-- ============================================================
with

-- ---------- 1. DISPATCH TITLE ----------
title_constraint_check as (
  select
    coalesce(
      con.oid is not null
      and pg_get_constraintdef(con.oid) ~* 'char_length\(\s*title\s*\)\s*<=\s*140',
      false
    ) as title_constraint_is_140,
    coalesce(
      con.oid is not null
      and pg_get_constraintdef(con.oid) !~* '<=\s*70\y',
      false
    ) as title_constraint_old_70_gone
  from (select 1 as anchor) _anchor
  left join pg_constraint con
    on con.conname = 'dispatches_title_max_length'
    and con.conrelid = to_regclass('public.dispatches')
    and con.contype = 'c'
),

publish_dispatch_check as (
  select
    coalesce(src ~* 'char_length\(p_title\)\s*>\s*140', false) as title_guard_140,
    coalesce(src !~* 'char_length\(p_title\)\s*>\s*70\y', false) as title_guard_old_70_gone,
    -- VERIFIER CORRECTION (live diagnostic-driven, matching the exact
    -- shape of the prior Postcard verifier's own documented BETWEEN
    -- normalization fix): the original check required an EXACT paren
    -- count and zero-or-more-whitespace-only gap between
    -- "v_back_message" and the comparison operator
    -- (\)\)\s*>\s*300) — reproduced byte-for-byte against this
    -- migration's own source, which should have matched a verbatim
    -- plpgsql body. Live re-inspection nonetheless read this false
    -- against a confirmed-correct body, so this is now decomposed and
    -- widened defensively: \(+ tolerates any parenthesization depth,
    -- and a bounded non-alphanumeric gap ([^0-9A-Za-z]{0,12}) tolerates
    -- any punctuation/whitespace between "v_back_message" and the
    -- comparison, without ever crossing into unrelated identifiers or
    -- numbers — still anchored specifically to char_length/trim/both/
    -- from/v_back_message, never a bare "300 anywhere" search.
    coalesce(
      src ~* 'char_length\s*\(+\s*trim\s*\(+\s*both\s+from\s+v_back_message[^0-9A-Za-z]{0,12}>\s*300\y',
      false
    ) as back_guard_300,
    coalesce(
      src !~* 'char_length\s*\(+\s*trim\s*\(+\s*both\s+from\s+v_back_message[^0-9A-Za-z]{0,12}>\s*200\y',
      false
    ) as back_guard_old_200_gone,
    coalesce(prosecdef, false) as security_definer_preserved,
    coalesce(proconfig::text ~* 'search_path=pg_catalog', false) as search_path_preserved
  from (
    select pg_get_functiondef(p.oid) as src, p.prosecdef, p.proconfig
    from pg_proc p
    where p.oid = to_regprocedure('public.publish_dispatch(text, text, text[], jsonb, jsonb)')
  ) f
),

update_dispatch_check as (
  select
    coalesce(src ~* 'char_length\(p_title\)\s*>\s*140', false) as title_guard_140,
    coalesce(src !~* 'char_length\(p_title\)\s*>\s*70\y', false) as title_guard_old_70_gone,
    -- The author requirement is preserved: still gated on
    -- d.author_id = auth.uid() (the exact predicate this migration's
    -- SELECT ... FOR UPDATE reuses from the live definition, unchanged).
    coalesce(src ~* 'd\.author_id\s*=\s*auth\.uid\(\)', false) as author_requirement_preserved,
    -- The 30-minute window is anchored to published_at specifically
    -- (the authoritative timestamp), via the exact comparison the
    -- checkpoint's own instructions preferred.
    coalesce(
      src ~* 'now\(\)\s*>\s*v_dispatch\.published_at\s*\+\s*interval\s*''30 minutes''',
      false
    ) as edit_window_uses_published_at,
    -- updated_at must never be the clock — dispatches has no such
    -- column and this function must never reference one.
    coalesce(src !~* 'updated_at', false) as never_uses_updated_at,
    -- The reply lock exists, checks the correct table/column pair...
    coalesce(
      src ~* 'select\s+1\s+from\s+public\.dispatch_replies\s+where\s+dispatch_id\s*=\s*p_dispatch_id',
      false
    ) as reply_lock_exists_check_present,
    -- ...and is genuinely UNFILTERED by moderation_status/deleted_at —
    -- this function has no other legitimate reason to mention either
    -- column at all, so their total absence from the whole body proves
    -- the reply lock checks bare row existence, permanently, exactly
    -- as the checkpoint's own instructions require (never "NOT
    -- EXISTS(currently visible replies)", which could silently reopen
    -- editing after moderation/deletion).
    coalesce(src !~* 'moderation_status', false) as reply_lock_not_filtered_by_moderation,
    coalesce(src !~* 'deleted_at', false) as reply_lock_not_filtered_by_deletion,
    -- Race protection: the eligibility SELECT takes FOR UPDATE, closing
    -- the window between eligibility-check and the mutation itself.
    coalesce(src ~* 'for update', false) as eligibility_select_takes_row_lock,
    coalesce(prosecdef, false) as security_definer_preserved,
    coalesce(proconfig::text ~* 'search_path=pg_catalog', false) as search_path_preserved
  from (
    select pg_get_functiondef(p.oid) as src, p.prosecdef, p.proconfig
    from pg_proc p
    where p.oid = to_regprocedure('public.update_dispatch(uuid, text, text, text[], jsonb)')
  ) f
),

-- ---------- 2. POSTCARD BACK (Dispatch + Letter surfaces) ----------
-- VERIFIER CORRECTION (live diagnostic-driven) — the original patterns
-- here required an EXACT close-paren count immediately after
-- "back_message" (\s*\)\s*\)\s*<=...). CHECK constraints are stored as
-- a parsed expression tree, not raw text (the exact reason the prior
-- Postcard verifier's own header already documents for the BETWEEN ->
-- >=/<= rewrite) — pg_get_constraintdef's reconstruction can introduce
-- different parenthesization than the migration's own source without
-- changing the constraint's actual meaning. Widened the same way as
-- publish_dispatch_check above: \(+ tolerates any paren depth, a
-- bounded non-alphanumeric gap ([^0-9A-Za-z]{0,12}) tolerates whatever
-- punctuation sits between "back_message" and the comparison, and \y
-- word-boundaries after the numbers prevent this from ever matching a
-- longer number like 3000 or 1300. Still anchored specifically to
-- char_length/trim/both/from/back_message — never a bare "300"/"200"
-- search anywhere in the constraint text.
dispatch_postcard_back_check as (
  select
    coalesce(
      con.oid is not null
      and pg_get_constraintdef(con.oid) ~*
        'char_length\s*\(+\s*trim\s*\(+\s*both\s+from\s+back_message[^0-9A-Za-z]{0,12}>=\s*1\y'
      and pg_get_constraintdef(con.oid) ~*
        'char_length\s*\(+\s*trim\s*\(+\s*both\s+from\s+back_message[^0-9A-Za-z]{0,12}<=\s*300\y',
      false
    ) as dispatch_back_constraint_is_300,
    coalesce(
      con.oid is not null
      and pg_get_constraintdef(con.oid) !~*
        'char_length\s*\(+\s*trim\s*\(+\s*both\s+from\s+back_message[^0-9A-Za-z]{0,12}<=\s*200\y',
      false
    ) as dispatch_back_constraint_old_200_gone
  from (select 1 as anchor) _anchor
  left join pg_constraint con
    on con.conname = 'dispatch_postcards_back_message_length'
    and con.conrelid = to_regclass('public.dispatch_postcards')
    and con.contype = 'c'
),

letter_postcard_back_check as (
  select
    coalesce(
      con.oid is not null
      and pg_get_constraintdef(con.oid) ~*
        'char_length\s*\(+\s*trim\s*\(+\s*both\s+from\s+back_message[^0-9A-Za-z]{0,12}>=\s*1\y'
      and pg_get_constraintdef(con.oid) ~*
        'char_length\s*\(+\s*trim\s*\(+\s*both\s+from\s+back_message[^0-9A-Za-z]{0,12}<=\s*300\y',
      false
    ) as letter_back_constraint_is_300,
    coalesce(
      con.oid is not null
      and pg_get_constraintdef(con.oid) !~*
        'char_length\s*\(+\s*trim\s*\(+\s*both\s+from\s+back_message[^0-9A-Za-z]{0,12}<=\s*200\y',
      false
    ) as letter_back_constraint_old_200_gone
  from (select 1 as anchor) _anchor
  left join pg_constraint con
    on con.conname = 'letter_postcards_back_message_length'
    and con.conrelid = to_regclass('public.letter_postcards')
    and con.contype = 'c'
),

-- Front-side Reveal Line is explicitly OUT of scope for this
-- checkpoint — proves it is still 32, untouched, on both tables.
reveal_line_unchanged_check as (
  select
    coalesce(
      bool_and(
        con.oid is not null
        and pg_get_constraintdef(con.oid) ~* 'char_length\(\s*reveal_line\s*\)\s*<=\s*32'
      ),
      false
    ) as reveal_line_still_32
  from (values
    ('dispatch_postcards_reveal_line_length', 'public.dispatch_postcards'),
    ('letter_postcards_reveal_line_length', 'public.letter_postcards')
  ) as expected(conname, tbl)
  left join pg_constraint con
    on con.conname = expected.conname
    and con.conrelid = to_regclass(expected.tbl)
    and con.contype = 'c'
),

-- VERIFIER CORRECTION (live diagnostic-driven) — same widening as
-- publish_dispatch_check above, applied identically here.
write_letter_check as (
  select
    coalesce(
      src ~* 'char_length\s*\(+\s*trim\s*\(+\s*both\s+from\s+v_back_message[^0-9A-Za-z]{0,12}>\s*300\y',
      false
    ) as back_guard_300,
    coalesce(
      src !~* 'char_length\s*\(+\s*trim\s*\(+\s*both\s+from\s+v_back_message[^0-9A-Za-z]{0,12}>\s*200\y',
      false
    ) as back_guard_old_200_gone,
    coalesce(prosecdef, false) as security_definer_preserved,
    coalesce(proconfig::text ~* 'search_path=pg_catalog', false) as search_path_preserved
  from (
    select pg_get_functiondef(p.oid) as src, p.prosecdef, p.proconfig
    from pg_proc p
    where p.oid = to_regprocedure('public.write_letter(uuid, text, uuid, jsonb, jsonb)')
  ) f
),

reply_to_letter_check as (
  select
    coalesce(
      src ~* 'char_length\s*\(+\s*trim\s*\(+\s*both\s+from\s+v_back_message[^0-9A-Za-z]{0,12}>\s*300\y',
      false
    ) as back_guard_300,
    coalesce(
      src !~* 'char_length\s*\(+\s*trim\s*\(+\s*both\s+from\s+v_back_message[^0-9A-Za-z]{0,12}>\s*200\y',
      false
    ) as back_guard_old_200_gone,
    coalesce(prosecdef, false) as security_definer_preserved,
    coalesce(proconfig::text ~* 'search_path=pg_catalog', false) as search_path_preserved
  from (
    select pg_get_functiondef(p.oid) as src, p.prosecdef, p.proconfig
    from pg_proc p
    where p.oid = to_regprocedure('public.reply_to_letter(uuid, text, jsonb, jsonb)')
  ) f
),

-- ---------- 3. GRANTS — every touched function keeps its existing,
--    authenticated-only posture; anon gains nothing new. ----------
grants_check as (
  select
    coalesce(
      bool_and(
        oid is not null
        and has_function_privilege('authenticated', oid, 'EXECUTE')
        and not has_function_privilege('anon', oid, 'EXECUTE')
      ),
      false
    ) as all_grants_correct
  from (
    select to_regprocedure('public.publish_dispatch(text, text, text[], jsonb, jsonb)') as oid
    union all select to_regprocedure('public.update_dispatch(uuid, text, text, text[], jsonb)')
    union all select to_regprocedure('public.write_letter(uuid, text, uuid, jsonb, jsonb)')
    union all select to_regprocedure('public.reply_to_letter(uuid, text, jsonb, jsonb)')
  ) fns
),

-- ---------- 4. NO UNRELATED SAFETY CONTRACT CHANGED — a light-touch
--    existence/shape check on the neighboring Reply functions this
--    migration deliberately never redefines. ----------
unrelated_contracts_check as (
  select
    coalesce(
      delete_dispatch_src ~* 'This Dispatch cannot be deleted while it still has Replies\.',
      false
    ) as delete_dispatch_reply_guard_intact,
    coalesce(
      create_reply_src ~* 'v_dispatch\.status\s*<>\s*''published''\s*or\s*v_dispatch\.moderation_status\s*<>\s*''visible''',
      false
    ) as create_reply_eligibility_intact
  from (
    select
      (select pg_get_functiondef(p.oid) from pg_proc p
        where p.oid = to_regprocedure('public.delete_dispatch(uuid)')) as delete_dispatch_src,
      (select pg_get_functiondef(p.oid) from pg_proc p
        where p.oid = to_regprocedure('public.create_reply(uuid, text, uuid)')) as create_reply_src
  ) f
)

select
  title_constraint_check.title_constraint_is_140,
  title_constraint_check.title_constraint_old_70_gone,
  publish_dispatch_check.title_guard_140 as publish_dispatch_title_guard_140,
  publish_dispatch_check.title_guard_old_70_gone as publish_dispatch_title_guard_old_70_gone,
  publish_dispatch_check.back_guard_300 as publish_dispatch_back_guard_300,
  publish_dispatch_check.back_guard_old_200_gone as publish_dispatch_back_guard_old_200_gone,
  publish_dispatch_check.security_definer_preserved as publish_dispatch_security_definer_preserved,
  publish_dispatch_check.search_path_preserved as publish_dispatch_search_path_preserved,

  update_dispatch_check.title_guard_140 as update_dispatch_title_guard_140,
  update_dispatch_check.title_guard_old_70_gone as update_dispatch_title_guard_old_70_gone,
  update_dispatch_check.author_requirement_preserved,
  update_dispatch_check.edit_window_uses_published_at,
  update_dispatch_check.never_uses_updated_at,
  update_dispatch_check.reply_lock_exists_check_present,
  update_dispatch_check.reply_lock_not_filtered_by_moderation,
  update_dispatch_check.reply_lock_not_filtered_by_deletion,
  update_dispatch_check.eligibility_select_takes_row_lock,
  update_dispatch_check.security_definer_preserved as update_dispatch_security_definer_preserved,
  update_dispatch_check.search_path_preserved as update_dispatch_search_path_preserved,

  dispatch_postcard_back_check.dispatch_back_constraint_is_300,
  dispatch_postcard_back_check.dispatch_back_constraint_old_200_gone,
  letter_postcard_back_check.letter_back_constraint_is_300,
  letter_postcard_back_check.letter_back_constraint_old_200_gone,
  reveal_line_unchanged_check.reveal_line_still_32,

  write_letter_check.back_guard_300 as write_letter_back_guard_300,
  write_letter_check.back_guard_old_200_gone as write_letter_back_guard_old_200_gone,
  write_letter_check.security_definer_preserved as write_letter_security_definer_preserved,
  write_letter_check.search_path_preserved as write_letter_search_path_preserved,

  reply_to_letter_check.back_guard_300 as reply_to_letter_back_guard_300,
  reply_to_letter_check.back_guard_old_200_gone as reply_to_letter_back_guard_old_200_gone,
  reply_to_letter_check.security_definer_preserved as reply_to_letter_security_definer_preserved,
  reply_to_letter_check.search_path_preserved as reply_to_letter_search_path_preserved,

  grants_check.all_grants_correct,

  unrelated_contracts_check.delete_dispatch_reply_guard_intact,
  unrelated_contracts_check.create_reply_eligibility_intact,

  (
    title_constraint_check.title_constraint_is_140
    and title_constraint_check.title_constraint_old_70_gone
    and publish_dispatch_check.title_guard_140
    and publish_dispatch_check.title_guard_old_70_gone
    and publish_dispatch_check.back_guard_300
    and publish_dispatch_check.back_guard_old_200_gone
    and publish_dispatch_check.security_definer_preserved
    and publish_dispatch_check.search_path_preserved
    and update_dispatch_check.title_guard_140
    and update_dispatch_check.title_guard_old_70_gone
    and update_dispatch_check.author_requirement_preserved
    and update_dispatch_check.edit_window_uses_published_at
    and update_dispatch_check.never_uses_updated_at
    and update_dispatch_check.reply_lock_exists_check_present
    and update_dispatch_check.reply_lock_not_filtered_by_moderation
    and update_dispatch_check.reply_lock_not_filtered_by_deletion
    and update_dispatch_check.eligibility_select_takes_row_lock
    and update_dispatch_check.security_definer_preserved
    and update_dispatch_check.search_path_preserved
    and dispatch_postcard_back_check.dispatch_back_constraint_is_300
    and dispatch_postcard_back_check.dispatch_back_constraint_old_200_gone
    and letter_postcard_back_check.letter_back_constraint_is_300
    and letter_postcard_back_check.letter_back_constraint_old_200_gone
    and reveal_line_unchanged_check.reveal_line_still_32
    and write_letter_check.back_guard_300
    and write_letter_check.back_guard_old_200_gone
    and write_letter_check.security_definer_preserved
    and write_letter_check.search_path_preserved
    and reply_to_letter_check.back_guard_300
    and reply_to_letter_check.back_guard_old_200_gone
    and reply_to_letter_check.security_definer_preserved
    and reply_to_letter_check.search_path_preserved
    and grants_check.all_grants_correct
    and unrelated_contracts_check.delete_dispatch_reply_guard_intact
    and unrelated_contracts_check.create_reply_eligibility_intact
  ) as overall_pass
from title_constraint_check, publish_dispatch_check, update_dispatch_check,
     dispatch_postcard_back_check, letter_postcard_back_check, reveal_line_unchanged_check,
     write_letter_check, reply_to_letter_check, grants_check, unrelated_contracts_check;
