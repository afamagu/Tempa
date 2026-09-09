-- Tempa — Dispatches and The Board: canonical foundation migration.
-- PREPARED 2026-09-07. NOT EXECUTED — review, then run in the Supabase
-- SQL editor.
--
-- "TEMPA — DISPATCHES AND THE BOARD" supersedes the earlier Open
-- Letters specification. This migration does NOT drop and recreate the
-- live open_letters table — it was already executed
-- (docs/sql/2026-09-06-open-letters.sql) and may already hold real
-- rows. Every step below is an ALTER against the live table, or an
-- addition alongside it, specifically so existing rows survive.
--
-- Run this whole file as one transaction.

begin;

-- ============================================================
-- 1. RENAME open_letters -> dispatches
-- ============================================================
-- A pure rename preserves every existing row, its id, and every
-- foreign key that will reference it below — nothing is dropped.

alter table public.open_letters rename to dispatches;

alter table public.dispatches rename constraint open_letters_status_check to dispatches_status_check;
alter table public.dispatches rename constraint open_letters_body_not_blank to dispatches_body_not_blank;

alter index open_letters_published_feed_idx rename to dispatches_published_feed_idx;
alter index open_letters_author_published_idx rename to dispatches_author_published_idx;

alter policy open_letters_select_published on public.dispatches rename to dispatches_select_published;
alter policy open_letters_insert_own on public.dispatches rename to dispatches_insert_own;

-- ============================================================
-- 2. TITLE — required, one line, <= 70 characters
-- ============================================================
-- Added nullable first so the ALTER never fails against existing rows,
-- backfilled, THEN made NOT NULL — the standard safe sequence for
-- adding a required column to a live table. Every existing row (if
-- any) gets a generic placeholder; nothing about its body is touched.

alter table public.dispatches add column title text;

update public.dispatches set title = 'Untitled' where title is null;

alter table public.dispatches alter column title set not null;

alter table public.dispatches add constraint dispatches_title_not_blank
  check (char_length(trim(title)) > 0);

alter table public.dispatches add constraint dispatches_title_max_length
  check (char_length(title) <= 70);

-- ============================================================
-- 3. BODY LENGTH — 10,000 VISIBLE characters, not encoded storage
-- ============================================================
-- The live open_letters_body_max_length check (raised to 200000 in a
-- prior checkpoint as a defensive backstop only) is replaced with a
-- ceiling measured against the MEMBER-VISIBLE text, not the encoded
-- storage string. Rich-body encoding (lib/letter-editor-doc.ts) can add:
--   - the invisible rich-body marker (U+2063), exactly one character,
--     only ever at position 0 of the whole body;
--   - "**"/"_" mark delimiters around any bold/italic run.
-- Naively checking char_length(body) would reject a genuinely
-- 10,000-character piece of VISIBLE writing the instant it uses any
-- Bold/Italic, since the encoded string is longer than what the member
-- actually typed. dispatch_visible_length strips both before counting.
--
-- Known, deliberate approximation: an escaped literal "\*\*" or "\_" in
-- the encoded body (a member who genuinely typed a literal asterisk/
-- underscore) is stripped by this same regex, undercounting by one or
-- two characters in that rare case. This only ever makes the check
-- MORE permissive than the true visible length, never less — it can
-- never cause a legitimate submission to be falsely rejected, which is
-- the actual requirement; a handful of characters of slack on a
-- defensive ceiling is an acceptable, deliberate trade-off against
-- reimplementing lib/letter-editor-doc.ts's full tokenizer in SQL.
create or replace function public.dispatch_visible_length(p_body text)
returns integer
language sql
immutable
set search_path to 'pg_catalog'
as $$
  select char_length(
    regexp_replace(
      regexp_replace(
        regexp_replace(p_body, chr(8291), '', 'g'),
        '\*\*', '', 'g'
      ),
      '_', '', 'g'
    )
  )
$$;

alter table public.dispatches drop constraint if exists open_letters_body_max_length;

