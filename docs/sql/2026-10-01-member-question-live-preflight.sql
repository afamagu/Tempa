-- Read-only function/schema definitions. No member messages or rows returned.
select jsonb_pretty(jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and p.proname in('send_first_letter','write_letter','write_letter_once','can_evaluate_safety_context','admin_create_question','admin_make_current_room_question')) or (n.nspname='tempa_private' and p.proname='consume_safety_evaluation')),
 'columns',(select jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'type',data_type,'nullable',is_nullable,'default',column_default) order by table_name,ordinal_position) from information_schema.columns where table_schema='public' and table_name in('letters','questions','room_question_suggestions')),
 'letter_constraints',(select jsonb_agg(pg_get_constraintdef(oid)) from pg_constraint where conrelid='public.letters'::regclass)
)) as member_question_preflight;
