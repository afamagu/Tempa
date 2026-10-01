-- TEMPA — reserved pseudonyms. NOT YET APPLIED.
-- Run after the editorial-byline migration, then run the matching verifier.
-- Protect canonical prefixes tempa / ladylarkspur, including suffixes such
-- as Tempa Support and Lady Larkspurr. Existing house identity is preserved.
-- No profile is renamed; abort if an ordinary member already uses a prefix.
begin;

do $preflight$
begin
  if to_regprocedure('public.canonicalize_pseudonym(text)') is null
     or not exists (select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles'
         and column_name = 'is_editorial') then
    raise exception 'Apply the editorial-byline migration first. Nothing changed.';
  end if;
end
$preflight$;

create or replace function public.is_reserved_pseudonym(candidate text)
returns boolean
language sql immutable security invoker
set search_path to 'pg_catalog'
as $function$
  select coalesce(public.canonicalize_pseudonym(candidate) like 'tempa%'
    or public.canonicalize_pseudonym(candidate) like 'ladylarkspur%', false)
$function$;
revoke all on function public.is_reserved_pseudonym(text) from public, anon, authenticated;
grant execute on function public.is_reserved_pseudonym(text) to authenticated;

do $audit$
begin
  if exists (select 1 from public.profiles
    where not is_editorial and public.is_reserved_pseudonym(pseudonym)) then
    raise exception 'An ordinary member has a reserved name. Review those profiles before applying; nothing changed.';
  end if;
end
$audit$;

create schema if not exists tempa_private;
create or replace function tempa_private.guard_reserved_pseudonym()
returns trigger
language plpgsql security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_jwt_role text;
begin
  -- Unrelated edits to the existing house profile remain possible.
  if tg_op = 'UPDATE' and new.pseudonym is not distinct from old.pseudonym then
    return new;
  end if;
  if not public.is_reserved_pseudonym(new.pseudonym) then return new; end if;

  v_jwt_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    nullif(current_setting('request.jwt.claim.role', true), ''), '');

  -- House profiles are designated by privileged UPDATE, never by a member
  -- setting is_editorial during onboarding. The editorial INSERT trigger
  -- also forces false. JWT checks still hold inside SECURITY DEFINER RPCs.
  if tg_op = 'UPDATE' and new.is_editorial
     and v_jwt_role in ('', 'service_role')
     and coalesce(current_setting('role', true), '') not in ('anon', 'authenticated') then
    return new;
  end if;
  raise exception 'That name is reserved.' using errcode = '23514';
end
$function$;
revoke all on function tempa_private.guard_reserved_pseudonym() from public, anon, authenticated;

drop trigger if exists profiles_reserved_pseudonym_guard on public.profiles;
create trigger profiles_reserved_pseudonym_guard
before insert or update on public.profiles
for each row execute function tempa_private.guard_reserved_pseudonym();

create or replace function public.is_pseudonym_available(candidate text)
returns boolean
language sql security definer
set search_path to 'pg_catalog'
as $function$
  select not public.is_reserved_pseudonym(candidate) and not exists (
    select 1 from public.profiles p
    where p.pseudonym_key = public.canonicalize_pseudonym(candidate))
$function$;
revoke all on function public.is_pseudonym_available(text) from public, anon, authenticated;
grant execute on function public.is_pseudonym_available(text) to authenticated;

create or replace function public.suggest_available_pseudonyms(base text, needed integer default 3)
returns text[]
language plpgsql security definer
set search_path to 'pg_catalog'
as $function$
declare
  suggestions text[] := '{}';
  candidate text;
  clean_base text := coalesce(nullif(btrim(base), ''), 'friend');
  suffix text;
  tries integer := 0;
begin
  if public.is_reserved_pseudonym(clean_base) then return suggestions; end if;
  while cardinality(suggestions) < least(greatest(coalesce(needed, 3), 0), 10) and tries < 40 loop
    tries := tries + 1;
    suffix := (trunc(random() * 90) + 10)::integer::text;
    candidate := left(clean_base, 24 - length(suffix)) || suffix;
    if candidate <> clean_base and not (candidate = any(suggestions))
       and public.is_pseudonym_available(candidate) then
      suggestions := array_append(suggestions, candidate);
    end if;
  end loop;
  return suggestions;
end
$function$;
revoke all on function public.suggest_available_pseudonyms(text, integer) from public, anon, authenticated;
grant execute on function public.suggest_available_pseudonyms(text, integer) to authenticated;
commit;
