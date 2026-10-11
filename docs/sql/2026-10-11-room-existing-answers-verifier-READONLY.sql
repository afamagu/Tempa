-- Read only; run only AFTER staged import.
SELECT count(*) AS answer_count FROM public.question_answers;
SELECT count(*) AS imported_count FROM public.dispatches WHERE origin_answer_id IS NOT NULL;
SELECT d.id,d.origin_answer_id,
       d.author_id=qa.user_id AS author_preserved,
       d.body=qa.body AS words_preserved,
       d.origin_question_id=qa.question_id AS question_preserved,
       d.origin_question_prompt=q.prompt AS question_prompt_preserved,
       d.origin_answer_created_at=qa.created_at AS answered_date_preserved,
       d.published_at=qa.created_at AS displayed_date_preserved,
       (d.web_public=false) AS web_visibility_disabled,
       d.published_as='member' AS member_author,
       d.status,d.moderation_status
 FROM public.dispatches d
 LEFT JOIN public.question_answers qa ON qa.id=d.origin_answer_id
 LEFT JOIN public.questions q ON q.id=qa.question_id
 WHERE d.origin_answer_id IS NOT NULL ORDER BY d.id;
SELECT origin_answer_id,count(*) AS copies FROM public.dispatches
 WHERE origin_answer_id IS NOT NULL
 GROUP BY origin_answer_id HAVING count(*)>1;
-- Verify full client workflows separately: duplicates, withdrawn URL, token
-- revocation, Web pages noindex, existing source letters remain delivered.
