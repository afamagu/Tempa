-- Stories We Carry: version-frozen back copy and 30 MiB motion assets.
-- Apply before deploying code that reads story_text. No historical version is rewritten.
alter table public.postcard_versions
  add column if not exists story_text text not null default '';

alter table public.postcard_versions
  add constraint postcard_versions_story_text_length check (char_length(story_text) <= 600);

-- Older admin clients that create a successor version keep its current story.
-- This runs after admin_create_postcard_version clears the old is_current flag.
create or replace function public.inherit_postcard_story_text()
returns trigger language plpgsql set search_path = 'pg_catalog' as $function$
begin
  if new.version_number > 1 and new.story_text = '' then
    select v.story_text into new.story_text
    from public.postcard_versions v
    where v.postcard_key = new.postcard_key and v.version_number = new.version_number - 1;
    new.story_text := coalesce(new.story_text, '');
  end if;
  return new;
end;
$function$;

create trigger postcard_versions_inherit_story
before insert on public.postcard_versions
for each row execute function public.inherit_postcard_story_text();

-- Wrapper calls the existing admin-audited RPC and writes only its newly
-- created version within the same transaction. Sent versions stay immutable.
create or replace function public.admin_add_story_postcard(
  p_key text, p_title text, p_country_code text, p_location text,
  p_collection text, p_postmark_text text, p_footer_text text,
  p_front_image_path text, p_motion_src text default null,
  p_duration_seconds numeric default null, p_reveal_line_alignment text default null,
  p_story_text text default '', p_stage_inactive boolean default false
)
returns uuid language plpgsql security definer set search_path = 'pg_catalog' as $function$
declare v_id uuid; v_story text;
begin
  v_story := trim(both from coalesce(p_story_text, ''));
  if char_length(v_story) > 600 then raise exception 'Story must be 600 characters or fewer.'; end if;
  v_id := public.admin_add_postcard(
    p_key, p_title, p_country_code, p_location, p_collection,
    p_postmark_text, p_footer_text, p_front_image_path, p_motion_src,
    p_duration_seconds, p_reveal_line_alignment
  );
  update public.postcard_versions set story_text = v_story where id = v_id;
  if p_stage_inactive then
    -- Creation and deactivation occur in one transaction: no public reader
    -- can see this card between the two calls. The existing audited RPC
    -- records the deactivation as an ordinary admin action.
    perform public.admin_set_postcard_active(lower(trim(both from p_key)), false);
  end if;
  return v_id;
end;
$function$;

revoke all on function public.admin_add_story_postcard(text,text,text,text,text,text,text,text,text,numeric,text,text,boolean) from public;
grant execute on function public.admin_add_story_postcard(text,text,text,text,text,text,text,text,text,numeric,text,text,boolean) to authenticated;

create or replace function public.admin_create_story_postcard_version(
  p_key text, p_title text, p_location text, p_collection text,
  p_postmark_text text, p_footer_text text, p_front_image_path text,
  p_motion_src text default null, p_duration_seconds numeric default null,
  p_reveal_line_alignment text default null, p_story_text text default ''
)
returns uuid language plpgsql security definer set search_path = 'pg_catalog' as $function$
declare v_id uuid; v_story text;
begin
  v_story := trim(both from coalesce(p_story_text, ''));
  if char_length(v_story) > 600 then raise exception 'Story must be 600 characters or fewer.'; end if;
  v_id := public.admin_create_postcard_version(
    p_key, p_title, p_location, p_collection, p_postmark_text,
    p_footer_text, p_front_image_path, p_motion_src,
    p_duration_seconds, p_reveal_line_alignment
  );
  update public.postcard_versions set story_text = v_story where id = v_id;
  return v_id;
end;
$function$;

revoke all on function public.admin_create_story_postcard_version(text,text,text,text,text,text,text,text,numeric,text,text) from public;
grant execute on function public.admin_create_story_postcard_version(text,text,text,text,text,text,text,text,numeric,text,text) to authenticated;

-- Three reviewed motions exceed the previous 20 MiB per-file cap.
update storage.buckets set file_size_limit = 31457280 where id = 'postcard-artwork';
