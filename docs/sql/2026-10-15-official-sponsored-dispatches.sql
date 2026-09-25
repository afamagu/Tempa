-- ============================================================
-- TEMPA — OFFICIAL TEMPA DISPATCHES + SPONSORED DISPATCHES
-- STATUS: NOT EXECUTED — review, then run in the Supabase SQL editor
-- BEFORE deploying the application code that reads these columns.
-- Forward-only. Edits no historical migration. publish_dispatch and
-- update_dispatch (the MEMBER paths) are NOT touched.
-- ============================================================
--
-- PUBLICATION IDENTITY — one canonical field on public.dispatches:
--
--   published_as  text not null default 'member'
--                 check in ('member', 'tempa', 'sponsored')
--
--   member     — ordinary member Dispatch (every existing row; the
--                default for every row publish_dispatch inserts, which
--                never names this column). Public identity = the
--                author's own profile, exactly as today.
--   tempa      — published BY Tempa. Public identity = Tempa emblem +
--                "Tempa". No member identity.
--   sponsored  — sponsored content in Dispatch format. Public identity
--                = "Sponsored" + sponsor_name. Never presented as Tempa
--                authoring the advertisement.
--
-- author_id is unchanged in meaning: the authenticated human who
-- created the row (authorization, audit, storage ownership of Moment
-- photos). For tempa/sponsored rows it is NEVER used as public identity
-- — get_shared_dispatch below no longer resolves a member profile for
-- them, and the app's display resolution (lib/dispatch-identity.ts)
-- never falls back to the author's profile.
--
-- Sponsor metadata (sponsored rows only):
--   sponsor_name       required, 1..80 chars
--   sponsor_cta_label  optional, <= 40 chars, only with a URL
--   sponsor_cta_url    optional, https:// only, <= 500 chars
--
-- INVARIANTS (database-enforced, not UI):
--   * dispatches_published_as_check — only the three values;
--   * dispatches_sponsor_shape — sponsored rows require sponsor_name;
--     member and tempa rows carry NO sponsor metadata at all;
--   * dispatches_sponsor_cta_url_https — https:// only, so no
--     javascript:/data:/custom protocols can ever be stored;
--   * trigger dispatches_publication_identity_guard — a non-member row
--     may only be created by an author who holds the 'admin' staff
--     role, and published_as can never change after insert.
--   * Members have no INSERT/UPDATE privilege on dispatches at all
--     (revoked in 2026-10-06-safety-checkpoint4-public-surfaces.sql);
--     every write is RPC-only.
--
-- NEW RPCs (SECURITY DEFINER — they write a table members cannot write
-- directly; each re-checks is_staff('admin') itself, independent of the
-- /admin route guard):
--   publish_official_dispatch(...)  — create a tempa/sponsored Dispatch
--   update_official_dispatch(...)   — edit one, same 30-minute window
--                                     and reply lock as update_dispatch
--
-- SAFETY: official/sponsored publishing is a staff-authorized content
-- action. It does not consume a member Safety evaluation, so Tempa's
-- own pricing/product copy or a sponsor CTA can never be scored as
-- member-to-member financial solicitation or create a violation
-- against the admin's own account. Non-staff callers cannot reach this
-- path (is_staff('admin') is the FIRST check after authentication), and
-- the member publish_dispatch/update_dispatch Safety path is unchanged.
--
-- POSTCARD SENDER SNAPSHOT:
--   member     — publish_dispatch, unchanged: the member's pseudonym.
--   tempa      — 'Tempa'.
--   sponsored  — the sponsor name.
--   Resolved server-side; never a client-supplied sender.
--
-- BOARD RANKING: board_feed_page is re-created (section 6) so the creating
-- admin's personal Keep/correspondence relationships never boost or
-- classify Tempa/Sponsored rows — they rank as neutral discovery rows.
--
-- GET_SHARED_DISPATCH (anonymous /d/[shareToken]) — widened with
-- published_as + sponsor fields. The share-token security gate is
-- reproduced byte-for-byte. For tempa/sponsored rows author_pseudonym
-- is 'Tempa' / the sponsor name and author_country is null: no member
-- profile of the creating admin is ever read or returned. author_id is
-- still never returned.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. COLUMNS + CONSTRAINTS
-- ------------------------------------------------------------
alter table public.dispatches
  add column if not exists published_as text not null default 'member',
  add column if not exists sponsor_name text,
  add column if not exists sponsor_cta_label text,
  add column if not exists sponsor_cta_url text;

