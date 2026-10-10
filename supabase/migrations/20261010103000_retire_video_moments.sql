-- Forward-only retirement. Do not delete letters, photos or stored objects.
begin;
update storage.buckets
set allowed_mime_types = array['image/jpeg']::text[]
where id = 'letter-photos' and public = false;

create or replace function public.validate_selected_video_moment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.type = 'video' then
    raise exception 'Video Moments are no longer available.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_selected_video_moment() from public, anon, authenticated;
drop trigger if exists validate_selected_video_moment on public.moments;
create trigger validate_selected_video_moment
before insert or update on public.moments
for each row execute function public.validate_selected_video_moment();

-- Retired video draft access must not permit new uploads or URL signing.
drop policy if exists letter_video_draft_select on storage.objects;
create or replace function public.can_upload_video_moment(p_correspondence_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog
as $$ select false $$;
revoke all on function public.can_upload_video_moment(uuid) from public, anon;
grant execute on function public.can_upload_video_moment(uuid) to authenticated;
commit;
