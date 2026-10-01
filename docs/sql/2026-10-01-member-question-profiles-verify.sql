with required(signature,member_callable) as (
 values
 ('public.member_question_author_visible(uuid)',true),
 ('public.publish_member_question_trusted(uuid,text,boolean,jsonb,boolean,uuid)',false),
 ('public.manage_member_question(uuid,text,boolean)',true),
 ('public.member_question_credit_requested(uuid)',true),
 ('public.member_question_selected(uuid)',true),
 ('public.profile_member_questions(uuid,integer,integer)',true),
 ('public.my_unpublished_question_suggestions()',true),
 ('public.admin_member_question_details()',true),
 ('public.admin_review_member_question(uuid,text)',true),
 ('public.admin_select_member_question(uuid,text)',true),
 ('public.room_question_credit(uuid)',true),
 ('public.send_first_letter_from_member_question(uuid,uuid,uuid,text,uuid,boolean)',true),
 ('public.write_letter_from_member_question_once(uuid,uuid,uuid,text,uuid,uuid,jsonb,jsonb,boolean)',true)
), functions as (
 select r.*,p.oid,p.prosecdef,pg_get_functiondef(p.oid) as definition
 from required r left join pg_proc p on p.oid=to_regprocedure(r.signature)
), checks as (
 select
  (select count(oid)=13 from functions) as functions_installed,
  (select bool_and(not has_function_privilege('anon',oid,'execute')) from functions) as anonymous_denied,
  (select bool_and(has_function_privilege('authenticated',oid,'execute')) from functions where member_callable) as member_allowed,
  (select not has_function_privilege('authenticated',oid,'execute') and has_function_privilege('service_role',oid,'execute') from functions where not member_callable) as trusted_publication_only,
  (select not prosecdef from functions where signature='public.profile_member_questions(uuid,integer,integer)') as profile_uses_member_rls,
  (select count(*)=4 and bool_and(relrowsecurity) from pg_class where oid in(
   to_regclass('public.member_questions'),to_regclass('public.member_question_letter_contexts'),
   to_regclass('private.member_question_publication_audit'),to_regclass('private.room_question_attribution')
  )) as private_rows_protected,
  not has_table_privilege('authenticated','public.member_questions','insert')
   and not has_table_privilege('authenticated','public.member_questions','update')
   and not has_table_privilege('authenticated','public.member_question_letter_contexts','insert') as direct_writes_denied,
  not has_table_privilege('authenticated','private.member_question_publication_audit','select')
   and not has_table_privilege('authenticated','private.room_question_attribution','select') as private_metadata_denied,
  (select bool_and(definition like '%public.is_staff(''admin'')%') from functions where signature in('public.admin_member_question_details()','public.admin_review_member_question(uuid,text)','public.admin_select_member_question(uuid,text)')) as admin_gates_installed,
  (select definition like '%public.send_first_letter(p_recipient_id,p_question_answer_id,p_body,p_safety_evaluation_id,p_warning_acknowledged)%' from functions where signature='public.send_first_letter_from_member_question(uuid,uuid,uuid,text,uuid,boolean)')
   and (select definition like '%public.write_letter_once(p_client_submission_id,p_correspondence_id,p_body,p_safety_evaluation_id,p_reply_to_id,p_moments,p_postcard,p_warning_acknowledged)%' from functions where signature='public.write_letter_from_member_question_once(uuid,uuid,uuid,text,uuid,uuid,jsonb,jsonb,boolean)') as existing_send_checks_retained,
  exists(select 1 from private.room_invitation_email_config where singleton and not sending_enabled) as email_sending_disabled
)
select case when functions_installed and anonymous_denied and member_allowed
 and trusted_publication_only and profile_uses_member_rls and private_rows_protected
 and direct_writes_denied and private_metadata_denied and admin_gates_installed
 and existing_send_checks_retained and email_sending_disabled
 then 'MEMBER_QUESTIONS_READY' else 'MEMBER_QUESTIONS_NOT_READY' end as result,
 checks.* from checks;
