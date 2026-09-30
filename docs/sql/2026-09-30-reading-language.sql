-- ============================================================
-- TEMPA — READING LANGUAGE
-- STATUS: NOT EXECUTED — review, then run in the Supabase SQL editor.
-- Verifier: docs/sql/2026-09-30-reading-language-verify.sql
-- ============================================================
--
-- A member's private Reading language: the language Tempa translates
-- SOMEONE ELSE'S writing into when that member explicitly asks. It is not
-- Tempa's interface language (a separate, future concern), it is never
-- derived from country/location, and it is never shown to other members.
--
-- Deliberately NOT a column on public.profiles: profiles feeds
-- public_profiles and several profile RPCs, and this preference must never
-- travel with a member's public identity.
--
--   1. public.member_language_preferences — one row per member who has
--      chosen. No row = not chosen yet (no default is ever assigned).
--   2. RLS: a member can SELECT only their own row. No client role may
--      INSERT/UPDATE/DELETE directly.
--   3. set_my_reading_language(text) — the one write path, always keyed on
--      auth.uid(); there is no user-id parameter to spoof.
--
-- The language code is validated here by SHAPE only (a BCP-47-style
-- provider tag such as es, pt-PT, zh-Hans, sr-Latn). Membership in Tempa's
-- supported list lives in the app registry (lib/reading-languages.ts), so
-- adding a language never needs a migration; the app treats any stored code
-- it doesn't recognise as "not chosen".
--
-- user_id references public.profiles(id) ON DELETE CASCADE, so
-- close_my_account (which deletes the live profile row) removes the
-- preference with no change to that function.
--
-- Follows Tempa's SQL conventions: one transaction, explicit revoke/grant,
-- SECURITY DEFINER with a pinned pg_catalog search_path, fully-qualified
-- names. Depends only on public.profiles. Independent of Writing Style.

begin;

-- ------------------------------------------------------------
-- 1. TABLE
-- ------------------------------------------------------------
create table if not exists public.member_language_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  reading_language text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint member_language_preferences_reading_language_shape
    check (
      char_length(reading_language) between 2 and 16
      and reading_language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
    )
);

comment on table public.member_language_preferences is
  'Private per-member preferences for reading OTHER members'' writing. Never exposed through public profiles.';
comment on column public.member_language_preferences.reading_language is
  'Provider language tag the member chose to translate into (lib/reading-languages.ts). Never inferred from country.';

alter table public.member_language_preferences enable row level security;

revoke all on public.member_language_preferences from public, anon, authenticated;
grant select on public.member_language_preferences to authenticated;

drop policy if exists member_language_preferences_select_own on public.member_language_preferences;
create policy member_language_preferences_select_own
  on public.member_language_preferences
  for select
  to authenticated
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 2. THE ONE WRITE PATH
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

  if not exists (select 1 from public.profiles p where p.id = auth.uid()) then
    raise exception 'Create your profile first.';
  end if;

  insert into public.member_language_preferences (user_id, reading_language, created_at, updated_at)
  values (auth.uid(), v_language, now(), now())
  on conflict (user_id)
  do update set reading_language = excluded.reading_language,
                updated_at = now();

  return v_language;
end;
$function$;

revoke all on function public.set_my_reading_language(text) from public, anon;
grant execute on function public.set_my_reading_language(text) to authenticated;

commit;
