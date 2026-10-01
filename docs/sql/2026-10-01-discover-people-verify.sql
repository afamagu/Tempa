with checks as (
  select
    to_regprocedure('public.discover_profile_people(text,text,text,text,text,text,text,uuid[],text,boolean,integer,uuid)') is not null as installed,
    not has_function_privilege('anon','public.discover_profile_people(text,text,text,text,text,text,text,uuid[],text,boolean,integer,uuid)','execute') as anonymous_denied,
    has_function_privilege('authenticated','public.discover_profile_people(text,text,text,text,text,text,text,uuid[],text,boolean,integer,uuid)','execute') as member_allowed,
    exists(select 1 from pg_class where oid='public.profile_interests'::regclass and relrowsecurity) as interest_rls_preserved,
    exists(select 1 from private.room_invitation_email_config where singleton and not sending_enabled) as email_sending_disabled
)
select case when installed and anonymous_denied and member_allowed and interest_rls_preserved and email_sending_disabled
  then 'DISCOVER_PEOPLE_VERIFIED' else 'DISCOVER_PEOPLE_NOT_VERIFIED' end as result, checks.* from checks;
