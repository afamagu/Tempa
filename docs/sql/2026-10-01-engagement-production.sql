-- COMPLETE RECOVERED ENGAGEMENT RELEASE + DISPATCH BODY REPAIR
-- Run once after the already-applied PR #54 production SQL.
-- One transaction; invitation email sending remains disabled.
begin;
-- Source: 2026-10-01-dispatch-body-ceiling.sql
-- Dispatch long-form publishing hotfix. Run once, then the verifier.
-- Removes the obsolete 10,000-visible-character ceiling. The Safety
-- endpoint continues to enforce its separate 200,000 encoded-character
-- request ceiling. No content, RPC, grants, or visibility changes.

alter table public.dispatches
  drop constraint if exists dispatches_body_visible_length;

alter table public.dispatches
  add constraint dispatches_body_visible_length
  check (public.dispatch_visible_length(body) <= 200000);


-- Source: 2026-10-01-engagement-reconciliation.sql
-- TEMPA — FINAL LETTERS / DISCOVER RECONCILIATION
-- STATUS: NOT EXECUTED IN PRODUCTION
-- Prerequisites: Room fair exposure migration + set-based recorder + current Question.
-- Forward-only; does not alter existing public_profiles or publishing/safety RPCs.

create or replace function public.discover_profiles(
  p_country text default null,
  p_gender text default null,
  p_age_range text default null,
  p_language text default null,
  p_intent text default null,
  p_search text default null,
  p_exclude_user_ids uuid[] default array[]::uuid[],
  p_limit integer default 6
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $function$
  with viewer as (
    select auth.uid() as id
  ),
  flagship as (
    select q.id from public.questions q where q.is_flagship = true limit 1
  ),
  room_question as (
    select q.id
    from public.questions q
    where q.is_active = true
      and q.is_flagship = false
      and q.current_position is not null
    order by q.current_position asc
    limit 1
  ),
  partners as materialized (
    select case when c.participant_low = v.id then c.participant_high else c.participant_low end as user_id
    from public.correspondences c
    cross join viewer v
    where c.status = 'active'
      and (c.participant_low = v.id or c.participant_high = v.id)
  ),
  contacted as materialized (
    select l.question_answer_id as answer_id
    from public.letters_for_participant l
    cross join viewer v
    where l.sender_id = v.id
      and l.reply_to_id is null
      and l.question_answer_id is not null
  ),
  representative as materialized (
    select distinct on (qa.user_id)
      qa.id, qa.user_id, qa.question_id, qa.body
    from public.question_answers qa
    cross join viewer v
    where qa.moderation_status = 'visible'
      and qa.user_id <> v.id
    order by
      qa.user_id,
      case
        when qa.question_id = (select rq.id from room_question rq) then 1
        when qa.question_id = (select f.id from flagship f) then 2
        when qa.is_current then 3
        else 4
      end,
      qa.updated_at desc nulls last,
      qa.id
  ),
  visible_profiles as materialized (
    select p.id, p.pseudonym, p.country, p.gender, p.gender_custom, p.age_range, p.mark_id, p.languages, p.intent
    from public.public_profiles p
    cross join viewer v
    where p.id <> v.id
  ),
  eligible as materialized (
    select
      r.id as answer_id,
      r.question_id,
      r.body,
      p.id as user_id,
      p.pseudonym,
      p.country,
      p.gender,
      p.gender_custom,
      p.age_range,
      p.mark_id,
      p.languages,
      p.intent,
      case when r.question_id = (select rq.id from room_question rq) then 1 else 0 end as current_question_relevance,
      hashtext(v.id::text || ':' || p.id::text) as stable_hash
    from visible_profiles p
    left join representative r on r.user_id = p.id
    cross join viewer v
    where not exists (select 1 from partners x where x.user_id = p.id)
      and not exists (select 1 from contacted c where c.answer_id = r.id)
      and not (p.id = any(coalesce(p_exclude_user_ids, array[]::uuid[])))
  ),
  filtered as materialized (
    select e.*
    from eligible e
    where (nullif(p_country, '') is null or e.country = p_country)
      and (
        nullif(p_gender, '') is null
        or e.gender = p_gender
        or (e.gender = 'Self-describe' and e.gender_custom = p_gender)
      )
      and (nullif(p_age_range, '') is null or e.age_range = p_age_range)
      and (nullif(p_language, '') is null or p_language = any(e.languages))
      and (nullif(p_intent, '') is null or p_intent = any(e.intent))
      and (nullif(btrim(p_search), '') is null or position(lower(btrim(p_search)) in lower(e.pseudonym)) > 0)
  ),
  facts as materialized (
    select rf.*
    from public.room_discovery_rank_facts(
      (select id from viewer),
      coalesce((select array_agg(f.user_id) from filtered f), array[]::uuid[])
    ) rf
  ),
  ranked as materialized (
    select f.*, rf.fair_rank, rf.last_served_at
    from filtered f
    join facts rf on rf.candidate_id = f.user_id
  ),
  page as (
    select r.*
    from ranked r
    order by r.fair_rank, r.current_question_relevance desc, r.stable_hash, r.user_id
    limit least(greatest(coalesce(p_limit, 6), 1), 24)
  )
  select jsonb_build_object(
    'eligible_count', (select count(*) from eligible),
    'filtered_count', (select count(*) from filtered),
    'entries', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'user_id', pg.user_id,
            'pseudonym', pg.pseudonym,
            'country', pg.country,
            'gender', pg.gender,
            'gender_custom', pg.gender_custom,
            'age_range', pg.age_range,
            'mark_id', pg.mark_id,
            'languages', pg.languages,
            'intent', pg.intent,
            'answer_id', coalesce(pg.answer_id::text, ''),
            'body', coalesce(pg.body, ''),
            'prompt', q.prompt
          )
          order by pg.fair_rank, pg.current_question_relevance desc, pg.stable_hash, pg.user_id
        )
        from page pg
        left join public.questions q on q.id = pg.question_id
      ),
      '[]'::jsonb
    )
  )
