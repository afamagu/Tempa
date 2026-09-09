-- Tempa — Question "families" for Answer a Question's three-choice
-- rotation.
-- PREPARED 2026-09-01. NOT EXECUTED — review, then run in the Supabase
-- SQL editor.
--
-- Product intent: "Answer a Question" offers exactly three eligible
-- Questions when the curated library can supply them, drawn from three
-- internal conceptual families (Reflection/Change, Everyday
-- Meaning/Lived Life, Imagination/Preferred Life) — never exposing the
-- full library, never repeating a family the member could otherwise
-- pull two Questions from while a different family sits unrepresented.
-- `family` is free text (not an enum) so a curator can introduce a
-- fourth family later without a schema change; the application only
-- ever reads three specific values today
-- ('reflection' | 'everyday' | 'imagination') but does not enforce that
-- as a CHECK constraint, matching questions.is_active's existing
-- editorial-flexibility precedent.

alter table public.questions
  add column if not exists family text;

comment on column public.questions.family is
  'Internal curation grouping for Answer a Question''s three-choice rotation (e.g. ''reflection'', ''everyday'', ''imagination''). Never exposed to members; null is allowed and simply excludes a Question from family-balanced rotation until curated.';

-- ============================================================
-- CURATE — assign the three known live Questions to their family.
--
-- Matched by exact prompt text, not id: the 2026-08-30 seed INSERT
-- (docs/sql/2026-08-30-questions-and-pseudonym.sql) was applied twice
-- and docs/sql/2026-08-30-questions-dedupe.sql (prepared, not
-- confirmed run) was written to collapse the resulting duplicates back
-- to one row per prompt — whether it has actually been run is not
-- re-verified here. Matching on prompt text rather than a hardcoded id
-- gets every known Question correctly classified either way: exactly
-- one row per prompt if dedupe already ran, or the original plus its
-- duplicate if it hasn't — never a guess, since only rows whose prompt
-- matches one of the three exactly get touched.
--
-- `family is null` additionally makes each UPDATE a no-op on a row a
-- curator has already hand-classified (e.g. into a fourth family),
-- so re-running this migration can't stomp on later manual curation.
-- Any other existing Question — none are known today, but a future one
-- seeded outside this migration — is left with family = null rather
-- than guessed at.
-- ============================================================

update public.questions
set family = 'reflection'
where family is null
  and prompt = 'What is something you understand differently now than you did five years ago?';

update public.questions
set family = 'everyday'
where family is null
  and prompt = 'What is something ordinary that means more to you than most people would expect?';

update public.questions
set family = 'imagination'
where family is null
  and prompt = 'If you could spend one completely ordinary day anywhere in the world, where would you spend it—and what would you do?';

-- ============================================================
-- VERIFY (optional — read-only, safe to run or skip)
-- ============================================================

select id, prompt, is_active, family
from public.questions
order by created_at desc;
