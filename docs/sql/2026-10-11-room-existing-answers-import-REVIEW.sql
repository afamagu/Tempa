-- TEMPA / ROOM: convert individually reviewed public answers into Room letters.
-- REVIEW-ONLY. Do not execute against live Tempa until staging passed.
-- Keep all original questions, answers, histories and private correspondence.
-- A member's writing is copied verbatim, not rewritten.
BEGIN;
CREATE TEMP TABLE room_reviewed_answer_ids (
  answer_id uuid PRIMARY KEY,
  editorial_title text NOT NULL CHECK (char_length(btrim(editorial_title)) BETWEEN 1 AND 140)
) ON COMMIT DROP;

-- The title is editorial framing, not an alteration to the author's body.
-- The original public Question remains preserved as provenance and appears
-- in the Room reader. Every authored paragraph is copied exactly.
-- Selected after inspecting all fifteen visible original answers:
-- thirteen ordinary-member answers, two editorial house answers excluded.
INSERT INTO room_reviewed_answer_ids(answer_id,editorial_title) VALUES
('d201938b-6fb7-4372-acdf-990ea8e4f0a2','What I understand differently now'),
('499515de-9377-4035-8c5e-a8cff83436bf','A television drought'),
('b8997358-6877-45e0-a090-d30979d90350','What visitors hear'),
('b0514861-bc79-46a4-b105-0675e199b8e5','The uninterpreted hour'),
('f27eaa6e-6a6c-41ae-88ce-6968056574fb','I tend to show people I like them by feeding them'),
('9c7a40e7-8f33-4984-8cde-0f3a1d25445d','When I walk into a room'),
('3b022585-6913-4d45-a158-69d12005b49d','Nature, food and technology'),
('1430ae81-46d8-4a2d-a8ae-66bd462c9a01','The old clockmaker'),
('93515012-2b09-4adf-84c4-b536991962a1','Laughter, kindness and nature'),
('555d8e8f-ae2b-4fa4-bc03-417cd74aff87','Trying new things'),
('b4c6332a-500e-488c-95d7-6a596d5f8955','Books and good meals'),
('281b6e25-0411-4472-a1ec-4f3272765c35','A boring Tuesday into a story'),
('dfb49da9-08a8-43cb-b1f5-13775d1d6d28','The versions of me in my head');

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
    LEFT JOIN public.profiles pp ON pp.id=qa.user_id
    WHERE qa.id IS NULL OR q.id IS NULL OR pp.id IS NULL OR pp.is_editorial IS TRUE
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
  SELECT a.editorial_title, qa.id source_answer_id, qa.user_id author_id,
         qa.question_id original_question_id, qa.body,
         qa.created_at original_date,
         btrim(regexp_replace(q.prompt,'[[:cntrl:]]+',' ','g')) original_prompt,
         row_number() OVER (PARTITION BY qa.user_id,qa.body
                            ORDER BY qa.created_at,qa.id) AS duplicate_rank
  FROM room_reviewed_answer_ids a
  JOIN public.question_answers qa ON qa.id=a.answer_id
  JOIN public.questions q ON q.id=qa.question_id
  JOIN public.profiles member ON member.id=qa.user_id
  WHERE qa.moderation_status='visible'
    AND member.is_editorial IS DISTINCT FROM true
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
SELECT author_id, editorial_title,
       body,'published','visible','member',
       original_date,original_date,false,null,
       source_answer_id,original_question_id,original_prompt,original_date
FROM chosen WHERE original_prompt<>'' AND duplicate_rank=1
ON CONFLICT DO NOTHING;
COMMIT;
