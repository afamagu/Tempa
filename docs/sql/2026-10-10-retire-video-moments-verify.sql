-- Read-only verifier; each result should be true after approved retirement SQL.
select not public as bucket_private,
 allowed_mime_types = array['image/jpeg']::text[] as jpeg_only,
 file_size_limit = 5242880 as photo_limit_preserved
from storage.buckets where id = 'letter-photos';
select
 pg_get_functiondef('public.validate_selected_video_moment()'::regprocedure) like '%Video Moments are no longer available.%' as videos_rejected,
 not public.can_upload_video_moment(null::uuid) as video_uploads_disabled,
 not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='letter_video_draft_select') as video_draft_policy_removed,
 exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='letter_photos_select') as photo_read_policy_retained;
