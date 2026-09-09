-- Tempa — canonical three-Question model, part 3: publish_question_answer
-- must not steal Shown-in-Minds on edit.
-- PREPARED 2026-09-03. NOT EXECUTED — review, then run in the Supabase
-- SQL editor, AFTER 2026-09-03-canonical-questions.sql (this depends on
-- questions.slug existing).
--
-- A NEW dated migration, not an edit to
-- docs/sql/2026-08-30-publish-question-answer-rpc.sql's history.
--
-- Old behavior (2026-08-30 version): every publish unconditionally
-- demoted every other answer and promoted the one just published. That
-- was correct for the old one-Question-at-a-time model, where
-- publishing WAS choosing what represents you. It's wrong for the
-- canonical model: a member editing an already-published canonical
-- answer (e.g. touching up their second answer) must not silently
-- steal "Shown in Minds" away from a different answer they deliberately
-- selected — only set_current_answer should ever move that flag once a
-- member already has a current answer.
--
-- New behavior:
--   * If the published Question is canonical AND the member currently
--     has no current answer at all, this publish becomes their current
--     answer (the "first canonical answer becomes current" rule — this
--     also naturally covers a member whose old current answer was just
--     cleared by 2026-09-03-canonical-questions.sql's step 4, since
--     they too have zero current rows afterward).
--   * Otherwise (they already have a current answer, or the published
--     Question isn't canonical), is_current is left completely
--     untouched — publishing/editing never changes it.
--
-- Editing a historical (non-canonical) answer's body continues to work
-- through this same function — ownership, not canonical status, is
-- what governs editability (see app/question/question-answer.tsx) — it
-- simply never affects is_current.

create or replace function public.publish_question_answer(p_question_id uuid, p_body text)
returns public.question_answers
language plpgsql
as $function$
declare
  result public.question_answers;
  is_canonical boolean;
  has_current boolean;
  should_promote boolean;
begin
  select (slug is not null) into is_canonical
  from public.questions
  where id = p_question_id;

  select exists (
    select 1 from public.question_answers
    where user_id = auth.uid() and is_current = true
  ) into has_current;

  should_promote := coalesce(is_canonical, false) and not has_current;

  if should_promote then
    update public.question_answers
    set is_current = false
    where user_id = auth.uid()
      and question_id <> p_question_id;
  end if;

  insert into public.question_answers (user_id, question_id, body, is_current, updated_at)
  values (auth.uid(), p_question_id, p_body, should_promote, now())
  on conflict (user_id, question_id)
  do update set
    body = excluded.body,
    updated_at = now(),
    is_current = case when should_promote then true else public.question_answers.is_current end
  returning * into result;

  return result;
end;
$function$;
