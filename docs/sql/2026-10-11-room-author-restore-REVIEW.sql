-- REVIEW-ONLY. Restore an author's voluntarily withdrawn member letter.
-- Restores Tempa-only visibility, NOT external shares or prior web opt-in.
BEGIN;
CREATE OR REPLACE FUNCTION public.restore_my_room_letter(p_letter_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $body$
DECLARE v_uid uuid := auth.uid(); v_row public.dispatches%rowtype;
BEGIN
  IF v_uid IS NULL OR public.current_account_status() IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Active member required' USING errcode='42501';
  END IF;
  SELECT * INTO v_row FROM public.dispatches
   WHERE id=p_letter_id AND author_id=v_uid AND published_as='member'
   FOR UPDATE;
  IF NOT FOUND OR v_row.moderation_status IS DISTINCT FROM 'visible' THEN
    RAISE EXCEPTION 'Letter not available for restoration' USING errcode='P0002';
  END IF;
  IF v_row.origin_answer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.question_answers qa
    WHERE qa.id=v_row.origin_answer_id AND qa.user_id=v_uid
      AND qa.moderation_status='visible'
  ) THEN
    RAISE EXCEPTION 'The original answer is no longer available' USING errcode='P0002';
  END IF;
  IF v_row.status='published' THEN RETURN true; END IF;
  UPDATE public.dispatches SET status='published', web_public=false
   WHERE id=p_letter_id AND author_id=v_uid;
  RETURN true;
END;
$body$;
REVOKE ALL ON FUNCTION public.restore_my_room_letter(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_my_room_letter(uuid) TO authenticated;
COMMIT;
