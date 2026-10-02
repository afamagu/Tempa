-- REVIEW REQUIRED. Not executed by this change.
-- Uses the existing admin/RLS model; never updates or deletes an answer.
begin;
create or replace function public.admin_start_room_question(p_question_id uuid, p_restart boolean default false)
returns uuid language plpgsql security definer set search_path='pg_catalog' as $fn$
declare
  v_source public.questions%rowtype;
  v_id uuid;
  v_actor text;
begin
  if auth.uid() is null or not coalesce(public.is_staff('admin'),false) then
    raise exception 'Not authorized.';
  end if;
  perform pg_advisory_xact_lock(hashtext('tempa-current-room-question'));
  select * into v_source from public.questions where id=p_question_id for update;
  if not found or v_source.is_flagship or not v_source.is_active then
    raise exception 'Choose an active non-Flagship Question.';
  end if;
  if p_restart and v_source.current_position is null then
    raise exception 'The current Question changed. Refresh before starting a fresh week.';
  end if;
  if not p_restart and v_source.current_position is not null then
    return v_source.id;
  end if;
  select pseudonym into v_actor from public.profiles where id=auth.uid();
  -- Preserve publication evidence for the outgoing question, including legacy
  -- positioned questions that predate the Room publication audit.
  insert into public.admin_audit_log(actor_id,actor_identifier_snapshot,action,target_type,target_id,target_identifier_snapshot)
  select auth.uid(),coalesce(v_actor,auth.uid()::text),'room_question_archived','question',q.id,q.prompt
  from public.questions q where q.is_active and not q.is_flagship and q.current_position is not null;

  v_id := v_source.id;
  if p_restart or exists(select 1 from public.question_answers where question_id=v_source.id) then
    insert into public.questions(prompt,family,is_active,is_flagship)
    values(v_source.prompt,v_source.family,true,false) returning id into v_id;
  end if;
  perform public.admin_make_current_room_question(v_id);
  insert into public.admin_audit_log(actor_id,actor_identifier_snapshot,action,target_type,target_id,target_identifier_snapshot,metadata)
  values(auth.uid(),coalesce(v_actor,auth.uid()::text),'room_question_started','question',v_id,v_source.prompt,
    jsonb_build_object('source_question_id',v_source.id,'fresh_question',v_id<>v_source.id));
  return v_id;
end;$fn$;
revoke all on function public.admin_start_room_question(uuid,boolean) from public,anon;
grant execute on function public.admin_start_room_question(uuid,boolean) to authenticated;

create or replace function public.room_question_published(p_question_id uuid)
returns boolean language sql stable security definer set search_path='pg_catalog' as $fn$
 select public.room_reading_allowed() and exists(
   select 1 from public.questions q where q.id=p_question_id and (
     q.is_flagship or (q.is_active and q.current_position is not null)
     or exists(select 1 from public.admin_audit_log a where a.target_type='question'
       and a.target_id=q.id and a.action in('room_question_made_current','room_question_archived'))
   )
 )
$fn$;
revoke all on function public.room_question_published(uuid) from public,anon;
grant execute on function public.room_question_published(uuid) to authenticated;
-- A visible published Room answer is a valid conversation origin even when
-- it is not the author's old is_current discovery answer. Keep every other
-- restriction and Safety evaluation in the installed letter functions.
create or replace function public.room_answer_can_start_letter(p_answer uuid,p_author uuid)
returns boolean language sql stable security definer set search_path='pg_catalog' as $fn$
 select auth.uid() is not null and auth.uid()<>p_author
   and public.room_reading_allowed()
   and public.member_question_author_visible(p_author)
   and not tempa_private.is_correspondence_blocked_pair(auth.uid(),p_author)
   and not tempa_private.hidden_from_discovery(auth.uid(),p_author)
   and exists(select 1 from public.question_answers a where a.id=p_answer and a.user_id=p_author
     and a.moderation_status='visible' and public.room_question_published(a.question_id))
$fn$;
revoke all on function public.room_answer_can_start_letter(uuid,uuid) from public,anon;
grant execute on function public.room_answer_can_start_letter(uuid,uuid) to authenticated;

-- Refuse unexpected installed definitions rather than replacing whole Safety
-- functions with a potentially stale repository copy. The replacement changes
-- only the answer-eligibility predicate, in both evaluation and sending.
do $patch$
declare
 v_signature text; v_definition text; v_updated text; v_matches integer;
 v_pattern text := 'and qa\.is_current = true[[:space:]]+and q\.is_active = true';
begin
 foreach v_signature in array array[
   'public.send_first_letter(uuid,uuid,text,uuid,boolean)',
   'public.can_evaluate_safety_context(text,uuid,uuid,uuid,jsonb)'
 ] loop
   if to_regprocedure(v_signature) is null then raise exception 'Missing required function: %',v_signature; end if;
   select pg_get_functiondef(to_regprocedure(v_signature)) into v_definition;
   if position('public.room_answer_can_start_letter(qa.id, qa.user_id)' in v_definition)>0 then continue; end if;
   select count(*) into v_matches from regexp_matches(v_definition,v_pattern,'g');
   if v_matches<>1 then raise exception 'Unexpected answer guard in %. Review the live definition first.',v_signature; end if;
   v_updated := regexp_replace(v_definition,v_pattern,
     'and ((qa.is_current = true and q.is_active = true) or public.room_answer_can_start_letter(qa.id, qa.user_id))');
   execute v_updated;
 end loop;
end;$patch$;
commit;
