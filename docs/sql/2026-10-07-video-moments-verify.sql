-- Tempa — Video Moments verification. Every boolean should be true.
select
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='moments' and column_name='trim_start_seconds') as trim_start_installed,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='moments' and column_name='duration_seconds') as duration_installed,
  pg_get_constraintdef(oid) ilike '%video%' as type_accepts_video
from pg_constraint where conname='moments_type_check';

select
  pg_get_functiondef('public.write_letter(uuid,text,uuid,uuid,jsonb,jsonb,boolean)'::regprocedure) ilike '%Invalid video Moment window%' as write_letter_validates_video,
  pg_get_functiondef('public.reply_to_letter(uuid,text,uuid,jsonb,jsonb,boolean)'::regprocedure) ilike '%Invalid video Moment window%' as reply_validates_video;
