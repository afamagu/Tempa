-- Tempa — canonical three-Question model: read-only verification.
-- Run manually after applying, in this order:
--   1. 2026-09-03-canonical-questions.sql
--   2. 2026-09-03-set-current-answer-canonical-only.sql
--   3. 2026-09-03-publish-question-answer-canonical.sql
--
-- Nothing here writes. Vitest cannot exercise live Postgres RPCs, so
-- this is the manual check that publish_question_answer/
-- set_current_answer behave as intended against real data — pair it
-- with a real authenticated pass through Answer a Question / My
-- answers / a public profile.

-- 1. Exactly three canonical Questions, correct slugs and prompts.
select slug, prompt, is_active
from public.questions
where slug is not null
order by slug;

-- 2. The old rotating Questions are deactivated, prompts untouched.
select prompt, is_active, family
from public.questions
where slug is null and family is not null
order by created_at;

-- 3. No existing question_answers row was altered in content — spot
--    check counts before/after are unchanged (run once before applying
--    step 4 of the first migration and compare, or just confirm this
--    total looks right for your data).
select count(*) as total_question_answers from public.question_answers;

-- 4. Invariant: is_current can only ever be true on a canonical row.
--    Must return zero rows.
select qa.id, qa.user_id, qa.question_id
from public.question_answers qa
join public.questions q on q.id = qa.question_id
where qa.is_current = true and q.slug is null;

-- 5. Every member with at least one current answer has exactly one.
select user_id, count(*)
from public.question_answers
where is_current = true
group by user_id
having count(*) <> 1;
-- (should return no rows — the partial unique index already guarantees
-- this, this is just a second, independent confirmation)

-- 6. Manual RPC check (replace the uuids with a real test account's
--    answer ids before running, in the SQL editor while impersonating
--    or via a service call — not meant to run as-is):
--
--    -- a) First-ever canonical publish becomes current:
--    -- select * from public.publish_question_answer('<canonical-question-id>', 'test body');
--    -- expect is_current = true if this account had zero current rows before.
--
--    -- b) Editing a second, already-answered canonical Question does NOT
--    --    steal current status from the first:
--    -- select * from public.publish_question_answer('<other-canonical-question-id>', 'edited body');
--    -- expect is_current = false on this row, and the original still true.
--
--    -- c) set_current_answer switches between two canonical answers:
--    -- select * from public.set_current_answer('<other-canonical-answer-id>');
--    -- expect that row is_current = true, the previous one now false.
--
--    -- d) set_current_answer rejects a historical (non-canonical) answer:
--    -- select * from public.set_current_answer('<historical-answer-id>');
--    -- expect an exception: "Only a completed answer to one of the three
--    -- canonical Questions can be shown in Minds."
