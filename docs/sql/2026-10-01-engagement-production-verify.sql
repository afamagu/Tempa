-- Read-only. Run after the complete engagement production pack.
with checks as (
  select
    exists(select 1 from pg_constraint where conrelid = 'public.dispatches'::regclass
      and conname = 'dispatches_body_visible_length' and convalidated
      and pg_get_constraintdef(oid) = 'CHECK ((dispatch_visible_length(body) <= 200000))') as dispatch_body_ceiling_updated,
    to_regprocedure('public.discover_profiles(text,text,text,text,text,text,uuid[],integer)') is not null as discover_installed,
    to_regprocedure('public.correspondent_picker(text,integer)') is not null as picker_installed,
    to_regprocedure('public.create_room_invitations(uuid,uuid[])') is not null as invitations_installed,
    not has_function_privilege('anon','public.discover_profiles(text,text,text,text,text,text,uuid[],integer)','execute') as anonymous_discovery_denied,
    not has_function_privilege('anon','public.correspondent_picker(text,integer)','execute') as anonymous_picker_denied,
    not has_function_privilege('authenticated','public.claim_room_invitation_emails(integer)','execute') as member_worker_denied,
    not has_function_privilege('authenticated','public.freeze_room_invitation_email(uuid,uuid,jsonb)','execute') as member_payload_denied,
    not has_table_privilege('authenticated','public.room_invitations','insert') as direct_invites_denied,
    not has_table_privilege('authenticated','private.room_invitation_email_jobs','select') as private_queue_denied,
    (select count(*) = 4 and bool_and(relrowsecurity) from pg_class where oid in (
      'public.room_answer_mentions'::regclass, 'public.room_invitations'::regclass,
      'public.room_invitation_preferences'::regclass, 'private.room_invitation_email_jobs'::regclass
    )) as private_rows_protected,
    exists(select 1 from private.room_invitation_email_config where singleton and not sending_enabled) as email_sending_disabled
)
select case when dispatch_body_ceiling_updated and discover_installed and picker_installed and invitations_installed
  and anonymous_discovery_denied and anonymous_picker_denied and member_worker_denied
  and member_payload_denied and direct_invites_denied and private_queue_denied
  and private_rows_protected and email_sending_disabled
  then 'ENGAGEMENT_RECONCILIATION_VERIFIED'
  else 'ENGAGEMENT_RECONCILIATION_NOT_VERIFIED'
end as result, checks.* from checks;
