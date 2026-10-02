with checks as (
  select
    not exists (
      select 1 from pg_constraint
      where conrelid = 'public.dispatch_moments'::regclass
        and conname = 'dispatch_moments_unique_gap'
    ) as passage_limit_removed,
    exists (
      select 1 from pg_attribute
      where attrelid = 'public.dispatch_moments'::regclass
        and attname = 'attachment_order' and attidentity = 'a'
        and attnotnull and not attisdropped
    ) as attachment_order_installed,
    exists (
      select 1 from pg_index
      where indexrelid = to_regclass('public.dispatch_moments_passage_order')
        and indisvalid and not indisunique
    ) as ordered_index_installed,
    (select relrowsecurity from pg_class
      where oid = 'public.dispatch_moments'::regclass) as moment_rls_retained,
    not has_table_privilege('authenticated', 'public.dispatch_moments', 'insert')
      and not has_table_privilege('anon', 'public.dispatch_moments', 'insert')
      as direct_inserts_denied,
    exists (
      select 1 from pg_constraint where conrelid = 'public.dispatch_moments'::regclass
        and conname = 'dispatch_moments_position_nonnegative' and convalidated
    ) as valid_position_check_retained,
    coalesce((select count(*) = 2 and bool_and(
      pg_get_functiondef(p.oid) ~* 'order\s+by\s+dm\.position\s*,\s*dm\.attachment_order'
    ) from pg_proc p where p.oid in (
      to_regprocedure('public.get_shared_dispatch(uuid)'),
      to_regprocedure('public.get_public_dispatch(text)')
    )), false) as public_readers_ordered
)
select case when passage_limit_removed and attachment_order_installed
  and ordered_index_installed and moment_rls_retained and direct_inserts_denied
  and valid_position_check_retained and public_readers_ordered
  then 'MULTIPLE_DISPATCH_MOMENTS_READY'
  else 'MULTIPLE_DISPATCH_MOMENTS_NOT_READY' end as result,
  checks.*
from checks;
