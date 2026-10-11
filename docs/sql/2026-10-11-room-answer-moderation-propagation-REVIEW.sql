-- Room imported-answer lifecycle. REVIEW-ONLY, NOT DEPLOYED.
-- Imported writing may no longer be presented when its source is
-- moderated hidden or intentionally deleted. Never change private letters.
BEGIN;
CREATE OR REPLACE FUNCTION tempa_private.room_answer_origin_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog' AS $body$
DECLARE v_source_id uuid;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.moderation_status IS DISTINCT FROM 'hidden' THEN RETURN NEW; END IF;
    IF OLD.moderation_status='hidden' THEN RETURN NEW; END IF;
    v_source_id:=NEW.id;
  ELSIF TG_OP='DELETE' THEN
    v_source_id:=OLD.id;
  ELSE
    RAISE EXCEPTION 'Unsupported origin lifecycle operation';
  END IF;
  UPDATE public.dispatches
     SET status='unpublished', moderation_status=CASE
       WHEN TG_OP='UPDATE' THEN 'hidden' ELSE moderation_status END,
       web_public=false
   WHERE origin_answer_id=v_source_id;
  UPDATE public.dispatch_shares
     SET revoked_at=coalesce(revoked_at,now())
   WHERE revoked_at IS NULL
     AND dispatch_id IN (
       SELECT d.id FROM public.dispatches d
       WHERE d.origin_answer_id=v_source_id
     );
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$body$;
REVOKE ALL ON FUNCTION tempa_private.room_answer_origin_lifecycle()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS room_answer_origin_hidden ON public.question_answers;
CREATE TRIGGER room_answer_origin_hidden
AFTER UPDATE OF moderation_status ON public.question_answers
FOR EACH ROW EXECUTE FUNCTION tempa_private.room_answer_origin_lifecycle();

DROP TRIGGER IF EXISTS room_answer_origin_deleted ON public.question_answers;
CREATE TRIGGER room_answer_origin_deleted
AFTER DELETE ON public.question_answers
FOR EACH ROW EXECUTE FUNCTION tempa_private.room_answer_origin_lifecycle();

COMMIT;
