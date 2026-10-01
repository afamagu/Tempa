-- Run after DISCOVERY_READING_READY. Repeatable, no historical suggestions made public.
begin;
create table if not exists public.member_questions (
 id uuid primary key default gen_random_uuid(),
 author_id uuid not null references auth.users(id) on delete cascade,
 suggestion_id uuid not null unique references public.room_question_suggestions(id) on delete cascade,
 body text not null check(char_length(btrim(body)) between 10 and 500),
 is_profile_visible boolean not null default true,
 moderation_status text not null default 'visible' check(moderation_status in('visible','pending','hidden')),
 withdrawn_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists member_questions_author_created on public.member_questions(author_id,created_at desc,id);
create or replace function public.member_question_author_visible(p_author uuid)
returns boolean language sql stable security definer set search_path='pg_catalog' as $fn$
 select auth.uid() is not null and exists(select 1 from public.public_profiles p where p.id=p_author)
 and not exists(select 1 from public.account_deactivations d where d.user_id=p_author and d.reactivated_at is null)
 and not tempa_private.account_is_banned(p_author)
$fn$;
revoke all on function public.member_question_author_visible(uuid) from public,anon;
grant execute on function public.member_question_author_visible(uuid) to authenticated;
alter table public.member_questions enable row level security;
drop policy if exists member_questions_read on public.member_questions;
create policy member_questions_read on public.member_questions for select to authenticated using(
 author_id=auth.uid() or (is_profile_visible and withdrawn_at is null and moderation_status='visible' and public.member_question_author_visible(author_id))
);
revoke all on public.member_questions from public,anon,authenticated;
grant select on public.member_questions to authenticated;
create table if not exists private.member_question_publication_audit (
 question_id uuid primary key references public.member_questions(id) on delete cascade,
 classification jsonb not null,
 warning_acknowledged boolean not null,
 created_at timestamptz not null default now()
);
alter table private.member_question_publication_audit enable row level security;
revoke all on private.member_question_publication_audit from public,anon,authenticated;
create table if not exists private.room_question_attribution (
 question_id uuid primary key references public.questions(id) on delete cascade,
 suggestion_id uuid not null unique references public.room_question_suggestions(id) on delete cascade
);
alter table private.room_question_attribution enable row level security;
revoke all on private.room_question_attribution from public,anon,authenticated;
-- Public questions use a dedicated authenticated server action. Only the trusted
-- service connection may publish, after classification and rate checks. Members
-- cannot supply a forged classification or publish via direct table inserts.
create or replace function public.publish_member_question_trusted(
 p_actor_id uuid,p_body text,p_credit boolean,p_classification jsonb,
 p_warning_acknowledged boolean default false,p_existing_suggestion_id uuid default null
) returns uuid language plpgsql security definer set search_path='pg_catalog' as $fn$
declare v_suggestion uuid; v_id uuid; v_name text; v_body text:=btrim(p_body); v_status text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Not authorized.'; end if;
 if p_actor_id is null or v_body is null or char_length(v_body) not between 10 and 500 then raise exception 'Invalid question.'; end if;
 select status into v_status from public.account_enforcement_state where user_id=p_actor_id;
 if coalesce(v_status,'active')<>'active' or tempa_private.account_is_banned(p_actor_id)
 or exists(select 1 from public.account_deactivations where user_id=p_actor_id and reactivated_at is null)
 then raise exception 'Account cannot publish questions.'; end if;
 select pseudonym into v_name from public.profiles where id=p_actor_id;
 if v_name is null then raise exception 'Complete your profile first.'; end if;
 if coalesce(p_classification->>'mutationDisposition','deny') not in('allow','warn') then raise exception 'This question cannot be published.'; end if;
 if p_classification->>'mutationDisposition'='warn' and p_warning_acknowledged is not true then raise exception 'Please acknowledge the warning.'; end if;
 perform pg_advisory_xact_lock(hashtext(p_actor_id::text||':room-suggestion'));
 if p_existing_suggestion_id is not null then
  select id into v_suggestion from public.room_question_suggestions where id=p_existing_suggestion_id and submitted_by=p_actor_id and proposed_question=v_body for update;
  if v_suggestion is null then raise exception 'Suggestion not found.'; end if;
  select id into v_id from public.member_questions where suggestion_id=v_suggestion;
  if v_id is not null then return v_id; end if;
 else
  if (select count(*) from public.room_question_suggestions where submitted_by=p_actor_id and created_at>=now()-interval '1 day')>=3 then raise exception 'Suggestion limit reached. Please try again tomorrow.'; end if;
  insert into public.room_question_suggestions(submitted_by,proposed_question,credit_if_used,pseudonym_snapshot)
  values(p_actor_id,v_body,coalesce(p_credit,false),v_name) returning id into v_suggestion;
 end if;
 insert into public.member_questions(author_id,suggestion_id,body,moderation_status)
 values(p_actor_id,v_suggestion,v_body,case when coalesce((p_classification->>'escalateCase')::boolean,false) then 'pending' else 'visible' end) returning id into v_id;
 insert into private.member_question_publication_audit(question_id,classification,warning_acknowledged)
 values(v_id,p_classification,coalesce(p_warning_acknowledged,false));
 return v_id;
end;$fn$;
revoke all on function public.publish_member_question_trusted(uuid,text,boolean,jsonb,boolean,uuid) from public,anon,authenticated;
grant execute on function public.publish_member_question_trusted(uuid,text,boolean,jsonb,boolean,uuid) to service_role;

create or replace function public.manage_member_question(p_question_id uuid,p_action text,p_value boolean default null)
returns void language plpgsql security definer set search_path='pg_catalog' as $fn$
declare v_suggestion uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required.'; end if;
 select suggestion_id into v_suggestion from public.member_questions where id=p_question_id and author_id=auth.uid();
 if v_suggestion is not null then
  perform 1 from public.room_question_suggestions where id=v_suggestion for update;
  perform 1 from public.member_questions where id=p_question_id and author_id=auth.uid() for update;
 end if;
 if v_suggestion is null then raise exception 'Question not found.'; end if;
 if p_action='visibility' and p_value is not null then
  update public.member_questions set is_profile_visible=p_value where id=p_question_id and withdrawn_at is null;
 elsif p_action='credit' and p_value is not null then
  update public.room_question_suggestions set credit_if_used=p_value,updated_at=now() where id=v_suggestion;
 elsif p_action='withdraw' then
  update public.member_questions set withdrawn_at=coalesce(withdrawn_at,now()),is_profile_visible=false where id=p_question_id;
  update public.room_question_suggestions set credit_if_used=false,status=case when status='used' then status else 'declined' end,updated_at=now() where id=v_suggestion;
 else raise exception 'Invalid question action.'; end if;
end;$fn$;
revoke all on function public.manage_member_question(uuid,text,boolean) from public,anon;
grant execute on function public.manage_member_question(uuid,text,boolean) to authenticated;

-- Narrow helpers expose no editorial notes or private submission body.
create or replace function public.member_question_credit_requested(p_id uuid)
returns boolean language sql stable security definer set search_path='pg_catalog' as $fn$
 select coalesce((select s.credit_if_used from public.member_questions q join public.room_question_suggestions s on s.id=q.suggestion_id where q.id=p_id and q.author_id=auth.uid()),false)
$fn$;
create or replace function public.member_question_selected(p_id uuid)
returns boolean language sql stable security definer set search_path='pg_catalog' as $fn$
 select auth.uid() is not null and exists(select 1 from public.member_questions q join public.room_question_suggestions s on s.id=q.suggestion_id where q.id=p_id and s.published_question_id is not null and (q.author_id=auth.uid() or (q.is_profile_visible and q.withdrawn_at is null and q.moderation_status='visible' and public.member_question_author_visible(q.author_id))))
$fn$;
revoke all on function public.member_question_credit_requested(uuid),public.member_question_selected(uuid) from public,anon;
grant execute on function public.member_question_credit_requested(uuid),public.member_question_selected(uuid) to authenticated;

create or replace function public.profile_member_questions(p_owner uuid,p_offset integer default 0,p_limit integer default 12)
returns table(id uuid,body text,is_profile_visible boolean,moderation_status text,withdrawn_at timestamptz,created_at timestamptz,credit_if_used boolean,selected boolean)
language sql stable security invoker set search_path='pg_catalog' as $fn$
 select q.id,q.body,q.is_profile_visible,q.moderation_status,q.withdrawn_at,q.created_at,
 public.member_question_credit_requested(q.id),public.member_question_selected(q.id)
 from public.member_questions q where q.author_id=p_owner and auth.uid() is not null
 order by q.created_at desc,q.id limit least(greatest(coalesce(p_limit,12),1),24) offset least(greatest(coalesce(p_offset,0),0),100000)
$fn$;
revoke all on function public.profile_member_questions(uuid,integer,integer) from public,anon;
grant execute on function public.profile_member_questions(uuid,integer,integer) to authenticated;

create or replace function public.my_unpublished_question_suggestions()
returns table(id uuid,body text,credit_if_used boolean) language sql stable security definer set search_path='pg_catalog' as $fn$
 select s.id,s.proposed_question,s.credit_if_used from public.room_question_suggestions s where s.submitted_by=auth.uid() and not exists(select 1 from public.member_questions q where q.suggestion_id=s.id) order by s.created_at desc limit 50
$fn$;
revoke all on function public.my_unpublished_question_suggestions() from public,anon;
grant execute on function public.my_unpublished_question_suggestions() to authenticated;

create or replace function public.admin_member_question_details()
returns jsonb language plpgsql stable security definer set search_path='pg_catalog' as $fn$
begin
 if not coalesce(public.is_staff('admin'),false) then raise exception 'Not authorized.'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('suggestion_id',q.suggestion_id,'question_id',q.id,'moderation_status',q.moderation_status,'withdrawn',q.withdrawn_at is not null)) from public.member_questions q where q.suggestion_id in(select s.id from public.room_question_suggestions s order by case s.status when 'pending' then 0 when 'shortlisted' then 1 when 'scheduled' then 2 when 'used' then 3 else 4 end,s.created_at desc limit 200)),'[]'::jsonb);