$function$;

revoke all on function public.discover_profiles(text, text, text, text, text, text, uuid[], integer) from public, anon;
grant execute on function public.discover_profiles(text, text, text, text, text, text, uuid[], integer) to authenticated;


-- Restricted eligibility predicate: exposes only whether the caller can name
-- this existing correspondent. No relationship counts/other members' graphs.
create or replace function public.can_pick_correspondent(p_partner uuid)
returns boolean language sql stable security definer set search_path to 'pg_catalog'
as $fn$
  select auth.uid() is not null and p_partner <> auth.uid()
    and public.current_account_status() = 'active'
    and not tempa_private.is_correspondence_blocked_pair(auth.uid(), p_partner)
    and not tempa_private.account_is_banned(p_partner)
    and not exists (select 1 from public.account_deactivations d where d.user_id = p_partner and d.reactivated_at is null)
    and not exists (select 1 from public.account_enforcement_state e where e.user_id = p_partner and e.status <> 'active')
    and exists (
      select 1 from public.correspondences c
      where c.status = 'active' and c.established_at is not null
        and ((c.participant_low = auth.uid() and c.participant_high = p_partner)
          or (c.participant_high = auth.uid() and c.participant_low = p_partner))
        and not exists (select 1 from public.correspondence_hidden_for_user h where h.user_id = auth.uid() and h.correspondence_id = c.id)
        and exists (select 1 from public.letters_for_participant l where l.correspondence_id = c.id and l.reply_to_id is not null)
    )
$fn$;
revoke all on function public.can_pick_correspondent(uuid) from public, anon;
grant execute on function public.can_pick_correspondent(uuid) to authenticated;

