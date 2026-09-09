-- Tempa — Explore-empty diagnostic. Read-only. Safe to run as-is.
--
-- Run these in order for the account you're testing Explore with.
-- Replace :viewer_id with that account's auth.users.id (from
-- profiles/public_profiles by pseudonym if easier — query 0 below).

-- 0. Find a test account's id by pseudonym.
select id, pseudonym from public.profiles where pseudonym in ('Saint Nicole', 'Melons', 'Evening Quill', 'Saint Nico');

-- 1. Every canonical answer that exists right now, per user, and
--    whether it's current. This is the ground truth for "current-answer
--    state" — confirms whether is_current actually landed on the
--    canonical row for each test user, and whether more than one
--    canonical row is ever current for the same user (would violate the
--    one-current-per-user invariant).
select
  p.pseudonym,
  qa.user_id,
  q.slug,
  q.prompt,
  qa.is_current,
  qa.updated_at
from public.question_answers qa
join public.questions q on q.id = qa.question_id
join public.profiles p on p.id = qa.user_id
where q.slug is not null
order by p.pseudonym, q.slug;

-- 2. Anyone whose CURRENT answer is NOT canonical right now — this is
--    the exact bug scenario possible if 2026-09-03-publish-question-
--    answer-canonical.sql hasn't been applied yet and someone has
--    edited/republished a historical answer since: the old RPC
--    unconditionally promotes on every publish, which would silently
--    move is_current off their canonical answer and onto the
--    historical one. Should return zero rows once all three
--    2026-09-03 migrations are applied.
select p.pseudonym, qa.user_id, qa.question_id, q.slug, qa.is_current
from public.question_answers qa
join public.questions q on q.id = qa.question_id
join public.profiles p on p.id = qa.user_id
where qa.is_current = true and q.slug is null;

-- 3. Which Postgres functions are actually live right now for
--    publish_question_answer / set_current_answer — confirms whether
--    migrations 2026-09-03-set-current-answer-canonical-only.sql and
--    2026-09-03-publish-question-answer-canonical.sql have been
--    applied. If prosrc does NOT contain 'is_canonical' /
--    'slug is not null', the OLD pre-canonical version is still live.
select proname, prosrc
from pg_proc
where proname in ('publish_question_answer', 'set_current_answer')
  and pronamespace = 'public'::regnamespace;

-- 4. RLS policies on the three tables Explore reads cross-user
--    (question_answers, profiles/public_profiles). If question_answers
--    or profiles has no policy permitting a non-owner to SELECT a
--    matching row, Explore's cross-user query silently returns nothing
--    for those rows no matter how correct the query logic is,
--    regardless of is_current or canonical status.
select schemaname, tablename, policyname, cmd, qual
from pg_policies
where tablename in ('question_answers', 'profiles');

-- 5. For a specific viewer: who is currently excluded as an active
--    correspondence partner, and which specific answer ids they've
--    already contacted. Substitute :viewer_id.
-- select participant_low, participant_high, status
-- from public.correspondences
-- where (participant_low = :viewer_id or participant_high = :viewer_id)
--   and status = 'active';

-- select question_answer_id
-- from public.letters_for_participant
-- where sender_id = :viewer_id and reply_to_id is null;

-- 6. Putting it together: the exact eligible pool Explore's query
--    should produce for :viewer_id right now (mirrors app/minds/
--    page.tsx's logic exactly — is_current answers, not self, not an
--    active partner, not a previously-contacted answer id).
-- select qa.id, qa.user_id, p.pseudonym, q.slug
-- from public.question_answers qa
-- join public.questions q on q.id = qa.question_id
-- join public.profiles p on p.id = qa.user_id
-- where qa.is_current = true
--   and qa.user_id <> :viewer_id
--   and qa.user_id not in (
--     select case when participant_low = :viewer_id then participant_high else participant_low end
--     from public.correspondences
--     where (participant_low = :viewer_id or participant_high = :viewer_id) and status = 'active'
--   )
--   and qa.id not in (
--     select question_answer_id from public.letters_for_participant
--     where sender_id = :viewer_id and reply_to_id is null and question_answer_id is not null
--   );
