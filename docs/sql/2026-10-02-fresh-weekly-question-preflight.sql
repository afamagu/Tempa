-- Read-only. Confirm live identity/history before approving the migration.
select q.id,q.prompt,q.is_active,q.is_flagship,q.current_position,q.created_at,
 count(a.id) as answer_count,min(a.created_at) as earliest_answer,
 max(a.created_at) as latest_answer
from public.questions q left join public.question_answers a on a.question_id=q.id
where q.current_position is not null or q.prompt ilike '%when no%watch%'
group by q.id order by q.current_position nulls last,q.created_at;

select q.id as question_id,q.prompt,a.id as answer_id,a.created_at,a.updated_at,a.body
from public.question_answers a join public.questions q on q.id=a.question_id
join public.profiles p on p.id=a.user_id
where p.pseudonym='Evening Quill' and q.prompt ilike '%when no%watch%';

select p.oid::regprocedure::text as signature,pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
 ('send_first_letter','can_evaluate_safety_context','admin_make_current_room_question','room_question_published');
