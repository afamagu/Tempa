-- TEMPA / ROOM: convert individually reviewed public answers into Room letters.
-- REVIEW-ONLY. Do not execute against live Tempa until staging passed.
-- Keep all original questions, answers, histories and private correspondence.
-- A member's writing is copied verbatim, not rewritten.
BEGIN;
CREATE TEMP TABLE room_reviewed_answer_ids (answer_id uuid PRIMARY KEY) ON COMMIT DROP;

-- The reviewer must INSERT exact answer UUIDs here after reading the
-- original question and response. Leave blank to fail closed.
-- INSERT INTO room_reviewed_answer_ids(answer_id) VALUES ('uuid-from-review');

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM room_reviewed_answer_ids) THEN
    RAISE EXCEPTION 'No individually reviewed answers: import stopped'
      USING errcode='22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM room_reviewed_answer_ids a
    LEFT JOIN public.question_answers qa ON qa.id=a.answer_id
    LEFT JOIN public.questions q ON q.id=qa.question_id
    LEFT JOIN public.public_profiles pp ON pp.id=qa.user_id
    WHERE qa.id IS NULL OR q.id IS NULL OR pp.id IS NULL
      OR qa.moderation_status IS DISTINCT FROM 'visible'
      OR coalesce(btrim(qa.body),'')=''
      OR coalesce(btrim(q.prompt),'')=''
      OR NOT coalesce(tempa_private.author_content_publicly_visible(qa.user_id),false)
  ) THEN
    RAISE EXCEPTION 'A reviewed answer is no longer eligible: import stopped'
      USING errcode='P0001';
  END IF;
END;
$guard$;

ALTER TABLE public.dispatches
  ADD COLUMN IF NOT EXISTS origin_answer_id uuid,
  ADD COLUMN IF NOT EXISTS origin_question_id uuid,
  ADD COLUMN IF NOT EXISTS origin_question_prompt text,
  ADD COLUMN IF NOT EXISTS origin_answer_created_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS dispatches_origin_answer_id_uidx
  ON public.dispatches(origin_answer_id) WHERE origin_answer_id IS NOT NULL;

DO $schema$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.dispatches'::regclass
      AND conname='dispatches_answer_origin_complete'
  ) THEN
    ALTER TABLE public.dispatches ADD CONSTRAINT dispatches_answer_origin_complete CHECK (
      (origin_answer_id IS NULL AND origin_question_id IS NULL
       AND origin_question_prompt IS NULL AND origin_answer_created_at IS NULL)
      OR
      (origin_answer_id IS NOT NULL AND origin_question_id IS NOT NULL
       AND nullif(btrim(origin_question_prompt),'') IS NOT NULL
       AND origin_answer_created_at IS NOT NULL)
    );
  END IF;
END;
$schema$;

WITH chosen AS (
  SELECT qa.id source_answer_id, qa.user_id author_id,
         qa.question_id original_question_id, qa.body,
         qa.created_at original_date,
         btrim(regexp_replace(q.prompt,'[[:cntrl:]]+',' ','g')) original_prompt,
         row_number() OVER (PARTITION BY qa.user_id,qa.body
                            ORDER BY qa.created_at,qa.id) AS duplicate_rank
  FROM room_reviewed_answer_ids a
  JOIN public.question_answers qa ON qa.id=a.answer_id
  JOIN public.questions q ON q.id=qa.question_id
  WHERE qa.moderation_status='visible'
    AND public.dispatch_visible_length(qa.body)<=200000
    AND tempa_private.author_content_publicly_visible(qa.user_id)
    AND NOT EXISTS (SELECT 1 FROM public.dispatches d WHERE d.origin_answer_id=qa.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.dispatches d
      WHERE d.author_id=qa.user_id AND d.published_as='member'
        AND d.status='published' AND d.body=qa.body
    )
)
INSERT INTO public.dispatches (
  author_id,title,body,status,moderation_status,published_as,
  created_at,published_at,web_public,web_slug,
  origin_answer_id,origin_question_id,origin_question_prompt,origin_answer_created_at
)
SELECT author_id,
       CASE WHEN length(original_prompt)>140 THEN left(original_prompt,137)||'...'
            ELSE original_prompt END,
       body,'published','visible','member',
       original_date,original_date,false,null,
       source_answer_id,original_question_id,original_prompt,original_date
FROM chosen WHERE original_prompt<>'' AND duplicate_rank=1
ON CONFLICT DO NOTHING;
COMMIT;
