-- Tempa — atomic current-answer replacement.
-- NOT executed automatically. Prepared for review; do not run until confirmed.
--
-- Problem this fixes: app/question/question-answer.tsx used to publish an
-- answer as two separate client calls — (1) UPDATE ... SET is_current =
-- false on the member's other rows, then (2) UPSERT this row with
-- is_current = true. If step 2 failed after step 1 succeeded (network
-- drop, a validation error, anything), the member would be left with zero
-- current rows: they'd lose their current Discovery answer even though
-- the new one was never actually published.
--
-- Fix: do both steps inside a single database function. A single
-- top-level call to a plpgsql function executes as one transaction — if
-- any statement inside it raises, none of its effects are visible. So
-- either the demote-and-promote both happen, or neither does.
--
-- Runs as SECURITY INVOKER (the default — no DEFINER clause), so it's
-- bound by the same row-level security the client's two prior calls were
-- already subject to; it doesn't need or get elevated privileges. It
-- reads the caller's identity from auth.uid() rather than trusting a
-- user_id parameter, so a member can only ever affect their own rows.
--
-- Existing table constraints on question_answers (the body length and
-- non-blank CHECKs, the (user_id, question_id) unique constraint, and the
-- partial unique index on (user_id) where is_current from the 2026-08-30
-- migration) are untouched and still apply — this function doesn't need
-- to duplicate them.

create or replace function public.publish_question_answer(p_question_id uuid, p_body text)
returns public.question_answers
language plpgsql
as $function$
declare
  result public.question_answers;
begin
  update public.question_answers
  set is_current = false
  where user_id = auth.uid()
    and question_id <> p_question_id;

  insert into public.question_answers (user_id, question_id, body, is_current, updated_at)
  values (auth.uid(), p_question_id, p_body, true, now())
  on conflict (user_id, question_id)
  do update set body = excluded.body, is_current = true, updated_at = now()
  returning * into result;

  return result;
end;
$function$;
