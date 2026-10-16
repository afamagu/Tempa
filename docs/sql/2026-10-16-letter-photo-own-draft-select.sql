-- Issue #132: the draft author must be able to read their own private
-- photo BEFORE a moments row exists. The original SELECT policy only
-- authorizes photographs already attached to sent letters, so restored
-- multi-day drafts cannot re-sign the preview URL.
-- This narrowly grants read access to the original uploader, provided
-- the storage key identifies a real correspondence they belong to.
-- Recipients still cannot see unsent private photographs.
create policy "letter_photos_own_drafts_select"
on storage.objects for select to authenticated
using (
  bucket_id = 'letter-photos'
  and owner_id = (select auth.uid())::text
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
  and public.is_correspondence_participant(split_part(name, '/', 1)::uuid)
);
