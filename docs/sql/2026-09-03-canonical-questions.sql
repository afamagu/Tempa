-- Tempa — canonical three-Question model, part 1: schema + seed + retire.
-- PREPARED 2026-09-03. NOT EXECUTED — review, then run in the Supabase
-- SQL editor. Run this file BEFORE
-- 2026-09-03-set-current-answer-canonical-only.sql and
-- 2026-09-03-publish-question-answer-canonical.sql (those two assume
-- questions.slug already exists).
--
-- Product intent: every member sees the exact same three permanent
-- Questions, never rotated, never drawn from a family/library. The
-- three "live" rotating Questions from the old model
-- (docs/sql/2026-08-30-questions-and-pseudonym.sql,
-- docs/sql/2026-09-01-question-families.sql) are retired — deactivated,
-- never rewritten, never deleted — so every existing answer to them
-- stays exactly as it was written and remains permanently attached to
-- its actual author.
--
-- CRITICAL: this migration never runs an UPDATE against
-- question_answers.body or questions.prompt for any existing row. The
-- only existing-row column it touches is question_answers.is_current
-- (step 3 below), and only to clear a flag — never content.

-- ============================================================
-- 1. Stable canonical identifier
--    A text slug, not a hardcoded uuid, is what application code keys
--    off to mean "one of the three canonical Questions" — mirrors the
--    additive, non-breaking pattern already used for `family`
--    (2026-09-01-question-families.sql). Only the three canonical rows
--    ever get a slug; every historical/retired Question keeps it null.
-- ============================================================

alter table public.questions
  add column if not exists slug text unique;

comment on column public.questions.slug is
  'Stable identifier for one of the three permanent canonical Questions (private_ritual / place_outsiders_miss / ordinary_worth_protecting). Null for every historical/retired Question — the app treats "slug is not null" as the definition of canonical.';

-- ============================================================
-- 2. Seed the three canonical Questions — new rows, new ids.
--    Guarded by `where not exists`, matched on slug, so this migration
--    can be re-run safely without creating duplicates.
-- ============================================================

insert into public.questions (prompt, is_active, slug)
select v.prompt, true, v.slug
from (
  values
    ('Is there something you return to when no one''s watching — writing, cooking, walking, tinkering, anything?', 'private_ritual'),
    ('What''s something about the place you''re from that a stranger would never guess?', 'place_outsiders_miss'),
    ('What''s something ordinary you''d fight to protect?', 'ordinary_worth_protecting')
) as v(prompt, slug)
where not exists (
  select 1 from public.questions q where q.slug = v.slug
);

-- ============================================================
-- 3. Retire the old rotating Questions.
--    Matched by exact prompt text, not guessed ids — the same safe
--    pattern used throughout this migration history. Only is_active
--    changes; prompt text is never touched.
-- ============================================================

update public.questions
set is_active = false
where is_active = true
  and prompt in (
    'What is something you understand differently now than you did five years ago?',
    'What is something ordinary that means more to you than most people would expect?',
    'If you could spend one completely ordinary day anywhere in the world, where would you spend it—and what would you do?'
  );

-- ============================================================
-- 4. Enforce "is_current implies canonical" for EXISTING rows.
--
--    Some members' current Discovery-facing answer today points at one
--    of the now-retired Questions above. Per product rule, only
--    canonical answers may represent a member in current discovery
--    going forward. This clears the is_current FLAG on any such row —
--    it does not touch body, updated_at, or any other column, and the
--    row (and its writing) is otherwise left completely intact as
--    historical writing. A member left with zero current answers by
--    this step simply has no current Discovery representation until
--    they publish or select a canonical one — matching the
--    participation-gate rule going forward.
-- ============================================================

update public.question_answers qa
set is_current = false
where qa.is_current = true
  and not exists (
    select 1 from public.questions q
    where q.id = qa.question_id
      and q.slug is not null
  );

-- ============================================================
-- VERIFY (optional — read-only, safe to run or skip)
-- ============================================================

select id, prompt, is_active, slug, family
from public.questions
order by (slug is not null) desc, created_at desc;

select count(*) as current_non_canonical_answers_should_be_zero
from public.question_answers qa
join public.questions q on q.id = qa.question_id
where qa.is_current = true and q.slug is null;
