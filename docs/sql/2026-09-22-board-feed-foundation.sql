-- ============================================================
-- TEMPA — BOARD EXPERIENCE, PHASE 2A: BOARD FEED FOUNDATION
-- ============================================================
-- STATUS: APPLIED LIVE: 2026-09-15. VERIFIED LIVE: 2026-09-15 — live
-- diagnostics run against the applied migration confirmed:
-- dispatch_views.first_viewed_at exists, is NOT NULL, and carries a
-- now() default; the existing 7 dispatch_views rows were successfully
-- backfilled, with zero null first_viewed_at rows and zero
-- first_viewed_at > viewed_at rows; the preservation trigger is BEFORE
-- UPDATE FOR EACH ROW; board_feed_page's exact signature exists and it
-- is SECURITY INVOKER; search_dispatches is capped; dispatches_select_
-- published's author-own exception, full-block predicate, and
-- moderation predicate are all preserved; the new suspended/banned
-- visibility helper is present, reachable by authenticated, and
-- unreachable by anon (schema USAGE on tempa_private, not merely
-- function-level EXECUTE — see the verifier's own preflight-correction
-- comment for why that distinction matters); and no scope-creep table
-- was introduced. Three pre-existing false negatives in the verifier
-- itself (never in this migration's own executable SQL) were found
-- during this live check, corrected in docs/sql/2026-09-22-board-feed-
-- foundation-verify.sql, and the corrected verifier was then re-run
-- live: overall_pass=true, with a final dispatch_views spot-check of
-- total_rows=7, null_first_viewed_at=0, impossible_first_after_latest=0.
-- ============================================================
--
-- Session-stability correction (folded directly into this file rather
-- than layered as a second migration, since it was found and fixed
-- before this file was ever executed): an independent review found that
-- the ORIGINAL version of piece 5 below classified "previously seen"
-- using dispatch_views.viewed_at < p_session_started_at, and claimed
-- that classification was stable for the life of a session. It is not —
-- viewed_at is the table's own MUTABLE latest-view timestamp
-- (recordDispatchProgress, lib/dispatches.ts, unconditionally upserts
-- viewed_at = now() on every call, confirmed against that function's
-- actual source), so a Dispatch seen yesterday, re-opened mid-session
-- today, would have its viewed_at pushed to a value AFTER
-- p_session_started_at — flipping its classification from "pre-session
-- seen" to "not pre-session seen" mid-session, exactly the reshuffle
-- this design was supposed to prevent. Piece 4 below adds an immutable
-- first_viewed_at fact to dispatch_views specifically to fix this;
-- piece 5's tiering now reads that instead. See piece 5's own comment
-- for the corrected reasoning and a from-scratch re-proof of every
-- ordering guarantee, including a new, explicit analysis of what a
-- mid-session Keep/unkeep can and cannot do to the cursor (it was
-- accepted as a documented edge case before; it still is, but the
-- Keep-ADD direction of it is now closed using kept_minds.created_at —
-- an existing column, no schema change to that table).
--
-- Five pieces, numbered to match their "== N. ==" section headers below,
-- all scoped to what Phase 2A actually needs:
--
--   1. TRUST & SAFETY HELPER — tempa_private.author_content_publicly_
--      visible, a new SECURITY DEFINER function deciding whether an
--      author's account status should hide their content from others.
--
--   2. DISPATCHES_SELECT_PUBLISHED — the one RLS policy update that
--      actually applies piece 1: a suspended or banned member's
--      already-published Dispatches stop being publicly discoverable
--      (Board/Home/search/profile), without touching "restricted"
--      (nothing in the existing enforcement design says restricted
--      content should be hidden — see piece 1's own comment) and
--      without touching an author's own ability to see their own
--      content, or Stop-letters-vs-Block-everywhere semantics.
--
--   3. SEARCH SCALE FIX — search_dispatches gets a hard result cap. It
--      previously had none.
--
--   4. DISPATCH_VIEWS.FIRST_VIEWED_AT — the session-stability
--      correction itself: an immutable "earliest known view" fact,
--      backfilled from each row's existing viewed_at, enforced
--      immutable going forward by a BEFORE UPDATE trigger (database-
--      level, not merely a client-code convention).
--
--   5. BOARD_FEED_PAGE — the session-stable, cursor-paginated,
--      author-diverse ranking primitive both The Board and Home share.
--      SECURITY INVOKER throughout (matching search_dispatches' own
--      precedent): it adds no new visibility rule of its own beyond the
--      one existing RLS policy piece 2 above updates — every published/
--      moderation/blocking/suspension check a caller is subject to here
--      is the SAME check dispatches_select_published already enforces
--      for any other read of this table.
--
-- NO Replies schema. NO Worth Reading schema. NO impression/shown table.
-- NO Postcard changes. NO new persisted "Board session" table — the
-- session is carried entirely in the URL (session_started_at + a
-- non-secret seed), per the explicit architecture decision for this
-- checkpoint. NO schema change to kept_minds (an existing column,
-- created_at, is read differently by piece 5 below — the table itself,
-- its own columns, and keep_mind/unkeep_mind are untouched).
--
-- Preflight correction (made before this file was ever executed):
-- wrapped in an explicit begin/commit below, matching every other
-- migration in docs/sql/ —
-- without it, each statement below would autocommit independently,
-- which both (a) risks leaving the migration partially applied if a
-- later statement fails, and (b) reopens exactly the race this file's
-- own first_viewed_at backfill depends on being closed: the ACCESS
-- EXCLUSIVE lock piece 4's first ALTER TABLE acquires must be held,
-- unbroken, all the way through its own SET NOT NULL — otherwise a
-- concurrent recordDispatchProgress write landing between two
-- autocommitted statements could insert a first_viewed_at that never
-- goes through the backfill, then get caught fatally by SET NOT NULL.
-- One transaction makes that interleaving impossible. Piece 2 also
-- gained a `drop policy` it was missing — dispatches_select_published
-- already exists live (created in docs/sql/2026-09-10-admin-moderation-
-- and-questions.sql, most recently replaced by docs/sql/2026-09-11-
-- safety-blocking-foundation.sql, both of which drop it first for the
-- same reason: CREATE POLICY has no OR REPLACE form, unlike CREATE OR
-- REPLACE FUNCTION — issuing it against a name that already exists
-- fails outright).
-- ============================================================

begin;

-- ============================================================
-- 1. TRUST & SAFETY — tempa_private.author_content_publicly_visible
-- ============================================================
-- account_enforcement_state's own RLS (account_enforcement_state_select_
-- own, docs/sql/2026-09-11-safety-blocking-foundation.sql) is strictly
-- self-scoped — an ordinary authenticated caller cannot read ANOTHER
-- member's status row directly. Exactly the same shape as blocked_users
-- (self-scoped RLS) needing tempa_private.is_blocked_pair as a SECURITY
-- DEFINER helper to check a PAIR's relationship from inside a public RLS
-- policy — this is that same established pattern, for account status
-- instead of blocking.
--
-- Scope, worked out from the existing enforcement design rather than
-- guessed: every RPC that reads current_account_status() today (see
-- docs/sql/2026-09-11-safety-blocking-foundation.sql,
-- 2026-09-17-reporting-and-admin-moderation.sql) groups 'restricted',
-- 'suspended', and 'banned' together, but ONLY ever as a gate on the
-- ACTING member's own WRITE actions (publish, edit, Keep, correspond,
-- etc.) — nowhere does the existing schema, any RPC, or any code comment
-- say a restricted member's ALREADY-PUBLISHED content should stop being
-- readable by others. So this function draws the line exactly where the
-- rest of the schema already implicitly draws it for reads: 'active' and
-- 'restricted' remain publicly visible (unchanged from today); only
-- 'suspended' and 'banned' are excluded. A status row that doesn't exist
-- at all defaults to 'active' — same default current_account_status()
-- itself uses.
create or replace function tempa_private.author_content_publicly_visible(p_author_id uuid)
returns boolean
language sql
security definer
set search_path to 'pg_catalog'
stable
as $$
  select coalesce(
    (select status from public.account_enforcement_state where user_id = p_author_id),
    'active'
  ) not in ('suspended', 'banned')
