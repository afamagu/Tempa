-- Tempa — schema changes for the 2026-08-30 onboarding/Question/discovery review.
-- NOT executed automatically.
--
-- Reconciled against the live schema (retrieved via a read-only introspection
-- query and pasted back on 2026-08-30) — this version edits the real function
-- bodies and the real constraint name, rather than reconstructing them.
-- Confirmed at that time: `profiles` had no pseudonym_key column yet,
-- `question_answers` had no is_current column yet, its body-length check was
-- named question_answers_body_max_length at <= 4000, `questions` had exactly
-- one active row (the "five years ago" prompt), and public_profiles was a
-- plain `select id, pseudonym, country from profiles`. If real time has
-- passed since that snapshot, re-run the introspection query first — someone
-- else may have changed the schema in the meantime.

-- ============================================================
-- 1. Pseudonym canonical uniqueness
--    "Evening Quill" / "evening quill" / "EveningQuill" / "Evening-Quill"
--    must all conflict. Canonical key = trim, lowercase, strip spaces/hyphens.
--    Today, uniqueness is enforced by profiles_pseudonym_unique, a unique
--    index on lower(pseudonym) — which is why those four don't yet conflict.
-- ============================================================

create or replace function public.canonicalize_pseudonym(p text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(trim(p)), '[ -]+', '', 'g');
$$;

-- Generated column so canonicalization always stays in sync with the
-- display value; Postgres recomputes it on every insert/update.
alter table public.profiles
  add column if not exists pseudonym_key text
  generated always as (public.canonicalize_pseudonym(pseudonym)) stored;

-- Enforces uniqueness in the database itself, so two concurrent signups
-- can't both win a race on visually-different-but-canonically-equal names.
create unique index if not exists profiles_pseudonym_key_unique
  on public.profiles (pseudonym_key);

-- The old index only compared lower(pseudonym), which is why
-- "Evening Quill" and "EveningQuill" didn't conflict. It's now redundant —
-- anything it would catch, the canonical index above catches too — so it's
-- safe to drop. Run this only after confirming the index above was created
-- successfully with no violations.
drop index if exists public.profiles_pseudonym_unique;

-- Edits the real, live function — only the uniqueness check changes
-- (lower(pseudonym) = lower(candidate) → canonical key comparison).
-- Everything else (language, SECURITY DEFINER, search_path) matches what's
-- live today.
create or replace function public.is_pseudonym_available(candidate text)
returns boolean
language sql
security definer
set search_path to 'public'
as $function$
  select not exists (
    select 1 from public.profiles
    where pseudonym_key = public.canonicalize_pseudonym(candidate)
  );
$function$;

-- Same approach: the real algorithm (random 2-digit numeric suffix, up to
-- 40 tries, 'friend' fallback for an empty base) is untouched. Only the
-- uniqueness check inside it moves to the canonical key.
create or replace function public.suggest_available_pseudonyms(base text, needed integer default 3)
returns text[]
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  suggestions text[] := '{}';
  candidate text;
  clean_base text;
  suffix text;
  tries int := 0;
begin
  clean_base := trim(base);
  if clean_base = '' then
    clean_base := 'friend';
  end if;

  while coalesce(array_length(suggestions, 1), 0) < needed and tries < 40 loop
    tries := tries + 1;
    suffix := (trunc(random() * 90) + 10)::int::text; -- random 2-digit number
    candidate := left(clean_base, 24 - length(suffix)) || suffix;

    if candidate <> clean_base
       and not (candidate = any(suggestions))
       and not exists (
         select 1 from public.profiles
         where pseudonym_key = public.canonicalize_pseudonym(candidate)
       )
    then
      suggestions := array_append(suggestions, candidate);
    end if;
  end loop;

  return suggestions;
end;
$function$;

-- ============================================================
-- 2. Three concurrently live Questions, one current answer per member
-- ============================================================

-- Add the "is this my current discovery answer" flag. Default false so
-- adding the column can't accidentally mark every historical row current.
alter table public.question_answers
  add column if not exists is_current boolean not null default false;

-- Backfill: for any user with existing rows, mark only their most
-- recently updated row as current (safe even though, as of this snapshot,
-- every user has at most one row anyway).
with ranked as (
  select id, row_number() over (partition by user_id order by updated_at desc) rn
  from public.question_answers
)
update public.question_answers qa
set is_current = true
from ranked r
where qa.id = r.id and r.rn = 1;

-- At most one current row per user, enforced in the database (the app
-- also demotes-then-promotes in two steps, but this is the real guarantee
-- under concurrent writes).
create unique index if not exists question_answers_one_current_per_user
  on public.question_answers (user_id) where is_current;

-- The real constraint enforcing the character cap is named
-- question_answers_body_max_length and currently reads <= 4000. Edit it in
-- place rather than adding a differently-named one alongside it.
-- (question_answers_body_not_blank is untouched — still correct.)
alter table public.question_answers
  drop constraint question_answers_body_max_length;
alter table public.question_answers
  add constraint question_answers_body_max_length
  check (char_length(body) <= 2000);

-- Seed the two new prototype Questions. Confirmed via introspection that
-- only one row exists today (the "five years ago" prompt, is_active =
-- true) — so this brings the total to exactly three active rows, no
-- deactivation needed.
insert into public.questions (prompt, is_active)
values
  ('What is something ordinary that means more to you than most people would expect?', true),
  ('If you could spend one completely ordinary day anywhere in the world, where would you spend it—and what would you do?', true);

-- ============================================================
-- 3. Discovery needs gender + age_range alongside pseudonym + country
--    (still excluding avatar, region, city, languages, intent,
--    ai_preference, receiving_preference, bio, social links).
--    Confirmed via introspection: public_profiles is exactly
--    `select id, pseudonym, country from profiles` today, so this is a
--    straight column addition, not a rewrite of unknown view options.
-- ============================================================

create or replace view public.public_profiles as
select id, pseudonym, country, gender, gender_custom, age_range
from public.profiles;
