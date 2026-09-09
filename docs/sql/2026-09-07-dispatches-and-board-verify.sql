-- Tempa — Dispatches and The Board: read-only post-migration verification.
-- Run this AFTER docs/sql/2026-09-07-dispatches-and-board.sql has been
-- applied. Every statement here is a SELECT — nothing here writes,
-- alters, or deletes anything. Safe to run repeatedly, in any order.
--
-- Each block prints one row with a plain [OK] / [MISSING] / mismatch
-- value so the result is skimmable, matching the same style already
-- used to verify docs/sql/2026-09-06-open-letters.sql live.

-- 1. Table exists, old name is gone.
select
  case when to_regclass('public.dispatches') is not null then '[OK]' else '[MISSING]' end as dispatches_table_exists,
  case when to_regclass('public.open_letters') is null then '[OK]' else '[STILL PRESENT — rename did not happen]' end as open_letters_table_gone;

-- 2. Existing rows survived the rename/ALTER sequence, and every row
--    has a valid title.
select
  count(*) as dispatch_row_count,
  count(*) filter (where title is null or char_length(trim(title)) = 0) as rows_with_missing_or_blank_title,
  count(*) filter (where char_length(title) > 70) as rows_with_title_too_long,
  count(*) filter (where status = 'published') as published_row_count,
  min(published_at) as earliest_published_at,
  max(published_at) as latest_published_at
from public.dispatches;

-- 3. RLS is enabled on every new/renamed table.
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('dispatches', 'dispatch_topics', 'dispatch_moments', 'dispatch_views', 'kept_minds', 'dispatch_shares')
order by relname;

-- 4. Expected policies exist, with the expected command AND role scope
--    each applies to. "roles" is the load-bearing column here — it is
--    exactly what a missing "to authenticated" clause gets wrong (see
--    the migration's own section 6 comment for the bug that shape of
--    mistake caused before it was fixed).
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('dispatches', 'dispatch_topics', 'dispatch_moments', 'dispatch_views', 'kept_minds', 'dispatch_shares')
order by tablename, policyname;

-- 5. Expected constraints exist (renamed + newly added).
select conrelid::regclass as table_name, conname, contype
from pg_constraint
where connamespace = 'public'::regnamespace
  and conrelid::regclass::text in ('public.dispatches', 'public.dispatch_topics', 'public.dispatch_moments', 'public.dispatch_views', 'public.kept_minds', 'public.dispatch_shares')
order by table_name, conname;

-- 6a. Expected indexes exist (renamed + newly added). indexdef (the
--     full reconstructed CREATE INDEX statement) is included
--     specifically so dispatch_shares_one_active_per_dispatch's
--     "WHERE revoked_at IS NULL" partial predicate is directly visible
--     here, not just assumed present.
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('dispatches', 'dispatch_topics', 'dispatch_moments', 'dispatch_shares')
order by tablename, indexname;

-- 6b. The at-most-one-active-share invariant, checked directly against
--     whatever rows actually exist — should always return zero rows.
--     The partial unique index makes a second live row impossible to
--     insert, but this confirms the real effect, not just the index's
--     existence.
select dispatch_id, count(*) as active_share_count
from public.dispatch_shares
where revoked_at is null
group by dispatch_id
having count(*) > 1;

-- 7a. Functions expected to be INVOKER (bound by the caller's own RLS
--     — none of these should ever need elevated privilege).
select p.proname as function_name,
  case p.prosecdef when true then '[WRONG — is DEFINER]' else '[OK — INVOKER]' end as security_mode
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('dispatch_visible_length', 'dispatch_photo_is_visible', 'publish_dispatch', 'search_dispatches', 'dispatch_topics_enforce_max')
order by p.proname;

-- 7b. Functions expected to be DEFINER — genuinely necessary in all
--     four cases, for two DIFFERENT reasons, not one:
--       - get_shared_dispatch, dispatch_photo_is_externally_shared:
--         the caller is anon, which holds no table grants at all.
--       - share_dispatch, revoke_dispatch_share: the caller is
--         authenticated, but authenticated itself no longer holds
--         INSERT/UPDATE on dispatch_shares (see block 9a) — these two
--         functions are now the only write path, by design.
--     Confirm all four are DEFINER; confirm nothing else in this
--     schema is (7c).
select p.proname as function_name,
  case p.prosecdef when true then '[OK — DEFINER]' else '[WRONG — is INVOKER]' end as security_mode
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('get_shared_dispatch', 'dispatch_photo_is_externally_shared', 'share_dispatch', 'revoke_dispatch_share')
order by p.proname;

-- 7c. Every other SECURITY DEFINER function in the public schema,
--     for eyeballing — not necessarily a problem on its own (an
--     unrelated, pre-existing function from an earlier checkpoint may
--     legitimately appear here), but any row NOT already accounted for
--     by an earlier checkpoint's own SQL file is worth a second look.
select p.proname as other_definer_function
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.prosecdef = true
  and p.proname not in ('get_shared_dispatch', 'dispatch_photo_is_externally_shared', 'share_dispatch', 'revoke_dispatch_share');

-- 8. The topics-max-3 trigger is actually attached.
select tgname as trigger_name, tgrelid::regclass as on_table, tgenabled
from pg_trigger
where tgrelid = 'public.dispatch_topics'::regclass
  and not tgisinternal;

