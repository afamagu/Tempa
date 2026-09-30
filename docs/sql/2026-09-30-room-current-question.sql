-- TEMPA — CURRENT ROOM QUESTION EDITORIAL ACTION
-- STATUS: NOT EXECUTED IN PRODUCTION
-- Forward-only migration. Historical Question rows/answers are never rewritten.

begin;

create or replace function public.admin_make_current_room_question(p_question_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_prompt text;
  v_active boolean;
  v_flagship boolean;
  v_target_position smallint;
  v_actor_pseudonym text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;
  if not public.is_staff('admin') then
    raise exception 'Not authorized.';
  end if;

  select q.prompt, q.is_active, q.is_flagship
    into v_prompt, v_active, v_flagship
  from public.questions q
  where q.id = p_question_id
  for update;

  if v_prompt is null then
    raise exception 'Question not found.';
  end if;
  if not v_active then
    raise exception 'Only an active Question can be made current in The Room.';
  end if;
  if v_flagship then
    raise exception 'The First Question cannot also be the current Room Question.';
  end if;

  -- Preserve the Flagship wherever it currently sits. The Room uses exactly
  -- one positioned non-Flagship Question; historical non-Flagship Questions
  -- simply become unpositioned, with their answers untouched.
  update public.questions
  set current_position = null
  where is_flagship = false
    and id <> p_question_id
    and current_position is not null;

  select gs::smallint into v_target_position
  from generate_series(1, 3) gs
  where not exists (
    select 1 from public.questions q
    where q.current_position = gs and q.id <> p_question_id
  )
  order by gs
  limit 1;

  if v_target_position is null then
    raise exception 'No current Question slot is available without moving the Flagship.';
  end if;

  update public.questions
  set current_position = v_target_position
  where id = p_question_id;

  select pseudonym into v_actor_pseudonym
  from public.profiles
  where id = auth.uid();

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text),
    'room_question_made_current',
    'question', p_question_id, v_prompt,
    jsonb_build_object('current_position', v_target_position)
  );
end;
$function$;

revoke all on function public.admin_make_current_room_question(uuid) from public;
grant execute on function public.admin_make_current_room_question(uuid) to authenticated;

commit;
