-- ============================================================
-- TEMPA — BOARD PERSONALIZATION / RELATIONSHIP-AWARE RANKING
-- ============================================================
-- STATUS: PREPARED. NOT EXECUTED. Review only — do not run against the
-- live database until explicitly approved (this checkpoint is
-- implementation + local verification only).
--
-- Supersedes public.board_feed_page as defined in docs/sql/2026-09-22-
-- board-feed-foundation.sql. That file is left untouched (historical,
-- already-applied record) — this migration DROPs the old signature and
-- CREATEs a new one, because both the argument list (cursor shape) and
-- the RETURNS TABLE shape change, and CREATE OR REPLACE FUNCTION cannot
-- change either (same precedent as write_letter/get_shared_dispatch).
--
-- ============================================================
-- INDEX AUDIT (done BEFORE writing this migration, not guessed)
-- ============================================================
-- A suitable index already exists: `dispatches_author_published_idx on
-- public.dispatches (author_id, published_at desc) where status =
-- 'published'` — created in docs/sql/2026-09-06-open-letters.sql as
-- `open_letters_author_published_idx`, renamed in place by docs/sql/
-- 2026-09-07-dispatches-and-board.sql (`alter index ... rename to
-- dispatches_author_published_idx`) when open_letters became dispatches.
-- It does not additionally filter moderation_status = 'visible', but it
-- already gives Postgres ordered, index-backed access to "this author's
-- published Dispatches, newest first" — exactly the shape the new
-- per-familiar-author LATERAL lookup below needs (author_id equality +
-- published_at desc + LIMIT 2), with moderation_status/session-cutoff/
-- unseen simply applied as row filters during that ordered scan. A
-- second, near-duplicate partial index differing only by also filtering
-- moderation_status would be speculative rather than justified — this
-- migration adds NO new index.
--
-- ============================================================
-- RANKING MODEL — outer UNSEEN/SEEN partition, two-level weighted
-- interleave (Keep:Correspondent = 3:1, then Familiar:Discovery = 1:1
-- unbiased) independently inside each seen_bucket
-- ============================================================
-- seen_bucket (0 = unseen, 1 = seen) is now the PRIMARY/outermost sort
-- key — unseen content can never be outranked by seen content regardless
-- of relationship strength. "Unseen" uses the same session-stable
-- first_viewed_at rule board_feed_page already established (docs/sql/
-- 2026-09-22-board-feed-foundation.sql, piece 4/5): a Dispatch is
-- session-stably unseen when it has no dispatch_views row, or that row's
-- IMMUTABLE first_viewed_at is >= p_session_started_at — so a Dispatch
-- first viewed DURING the current session stays in its original unseen
-- class for the rest of that session (opening it does not reshuffle
-- anything not yet returned).
--
-- Within EACH seen_bucket independently, ranking is a Sainte-Laguë-style
-- weighted divisor interleave, computed twice, nested:
--
--   1. KEEP : ESTABLISHED CORRESPONDENT = 3 : 1. Both streams are first
--      made author-diverse (row_number() partitioned by seen_bucket +
--      author_id, ordered newest-first — an author's own Nth-most-recent
--      eligible row competes in stream position N, exactly like the
--      prior tier design's author_seq), THEN each stream's Nth row gets
--      divisor key (2N-1)/w (w=3 for Keep, w=1 for Correspondent). The
--      two streams merge by that key (ties broken by seed_hash), giving
--      every FAMILIAR row a position within the merged familiar stream.
--
--   2. FAMILIAR : DISCOVERY = 1 : 1, UNBIASED. The familiar stream's own
--      merged position (from step 1) and the (author-diverse) discovery
--      stream's own position both feed the SAME formula with w=1 for
--      both sides — (2N-1)/1 — so ties are resolued purely by seed_hash,
--      with NO systematic lean toward Familiar. This produces `rank_key`:
--      the odd integers 1, 3, 5, 7... — familiar row N and discovery row
--      N always tie at the same key, decided only by that row's own
--      per-session seed_hash.
--
-- Keep and Correspondent never stack: a viewer who both Keeps an author
-- AND has an established correspondence with them classifies that author
-- as Keep only (the stronger signal) — enforced by familiar_authors'
-- bool_or(is_kept) below, never by counting both.
--
-- Everything is computed in `numeric` (exact, arbitrary-precision decimal
-- arithmetic — never `float`/`double precision`), matching the approved
-- architecture. `rank_key numeric` is the ONLY cross-row-type ranking
-- value returned to callers, replacing the old `tier`/`author_seq` pair
-- entirely. seed_hash is never a substitute for rank_key; it is only
-- ever the final, lowest-priority tie-break, exactly like before.
--
-- Final total ordering (unchanged in shape, new column names):
--   seen_bucket ASC, rank_key ASC, seed_hash ASC, id ASC
--
-- ============================================================
-- ESTABLISHED CORRESPONDENT + CANDIDATE ACQUISITION
-- ============================================================
-- "Established correspondent" = correspondences.status = 'active' AND
-- established_at IS NOT NULL AND established_at < p_session_started_at
-- (session-stable, same reasoning as kept_minds.created_at) AND the
-- viewer is one of the two participants — a first-contact correspondence
-- that never received a reply (established_at still null) does NOT
-- qualify. Stop Letters (a 'letters' scope block) is NEVER checked here
-- or anywhere in this function — tempa_private.is_correspondence_
-- blocked_pair (the ANY-scope, letters-inclusive helper) is deliberately
-- never referenced, per the explicit product decision that Stop Letters
-- does not suppress Board familiarity. A FULL block (scope = 'full')
-- remains absolute: dispatches_select_published's own RLS already
-- excludes every Dispatch from a fully-blocked author (this function is
-- SECURITY INVOKER, so that RLS applies automatically to every query
-- against public.dispatches below); tempa_private.is_blocked_pair is
-- ALSO checked explicitly inside familiar_authors as defense-in-depth,
-- since public.correspondences' own RLS (participant-only) does not
-- itself filter by block state the way dispatches' RLS does.
--
-- The bounded global pool (300 most-recently-published eligible
-- Dispatches) is preserved unchanged. It is augmented with up to the 2
-- most recent UNSEEN eligible Dispatches per familiar author (Keep or
-- established correspondent), fetched via an index-backed LATERAL join —
-- ORDER BY published_at DESC LIMIT 2 per familiar author, using the
-- EXISTING dispatches_author_published_idx audited above — never a broad
-- row_number() scan over each familiar author's entire eligible history.
-- This closes the "a kept/correspondent author's older unseen Dispatch
-- can fall outside the newest-300 window and never surface" gap the
-- Phase 1 audit identified, with a computationally real (not merely
-- output) bound: at most 2 index-ordered rows fetched per familiar
-- author, regardless of that author's total published count. The union
-- with the global 300 is a plain `union` (not `union all`), which
-- de-duplicates by full row equality — safe here because both source
-- CTEs select the identical column list from the identical source rows
-- for any given id, so a Dispatch present in both collapses to one row.
--
-- ============================================================
-- MINIMAL RELATIONSHIP EXPOSURE
-- ============================================================
-- Returns exactly `is_kept boolean` / `is_familiar boolean` — never a
-- `familiarity` string, never the word "correspondent" anywhere in this
-- function's identifiers, comments-as-metadata, or output. is_familiar
-- is true for BOTH Keep and established-correspondent authors; is_kept
-- narrows to Keep specifically. Nothing about the two-level interleave,
-- the nested Keep:Correspondent nested key, or which of the two signals
-- produced is_familiar=true is exposed beyond these two booleans.
--
-- ============================================================
-- SECURITY
-- ============================================================
-- SECURITY INVOKER (unchanged), STABLE (unchanged), search_path pinned
-- to 'public' (unchanged), authenticated EXECUTE only, no anon EXECUTE —
-- identical security posture to the function this replaces. This
-- migration does not touch dispatches_select_published, any other RLS
-- policy, or moderation visibility in any way — no blocker requiring
-- that was found during this implementation.
-- ============================================================

begin;

drop function if exists public.board_feed_page(timestamptz, text, integer, integer, bigint, integer, uuid);

create or replace function public.board_feed_page(
  p_session_started_at timestamptz,
  p_seed text,
  p_limit integer default 12,
  p_cursor_seen_bucket smallint default null,
  p_cursor_rank_key numeric default null,
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
  is_kept boolean,
  is_familiar boolean,
  seen_bucket smallint,
  rank_key numeric,
  seed_hash integer
)
language sql
security invoker
stable
set search_path to 'public'
as $$
  with eligible_global as (
    select d.id, d.author_id, d.title, d.body, d.published_at, d.moderation_status
    from public.dispatches d
    where d.status = 'published'
      and d.moderation_status = 'visible'
      and d.published_at <= p_session_started_at
    order by d.published_at desc
    limit 300
  ),

  -- Keep beats the second familiarity signal when both are true for the
  -- same author — bool_or(is_kept) over the two unioned sources
  -- guarantees that, never by allowing an author to appear twice or by
  -- counting both signals.
  familiar_authors as (
    select author_id, bool_or(is_kept) as is_kept
    from (
      select km.kept_user_id as author_id, true as is_kept
      from public.kept_minds km
      where km.viewer_user_id = auth.uid()
        and km.created_at < p_session_started_at
        and not tempa_private.is_blocked_pair(auth.uid(), km.kept_user_id)

      union all

      select
        (case when c.participant_low = auth.uid() then c.participant_high else c.participant_low end) as author_id,
        false as is_kept
      from public.correspondences c
      where c.status = 'active'
        and c.established_at is not null
        and c.established_at < p_session_started_at
        and (c.participant_low = auth.uid() or c.participant_high = auth.uid())
        and not tempa_private.is_blocked_pair(
          auth.uid(),
          case when c.participant_low = auth.uid() then c.participant_high else c.participant_low end
        )
    ) sources
    group by author_id
  ),

  -- Bounded, index-backed per-familiar-author augmentation — see this
  -- file's header comment for why this is a LATERAL ORDER BY ... LIMIT 2
  -- rather than a row_number() scan over each author's full history.
  familiar_augment as (
    select d.id, d.author_id, d.title, d.body, d.published_at, d.moderation_status
    from familiar_authors fa
    cross join lateral (
      select d2.id, d2.author_id, d2.title, d2.body, d2.published_at, d2.moderation_status
      from public.dispatches d2
      where d2.author_id = fa.author_id
        and d2.status = 'published'
        and d2.moderation_status = 'visible'
        and d2.published_at <= p_session_started_at
        and not exists (
          select 1 from public.dispatch_views dv
          where dv.viewer_id = auth.uid()
            and dv.dispatch_id = d2.id
            and dv.first_viewed_at < p_session_started_at
        )
      order by d2.published_at desc
      limit 2
    ) d
  ),

  combined_eligible as (
    select ce.*, hashtext(p_seed || ce.id::text) as seed_hash
    from (
      select * from eligible_global
      union
      select * from familiar_augment
    ) ce
  ),

  classified as (
    select
      ce.*,
      (case
        when exists (
          select 1 from public.dispatch_views dv
          where dv.viewer_id = auth.uid()
            and dv.dispatch_id = ce.id
            and dv.first_viewed_at < p_session_started_at
        ) then 1::smallint
        else 0::smallint
      end) as seen_bucket,
      coalesce(fa.is_kept, false) as is_kept,
      (fa.author_id is not null) as is_familiar
    from combined_eligible ce
    left join familiar_authors fa on fa.author_id = ce.author_id
  ),

  -- Postgres does not allow nesting one window function inside another's
  -- OVER clause, so author diversity (author_seq) is computed ONCE here
  -- and reused below — safe because is_kept/is_familiar are per-AUTHOR
  -- facts (joined onto every row of that author alike), so a given
  -- author's rows always fall entirely within exactly one of the three
  -- streams below, never split across them; a single (seen_bucket,
  -- author_id)-partitioned author_seq is therefore equivalent to
  -- computing it separately inside each stream.
  author_diverse as (
    select
      c.*,
      row_number() over (partition by c.seen_bucket, c.author_id order by c.published_at desc) as author_seq
    from classified c
  ),

  -- ---- Level 1: Keep : second familiarity signal = 3 : 1, independently per seen_bucket ----

  keep_ranked as (
    select
      id, seen_bucket, seed_hash,
      row_number() over (partition by seen_bucket order by author_seq, seed_hash) as stream_i
    from author_diverse
    where is_kept
  ),
  second_signal_ranked as (
    select
      id, seen_bucket, seed_hash,
      row_number() over (partition by seen_bucket order by author_seq, seed_hash) as stream_i
    from author_diverse
    where is_familiar and not is_kept
  ),
  familiar_merged as (
    select id, seen_bucket, seed_hash, ((2 * stream_i - 1)::numeric / 3.0) as kc_key from keep_ranked
    union all
    select id, seen_bucket, seed_hash, ((2 * stream_i - 1)::numeric / 1.0) as kc_key from second_signal_ranked
  ),
  familiar_ranked as (
    select
      fm.id, fm.seen_bucket,
      row_number() over (partition by fm.seen_bucket order by fm.kc_key, fm.seed_hash) as familiar_i
    from familiar_merged fm
  ),

  -- ---- Level 2: Familiar : Discovery = 1 : 1, unbiased, independently per seen_bucket ----

  discovery_ranked as (
    select
      id, seen_bucket, seed_hash,
      row_number() over (partition by seen_bucket order by author_seq, seed_hash) as stream_i
    from author_diverse
    where not is_familiar
  ),
  top_level as (
    select fr.id, fr.seen_bucket, (2 * fr.familiar_i - 1)::numeric as rank_key from familiar_ranked fr
    union all
    select dr.id, dr.seen_bucket, (2 * dr.stream_i - 1)::numeric as rank_key from discovery_ranked dr
  ),

  final as (
    select
      cl.id, cl.author_id, cl.title, cl.body, cl.published_at, cl.moderation_status,
      cl.is_kept, cl.is_familiar, cl.seen_bucket, cl.seed_hash,
      tl.rank_key
    from author_diverse cl
    join top_level tl on tl.id = cl.id
  )

  select
    f.id, f.author_id, f.title, f.body, f.published_at, f.moderation_status,
    f.is_kept, f.is_familiar, f.seen_bucket, f.rank_key, f.seed_hash
  from final f
  where
    p_cursor_seen_bucket is null
    or (f.seen_bucket, f.rank_key, f.seed_hash, f.id)
      > (p_cursor_seen_bucket, p_cursor_rank_key, p_cursor_seed_hash, p_cursor_id)
  order by f.seen_bucket, f.rank_key, f.seed_hash, f.id
  limit p_limit
$$;

revoke all on function public.board_feed_page(
  timestamptz, text, integer, smallint, numeric, integer, uuid
) from public;

grant execute on function public.board_feed_page(
  timestamptz, text, integer, smallint, numeric, integer, uuid
) to authenticated;

commit;
