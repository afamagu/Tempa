-- Tempa — search_letterbox verification. Read-only.
--
-- search_letterbox depends entirely on auth.uid(), which reads the
-- request's JWT claims. The SQL editor has no JWT by default, so
-- auth.uid() is null there and every call raises "Authentication
-- required." To exercise the real per-user logic, impersonate a
-- specific member for the statements that need it (standard local/SQL
-- editor testing pattern — this does not touch RLS or grant anything
-- new, it only sets the session's claim for auth.uid() to read):
--
--   select set_config(
--     'request.jwt.claims',
--     json_build_object('sub', '<a real auth.users.id>', 'role', 'authenticated')::text,
--     true
--   );
--   set local role authenticated;
--
-- Run those two statements once per scenario below (swapping the
-- uuid), then the query under that scenario, in the same transaction
-- (BEGIN; ... the two statements ...; the query; ROLLBACK; — or just
-- run them together in one SQL editor "Run" if it executes as one
-- implicit transaction).

-- ============================================================
-- 1. Function signature / security properties — no impersonation
--    needed, this is plain catalog introspection.
-- ============================================================

select
  p.proname,
  p.prosecdef as is_security_definer,
  p.proconfig,
  pg_get_function_identity_arguments(p.oid) as args,
  pg_get_function_result(p.oid) as return_type
from pg_proc p
where p.proname = 'search_letterbox'
  and p.pronamespace = 'public'::regnamespace;
-- expect: is_security_definer = true; proconfig contains
-- "search_path=pg_catalog" (NOT "search_path=public"); args match
-- (text, int, int, int) with the documented defaults; return_type
-- matches the 9-column TABLE shape.

-- Do NOT assert that information_schema.routine_privileges contains
-- exactly one row for this function — owner privileges (and possibly
-- other implicit grants) may legitimately appear there too, so a bare
-- row-count check is the wrong assertion. Instead check specific
-- grantees individually:

select exists (
  select 1 from information_schema.routine_privileges
  where routine_name = 'search_letterbox'
    and grantee = 'authenticated'
    and privilege_type = 'EXECUTE'
) as authenticated_can_execute;
-- expect: true

select exists (
  select 1 from information_schema.routine_privileges
  where routine_name = 'search_letterbox'
    and grantee = 'anon'
    and privilege_type = 'EXECUTE'
) as anon_can_execute;
-- expect: false

select exists (
  select 1 from information_schema.routine_privileges
  where routine_name = 'search_letterbox'
    and grantee = 'PUBLIC'
    and privilege_type = 'EXECUTE'
) as public_can_execute;
-- expect: false

-- ============================================================
-- 2. Authenticated search returns known letter text.
--    Impersonate a member you know sent/received a letter containing
--    a specific word, then:
-- ============================================================

select * from public.search_letterbox('REPLACE_WITH_KNOWN_WORD');
-- expect a kind='letter' row for that letter; excerpt contains the
-- matched word wrapped in ⟦⟦...⟧⟧, not any HTML tag.

-- ============================================================
-- 3. Pseudonym search returns a known correspondent.
--    Same impersonation (or a different member), then:
-- ============================================================

select * from public.search_letterbox('REPLACE_WITH_PART_OF_A_CORRESPONDENT_PSEUDONYM');
-- expect a kind='person' row for that correspondent, and ONLY that
-- correspondent even if the substring could match other real Tempa
-- members who never corresponded with this caller.

-- ============================================================
-- 4. A hidden correspondence never returns results.
--    Impersonate a member who has hidden at least one correspondence,
--    then search a word/pseudonym that exists ONLY in that hidden
--    correspondence:
-- ============================================================

select * from public.search_letterbox('REPLACE_WITH_WORD_ONLY_IN_HIDDEN_CORRESPONDENCE');
-- expect zero rows.

-- ============================================================
-- 5. A member cannot see another member's unrelated letters.
--    Impersonate member A; search a word you know exists ONLY in a
--    letter exchanged between two OTHER members (A is neither sender
--    nor recipient):
-- ============================================================

select * from public.search_letterbox('REPLACE_WITH_WORD_FROM_UNRELATED_CORRESPONDENCE');
-- expect zero rows.

-- ============================================================
-- 6. Empty / malformed queries never throw and never return
--    "everything." Impersonation still required (this exercises the
--    query-handling branch, not the auth branch).
-- ============================================================

select * from public.search_letterbox('');
select * from public.search_letterbox('   ');
-- expect zero rows for both, no exception.

select * from public.search_letterbox('??? --- !!!');
-- expect zero rows, no exception — proves websearch_to_tsquery's
-- documented tolerance for malformed/punctuation-only input actually
-- holds through this RPC, not just in isolation.

select * from public.search_letterbox(null);
-- expect zero rows, no exception (coalesce(p_query, '') handles this).
