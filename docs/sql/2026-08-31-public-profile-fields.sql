-- Tempa — extend public_profiles for the new public member-profile
-- surface.
-- PREPARED 2026-08-31. NOT EXECUTED.
--
-- Required for the public profile feature to show languages and "what
-- brings you here" — not a security fix, just an explicit, minimal
-- allowlist extension. CREATE OR REPLACE VIEW only allows appending
-- columns at the end, so the two new ones go after age_range, matching
-- the pattern already used for letters_for_participant.
--
-- Still an allowlist, not a row passthrough: only these two additional
-- columns are added, both already collected during onboarding as
-- identity/context a member fills in expecting other members to see it
-- (the same category as country/gender/age_range, already exposed).
-- Nothing sensitive (email, OAuth identity, exact birthday, address,
-- account identifiers) is anywhere near this view.

create or replace view public.public_profiles as
select id, pseudonym, country, gender, gender_custom, age_range, languages, intent
from public.profiles;
