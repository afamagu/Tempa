with checks as (
 select
  to_regprocedure('public.correspondent_picker_page(text,integer,integer)') is not null as picker_installed,
  to_regprocedure('public.mark_member_answer_read(uuid)') is not null as reading_installed,
  coalesce((select count(*)=2 and bool_and(not prosecdef) from pg_proc where oid in(to_regprocedure('public.correspondent_picker_page(text,integer,integer)'),to_regprocedure('public.mark_member_answer_read(uuid)'))),false) as member_rls_used,
  coalesce((select count(*)=2 and bool_and(not has_function_privilege('anon',oid,'execute')) from pg_proc where oid in(to_regprocedure('public.correspondent_picker_page(text,integer,integer)'),to_regprocedure('public.mark_member_answer_read(uuid)'))),false) as anonymous_denied,
  coalesce((select count(*)=2 and bool_and(has_function_privilege('authenticated',oid,'execute')) from pg_proc where oid in(to_regprocedure('public.correspondent_picker_page(text,integer,integer)'),to_regprocedure('public.mark_member_answer_read(uuid)'))),false) as member_allowed,
  coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.member_answer_reads')),false) as read_history_rls,
  coalesce((select count(*)=2 and bool_and(coalesce(pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid)) like '%auth.uid()%') from pg_policy where polrelid=to_regclass('public.member_answer_reads') and polname in('member_answer_reads_own','member_answer_reads_insert_own')),false) as own_read_policies,
  coalesce((select not has_table_privilege('anon',oid,'select') from pg_class where oid=to_regclass('public.member_answer_reads')),false) as anonymous_history_denied
)
select case when picker_installed and reading_installed and member_rls_used and anonymous_denied and member_allowed and read_history_rls and own_read_policies and anonymous_history_denied then 'DISCOVERY_READING_READY' else 'DISCOVERY_READING_NOT_READY' end as result,checks.* from checks;