-- Filter by pseudonym in SQL, rank by visible exchanged letters, then recency.
-- No letter body is read or returned. The profiles/letter view still use RLS.
create or replace function public.correspondent_picker(p_search text default '', p_limit integer default 20)
returns table(user_id uuid, pseudonym text, mark_id uuid)
language sql stable security invoker set search_path to 'pg_catalog'
as $fn$
  with partners as (
    select c.id, case when c.participant_low = auth.uid() then c.participant_high else c.participant_low end as user_id
    from public.correspondences c
    where c.status = 'active' and c.established_at is not null
      and (c.participant_low = auth.uid() or c.participant_high = auth.uid())
      and not exists (select 1 from public.correspondence_hidden_for_user h where h.user_id=auth.uid() and h.correspondence_id=c.id)
  ), eligible as materialized (
    select p.id, p.pseudonym, p.mark_id, c.id as correspondence_id
    from partners c join public.public_profiles p on p.id = c.user_id
    where public.can_pick_correspondent(p.id)
      and (nullif(btrim(p_search), '') is null or position(lower(btrim(p_search)) in lower(p.pseudonym)) > 0)
  )
  select e.id, e.pseudonym, e.mark_id
  from eligible e join public.letters_for_participant l on l.correspondence_id = e.correspondence_id
  group by e.id, e.pseudonym, e.mark_id
  order by count(l.id) desc, max(l.created_at) desc, e.pseudonym, e.id
  limit least(greatest(coalesce(p_limit, 20), 1), 20)
$fn$;
revoke all on function public.correspondent_picker(text, integer) from public, anon;
grant execute on function public.correspondent_picker(text, integer) to authenticated;


-- Source: 2026-10-01-room-invitations.sql
-- TEMPA — PRIVATE ROOM INVITATIONS
-- STATUS: NOT EXECUTED IN PRODUCTION
-- Apply after engagement-reconciliation, current Question and fair exposure.
-- Publishing/safety RPCs remain unchanged. Invitations are a separate action.
-- Email starts disabled. No private answer/letter body enters the email queue.

