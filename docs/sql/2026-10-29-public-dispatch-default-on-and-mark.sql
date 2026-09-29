-- Tempa — Public Dispatch default-on + public Mark identity.
--
-- Forward-only. This changes the DEFAULT FOR NEW COMPOSER SAVES only.
-- It deliberately does NOT update/backfill any existing member Dispatch.
-- Existing web_public values remain exactly as their authors left them.
--
-- Public member Dispatches may expose the author's Tempa Mark, but only
-- as the already-public opaque Mark UUID. The real profile/auth UUID,
-- private profile row and source photograph are never returned.

begin;

-- The atomic member publish wrapper already accepts an explicit
-- p_web_public choice. Change only its omitted-argument default from false
-- to true; the body and all Safety/ownership/visibility checks stay the
-- same. The client normally sends the visible choice explicitly, so this
-- is a server-side consistency backstop, not a hidden override.
create or replace function public.publish_dispatch_with_web_visibility(
  p_title text,
  p_body text,
  p_safety_evaluation_id uuid,
  p_topics text[] default '{}',
  p_moments jsonb default '[]'::jsonb,
  p_postcard jsonb default null,
  p_warning_acknowledged boolean default false,
  p_web_public boolean default true
)
returns public.dispatches
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  d public.dispatches;
begin
  if p_web_public is null then
    raise exception 'DISPATCH_WEB:invalid_request' using errcode = '22023';
  end if;
  -- The base table itself still defaults web_public=false. That is
  -- intentional: only the explicit web-visibility publish path may opt a
  -- new member Dispatch into open-web publication.
  d := public.publish_dispatch(p_title, p_body, p_safety_evaluation_id, p_topics, p_moments, p_postcard, p_warning_acknowledged);
  if p_web_public then
    d := tempa_private.apply_dispatch_web_public(d.id, true);
  end if;
  return d;
end;
$function$;

-- The public article reader already returns pseudonym + country but never
-- author_id. The Mark is stored under an independently-random UUID and is
-- safe to resolve only after the exact same web-public predicate passes.
-- A scalar UUID is all this function can return: no profile row, owner id,
-- email, source image, or other profile fields.
create or replace function public.get_public_dispatch_mark(p_slug text)
returns uuid
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_dispatch_id uuid;
  v_author_id uuid;
  v_mark_id uuid;
begin
  if p_slug is null
     or char_length(p_slug) > 80
     or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  then
    return null;
  end if;

  select d.id, d.author_id
    into v_dispatch_id, v_author_id
  from public.dispatches d
  where d.web_slug = p_slug
    and d.published_as = 'member';

  if v_dispatch_id is null
     or not tempa_private.dispatch_is_web_public(v_dispatch_id)
  then
    return null;
  end if;

  select p.mark_id into v_mark_id
  from public.profiles p
  where p.id = v_author_id;

  return v_mark_id;
end;
$function$;

revoke all on function public.get_public_dispatch_mark(text) from public;
grant execute on function public.get_public_dispatch_mark(text) to anon, authenticated;

-- Preserve the existing member-only execution contract for the atomic
-- publish wrapper after CREATE OR REPLACE.
revoke all on function public.publish_dispatch_with_web_visibility(text, text, uuid, text[], jsonb, jsonb, boolean, boolean)
  from public, anon;
grant execute on function public.publish_dispatch_with_web_visibility(text, text, uuid, text[], jsonb, jsonb, boolean, boolean)
  to authenticated;

commit;
