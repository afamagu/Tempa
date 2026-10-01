-- READ-ONLY production verifier. Run after both 2026-10-01 migrations.
select
  to_regprocedure('public.discover_profiles(text,text,text,text,text,text,uuid[],integer)') is not null as discover_installed,
  to_regprocedure('public.correspondent_picker(text,integer)') is not null as picker_installed,
  to_regprocedure('public.create_room_invitations(uuid,uuid[])') is not null as invitations_installed,
  not has_function_privilege('anon','public.discover_profiles(text,text,text,text,text,text,uuid[],integer)','execute') as anonymous_discovery_denied,
  not has_function_privilege('anon','public.correspondent_picker(text,integer)','execute') as anonymous_picker_denied,
  not has_function_privilege('authenticated','public.claim_room_invitation_emails(integer)','execute') as member_worker_denied,
  not has_function_privilege('authenticated','public.freeze_room_invitation_email(uuid,uuid,jsonb)','execute') as member_payload_denied,
  not has_table_privilege('authenticated','public.room_invitations','insert') as direct_invites_denied,
  not has_table_privilege('authenticated','private.room_invitation_email_jobs','select') as private_queue_denied;

select relname, relrowsecurity from pg_class where oid in (
  'public.room_answer_mentions'::regclass, 'public.room_invitations'::regclass,
  'public.room_invitation_preferences'::regclass, 'private.room_invitation_email_jobs'::regclass
);
select tablename, policyname, qual from pg_policies where tablename in('room_answer_mentions','room_invitation_preferences');
select status,count(*) from private.room_invitation_email_jobs group by status;
select sending_enabled from private.room_invitation_email_config where singleton;
-- Sending must remain false until a staged, consented test confirms the queue,
-- From address, scheduler and preferences. Enabling is a separate operation.