create table public.room_answer_mentions (
  answer_id uuid not null references public.question_answers(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  pseudonym_at_selection text not null,
  primary key(answer_id, recipient_id), check(sender_id <> recipient_id)
);
create table public.room_invitations (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null references public.question_answers(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(answer_id, recipient_id), check(sender_id <> recipient_id)
);
create index room_invitations_recipient_idx on public.room_invitations(recipient_id, created_at desc);
create table public.room_invitation_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  emails_enabled boolean not null default true
);
create table private.room_invitation_email_jobs (
  invitation_id uuid primary key references public.room_invitations(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','processing','sent','skipped','failed','manual_review')),
  attempts integer not null default 0,
  claim_token uuid, claimed_at timestamptz, next_attempt_at timestamptz not null default now(),
  snapshot jsonb, first_provider_at timestamptz, last_error text
);
create table private.room_invitation_email_config (
  singleton boolean primary key default true check(singleton), sending_enabled boolean not null default false
);
insert into private.room_invitation_email_config(singleton) values(true);
alter table public.room_answer_mentions enable row level security;
alter table public.room_invitations enable row level security;
alter table public.room_invitation_preferences enable row level security;
alter table private.room_invitation_email_jobs enable row level security;
alter table private.room_invitation_email_config enable row level security;
revoke all on public.room_answer_mentions, public.room_invitations, public.room_invitation_preferences,
  private.room_invitation_email_jobs, private.room_invitation_email_config from public, anon, authenticated;
grant select on public.room_answer_mentions, public.room_invitation_preferences to authenticated;
create policy room_mentions_author on public.room_answer_mentions for select to authenticated using(sender_id = auth.uid());
create policy room_invitation_preferences_owner on public.room_invitation_preferences for select to authenticated using(user_id = auth.uid());

-- Private predicate usable by both user RPCs and the service worker. Recheck
-- both account lifecycles, all block scopes, active established correspondence,
-- delivery, current Question, answer ownership, and retained selected identity.
create or replace function tempa_private.room_invitation_eligible(p_sender uuid, p_recipient uuid, p_answer uuid)
returns boolean language sql stable security definer set search_path to 'pg_catalog'
as $fn$
  select p_sender <> p_recipient
    and not tempa_private.is_correspondence_blocked_pair(p_sender, p_recipient)
    and not tempa_private.account_is_banned(p_sender)
    and not tempa_private.account_is_banned(p_recipient)
    and not exists(select 1 from public.account_deactivations d where d.user_id in (p_sender,p_recipient) and d.reactivated_at is null)
    and not exists(select 1 from public.account_enforcement_state e where e.user_id in (p_sender,p_recipient) and e.status <> 'active')
    and exists(select 1 from public.profiles p where p.id = p_recipient)
    and exists (
      select 1 from public.correspondences c where c.status = 'active' and c.established_at is not null
        and ((c.participant_low = p_sender and c.participant_high = p_recipient) or (c.participant_high = p_sender and c.participant_low = p_recipient))
        and not exists(select 1 from public.correspondence_hidden_for_user h where h.correspondence_id = c.id and h.user_id in(p_sender,p_recipient))
        and exists(select 1 from public.letters l where l.correspondence_id = c.id and l.reply_to_id is not null and (l.sender_id = p_sender or l.deliver_at <= now()))
    )
    and exists (
      select 1 from public.question_answers a join public.questions q on q.id = a.question_id
      join public.room_answer_mentions m on m.answer_id = a.id and m.recipient_id = p_recipient and m.sender_id = p_sender
      where a.id = p_answer and a.user_id = p_sender and a.moderation_status = 'visible'
        and q.is_active and not q.is_flagship and q.current_position = (
          select min(q2.current_position) from public.questions q2 where q2.is_active and not q2.is_flagship
        )
        and position('@' || m.pseudonym_at_selection in a.body) > 0
    )
$fn$;
revoke all on function tempa_private.room_invitation_eligible(uuid,uuid,uuid) from public, anon, authenticated;

create or replace function public.create_room_invitations(p_question_id uuid, p_recipient_ids uuid[])
returns integer language plpgsql security definer set search_path to 'pg_catalog'
as $fn$
declare v_answer public.question_answers; v_recipient uuid; v_name text; v_id uuid; v_count integer := 0;
begin
  if auth.uid() is null or public.current_account_status() is distinct from 'active' then raise exception 'Account unavailable.'; end if;
  if cardinality(p_recipient_ids) > 2 or p_recipient_ids is null then raise exception 'Choose at most two correspondents.'; end if;
  -- Serialize all invitations by this sender, including distinct answers,
  -- so concurrent requests cannot bypass the sender/day limit.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 1));
  -- Serializes edits/parallel invitation requests for this owned answer.
  select * into v_answer from public.question_answers a where a.question_id = p_question_id and a.user_id = auth.uid() for update;
  if not found or v_answer.moderation_status <> 'visible' then raise exception 'Published answer required.'; end if;
  if (select count(*) from (select m.recipient_id from public.room_answer_mentions m where m.answer_id = v_answer.id union select unnest(p_recipient_ids)) ids) > 2 then
    raise exception 'This answer can invite at most two correspondents.';
  end if;
  foreach v_recipient in array p_recipient_ids loop
    if not public.can_pick_correspondent(v_recipient) then raise exception 'Correspondent unavailable.'; end if;
    select p.pseudonym into v_name from public.profiles p where p.id = v_recipient;
    if position('@' || v_name in v_answer.body) = 0 then raise exception 'Selected name must remain in the answer.'; end if;
    insert into public.room_answer_mentions(answer_id,sender_id,recipient_id,pseudonym_at_selection)
      values(v_answer.id,auth.uid(),v_recipient,v_name) on conflict do nothing;
    if not tempa_private.room_invitation_eligible(auth.uid(),v_recipient,v_answer.id) then raise exception 'Room invitation unavailable.'; end if;
    -- Limit new events per sender/day as defense against creating many answers.
    if not exists(select 1 from public.room_invitations i where i.answer_id = v_answer.id and i.recipient_id = v_recipient)
      and (select count(*) from public.room_invitations i where i.sender_id = auth.uid() and i.created_at > now() - interval '24 hours') >= 10 then
      raise exception 'Invitation limit reached. Try later.';
    end if;
    insert into public.room_invitations(answer_id,question_id,sender_id,recipient_id)
      values(v_answer.id,p_question_id,auth.uid(),v_recipient) on conflict do nothing returning id into v_id;
    if v_id is not null then
      insert into private.room_invitation_email_jobs(invitation_id) values(v_id);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end
