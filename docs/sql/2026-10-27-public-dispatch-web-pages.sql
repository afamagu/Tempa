-- Public Dispatch web pages — "Public on the web" as its own dimension.
--
-- Forward-only. Owner decisions (2026-09-28):
--   * Published            = appears on the Tempa Board (members only).
--   * Public on the web    = an independent open-web article page at
--                            https://jointempa.com/dispatches/{web_slug},
--                            listed in the sitemap and indexable.
--   * MEMBER Dispatches stay members-only unless their author explicitly
--     chooses "Public on the web". Nothing existing is exposed.
--   * Official Tempa / Sponsored Dispatches are public on the web by
--     default (published_as <> 'member'), existing ones included.
--   * Making a Dispatch public never makes the author's profile public.
--
-- A Dispatch is readable on the open web ONLY while
--   web_public AND web_slug IS NOT NULL AND status = 'published'
--   AND moderation_status = 'visible'
--   AND (published_as <> 'member' OR author_content_publicly_visible(author))
-- (tempa_private.dispatch_is_web_public — the same gates the share-link
-- reader applies). Every anonymous read goes through SECURITY DEFINER
-- functions that apply it; the base tables keep their existing grants
-- (members SELECT only, anon nothing).
--
-- web_slug: generated once, the first time a Dispatch becomes public on
-- the web — readable title words + 6 random hex characters, globally
-- unique, never derived from the author. It is permanent: editing the
-- title, going members-only and back, or moderation never changes it.
--
-- content_updated_at: set when the title or body actually changes; the
-- page's dateModified and the sitemap's lastmod (published_at otherwise).

begin;

-- ------------------------------------------------------------
-- 1. COLUMNS
-- ------------------------------------------------------------
alter table public.dispatches add column if not exists web_public boolean not null default false;
alter table public.dispatches add column if not exists web_slug text;
alter table public.dispatches add column if not exists content_updated_at timestamptz;

