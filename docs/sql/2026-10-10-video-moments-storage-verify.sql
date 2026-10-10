-- Read-only. Every boolean should be true after the approved migration.
select not public as bucket_private,
  file_size_limit = 5242880 as original_size_limit_preserved,
  allowed_mime_types = array['image/jpeg','video/mp4']::text[] as jpeg_and_mp4_only
from storage.buckets where id='letter-photos';
select
  exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
    and policyname='letter_video_insert_guard' and permissive='RESTRICTIVE') as video_insert_guard,
  exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
    and policyname='letter_video_draft_select' and qual like '%owner_id%') as uploader_draft_access,
  exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
    and policyname='letter_photos_select' and qual like '%can_view_letter_photo%') as delivered_consent_gate_retained,
  exists(select 1 from pg_trigger where tgrelid='public.moments'::regclass
    and tgname='validate_selected_video_moment' and not tgisinternal) as clip_reference_guard,
  not has_function_privilege('anon','public.can_upload_video_moment(uuid)','EXECUTE') as helper_not_anonymous;
