-- ============================================================
-- TEMPA — LANGUAGE-FIRST ONBOARDING
-- STATUS: NOT EXECUTED — review, then run before merging the app gate.
-- Verifier: docs/sql/2026-09-30-language-onboarding-verify.sql
-- ============================================================
--
-- Extends the already-live member_language_preferences foundation so a
-- Tempa interface language can be confirmed before profile creation.
--
-- Key decisions:
--   * interface_locale is private account state, never public profile data.
--   * reading_language remains independently changeable later.
--   * first confirmation atomically sets both interface + reading language.
--   * accounts that already had a profile when this migration is applied
--     are grandfathered as confirmed without guessing an interface locale
--     and without overwriting an existing reading-language choice.
--   * the preference row now belongs to auth.users, so it can exist before
--     public.profiles; deleting either the auth account or the profile used
--     by Tempa account closure removes the preference.

begin;

-- ------------------------------------------------------------
-- 1. TABLE SHAPE
-- ------------------------------------------------------------
alter table public.member_language_preferences
  alter column reading_language drop not null;

alter table public.member_language_preferences
  add column if not exists interface_locale text,
  add column if not exists language_confirmed_at timestamptz;

alter table public.member_language_preferences
  drop constraint if exists member_language_preferences_interface_locale_valid;

alter table public.member_language_preferences
  add constraint member_language_preferences_interface_locale_valid
  check (
    interface_locale is null
    or interface_locale in ('en', 'fr', 'es', 'pt')
  );

comment on column public.member_language_preferences.interface_locale is
  'Reviewed Tempa interface locale. Null means no persisted interface choice yet.';
comment on column public.member_language_preferences.language_confirmed_at is
  'When the member explicitly confirmed the Language onboarding decision. Existing pre-migration profiles are grandfathered without an inferred locale.';

-- The old row depended on public.profiles, which made a pre-profile language
-- choice impossible. Move the ownership boundary to the authenticated account.
alter table public.member_language_preferences
  drop constraint if exists member_language_preferences_user_id_fkey;

alter table public.member_language_preferences
  add constraint member_language_preferences_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

-- Account closure in Tempa deletes the live profile before auth identity
-- retirement. Keep the original cleanup semantics too.
create or replace function tempa_private.delete_language_preference_with_profile()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  delete from public.member_language_preferences where user_id = old.id;
  return old;
end;
$function$;

revoke all on function tempa_private.delete_language_preference_with_profile()
  from public, anon, authenticated;

drop trigger if exists profiles_delete_language_preference on public.profiles;
create trigger profiles_delete_language_preference
after delete on public.profiles
for each row execute function tempa_private.delete_language_preference_with_profile();

-- ------------------------------------------------------------
-- 2. GRANDFATHER EXISTING MEMBERS
-- ------------------------------------------------------------
-- A profile that already exists at migration time must never be sent
-- backwards through a newly-added onboarding gate. Do not infer a locale;
-- leave interface_locale null so cookie / browser behaviour continues until
-- that member deliberately chooses a Tempa language. Preserve any existing
-- reading_language exactly as-is.
insert into public.member_language_preferences (
  user_id,
  reading_language,
  interface_locale,
  language_confirmed_at,
  created_at,
  updated_at
)
select p.id, null, null, now(), now(), now()
from public.profiles p
on conflict (user_id) do update
set language_confirmed_at = coalesce(
      public.member_language_preferences.language_confirmed_at,
      excluded.language_confirmed_at
    );

-- ------------------------------------------------------------
-- 3. READING-LANGUAGE WRITE PATH (same contract, pre-profile capable)
-- ------------------------------------------------------------
create or replace function public.set_my_reading_language(p_language text)
returns text
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_language text := btrim(p_language);
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  if v_language is null
     or char_length(v_language) not between 2 and 16
     or v_language !~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$' then
    raise exception 'Unknown reading language.' using errcode = '22023';
  end if;

  insert into public.member_language_preferences (
    user_id,
    reading_language,
    created_at,
    updated_at
  )
  values (auth.uid(), v_language, now(), now())
  on conflict (user_id)
  do update set reading_language = excluded.reading_language,
                updated_at = now();

  return v_language;
end;
$function$;

revoke all on function public.set_my_reading_language(text) from public, anon;
grant execute on function public.set_my_reading_language(text) to authenticated;

-- ------------------------------------------------------------
-- 4. ATOMIC PRIMARY TEMPA-LANGUAGE CHOICE
-- ------------------------------------------------------------
create or replace function public.set_my_tempa_language(p_locale text)
returns text
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_locale text := lower(btrim(p_locale));
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  if v_locale is null or v_locale not in ('en', 'fr', 'es', 'pt') then
    raise exception 'Unsupported Tempa language.' using errcode = '22023';
  end if;

  insert into public.member_language_preferences (
    user_id,
    interface_locale,
    reading_language,
    language_confirmed_at,
    created_at,
    updated_at
  )
  values (auth.uid(), v_locale, v_locale, now(), now(), now())
  on conflict (user_id)
  do update set
    interface_locale = excluded.interface_locale,
    reading_language = excluded.reading_language,
    language_confirmed_at = coalesce(
      public.member_language_preferences.language_confirmed_at,
      excluded.language_confirmed_at
    ),
    updated_at = now();

  return v_locale;
end;
$function$;

revoke all on function public.set_my_tempa_language(text) from public, anon;
grant execute on function public.set_my_tempa_language(text) to authenticated;

commit;
