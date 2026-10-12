-- Remove only email invitation admission; normal authentication and eligibility remain.
create or replace function public.current_pilot_access()
returns boolean language sql stable security invoker
set search_path='pg_catalog'
as $function$ select auth.uid() is not null; $function$;
revoke all on function public.current_pilot_access() from public,anon;
grant execute on function public.current_pilot_access() to authenticated;