$$;

-- Deliberately NO revoke here — same treatment as tempa_private.
-- is_blocked_pair (docs/sql/2026-09-11-safety-blocking-foundation.sql):
-- this function is called directly from dispatches_select_published's
-- USING clause below, which runs as the querying `authenticated` role,
-- not as a SECURITY DEFINER caller. Revoking the default PUBLIC EXECUTE
-- grant here (the way tempa_private.is_correspondence_blocked_pair does,
-- since THAT helper is only ever called from inside other SECURITY
-- DEFINER functions) would break the RLS policy itself. There remains no
-- way to reach it directly as a client — tempa_private is not in
-- Supabase's Exposed Schemas list, matching every other function in this
-- schema.


-- ============================================================
-- 2. DISPATCHES_SELECT_PUBLISHED — reproduced in full with one added
-- predicate
-- ============================================================
-- Everything else about this policy is byte-for-byte unchanged from its
-- current live shape (docs/sql/2026-09-10-admin-moderation-and-
-- questions.sql:182-193): published + visible + not-blocked, OR the
-- author's own row regardless of any of that — an author can always see
-- their own content (including, deliberately, while suspended or
-- banned — for their own account-state/appeal purposes; nothing here
-- changes what an author can see of their OWN work, only what OTHER
-- members can discover). Staff/admin moderation access is untouched
-- because it never went through this policy to begin with —
-- admin_hide_dispatch/admin_restore_dispatch are SECURITY DEFINER RPCs
-- that bypass RLS entirely, the same as before this migration.
--
-- Because dispatch_topics_select_published, dispatch_moments_select_
-- published, and dispatch_photo_is_visible() (docs/sql/2026-09-07-
-- dispatches-and-board.sql) all re-query public.dispatches from inside
-- their OWN policy/function bodies — under the same `authenticated`
-- role, never bypassing RLS — this one change also closes the same gap
-- for a Dispatch's topics, inline Moments, and photo bytes automatically,
-- with no separate edit to any of those three needed. search_dispatches
-- (piece 3 below) is SECURITY INVOKER for the identical reason and
-- inherits this the same way.
--
-- CREATE POLICY has no OR REPLACE form — the live policy of this exact
-- name must be dropped first, same as its own two prior replacements
-- (docs/sql/2026-09-10-admin-moderation-and-questions.sql,
-- docs/sql/2026-09-11-safety-blocking-foundation.sql) both did.
drop policy dispatches_select_published on public.dispatches;

