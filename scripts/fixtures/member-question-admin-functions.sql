-- Verified live definitions supplied by the project owner on 2026-10-01. Test fixture only.
CREATE OR REPLACE FUNCTION public.admin_create_question(p_prompt text, p_family text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_prompt text;
  v_family text;
  v_actor_pseudonym text;
  v_new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('admin') then
    raise exception 'Not authorized.';
  end if;

  v_prompt := trim(both from coalesce(p_prompt, ''));
  if char_length(v_prompt) = 0 then
    raise exception 'A prompt is required.';
  end if;
  if char_length(v_prompt) > 2000 then
    raise exception 'Prompt is too long.';
  end if;

  v_family := nullif(trim(both from coalesce(p_family, '')), '');

  insert into public.questions (prompt, family, is_active)
  values (v_prompt, v_family, false)
  returning id into v_new_id;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'question_created',
    'question', v_new_id, v_prompt, jsonb_build_object('family', v_family)
  );

  return v_new_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.admin_make_current_room_question(p_question_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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

  if not coalesce(public.is_staff('admin'), false) then
    raise exception 'Not authorized.';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('tempa-current-room-question')
  );

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

  update public.questions
  set current_position = null
  where is_flagship = false
    and id <> p_question_id
    and current_position is not null;

  select gs::smallint into v_target_position
  from generate_series(1, 3) gs
  where not exists (
    select 1 from public.questions q
    where q.current_position = gs
      and q.id <> p_question_id
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
    actor_id,
    actor_identifier_snapshot,
    action,
    target_type,
    target_id,
    target_identifier_snapshot,
    metadata
  )
  values (
    auth.uid(),
    coalesce(v_actor_pseudonym, auth.uid()::text),
    'room_question_made_current',
    'question',
    p_question_id,
    v_prompt,
    jsonb_build_object('current_position', v_target_position)
  );
end;
$function$
;