alter table public.dispatches add constraint dispatches_body_visible_length
  check (public.dispatch_visible_length(body) <= 10000);

-- ============================================================
-- 4. TOPICS — 0-3 plain tags per Dispatch
-- ============================================================
-- A normalized child table, not an array column: case-insensitive
-- dedup and a per-tag length ceiling are both simple, real constraints
-- this way, and search (title + tags + body) can join it directly. The
-- 0-3 count itself is enforced in publish_dispatch below (a per-row
-- CHECK cannot count sibling rows) — never trusted from the client
-- alone.

create table public.dispatch_topics (
  dispatch_id uuid not null
    references public.dispatches(id)
    on delete cascade,

  topic text not null,

  created_at timestamptz not null default now(),

  constraint dispatch_topics_not_blank
    check (char_length(trim(topic)) > 0),

  constraint dispatch_topics_max_length
    check (char_length(topic) <= 40),

  primary key (dispatch_id, topic)
);

-- Case-insensitive uniqueness per Dispatch — the primary key above only
-- prevents an exact-case duplicate; this is the real dedup guarantee.
create unique index dispatch_topics_unique_ci
  on public.dispatch_topics (dispatch_id, lower(topic));

create index dispatch_topics_topic_idx
  on public.dispatch_topics (lower(topic));

alter table public.dispatch_topics enable row level security;

create policy dispatch_topics_select_published
  on public.dispatch_topics
  for select
  to authenticated
  using (
    exists (
      select 1 from public.dispatches d
      where d.id = dispatch_topics.dispatch_id
        and (d.status = 'published' or d.author_id = auth.uid())
    )
  );

create policy dispatch_topics_insert_own
  on public.dispatch_topics
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.dispatches d
      where d.id = dispatch_topics.dispatch_id
        and d.author_id = auth.uid()
    )
  );

revoke all on public.dispatch_topics from public;
grant select, insert on public.dispatch_topics to authenticated;