alter table public.dispatches
  add constraint dispatches_published_as_check
    check (published_as in ('member', 'tempa', 'sponsored'));

alter table public.dispatches
  add constraint dispatches_sponsor_shape
    check (
      (
        published_as = 'sponsored'
        and sponsor_name is not null
        and char_length(trim(both from sponsor_name)) between 1 and 80
        and (sponsor_cta_label is null or char_length(trim(both from sponsor_cta_label)) between 1 and 40)
        and (sponsor_cta_label is null or sponsor_cta_url is not null)
      )
      or (
        published_as <> 'sponsored'
        and sponsor_name is null
        and sponsor_cta_label is null
        and sponsor_cta_url is null
      )
    );

alter table public.dispatches
  add constraint dispatches_sponsor_cta_url_https
    check (
      sponsor_cta_url is null
      or (
        char_length(sponsor_cta_url) <= 500
        and sponsor_cta_url ~ '^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:[0-9]{1,5})?([/?#][^[:space:]<>"]*)?$'
      )
    );


-- ------------------------------------------------------------
-- 2. IDENTITY GUARD TRIGGER
-- ------------------------------------------------------------
create or replace function tempa_private.dispatches_publication_identity_guard()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if tg_op = 'UPDATE' and new.published_as is distinct from old.published_as then
    raise exception 'A Dispatch''s publication identity cannot change.';
  end if;

  if new.published_as <> 'member' and not exists (
    select 1 from public.staff_roles sr
    where sr.user_id = new.author_id and sr.role = 'admin'
  ) then
    raise exception 'Only Tempa staff may publish as Tempa or Sponsored.';
  end if;

  return new;
end;
$function$;

revoke all on function tempa_private.dispatches_publication_identity_guard() from public, anon, authenticated;

create trigger dispatches_publication_identity_guard
  before insert or update of published_as, sponsor_name, sponsor_cta_label, sponsor_cta_url, author_id
  on public.dispatches
  for each row
  execute function tempa_private.dispatches_publication_identity_guard();