$fn$;
revoke all on function public.create_room_invitations(uuid,uuid[]) from public, anon;
grant execute on function public.create_room_invitations(uuid,uuid[]) to authenticated;

create or replace function public.get_room_invitations()
returns table(id uuid, question_id uuid, pseudonym text, prompt text)
language sql stable security definer set search_path to 'pg_catalog'
as $fn$
  select i.id,i.question_id,p.pseudonym,q.prompt
  from public.room_invitations i join public.profiles p on p.id = i.sender_id join public.questions q on q.id = i.question_id
  where i.recipient_id = auth.uid() and tempa_private.room_invitation_eligible(i.sender_id,i.recipient_id,i.answer_id)
    and not exists(select 1 from public.question_answers a where a.question_id = i.question_id and a.user_id = auth.uid())
  order by i.created_at desc limit 6
$fn$;
revoke all on function public.get_room_invitations() from public, anon;
grant execute on function public.get_room_invitations() to authenticated;

create or replace function public.set_room_invitation_email_preference(p_enabled boolean)
returns void language plpgsql security definer set search_path to 'pg_catalog'
as $fn$
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  insert into public.room_invitation_preferences(user_id,emails_enabled) values(auth.uid(),coalesce(p_enabled,false))
    on conflict(user_id) do update set emails_enabled = excluded.emails_enabled;
end
$fn$;
revoke all on function public.set_room_invitation_email_preference(boolean) from public, anon;
grant execute on function public.set_room_invitation_email_preference(boolean) to authenticated;

create or replace function public.claim_room_invitation_emails(p_limit integer default 20)
returns table(invitation_id uuid, claim_token uuid)
language plpgsql security definer set search_path to 'pg_catalog'
as $fn$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required.'; end if;
  if not exists(select 1 from private.room_invitation_email_config where singleton and sending_enabled) then return; end if;
  update private.room_invitation_email_jobs set status='manual_review',last_error='final claim expired; delivery uncertain'
    where status='processing' and attempts >= 5 and claimed_at < now() - interval '15 minutes';
  return query with jobs as (
    select j.invitation_id from private.room_invitation_email_jobs j
    where ((j.status = 'pending' and j.next_attempt_at <= now()) or (j.status = 'processing' and j.claimed_at < now() - interval '15 minutes'))
      and j.attempts < 5 order by j.next_attempt_at limit least(greatest(p_limit,1),20) for update skip locked
  ) update private.room_invitation_email_jobs j set status='processing',claim_token=gen_random_uuid(),claimed_at=now(),attempts=j.attempts+1
    from jobs where j.invitation_id = jobs.invitation_id returning j.invitation_id,j.claim_token;
end
$fn$;

