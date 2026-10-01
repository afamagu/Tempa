-- TEMPA — MEMBER ROOM QUESTION SUGGESTIONS
-- STATUS: NOT EXECUTED IN PRODUCTION
-- Forward-only. Suggestions are private editorial submissions, never public votes.

begin;

create table if not exists public.room_question_suggestions (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null references auth.users(id) on delete cascade,
  proposed_question text not null check (char_length(btrim(proposed_question)) between 10 and 500),
  credit_if_used boolean not null default false,
  pseudonym_snapshot text,
  status text not null default 'pending' check (status in ('pending', 'shortlisted', 'scheduled', 'declined', 'used')),
  editorial_notes text,
  published_question_id uuid references public.questions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists room_question_suggestions_status_created_idx
  on public.room_question_suggestions (status, created_at desc);
create index if not exists room_question_suggestions_submitter_idx
  on public.room_question_suggestions (submitted_by, created_at desc);

alter table public.room_question_suggestions enable row level security;
revoke all on public.room_question_suggestions from public, anon, authenticated;

-- Members submit through one narrow RPC. They do not gain table SELECT access,
-- so other members' submissions and internal editorial state remain private.
create or replace function public.submit_room_question_suggestion(
  p_question text,
  p_credit_if_used boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_id uuid;
  v_prompt text := btrim(coalesce(p_question, ''));
  v_pseudonym text;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if char_length(v_prompt) < 10 then raise exception 'Please write a complete question.'; end if;
  if char_length(v_prompt) > 500 then raise exception 'Question is too long.'; end if;

  if public.current_account_status() is distinct from 'active' then
    raise exception 'Account cannot submit suggestions.';
  end if;

  select p.pseudonym into v_pseudonym from public.profiles p where p.id = auth.uid();

  if v_pseudonym is null then raise exception 'Complete your profile first.'; end if;

  -- Serialize submissions from one account before enforcing the daily limit.
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text || ':room-suggestion'));
  if (select count(*) from public.room_question_suggestions
      where submitted_by = auth.uid() and created_at >= now() - interval '1 day') >= 3 then
    raise exception 'Suggestion limit reached. Please try again tomorrow.';
  end if;

  insert into public.room_question_suggestions (
    submitted_by, proposed_question, credit_if_used, pseudonym_snapshot
  ) values (
    auth.uid(), v_prompt, coalesce(p_credit_if_used, false), v_pseudonym
  ) returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.submit_room_question_suggestion(text, boolean) from public, anon;
grant execute on function public.submit_room_question_suggestion(text, boolean) to authenticated;

create or replace function public.admin_list_room_question_suggestions()
returns table (
  id uuid,
  proposed_question text,
  credit_if_used boolean,
  pseudonym_snapshot text,
  status text,
  editorial_notes text,
  published_question_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if not coalesce(public.is_staff('admin'), false) then raise exception 'Not authorized.'; end if;
  return query
    select s.id, s.proposed_question, s.credit_if_used, s.pseudonym_snapshot,
           s.status, s.editorial_notes, s.published_question_id, s.created_at
    from public.room_question_suggestions s
    order by
      case s.status when 'pending' then 0 when 'shortlisted' then 1 when 'scheduled' then 2 when 'used' then 3 else 4 end,
      s.created_at desc
    limit 200;
end;
$function$;

revoke all on function public.admin_list_room_question_suggestions() from public, anon;
grant execute on function public.admin_list_room_question_suggestions() to authenticated;

create or replace function public.admin_update_room_question_suggestion(
  p_suggestion_id uuid,
  p_status text,
  p_editorial_notes text default null,
  p_published_question_id uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_actor_pseudonym text;
  v_prompt text;
begin
  if not coalesce(public.is_staff('admin'), false) then raise exception 'Not authorized.'; end if;
  if p_status is null or p_status not in ('pending', 'shortlisted', 'scheduled', 'declined', 'used') then
    raise exception 'Invalid suggestion status.';
  end if;

  select proposed_question into v_prompt
  from public.room_question_suggestions
  where id = p_suggestion_id
  for update;
  if v_prompt is null then raise exception 'Suggestion not found.'; end if;

  update public.room_question_suggestions
  set status = p_status,
      editorial_notes = nullif(btrim(coalesce(p_editorial_notes, '')), ''),
      published_question_id = p_published_question_id,
      updated_at = now()
  where id = p_suggestion_id;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();
  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text),
    'room_question_suggestion_reviewed',
    'room_question_suggestion', p_suggestion_id, v_prompt,
    jsonb_build_object('status', p_status, 'published_question_id', p_published_question_id)
  );
end;
$function$;

revoke all on function public.admin_update_room_question_suggestion(uuid, text, text, uuid) from public, anon;
grant execute on function public.admin_update_room_question_suggestion(uuid, text, text, uuid) to authenticated;

commit;
