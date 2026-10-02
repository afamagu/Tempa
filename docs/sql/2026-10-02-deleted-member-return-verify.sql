with functions as (
 select oid,proname,pg_get_functiondef(oid) as definition from pg_proc
 where oid in (to_regprocedure('public.account_auth_state(uuid)'),
 to_regprocedure('public.account_auth_state_for_email_link(text)'),
 to_regprocedure('public.closed_account_auth_repair_candidates(uuid)'))
), checks as (
 select (select count(*)=3 from functions) as functions_installed,
 coalesce((select bool_and(not has_function_privilege('anon',oid,'execute')
 and not has_function_privilege('authenticated',oid,'execute')
 and has_function_privilege('service_role',oid,'execute')) from functions),false) as service_only,
 coalesce((select definition not like '%deleted_suspended%'
 and definition like '%permanently_banned%' from functions where proname='account_auth_state'),false) as only_admin_bans_prevent_return,
 coalesce((select definition like '%u.deleted_at IS NULL%'
 or definition like '%u.deleted_at is null%' from functions where proname='closed_account_auth_repair_candidates'),false) as retired_accounts_excluded,
 has_column_privilege('service_role','public.account_closures','user_id','select')
 and has_column_privilege('service_role','public.account_closures','auth_disabled_at','update')
 and has_column_privilege('service_role','public.account_closures','storage_cleaned_at','update')
 and has_column_privilege('service_role','public.account_closures','last_error','update') as progress_recording_allowed,
 not has_table_privilege('authenticated','public.account_closures','select')
 and not has_table_privilege('anon','public.account_closures','select') as private_closures_retained
)
select case when functions_installed and service_only and only_admin_bans_prevent_return
 and retired_accounts_excluded and progress_recording_allowed and private_closures_retained
 then 'DELETED_MEMBER_RETURN_READY' else 'DELETED_MEMBER_RETURN_NOT_READY' end as result,checks.* from checks;
