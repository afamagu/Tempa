-- Read-only, after migration. All readiness values should be true.
select to_regprocedure('public.admin_start_room_question(uuid,boolean)') is not null as fresh_week_ready,
 to_regprocedure('public.room_answer_can_start_letter(uuid,uuid)') is not null as room_reply_ready,
 position('public.room_answer_can_start_letter(qa.id, qa.user_id)' in pg_get_functiondef(to_regprocedure('public.send_first_letter(uuid,uuid,text,uuid,boolean)')))>0 as sender_ready,
 position('public.room_answer_can_start_letter(qa.id, qa.user_id)' in pg_get_functiondef(to_regprocedure('public.can_evaluate_safety_context(text,uuid,uuid,uuid,jsonb)')))>0 as safety_context_ready,
 not has_function_privilege('anon','public.admin_start_room_question(uuid,boolean)','EXECUTE') as anon_cannot_restart;
-- Inspect after the explicit admin action to start the fresh weekly question.
select q.id,q.prompt,q.is_flagship,q.current_position,count(a.id) as answers
from public.questions q left join public.question_answers a on a.question_id=q.id
where q.current_position is not null or q.prompt ilike '%when no%watch%'
group by q.id order by q.current_position nulls last,q.id;
