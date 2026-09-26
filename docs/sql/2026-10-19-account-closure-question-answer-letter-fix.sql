-- ============================================================
-- TEMPA — ACCOUNT CLOSURE: QUESTION ANSWERS REFERENCED BY OTHER MEMBERS' LETTERS
-- STATUS: NOT EXECUTED — review, then run in the Supabase SQL editor,
-- then run 2026-10-19-account-closure-question-answer-letter-fix-verify.sql
-- (read-only; overall_pass must be true).
-- Forward-only. Does NOT edit 2026-08-30-letters.sql, 2026-10-16-account-
-- lifecycle.sql or 2026-10-18-account-closure-own-replies-fix.sql, and
-- does not touch close_my_account() (the 2026-10-18 version stays live).
-- No app deploy needed.
-- ============================================================
--
-- PRODUCTION FAILURE (captured by the 2026-10-18 server log):
--   P0001  Letters are immutable except for their lifecycle status fields.
-- close_my_account() runs
--   delete from public.question_answers where user_id = v_uid;
-- letters.question_answer_id references question_answers(id) ON DELETE
-- SET NULL (2026-08-30), so deleting an answer that another member's
-- first-contact letter was written in response to makes Postgres UPDATE
-- that letter's question_answer_id to NULL. The BEFORE UPDATE trigger
-- letters_enforce_immutability (enforce_letter_immutability, last defined
-- 2026-09-04) rejects ANY change to question_answer_id, so the closure
-- rolled back.
--
-- SCHEMA CONTRADICTION: the foreign key explicitly asks for the reference
-- to be cleared when the answer is deleted; the later immutability trigger
-- forbids that exact change.
--
-- CHOSEN FIX (keep the FK's intent): letters survive, the deleted member's
-- answer is still physically deleted, and the immutability rule gains ONE
-- narrow exception, accepted only when ALL of these hold:
--   * question_answer_id goes from a real UUID to NULL;
--   * every other column is byte-for-byte unchanged (whole-row comparison,
--     excluding only the generated body_search);
--   * the referenced Question answer no longer exists (checked by a
--     SECURITY DEFINER helper, so RLS can never make a live answer look
--     deleted).
-- That is exactly the shape of the ON DELETE SET NULL action. Any other
-- change to question_answer_id — or nulling it while the answer still
-- exists, or combining it with any other change — is rejected with the
-- same P0001 as before. Every original check below is verbatim. Members
-- still have no UPDATE privilege on letters at all.

begin;

create or replace function tempa_private.letter_question_answer_is_deleted(p_question_answer_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog'
as $function$
  select p_question_answer_id is not null
     and not exists (select 1 from public.question_answers qa where qa.id = p_question_answer_id)
$function$;

revoke all on function tempa_private.letter_question_answer_is_deleted(uuid) from public, anon, authenticated;


create or replace function public.enforce_letter_immutability()
returns trigger
language plpgsql
as $function$
begin

  -- 2026-10-19: the one permitted non-lifecycle change is the ON DELETE
  -- SET NULL of question_answer_id after its Question answer is deleted.
  if
        old.question_answer_id is not null
    and new.question_answer_id is null
    and (to_jsonb(new) - 'question_answer_id' - 'body_search')
        = (to_jsonb(old) - 'question_answer_id' - 'body_search')
    and tempa_private.letter_question_answer_is_deleted(old.question_answer_id)
  then
    return new;
  end if;

  if
       new.sender_id <> old.sender_id
    or new.recipient_id <> old.recipient_id
    or new.question_answer_id is distinct from old.question_answer_id
    or new.reply_to_id is distinct from old.reply_to_id
    or new.correspondence_id <> old.correspondence_id
    or new.body <> old.body
    or new.created_at <> old.created_at
    or new.expires_at <> old.expires_at
    or new.deliver_at <> old.deliver_at
  then
    raise exception
      'Letters are immutable except for their lifecycle status fields.';
  end if;


  if
    old.status in ('replied', 'closed')
    and new.status <> old.status
  then
    raise exception
      'This letter has already reached a terminal state.';
  end if;


  return new;

end;
$function$;

commit;
