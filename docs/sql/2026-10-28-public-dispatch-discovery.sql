-- TEMPA — PUBLIC DISPATCH DISCOVERY
-- Depends on 2026-10-27-public-dispatch-web-pages.sql.
--
-- Adds read-only anonymous discovery paths around Dispatches that are
-- ALREADY public on the web. It does not make another Dispatch public,
-- change the member Board, expose profiles, or widen base-table grants.
-- Every row still passes tempa_private.dispatch_is_web_public(), the same
-- predicate used by the article page, sitemap and anonymous photo access.
--
-- These RPCs deliberately return no dispatch id and no author id. The
-- pseudonym/country fields are the same public identity already rendered
-- on the open-web article page. body_preview is only the first 1,200
-- stored characters of content that is already public, used for a short
-- reading excerpt on discovery cards.

begin;

create or replace function public.list_public_dispatch_previews(
  p_limit integer default 24,
  p_topic text default null
)
returns table (
  web_slug text,
  title text,
  body_preview text,
  published_at timestamptz,
  last_modified timestamptz,
  author_pseudonym text,
  author_country text,
  topics text[],
  published_as text,
  sponsor_name text
)
language sql
stable
security definer
set search_path to 'pg_catalog'
as $function$
  select
    d.web_slug,
    d.title,
    left(d.body, 1200),
    d.published_at,
    greatest(d.published_at, coalesce(d.content_updated_at, d.published_at)),
    case d.published_as
      when 'tempa' then 'Tempa'
      when 'sponsored' then coalesce(nullif(btrim(d.sponsor_name), ''), 'Sponsored')
      else coalesce((select pp.pseudonym from public.public_profiles pp where pp.id = d.author_id), 'A TEMPA member')
    end,
    case when d.published_as = 'member'
      then (select pp.country from public.public_profiles pp where pp.id = d.author_id) end,
    coalesce((select array_agg(t.topic order by lower(t.topic), t.topic) from public.dispatch_topics t where t.dispatch_id = d.id), '{}'::text[]),
    d.published_as,
    d.sponsor_name
  from public.dispatches d
  where tempa_private.dispatch_is_web_public(d.id)
    and (
      nullif(btrim(coalesce(p_topic, '')), '') is null
      or exists (
        select 1
        from public.dispatch_topics filter_topic
        where filter_topic.dispatch_id = d.id
          and lower(btrim(filter_topic.topic)) = lower(btrim(p_topic))
      )
    )
  order by d.published_at desc nulls last
  limit least(greatest(coalesce(p_limit, 24), 1), 100)
$function$;

create or replace function public.list_related_public_dispatches(
  p_slug text,
  p_topics text[],
  p_limit integer default 4
)
returns table (
  web_slug text,
  title text,
  body_preview text,
  published_at timestamptz,
  last_modified timestamptz,
  author_pseudonym text,
  author_country text,
  topics text[],
  published_as text,
  sponsor_name text,
  shared_topic_count bigint
)
language sql
stable
security definer
set search_path to 'pg_catalog'
as $function$
  select
    d.web_slug,
    d.title,
    left(d.body, 1200),
    d.published_at,
    greatest(d.published_at, coalesce(d.content_updated_at, d.published_at)),
    case d.published_as
      when 'tempa' then 'Tempa'
      when 'sponsored' then coalesce(nullif(btrim(d.sponsor_name), ''), 'Sponsored')
      else coalesce((select pp.pseudonym from public.public_profiles pp where pp.id = d.author_id), 'A TEMPA member')
    end,
    case when d.published_as = 'member'
      then (select pp.country from public.public_profiles pp where pp.id = d.author_id) end,
    coalesce((select array_agg(t.topic order by lower(t.topic), t.topic) from public.dispatch_topics t where t.dispatch_id = d.id), '{}'::text[]),
    d.published_as,
    d.sponsor_name,
    (
      select count(*)
      from public.dispatch_topics candidate_topic
      where candidate_topic.dispatch_id = d.id
        and exists (
          select 1
          from unnest(coalesce(p_topics, '{}'::text[])) as requested(topic)
          where lower(btrim(requested.topic)) = lower(btrim(candidate_topic.topic))
        )
    ) as shared_topic_count
  from public.dispatches d
  where tempa_private.dispatch_is_web_public(d.id)
    and d.web_slug is distinct from p_slug
    and cardinality(coalesce(p_topics, '{}'::text[])) > 0
    and exists (
      select 1
      from public.dispatch_topics candidate_topic
      where candidate_topic.dispatch_id = d.id
        and exists (
          select 1
          from unnest(coalesce(p_topics, '{}'::text[])) as requested(topic)
          where lower(btrim(requested.topic)) = lower(btrim(candidate_topic.topic))
        )
    )
  order by shared_topic_count desc, d.published_at desc nulls last
  limit least(greatest(coalesce(p_limit, 4), 1), 12)
$function$;

create or replace function public.list_public_dispatch_topics()
returns table (
  topic_key text,
  topic_label text,
  dispatch_count bigint,
  last_modified timestamptz
)
language sql
stable
security definer
set search_path to 'pg_catalog'
as $function$
  with eligible as (
    select
      d.id,
      greatest(d.published_at, coalesce(d.content_updated_at, d.published_at)) as last_modified
    from public.dispatches d
    where tempa_private.dispatch_is_web_public(d.id)
  )
  select
    lower(btrim(t.topic)) as topic_key,
    min(btrim(t.topic)) as topic_label,
    count(distinct eligible.id)::bigint as dispatch_count,
    max(eligible.last_modified) as last_modified
  from eligible
  join public.dispatch_topics t on t.dispatch_id = eligible.id
  where nullif(btrim(t.topic), '') is not null
  group by lower(btrim(t.topic))
  order by dispatch_count desc, topic_key asc
$function$;

revoke all on function public.list_public_dispatch_previews(integer, text) from public;
grant execute on function public.list_public_dispatch_previews(integer, text) to anon, authenticated;
revoke all on function public.list_related_public_dispatches(text, text[], integer) from public;
grant execute on function public.list_related_public_dispatches(text, text[], integer) to anon, authenticated;
revoke all on function public.list_public_dispatch_topics() from public;
grant execute on function public.list_public_dispatch_topics() to anon, authenticated;

commit;
