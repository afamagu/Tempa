-- Tempa — canonical three-Question model, part 2: set_current_answer
-- rejects non-canonical answers.
-- PREPARED 2026-09-03. NOT EXECUTED — review, then run in the Supabase
-- SQL editor, AFTER 2026-09-03-canonical-questions.sql (this depends on
-- questions.slug existing).
--
-- A NEW dated migration, not an edit to
-- docs/sql/2026-09-01-set-current-answer-rpc.sql's history — that file
-- still shows the function's original body as actually applied on
-- 2026-09-01.
--
-- Only change from the 2026-09-01 version: the existence check that
-- guards "found and yours" now also requires the answer's Question to
-- be canonical (slug is not null). Everything else — SECURITY INVOKER,
-- the demote-then-promote transaction, not touching body/updated_at —
-- is unchanged.

create or replace function public.set_current_answer(p_answer_id uuid)
returns public.question_answers
language plpgsql
as $function$
declare
  result public.question_answers;
begin

  if not exists (
    select 1
    from public.question_answers qa
    join public.questions q on q.id = qa.question_id
    where qa.id = p_answer_id
      and qa.user_id = auth.uid()
      and q.slug is not null
  ) then
    raise exception 'Only a completed answer to one of the three canonical Questions can be shown in Minds.';
  end if;

  update public.question_answers
  set is_current = false
  where user_id = auth.uid()
    and id <> p_answer_id;

  update public.question_answers
  set is_current = true
  where id = p_answer_id
  returning *
  into result;

  return result;

end;
$function$;

revoke all
on function public.set_current_answer(uuid)
from public;

grant execute
on function public.set_current_answer(uuid)
to authenticated;
