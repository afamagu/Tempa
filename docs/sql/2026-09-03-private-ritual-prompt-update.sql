-- Tempa — shorten canonical Question "private_ritual"'s prompt text.
-- PREPARED 2026-09-03. NOT EXECUTED — review, then run in the Supabase
-- SQL editor.
--
-- From: "Is there something you return to when no one's watching —
--         writing, cooking, walking, tinkering, anything?"
-- To:   "Is there something you return to when no one's watching?"
--
-- Matched by slug = 'private_ritual', not a hardcoded id — the same
-- row keeps its existing uuid and slug. This is a wording edit to the
-- CURRENT canonical Question row itself (not the old, already-retired
-- rotating Questions from before 2026-09-03-canonical-questions.sql),
-- so it does not fall under "never rewrite an old Question row" — no
-- answer was ever written against different wording, since this
-- Question was only just introduced. No answers are touched.

update public.questions
set prompt = 'Is there something you return to when no one''s watching?'
where slug = 'private_ritual';

-- VERIFY (optional — read-only)
select id, slug, prompt from public.questions where slug = 'private_ritual';
