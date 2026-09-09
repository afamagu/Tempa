begin;

-- ============================================================
-- SHARED DISPATCH — external country flag (Board live-test corrections,
-- 2026-09-10)
-- ============================================================
-- NOT EXECUTED. Prepared only, per that checkpoint's own instruction:
-- "Default expectation: NO SQL; only prepare (never execute) a minimal
-- migration if inspection proves the external country flag genuinely
-- requires expanding the live get_shared_dispatch RPC." Inspection
-- confirmed exactly that: get_shared_dispatch (see
-- docs/sql/2026-09-07-dispatches-and-board.sql, section 13) returns
-- title/body/published_at/author_pseudonym/topics/moments only — no
-- country field of any kind — so the external reader has nothing to
-- flag with today, unlike the authenticated reader and Board/Home
-- cards, which already read authorCountry from public_profiles.
--
-- This is a pure widening: one more column, sourced from the exact same
-- public_profiles.country field the function already joins against for
-- the pseudonym, added to the SAME allowlisted, flat row shape. It does
-- not touch dispatch_shares, dispatch_moments, storage, or any grant —
-- the function stays SECURITY DEFINER for the same reason as before
-- (anon holds no table privilege at all), and every existing security
-- property (token validation, revoked/unpublished ambiguity, the fixed
-- allowlist of fields) is unchanged. country is already public-safe:
-- it is the same plain country name shown elsewhere (Recommended Minds,
-- the public profile's demographics line) — never city, region,
-- coordinates, or anything auth-provider-derived.
create or replace function public.get_shared_dispatch(p_token uuid)
returns table (
  dispatch_id uuid,
  title text,
  body text,
  published_at timestamptz,
  author_pseudonym text,
  author_country text,
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
    )
  from public.dispatches d
  left join public.public_profiles pp on pp.id = d.author_id
  where d.id = found_id;
end;
$function$;

revoke all on function public.get_shared_dispatch(uuid) from public;
grant execute on function public.get_shared_dispatch(uuid) to anon, authenticated;

commit;

-- ============================================================
-- VERIFY (read-only — run after applying the block above)
-- ============================================================
-- select proname, pronargs from pg_proc where proname = 'get_shared_dispatch';
-- -- expect: returns table now includes author_country text between
-- -- author_pseudonym and topics.
--
-- select * from public.get_shared_dispatch('<a live share token>'::uuid);
-- -- expect: author_country is either a plain country name or null,
-- -- never an error, never city/region/coordinates.
