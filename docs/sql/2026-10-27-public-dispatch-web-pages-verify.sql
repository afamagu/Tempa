-- ============================================================
-- TEMPA — PUBLIC DISPATCH WEB PAGES — VERIFIER (READ-ONLY)
-- Pairs with docs/sql/2026-10-27-public-dispatch-web-pages.sql.
-- One SELECT; changes nothing. Expect one row with overall_pass = true.
-- ============================================================

with fns(sig, exposure) as (
  values
    ('public.get_public_dispatch(text)', 'anon'),
    ('public.list_public_dispatches()', 'anon'),
    ('public.set_dispatch_web_public(uuid, boolean)', 'member'),
    ('public.dispatch_photo_is_externally_shared(text)', 'anon'),
    ('tempa_private.dispatch_is_web_public(uuid)', 'private'),
    ('tempa_private.dispatch_web_lifecycle()', 'private'),
    ('tempa_private.dispatch_slugify(text)', 'private')
),
def as (
  select f.sig, f.exposure, p.oid, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) as body
  from fns f left join pg_proc p on p.oid = to_regprocedure(f.sig)
),
checks as (
  select
    not exists (select 1 from def where oid is null) as all_functions_exist,
    not exists (select 1 from def where sig <> 'tempa_private.dispatch_slugify(text)'
                and (not prosecdef or not coalesce(proconfig @> array['search_path=pg_catalog'], false)))
      and exists (select 1 from def where sig = 'tempa_private.dispatch_slugify(text)' and not prosecdef
                  and coalesce(proconfig @> array['search_path=pg_catalog'], false))
      as definer_and_search_path_pinned,
    not exists (select 1 from def where exposure = 'anon' and not has_function_privilege('anon', oid, 'EXECUTE'))
      and not exists (select 1 from def where exposure = 'member'
                      and (has_function_privilege('anon', oid, 'EXECUTE') or not has_function_privilege('authenticated', oid, 'EXECUTE')))
      and not exists (select 1 from def where exposure = 'private'
                      and (has_function_privilege('anon', oid, 'EXECUTE') or has_function_privilege('authenticated', oid, 'EXECUTE')))
      as execute_privileges_correct,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'dispatches' and column_name = 'web_public')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'dispatches' and column_name = 'web_slug')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'dispatches' and column_name = 'content_updated_at')
      and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'dispatches_web_slug_key')
      as columns_and_unique_slug,
    -- the base table stays closed: anon reads nothing, members cannot write
    not has_table_privilege('anon', 'public.dispatches', 'SELECT')
      and not has_table_privilege('authenticated', 'public.dispatches', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.dispatches', 'INSERT')
      and not has_table_privilege('authenticated', 'public.dispatches', 'DELETE')
      as base_table_closed,
    -- every open-web read applies the one predicate, which carries every gate
    (select body from def where sig = 'tempa_private.dispatch_is_web_public(uuid)') ~ 'd\.web_public'
      and (select body from def where sig = 'tempa_private.dispatch_is_web_public(uuid)') ~ 'd\.status = ''published'''
      and (select body from def where sig = 'tempa_private.dispatch_is_web_public(uuid)') ~ 'd\.moderation_status = ''visible'''
      and (select body from def where sig = 'tempa_private.dispatch_is_web_public(uuid)') ~ 'author_content_publicly_visible'
      and (select body from def where sig = 'public.get_public_dispatch(text)') ~ 'dispatch_is_web_public'
      and (select body from def where sig = 'public.list_public_dispatches()') ~ 'dispatch_is_web_public'
      and (select body from def where sig = 'public.dispatch_photo_is_externally_shared(text)') ~ 'dispatch_is_web_public'
      as one_predicate_everywhere,
    -- the public read never returns the internal id or the author id
    (select body from def where sig = 'public.get_public_dispatch(text)') !~ 'returns table \([^)]*\b(dispatch_id|author_id)\b'
      as no_internal_ids_exposed,
    -- slugs are permanent once assigned
    (select body from def where sig = 'tempa_private.dispatch_web_lifecycle()') ~ 'web address is permanent'
      as slug_permanent,
    exists (select 1 from pg_trigger t where t.tgrelid = 'public.dispatches'::regclass and t.tgname = 'dispatches_web_lifecycle' and not t.tgisinternal)
      as lifecycle_trigger_installed,
    -- no member Dispatch was made public by the migration; every public one has a slug
    not exists (select 1 from public.dispatches where web_public and web_slug is null) as every_public_dispatch_has_slug,
    not exists (select 1 from public.dispatches where published_as <> 'member' and not web_public) as official_public_by_default
)
select *,
  (all_functions_exist and definer_and_search_path_pinned and execute_privileges_correct and columns_and_unique_slug
   and base_table_closed and one_predicate_everywhere and no_internal_ids_exposed and slug_permanent
   and lifecycle_trigger_installed and every_public_dispatch_has_slug) as overall_pass
from checks;
