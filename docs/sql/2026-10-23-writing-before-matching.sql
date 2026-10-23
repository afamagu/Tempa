-- New members only: writing invitation BEFORE first-arrival Auto-Match.
-- Historical profiles are grandfathered to version 1, preserving their flow.
BEGIN;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS first_arrival_journey_version smallint;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS first_letter_invitation_done_at timestamptz;
UPDATE public.profiles SET first_arrival_journey_version=1 WHERE first_arrival_journey_version IS NULL;
ALTER TABLE public.profiles ALTER COLUMN first_arrival_journey_version SET DEFAULT 2;
ALTER TABLE public.profiles ALTER COLUMN first_arrival_journey_version SET NOT NULL;
GRANT UPDATE (first_letter_invitation_done_at) ON TABLE public.profiles TO authenticated;
COMMIT;