-- Revalidation and freezing are one fenced transaction before provider I/O.
create or replace function public.prepare_room_invitation_email(p_invitation_id uuid,p_claim_token uuid,p_site_origin text,p_from text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog'
as $fn$
declare j private.room_invitation_email_jobs; i public.room_invitations; v_email text; v_name text; v_prompt text; v_snapshot jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required.'; end if;
  select * into j from private.room_invitation_email_jobs where invitation_id=p_invitation_id and claim_token=p_claim_token and status='processing' for update;
  if not found then return null; end if;
  if not exists(select 1 from private.room_invitation_email_config where singleton and sending_enabled) then
    update private.room_invitation_email_jobs set status='pending',claim_token=null,next_attempt_at=now(),attempts=greatest(attempts-1,0) where invitation_id=p_invitation_id;
    return null;
  end if;
  select * into i from public.room_invitations where id=p_invitation_id;
  if not tempa_private.room_invitation_eligible(i.sender_id,i.recipient_id,i.answer_id)
    or exists(select 1 from public.room_invitation_preferences where user_id=i.recipient_id and not emails_enabled)
    or exists(select 1 from public.question_answers a where a.question_id=i.question_id and a.user_id=i.recipient_id) then
    update private.room_invitation_email_jobs set status='skipped',last_error='no longer eligible' where invitation_id=p_invitation_id; return null;
  end if;
  select email into v_email from auth.users where id=i.recipient_id and email_confirmed_at is not null;
  if v_email is null then update private.room_invitation_email_jobs set status='skipped',last_error='email unavailable' where invitation_id=p_invitation_id; return null; end if;
  if j.snapshot is not null then
    if j.snapshot->>'to' <> v_email or j.first_provider_at < now() - interval '24 hours' then
      update private.room_invitation_email_jobs set status='manual_review',last_error='snapshot address changed or provider idempotency expired' where invitation_id=p_invitation_id; return null;
    end if;
    return j.snapshot;
  end if;
  select pseudonym into v_name from public.profiles where id=i.sender_id;
  select prompt into v_prompt from public.questions where id=i.question_id;
  v_snapshot := jsonb_build_object('from',p_from,'to',v_email,'pseudonym',v_name,'prompt',v_prompt,'questionId',i.question_id,'siteOrigin',p_site_origin,'idempotencyKey','room-invitation/'||i.id);
  update private.room_invitation_email_jobs set snapshot=v_snapshot,first_provider_at=now() where invitation_id=p_invitation_id;
  return v_snapshot;
end
$fn$;

create or replace function public.complete_room_invitation_email(p_invitation_id uuid,p_claim_token uuid,p_ok boolean,p_retryable boolean,p_error text default null)
returns boolean language plpgsql security definer set search_path to 'pg_catalog'
as $fn$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required.'; end if;
  update private.room_invitation_email_jobs set status=case when p_ok then 'sent' when p_retryable and attempts < 5 then 'pending' else 'failed' end,
    next_attempt_at=now()+interval '5 minutes',last_error=left(p_error,500)
  where invitation_id=p_invitation_id and claim_token=p_claim_token and status='processing';
  return found;
end
$fn$;
-- Freeze the exact provider payload as well as the rendering inputs. A later
-- deployment must never render different HTML under the same idempotency key.
create or replace function public.freeze_room_invitation_email(p_invitation_id uuid,p_claim_token uuid,p_request jsonb)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog'
as $fn$
declare j private.room_invitation_email_jobs; i public.room_invitations;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required.'; end if;
  select * into j from private.room_invitation_email_jobs where invitation_id=p_invitation_id and claim_token=p_claim_token and status='processing' for update;
  if not found or j.snapshot is null then return null; end if;
  if not exists(select 1 from private.room_invitation_email_config where singleton and sending_enabled) then
    update private.room_invitation_email_jobs set status='pending',claim_token=null,attempts=greatest(attempts-1,0) where invitation_id=p_invitation_id;
    return null;
  end if;
  select * into i from public.room_invitations where id=p_invitation_id;
  if not tempa_private.room_invitation_eligible(i.sender_id,i.recipient_id,i.answer_id)
    or exists(select 1 from public.room_invitation_preferences where user_id=i.recipient_id and not emails_enabled) then
    update private.room_invitation_email_jobs set status='skipped',last_error='no longer eligible before provider call' where invitation_id=p_invitation_id; return null;
  end if;
  if not exists(select 1 from auth.users where id=i.recipient_id and email_confirmed_at is not null and email=j.snapshot->>'to')
    or j.first_provider_at < now() - interval '24 hours' then
    update private.room_invitation_email_jobs set status='manual_review',last_error='address changed or provider window expired before send' where invitation_id=p_invitation_id; return null;
  end if;
  if j.snapshot ? 'providerRequest' then return j.snapshot->'providerRequest'; end if;
  update private.room_invitation_email_jobs set snapshot = snapshot || jsonb_build_object('providerRequest',p_request) where invitation_id=p_invitation_id;
  return p_request;
end
$fn$;
revoke all on function public.freeze_room_invitation_email(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.freeze_room_invitation_email(uuid,uuid,jsonb) to service_role;
revoke all on function public.claim_room_invitation_emails(integer), public.prepare_room_invitation_email(uuid,uuid,text,text),public.complete_room_invitation_email(uuid,uuid,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_room_invitation_emails(integer), public.prepare_room_invitation_email(uuid,uuid,text,text),public.complete_room_invitation_email(uuid,uuid,boolean,boolean,text) to service_role;
commit;
