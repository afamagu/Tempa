-- ============================================================
-- TEMPA — PUBLIC DISPATCH DEFAULT-ON + MARK — VERIFIER (READ-ONLY)
-- Pairs with 2026-10-29-public-dispatch-default-on-and-mark.sql.
-- Expect one row with overall_pass = true.
-- ============================================================

with fns as (
  select
    to_regprocedure('public.publish_dispatch_with_web_visibility(text,text,uuid,text[],jsonb,jsonb,boolean,boolean)') as publish_oid,
    to_regprocedure('public.get_public_dispatch_mark(text)') as mark_oid
), defs as (
  select
    f.*,
    case when publish_oid is null then null else pg_get_functiondef(publish_oid) end as publish_def,
    case when mark_oid is null then null else pg_get_functiondef(mark_oid) end as mark_def
  from fns f
), checks as (
  select
    publish_oid is not null and mark_oid is not null as functions_exist,

    -- p_web_public is the eighth argument; its declared default must be true.
    publish_def ~ 'p_web_public boolean DEFAULT true' as member_publish_defaults_public,

    -- Keep the table itself fail-closed. We changed only the explicit
    -- publish wrapper's default, never the base-table default.
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'dispatches'
        and column_name = 'web_public'
        and column_default = 'false'
    ) as base_table_still_defaults_private,

    -- Public Mark lookup is a hardened SECURITY DEFINER function using
    -- the same visibility gate as the article itself.
    (select p.prosecdef from pg_proc p where p.oid = mark_oid)
      and coalesce((select p.proconfig @> array['search_path=pg_catalog'] from pg_proc p where p.oid = mark_oid), false)
      and mark_def ~ 'dispatch_is_web_public'
      and mark_def ~ 'published_as = ''member'''
      as mark_lookup_hardened_and_gated,

    -- The function returns one UUID only. It must never return a profile,
    -- author id, email, or source-photo field as part of its public shape.
    (select pg_get_function_result(mark_oid)) = 'uuid'
      and mark_def !~ 'returns table'
      as mark_shape_is_opaque_uuid_only,

    has_function_privilege('anon', mark_oid, 'EXECUTE')
      and has_function_privilege('authenticated', mark_oid, 'EXECUTE')
      and not has_function_privilege('anon', publish_oid, 'EXECUTE')
      and has_function_privilege('authenticated', publish_oid, 'EXECUTE')
      as execute_privileges_correct,

    -- Your Mark production prerequisite: the opaque pointer exists, while
    -- the private ownership registry stays unreadable to anonymous users.
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = 'mark_id'
    )
      and not has_table_privilege('anon', 'public.profile_marks', 'SELECT')
      as mark_privacy_prerequisite_intact
  from defs
)
select *,
  (functions_exist
   and member_publish_defaults_public
   and base_table_still_defaults_private
   and mark_lookup_hardened_and_gated
   and mark_shape_is_opaque_uuid_only
   and execute_privileges_correct
   and mark_privacy_prerequisite_intact) as overall_pass
from checks;
