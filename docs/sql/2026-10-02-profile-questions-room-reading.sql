begin;

-- Three visible profile questions; every older submission remains saved.
create or replace function private.limit_visible_member_questions()
returns trigger language plpgsql security definer set search_path='pg_catalog' as $fn$
begin
  if not new.is_profile_visible or new.withdrawn_at is not null or new.moderation_status <> 'visible' then return new; end if;
  perform pg_advisory_xact_lock(hashtext(new.author_id::text || ':profile-questions'));
  update public.member_questions q set is_profile_visible=false
  where q.author_id=new.author_id and q.is_profile_visible and q.withdrawn_at is null
    and q.moderation_status='visible'
    and q.id not in (
      select m.id from public.member_questions m
      where m.author_id=new.author_id and m.is_profile_visible
        and m.withdrawn_at is null and m.moderation_status='visible'
      order by case when m.id=new.id then 0 else 1 end,m.created_at desc,m.id desc limit 3
    );
  return new;
end;$fn$;
revoke all on function private.limit_visible_member_questions() from public,anon,authenticated;
drop trigger if exists member_question_profile_limit on public.member_questions;
create trigger member_question_profile_limit after insert or update of is_profile_visible,moderation_status,withdrawn_at
on public.member_questions for each row execute function private.limit_visible_member_questions();
with ranked as (
  select id,row_number() over(partition by author_id order by created_at desc,id desc) as n
  from public.member_questions where is_profile_visible and withdrawn_at is null and moderation_status='visible'
) update public.member_questions set is_profile_visible=false where id in(select id from ranked where n>3);

create or replace function public.room_reading_allowed()
returns boolean language sql stable security invoker set search_path='pg_catalog' as $fn$
 select auth.uid() is not null and public.current_account_status() in('active','restricted')
   and public.member_question_author_visible(auth.uid())
$fn$;
revoke all on function public.room_reading_allowed() from public,anon;
grant execute on function public.room_reading_allowed() to authenticated;

-- A narrow publication predicate: never expose an unpublished editorial draft.
create or replace function public.room_question_published(p_question_id uuid)
returns boolean language sql stable security definer set search_path='pg_catalog' as $fn$
 select public.room_reading_allowed() and exists(
   select 1 from public.questions q where q.id=p_question_id and (
     q.is_flagship or (q.is_active and q.current_position is not null)
     or exists(select 1 from public.admin_audit_log a where a.target_type='question'
       and a.target_id=q.id and a.action='room_question_made_current')
   )
 )
$fn$;
revoke all on function public.room_question_published(uuid) from public,anon;
grant execute on function public.room_question_published(uuid) to authenticated;

drop policy if exists room_published_answer_read on public.question_answers;
create policy room_published_answer_read on public.question_answers for select to authenticated using(
  public.room_reading_allowed() and public.room_question_published(question_id)
  and moderation_status='visible'
  and public.member_question_author_visible(user_id)
  and not tempa_private.is_blocked_pair(auth.uid(),user_id)
  and not tempa_private.hidden_from_discovery(auth.uid(),user_id)
);

create or replace function public.room_read_question_answers(
 p_question_id uuid,p_after_created_at timestamptz default null,p_after_id uuid default null,
 p_limit integer default 3,p_country text default null,p_gender text default null,p_age text default null
) returns table(answer_id uuid,user_id uuid,body text,created_at timestamptz,pseudonym text,
 country text,gender text,gender_custom text,age_range text,mark_id uuid,prompt text)
language sql stable security invoker set search_path='pg_catalog' as $fn$
 select a.id,a.user_id,a.body,a.created_at,p.pseudonym,p.country,p.gender,p.gender_custom,p.age_range,p.mark_id,q.prompt
 from public.question_answers a join public.public_profiles p on p.id=a.user_id
 join public.questions q on q.id=a.question_id
 where public.room_reading_allowed() and public.room_question_published(p_question_id)
   and a.question_id=p_question_id and a.moderation_status='visible'
   and public.member_question_author_visible(a.user_id)
   and not tempa_private.is_blocked_pair(auth.uid(),a.user_id)
   and not tempa_private.hidden_from_discovery(auth.uid(),a.user_id)
   and (nullif(p_country,'') is null or p.country=p_country)
   and (nullif(p_gender,'') is null or p.gender=p_gender or (p.gender='Self-describe' and p.gender_custom=p_gender))
   and (nullif(p_age,'') is null or p.age_range=p_age)
   and (p_after_created_at is null or (a.created_at,a.id)>(p_after_created_at,p_after_id))
 order by a.created_at,a.id limit least(greatest(coalesce(p_limit,3),1),12)+1
$fn$;
revoke all on function public.room_read_question_answers(uuid,timestamptz,uuid,integer,text,text,text) from public,anon;
grant execute on function public.room_read_question_answers(uuid,timestamptz,uuid,integer,text,text,text) to authenticated;

-- Only question text and genuine first-publication dates leave the audit boundary.
-- Older questions without a publication record have an unknown date, not an invented one.
create or replace function public.room_question_library(p_search text default '',p_offset integer default 0,p_limit integer default 6,p_from date default null,p_to date default null)
returns table(id uuid,prompt text,published_at timestamptz,is_current boolean,is_flagship boolean)
language sql stable security definer set search_path='pg_catalog' as $fn$
 select q.id,q.prompt,
   (select min(a.created_at) from public.admin_audit_log a where a.target_type='question'
     and a.target_id=q.id and a.action='room_question_made_current'),
   q.is_active and q.current_position is not null and not q.is_flagship,q.is_flagship
 from public.questions q where public.room_reading_allowed() and public.room_question_published(q.id)
   and (nullif(btrim(p_search),'') is null or position(lower(btrim(p_search)) in lower(q.prompt))>0)
   and (p_from is null or (select min(a.created_at) from public.admin_audit_log a where a.target_type='question' and a.target_id=q.id and a.action='room_question_made_current') >= p_from::timestamp at time zone 'UTC')
   and (p_to is null or (select min(a.created_at) from public.admin_audit_log a where a.target_type='question' and a.target_id=q.id and a.action='room_question_made_current') < (p_to+1)::timestamp at time zone 'UTC')
 order by 3 desc nulls last,q.id desc
 limit least(greatest(coalesce(p_limit,6),1),24)+1 offset least(greatest(coalesce(p_offset,0),0),100000)
$fn$;
revoke all on function public.room_question_library(text,integer,integer,date,date) from public,anon;
grant execute on function public.room_question_library(text,integer,integer,date,date) to authenticated;

commit;
