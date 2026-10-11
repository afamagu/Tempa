-- Tempa Board first arrival. REVIEW: staging / rollback-compile before production.
-- Old Question answers, Marks, letters, guide preferences and account security remain untouched.
BEGIN;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_arrival_seen_at timestamptz;

-- Existing fully registered members should not suddenly be forced into a welcome.
UPDATE public.profiles
   SET first_arrival_seen_at = now()
 WHERE onboarding_stage='complete'
   AND first_arrival_seen_at IS NULL;

-- Old incomplete 'mark/question' accounts are allowed to enter without
-- composing a Question answer or uploading a photograph. They receive a
-- durable welcome on their next authenticated, eligible visit.
UPDATE public.profiles
   SET onboarding_stage='complete'
 WHERE onboarding_stage IN ('mark','question');

-- The old trigger forcibly set every new signup to 'mark' despite
-- successful basic profile creation. The Mark is now optional.
CREATE OR REPLACE FUNCTION tempa_private.force_initial_profile_mark_state()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $body$
BEGIN
  NEW.onboarding_stage := 'complete';
  NEW.mark_id := null;
  NEW.first_arrival_seen_at := null;
  RETURN NEW;
END;
$body$;

-- An authenticated member can mark only their own welcome complete,
-- and only after creating a profile. No insecure supplied user ID.
CREATE OR REPLACE FUNCTION public.complete_my_first_arrival()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $body$
BEGIN
  IF auth.uid() IS NULL OR tempa_private.account_is_banned(auth.uid()) THEN
    RAISE EXCEPTION 'Member access required' USING errcode='42501';
  END IF;
  UPDATE public.profiles
     SET first_arrival_seen_at=coalesce(first_arrival_seen_at,now())
   WHERE id=auth.uid() AND onboarding_stage='complete';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Complete basic profile first' USING errcode='P0002';
  END IF;
  RETURN true;
END;
$body$;
REVOKE ALL ON FUNCTION public.complete_my_first_arrival() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_my_first_arrival() TO authenticated;
COMMIT;
