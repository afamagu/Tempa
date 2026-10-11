-- Tempa / The Room: voluntary withdrawal of own public member letter.
-- REVIEW-ONLY; apply after staging / security verification.
-- Private letters already sent from the Room remain untouched.
BEGIN;
CREATE OR REPLACE FUNCTION public.withdraw_my_room_letter(p_letter_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog' AS $body$
DECLARE
  v_owner uuid := auth.uid();
  v_letter public.dispatches%rowtype;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Sign-in required' USING errcode='42501';
  END IF;
  SELECT * INTO v_letter FROM public.dispatches
    WHERE id=p_letter_id AND author_id=v_owner
      AND published_as='member'
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Letter not available' USING errcode='P0002';
  END IF;
  IF v_letter.status='unpublished' THEN RETURN true; END IF;
  IF v_letter.status <> 'published' THEN
    RAISE EXCEPTION 'Letter not available' USING errcode='P0002';
  END IF;

  UPDATE public.dispatches SET status='unpublished',web_public=false
    WHERE id=p_letter_id AND author_id=v_owner;
  UPDATE public.dispatch_shares
    SET revoked_at=coalesce(revoked_at,now())
    WHERE dispatch_id=p_letter_id AND revoked_at IS NULL;
  UPDATE public.profiles SET pinned_dispatch_id=NULL
    WHERE id=v_owner AND pinned_dispatch_id=p_letter_id;
  RETURN true;
END;
$body$;
REVOKE ALL ON FUNCTION public.withdraw_my_room_letter(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_my_room_letter(uuid) TO authenticated;
COMMIT;
