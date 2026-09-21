-- Read-only checks after applying 2026-09-23-postcard-stories-we-carry.sql.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'postcard_versions' and column_name = 'story_text';

select id, file_size_limit, allowed_mime_types
from storage.buckets where id = 'postcard-artwork';

select proname, pg_get_function_identity_arguments(oid) as arguments
from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('admin_add_story_postcard', 'admin_create_story_postcard_version')
order by proname;

select tgname, tgenabled from pg_trigger
where tgrelid = 'public.postcard_versions'::regclass
  and tgname = 'postcard_versions_inherit_story';
