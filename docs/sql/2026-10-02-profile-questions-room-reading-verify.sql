with functions as (
 select oid,proname,prosecdef,pg_get_functiondef(oid) as definition
 from pg_proc where oid in (
  to_regprocedure('public.room_reading_allowed()'),
  to_regprocedure('public.room_question_published(uuid)'),
  to_regprocedure('public.room_read_question_answers(uuid,timestamptz,uuid,integer,text,text,text)'),
  to_regprocedure('public.room_question_library(text,integer,integer,date,date)')
 )
), checks as (
 select
  (select count(*)=4 from functions) as functions_installed,
  coalesce((select bool_and(not has_function_privilege('anon',oid,'execute')) from functions),false) as anonymous_denied,
  coalesce((select bool_and(has_function_privilege('authenticated',oid,'execute')) from functions),false) as member_allowed,
  coalesce((select not prosecdef from functions where proname='room_read_question_answers'),false) as reading_uses_member_rls,
  exists(select 1 from pg_trigger where tgrelid='public.member_questions'::regclass and tgname='member_question_profile_limit' and tgenabled='O') as profile_limit_installed,
  not exists(select 1 from public.member_questions where is_profile_visible and withdrawn_at is null and moderation_status='visible' group by author_id having count(*)>3) as three_question_limit_verified,
  exists(select 1 from pg_policies where schemaname='public' and tablename='question_answers' and policyname='room_published_answer_read') as published_answer_policy_installed,
  coalesce((select definition like '%room_question_made_current%' from functions where proname='room_question_published'),false) as unpublished_drafts_protected,
  coalesce((select definition like '%min(a.created_at)%' from functions where proname='room_question_library'),false) as actual_publication_dates_used,
  not has_table_privilege('authenticated','public.member_questions','insert') as direct_question_inserts_denied,
  not has_table_privilege('anon','public.member_questions','select') as anonymous_history_denied,
  (select count(*)=2 and bool_and(relrowsecurity) from pg_class where oid in ('public.member_questions'::regclass,'public.question_answers'::regclass)) as member_rls_retained,
  exists(select 1 from private.room_invitation_email_config where singleton and not sending_enabled) as email_sending_disabled
)
select case when functions_installed and anonymous_denied and member_allowed and reading_uses_member_rls
 and profile_limit_installed and three_question_limit_verified and published_answer_policy_installed
 and unpublished_drafts_protected and actual_publication_dates_used and direct_question_inserts_denied
 and anonymous_history_denied and member_rls_retained and email_sending_disabled
 then 'PROFILE_QUESTIONS_ROOM_READY' else 'PROFILE_QUESTIONS_ROOM_NOT_READY' end as result,checks.* from checks;