-- publish_dispatch below enforces the 0-3 topic count on the normal
-- path, but the INSERT grant above is on the table itself — a client
-- could otherwise call PostgREST directly against dispatch_topics for
-- a Dispatch it owns and add far more than 3 rows, bypassing that
-- check entirely. A per-row CHECK cannot see sibling rows, so the cap
-- is enforced here with a small AFTER INSERT trigger instead — the
-- narrowest mechanism that actually closes the gap, not a general
-- rewrite of how topics are validated.
create or replace function public.dispatch_topics_enforce_max()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $$
begin
  -- Lock the parent Dispatch row before counting. Without this, two
  -- concurrent transactions each inserting a 4th topic for the same
  -- dispatch_id would each run the count below under their own READ
  -- COMMITTED snapshot, each see only the 3 rows that were already
  -- committed (neither can see the other's still-uncommitted insert),
  -- and both pass — leaving 5 rows once both commit. A row lock on
  -- dispatches forces the second inserter to block until the first
  -- transaction commits or rolls back; every statement under READ
  -- COMMITTED (this database's isolation level) takes a fresh
  -- snapshot, so once unblocked the count below correctly sees the
  -- first transaction's now-committed row and rejects the 4th. This
  -- needs no new privilege and stays SECURITY INVOKER: the same
  -- author_id = auth.uid() condition that already lets this caller
  -- insert a topic for this Dispatch also lets them SELECT ... FOR
  -- UPDATE it, under the existing dispatches RLS policies.
  perform 1 from public.dispatches where id = new.dispatch_id for update;

  if (select count(*) from public.dispatch_topics where dispatch_id = new.dispatch_id) > 3 then
    raise exception 'A Dispatch may carry at most 3 topics.';
  end if;
  return new;
end;
$$;

create trigger dispatch_topics_max_three
  after insert on public.dispatch_topics
  for each row
  execute function public.dispatch_topics_enforce_max();

-- ============================================================
-- 5. DISPATCH MOMENTS — still-image only, own table
-- ============================================================
-- Deliberately NOT the existing public.moments table: that table's
-- entire RLS/consent model (moments_select_participant,
-- can_view_letter_photo, photo_consent_status) is correspondence-
-- specific and must never be weakened or reinterpreted to fit a public-
-- publishing context. A Dispatch photo has a completely different,
-- much simpler visibility rule (published, or the viewer is the
-- author) — that difference is exactly why this is a separate table
-- with its own policies rather than a shared one. Photo-only: no
-- postcard_key column exists here at all — Postcards remain private-
-- correspondence-only (see the Build Guide's Dispatches section).
create table public.dispatch_moments (
  id uuid primary key default gen_random_uuid(),

  dispatch_id uuid not null
    references public.dispatches(id)
    on delete cascade,

  position integer not null,

  image_path text not null,

  created_at timestamptz not null default now(),

  constraint dispatch_moments_position_nonnegative
    check (position >= 0),

  -- At most one Moment per paragraph gap, same rule as private letters.
  constraint dispatch_moments_unique_gap
    unique (dispatch_id, position)
);

create index dispatch_moments_dispatch_idx
  on public.dispatch_moments (dispatch_id);

alter table public.dispatch_moments enable row level security;

create policy dispatch_moments_select_published
  on public.dispatch_moments
  for select
  to authenticated
  using (
    exists (
      select 1 from public.dispatches d
      where d.id = dispatch_moments.dispatch_id
        and (d.status = 'published' or d.author_id = auth.uid())
    )
  );

-- Requires BOTH that the Dispatch belongs to the caller AND that the
-- image_path being attached lives under the caller's own storage
-- folder (dispatch-photos/{author_id}/...). Without the second half, a
-- member could attach another member's still-unpublished photo path to
-- their own Dispatch; once that Dispatch is published,
-- dispatch_photo_is_visible's "attached to a published Dispatch"
-- branch would make that stranger's private, not-yet-published photo
-- readable by anyone — a real cross-account exposure, not a
-- hypothetical one, since only the composer that uploaded a photo
-- knows its randomly generated path today, but nothing before this
-- check actually enforced that boundary at the database level.
create policy dispatch_moments_insert_own
  on public.dispatch_moments
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.dispatches d
      where d.id = dispatch_moments.dispatch_id
        and d.author_id = auth.uid()
    )
    and auth.uid()::text = (storage.foldername(image_path))[1]
  );

revoke all on public.dispatch_moments from public;
grant select, insert on public.dispatch_moments to authenticated;

-- ============================================================
-- 6. DISPATCH PHOTO STORAGE — own bucket, own policies
-- ============================================================
-- Path convention: dispatch-photos/{author_id}/{random}.jpg —
-- deliberately keyed by AUTHOR id, not dispatch id. A Dispatch photo is
-- uploaded DURING composing, before the Dispatch row exists at all
-- (unlike a letter photo, which is always uploaded into an
-- ALREADY-established correspondence) — keying by dispatch_id would
-- create a chicken-and-egg problem where even the author couldn't
-- preview their own not-yet-published photo. Keying by author_id
-- avoids that entirely: the author can always read their own folder;
-- anyone else may read a specific path only once it is genuinely
-- attached to a published Dispatch.
insert into storage.buckets (id, name, public)
values ('dispatch-photos', 'dispatch-photos', false)
on conflict (id) do nothing;

-- SECURITY INVOKER, not DEFINER: dispatch_moments_select_published
-- already lets any authenticated caller read a published Dispatch's
-- Moments, so this function needs no elevated privilege to answer the
-- same question — running as invoker means it is bound by exactly the
-- same RLS as a plain SELECT would be, rather than an unnecessary
-- privilege escalation that happens to filter itself back down.
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
    )
$$;

revoke all on function public.dispatch_photo_is_visible(text) from public;
grant execute on function public.dispatch_photo_is_visible(text) to authenticated;

