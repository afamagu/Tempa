-- TEMPA — EDITORIAL BYLINE ("Tempa House Columnist")
-- STATUS: NOT YET APPLIED. Prepared for review; run in the Supabase SQL editor
-- only after 2026-09-30-editorial-byline-lookup.sql returned exactly one row.
-- Verifier: 2026-09-30-editorial-byline-verify.sql.
--
-- SELF-CONTAINED. Depends only on objects live since 2026-08-30
-- (public.profiles.pseudonym / pseudonym_key and
-- public.canonicalize_pseudonym). It deliberately does NOT build on the
-- writing-style, public-Dispatch or safety migrations, so it can be applied
-- whatever state those are in. The preflight below aborts, changing
-- nothing, if even those basics are missing.
--
-- A house account is run by Tempa itself and says so under its pseudonym.
--
--   1. profiles.is_editorial / profiles.editorial_title — both or neither
--      (is_editorial = true exactly when a title is present).
--   2. Members can NEVER set or change either column, on any account,
--      including their own:
--        * INSERT — a trigger forces false/null whatever the insert
--          supplied (same pattern as force_initial_profile_writing_style);
--        * UPDATE — a guard trigger rejects any change to either column
--          unless the caller is the service role or a direct database
--          session (the SQL editor). It checks the JWT role, not
--          current_user, so it also holds inside any SECURITY DEFINER
--          member RPC that updates profiles, present or future.
--      This does not rely on the direct-UPDATE revoke in
--      2026-09-29-your-mark-production.sql being live; it holds either way.
--   3. editorial_bylines() — the one read path: the canonical pseudonym
--      key + title of each house account (public disclosure by design;
--      no ids, no other profile fields). The app matches it against the
--      pseudonym each surface already shows.
--   4. Lady Larkspur — the only account set here.
--
-- Out of scope: correspondence, discovery filtering and letter behaviour
-- for editorial accounts are unchanged.

begin;

-- ------------------------------------------------------------
-- 0. PREFLIGHT
-- ------------------------------------------------------------
do $preflight$
begin
  if to_regprocedure('public.canonicalize_pseudonym(text)') is null then
    raise exception 'Preflight: public.canonicalize_pseudonym(text) is missing.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'pseudonym_key'
  ) then
    raise exception 'Preflight: public.profiles.pseudonym_key is missing.';
  end if;
  if (select count(*) from public.profiles
      where pseudonym_key = public.canonicalize_pseudonym('Lady Larkspur')) <> 1 then
    raise exception 'Preflight: expected exactly one Lady Larkspur profile. Nothing was changed.';
  end if;
end
$preflight$;

create schema if not exists tempa_private;

-- ------------------------------------------------------------
-- 1. COLUMNS
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists is_editorial boolean not null default false;

alter table public.profiles
  add column if not exists editorial_title text;

alter table public.profiles
  drop constraint if exists profiles_editorial_title_shape;

alter table public.profiles
  add constraint profiles_editorial_title_shape
  check (
    (is_editorial and editorial_title is not null
      and editorial_title = btrim(editorial_title)
      and char_length(editorial_title) between 1 and 60)
    or (not is_editorial and editorial_title is null)
  );

comment on column public.profiles.is_editorial is
  'True for a house account run by Tempa itself. Writable only by the service role or a direct database session (profiles_editorial_guard).';
comment on column public.profiles.editorial_title is
  'Disclosure shown beneath the pseudonym, e.g. "Tempa House Columnist". Present exactly when is_editorial.';

-- ------------------------------------------------------------
-- 2. WRITE PROTECTION
-- ------------------------------------------------------------

-- Every new profile starts as an ordinary member, whatever the insert
-- supplied. A house account is marked afterwards, by UPDATE, from a
-- privileged session.
create or replace function tempa_private.force_initial_profile_editorial()
returns trigger
language plpgsql
security invoker
set search_path to 'pg_catalog'
as $function$
begin
  new.is_editorial := false;
  new.editorial_title := null;
  return new;
end;
$function$;

revoke all on function tempa_private.force_initial_profile_editorial() from public, anon, authenticated;

drop trigger if exists profiles_force_initial_editorial on public.profiles;
create trigger profiles_force_initial_editorial
before insert on public.profiles
for each row execute function tempa_private.force_initial_profile_editorial();

create or replace function tempa_private.guard_profile_editorial()
returns trigger
language plpgsql
security invoker
set search_path to 'pg_catalog'
as $function$
declare
  v_jwt_role text;
begin
  if new.is_editorial is not distinct from old.is_editorial
     and new.editorial_title is not distinct from old.editorial_title then
    return new;
  end if;

  -- Privileged = the service role, or a direct database session (SQL
  -- editor / migrations: no JWT at all). Any anon/authenticated request
  -- is refused — including one running inside a SECURITY DEFINER RPC,
  -- where current_user is the function owner but the JWT is still the
  -- member's. Inlined (no helper call) so a member session never needs
  -- EXECUTE on anything to reach this refusal.
  v_jwt_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    nullif(current_setting('request.jwt.claim.role', true), ''),
    ''
  );

  if v_jwt_role not in ('', 'service_role')
     or current_user::text in ('anon', 'authenticated') then
    raise exception 'Editorial status can only be set by Tempa.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

revoke all on function tempa_private.guard_profile_editorial() from public, anon, authenticated;

drop trigger if exists profiles_editorial_guard on public.profiles;
create trigger profiles_editorial_guard
before update on public.profiles
for each row execute function tempa_private.guard_profile_editorial();

-- ------------------------------------------------------------
-- 3. THE ONE READ PATH
-- ------------------------------------------------------------
-- House accounts only. A handful of rows; readable by anyone because the
-- disclosure is public by design (it appears on public web Dispatches).
create or replace function public.editorial_bylines()
returns table (pseudonym_key text, editorial_title text)
language sql
stable
security definer
set search_path to 'pg_catalog'
as $function$
  select p.pseudonym_key, p.editorial_title
  from public.profiles p
  where p.is_editorial
    and p.editorial_title is not null
    and p.pseudonym_key is not null
  limit 50
$function$;

revoke all on function public.editorial_bylines() from public, anon, authenticated;
grant execute on function public.editorial_bylines() to anon, authenticated;

-- ------------------------------------------------------------
-- 4. LADY LARKSPUR
-- ------------------------------------------------------------
do $seed$
declare
  v_count integer;
begin
  update public.profiles
  set is_editorial = true,
      editorial_title = 'Tempa House Columnist'
  where pseudonym_key = public.canonicalize_pseudonym('Lady Larkspur');

  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'Expected to mark exactly one profile, marked %. Rolled back.', v_count;
  end if;
end
$seed$;

commit;
