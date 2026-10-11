-- Read-only verifier for room-letter migration (no member writes).
-- Execute on a staging clone AFTER reviewing/applying the companion SQL.
-- Failures return explicit identifiers: audit manually before release.
select conname, pg_get_constraintdef(oid) AS definition
from pg_constraint where conrelid='public.safety_evaluations'::regclass
and conname in (
  'safety_evaluations_surface_check',
  'safety_evaluations_question_answer_id_matches_surface',
  'safety_evaluations_secondary_context_id_only_for_dispatch_reply'
) order by conname;

select p.proname,pg_get_function_identity_arguments(p.oid) args,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_exec,
       has_function_privilege('anon',p.oid,'EXECUTE') as anonymous_exec
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where (n.nspname='public' and p.proname in ('send_first_letter','send_first_letter_from_room_letter'))
   or (n.nspname='tempa_private' and p.proname='send_first_letter_core')
order by n.nspname,p.proname;

select n.nspname,p.proname,
  position('first_letter_from_room_letter' in pg_get_functiondef(p.oid))>0 as recognizes_new_source
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where (n.nspname='public' and p.proname in ('can_evaluate_safety_context','record_safety_evaluation'))
   or (n.nspname='tempa_private' and p.proname in ('consume_safety_evaluation','evaluate_behavior','safety_target_key'))
order by n.nspname,p.proname;

-- Data retention: historical question-backed attempts and source-linked
-- letters must both count, but ordinary write-anytime roots must not.
select count(*) filter(where question_answer_id is not null) as historic_question_origins,
count(*) filter(where question_answer_id is null and exists
    (select 1 from public.dispatch_letter_contexts src where src.letter_id=l.id)) as room_origins,
count(*) filter(where question_answer_id is null and not exists
    (select 1 from public.dispatch_letter_contexts src where src.letter_id=l.id)) as unlinked_roots
from public.letters l where reply_to_id is null;
