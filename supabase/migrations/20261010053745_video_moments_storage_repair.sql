-- Forward-only; apply only with owner approval. Photo limits and read policies stay intact.
begin;
-- Do not overwrite another deployment's bucket configuration silently.
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'letter-photos' and not public
    and file_size_limit = 5242880 and allowed_mime_types = array['image/jpeg']::text[]) then
    raise exception 'Unexpected letter-photos configuration; review before applying this migration.';
  end if;
end $$;
update storage.buckets set allowed_mime_types = array['image/jpeg','video/mp4']::text[]
where id = 'letter-photos';

create function public.can_upload_video_moment(p_correspondence_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog
as $$
  select auth.uid() is not null
    and public.current_account_status() = 'active'
    and public.moments_qualified_for_viewer(p_correspondence_id)
    and exists (
      select 1 from public.correspondences c
      where c.id = p_correspondence_id and c.status = 'active' and c.established_at is not null
        and auth.uid() in (c.participant_low,c.participant_high)
        and c.photo_consent_status in ('no_request','enabled')
        and not tempa_private.is_blocked_pair(c.participant_low,c.participant_high)
    );
$$;
revoke all on function public.can_upload_video_moment(uuid) from public, anon;
grant execute on function public.can_upload_video_moment(uuid) to authenticated;

-- Existing permissive insert policy remains necessary; this adds video-specific restrictions.
-- JPEG paths are deliberately unchanged. A client cannot upload a video under a photo name.
create policy letter_video_insert_guard on storage.objects as restrictive
for insert to authenticated with check (
  bucket_id <> 'letter-photos'
  or (name !~ '/video/' and coalesce(metadata->>'mimetype','') = 'image/jpeg')
  or (name ~ '^[0-9a-f-]{36}/video/[0-9a-f-]{36}\.mp4$'
    and coalesce(metadata->>'mimetype','') = 'video/mp4'
    and public.can_upload_video_moment(((storage.foldername(name))[1])::uuid))
);

-- Only the uploader can recover their unsent clip. Counterpart access still requires
-- the existing can_view_letter_photo delivery/consent/block check. No public bucket.
create policy letter_video_draft_select on storage.objects
for select to authenticated using (
  bucket_id = 'letter-photos' and owner_id = auth.uid()::text
  and name ~ '^[0-9a-f-]{36}/video/[0-9a-f-]{36}\.mp4$'
  and public.can_upload_video_moment(((storage.foldername(name))[1])::uuid)
);

-- New clips start at zero and must exist in this letter's correspondence folder.
-- Leave historical rows alone; do not alter current RPCs or delivery functions.
create function public.validate_selected_video_moment()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare correspondence uuid;
begin
  if new.type <> 'video' then return new; end if;
  select correspondence_id into correspondence from public.letters where id = new.letter_id;
  if new.trim_start_seconds is distinct from 0::numeric
    or new.duration_seconds is null or new.duration_seconds <= 0 or new.duration_seconds > 10
    or new.image_path is null
    or new.image_path !~ ('^' || correspondence::text || '/video/[0-9a-f-]{36}\.mp4$')
    or not exists (select 1 from storage.objects o where o.bucket_id = 'letter-photos'
      and o.name = new.image_path and o.owner_id = auth.uid()::text
      and o.metadata->>'mimetype' = 'video/mp4') then
    raise exception 'The selected video clip is missing or invalid. Attach it again.';
  end if;
  return new;
end $$;
revoke all on function public.validate_selected_video_moment() from public, anon, authenticated;
create trigger validate_selected_video_moment before insert on public.moments
for each row execute function public.validate_selected_video_moment();
commit;
