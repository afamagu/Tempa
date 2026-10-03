with worker as (
 select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in ('claim_mention_emails','prepare_mention_email','freeze_mention_email','complete_mention_email')
), members as (
 select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in ('set_mention_email_preference','admin_get_mention_email_status','set_mention_email_sending_enabled')
), checks as (
 select
 (select count(*)=4 from worker) and (select count(*)=3 from members) as functions_installed,
 coalesce((select count(*)=4 and bool_and(not has_function_privilege('anon',oid,'execute') and not has_function_privilege('authenticated',oid,'execute') and has_function_privilege('service_role',oid,'execute')) from worker),false) as worker_service_only,
 coalesce((select count(*)=3 and bool_and(not has_function_privilege('anon',oid,'execute') and has_function_privilege('authenticated',oid,'execute')) from members),false) as member_rpc_permissions,
 (select count(*)=3 and bool_and(relrowsecurity) from pg_class where oid in(to_regclass('public.mention_email_preferences'),to_regclass('private.mention_email_config'),to_regclass('private.mention_email_jobs'))) as private_rows_protected,
 not has_table_privilege('authenticated','private.mention_email_jobs','select') and not has_table_privilege('authenticated','private.mention_email_jobs','insert') as queue_private,
 exists(select 1 from pg_policies where schemaname='public' and tablename='mention_email_preferences' and policyname='mention_email_preference_owner' and qual like '%auth.uid()%') as preferences_self_scoped,
 exists(select 1 from pg_trigger where tgrelid='public.public_mentions'::regclass and tgname='enqueue_public_mention_email' and tgenabled='O') as new_mention_trigger,
 exists(select 1 from private.mention_email_config where singleton and not sending_enabled and enabled_since is null) as sending_disabled
)
select case when functions_installed and worker_service_only and member_rpc_permissions and private_rows_protected
 and queue_private and preferences_self_scoped and new_mention_trigger and sending_disabled
 then 'MENTION_EMAILS_READY' else 'MENTION_EMAILS_NOT_READY' end as result,checks.* from checks;