do $constraint$
begin
  if not exists (select 1 from pg_constraint where conname = 'dispatches_web_slug_shape') then
    alter table public.dispatches add constraint dispatches_web_slug_shape
      check (web_slug is null or (web_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*-[0-9a-f]{6}$' and char_length(web_slug) <= 80));
  end if;
end
$constraint$;

create unique index if not exists dispatches_web_slug_key on public.dispatches (web_slug) where web_slug is not null;
create index if not exists dispatches_web_public_idx on public.dispatches (published_at desc) where web_public;

-- ------------------------------------------------------------
-- 2. SLUGS + LIFECYCLE TRIGGER
-- ------------------------------------------------------------
create or replace function tempa_private.dispatch_slugify(p_title text)
returns text
language plpgsql
immutable
set search_path to 'pg_catalog'
as $function$
declare
  v text;
begin
  v := translate(lower(coalesce(p_title, '')),
                 'àáâãäåāçćčèéêëēėęìíîïīñńòóôõöøōùúûüūýÿžźżśšłđ',
                 'aaaaaaaccceeeeeeeiiiiinnooooooouuuuuyyzzzssld');
  v := trim(both '-' from regexp_replace(v, '[^a-z0-9]+', '-', 'g'));
  if char_length(v) > 60 then
    -- cut at a word boundary, never mid-word
    v := trim(both '-' from regexp_replace(left(v, 61), '-[^-]*$', ''));
    v := left(v, 60);
  end if;
  return coalesce(nullif(trim(both '-' from v), ''), 'dispatch');
end;
$function$;

create or replace function tempa_private.dispatch_web_lifecycle()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_candidate text;
begin
  -- Official Tempa / Sponsored Dispatches are public on the web by default.
  if tg_op = 'INSERT' and new.published_as <> 'member' then
    new.web_public := true;
  end if;

  if tg_op = 'UPDATE' then
    if old.web_slug is not null and new.web_slug is distinct from old.web_slug then
      raise exception 'A public Dispatch''s web address is permanent.' using errcode = '42501';
    end if;
    if new.title is distinct from old.title or new.body is distinct from old.body then
      new.content_updated_at := now();
    end if;
  end if;

  if new.web_public and new.web_slug is null then
    loop
      v_candidate := tempa_private.dispatch_slugify(new.title) || '-' || substr(md5(gen_random_uuid()::text), 1, 6);
      exit when not exists (select 1 from public.dispatches where web_slug = v_candidate);
    end loop;
    new.web_slug := v_candidate;
  end if;
  return new;
end;
$function$;

drop trigger if exists dispatches_web_lifecycle on public.dispatches;
create trigger dispatches_web_lifecycle before insert or update on public.dispatches
  for each row execute function tempa_private.dispatch_web_lifecycle();

-- ------------------------------------------------------------
-- 3. THE ONE WEB-VISIBILITY PREDICATE
-- ------------------------------------------------------------
create or replace function tempa_private.dispatch_is_web_public(p_dispatch_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog'
as $function$
  select coalesce((
    select d.web_public
       and d.web_slug is not null
       and d.status = 'published'
       and d.moderation_status = 'visible'
       and (d.published_as <> 'member' or tempa_private.author_content_publicly_visible(d.author_id))
    from public.dispatches d
    where d.id = p_dispatch_id), false)
$function$;

-- ------------------------------------------------------------
-- 4. ANONYMOUS READS (the only open-web read paths)
-- ------------------------------------------------------------
-- Same presentation fields as get_shared_dispatch (title, body, public
-- identity, topics, photo paths, Postcard) — never author_id, never the
-- internal Dispatch id, never the creating admin of an official Dispatch.
-- An unknown slug and a slug whose Dispatch is not public on the web
-- right now return nothing, indistinguishably.
create or replace function public.get_public_dispatch(p_slug text)
returns table (
  web_slug text,
  title text,
  body text,
  published_at timestamptz,
  content_updated_at timestamptz,
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
stable
security definer
set search_path to 'pg_catalog'
as $function$
declare
  found_id uuid;
begin
  if p_slug is null or char_length(p_slug) > 80 or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    return;
  end if;
  select d.id into found_id from public.dispatches d where d.web_slug = p_slug;
  if found_id is null or not tempa_private.dispatch_is_web_public(found_id) then
    return;
  end if;

  return query
  select
    d.web_slug,
    d.title,
    d.body,
    d.published_at,
    d.content_updated_at,
    case d.published_as
      when 'tempa' then 'Tempa'
      when 'sponsored' then d.sponsor_name
      else coalesce((select pp.pseudonym from public.public_profiles pp where pp.id = d.author_id), 'A TEMPA member')
    end,
    case when d.published_as = 'member'
      then (select pp.country from public.public_profiles pp where pp.id = d.author_id) end,
    coalesce((select array_agg(t.topic order by t.topic) from public.dispatch_topics t where t.dispatch_id = d.id), '{}'::text[]),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', dm.id, 'position', dm.position, 'image_path', dm.image_path) order by dm.position)
      from public.dispatch_moments dm where dm.dispatch_id = d.id), '[]'::jsonb),
    (
      select jsonb_build_object(
        'title', pv.title, 'location', pv.location, 'collection', pv.collection,
        'postmark_text', pv.postmark_text, 'footer_text', pv.footer_text,
        'front_image_path', pv.front_image_path, 'motion_src', pv.motion_src,
        'duration_seconds', pv.duration_seconds, 'reveal_line_alignment', pv.reveal_line_alignment,
        'reveal_line', dp.reveal_line, 'back_message', dp.back_message,
        'sender_pseudonym_snapshot', dp.sender_pseudonym_snapshot)
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

-- The sitemap source: exactly the Dispatches that are public on the web
-- right now, with a lastmod from real content changes only.
create or replace function public.list_public_dispatches()
returns table (web_slug text, published_at timestamptz, last_modified timestamptz)
language sql
stable
security definer
set search_path to 'pg_catalog'
as $function$
  select d.web_slug, d.published_at, greatest(d.published_at, coalesce(d.content_updated_at, d.published_at))
  from public.dispatches d
  where d.web_public and tempa_private.dispatch_is_web_public(d.id)
  order by d.published_at desc nulls last
  limit 45000
$function$;

-- ------------------------------------------------------------
-- 5. THE AUTHOR'S CHOICE
-- ------------------------------------------------------------
-- Member Dispatch: only its author, only while their account is active,
-- only once published. Official / Sponsored: admins. Turning it OFF is
-- always allowed for the same people and takes effect immediately.
create or replace function public.set_dispatch_web_public(p_dispatch_id uuid, p_public boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_uid uuid := auth.uid();
  d public.dispatches;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_public is null then
    raise exception 'DISPATCH_WEB:invalid_request' using errcode = '22023';
  end if;
  select * into d from public.dispatches where id = p_dispatch_id for update;
  if not found then
    raise exception 'DISPATCH_WEB:not_found' using errcode = 'P0002';
  end if;
  if d.published_as = 'member' then
    if d.author_id is distinct from v_uid then
      raise exception 'DISPATCH_WEB:not_found' using errcode = 'P0002';
    end if;
    if p_public and public.current_account_status() is distinct from 'active' then
      raise exception 'DISPATCH_WEB:account_unavailable' using errcode = '42501';
    end if;
  elsif not public.is_staff('admin') then
    raise exception 'DISPATCH_WEB:not_found' using errcode = 'P0002';
  end if;
  if p_public and d.status <> 'published' then
    raise exception 'DISPATCH_WEB:not_published' using errcode = '22023';
  end if;

  update public.dispatches set web_public = p_public where id = p_dispatch_id returning * into d;
  return jsonb_build_object('web_public', d.web_public, 'web_slug', d.web_slug,
                            'live', tempa_private.dispatch_is_web_public(d.id));
end;
$function$;

-- ------------------------------------------------------------
-- 6. PHOTOS — anonymous access widened ONLY to web-public Dispatches
-- ------------------------------------------------------------
-- Unchanged share-link branch (2026-09-28) OR the same web-public
-- predicate the page uses. A photo of a members-only Dispatch stays
-- unreachable for anon.
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
  ) or exists (
    select 1
    from public.dispatch_moments dm
    where dm.image_path = p_path
      and tempa_private.dispatch_is_web_public(dm.dispatch_id)
  )
$$;

-- ------------------------------------------------------------
-- 7. BACKFILL — official Tempa / Sponsored only (owner decision)
-- ------------------------------------------------------------
-- Member Dispatches are never touched. Safe to re-run: only rows still
-- web_public = false are updated; the trigger gives each a permanent slug.
update public.dispatches set web_public = true where published_as <> 'member' and not web_public;

-- ------------------------------------------------------------
-- 8. PRIVILEGES
-- ------------------------------------------------------------
revoke all on function tempa_private.dispatch_slugify(text) from public, anon, authenticated;
revoke all on function tempa_private.dispatch_web_lifecycle() from public, anon, authenticated;
revoke all on function tempa_private.dispatch_is_web_public(uuid) from public, anon, authenticated;

revoke all on function public.get_public_dispatch(text) from public;
grant execute on function public.get_public_dispatch(text) to anon, authenticated;
revoke all on function public.list_public_dispatches() from public;
grant execute on function public.list_public_dispatches() to anon, authenticated;
revoke all on function public.set_dispatch_web_public(uuid, boolean) from public, anon;
grant execute on function public.set_dispatch_web_public(uuid, boolean) to authenticated;

commit;