-- Pre-existing gap closed here: neither policy below originally had a
-- TO clause, which defaults a policy to role PUBLIC (anon included),
-- not authenticated-only — inconsistent with every other policy in
-- this file. It was masked only by dispatch_photo_is_visible's own
-- EXECUTE grant being authenticated-only (an anon call would error on
-- the function, not cleanly deny), which is a fragile way to rely on
-- an authentication boundary. Scoping both explicitly TO authenticated
-- makes that boundary correct and explicit, and — now that section 12
-- below adds a second, deliberately anon-facing policy on this same
-- bucket — makes the two policies' role scopes unambiguous by
-- contrast, rather than one being accidentally broader than intended.
create policy dispatch_photos_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'dispatch-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy dispatch_photos_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'dispatch-photos'
    and public.dispatch_photo_is_visible(name)
  );

-- No UPDATE/DELETE storage policy, same immutability convention as
-- letter-photos — an uploaded-but-never-published photo is a known,
-- accepted orphan for this version, matching the existing letter-photo
-- precedent (docs/sql/2026-08-31-moments.sql).

-- ============================================================
-- 7. VIEWED / RESUME STATE — private to the viewer
-- ============================================================
-- One row per (viewer, Dispatch). last_paragraph_index is the
-- content-stable resume position (never a raw pixel scroll offset,
-- which breaks across viewport widths/font-size changes and any future
-- reflow). Only the viewer who owns a row may read or write it — an
-- author has no way to query how many people have viewed their own
-- Dispatch; there is no aggregate view-count anywhere in this schema.
create table public.dispatch_views (
  viewer_id uuid not null
    references auth.users(id)
    on delete cascade,

  dispatch_id uuid not null
    references public.dispatches(id)
    on delete cascade,

  last_paragraph_index integer not null default 0,

  viewed_at timestamptz not null default now(),

  constraint dispatch_views_position_nonnegative
    check (last_paragraph_index >= 0),

  primary key (viewer_id, dispatch_id)
);

alter table public.dispatch_views enable row level security;

create policy dispatch_views_own
  on public.dispatch_views
  for all
  using (auth.uid() = viewer_id)
  with check (auth.uid() = viewer_id);

revoke all on public.dispatch_views from public;
grant select, insert, update on public.dispatch_views to authenticated;

-- ============================================================
-- 8. KEEP IN MIND — private relationship, never a public count
-- ============================================================
-- viewer_user_id "keeps" kept_user_id. RLS scopes every row to
-- auth.uid() = viewer_user_id — the kept person has no policy that
-- would ever let them query who has kept them, by construction, not
-- merely by app-level convention. Does not touch correspondences,
-- letters, or any messaging authorization.
create table public.kept_minds (
  viewer_user_id uuid not null
    references auth.users(id)
    on delete cascade,

  kept_user_id uuid not null
    references auth.users(id)
    on delete cascade,

  created_at timestamptz not null default now(),

  constraint kept_minds_no_self_keep
    check (viewer_user_id <> kept_user_id),

  primary key (viewer_user_id, kept_user_id)
);

alter table public.kept_minds enable row level security;

create policy kept_minds_own
  on public.kept_minds
  for all
  using (auth.uid() = viewer_user_id)
  with check (auth.uid() = viewer_user_id);

revoke all on public.kept_minds from public;
grant select, insert, delete on public.kept_minds to authenticated;

-- ============================================================
-- 9. PUBLISH_DISPATCH — one atomic call: Dispatch + topics + Moments
-- ============================================================
-- Mirrors publish_question_answer's own reasoning: a single top-level
-- plpgsql call is one transaction, so a Dispatch is never left with
-- some topics inserted and others missing (or Moments partially
-- attached) if any validation later in the same call fails.
-- SECURITY INVOKER (no elevated privilege) — bound by exactly the RLS
-- policies above, same as every plain insert already was; this exists
-- for atomicity and server-side validation, not to bypass anything.
create or replace function public.publish_dispatch(
  p_title text,
  p_body text,
  p_topics text[] default '{}',
  p_moments jsonb default '[]'::jsonb
)
returns public.dispatches
language plpgsql
security invoker
set search_path to 'public'
as $function$