-- 9a. Table privileges: PUBLIC and anon must hold nothing on any base
--     table (including dispatch_shares); authenticated must hold
--     exactly the intended verbs. anon's complete absence here is the
--     core security property this whole sharing design rests on — the
--     ONLY things anon may ever call are the two functions in 9b.
--     dispatch_shares specifically must show "select" ONLY for
--     authenticated — no "insert"/"update" — now that share_dispatch/
--     revoke_dispatch_share are the sole write path.
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('dispatches', 'dispatch_topics', 'dispatch_moments', 'dispatch_views', 'kept_minds', 'dispatch_shares')
  and grantee in ('public', 'anon', 'authenticated')
group by table_name, grantee
order by table_name, grantee;

-- 9b. Function privileges. get_shared_dispatch and
--     dispatch_photo_is_externally_shared are the only two rows that
--     should ever show "anon" as a grantee anywhere in this whole
--     verification script — that is the entire anonymous attack
--     surface this migration introduces, by design. share_dispatch and
--     revoke_dispatch_share must show "authenticated" ONLY — if either
--     ever shows "anon" here, that is a serious regression (it would
--     let an anonymous visitor create or revoke share links on
--     someone else's Dispatch merely by guessing a UUID, since the
--     function's own ownership check would then be the only thing
--     stopping them instead of never being reachable at all).
select routine_name, grantee, privilege_type
from information_schema.role_routine_grants
where routine_schema = 'public'
  and routine_name in ('dispatch_photo_is_visible', 'publish_dispatch', 'search_dispatches', 'get_shared_dispatch', 'dispatch_photo_is_externally_shared', 'dispatch_topics_enforce_max', 'share_dispatch', 'revoke_dispatch_share')
  and grantee in ('public', 'anon', 'authenticated')
order by routine_name, grantee;

-- 10. Storage bucket exists and is private (public = false). Sharing
--     must never flip this to true — a shared photo is reachable only
--     through the narrow, function-gated policy in block 11, never by
--     the bucket itself becoming publicly listable/readable.
select id, name, public as bucket_is_public
from storage.buckets
where id = 'dispatch-photos';

-- 11. Storage policies on the dispatch-photos bucket, with role scope.
--     dispatch_photos_insert/select should show {authenticated} only;
--     dispatch_photos_select_shared should show {anon} only. Any row
--     showing a bare "{public}" here (meaning no TO clause was given)
--     is exactly the class of mistake section 6 of the migration
--     fixed once already — treat it as a real finding, not noise.
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname in ('dispatch_photos_insert', 'dispatch_photos_select', 'dispatch_photos_select_shared');

-- 12. Sanity check the visible-length function behaves as intended:
--     a bold-wrapped 9-character phrase ("bold text") should measure
--     as visible 9 characters, not the longer encoded length.
select
  public.dispatch_visible_length('**bold text**') as visible_length_of_bold_wrapped_text,
  char_length('**bold text**') as raw_encoded_length;
-- Expect: visible_length_of_bold_wrapped_text = 9 (the encoded string
-- above has no real marker character, so this only demonstrates the
-- "**" stripping half of the function — it is a smoke test of the
-- regex, not a claim about any specific real Dispatch body).

-- 13. get_shared_dispatch smoke test: a token that cannot possibly
--     exist yet (freshly random, never inserted into dispatch_shares)
--     must return zero rows, not an error and not some other
--     Dispatch's data. This is callable as whatever role you are
--     connected as in the SQL editor; it does not prove anon's own
--     EXECUTE grant by itself (block 9b already checks that grant
--     directly) — it proves the function's own not-found behavior is
--     clean before anyone tries it as anon from the app.
select count(*) as rows_for_a_token_that_does_not_exist
from public.get_shared_dispatch(gen_random_uuid());
-- Expect: 0.

-- 14. If any live share rows already exist by the time you run this
--     (none will, on a first application of this migration), spot
--     check that every one of them round-trips to a published
--     Dispatch and never to an unpublished one.
select
  ds.id as share_token,
  ds.revoked_at,
  d.status as dispatch_status,
  (select count(*) from public.get_shared_dispatch(ds.id)) as rows_returned_by_function
from public.dispatch_shares ds
join public.dispatches d on d.id = ds.dispatch_id;
-- Expect: rows_returned_by_function = 1 wherever revoked_at is null
-- and dispatch_status = 'published'; 0 in every other row.

-- 15. share_dispatch/revoke_dispatch_share signature check — confirms
--     the exact shape the app will call via supabase.rpc('share_
--     dispatch', { p_dispatch_id }) / supabase.rpc('revoke_dispatch_
--     share', { p_dispatch_id }) before any app code is written
--     against it. Not a mutation test (this script stays read-only) —
--     just confirms both functions exist with a single uuid parameter
--     and the expected return type.
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as return_type
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('share_dispatch', 'revoke_dispatch_share')
order by p.proname;
-- Expect: both rows show arguments = "p_dispatch_id uuid". share_
-- dispatch's return_type names the dispatch_shares row type (exact
-- schema-qualification in the output may vary); revoke_dispatch_
-- share's return_type is "void".
