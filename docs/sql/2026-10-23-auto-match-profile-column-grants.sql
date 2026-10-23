-- Applied to production 2026-10-23 to resolve blocked first-arrival Auto-Match.
-- Root cause: authenticated could SELECT and INSERT profiles, but had no
-- UPDATE privilege. The existing owner-only UPDATE RLS was already correct.
-- Grant only the two fields used by first-arrival, not blanket UPDATE:
--   intent: optional member-selected reasons for writing
--   auto_match_completed_at: dismissal/completion marker
-- Other profile fields remain restricted to their established mutation RPCs.
BEGIN;
GRANT UPDATE (intent, auto_match_completed_at) ON TABLE public.profiles TO authenticated;
COMMIT;
-- Verify:
-- SELECT attname, has_column_privilege('authenticated','public.profiles',attname,'UPDATE')
-- FROM pg_attribute WHERE attrelid='public.profiles'::regclass
-- AND attname IN ('intent','auto_match_completed_at','id','onboarding_stage');
