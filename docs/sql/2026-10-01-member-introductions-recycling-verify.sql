-- Read-only: checks the original introduction feature's existing foundation.
with functions as (
  select
    to_regprocedure('public.get_member_introductions(integer)')::oid as get_fn,
    to_regprocedure('public.mark_member_introduction_presented(uuid)')::oid as presented_fn,
    to_regprocedure('public.consume_member_introduction(uuid,text)')::oid as consumed_fn,
    to_regprocedure('tempa_private.member_introduction_newcomer_ids()')::oid as newcomer_fn
), checks as (
  select
    get_fn is not null and presented_fn is not null
      and consumed_fn is not null and newcomer_fn is not null as functions_installed,
    (
      select count(*) = 2 and bool_and(relrowsecurity)
      from pg_class
      where oid in (
        to_regclass('public.member_introduction_state'),
        to_regclass('public.member_introduction_history')
      )
    ) as history_rls_enabled,
    coalesce((
      select count(*) = 4 and bool_and(not has_function_privilege('anon', p.oid, 'execute'))
      from pg_proc p
      where p.oid in (get_fn, presented_fn, consumed_fn, newcomer_fn)
    ), false) as anonymous_denied,
    coalesce((
      select count(*) = 4 and bool_and(has_function_privilege('authenticated', p.oid, 'execute'))
      from pg_proc p
      where p.oid in (get_fn, presented_fn, consumed_fn, newcomer_fn)
    ), false) as member_allowed,
    coalesce((
      select count(*) = 2 and bool_and(not has_table_privilege('anon', c.oid, 'select'))
      from pg_class c where c.oid in (to_regclass('public.member_introduction_state'), to_regclass('public.member_introduction_history'))
    ), false) as anonymous_history_denied,
    coalesce((select not prosecdef from pg_proc where oid = get_fn), false) as retrieval_uses_member_rls,
    coalesce((
      select pg_get_functiondef(p.oid) ilike '%s.viewer_id = auth.uid()%'
      from pg_proc p where p.oid = newcomer_fn
    ), false) as newcomer_helper_self_scoped,
    coalesce((select pg_get_functiondef(get_fn) like '%interval ''7 days''%' and pg_get_functiondef(get_fn) like '%random() as sort_key%' and pg_get_functiondef(get_fn) like '%c.user_id = p.id%' and pg_get_functiondef(get_fn) not like '%h.consumed_at is null%'),false) as recycling_installed,
    coalesce((select pg_get_functiondef(presented_fn) not like '%where h.consumed_at is null%' and pg_get_functiondef(consumed_fn) not like '%where h.consumed_at is null%'),false) as encounters_repeatable
  from functions
)
select case when functions_installed and history_rls_enabled and anonymous_denied
  and member_allowed and anonymous_history_denied and retrieval_uses_member_rls and newcomer_helper_self_scoped and recycling_installed and encounters_repeatable
then 'INTRODUCTION_RECYCLING_VERIFIED' else 'INTRODUCTION_RECYCLING_NOT_VERIFIED' end as result,
checks.* from checks;
