-- Open Tempa registration to every authenticated member.
-- Keep independent language, age, legal, ban, profile and required-Mark gates.
-- Do not delete historical invitation/member records or change RLS.
CREATE OR REPLACE FUNCTION public.current_pilot_access()
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT auth.uid() IS NOT NULL;
$function$;
REVOKE ALL ON FUNCTION public.current_pilot_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_pilot_access() TO authenticated;
