-- READ-ONLY verification for 2026-09-30-mark-identity-and-admin-member-workspace.sql

select
  to_regprocedure('public.get_profile_mark_management_status()') is not null as mark_status_rpc,
  to_regprocedure('public.admin_send_first_letter(uuid,text)') is not null as admin_contact_rpc,
  has_function_privilege('authenticated', 'public.get_profile_mark_management_status()', 'EXECUTE') as owner_status_exec,
  not has_function_privilege('anon', 'public.get_profile_mark_management_status()', 'EXECUTE') as no_anon_status,
  has_function_privilege('authenticated', 'public.admin_send_first_letter(uuid,text)', 'EXECUTE') as authenticated_contact_exec,
  not has_function_privilege('anon', 'public.admin_send_first_letter(uuid,text)', 'EXECUTE') as no_anon_contact;

select
  pg_get_functiondef('public.reserve_profile_mark()'::regprocedure) ilike '%interval ''30 days''%' as reserve_enforces_cooldown,
  pg_get_functiondef('public.finalize_profile_mark(uuid)'::regprocedure) ilike '%interval ''30 days''%' as finalize_rechecks_cooldown,
  pg_get_functiondef('public.admin_send_first_letter(uuid,text)'::regprocedure) ilike '%public.is_staff()%' as admin_contact_checks_staff,
  pg_get_functiondef('public.admin_send_first_letter(uuid,text)'::regprocedure) ilike '%is_correspondence_blocked_pair%' as admin_contact_respects_blocks,
  pg_get_functiondef('public.admin_send_first_letter(uuid,text)'::regprocedure) ilike '%public.correspondences%' as uses_correspondences,
  pg_get_functiondef('public.admin_send_first_letter(uuid,text)'::regprocedure) ilike '%public.letters%' as uses_letters;

select
  pg_get_function_result('public.admin_get_member(uuid)'::regprocedure) ilike '%email text%' as staff_detail_has_email,
  pg_get_function_result('public.admin_get_member(uuid)'::regprocedure) ilike '%mark_id uuid%' as staff_detail_has_mark,
  pg_get_function_result('public.admin_get_member(uuid)'::regprocedure) not ilike '%onboarding_stage%' as staff_detail_hides_onboarding,
  pg_get_function_result('public.get_blocked_profiles()'::regprocedure) ilike '%mark_id uuid%' as blocked_profiles_has_mark;

select
  not has_table_privilege('authenticated', 'public.profile_marks', 'UPDATE') as no_direct_mark_update,
  not has_table_privilege('authenticated', 'public.profiles', 'UPDATE') as no_direct_profile_update,
  (select file_size_limit = 1048576 and allowed_mime_types = array['image/png'] from storage.buckets where id = 'profile-marks') as png_one_mib_unchanged;
