-- Tempa — "Show in Minds": let a member choose which of their own
-- already-published answers currently represents them in Minds/Explore.
-- PREPARED 2026-09-01. NOT EXECUTED — review, then run in the Supabase
-- SQL editor.
--
-- Mirrors publish_question_answer's atomicity reasoning
-- (2026-08-30-publish-question-answer-rpc.sql): demoting the old
-- current row and promoting the chosen one must happen in one
-- transaction, or a failure between the two steps could leave a member
-- with zero current rows. SECURITY INVOKER (the default — no DEFINER
-- clause), scoped to auth.uid() rather than a trusted parameter, so a
-- member can only ever change their OWN current answer.
--
-- Deliberately does not touch `body` or `updated_at` — choosing an
-- existing answer as current is not republishing it: no fake new
-- publication date, no content change, nothing that would look like a
-- popularity bump. The existing partial unique index on
-- question_answers(user_id) where is_current continues to guarantee
-- exactly one current answer per member; this function's two UPDATEs
-- keep that invariant true throughout.

create or replace function public.set_current_answer(p_answer_id uuid)
returns public.question_answers
language plpgsql
as $function$
declare
  result public.question_answers;
begin

  if not exists (
    select 1
    from public.question_answers
    where id = p_answer_id
      and user_id = auth.uid()
  ) then
    raise exception 'Answer not found, or not yours.';
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
