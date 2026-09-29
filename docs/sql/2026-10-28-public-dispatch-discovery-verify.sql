-- ============================================================
-- TEMPA — PUBLIC DISPATCH DISCOVERY — VERIFIER (READ-ONLY)
-- Pairs with docs/sql/2026-10-28-public-dispatch-discovery.sql.
-- One SELECT; changes nothing. Expect one row with overall_pass = true.
-- ============================================================

with fns(sig) as (
  values
    ('public.list_public_dispatch_previews(integer, text)'),
    ('public.list_related_public_dispatches(text, text[], integer)'),
    ('public.list_public_dispatch_topics()')
),
def as (
  select
    f.sig,
    p.oid,
    p.prosecdef,
    p.proconfig,
    pg_get_functiondef(p.oid) as body,
    pg_get_function_result(p.oid) as result
  from fns f
  left join pg_proc p on p.oid = to_regprocedure(f.sig)
),
checks as (
  select
    not exists (select 1 from def where oid is null) as all_functions_exist,
    not exists (
      select 1 from def
      where not prosecdef or not coalesce(proconfig @> array['search_path=pg_catalog'], false)
    ) as definer_and_search_path_pinned,
    not exists (
      select 1 from def where not has_function_privilege('anon', oid, 'EXECUTE')
    ) as anon_execute_granted,
    not exists (
      select 1 from def where body !~ 'tempa_private\.dispatch_is_web_public\(d\.id\)'
    ) as one_visibility_predicate_everywhere,
    not exists (
      select 1 from def
      where result ~* '\b(dispatch_id|author_id)\b' or result ~* '\bid uuid\b'
    ) as no_internal_ids_returned,
    (select body from def where sig = 'public.list_public_dispatch_previews(integer, text)') ~ 'limit least\(greatest\(coalesce\(p_limit, 24\), 1\), 100\)'
      and (select body from def where sig = 'public.list_related_public_dispatches(text, text[], integer)') ~ 'limit least\(greatest\(coalesce\(p_limit, 4\), 1\), 12\)'
      as limits_clamped,
    (select body from def where sig = 'public.list_related_public_dispatches(text, text[], integer)') ~ 'shared_topic_count'
      and (select body from def where sig = 'public.list_related_public_dispatches(text, text[], integer)') ~ 'unnest\(coalesce\(p_topics'
      as related_is_topic_based,
    (select body from def where sig = 'public.list_public_dispatch_topics()') ~ 'group by lower\(btrim\(t\.topic\)\)'
      as topics_are_case_normalized,
    not has_table_privilege('anon', 'public.dispatches', 'SELECT')
      and not has_table_privilege('authenticated', 'public.dispatches', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.dispatches', 'INSERT')
      and not has_table_privilege('authenticated', 'public.dispatches', 'DELETE')
      as base_table_stays_closed
)
select *,
  (all_functions_exist and definer_and_search_path_pinned and anon_execute_granted
   and one_visibility_predicate_everywhere and no_internal_ids_returned and limits_clamped
   and related_is_topic_based and topics_are_case_normalized and base_table_stays_closed) as overall_pass
from checks;
