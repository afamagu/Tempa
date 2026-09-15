-- ============================================================
-- TEMPA — BOARD EXPERIENCE, PHASE 2C: READ-ONLY VERIFICATION
-- Run AFTER 2026-09-24-dispatch-worth-reading.sql has been applied.
-- Every statement below is a SELECT/has_*_privilege check — no
-- mutation of any kind.
--
-- Follows the hardened conventions established by docs/sql/2026-09-23-
-- dispatch-replies-verify.sql: every CTE is driven off a fixed one-row
-- anchor or a fixed VALUES list (never a bare catalog-filtered FROM
-- that could silently return zero rows), every derived column is
-- wrapped in coalesce(..., false), and every function-existence check
-- LEFT JOINs pg_proc by the EXACT oid to_regprocedure resolves for
-- that function's fixed signature, not merely by proname. The SUMMARY
-- query below is therefore guaranteed to return EXACTLY ONE row
-- against any reachable database.
--
-- FINAL SECURITY/HARDENING PATCH (2026-09-24 follow-up) — new/changed
-- checks:
--   grant_check now also proves anon has none of INSERT/UPDATE/DELETE
--     on the table (previously only anon SELECT was checked).
--   function_check now also proves: search_path is fixed to exactly
--     pg_catalog via pg_proc.proconfig introspection (not text-
--     matching the function's own pretty-printed SET clause — proconfig
--     is the actual stored GUC array, immune to any formatting
--     variance); NULL p_worth_reading is explicitly rejected; the true
--     branch's Dispatch SELECT takes FOR SHARE. The false-branch/
--     account-status position() ordering check now requires BOTH
--     positions to be > 0 (a substring genuinely found) before
--     comparing them — position() returns 0, not NULL, for a missing
--     substring, so an unguarded `pos_a < pos_b` could previously have
--     passed on a false premise (0 < 0 is false, correctly failing, but
--     0 < N for any real N > 0 would WRONGLY read as "correctly
--     ordered" even though the first substring was never found at all).
--   block_user_check is new: proves the CURRENT public.block_user(uuid,
--     text) — exact signature, SECURITY DEFINER, search_path — also now
--     clears dispatch_worth_reading in both directions, scoped strictly
--     inside the existing FULL-only branch (never reachable for a
--     letters-only block), via three independent proofs: (1) an
--     adjacent-fragment ilike pattern spanning the full-branch guard
--     through both DELETEs to the branch's own closing `end if;`, (2) a
--     position()-ordering check (both positions > 0) proving the
--     cleanup's own DELETE text appears strictly after the full-branch
--     guard, and (3) an exact-occurrence-count proof that the
--     dispatch_worth_reading DELETE appears exactly once in the whole
--     function body (ruling out a second, unconditional/letters-reachable
--     copy existing anywhere else).
--
-- FINAL CONCURRENCY FIX (2026-09-24 follow-up) — new checks:
--   function_check now also proves set_dispatch_worth_reading's true
--     branch takes the shared member-pair lock (SHARE mode, both
--     `auth.uid() < v_dispatch.author_id` orderings present via an
--     adjacent-fragment ilike spanning the full if/else) BEFORE the
--     is_blocked_pair check (position(), both positions > 0).
--   block_user_check now also proves block_user takes the SAME pair
--     lock (UPDATE mode, both `auth.uid() < p_blocked_id` orderings)
--     BEFORE the blocked_users upsert (position(), both positions > 0)
--     — the shared ascending-uuid ordering between the two functions is
--     what makes the pair genuinely shared and the scheme deadlock-free
--     (see the migration's own header comment for the full reasoning).
--
-- VERIFIER FIX (2026-09-24 follow-up, live-diagnostic-driven): the
-- migration is LIVE and unchanged by this pass — only six pg_get_
-- functiondef text checks were failing against the live function
-- bodies, and only because they were whitespace/pretty-print-sensitive
-- (an exact-ilike literal expects one specific run of whitespace at
-- each gap; Postgres's own stored/reformatted source can legitimately
-- differ there — extra spaces, a wrapped line — without the underlying
-- code being wrong). A separate live read-only diagnostic confirmed all
-- six pass once whitespace is normalized. Fixed by evaluating those six
-- specific predicates against `regexp_replace(lower(pg_get_functiondef(
-- p.oid)), '[[:space:]]+', ' ', 'g')` (every run of whitespace —
-- spaces, tabs, newlines — collapsed to exactly one space, case
-- folded) instead of the raw pretty-printed text, using the SAME
-- pattern literals (already single-space, already-lowercase in this
-- codebase's own SQL style) with `like` in place of `ilike` (redundant
-- once the source is already lower-cased, but harmless). Every OTHER
-- check in this file — including every other ilike/position() text
-- check — is UNCHANGED: the diagnostic confirmed those already pass
-- against the live database, and this pass touches nothing that isn't
-- one of the six named failures:
--   function_check.requires_published_and_visible
--   function_check.checks_author_public_visibility
--   function_check.pair_lock_uses_deterministic_order
--   function_check.pair_lock_precedes_is_blocked_pair
--   block_user_check.worth_reading_cleanup_both_directions
--   block_user_check.pair_lock_uses_deterministic_order
-- overall_pass's own dependency list is unchanged — every column it
-- already named still contributes the exact same way; only the
-- underlying expression computing six of those columns' values changed.
--
-- VERIFIER ROBUSTNESS PATCH (2026-09-24 follow-up): the migration is
-- LIVE and unchanged by this pass too — after the whitespace-
-- normalization fix above, exactly THREE predicates still read false
-- live (a prior independent live diagnostic already proved all three
-- underlying behaviors true): checks_author_public_visibility,
-- pair_lock_precedes_is_blocked_pair, worth_reading_cleanup_both_
-- directions. Cause: `regexp_replace(..., '[[:space:]]+', ' ', 'g')`
-- collapses RUNS of whitespace to one space, but does not (and cannot)
-- REMOVE a single space that already sits directly inside a pair of
-- parentheses — a pattern like '%foo(bar)%' still fails to match
-- Postgres's own reformatted '%foo( bar )%'. Fixed by relaxing exactly
-- these three predicates from exact-adjacency substrings to STRUCTURE/
-- ORDER checks: each now proves the relevant TOKENS are present, in
-- the expected order, joined by '%' wildcards instead of concatenated
-- with no gap — tolerant of whatever punctuation/whitespace sits
-- between them (spaces just inside parens, a wrapped subquery, etc.)
-- while still proving the same real property. Every other predicate in
-- this file is UNCHANGED.
-- ============================================================

-- ============================================================
-- SUMMARY — one row, PASS/FAIL per critical property. Run this first.
-- ============================================================
with
table_check as (
  select
    exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'dispatch_worth_reading'
    ) as table_exists,
    exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'dispatch_worth_reading' and c.relrowsecurity
    ) as rls_enabled
),
-- Column shape, driven off a fixed 3-row VALUES list, so this always
-- returns one row regardless of whether the table exists.
column_check as (
  select
    bool_and(present) as all_columns_present
  from (
    select
      col_name,
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'dispatch_worth_reading'
          and column_name = col_name
          and (is_nullable = expected_nullable)
      ) as present
    from (values
      ('dispatch_id', 'NO'),
      ('user_id', 'NO'),
      ('created_at', 'NO')
    ) as expected(col_name, expected_nullable)
  ) as checked
),
-- Both FKs must CASCADE — a deleted Dispatch or a deleted account
-- should never leave an orphaned worth-reading mark behind, and (per
-- the product contract) there is no member-facing hard-delete path for
-- this table that a cascade could interact with badly, unlike
-- dispatch_replies' own deliberately-NOT-cascading dispatch_id.
fk_check as (
  select
    bool_and(
      actual.oid is not null
      and actual.confdeltype = expected.expected_deltype
      and actual.confrelid = to_regclass(expected.expected_target)
    ) as all_fks_correct
  from (values
    ('dispatch_worth_reading_dispatch_id_fkey', 'c', 'public.dispatches'),
    ('dispatch_worth_reading_user_id_fkey', 'c', 'auth.users')
  ) as expected(conname, expected_deltype, expected_target)
  left join pg_constraint actual
    on actual.conname = expected.conname
    and actual.conrelid = to_regclass('public.dispatch_worth_reading')
    and actual.contype = 'f'
),
-- Composite primary key on (dispatch_id, user_id) — a member can only
-- ever have one row per Dispatch, which is what makes the RPC's own
-- ON CONFLICT DO NOTHING correct.
pk_check as (
  select
    coalesce(
      bool_and(att.attname in ('dispatch_id', 'user_id')) and count(*) = 2,
      false
    ) as has_composite_pk_on_both_columns
  from (select 1 as anchor) _anchor
  left join pg_constraint con
    on con.conrelid = to_regclass('public.dispatch_worth_reading')
    and con.contype = 'p'
  left join lateral unnest(con.conkey) as k(attnum) on true
  left join pg_attribute att
    on att.attrelid = con.conrelid and att.attnum = k.attnum
),
-- RLS: authenticated may SELECT only their own rows; nothing else.
-- pg_get_expr's pretty-printed form is tolerated loosely via `~*`
-- rather than an exact ilike, matching the Reply verifier's own fix
-- for this exact brittleness (docs/sql/2026-09-23-dispatch-replies-
-- verify.sql weakness F).
policy_check as (
  select
    pol.polname is not null as exists_at_all,
    coalesce(
      pg_get_expr(pol.polqual, pol.polrelid) ~* 'auth\.uid\(\)\s*=\s*user_id',
      false
    ) as scoped_to_own_user_id
  from (select 1 as anchor) _anchor
  left join pg_policy pol
    on pol.polname = 'dispatch_worth_reading_own'
    and pol.polrelid = to_regclass('public.dispatch_worth_reading')
),
-- Table itself: SELECT only to authenticated, nothing at all to anon —
-- and critically NO direct INSERT/UPDATE/DELETE grant to EITHER role —
-- every mutation must be RPC-only. Guarded against a missing table
-- (has_table_privilege errors on an unresolvable relation name).
grant_check as (
  select
    case when to_regclass('public.dispatch_worth_reading') is null then false
      else has_table_privilege('authenticated', 'public.dispatch_worth_reading', 'SELECT') end as authenticated_select,
    case when to_regclass('public.dispatch_worth_reading') is null then false
      else not has_table_privilege('authenticated', 'public.dispatch_worth_reading', 'INSERT') end as authenticated_no_insert,
    case when to_regclass('public.dispatch_worth_reading') is null then false
      else not has_table_privilege('authenticated', 'public.dispatch_worth_reading', 'UPDATE') end as authenticated_no_update,
    case when to_regclass('public.dispatch_worth_reading') is null then false
      else not has_table_privilege('authenticated', 'public.dispatch_worth_reading', 'DELETE') end as authenticated_no_delete,
    case when to_regclass('public.dispatch_worth_reading') is null then false
      else not has_table_privilege('anon', 'public.dispatch_worth_reading', 'SELECT') end as anon_no_select,
    -- FINAL SECURITY/HARDENING PATCH: previously only anon SELECT was
    -- checked — anon INSERT/UPDATE/DELETE were merely assumed absent.
    case when to_regclass('public.dispatch_worth_reading') is null then false
      else not has_table_privilege('anon', 'public.dispatch_worth_reading', 'INSERT') end as anon_no_insert,
    case when to_regclass('public.dispatch_worth_reading') is null then false
      else not has_table_privilege('anon', 'public.dispatch_worth_reading', 'UPDATE') end as anon_no_update,
    case when to_regclass('public.dispatch_worth_reading') is null then false
      else not has_table_privilege('anon', 'public.dispatch_worth_reading', 'DELETE') end as anon_no_delete
),
-- set_dispatch_worth_reading — the sole write path, both directions.
-- Joined against the EXACT oid to_regprocedure resolves for this fixed
-- signature, not merely by proname (docs/sql/2026-09-23-dispatch-
-- replies-verify.sql weakness G).
function_check as (
  select
    to_regprocedure('public.set_dispatch_worth_reading(uuid, boolean)') is not null as exact_signature_exists,
    p.oid is not null as exists_at_all,
    coalesce(p.prosecdef, false) as is_security_definer,
    -- search_path introspected from pg_proc.proconfig directly (the
    -- actual stored GUC array Postgres evaluates), not text-matched
    -- against the function's own pretty-printed SET clause — immune to
    -- any quoting/formatting variance pg_get_functiondef might produce.
    coalesce(
      exists (select 1 from unnest(p.proconfig) cfg where cfg = 'search_path=pg_catalog'),
      false
    ) as search_path_fixed,
    coalesce(pg_get_functiondef(p.oid) ilike '%current_account_status()%', false) as checks_account_status,
    coalesce(pg_get_functiondef(p.oid) ilike '%is_blocked_pair%', false) as checks_blocking,
    coalesce(not (pg_get_functiondef(p.oid) ilike '%is_correspondence_blocked_pair%'), false)
      as never_uses_letters_only_helper,
    -- VERIFIER FIX: whitespace-normalized (see this file's own header
    -- comment) — was failing live purely on whitespace/pretty-print
    -- variance in the stored function body, not a real defect.
    coalesce(
      regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', ' ', 'g') like '%v_dispatch.status <> ''published'' or v_dispatch.moderation_status <> ''visible''%',
      false
    ) as requires_published_and_visible,
    coalesce(pg_get_functiondef(p.oid) ilike '%v_dispatch.author_id = auth.uid()%', false)
      as rejects_own_dispatch,
    -- VERIFIER FIX: whitespace-normalized (see this file's own header).
    -- VERIFIER ROBUSTNESS PATCH: relaxed from exact call adjacency
    -- (`author_content_publicly_visible(v_dispatch.author_id)`, which a
    -- single internal space right after `(` or before `)` in Postgres's
    -- own reformatted source would fail to match even post-normalization)
    -- to a STRUCTURE/ORDER proof — both tokens present, in the expected
    -- order, tolerant of whatever sits between them.
    coalesce(
      regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', ' ', 'g')
        like '%author_content_publicly_visible%v_dispatch.author_id%',
      false
    ) as checks_author_public_visibility,
    coalesce(pg_get_functiondef(p.oid) ilike '%on conflict (dispatch_id, user_id) do nothing%', false)
      as inserts_idempotently,
    coalesce(
      pg_get_functiondef(p.oid) ilike '%delete from public.dispatch_worth_reading%where dispatch_id = p_dispatch_id%and user_id = auth.uid()%',
      false
    ) as false_branch_deletes_only_own_row,
    -- FINAL SECURITY/HARDENING PATCH, correction A: NULL is explicitly
    -- rejected — scoped to require the check to occur strictly BEFORE
    -- the true-branch's own INSERT (never merely present somewhere).
    coalesce(
      pg_get_functiondef(p.oid) ilike '%p_worth_reading is null%Worth Reading state is required%insert into public.dispatch_worth_reading%',
      false
    ) as rejects_null_worth_reading,
    -- FINAL SECURITY/HARDENING PATCH, correction C: the true branch's
    -- Dispatch read takes FOR SHARE — scoped to the exact SELECT it
    -- belongs to, not merely "FOR SHARE occurs somewhere."
    coalesce(
      pg_get_functiondef(p.oid) ilike
        '%from public.dispatches%where id = p_dispatch_id%for share%',
      false
    ) as dispatch_select_uses_for_share,
    -- The false branch must be reachable before, and independent of,
    -- the account-status/blocking/Dispatch-state checks below it —
    -- undoing your own mark is de-escalating and always available.
    -- FINAL SECURITY/HARDENING PATCH (IMPORTANT correction): position()
    -- returns 0, not NULL, when a substring is absent — so BOTH
    -- positions must be proven > 0 (genuinely found) before comparing
    -- them, or a missing substring could otherwise read as "correctly
    -- ordered" purely because 0 is less than whatever the other,
    -- possibly-unrelated position happens to be.
    coalesce(
      position('p_worth_reading = false' in pg_get_functiondef(p.oid)) > 0
      and position('current_account_status()' in pg_get_functiondef(p.oid)) > 0
      and position('p_worth_reading = false' in pg_get_functiondef(p.oid))
        < position('current_account_status()' in pg_get_functiondef(p.oid)),
      false
    ) as false_branch_precedes_account_status_gate,
    -- FINAL CONCURRENCY FIX: the shared member-pair lock — SHARE mode
    -- on both public.profiles rows, in ascending-uuid order (both
    -- branches of the if/else present, proving the ordering is
    -- deterministic rather than "caller first") — adjacent-fragment
    -- ilike spanning the full if/else block.
    -- VERIFIER FIX: whitespace-normalized, same reasoning as above.
    coalesce(
      regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', ' ', 'g') like
        '%if auth.uid() < v_dispatch.author_id then%from public.profiles where id = auth.uid() for share%from public.profiles where id = v_dispatch.author_id for share%else%from public.profiles where id = v_dispatch.author_id for share%from public.profiles where id = auth.uid() for share%end if;%',
      false
    ) as pair_lock_uses_deterministic_order,
    -- Both positions > 0 before comparing (same IMPORTANT-correction
    -- discipline as every other position() check in this verifier) —
    -- proves the pair lock is acquired BEFORE the is_blocked_pair read,
    -- closing the concurrency race against block_user. VERIFIER FIX:
    -- both position() calls now search the SAME whitespace-normalized
    -- text, for the same reason as this file's other five fixes.
    -- VERIFIER ROBUSTNESS PATCH: the block-helper search term is now
    -- the robust bare token `tempa_private.is_blocked_pair`, not the
    -- full exact call (`tempa_private.is_blocked_pair(auth.uid(),
    -- v_dispatch.author_id)`) — a single internal space Postgres's own
    -- reformatting can introduce right after `(` or around `,` would
    -- otherwise still defeat the match even post-normalization. Still
    -- proves the deterministic pair-lock guard exists, the block helper
    -- exists, and the guard's position precedes the helper's.
    coalesce(
      position('if auth.uid() < v_dispatch.author_id then' in regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', ' ', 'g')) > 0
      and position('tempa_private.is_blocked_pair' in regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', ' ', 'g')) > 0
      and position('if auth.uid() < v_dispatch.author_id then' in regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', ' ', 'g'))
        < position('tempa_private.is_blocked_pair' in regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', ' ', 'g')),
      false
    ) as pair_lock_precedes_is_blocked_pair,
    coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as authenticated_exec,
    coalesce(not has_function_privilege('anon', p.oid, 'EXECUTE'), false) as anon_no_exec
  from (select 1 as anchor) _anchor
  left join pg_proc p
    on p.oid = to_regprocedure('public.set_dispatch_worth_reading(uuid, boolean)')
),
-- FINAL SECURITY/HARDENING PATCH — new CTE: proves the CURRENT
-- public.block_user(uuid, text) (reproduced by this migration via
-- CREATE OR REPLACE, per its own piece 3 comment) has been extended to
-- clear dispatch_worth_reading in both directions, strictly inside the
-- existing FULL-only branch, never reachable for a letters-only block.
block_user_check as (
  select
    to_regprocedure('public.block_user(uuid, text)') is not null as exact_signature_exists,
    p.oid is not null as exists_at_all,
    coalesce(p.prosecdef, false) as is_security_definer,
    coalesce(
      exists (select 1 from unnest(p.proconfig) cfg where cfg = 'search_path=pg_catalog'),
      false
    ) as search_path_fixed,
    -- Proof 1: an adjacent-fragment ilike pattern spanning the
    -- full-branch guard, THROUGH the pre-existing kept_minds cleanup,
    -- THROUGH the new dispatch_worth_reading cleanup, to that same
    -- branch's own closing `end if;` — scopes the new cleanup to
    -- literally the same conditional block the Keep cascade already
    -- lives in, not merely "present somewhere in the function."
    coalesce(
      pg_get_functiondef(p.oid) ilike '%if p_scope = ''full'' then%delete from public.kept_minds%delete from public.dispatch_worth_reading%end if;%',
      false
    ) as worth_reading_cleanup_inside_full_branch,
    -- Both-directions predicate shape, same as the Keep cascade's own
    -- both-directions OR. VERIFIER FIX: whitespace-normalized, same
    -- reasoning as this file's other five fixes.
    -- VERIFIER ROBUSTNESS PATCH: dropped the exact `dispatch_id in
    -- (select id from public.dispatches where author_id = ...)`
    -- subquery-wrapper adjacency (a single space Postgres's own
    -- reformatting can introduce just inside `(`/`)` there would
    -- otherwise still defeat the match post-normalization) in favor of
    -- the bare `author_id = <who>` token each direction actually
    -- depends on — still proves the DELETE contains both directions,
    -- in order: the table name, then each direction's own user_id/
    -- author_id pair.
    coalesce(
      regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', ' ', 'g') like '%delete from public.dispatch_worth_reading%user_id = auth.uid()%author_id = p_blocked_id%user_id = p_blocked_id%author_id = auth.uid()%',
      false
    ) as worth_reading_cleanup_both_directions,
    -- Proof 2 (IMPORTANT correction applied here too): position()-based
    -- ordering, BOTH positions required > 0 before comparing, proving
    -- the cleanup's own DELETE text appears strictly AFTER the
    -- full-branch guard begins (never before it, which would mean an
    -- unconditional/letters-reachable copy).
    coalesce(
      position('if p_scope = ''full'' then' in pg_get_functiondef(p.oid)) > 0
      and position('delete from public.dispatch_worth_reading' in pg_get_functiondef(p.oid)) > 0
      and position('if p_scope = ''full'' then' in pg_get_functiondef(p.oid))
        < position('delete from public.dispatch_worth_reading' in pg_get_functiondef(p.oid)),
      false
    ) as worth_reading_cleanup_after_full_guard,
    -- Proof 3: the dispatch_worth_reading DELETE text occurs EXACTLY
    -- ONCE in the whole function body — rules out a second, separate
    -- copy existing anywhere outside the full-only branch (e.g. a
    -- stray unconditional or letters-branch cleanup this same function
    -- might otherwise also contain).
    coalesce(
      (
        length(pg_get_functiondef(p.oid))
        - length(replace(pg_get_functiondef(p.oid), 'delete from public.dispatch_worth_reading', ''))
      ) / length('delete from public.dispatch_worth_reading') = 1,
      false
    ) as worth_reading_cleanup_exactly_once,
    -- FINAL CONCURRENCY FIX: the same shared member-pair lock as
    -- set_dispatch_worth_reading's own true branch, UPDATE mode here
    -- (this function is about to WRITE), same ascending-uuid ordering
    -- (both if/else branches present).
    -- VERIFIER FIX: whitespace-normalized, same reasoning as this
    -- file's other five fixes.
    coalesce(
      regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', ' ', 'g') like
        '%if auth.uid() < p_blocked_id then%from public.profiles where id = auth.uid() for update%from public.profiles where id = p_blocked_id for update%else%from public.profiles where id = p_blocked_id for update%from public.profiles where id = auth.uid() for update%end if;%',
      false
    ) as pair_lock_uses_deterministic_order,
    -- Both positions > 0 before comparing — proves the pair lock is
    -- acquired BEFORE the blocked_users upsert.
    coalesce(
      position('if auth.uid() < p_blocked_id then' in pg_get_functiondef(p.oid)) > 0
      and position('insert into public.blocked_users' in pg_get_functiondef(p.oid)) > 0
      and position('if auth.uid() < p_blocked_id then' in pg_get_functiondef(p.oid))
        < position('insert into public.blocked_users' in pg_get_functiondef(p.oid)),
      false
    ) as pair_lock_precedes_blocked_users_upsert,
    coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as authenticated_exec,
    coalesce(not has_function_privilege('anon', p.oid, 'EXECUTE'), false) as anon_no_exec
  from (select 1 as anchor) _anchor
  left join pg_proc p
    on p.oid = to_regprocedure('public.block_user(uuid, text)')
),
-- No public count, voter list, or notification surface of any kind
-- accompanies this migration.
no_scope_creep_check as (
  select
    not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('worth_reading_likes', 'worth_reading_votes', 'notifications', 'events')
    ) as no_new_relations_of_concern,
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'dispatches' and column_name ilike '%worth_reading%'
    ) as no_denormalized_count_on_dispatches
)
select
  t.table_exists,
  t.rls_enabled,
  col.all_columns_present,
  fk.all_fks_correct,
  pk.has_composite_pk_on_both_columns,
  pol.exists_at_all as policy_exists,
  pol.scoped_to_own_user_id,
  g.authenticated_select,
  g.authenticated_no_insert,
  g.authenticated_no_update,
  g.authenticated_no_delete,
  g.anon_no_select,
  g.anon_no_insert,
  g.anon_no_update,
  g.anon_no_delete,
  f.exact_signature_exists,
  f.exists_at_all as function_exists,
  f.is_security_definer,
  f.search_path_fixed,
  f.checks_account_status,
  f.checks_blocking,
  f.never_uses_letters_only_helper,
  f.requires_published_and_visible,
  f.rejects_own_dispatch,
  f.checks_author_public_visibility,
  f.inserts_idempotently,
  f.rejects_null_worth_reading,
  f.dispatch_select_uses_for_share,
  f.false_branch_deletes_only_own_row,
  f.false_branch_precedes_account_status_gate,
  f.pair_lock_uses_deterministic_order as set_worth_reading_pair_lock_uses_deterministic_order,
  f.pair_lock_precedes_is_blocked_pair,
  f.authenticated_exec,
  f.anon_no_exec,
  bu.exact_signature_exists as block_user_exact_signature_exists,
  bu.exists_at_all as block_user_exists,
  bu.is_security_definer as block_user_is_security_definer,
  bu.search_path_fixed as block_user_search_path_fixed,
  bu.worth_reading_cleanup_inside_full_branch,
  bu.worth_reading_cleanup_both_directions,
  bu.worth_reading_cleanup_after_full_guard,
  bu.worth_reading_cleanup_exactly_once,
  bu.pair_lock_uses_deterministic_order as block_user_pair_lock_uses_deterministic_order,
  bu.pair_lock_precedes_blocked_users_upsert,
  bu.authenticated_exec as block_user_authenticated_exec,
  bu.anon_no_exec as block_user_anon_no_exec,
  n.no_new_relations_of_concern,
  n.no_denormalized_count_on_dispatches,
  (
    t.table_exists and t.rls_enabled
    and col.all_columns_present
    and fk.all_fks_correct
    and pk.has_composite_pk_on_both_columns
    and pol.exists_at_all and pol.scoped_to_own_user_id
    and g.authenticated_select and g.authenticated_no_insert and g.authenticated_no_update
    and g.authenticated_no_delete and g.anon_no_select
    and g.anon_no_insert and g.anon_no_update and g.anon_no_delete
    and f.exact_signature_exists and f.exists_at_all and f.is_security_definer and f.search_path_fixed
    and f.checks_account_status and f.checks_blocking and f.never_uses_letters_only_helper
    and f.requires_published_and_visible and f.rejects_own_dispatch
    and f.checks_author_public_visibility and f.inserts_idempotently
    and f.rejects_null_worth_reading and f.dispatch_select_uses_for_share
    and f.false_branch_deletes_only_own_row and f.false_branch_precedes_account_status_gate
    and f.pair_lock_uses_deterministic_order and f.pair_lock_precedes_is_blocked_pair
    and f.authenticated_exec and f.anon_no_exec
    and bu.exact_signature_exists and bu.exists_at_all and bu.is_security_definer and bu.search_path_fixed
    and bu.worth_reading_cleanup_inside_full_branch and bu.worth_reading_cleanup_both_directions
    and bu.worth_reading_cleanup_after_full_guard and bu.worth_reading_cleanup_exactly_once
    and bu.pair_lock_uses_deterministic_order and bu.pair_lock_precedes_blocked_users_upsert
    and bu.authenticated_exec and bu.anon_no_exec
    and n.no_new_relations_of_concern and n.no_denormalized_count_on_dispatches
  ) as overall_pass
from table_check t, column_check col, fk_check fk, pk_check pk, policy_check pol,
     grant_check g, function_check f, block_user_check bu, no_scope_creep_check n;


-- ============================================================
-- DETAIL — full source of the new/changed objects, for manual reading
-- alongside the migration file itself.
-- ============================================================
select pg_get_expr(pol.polqual, pol.polrelid) as dispatch_worth_reading_own_using_clause
from pg_policy pol join pg_class c on c.oid = pol.polrelid
where c.relname = 'dispatch_worth_reading' and pol.polname = 'dispatch_worth_reading_own';

select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'set_dispatch_worth_reading';

-- FINAL SECURITY/HARDENING PATCH — new: the current block_user(uuid,
-- text), for manual side-by-side reading against docs/sql/2026-09-12-
-- scoped-blocking-and-fixes.sql:188-248 to confirm the only difference
-- is the added dispatch_worth_reading cleanup.
select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'block_user' and pg_get_function_identity_arguments(p.oid) = 'uuid, text';

-- Live data spot-check (safe to run even with zero rows): confirms no
-- member has ever accumulated more than one mark per Dispatch — the
-- primary key already guarantees this structurally, this simply proves
-- no historical data violates it.
select
  count(*) as total_rows,
  count(*) filter (
    where (dispatch_id, user_id) in (
      select dispatch_id, user_id from public.dispatch_worth_reading
      group by dispatch_id, user_id having count(*) > 1
    )
  ) as impossible_duplicate_marks
from public.dispatch_worth_reading;
