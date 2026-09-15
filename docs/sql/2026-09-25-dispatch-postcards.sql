-- ============================================================
-- TEMPA — DISPATCH POSTCARDS, CHECKPOINT 2
-- STATUS: PREPARED, NOT YET APPLIED. Do not run against production
-- until reviewed — see docs/sql/2026-09-25-dispatch-postcards-verify.sql
-- for the read-only proof to run immediately afterward.
--
-- LOCKED PRODUCT MODEL (Checkpoints 1/1B): a published Dispatch may
-- carry ZERO OR ONE TEMPA Postcard, selected once by the author during
-- initial composition/publication and never mutable afterward —
-- update_dispatch gains NO Postcard parameter at all in this migration.
-- Reuses the EXISTING Letters Postcard architecture in full
-- (public.postcard_catalog/public.postcard_versions — see
-- docs/sql/2026-09-14-letter-level-postcards.sql, NOT touched by this
-- migration in any way) rather than a parallel system: the only new
-- object here is one sibling instance table, `public.dispatch_postcards`,
-- structurally identical to `public.letter_postcards` wherever the
-- product semantics are the same (immutable postcard_version_id, a
-- sender/author-written back_message and optional reveal_line, a
-- snapshotted pseudonym) — see that table's own definition below for
-- the one deliberate difference (its RLS delegates through `dispatches`
-- directly, not through a view, for a reason specific to Dispatches;
-- explained at the policy itself).
--
-- ============================================================
-- WHY publish_dispatch BECOMES SECURITY DEFINER IN THIS MIGRATION
-- ============================================================
-- publish_dispatch has been SECURITY INVOKER since docs/sql/2026-09-12-
-- scoped-blocking-and-fixes.sql (its sibling RPCs, update_dispatch and
-- delete_dispatch, are BOTH already SECURITY DEFINER — publish_dispatch
-- was the sole holdout, an existing inconsistency this migration does
-- not otherwise attempt to explain away). `dispatch_postcards` below
-- deliberately carries NO INSERT/UPDATE/DELETE policy for `authenticated`
-- at all (mirroring `letter_postcards`' own write-only-via-RPC posture,
-- itself mirroring `public.moments`) — this is what makes "no ordinary
-- code path can create/mutate this row outside publish_dispatch" a real,
-- structural guarantee rather than a client-side convention a crafted
-- request could bypass (a client could otherwise INSERT a
-- `dispatch_postcards` row directly with a FABRICATED
-- postcard_version_id, e.g. one that was never actually current,
-- entirely defeating "the server always resolves the current version").
-- A SECURITY INVOKER publish_dispatch — running as the calling
-- `authenticated` role — would therefore be BLOCKED from ever inserting
-- into `dispatch_postcards` itself, the same way it would be blocked
-- from inserting into `letter_postcards` today. Converting
-- publish_dispatch to SECURITY DEFINER (same `set search_path to
-- 'pg_catalog'` hardening its two siblings already use) is therefore
-- NECESSARY, not incidental, and brings it into line with
-- update_dispatch/delete_dispatch rather than away from precedent. Every
-- table reference inside the function body is already fully schema-
-- qualified (`public.dispatches`, `public.dispatch_topics`,
-- `public.dispatch_moments`, `storage.foldername`), so this hardening is
-- safe under the new search_path. The function's own code remains the
-- sole trust boundary exactly as it already is for its two DEFINER
-- siblings: it hard-codes `author_id = auth.uid()` and never accepts an
-- arbitrary author id, and never sets moderation_status/moderated_at
-- explicitly (both keep their column defaults), so this change does not
-- newly permit anything dispatches_insert_own's own WITH CHECK would
-- otherwise have blocked — it only changes WHICH layer enforces it,
-- identically to how update_dispatch/delete_dispatch already operate.
-- FLAGGED explicitly in this checkpoint's own completion report as a
-- real, deliberate security-posture change to an existing, live RPC —
-- review before applying.
--
-- ============================================================
-- WHY get_shared_dispatch's RETURN SHAPE WIDENS VIA A SINGLE `postcard
-- jsonb` COLUMN, NOT TWELVE NEW FLAT COLUMNS
-- ============================================================
-- Mirrors this exact function's own established convention for
-- `moments jsonb` (already a single aggregated jsonb column, not one
-- flat column per Moment field) — a resolved Postcard's presentation
-- fields (front image, motion asset, postmark/footer text, the author's
-- own reveal line/back message/pseudonym snapshot) are bundled the same
-- way. `CREATE OR REPLACE FUNCTION` cannot change a RETURNS TABLE
-- function's output column list at all (the exact class of failure this
-- engagement already hit once before with this same function — see
-- docs/sql/2026-09-10-admin-moderation-and-questions.sql's own header
-- note) — so, exactly like write_letter/reply_to_letter's own precedent
-- for a widened argument list, the OLD signature is explicitly DROPped
-- before the new one is created below.
--
-- SECURITY (Checkpoint 2's own locked requirements, verified below):
-- this migration does NOT widen anon's grants on postcard_catalog,
-- postcard_versions, or the new dispatch_postcards table in any way —
-- get_shared_dispatch alone (SECURITY DEFINER, already granted to
-- anon/authenticated) resolves and returns the Postcard's presentation
-- fields for a signed-out visitor, exactly the same boundary-crossing
-- pattern it already uses for `title`/`body`/`moments` themselves.
-- letter_postcards' own privacy model (Letters remain fully separate,
-- private correspondence) is completely untouched — nothing in this
-- file references that table.
-- ============================================================

begin;

-- ============================================================
-- 1. DISPATCH_POSTCARDS — the Dispatch-level sibling of letter_postcards
-- ============================================================
-- dispatch_id is itself the primary key (strict 1:1 with a Dispatch,
-- same reasoning as letter_postcards.letter_id) — a second insert for
-- the same Dispatch is a PK violation, structurally enforcing "at most
-- one Postcard." postcard_version_id references the immutable
-- postcard_versions row resolved by publish_dispatch at the moment of
-- publication — never the bare catalog key (never store only the key as
-- the historical association, per the locked product contract).
-- reveal_line/back_message/sender_pseudonym_snapshot mirror
-- letter_postcards' own column types AND constraints exactly — the
-- product semantics (an optional short reveal line, a required
-- non-blank-once-trimmed back message capped at 200 characters, a
-- frozen author pseudonym) are identical between a Letter's Postcard and
-- a Dispatch's.
create table public.dispatch_postcards (
  dispatch_id uuid primary key
    references public.dispatches(id)
    on delete cascade,

  postcard_version_id uuid not null
    references public.postcard_versions(id),

  -- Optional. NULL means "no Reveal Line" — same convention as
  -- letter_postcards.reveal_line.
  reveal_line text,

  -- REQUIRED, non-blank once trimmed — "the back is written for this
  -- particular Dispatch," enforced both here and in publish_dispatch
  -- below (the RPC checks first, for a friendly TEMPA error; the CHECK
  -- is the standing, un-bypassable guarantee) — identical invariant to
  -- letter_postcards_back_message_length.
  back_message text not null,

  -- The publishing author's pseudonym exactly as it read at the moment
  -- this Dispatch was published — frozen forever, same reasoning as
  -- letter_postcards.sender_pseudonym_snapshot (a Dispatch's ordinary
  -- byline intentionally keeps resolving the author's CURRENT
  -- pseudonym dynamically; this frozen field is Postcard-only).
  sender_pseudonym_snapshot text not null,

  created_at timestamptz not null default now(),

  constraint dispatch_postcards_reveal_line_length
    check (reveal_line is null or char_length(reveal_line) <= 32),

  constraint dispatch_postcards_back_message_length
    check (char_length(trim(both from back_message)) between 1 and 200)
);

alter table public.dispatch_postcards
enable row level security;

-- Authenticated readers may SELECT an attached Dispatch Postcard only
-- when the underlying Dispatch is legitimately visible to them under
-- dispatches_select_published's own rules. Deliberately DIFFERENT from
-- letter_postcards_select_participant's own delegation-through-a-view
-- pattern, and deliberately SIMPLER: `authenticated` holds ZERO grants
-- on the base `public.letters` table (docs/sql/2026-08-30-letters.sql),
-- which is exactly why THAT policy has to delegate through the
-- `letters_for_participant` VIEW instead of querying `public.letters`
-- directly (querying a table you hold no grant on fails with 42501
-- before RLS is even evaluated — see docs/sql/2026-09-14-letter-level-
-- postcards.sql's own §7 for the full incident this pattern exists to
-- avoid). `authenticated` DOES hold a direct SELECT grant on
-- `public.dispatches` (only UPDATE/DELETE were ever revoked — see
-- docs/sql/2026-09-10-admin-moderation-and-questions.sql), so this
-- policy can reference `public.dispatches` directly with no such risk.
-- Postgres RLS applies to EVERY table reference regardless of which
-- policy is doing the querying, so this inner SELECT is itself already
-- filtered by dispatches_select_published — reproducing that policy's
-- full predicate here (published, moderator-visible, not a blocked pair,
-- author's content publicly visible, OR the caller is the author) would
-- be redundant AND a maintenance hazard (a future change to
-- dispatches_select_published would silently desynchronize from a
-- hand-copied predicate here). Delegating to the table itself, protected
-- by its own live RLS, keeps this policy correct by construction.
create policy dispatch_postcards_select_visible
  on public.dispatch_postcards
  for select
  to authenticated
  using (
    exists (
      select 1 from public.dispatches d
      where d.id = dispatch_postcards.dispatch_id
    )
  );

-- No INSERT/UPDATE/DELETE policy at all — mirrors letter_postcards'
-- own write-only-via-SECURITY-DEFINER-RPC posture exactly. The ONLY
-- write path is inside publish_dispatch below, atomically with the
-- Dispatch itself; update_dispatch is NOT extended to touch this table
-- in any way, so there is no ordinary code path that can change or
-- remove an already-published Dispatch's Postcard.
revoke all
on public.dispatch_postcards
from public, anon, authenticated;

grant select
on public.dispatch_postcards
to authenticated;


-- ============================================================
-- 2. PUBLISH_DISPATCH — extended with an OPTIONAL Postcard input,
--    following write_letter/reply_to_letter's established pattern as
--    closely as the product semantics allow. See this file's own header
--    for why this also converts the function to SECURITY DEFINER.
-- ============================================================
-- Old 4-arg signature explicitly dropped before the new 5-arg one is
-- created — CREATE OR REPLACE FUNCTION cannot widen an argument list on
-- its own; a stale 4-arg overload left behind would remain callable
-- (and, since it's SECURITY INVOKER today, would simply fail to resolve
-- p_postcard at all) unless removed explicitly. Same precedent as
-- write_letter's own DROP FUNCTION IF EXISTS ... (4 args) in
-- docs/sql/2026-09-14-letter-level-postcards.sql.
drop function if exists public.publish_dispatch(text, text, text[], jsonb);

create or replace function public.publish_dispatch(
  p_title text,
  p_body text,
  p_topics text[] default '{}',
  p_moments jsonb default '[]'::jsonb,
  p_postcard jsonb default null
)
returns public.dispatches
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$

declare
  new_id uuid;
  result public.dispatches;
  topic text;
  normalized_topics text[] := '{}';
  paragraph_count integer;
  m jsonb;
  -- Dispatch Postcards Checkpoint 2 — deliberately `v_`-prefixed, never
  -- bare column-shaped names, same discipline write_letter/
  -- reply_to_letter already established for their own Postcard locals.
  has_postcard boolean;
  v_postcard_key text;
  v_postcard_version_id uuid;
  v_reveal_line text;
  v_back_message text;
  v_sender_pseudonym text;

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'This action is not available right now.';
  end if;

  if char_length(trim(p_title)) = 0 then
    raise exception 'A Dispatch needs a title.';
  end if;

  if char_length(p_title) > 70 then
    raise exception 'Title is too long.';
  end if;

  if array_length(p_topics, 1) is not null and array_length(p_topics, 1) > 3 then
    raise exception 'A Dispatch may carry at most 3 topics.';
  end if;

  foreach topic in array coalesce(p_topics, '{}') loop
    topic := trim(topic);
    if char_length(topic) = 0 then
      continue;
    end if;
    if char_length(topic) > 40 then
      raise exception 'A topic is too long.';
    end if;
    if not exists (
      select 1 from unnest(normalized_topics) t where lower(t) = lower(topic)
    ) then
      normalized_topics := array_append(normalized_topics, topic);
    end if;
  end loop;

  if array_length(normalized_topics, 1) is not null and array_length(normalized_topics, 1) > 3 then
    raise exception 'A Dispatch may carry at most 3 topics.';
  end if;


  -- Dispatch Postcards Checkpoint 2 — validated BEFORE any insert below,
  -- same reasoning as write_letter/reply_to_letter: a Postcard that
  -- fails validation must never leave a half-published Dispatch behind.
  -- This whole function runs inside one implicit transaction, so an
  -- exception anywhere here rolls back everything that ran before it,
  -- including the dispatches/dispatch_topics/dispatch_moments inserts
  -- further down. No separate "restricted" re-check is needed here (the
  -- overall account-status gate above already blocks a restricted
  -- account from publishing ANY Dispatch, Postcard or not — unlike
  -- Letters, where a restricted account may still send plain text).
  has_postcard := p_postcard is not null;

  if has_postcard then

    v_postcard_key := p_postcard->>'postcard_key';
    v_reveal_line := p_postcard->>'reveal_line';
    v_back_message := p_postcard->>'back_message';

    if v_postcard_key is null or char_length(trim(v_postcard_key)) = 0 then
      raise exception 'A Postcard requires a postcard key.';
    end if;

    if not exists (
      select 1 from public.postcard_catalog
      where key = v_postcard_key and is_active
    ) then
      raise exception 'Unknown postcard.';
    end if;

    -- Resolve the CURRENT immutable version — exactly like
    -- write_letter/reply_to_letter. This, not the bare key, is what
    -- dispatch_postcards stores below; a future artwork/metadata
    -- revision (admin_create_postcard_version) never touches this
    -- Dispatch's own reference once it exists.
    select id
    into v_postcard_version_id
    from public.postcard_versions
    where postcard_key = v_postcard_key and is_current;

    if v_postcard_version_id is null then
      raise exception 'This postcard has no current version available.';
    end if;

    if v_reveal_line is not null and char_length(v_reveal_line) > 32 then
      raise exception 'A Postcard''s Reveal Line is too long.';
    end if;

    if v_back_message is null or char_length(trim(both from v_back_message)) = 0 then
      raise exception 'A Postcard needs its own written message before it can be published.';
    end if;

    if char_length(trim(both from v_back_message)) > 200 then
      raise exception 'A Postcard''s back message is too long.';
    end if;

    -- Snapshot the publishing author's CURRENT pseudonym, frozen forever
    -- on this row — see this file's own header for why.
    select pseudonym
    into v_sender_pseudonym
    from public.profiles
    where id = auth.uid();

    if v_sender_pseudonym is null then
      raise exception 'Could not resolve your pseudonym for this Postcard.';
    end if;

  end if;


  -- FIXED (docs/sql/2026-09-12-scoped-blocking-and-fixes.sql): explicit
  -- status/published_at — unchanged by this migration.
  insert into public.dispatches (author_id, title, body, status, published_at)
  values (auth.uid(), p_title, p_body, 'published', now())
  returning id into new_id;


  if array_length(normalized_topics, 1) is not null then
    insert into public.dispatch_topics (dispatch_id, topic)
    select new_id, t from unnest(normalized_topics) as t;
  end if;


  if coalesce(jsonb_array_length(p_moments), 0) > 0 then

    paragraph_count := coalesce(
      array_length(
        regexp_split_to_array(trim(both from p_body), '\n\s*\n'),
        1
      ),
      1
    );

    for m in select * from jsonb_array_elements(p_moments)
    loop

      if m->>'type' is distinct from 'photo' then
        raise exception 'Only still-image Moments are supported in a Dispatch.';
      end if;

      if
        (m->>'position')::integer < 0
        or (m->>'position')::integer >= paragraph_count
      then
        raise exception 'Moment position is out of range for this Dispatch.';
      end if;

      if auth.uid()::text is distinct from (storage.foldername(m->>'image_path'))[1] then
        raise exception 'A Moment photo must belong to the author.';
      end if;

    end loop;

    insert into public.dispatch_moments (dispatch_id, position, image_path)
    select
      new_id,
      (elem->>'position')::integer,
      elem->>'image_path'
    from jsonb_array_elements(p_moments) as elem;

  end if;


  -- Inserted atomically with the Dispatch itself: same function
  -- invocation/transaction as the dispatches INSERT above, so any
  -- failure anywhere in this function rolls back everything, including
  -- this row. back_message is stored TRIMMED, matching this table's own
  -- CHECK constraint exactly (same convention as letter_postcards).
  if has_postcard then

    insert into public.dispatch_postcards (
      dispatch_id,
      postcard_version_id,
      reveal_line,
      back_message,
      sender_pseudonym_snapshot
    )
    values (
      new_id,
      v_postcard_version_id,
      v_reveal_line,
      trim(both from v_back_message),
      v_sender_pseudonym
    );

  end if;


  select * into result from public.dispatches where id = new_id;

  return result;

end;
$function$;

revoke all on function public.publish_dispatch(text, text, text[], jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.publish_dispatch(text, text, text[], jsonb, jsonb) to authenticated;


-- ============================================================
-- 3. GET_SHARED_DISPATCH — widened to also return the resolved,
--    attached Dispatch Postcard's presentation fields (single `postcard
--    jsonb` column, null when none attached). The security gate is
--    reproduced BYTE-FOR-BYTE from its current live definition
--    (docs/sql/2026-09-10-admin-moderation-and-questions.sql:241-300) —
--    NOT ONE predicate changes: share id matches token, revoked_at is
--    null, status = 'published', moderation_status = 'visible'. Never
--    returns author_id or any other private/member-only field. Never
--    widens anon's grants on postcard_catalog/postcard_versions/
--    dispatch_postcards — this SECURITY DEFINER function resolves the
--    Postcard fields itself and hands back only the resolved
--    presentation shape LetterheadPostcard/PostcardObject need.
-- ============================================================
-- Old return shape explicitly dropped first — see this file's own
-- header for why CREATE OR REPLACE cannot widen a RETURNS TABLE
-- function's own output columns.
drop function if exists public.get_shared_dispatch(uuid);

create or replace function public.get_shared_dispatch(p_token uuid)
returns table (
  dispatch_id uuid,
  title text,
  body text,
  published_at timestamptz,
  author_pseudonym text,
  author_country text,
  topics text[],
  moments jsonb,
  postcard jsonb
)
language plpgsql
security definer
set search_path to 'pg_catalog'
stable
as $function$
declare
  found_id uuid;
begin
  select d.id
  into found_id
  from public.dispatch_shares ds
  join public.dispatches d on d.id = ds.dispatch_id
  where ds.id = p_token
    and ds.revoked_at is null
    and d.status = 'published'
    and d.moderation_status = 'visible';

  if found_id is null then
    return;
  end if;

  return query
  select
    d.id,
    d.title,
    d.body,
    d.published_at,
    coalesce(pp.pseudonym, 'A TEMPA member'),
    pp.country,
    coalesce(
      (select array_agg(t.topic order by t.topic) from public.dispatch_topics t where t.dispatch_id = d.id),
      '{}'::text[]
    ),
    coalesce(
      (
        select jsonb_agg(jsonb_build_object('id', dm.id, 'position', dm.position, 'image_path', dm.image_path) order by dm.position)
        from public.dispatch_moments dm
        where dm.dispatch_id = d.id
      ),
      '[]'::jsonb
    ),
    -- Dispatch Postcards Checkpoint 2 — the resolved presentation shape
    -- only (never postcard_key/postcard_version_id/any internal id).
    -- Naturally null when no dispatch_postcards row exists for this
    -- Dispatch, satisfying "no attached Postcard -> null" with no extra
    -- coalesce needed.
    (
      select jsonb_build_object(
        'title', pv.title,
        'location', pv.location,
        'collection', pv.collection,
        'postmark_text', pv.postmark_text,
        'footer_text', pv.footer_text,
        'front_image_path', pv.front_image_path,
        'motion_src', pv.motion_src,
        'duration_seconds', pv.duration_seconds,
        'reveal_line_alignment', pv.reveal_line_alignment,
        'reveal_line', dp.reveal_line,
        'back_message', dp.back_message,
        'sender_pseudonym_snapshot', dp.sender_pseudonym_snapshot
      )
      from public.dispatch_postcards dp
      join public.postcard_versions pv on pv.id = dp.postcard_version_id
      where dp.dispatch_id = d.id
    )
  from public.dispatches d
  left join public.public_profiles pp on pp.id = d.author_id
  where d.id = found_id;
end;
$function$;

revoke all on function public.get_shared_dispatch(uuid) from public, anon, authenticated;
grant execute on function public.get_shared_dispatch(uuid) to anon, authenticated;

commit;