declare
  new_id uuid;
  result public.dispatches;
  topic text;
  normalized_topics text[] := '{}';
  paragraph_count integer;
  m jsonb;

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
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

  -- Server-side normalize/dedupe (case-insensitive), never trusting the
  -- client to have already done this correctly.
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


  insert into public.dispatches (author_id, title, body)
  values (auth.uid(), p_title, p_body)
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

      -- Belt-and-suspenders alongside dispatch_moments_insert_own's own
      -- WITH CHECK below: fail with a clear error here rather than
      -- relying solely on the insert failing silently-ish against RLS.
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


  select * into result from public.dispatches where id = new_id;

  return result;

end;
$function$;

revoke all on function public.publish_dispatch(text, text, text[], jsonb) from public;
grant execute on function public.publish_dispatch(text, text, text[], jsonb) to authenticated;

-- ============================================================
-- 10. SEARCH — title + topics + body, chronological only
-- ============================================================
-- No ranking/scoring: plain ILIKE across the three surfaces, ordered
-- newest-first, same as browse. SECURITY INVOKER — bound by
-- dispatches_select_published, so an unpublished Dispatch can never
-- surface in another member's search results.
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
    and (
      d.title ilike '%' || p_query || '%'
      or d.body ilike '%' || p_query || '%'
      or exists (
        select 1 from public.dispatch_topics t
        where t.dispatch_id = d.id and t.topic ilike '%' || p_query || '%'
      )
    )
  order by d.published_at desc
$$;

revoke all on function public.search_dispatches(text) from public;
grant execute on function public.search_dispatches(text) to authenticated;

-- ============================================================
-- 11. DISPATCH SHARES — unguessable external-read tokens, RPC-managed
-- ============================================================
-- Three distinct product states, kept structurally distinct here, not
-- just in prose:
--   PUBLISHED  = dispatches.status = 'published' — visible to any
--                authenticated member on the Board. Sharing changes
--                nothing about this.
--   SHARED     = a live dispatch_shares row exists for that Dispatch
--                (revoked_at is null) — the author deliberately tapped
--                Share. Published does not imply shared, and vice
--                versa (a share row surviving a later unpublish is
--                simply never readable — see get_shared_dispatch).
--   PRIVATE CORRESPONDENCE = has no table, function, or route anywhere
--                in this section, or in this entire file. Nothing
--                below references letters, correspondences, or
--                public.moments — sharing is exclusively a Dispatch
--                concept, by construction, and stays that way.
--
-- id doubles as the share token itself — no separate token column.
-- gen_random_uuid() (already used as the default for every id in this
-- schema) provides the same ~122 bits of randomness that already makes
-- a Dispatch's photo paths safely unguessable elsewhere in this file;
-- reusing that exact primitive as the externally-shared identifier is
-- the smallest addition that meets "unguessable," not a new mechanism.
--
-- revoked_at (nullable) is the only lifecycle state: a share is either
-- live (revoked_at is null) or dead. No separate "active" boolean is
-- needed alongside it.
create table public.dispatch_shares (
  id uuid primary key default gen_random_uuid(),

  dispatch_id uuid not null
    references public.dispatches(id)
    on delete cascade,

  created_at timestamptz not null default now(),

  revoked_at timestamptz
);

create index dispatch_shares_dispatch_idx
  on public.dispatch_shares (dispatch_id);