-- ------------------------------------------------------------
-- 3. PUBLISH_OFFICIAL_DISPATCH (staff only)
-- ------------------------------------------------------------
create or replace function public.publish_official_dispatch(
  p_published_as text,
  p_title text,
  p_body text,
  p_topics text[] default '{}',
  p_moments jsonb default '[]'::jsonb,
  p_postcard jsonb default null,
  p_sponsor_name text default null,
  p_sponsor_cta_label text default null,
  p_sponsor_cta_url text default null
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
  has_postcard boolean;
  v_postcard_key text;
  v_postcard_version_id uuid;
  v_reveal_line text;
  v_back_message text;
  v_sender text;
  v_sponsor_name text := nullif(trim(both from coalesce(p_sponsor_name, '')), '');
  v_cta_label text := nullif(trim(both from coalesce(p_sponsor_cta_label, '')), '');
  v_cta_url text := nullif(trim(both from coalesce(p_sponsor_cta_url, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('admin') then
    raise exception 'Only Tempa staff may publish official Dispatches.';
  end if;

  if p_published_as is null or p_published_as not in ('tempa', 'sponsored') then
    raise exception 'Unknown publication identity.';
  end if;

  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'This action is not available right now.';
  end if;

  if p_published_as = 'sponsored' then
    if v_sponsor_name is null then
      raise exception 'A Sponsored Dispatch needs a sponsor name.';
    end if;
    if char_length(v_sponsor_name) > 80 then
      raise exception 'Sponsor name is too long.';
    end if;
    if v_cta_label is not null and char_length(v_cta_label) > 40 then
      raise exception 'Link label is too long.';
    end if;
    if v_cta_label is not null and v_cta_url is null then
      raise exception 'A link label needs a link.';
    end if;
    if v_cta_url is not null and (
      char_length(v_cta_url) > 500
      or v_cta_url !~ '^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:[0-9]{1,5})?([/?#][^[:space:]<>"]*)?$'
    ) then
      raise exception 'The sponsor link must be a valid https:// address.';
    end if;
    v_sender := v_sponsor_name;
  else
    if v_sponsor_name is not null or v_cta_label is not null or v_cta_url is not null then
      raise exception 'A Tempa Dispatch cannot carry sponsor details.';
    end if;
    v_sender := 'Tempa';
  end if;

  if char_length(trim(p_title)) = 0 then
    raise exception 'A Dispatch needs a title.';
  end if;

  if char_length(p_title) > 140 then
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

    if char_length(trim(both from v_back_message)) > 300 then
      raise exception 'A Postcard''s back message is too long.';
    end if;
  end if;

  new_id := pg_catalog.gen_random_uuid();

  insert into public.dispatches (
    id, author_id, title, body, status, published_at,
    published_as, sponsor_name, sponsor_cta_label, sponsor_cta_url
  )
  values (
    new_id, auth.uid(), p_title, p_body, 'published', now(),
    p_published_as,
    case when p_published_as = 'sponsored' then v_sponsor_name end,
    case when p_published_as = 'sponsored' then v_cta_label end,
    case when p_published_as = 'sponsored' then v_cta_url end
  );

  if array_length(normalized_topics, 1) is not null then
    insert into public.dispatch_topics (dispatch_id, topic)
    select new_id, t from unnest(normalized_topics) as t;
  end if;

  if coalesce(jsonb_array_length(p_moments), 0) > 0 then
    paragraph_count := coalesce(
      array_length(regexp_split_to_array(trim(both from p_body), '\n\s*\n'), 1),
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
    select new_id, (elem->>'position')::integer, elem->>'image_path'
    from jsonb_array_elements(p_moments) as elem;
  end if;

  if has_postcard then
    insert into public.dispatch_postcards (
      dispatch_id, postcard_version_id, reveal_line, back_message, sender_pseudonym_snapshot
    )
    values (
      new_id, v_postcard_version_id, v_reveal_line, trim(both from v_back_message), v_sender
    );
  end if;

  select * into result from public.dispatches where id = new_id;
  return result;
end;
$function$;

revoke all on function public.publish_official_dispatch(text, text, text, text[], jsonb, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.publish_official_dispatch(text, text, text, text[], jsonb, jsonb, text, text, text) to authenticated;


-- ------------------------------------------------------------
-- 4. UPDATE_OFFICIAL_DISPATCH (staff only; same edit rules as members)
-- ------------------------------------------------------------
create or replace function public.update_official_dispatch(
  p_dispatch_id uuid,
  p_title text,
  p_body text,
  p_topics text[] default '{}',
  p_moments jsonb default '[]'::jsonb,
  p_sponsor_name text default null,
  p_sponsor_cta_label text default null,
  p_sponsor_cta_url text default null
)
returns public.dispatches
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  result public.dispatches;
  v_dispatch record;
  topic text;
  normalized_topics text[] := '{}';
  paragraph_count integer;
  m jsonb;
  v_sponsor_name text := nullif(trim(both from coalesce(p_sponsor_name, '')), '');
  v_cta_label text := nullif(trim(both from coalesce(p_sponsor_cta_label, '')), '');
  v_cta_url text := nullif(trim(both from coalesce(p_sponsor_cta_url, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('admin') then
    raise exception 'Only Tempa staff may edit official Dispatches.';
  end if;

  select d.id, d.published_at, d.published_as
  into v_dispatch
  from public.dispatches d
  where d.id = p_dispatch_id
    and d.author_id = auth.uid()
    and d.status = 'published'
    and d.published_as in ('tempa', 'sponsored')
  for update;

  if v_dispatch.id is null then
    raise exception 'Only the creator of a published official Dispatch may edit it.';
  end if;

  if now() > v_dispatch.published_at + interval '30 minutes' then
    raise exception 'This Dispatch can no longer be edited.';
  end if;

  if exists (select 1 from public.dispatch_replies where dispatch_id = p_dispatch_id) then
    raise exception 'This Dispatch can no longer be edited.';
  end if;

  if v_dispatch.published_as = 'sponsored' then
    if v_sponsor_name is null then
      raise exception 'A Sponsored Dispatch needs a sponsor name.';
    end if;
    if char_length(v_sponsor_name) > 80 then
      raise exception 'Sponsor name is too long.';
    end if;
    if v_cta_label is not null and char_length(v_cta_label) > 40 then
      raise exception 'Link label is too long.';
    end if;
    if v_cta_label is not null and v_cta_url is null then
      raise exception 'A link label needs a link.';
    end if;
    if v_cta_url is not null and (
      char_length(v_cta_url) > 500
      or v_cta_url !~ '^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:[0-9]{1,5})?([/?#][^[:space:]<>"]*)?$'
    ) then
      raise exception 'The sponsor link must be a valid https:// address.';
    end if;
  elsif v_sponsor_name is not null or v_cta_label is not null or v_cta_url is not null then
    raise exception 'A Tempa Dispatch cannot carry sponsor details.';
  end if;

  if char_length(trim(p_title)) = 0 then
    raise exception 'A Dispatch needs a title.';
  end if;

  if char_length(p_title) > 140 then
    raise exception 'Title is too long.';
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

  if coalesce(jsonb_array_length(p_moments), 0) > 0 then
    paragraph_count := coalesce(
      array_length(regexp_split_to_array(trim(both from p_body), '\n\s*\n'), 1),
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
  end if;

  update public.dispatches
  set title = p_title,
      body = p_body,
      sponsor_name = case when published_as = 'sponsored' then v_sponsor_name end,
      sponsor_cta_label = case when published_as = 'sponsored' then v_cta_label end,
      sponsor_cta_url = case when published_as = 'sponsored' then v_cta_url end
  where id = p_dispatch_id;

  delete from public.dispatch_topics where dispatch_id = p_dispatch_id;
  if array_length(normalized_topics, 1) is not null then
    insert into public.dispatch_topics (dispatch_id, topic)
    select p_dispatch_id, t from unnest(normalized_topics) as t;
  end if;

  delete from public.dispatch_moments where dispatch_id = p_dispatch_id;
  if coalesce(jsonb_array_length(p_moments), 0) > 0 then
    insert into public.dispatch_moments (dispatch_id, position, image_path)
    select p_dispatch_id, (elem->>'position')::integer, elem->>'image_path'
    from jsonb_array_elements(p_moments) as elem;
  end if;

  select * into result from public.dispatches where id = p_dispatch_id;
  return result;
end;
$function$;

revoke all on function public.update_official_dispatch(uuid, text, text, text[], jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.update_official_dispatch(uuid, text, text, text[], jsonb, text, text, text) to authenticated;


-- ------------------------------------------------------------
-- 5. GET_SHARED_DISPATCH — publication-identity aware
-- ------------------------------------------------------------
-- Return shape widens (four trailing columns), so the old function is
-- dropped first — CREATE OR REPLACE cannot change RETURNS TABLE.
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
  postcard jsonb,
  published_as text,
  sponsor_name text,
  sponsor_cta_label text,
  sponsor_cta_url text
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
    case d.published_as
      when 'tempa' then 'Tempa'
      when 'sponsored' then d.sponsor_name
      else coalesce(
        (select pp.pseudonym from public.public_profiles pp where pp.id = d.author_id),
        'A TEMPA member'
      )
    end,
    case
      when d.published_as = 'member'
        then (select pp.country from public.public_profiles pp where pp.id = d.author_id)
    end,
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
    ),
    d.published_as,
    d.sponsor_name,
    d.sponsor_cta_label,
    d.sponsor_cta_url
  from public.dispatches d
  where d.id = found_id;
end;
$function$;

revoke all on function public.get_shared_dispatch(uuid) from public, anon, authenticated;
grant execute on function public.get_shared_dispatch(uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- 6. BOARD_FEED_PAGE — relationship signals isolated to member rows
-- ------------------------------------------------------------
-- Reproduces the CURRENT definition from docs/sql/2026-09-27-topical-
-- interests.sql verbatim (signature, RETURNS TABLE shape, SECURITY
-- INVOKER, search_path, session-stable ordering, seen/unseen buckets,
-- keyset cursor, Keep:Correspondent and Familiar:Discovery ratios,
-- topical tie-break, grants) with exactly three identity-isolation
-- edits, each marked PUBLICATION IDENTITY below:
--   a. published_as is carried through the two internal candidate CTEs
--      and familiar_augment only augments with MEMBER rows;
--   b. familiar_authors joins only when ce.published_as = 'member', so
--      Tempa/Sponsored rows are always is_kept = false / is_familiar =
--      false and rank in the neutral discovery stream;
--   c. author_seq partitions by (author_id, published_as) so official
--      rows never consume the creating admin's member diversity slots.
-- No official/paid boost of any kind. Member rows rank exactly as before.

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
    select d.id, d.author_id, d.title, d.body, d.published_at, d.moderation_status, d.published_as
    from public.dispatches d
    where d.status = 'published'
      and d.moderation_status = 'visible'
      and d.published_at <= p_session_started_at
    order by d.published_at desc
    limit 300
  ),

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

  familiar_augment as (
    select d.id, d.author_id, d.title, d.body, d.published_at, d.moderation_status, d.published_as
    from familiar_authors fa
    cross join lateral (
      select d2.id, d2.author_id, d2.title, d2.body, d2.published_at, d2.moderation_status, d2.published_as
      from public.dispatches d2
      where d2.author_id = fa.author_id
        -- PUBLICATION IDENTITY (2026-10-15): a relationship with the
        -- creating admin never pulls their Tempa/Sponsored rows in.
        and d2.published_as = 'member'
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

  -- Phase 2B addition — the viewer's own selected Interests, read live
  -- (no session-stability rule: unlike Keep/correspondence, an Interest
  -- selection is never treated as a relationship signal).
  viewer_interests as (
    select interest_key
    from public.profile_interests
    where viewer_user_id = auth.uid()
  ),

  -- Phase 2B addition — exact token/phrase alias matching only, never a
  -- substring scan (see this file's own header comment). Empty when the
  -- viewer has selected no Interests, which is what makes the zero-
  -- interest degrade a structural consequence rather than a special case.
  topical_matches as (
    select distinct dt.dispatch_id
    from public.dispatch_topics dt
    join public.interest_topic_aliases ia
      on ia.alias = tempa_private.normalize_topic_text(dt.topic)
      or ia.alias = any(string_to_array(tempa_private.normalize_topic_text(dt.topic), ' '))
    join viewer_interests vi on vi.interest_key = ia.interest_key
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
      (fa.author_id is not null) as is_familiar,
      exists (select 1 from topical_matches tm where tm.dispatch_id = ce.id) as is_topical_match
    from combined_eligible ce
    -- PUBLICATION IDENTITY (2026-10-15): Keep / correspondent
    -- familiarity is a relationship with a MEMBER. Tempa/Sponsored rows
    -- keep author_id = the creating admin for audit only, so they never
    -- inherit that admin's relationships: is_kept = false,
    -- is_familiar = false, ranked in the neutral discovery stream.
    left join familiar_authors fa on fa.author_id = ce.author_id and ce.published_as = 'member'
  ),

  author_diverse as (
    select
      c.*,
      -- PUBLICATION IDENTITY (2026-10-15): published_as joins the
      -- partition so an admin's Tempa/Sponsored rows form their own
      -- diversity group. Identical to before for every member-only author.
      row_number() over (partition by c.seen_bucket, c.author_id, c.published_as order by c.published_at desc) as author_seq
    from classified c
  ),

  -- ---- Level 1: Keep : second familiarity signal = 3 : 1, independently per seen_bucket ----
  -- Phase 2B: each stream's own tie-break gains one new column
  -- (topical_rank, 0=matched/1=unmatched) between author_seq and
  -- seed_hash. This can only ever reorder rows that already tied on
  -- author_seq — it cannot change a stream's size or the divisor math
  -- below, which depends only on each row's position within its own
  -- stream. See this file's own header comment for the zero-interest
  -- degrade proof.

  keep_ranked as (
    select
      id, seen_bucket, seed_hash,
      row_number() over (
        partition by seen_bucket
        order by author_seq, (case when is_topical_match then 0 else 1 end), seed_hash
      ) as stream_i
    from author_diverse
    where is_kept
  ),
  second_signal_ranked as (
    select
      id, seen_bucket, seed_hash,
      row_number() over (
        partition by seen_bucket
        order by author_seq, (case when is_topical_match then 0 else 1 end), seed_hash
      ) as stream_i
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
      row_number() over (
        partition by seen_bucket
        order by author_seq, (case when is_topical_match then 0 else 1 end), seed_hash
      ) as stream_i
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

-- Grants unchanged from Phase 2A — same signature, same posture.
revoke all on function public.board_feed_page(
  timestamptz, text, integer, smallint, numeric, integer, uuid
) from public;

grant execute on function public.board_feed_page(
  timestamptz, text, integer, smallint, numeric, integer, uuid
) to authenticated;

commit;
