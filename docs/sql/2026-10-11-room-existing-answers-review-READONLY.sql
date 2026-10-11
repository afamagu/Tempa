-- READ-ONLY. Content review before promoting any original answers.
-- Only authorised admins should access the original answer text.
WITH candidates AS (
 SELECT qa.id AS answer_id, qa.user_id AS author_id,
        pp.pseudonym, qa.question_id, q.prompt AS original_question,
        qa.created_at AS answered_at, qa.moderation_status,
        qa.body AS exact_original_text,
        tempa_private.author_content_publicly_visible(qa.user_id) AS author_visible,
        EXISTS(SELECT 1 FROM public.dispatches d
               WHERE d.author_id=qa.user_id AND d.status='published'
                 AND d.published_as='member'
                 AND d.body=qa.body) AS exact_duplicate_already_published,
        EXISTS(SELECT 1 FROM public.dispatches d
               WHERE d.author_id=qa.user_id AND d.status='published'
                 AND d.published_as='member' AND d.moderation_status='visible')
                 AS author_already_has_letter
 FROM public.question_answers qa
 JOIN public.questions q ON q.id=qa.question_id
 LEFT JOIN public.public_profiles pp ON pp.id=qa.user_id
)
SELECT answer_id,author_id,pseudonym,question_id,original_question,
       answered_at,moderation_status,author_visible,
       author_already_has_letter,exact_duplicate_already_published,
       length(exact_original_text) AS characters,
       left(exact_original_text,1200) AS review_excerpt,
       CASE WHEN moderation_status<>'visible' OR NOT author_visible
                   THEN 'EXCLUDE: NO LONGER PUBLIC'
            WHEN coalesce(btrim(exact_original_text),'')=''
                   THEN 'EXCLUDE: BLANK'
            WHEN exact_duplicate_already_published
                   THEN 'EXCLUDE: ALREADY A LETTER'
            ELSE 'REVIEW INDIVIDUALLY' END AS preliminary_decision
FROM candidates
ORDER BY author_already_has_letter,answered_at,answer_id;