-- A Dispatch may have at most one LIVE share at a time — enforced here,
-- at the database level, not merely by share_dispatch's own
-- get-or-create logic below (which relies on this exact index as its
-- ON CONFLICT target for race-safety; see that function's comment).
-- Historical revoked rows are unrestricted and simply accumulate — the
-- partial WHERE clause means only the live rows participate in the
-- uniqueness check at all.
create unique index dispatch_shares_one_active_per_dispatch
  on public.dispatch_shares (dispatch_id)
  where revoked_at is null;

alter table public.dispatch_shares enable row level security;

-- SELECT only, own rows only — an author may see their own Dispatches'
-- share history (e.g. to render "Sharing • Stop sharing" state without
-- needing to call a mutating RPC just to check it). No INSERT or
-- UPDATE policy exists at all: creating and revoking a share are no
-- longer ordinary client mutations against this table, by design (see
-- share_dispatch/revoke_dispatch_share below) — even if a policy did
-- permit it, section 11 removes the table-level grant, so a direct
-- PostgREST insert/update against dispatch_shares fails on privilege
-- before RLS is ever reached.
create policy dispatch_shares_select_own
  on public.dispatch_shares
  for select
  to authenticated
  using (
    exists (
      select 1 from public.dispatches d
      where d.id = dispatch_shares.dispatch_id
        and d.author_id = auth.uid()
    )
  );

revoke all on public.dispatch_shares from public;
grant select on public.dispatch_shares to authenticated;

-- share_dispatch: the ONLY way a share row is ever created. Validates
-- auth, ownership, and current publish status; then atomically returns
-- the existing live share if one exists, or creates one. SECURITY
-- DEFINER is genuinely required here (not a convenience): authenticated
-- no longer holds INSERT on dispatch_shares at all (see the grant
-- above), so an INVOKER function would fail on privilege before its
-- own validation logic even ran. The function body is the complete
-- trust boundary in its place — every write it performs is preceded by
-- its own ownership/status check, so removing the table grant does not
-- remove any real protection, it just removes a second, redundant path
-- to the same effect.
--
-- Race-safety: two concurrent calls for the same Dispatch both attempt
-- the INSERT; Postgres's own INSERT ... ON CONFLICT machinery (not
-- application-level locking) makes the second caller wait for the
-- first to commit and then correctly resolve to DO NOTHING against
-- dispatch_shares_one_active_per_dispatch, after which both calls'
-- final SELECT sees the same single row. This is the same category of
-- concurrency-correctness already applied to dispatch_topics_max_three
-- elsewhere in this file, via the mechanism suited to THIS shape of
-- problem (get-or-create) rather than reusing that trigger's row-lock
-- approach (suited to a count invariant) out of false consistency.
create or replace function public.share_dispatch(p_dispatch_id uuid)
returns public.dispatch_shares
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  result public.dispatch_shares;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not exists (
    select 1 from public.dispatches d
    where d.id = p_dispatch_id
      and d.author_id = auth.uid()
      and d.status = 'published'
  ) then
    raise exception 'Only the author of a published Dispatch may share it.';
  end if;

  insert into public.dispatch_shares (dispatch_id)
  values (p_dispatch_id)
  on conflict (dispatch_id) where revoked_at is null do nothing;

  select *
  into result
  from public.dispatch_shares
  where dispatch_id = p_dispatch_id
    and revoked_at is null;

  return result;
end;
$function$;

revoke all on function public.share_dispatch(uuid) from public;
-- authenticated only — sharing is an action the author takes from
-- inside TEMPA, never something an external visitor calls.
grant execute on function public.share_dispatch(uuid) to authenticated;

-- revoke_dispatch_share: "Stop sharing externally." Ownership is the
-- only requirement — deliberately NOT also requiring status =
-- 'published', so an author can still stop sharing a Dispatch they
-- have since unpublished. A no-op (not an error) if no live share
-- exists, matching the idempotent, side-effect-light shape of
-- share_dispatch above. Same SECURITY DEFINER justification as
-- share_dispatch: authenticated holds no UPDATE grant on
-- dispatch_shares at all.
create or replace function public.revoke_dispatch_share(p_dispatch_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not exists (
    select 1 from public.dispatches d
    where d.id = p_dispatch_id
      and d.author_id = auth.uid()
  ) then
    raise exception 'Only the author of a Dispatch may stop sharing it.';
  end if;

  update public.dispatch_shares
  set revoked_at = now()
  where dispatch_id = p_dispatch_id
    and revoked_at is null;
end;
$function$;

revoke all on function public.revoke_dispatch_share(uuid) from public;
grant execute on function public.revoke_dispatch_share(uuid) to authenticated;

-- ============================================================
-- 12. SHARE-SCOPED STORAGE ACCESS — exactly the shared Dispatch's photos
-- ============================================================
-- dispatch_photo_is_visible (section 6) intentionally stays untouched
-- and authenticated-only: it is the Board/reader's own visibility
-- rule and must not be widened. This is a second, independent
-- function + policy pair, reachable only by anon, and scoped more
-- narrowly than "any published Dispatch's photo" — specifically to a
-- photo whose Dispatch currently has a live (non-revoked) share. A
-- Dispatch with no share row at all remains completely unreachable by
-- anon, even though it may be published and visible on the Board.
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
      and ds.revoked_at is null
  )
