-- Tempa — clean up accidentally duplicated Question rows.
-- NOT executed automatically. Print/review only, per instruction.
--
-- Confirmed via the 2026-08-30 Discovery diagnostic: the two-row seed
-- INSERT from docs/sql/2026-08-30-questions-and-pseudonym.sql was applied
-- twice, producing duplicate active rows for both new prompts. The
-- original five-years Question (66082d95-5c81-41af-8ff7-8686a57b2a80) is
-- untouched by this migration and is not in the candidate set below —
-- every existing question_answers row references only that Question, per
-- the diagnostic.
--
-- Candidate duplicate/new rows (from the diagnostic's questions_rows):
--   'ordinary things' prompt:      2c897dc1-2f0b-40ab-93d7-a33663173538
--                                  573c84fd-0666-49ab-b3e5-68be52fcb9e8
--   'ordinary day anywhere' prompt: 66788926-9521-4b83-b243-d78307f1de9b
--                                  469a998d-da34-4c98-a088-1b5d890f9459
--
-- Rather than guessing which of each pair was created first, this keeps
-- whichever has the earlier created_at within each prompt-text group
-- (computed live, not hardcoded) and deletes the other. Restricted to
-- exactly these 4 known IDs — it does not touch any other row, even if
-- some future Question happens to share prompt text.
--
-- Why the guard matters: question_answers.question_id is
-- ON DELETE CASCADE. If any candidate row were in fact referenced by a
-- published answer (contrary to the diagnostic), a plain DELETE would
-- silently cascade-delete that answer too. This aborts the whole
-- migration instead if that's ever not true — re-run the diagnostic
-- before retrying if it does.

do $$
declare
  referenced_count int;
begin
  select count(*) into referenced_count
  from public.question_answers qa
  where qa.question_id in (
    '2c897dc1-2f0b-40ab-93d7-a33663173538',
    '573c84fd-0666-49ab-b3e5-68be52fcb9e8',
    '66788926-9521-4b83-b243-d78307f1de9b',
    '469a998d-da34-4c98-a088-1b5d890f9459'
  );

  if referenced_count > 0 then
    raise exception
      'Aborting: % question_answers row(s) reference a candidate duplicate Question. Re-run the diagnostic before proceeding.',
      referenced_count;
  end if;
end $$;

with candidates as (
  select id, prompt, created_at
  from public.questions
  where id in (
    '2c897dc1-2f0b-40ab-93d7-a33663173538',
    '573c84fd-0666-49ab-b3e5-68be52fcb9e8',
    '66788926-9521-4b83-b243-d78307f1de9b',
    '469a998d-da34-4c98-a088-1b5d890f9459'
  )
),
ranked as (
  select id, row_number() over (partition by prompt order by created_at asc) as rn
  from candidates
)
delete from public.questions
where id in (select id from ranked where rn > 1);

-- After this runs, `questions` should have exactly 3 active rows: the
-- original five-years Question plus one canonical copy each of the
-- 'ordinary things' and 'ordinary day anywhere' prompts.
