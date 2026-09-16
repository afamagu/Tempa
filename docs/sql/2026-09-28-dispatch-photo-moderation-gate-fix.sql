-- ============================================================
-- COHORT SAFETY READINESS — DISPATCH PHOTO MODERATION GATE FIX
-- ============================================================
-- Corrects a live-confirmed gap found by the Checkpoint 1 safety
-- contract verifier: two storage-visibility helpers for
-- dispatch-photos never checked d.moderation_status, unlike every
-- other read path for a Dispatch (dispatches_select_published,
-- get_shared_dispatch, search_dispatches — all in docs/sql/2026-09-07-
-- dispatches-and-board.sql, docs/sql/2026-09-10-admin-moderation-and-
-- questions.sql, docs/sql/2026-09-25-dispatch-postcards.sql). A
-- moderator hiding a Dispatch (moderation_status = 'hidden') stopped
-- it from appearing on the Board or via its own share link, but its
-- photo bytes remained fetchable through storage.objects by anyone who
-- already had (or could still resolve) the object path — for the
-- externally-shared helper, that includes a signed-out visitor.
--
-- SOURCE AUDIT (performed before writing this file):
--   1. Original definitions: docs/sql/2026-09-07-dispatches-and-
--      board.sql (dispatch_photo_is_visible: line 309;
--      dispatch_photo_is_externally_shared: line 796).
--   2. Only ONE later CREATE OR REPLACE exists for either function:
--      docs/sql/2026-09-12-scoped-blocking-and-fixes.sql:1651 redefines
--      dispatch_photo_is_visible to add the is_blocked_pair check; that
--      same file's own comment (line 1147) states can_view_letter_photo
--      and dispatch_photo_is_visible were "DELIBERATELY NOT changed"
--      with respect to moderation — moderation_status did not exist as
--      a column yet on 2026-09-11/12, it was only added later by
--      docs/sql/2026-09-10-admin-moderation-and-questions.sql's own
--      migration date notwithstanding its filename (see that file's
--      section 1). dispatch_photo_is_externally_shared has never been
--      redefined since its original 2026-09-07 body.
--   3. Current storage policies (dispatch_photos_select,
--      dispatch_photos_select_shared, docs/sql/2026-09-07-dispatches-
--      and-board.sql:350/824) call these two functions by name only —
--      no WHERE/USING logic of their own to update.
--   4. get_shared_dispatch's current moderation gate (docs/sql/2026-09-
--      25-dispatch-postcards.sql:463) already requires status =
--      'published' AND moderation_status = 'visible' before resolving
--      ANY field, including moments/photo paths — this migration brings
--      the storage-level gate in line with that same contract.
--   5. No existing migration already intended this fix — the gap is
--      genuine and has been live and unaddressed since moderation_status
--      was introduced.
-- No contradiction found. Proceeding.
--
-- This migration touches ONLY these two function bodies. It does not
-- touch: historical migration files (all reproduced above for the
-- record, never edited), storage policies (their USING clauses already
-- just call these functions by name), bucket privacy settings, RLS on
-- any table, blocked_users, is_blocked_pair, is_correspondence_blocked_
-- pair, Stop Letters semantics, Board ranking, topical interests, or
-- any other safety surface.
--
-- CREATE OR REPLACE is legal and used deliberately for both functions:
-- argument list and return type are byte-for-byte unchanged from their
-- live definitions, so this preserves each function's existing OID and
-- therefore its existing grants automatically (dispatch_photo_is_visible
-- stays authenticated-only EXECUTE, no anon; dispatch_photo_is_
-- externally_shared stays anon-EXECUTE via SECURITY DEFINER, no
-- authenticated grant) — no revoke/grant statements are reissued here.
-- ============================================================

-- ------------------------------------------------------------
-- 1. dispatch_photo_is_visible(text) — authenticated reader gate
-- ------------------------------------------------------------
-- Preserved unchanged: LANGUAGE sql, SECURITY INVOKER, STABLE,
-- search_path = 'public', the owner-path branch (an author may always
-- view their own uploaded photo regardless of moderation or any
-- block), the published requirement, and the full-block-only guard
-- (tempa_private.is_blocked_pair — Stop Letters/any-scope correspondence
-- blocking is NOT introduced here, matching every other photo/Moment
-- visibility path in this codebase).
--
-- Added: d.moderation_status = 'visible' inside the non-owner
-- ("attached to a published Dispatch") branch only — a moderator-hidden
-- Dispatch's photo is no longer readable via this path by anyone but
-- its own author.
create or replace function public.dispatch_photo_is_visible(p_path text)
returns boolean
language sql
security invoker
set search_path to 'public'
stable
as $$
  select
    auth.uid()::text = (storage.foldername(p_path))[1]
    or exists (
      select 1
      from public.dispatch_moments dm
      join public.dispatches d on d.id = dm.dispatch_id
      where dm.image_path = p_path
        and d.status = 'published'
        and d.moderation_status = 'visible'
        and not tempa_private.is_blocked_pair(auth.uid(), d.author_id)
    )
$$;

-- ------------------------------------------------------------
-- 2. dispatch_photo_is_externally_shared(text) — anon public-share gate
-- ------------------------------------------------------------
-- Preserved unchanged: LANGUAGE sql, SECURITY DEFINER (genuinely
-- required — anon holds no SELECT grant on any of the three tables
-- referenced), search_path = 'pg_catalog', the published requirement,
-- and the revoked-share requirement.
--
-- Added: d.moderation_status = 'visible' — brings this anon-facing
-- storage gate in line with get_shared_dispatch's own already-correct
-- moderation check (docs/sql/2026-09-25-dispatch-postcards.sql:490), so
-- a hidden Dispatch's photo stops being fetchable through storage the
-- same instant get_shared_dispatch itself stops returning that
-- Dispatch's row — closing the more severe of the two gaps, since this
-- path is reachable by a signed-out visitor.
create or replace function public.dispatch_photo_is_externally_shared(p_path text)
returns boolean
language sql
security definer
set search_path to 'pg_catalog'
stable
as $$
  select exists (
    select 1
    from public.dispatch_moments dm
    join public.dispatches d on d.id = dm.dispatch_id
    join public.dispatch_shares ds on ds.dispatch_id = d.id
    where dm.image_path = p_path
      and d.status = 'published'
      and d.moderation_status = 'visible'
      and ds.revoked_at is null
  )
$$;