$$;

-- SECURITY DEFINER here is genuinely necessary, not a convenience: the
-- caller is the anon role, which holds no SELECT grant on
-- dispatch_moments, dispatches, or dispatch_shares at all (see their
-- own "revoke all from public" lines above) — a SECURITY INVOKER
-- function would fail on privilege before RLS is even reached. The
-- function's own body is the entire trust boundary, which is exactly
-- why it does nothing but this one existence check.
revoke all on function public.dispatch_photo_is_externally_shared(text) from public;
grant execute on function public.dispatch_photo_is_externally_shared(text) to anon;

create policy dispatch_photos_select_shared
  on storage.objects
  for select
  to anon
  using (
    bucket_id = 'dispatch-photos'
    and public.dispatch_photo_is_externally_shared(name)
  );

-- The bucket itself remains private (public = false, set in section 6)
-- — anon can never list or browse it. This policy only ever lets a
-- caller who already has the exact random path (learned solely via
-- get_shared_dispatch below, itself gated on a valid share token)
-- retrieve that one object.

-- ============================================================
-- 13. GET_SHARED_DISPATCH — the sole external read path
-- ============================================================
-- The one and only way an anonymous visitor can read anything about a
-- Dispatch. Deliberately NOT a view and NOT direct table access: the
-- base dispatches/dispatch_topics/dispatch_moments tables keep their
-- existing "revoke all from public; ... to authenticated" grants
-- completely unchanged (verified in sections 1/4/5 above) — a raw
-- Dispatch id grants an anonymous caller nothing at all. Only a valid,
-- unrevoked share token does, and only through this function.
--
-- SECURITY DEFINER for the same reason as section 12's function: anon
-- has no table privilege to satisfy this otherwise. The function body
-- is the complete allowlist of what an external reader may ever see —
-- title, body, published_at, the author's pseudonym only (via
-- public_profiles, never profiles directly, and never email/exact
-- identity), topics, and each Moment's position/image_path (resolved
-- to a signed URL by the caller afterward, exactly like
-- getDispatchMoments already does for the authenticated reader — see
-- lib/dispatches.ts). No Keep state, no view/resume state, no other
-- Dispatches by the same author, and no way to reach any of those
-- through this function — it returns a fixed, flat row shape only.
--
-- An invalid token, a revoked token, and a token whose Dispatch is not
-- (or no longer) published all produce the SAME empty result — zero
-- rows, no error — so a caller cannot distinguish "never existed" from
-- "revoked" from "unpublished." That ambiguity is deliberate: a share
-- link is not a sensitive credential worth an oracle-resistant error
-- taxonomy, but there is no reason to leak more than necessary either.
create or replace function public.get_shared_dispatch(p_token uuid)
returns table (
  dispatch_id uuid,
  title text,
  body text,
  published_at timestamptz,
  author_pseudonym text,
  topics text[],
  moments jsonb
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
    and d.status = 'published';

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
    )
  from public.dispatches d
  left join public.public_profiles pp on pp.id = d.author_id
  where d.id = found_id;
end;
$function$;

revoke all on function public.get_shared_dispatch(uuid) from public;
-- Granted to both roles, not anon alone: an already-signed-in member
-- who opens a /d/[shareToken] link (e.g. forwarded by a friend) should
-- be able to read it through the same single function, rather than
-- the app needing a second code path for that case.
grant execute on function public.get_shared_dispatch(uuid) to anon, authenticated;

commit;