end;$fn$;
revoke all on function public.admin_member_question_details() from public,anon;
grant execute on function public.admin_member_question_details() to authenticated;
create or replace function public.admin_review_member_question(p_id uuid,p_status text)
returns void language plpgsql security definer set search_path='pg_catalog' as $fn$
begin
 if not coalesce(public.is_staff('admin'),false) then raise exception 'Not authorized.'; end if;
 if p_status is null or p_status not in('visible','hidden') then raise exception 'Invalid moderation status.'; end if;
 update public.member_questions set moderation_status=p_status where id=p_id;
 if not found then raise exception 'Question not found.'; end if;
 insert into public.admin_audit_log(actor_id,actor_identifier_snapshot,action,target_type,target_id,metadata) values(auth.uid(),auth.uid()::text,'member_question_reviewed','member_question',p_id,jsonb_build_object('status',p_status));
end;$fn$;
revoke all on function public.admin_review_member_question(uuid,text) from public,anon;
grant execute on function public.admin_review_member_question(uuid,text) to authenticated;

create or replace function public.admin_select_member_question(p_suggestion_id uuid,p_prompt text)
returns uuid language plpgsql security definer set search_path='pg_catalog' as $fn$
declare v_source public.room_question_suggestions; v_question uuid; v_member public.member_questions;
begin
 if not coalesce(public.is_staff('admin'),false) then raise exception 'Not authorized.'; end if;
 if p_prompt is null or char_length(btrim(p_prompt)) not between 10 and 500 then raise exception 'Invalid question.'; end if;
 perform pg_advisory_xact_lock(hashtext('tempa-current-room-question'));
 select * into v_source from public.room_question_suggestions where id=p_suggestion_id for update;
 if not found then raise exception 'Suggestion not found.'; end if;
 select * into v_member from public.member_questions where suggestion_id=p_suggestion_id for update;
 if v_member.withdrawn_at is not null then raise exception 'This question has been withdrawn.'; end if;
 select question_id into v_question from private.room_question_attribution where suggestion_id=p_suggestion_id;
 if v_question is not null then return v_question; end if;
 if v_source.published_question_id is not null then
  v_question:=v_source.published_question_id;
  if not exists(select 1 from public.questions where id=v_question and not is_flagship) then raise exception 'Published question is unavailable.'; end if;
 else v_question:=public.admin_create_question(btrim(p_prompt),'member_question'); end if;
 update public.questions set is_active=true where id=v_question;
 perform public.admin_make_current_room_question(v_question);
 insert into private.room_question_attribution(question_id,suggestion_id) values(v_question,p_suggestion_id);
 update public.room_question_suggestions set status='used',published_question_id=v_question,updated_at=now() where id=p_suggestion_id;
 if v_member.id is not null then update public.member_questions set moderation_status='visible' where id=v_member.id; end if;
 return v_question;
