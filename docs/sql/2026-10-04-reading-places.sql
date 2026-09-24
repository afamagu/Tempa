-- ============================================================
-- TEMPA — READING PLACES: automatic resume + deliberate Saved place
-- STATUS: NOT EXECUTED — review, then run in the Supabase SQL editor.
-- Entirely separate from the Safety 2 migrations (docs/sql/2026-10-03-
-- safety-persistence.sql and earlier) — this is an unrelated, user-
-- approved product feature, not part of that checkpoint sequence, and
-- touches none of its tables/functions/RLS.
-- ============================================================
--
-- One small shared table for BOTH reading-position concepts, across
-- BOTH content types Tempa can currently show a long reading surface
-- for (Letters, Dispatches), rather than a Letters-specific table plus
-- a Dispatches-specific table plus a per-surface Saved-place table —
-- "member/user; content type; content id; automatic resume anchor;
-- deliberate saved-place anchor; timestamps" all live on the one row
-- per (member, content item).
--
-- DELIBERATELY DOES NOT TOUCH public.dispatch_views (docs/sql/2026-09-
-- 07-dispatches-and-board.sql) — that table already IS Dispatches'
-- live, shipped automatic-resume mechanism (app/board/[dispatchId]/
-- dispatch-reader.tsx), reads real production reading history today,
-- and nothing about this feature requires touching it. Migrating that
-- already-working mechanism onto this new table would be a real-data
-- migration with its own risk, asked for by nobody — out of scope.
-- What's actually MISSING, and what this table exists for, is: (a)
-- Letters have no automatic-resume mechanism at all yet, and (b)
-- NEITHER content type has a deliberate Saved place today. Both of
-- those are genuinely new, so — per the instruction to avoid
-- duplicating tables per surface for what's actually being newly
-- built — they share this one table rather than each getting their
-- own. A Dispatch's automatic-resume position therefore still lives on
-- dispatch_views (read via lib/dispatches.ts's existing
-- getDispatchViewState/recordDispatchProgress, unchanged by this
-- migration), while a Dispatch's Saved place lives here, on the SAME
-- row shape a Letter's automatic resume AND Saved place both use.
--
-- The automatic-resume anchor and the deliberate Saved-place anchor
-- are two independent column pairs on the SAME row, updated by two
-- entirely separate code paths (lib/reading-places.ts's
-- recordReadingProgress vs. saveReadingPlace/removeSavedReadingPlace)
-- — reading three more paragraphs after saving a place updates only
-- resume_paragraph_index/resume_updated_at; it can never move
-- saved_paragraph_index/saved_at, and vice versa. Both are NULLABLE
-- with no default, rather than defaulting to 0 (which would be
-- genuinely ambiguous — "resumed at the very first paragraph" vs.
-- "never recorded at all"): NULL means "no automatic-resume position
-- recorded yet" / "no place has been deliberately saved," full stop.
--
-- ANCHOR UNIT: paragraph index within the marker-stripped,
-- `splitParagraphs`-split body (lib/moments.ts) — the same unit
-- dispatch_views.last_paragraph_index already uses, and the only
-- naturally stable content unit either a Letter or a Dispatch body
-- actually has (both are stored as a single plain `text` column — see
-- docs/sql/2026-08-30-letters.sql / 2026-09-07-dispatches-and-board.sql
-- — with no per-paragraph id infrastructure anywhere in this codebase).
-- A raw pixel scroll offset was deliberately rejected, matching
-- dispatch-reader.tsx's own existing rationale: it breaks across
-- viewport widths, font-size changes, and any future reflow, where a
-- paragraph index does not. The application-side clamp (mirroring
-- lib/dispatches.ts's own clampReadingPosition) is the recovery/
-- fallback strategy for a stored index that no longer fits the
-- content's current paragraph count.
--
-- INTRA-PARAGRAPH OFFSET: each anchor pair also carries a nullable
-- *_char_offset — an approximate character position within that
-- paragraph's own text (lib/reading-places.ts's estimateCharOffset/
-- estimateScrollFraction, derived geometrically from how far scrolled
-- past the paragraph's own top the reading line was, never from raw
-- pixel coordinates persisted directly). This is what makes the anchor
-- an actual exact-spot marker rather than "somewhere in this
-- paragraph" — still safely degrades to the paragraph alone whenever
-- the offset is NULL (never recorded, e.g. an empty paragraph) or no
-- longer fits the paragraph's current text length (content changed).
--
-- PRIVACY: no Letter/Dispatch body text of any kind is stored here —
-- only ids and integer paragraph positions.
--
-- Convention followed throughout (same as every prior migration in this
-- repo): every new table gets an explicit `revoke all ... from public`
-- (Supabase projects grant broad default privileges on table creation)
-- then a targeted grant, RLS scoped to `auth.uid() = user_id` exactly
-- like the closest existing precedent for this shape, dispatch_views
-- itself (`for all using (auth.uid() = viewer_id) with check
-- (auth.uid() = viewer_id)`).

begin;

-- ============================================================
-- 1. READING_PLACES
-- ============================================================

create table public.reading_places (
  user_id uuid not null
    references auth.users(id)
    on delete cascade,

  content_type text not null
    check (content_type in ('letter', 'dispatch')),

  content_id uuid not null,

  -- Automatic resume — silently tracked while reading, no member
  -- action involved. NULL until the member has actually read any of
  -- this content. resume_char_offset is only ever non-null alongside a
  -- non-null resume_paragraph_index (see this file's own "INTRA-
  -- PARAGRAPH OFFSET" note above) — a NULL offset with a real paragraph
  -- index is the ordinary, always-safe "paragraph-only" case.
  resume_paragraph_index integer
    check (resume_paragraph_index is null or resume_paragraph_index >= 0),
  resume_char_offset integer
    check (resume_char_offset is null or resume_char_offset >= 0),
  resume_updated_at timestamptz,
  constraint reading_places_resume_offset_needs_index
    check (resume_char_offset is null or resume_paragraph_index is not null),

  -- Deliberate Saved place — set only by an explicit "Save my place"/
  -- "Move my place" action. NULL until the member has deliberately
  -- saved a place in this content. Saving again UPDATES these same
  -- columns (moves the place) rather than ever inserting a second row
  -- — this table structurally supports at most one saved place per
  -- (member, content item), matching the product requirement directly,
  -- with no separate "which saved place" identifier needed.
  saved_paragraph_index integer
    check (saved_paragraph_index is null or saved_paragraph_index >= 0),
  saved_char_offset integer
    check (saved_char_offset is null or saved_char_offset >= 0),
  saved_at timestamptz,
  constraint reading_places_saved_offset_needs_index
    check (saved_char_offset is null or saved_paragraph_index is not null),

  created_at timestamptz not null default now(),

  primary key (user_id, content_type, content_id)
);

alter table public.reading_places enable row level security;

-- Exactly the dispatch_views precedent: one row is one member's own
-- reading state for one content item, readable/writable only by that
-- member, for any content_type this table is later extended to cover.
create policy reading_places_own
  on public.reading_places
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke all on public.reading_places from public;
grant select, insert, update on public.reading_places to authenticated;

commit;