create policy dispatches_select_published
  on public.dispatches
  for select
  to authenticated
  using (
    (
      status = 'published'
      and moderation_status = 'visible'
      and not tempa_private.is_blocked_pair(auth.uid(), author_id)
      and tempa_private.author_content_publicly_visible(author_id)
    )
    or author_id = auth.uid()
  );


-- ============================================================
-- 3. SEARCH_DISPATCHES — reproduced in full with a hard result cap
-- ============================================================
-- The live version (docs/sql/2026-09-10-admin-moderation-and-
-- questions.sql:206-226) had no LIMIT at all — an unbounded leading-
-- wildcard ILIKE scan whose full-body result set grows without bound as
-- the Dispatch corpus grows (flagged in the Phase 1 architecture audit
-- as the one genuinely scale-driven risk in the whole Dispatch read
-- path). Fixed here with the smallest correct change: a hard cap,
-- nothing else. A pg_trgm/GIN index would materially help the ILIKE
-- scan's own cost at very large scale, but is NOT required for
-- controlled beta and is deliberately not introduced in this checkpoint
-- (documented here, not built, per the explicit instruction not to
-- expand this checkpoint's scope with a new extension casually) — a
-- clean follow-up for whenever the corpus size actually warrants it.
-- Every other line is unchanged: still SECURITY INVOKER (inherits the
-- account-enforcement fix above automatically, same reasoning as piece
-- 2's comment), still published + visible only, still a plain OR across
-- title/body/topic, still no ranking/scoring of any kind.
create or replace function public.search_dispatches(p_query text)
returns setof public.dispatches
language sql
security invoker
stable
set search_path to 'public'
as $$
  select d.*
  from public.dispatches d
  where d.status = 'published'
    and d.moderation_status = 'visible'
    and (
      d.title ilike '%' || p_query || '%'
      or d.body ilike '%' || p_query || '%'
      or exists (
        select 1 from public.dispatch_topics t
        where t.dispatch_id = d.id and t.topic ilike '%' || p_query || '%'
      )
    )
  order by d.published_at desc
  limit 50
$$;

revoke all on function public.search_dispatches(text) from public;
grant execute on function public.search_dispatches(text) to authenticated;


-- ============================================================
-- 4. DISPATCH_VIEWS.FIRST_VIEWED_AT — the immutable first-seen fact
-- ============================================================
-- dispatch_views (docs/sql/2026-09-07-dispatches-and-board.sql) already
-- has `viewed_at timestamptz not null default now()` — the table's own
-- MUTABLE latest-view timestamp, upserted to now() on every call to
-- recordDispatchProgress (lib/dispatches.ts). That column's existing
-- purpose (resuming a reader at the right paragraph) is unchanged and
-- untouched here — it still means "last time this viewer had progress
-- on this Dispatch," and nothing below changes when or how it's
-- written.
--
-- first_viewed_at is a SEPARATE, new fact: "the earliest known time
-- this viewer had a view record for this Dispatch." It is established
-- once (on that row's first-ever insert) and must never move again,
-- regardless of how many further progress updates that row receives.
-- Safe ordering, since this table already had live application traffic
-- (recordDispatchProgress) at the time this migration ran, even though
-- board_feed_page itself was being applied for the first time:
--   1. add the column nullable (no default yet — see below for why)
--   2. backfill every existing row from its own current viewed_at
--   3. only THEN set a default, for future inserts
--   4. only THEN enforce not null, once every row genuinely has a value
-- A default of now() cannot be added before the backfill: now() is
-- VOLATILE, so ADD COLUMN ... DEFAULT now() cannot use Postgres' fast
-- metadata-only path and would instead stamp EVERY existing row with
-- the single instant this ALTER TABLE statement runs — overwriting
-- exactly the historical values step 2 needs to backfill from. Adding
-- the column bare, backfilling explicitly, and only then attaching the
-- default avoids that entirely.
alter table public.dispatch_views add column first_viewed_at timestamptz;

-- Acknowledged explicitly: for a row that already existed before this
-- migration, its current viewed_at is the most recently recorded
-- progress update, not necessarily the literal first-ever view (that
-- earlier history was never captured, since viewed_at itself is
-- mutable and always was). This is the best reconstructible value and
-- is judged acceptable — it is still guaranteed to be no LATER than
-- the row's true first view, so it can only ever make a Dispatch look
-- "seen" for a Board session that started after that backfilled
-- timestamp, never earlier, which is the safe direction for this
-- column's purpose.
update public.dispatch_views set first_viewed_at = viewed_at where first_viewed_at is null;

alter table public.dispatch_views alter column first_viewed_at set default now();
alter table public.dispatch_views alter column first_viewed_at set not null;

-- Enforced at the database level, not merely by client-code discipline
-- (dispatch_views has a direct `grant ... update to authenticated`, no
-- RPC layer standing between the client and this table for progress
-- writes — see recordDispatchProgress) — a BEFORE UPDATE trigger that
-- unconditionally re-asserts the row's EXISTING first_viewed_at,
-- discarding whatever value (if any) a future client or RPC ever sends
-- for that column. This is what makes the immutability a real
-- guarantee rather than a convention that the next person touching
-- recordDispatchProgress could accidentally break.
create or replace function tempa_private.dispatch_views_preserve_first_viewed_at()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $$
begin
  new.first_viewed_at := old.first_viewed_at;
  return new;
end;
$$;

drop trigger if exists dispatch_views_first_viewed_at_immutable on public.dispatch_views;

create trigger dispatch_views_first_viewed_at_immutable
before update on public.dispatch_views
for each row
execute function tempa_private.dispatch_views_preserve_first_viewed_at();


-- ============================================================
-- 5. BOARD_FEED_PAGE — session-stable, cursor-paginated, author-diverse
-- ============================================================
-- Replaces the flat `.limit(60)`/`.limit(30)` + in-memory
-- sortBoardDispatches/interleaveByAuthor (lib/dispatches.ts) that The
-- Board and Home both used before this checkpoint. Those two JS
-- functions are left in place, untouched and still exported/tested —
-- they are simply no longer called by Board or Home once the app-layer
-- change (outside this migration) lands; removing already-correct,
-- independently-tested pure functions was judged unnecessary scope for
-- this checkpoint and is left for a later cleanup pass.
--
-- SESSION MODEL: no new table. A "Board browsing session" is exactly two
-- values the caller already holds — p_session_started_at (when this
-- session began) and p_seed (a non-secret, per-session random string) —
-- carried in the Board page's own URL. The first Board request of a
-- session mints both; every subsequent request in the SAME session
-- (including every "Load more" page) passes the SAME two values back
-- in. An explicit Refresh is simply a request with fresh values for
-- both — nothing here distinguishes "Refresh" as its own concept; it's
-- just a new session.
--
-- STABILITY RULE — CORRECTED (see the file header's session-stability
-- correction note). The original draft used dispatch_views.viewed_at,
-- which is MUTABLE (overwritten to now() on every progress update —
-- lib/dispatches.ts's recordDispatchProgress), and incorrectly claimed
-- that produced a stable classification. It does not: a Dispatch seen
-- yesterday, re-opened mid-session today, would have viewed_at pushed
-- past p_session_started_at, flipping it from "pre-session seen" to
-- "not pre-session seen" mid-session — exactly the reshuffle this
-- design exists to prevent. Corrected below to use the new, genuinely
-- immutable dispatch_views.first_viewed_at (piece 4 above) instead.
--
-- PROOF, field by field — which inputs to the ordering key (tier,
-- author_seq, seed_hash, id) can and cannot change during one active
-- Board session, and what happens when one does:
--
--   - id: immutable (primary key).
--
--   - published_at: immutable once a Dispatch is published —
--     update_dispatch (docs/sql/2026-09-09-board-usability.sql) edits
--     title/body/topics/Moments in place but never touches
--     published_at. So published_at <= p_session_started_at (excluding
--     anything published mid-session) and author_seq's own ORDER BY
--     published_at desc are both keyed on a value that cannot move.
--
--   - seed_hash = hashtext(p_seed || id::text): a pure function of two
--     values that are each already established to be immutable for the
--     session (p_seed is a caller-supplied constant reused unchanged
--     for the whole session; id never changes) — so seed_hash is
--     immutable for the session too.
--
--   - "seen" (tier 3 test): now `dispatch_views.first_viewed_at <
--     p_session_started_at`. first_viewed_at is written once, on a
--     row's first insert, and piece 4's trigger makes every later
--     UPDATE to that row re-assert the OLD value regardless of what's
--     sent — so this predicate's truth value, once evaluated, CANNOT
--     change for the rest of the session, in either direction:
--       * A Dispatch with a pre-session first_viewed_at stays "seen"
--         all session, no matter how many times it's reopened.
--       * A Dispatch with NO view row yet, or a first_viewed_at that
--         is itself >= p_session_started_at (i.e. first opened THIS
--         session), stays "not pre-session seen" all session — opening
--         it mid-session sets first_viewed_at to a value that can only
--         ever be >= p_session_started_at (it's being set to
--         approximately now(), and "now" during an active session is,
--         by definition, after that session started), so it can never
--         retroactively satisfy "< p_session_started_at" for THIS
--         session. It naturally reclassifies as seen on the member's
--         NEXT Board session (a fresh Refresh), which is the desired
--         behavior explicitly called for.
--     tier is therefore a genuinely session-immutable property of each
--     Dispatch, for its "seen" half.
--
--   - "kept" (tier 1 test): kept_minds has no soft-delete — unkeep_mind
--     (docs/sql/2026-09-11-safety-blocking-foundation.sql) row-deletes,
--     so unlike dispatch_views there is no surviving fact to check
--     after a member unkeeps someone. This means "kept" cannot be made
--     FULLY session-immutable without either a schema change to
--     kept_minds (soft-delete instead of hard-delete — explicitly out
--     of scope: "Do NOT change its schema") or a new persisted session
--     table (explicitly out of scope unless absolutely necessary, and
--     this doesn't rise to that). What CAN be closed with zero schema
--     change, using kept_minds' own existing `created_at` column, is
--     the ADD direction: this predicate is `kept_minds.created_at <
--     p_session_started_at` — a Keep performed DURING the session
--     (created_at >= p_session_started_at) does not count toward tier 1
--     until the member's next session, exactly mirroring how a
--     mid-session first view doesn't count toward tier 3 until the
--     next session. An OLD Keep (the overwhelming majority of real
--     usage — anyone kept before the current session has
--     created_at comfortably < p_session_started_at) is completely
--     unaffected by this change.
--
--     Residual, explicitly accepted gap — the UNKEEP direction only:
--     if a member unkeeps an author mid-session, that author's
--     not-yet-loaded Dispatches lose their kept_minds row entirely (not
--     merely a timestamp change) and so immediately re-evaluate as
--     tier 2 on the next page fetch. Worked through precisely: this can
--     only ever cause a not-yet-returned row to SKIP (fall behind a
--     cursor position it would otherwise still be ahead of) — it can
--     NEVER cause a DUPLICATE, because a row's tier can only move later
--     in sort order (1 -> 2) on unkeep, never earlier, and keyset
--     pagination only ever compares forward against the cursor; a
--     row that sorts later than before simply continues to correctly
--     fail the ">" comparison against a cursor it had already passed,
--     the same as before this correction. The skip is real but narrow:
--     it requires an unkeep action DURING an active, still-paginating
--     session, on an author whose remaining Dispatches haven't been
--     loaded yet. Consequence is mild (that Dispatch reappears in tier
--     2 on the member's next Board session, same as any ordinary
--     unseen material) — not a crash, not corrupted state, not a
--     violation of "no duplicates." Left as a documented, bounded edge
--     case rather than solved with a schema change or new table that
--     would be disproportionate to it.
--
-- RANKING, within each tier (1 = unseen from Kept authors, 2 = unseen
-- from everyone else, 3 = previously seen — same three tiers as before):
-- sorted by (author_seq, seed_hash, id). author_seq is this author's Nth
-- most recent eligible Dispatch WITHIN THIS TIER (row_number() partitioned
-- by tier + author_id, ordered newest-first) — the SQL expression of
-- exactly the conceptual model the checkpoint spec asked for ("an
-- author's first eligible Dispatch competes before that same author's
-- second, second before third") and, as a side effect, exactly the
-- "enough recency influence that old material doesn't permanently crowd
-- out newer material" property too: an author's OWN most recent piece is
-- always their author_seq = 1, competing in the very first position
-- class of its tier, no matter how large that author's back catalogue
-- is. seed_hash (hashtext(p_seed || id::text)) is a deterministic,
-- non-secret pseudo-random tie-break WITHIN an author_seq class — same
-- seed always produces the same tie-break order (stable within one
-- session); a different seed (a fresh Refresh) can produce a different
-- one. Never random() — random() is re-evaluated per row per call and
-- would silently break both same-page consistency and cross-page
-- pagination; hashtext() is a pure function of its arguments, so it
-- always returns the same value for the same (seed, id) pair, which is
-- exactly what a stable, resumable sort key requires.
--
-- CURSOR: the tuple (tier, author_seq, seed_hash, id) from the last row
-- of the previous page — a complete, strictly-ordered composite key
-- (id breaks any residual tie), compared with a single Postgres
-- row-value comparison. This is real keyset pagination, never OFFSET:
-- no page is defined relative to "how many rows came before," only
-- relative to the exact key of the last row actually seen, so it cannot
-- duplicate or skip rows as the underlying eligible set is scanned
-- fresh on every call.
--
-- ELIGIBLE-POOL CAP: the eligible CTE below caps itself at the 300 most
-- recently published qualifying Dispatches before any tiering/ranking
-- computation runs, deliberately avoiding the exact unbounded-
-- computation shape search_dispatches had before piece 3 above fixed
-- it — this keeps every call's cost bounded regardless of total corpus
-- size, matching the Phase 1 audit's own finding that a bounded
-- `order by published_at desc limit N` is the one query shape in this
-- schema that does NOT degrade at scale. 300 comfortably covers many
-- "Load more" pages for controlled beta; material beyond that window is
-- reachable via Search (now itself bounded) or a later Refresh once
-- newer material has pushed the window forward.
--
-- SECURITY: SECURITY INVOKER, exactly matching search_dispatches (see
-- that function's own long-standing comment for the reasoning) — this
-- function adds no visibility rule of its own; every row it can ever
-- see is a row dispatches_select_published already permits its caller
-- to see, piece 2's account-enforcement fix included for free. It does
-- NOT re-check is_blocked_pair/author_content_publicly_visible
-- explicitly inside its own body for the same reason search_dispatches
-- doesn't — RLS is the actual boundary, not a duplicated app-level
-- check that could drift out of sync with it.
create or replace function public.board_feed_page(
  p_session_started_at timestamptz,
  p_seed text,
  p_limit integer default 12,
  p_cursor_tier integer default null,
  p_cursor_author_seq bigint default null,
  p_cursor_seed_hash integer default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid,
  author_id uuid,
  title text,
  body text,
  published_at timestamptz,
  moderation_status text,
  tier integer,
  author_seq bigint,
  seed_hash integer
)
language sql
security invoker
stable
set search_path to 'public'
as $$
  with eligible as (
    select d.id, d.author_id, d.title, d.body, d.published_at, d.moderation_status
    from public.dispatches d
    where d.status = 'published'
      and d.moderation_status = 'visible'
      and d.published_at <= p_session_started_at
    order by d.published_at desc
    limit 300
  ),
  tiered as (
    select
      e.*,
      case
        when exists (
          select 1 from public.dispatch_views dv
          where dv.viewer_id = auth.uid()
            and dv.dispatch_id = e.id
            and dv.first_viewed_at < p_session_started_at
        ) then 3
        when exists (
          select 1 from public.kept_minds km
          where km.viewer_user_id = auth.uid()
            and km.kept_user_id = e.author_id
            and km.created_at < p_session_started_at
        ) then 1
        else 2
      end as tier
    from eligible e
  ),
  ranked as (
    select
      t.*,
      row_number() over (partition by t.tier, t.author_id order by t.published_at desc) as author_seq,
      hashtext(p_seed || t.id::text) as seed_hash
    from tiered t
  )
  select
    r.id, r.author_id, r.title, r.body, r.published_at, r.moderation_status,
    r.tier, r.author_seq, r.seed_hash
  from ranked r
  where
    p_cursor_tier is null
    or (r.tier, r.author_seq, r.seed_hash, r.id)
      > (p_cursor_tier, p_cursor_author_seq, p_cursor_seed_hash, p_cursor_id)
  order by r.tier, r.author_seq, r.seed_hash, r.id
  limit p_limit
$$;

revoke all on function public.board_feed_page(timestamptz, text, integer, integer, bigint, integer, uuid) from public;
grant execute on function public.board_feed_page(timestamptz, text, integer, integer, bigint, integer, uuid) to authenticated;

commit;