end;$fn$;
revoke all on function public.admin_select_member_question(uuid,text) from public,anon;
grant execute on function public.admin_select_member_question(uuid,text) to authenticated;

create or replace function public.room_question_credit(p_question_id uuid)
returns table(user_id uuid,pseudonym text,mark_id uuid) language sql stable security definer set search_path='pg_catalog' as $fn$
 select p.id,p.pseudonym,p.mark_id from private.room_question_attribution a join public.room_question_suggestions s on s.id=a.suggestion_id join public.public_profiles p on p.id=s.submitted_by
 where auth.uid() is not null and a.question_id=p_question_id and s.credit_if_used and public.member_question_author_visible(s.submitted_by) and not exists(select 1 from public.member_questions q where q.suggestion_id=s.id and q.withdrawn_at is not null)
$fn$;
revoke all on function public.room_question_credit(uuid) from public,anon;
grant execute on function public.room_question_credit(uuid) to authenticated;

create table if not exists public.member_question_letter_contexts (
 letter_id uuid primary key references public.letters(id) on delete cascade,
 member_question_id uuid references public.member_questions(id) on delete set null,
 prompt_snapshot text not null
);
alter table public.member_question_letter_contexts enable row level security;
drop policy if exists member_question_letter_context_read on public.member_question_letter_contexts;
create policy member_question_letter_context_read on public.member_question_letter_contexts for select to authenticated using(exists(select 1 from public.letters_for_participant l where l.id=letter_id));
revoke all on public.member_question_letter_contexts from public,anon,authenticated;
grant select on public.member_question_letter_contexts to authenticated;

