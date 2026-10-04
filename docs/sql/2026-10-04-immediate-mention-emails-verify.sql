with checks as (
 select
 to_regprocedure('public.claim_immediate_mention_emails(uuid)') is not null as immediate_worker_installed,
 not has_function_privilege('anon','public.claim_immediate_mention_emails(uuid)','execute')
 and not has_function_privilege('authenticated','public.claim_immediate_mention_emails(uuid)','execute')
 and has_function_privilege('service_role','public.claim_immediate_mention_emails(uuid)','execute') as worker_service_only,
 exists(select 1 from information_schema.columns where table_schema='private' and table_name='mention_email_jobs' and column_name='next_attempt_at' and column_default='now()') as delay_removed,
 position('mention_email_skip_reason' in pg_get_functiondef('public.prepare_mention_email(uuid,uuid,text,text)'::regprocedure))>0
 and position('mention_email_skip_reason' in pg_get_functiondef('public.freeze_mention_email(uuid,uuid,jsonb)'::regprocedure))>0 as specific_skip_reasons,
 position('provider_message_id' in pg_get_functiondef('public.admin_get_mention_email_status()'::regprocedure))>0 as provider_reference_visible,
 (select bool_and(relrowsecurity) from pg_class where oid in('private.mention_email_jobs'::regclass,'public.mention_email_preferences'::regclass)) as rls_retained,
 not has_table_privilege('authenticated','private.mention_email_jobs','select') as queue_private
)
select case when immediate_worker_installed and worker_service_only and delay_removed and specific_skip_reasons and provider_reference_visible and rls_retained and queue_private
then 'IMMEDIATE_MENTION_EMAILS_READY' else 'IMMEDIATE_MENTION_EMAILS_NOT_READY' end as result,checks.* from checks;