create or replace function public.send_first_letter_from_member_question(
 p_recipient_id uuid,p_member_question_id uuid,p_question_answer_id uuid,p_body text,p_safety_evaluation_id uuid,p_warning_acknowledged boolean default false
) returns public.letters_for_participant language plpgsql security definer set search_path='pg_catalog' as $fn$
declare v_question public.member_questions; v_result public.letters_for_participant;
begin
 if auth.uid() is null then raise exception 'Authentication required.'; end if;
 select q.* into v_question from public.member_questions q where q.id=p_member_question_id and q.author_id=p_recipient_id and q.is_profile_visible and q.withdrawn_at is null and q.moderation_status='visible' and public.member_question_author_visible(q.author_id) for share;
 if not found then raise exception 'This question is no longer available.'; end if;
 -- The genuine answer remains the existing first-contact eligibility and Safety
 -- context. The authored question is separate invitation metadata, never a fake answer.
 v_result:=public.send_first_letter(p_recipient_id,p_question_answer_id,p_body,p_safety_evaluation_id,p_warning_acknowledged);
 insert into public.member_question_letter_contexts(letter_id,member_question_id,prompt_snapshot) values(v_result.id,v_question.id,v_question.body);
 return v_result;
end;$fn$;
revoke all on function public.send_first_letter_from_member_question(uuid,uuid,uuid,text,uuid,boolean) from public,anon;
grant execute on function public.send_first_letter_from_member_question(uuid,uuid,uuid,text,uuid,boolean) to authenticated;

create or replace function public.write_letter_from_member_question_once(
 p_client_submission_id uuid,p_correspondence_id uuid,p_member_question_id uuid,p_body text,p_safety_evaluation_id uuid,
 p_reply_to_id uuid default null,p_moments jsonb default '[]'::jsonb,p_postcard jsonb default null,p_warning_acknowledged boolean default false
) returns public.letters_for_participant language plpgsql security definer set search_path='pg_catalog' as $fn$
declare v_question public.member_questions; v_result public.letters_for_participant; v_other uuid; v_existing uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required.'; end if;
 select case when participant_low=auth.uid() then participant_high else participant_low end into v_other from public.correspondences where id=p_correspondence_id and auth.uid() in(participant_low,participant_high);
 if v_other is null then raise exception 'Correspondence not found.'; end if;
 perform 1 from public.correspondences where id=p_correspondence_id for update;
 select letter_id into v_existing from public.letter_submissions where sender_id=auth.uid() and client_submission_id=p_client_submission_id;
 if v_existing is not null then
  select l.* into v_result from public.letters_for_participant l join public.member_question_letter_contexts c on c.letter_id=l.id where l.id=v_existing and l.correspondence_id=p_correspondence_id and l.sender_id=auth.uid() and c.member_question_id=p_member_question_id;
  if not found then raise exception 'This submission already belongs to another letter.'; end if;
  return v_result;
 end if;
 select q.* into v_question from public.member_questions q where q.id=p_member_question_id and q.author_id=v_other and q.is_profile_visible and q.withdrawn_at is null and q.moderation_status='visible' and public.member_question_author_visible(q.author_id) for share;
 if not found then raise exception 'This question is no longer available.'; end if;
 v_result:=public.write_letter_once(p_client_submission_id,p_correspondence_id,p_body,p_safety_evaluation_id,p_reply_to_id,p_moments,p_postcard,p_warning_acknowledged);
 insert into public.member_question_letter_contexts(letter_id,member_question_id,prompt_snapshot) values(v_result.id,v_question.id,v_question.body) on conflict(letter_id) do nothing;
 if not exists(select 1 from public.member_question_letter_contexts where letter_id=v_result.id and member_question_id=v_question.id) then raise exception 'This submission already belongs to another question.'; end if;
 return v_result;
end;$fn$;
revoke all on function public.write_letter_from_member_question_once(uuid,uuid,uuid,text,uuid,uuid,jsonb,jsonb,boolean) from public,anon;
grant execute on function public.write_letter_from_member_question_once(uuid,uuid,uuid,text,uuid,uuid,jsonb,jsonb,boolean) to authenticated;
commit;
