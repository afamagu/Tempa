-- Apply after PUBLIC_MENTIONS_READY. No historical backfill. Sending starts OFF.
begin;
create table public.mention_email_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 audience text not null default 'everyone' check(audience in ('everyone','correspondents','off'))
);
alter table public.mention_email_preferences enable row level security;
revoke all on public.mention_email_preferences from public,anon,authenticated;
grant select on public.mention_email_preferences to authenticated;
create policy mention_email_preference_owner on public.mention_email_preferences for select to authenticated using(user_id=auth.uid());
create table private.mention_email_config (
 singleton boolean primary key default true check(singleton),
 sending_enabled boolean not null default false, enabled_since timestamptz, last_worker_at timestamptz
);
insert into private.mention_email_config(singleton) values(true);
create table private.mention_email_jobs (
 mention_id uuid primary key references public.public_mentions(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','processing','sent','skipped','failed','manual_review')),
 attempts integer not null default 0, claim_token uuid, claimed_at timestamptz,
 next_attempt_at timestamptz not null default now()+interval '2 minutes',
 snapshot jsonb, first_provider_at timestamptz, provider_message_id text,
 last_error text, updated_at timestamptz not null default now()
);
create index mention_email_pending on private.mention_email_jobs(status,next_attempt_at);
alter table private.mention_email_config enable row level security;
alter table private.mention_email_jobs enable row level security;
revoke all on private.mention_email_config,private.mention_email_jobs from public,anon,authenticated;

create function public.set_mention_email_preference(p_audience text)
returns void language plpgsql security definer set search_path='pg_catalog' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required.' using errcode='42501'; end if;
 if p_audience is null or p_audience not in ('everyone','correspondents','off') then raise exception 'Invalid preference.'; end if;
 insert into public.mention_email_preferences(user_id,audience) values(auth.uid(),p_audience)
 on conflict(user_id) do update set audience=excluded.audience;
end $$;
revoke all on function public.set_mention_email_preference(text) from public,anon;
grant execute on function public.set_mention_email_preference(text) to authenticated;

create function tempa_private.mention_email_correspondents(p_sender uuid,p_recipient uuid)
returns boolean language sql stable security definer set search_path='pg_catalog' as $$
 select exists(select 1 from public.correspondences c where c.status='active' and c.established_at is not null
  and ((c.participant_low=p_sender and c.participant_high=p_recipient) or (c.participant_high=p_sender and c.participant_low=p_recipient))
  and not exists(select 1 from public.correspondence_hidden_for_user h where h.correspondence_id=c.id and h.user_id in(p_sender,p_recipient)))
$$;
create function tempa_private.mention_email_eligible(p_id uuid)
returns boolean language sql stable security definer set search_path='pg_catalog' as $$
 select exists(select 1 from public.public_mentions m
 cross join lateral tempa_private.mention_source(m.kind,m.source_id,m.recipient_id) src
 join auth.users u on u.id=m.recipient_id
 left join public.mention_email_preferences p on p.user_id=m.recipient_id
 where m.id=p_id and m.read_at is null and m.created_at>now()-interval '24 hours'
 and u.email_confirmed_at is not null and nullif(u.email,'') is not null
 and tempa_private.author_content_publicly_visible(m.sender_id)
 and tempa_private.author_content_publicly_visible(m.recipient_id)
 and not exists(select 1 from public.account_enforcement_state e where e.user_id in(m.sender_id,m.recipient_id) and e.status<>'active')
 and not exists(select 1 from public.account_deactivations d where d.user_id in(m.sender_id,m.recipient_id) and d.reactivated_at is null)
 and not tempa_private.is_correspondence_blocked_pair(m.sender_id,m.recipient_id)
 and tempa_private.mention_token_present(src.body,m.selected_name)
 and coalesce(p.audience,'everyone')<>'off'
 and (coalesce(p.audience,'everyone')='everyone' or tempa_private.mention_email_correspondents(m.sender_id,m.recipient_id)))
$$;
revoke all on function tempa_private.mention_email_correspondents(uuid,uuid),tempa_private.mention_email_eligible(uuid) from public,anon,authenticated;

create function tempa_private.enqueue_mention_email()
returns trigger language plpgsql security definer set search_path='pg_catalog' as $$
begin
 if exists(select 1 from private.mention_email_config where singleton and sending_enabled and new.created_at>=enabled_since)
 and tempa_private.mention_email_eligible(new.id) then
  insert into private.mention_email_jobs(mention_id) values(new.id) on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function tempa_private.enqueue_mention_email() from public,anon,authenticated;
create trigger enqueue_public_mention_email after insert on public.public_mentions for each row execute function tempa_private.enqueue_mention_email();

create function public.claim_mention_emails(p_limit integer default 10)
returns table(mention_id uuid,claim_token uuid)
language plpgsql security definer set search_path='pg_catalog' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required.' using errcode='42501'; end if;
 update private.mention_email_config set last_worker_at=now() where singleton;
 if not exists(select 1 from private.mention_email_config where singleton and sending_enabled) then return; end if;
 update private.mention_email_jobs j set status='manual_review',last_error='Delivery uncertain; retry window ended',updated_at=now()
 where j.status in ('pending','processing') and ((j.first_provider_at<now()-interval '23 hours') or (j.status='processing' and j.attempts>=5 and j.claimed_at<now()-interval '15 minutes'));
 return query with picked as (
  select j.mention_id from private.mention_email_jobs j
  where ((j.status='pending' and j.next_attempt_at<=now()) or (j.status='processing' and j.claimed_at<now()-interval '15 minutes'))
  and j.attempts<5 order by j.next_attempt_at,j.mention_id
  limit least(greatest(coalesce(p_limit,10),1),10) for update skip locked
 ) update private.mention_email_jobs j set status='processing',claim_token=gen_random_uuid(),claimed_at=now(),attempts=j.attempts+1,updated_at=now()
 from picked where j.mention_id=picked.mention_id returning j.mention_id,j.claim_token;
end $$;

create function public.prepare_mention_email(p_mention_id uuid,p_claim_token uuid,p_site_origin text,p_from text)
returns jsonb language plpgsql security definer set search_path='pg_catalog' as $$
declare j private.mention_email_jobs; m public.public_mentions; email text; name text; result jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required.' using errcode='42501'; end if;
 if p_site_origin is distinct from 'https://jointempa.com' or nullif(btrim(p_from),'') is null then raise exception 'Invalid email configuration.'; end if;
 select * into j from private.mention_email_jobs where mention_id=p_mention_id and claim_token=p_claim_token and status='processing' for update;
 if not found then return null; end if;
 if not exists(select 1 from private.mention_email_config where singleton and sending_enabled) then
  update private.mention_email_jobs set status='pending',claim_token=null,attempts=greatest(attempts-1,0),updated_at=now() where mention_id=p_mention_id; return null;
 end if;
 select * into m from public.public_mentions where id=p_mention_id;
 if not tempa_private.mention_email_eligible(m.id) or m.created_at<(select enabled_since from private.mention_email_config where singleton) then
  update private.mention_email_jobs set status='skipped',last_error='Read, unavailable, preference changed, or predates activation',snapshot=null,updated_at=now() where mention_id=p_mention_id; return null;
 end if;
 select u.email into email from auth.users u where u.id=m.recipient_id;
 if j.snapshot is not null then
  if j.snapshot->>'to' is distinct from email or j.first_provider_at<now()-interval '23 hours' then
   update private.mention_email_jobs set status='manual_review',last_error='Address changed or retry window ended',updated_at=now() where mention_id=p_mention_id; return null;
  end if;
  return j.snapshot;
 end if;
 select case when d.published_as='tempa' then 'Tempa' when d.published_as='sponsored' then coalesce(nullif(d.sponsor_name,''),'Tempa') else p.pseudonym end
 into name from public.profiles p left join public.dispatches d on m.kind='dispatch' and d.id=m.source_id where p.id=m.sender_id;
 result:=jsonb_build_object('from',p_from,'to',email,'pseudonym',name,'kind',m.kind,'mentionId',m.id,'siteOrigin',p_site_origin,'idempotencyKey','public-mention/'||m.id);
 update private.mention_email_jobs set snapshot=result,updated_at=now() where mention_id=p_mention_id;
 return result;
end $$;

create function public.freeze_mention_email(p_mention_id uuid,p_claim_token uuid,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='pg_catalog' as $$
declare j private.mention_email_jobs; m public.public_mentions;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required.' using errcode='42501'; end if;
 select * into j from private.mention_email_jobs where mention_id=p_mention_id and claim_token=p_claim_token and status='processing' for update;
 if not found or j.snapshot is null then return null; end if;
 if not exists(select 1 from private.mention_email_config where singleton and sending_enabled) then
  update private.mention_email_jobs set status='pending',claim_token=null,attempts=greatest(attempts-1,0),updated_at=now() where mention_id=p_mention_id; return null;
 end if;
 select * into m from public.public_mentions where id=p_mention_id;
 if not tempa_private.mention_email_eligible(m.id) or m.created_at<(select enabled_since from private.mention_email_config where singleton) then
  update private.mention_email_jobs set status='skipped',last_error='No longer eligible before sending',snapshot=null,updated_at=now() where mention_id=p_mention_id; return null;
 end if;
 if not exists(select 1 from auth.users u where u.id=m.recipient_id and u.email=j.snapshot->>'to' and u.email_confirmed_at is not null)
 or j.first_provider_at<now()-interval '23 hours' then
  update private.mention_email_jobs set status='manual_review',last_error='Address changed or retry window ended',updated_at=now() where mention_id=p_mention_id; return null;
 end if;
 if j.snapshot ? 'providerRequest' then return j.snapshot->'providerRequest'; end if;
 if jsonb_typeof(p_request) is distinct from 'object' or p_request->>'to' is distinct from j.snapshot->>'to'
 or p_request->>'from' is distinct from j.snapshot->>'from' or p_request->>'idempotencyKey' is distinct from j.snapshot->>'idempotencyKey'
 or nullif(p_request->>'subject','') is null or nullif(p_request->>'html','') is null or nullif(p_request->>'text','') is null then raise exception 'Invalid email request.'; end if;
 -- Reserve the recipient's send budget across concurrent workers. Suppressed
 -- burst notifications remain available in-app; they are not replayed later.
 perform pg_advisory_xact_lock(hashtextextended(m.recipient_id::text,31));
 if exists(select 1 from private.mention_email_jobs x join public.public_mentions other on other.id=x.mention_id
  where other.recipient_id=m.recipient_id and x.mention_id<>m.id and x.first_provider_at>now()-interval '15 minutes')
 or (select count(*) from private.mention_email_jobs x join public.public_mentions other on other.id=x.mention_id
  where other.recipient_id=m.recipient_id and x.first_provider_at>now()-interval '1 day')>=10
 or (not tempa_private.mention_email_correspondents(m.sender_id,m.recipient_id) and
  (select count(*) from private.mention_email_jobs x join public.public_mentions other on other.id=x.mention_id
   where other.recipient_id=m.recipient_id and x.first_provider_at>now()-interval '1 day'
   and not tempa_private.mention_email_correspondents(other.sender_id,other.recipient_id))>=2) then
  update private.mention_email_jobs set status='skipped',last_error='Email frequency limit; mention remains in-app',snapshot=null,updated_at=now() where mention_id=p_mention_id; return null;
 end if;
 update private.mention_email_jobs set snapshot=snapshot||jsonb_build_object('providerRequest',p_request),first_provider_at=now(),updated_at=now() where mention_id=p_mention_id;
 return p_request;
end $$;

create function public.complete_mention_email(p_mention_id uuid,p_claim_token uuid,p_ok boolean,p_retryable boolean,p_provider_message_id text default null)
returns boolean language plpgsql security definer set search_path='pg_catalog' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required.' using errcode='42501'; end if;
 update private.mention_email_jobs set status=case when p_ok then 'sent' when p_retryable and attempts<5 then 'pending' when p_retryable then 'manual_review' else 'failed' end,
  next_attempt_at=now()+interval '5 minutes',provider_message_id=case when p_ok then left(p_provider_message_id,200) else provider_message_id end,
  last_error=case when p_ok then null when p_retryable then 'Temporary or uncertain provider result' else 'Provider rejected request' end,
  snapshot=case when p_ok or not p_retryable then null else snapshot end,updated_at=now()
 where mention_id=p_mention_id and claim_token=p_claim_token and status='processing';
 return found;
end $$;
revoke all on function public.claim_mention_emails(integer),public.prepare_mention_email(uuid,uuid,text,text),public.freeze_mention_email(uuid,uuid,jsonb),public.complete_mention_email(uuid,uuid,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_mention_emails(integer),public.prepare_mention_email(uuid,uuid,text,text),public.freeze_mention_email(uuid,uuid,jsonb),public.complete_mention_email(uuid,uuid,boolean,boolean,text) to service_role;

create function public.admin_get_mention_email_status()
returns jsonb language plpgsql stable security definer set search_path='pg_catalog' as $$
begin
 if not public.is_staff('moderator') then raise exception 'Staff access required.' using errcode='42501'; end if;
 return jsonb_build_object('sendingEnabled',(select sending_enabled from private.mention_email_config where singleton),'lastWorkerAt',(select last_worker_at from private.mention_email_config where singleton),'canManage',public.is_staff('admin'),
 'counts',(select coalesce(jsonb_object_agg(s.status,s.n),'{}'::jsonb) from (select status,count(*) as n from private.mention_email_jobs group by status) s),
 'recent',(select coalesce(jsonb_agg(r),'[]'::jsonb) from (select j.mention_id,p.pseudonym as recipient,m.kind,j.status,j.attempts,j.last_error,j.updated_at
  from private.mention_email_jobs j join public.public_mentions m on m.id=j.mention_id left join public.profiles p on p.id=m.recipient_id order by j.updated_at desc limit 30) r));
end $$;
create function public.set_mention_email_sending_enabled(p_enabled boolean)
returns void language plpgsql security definer set search_path='pg_catalog' as $$
begin
 if not public.is_staff('admin') then raise exception 'Admin access required.' using errcode='42501'; end if;
 if p_enabled is null then raise exception 'Enabled must be specified.'; end if;
 update private.mention_email_config set enabled_since=case when p_enabled and not sending_enabled then now() else enabled_since end,sending_enabled=p_enabled where singleton;
 insert into public.admin_audit_log(actor_id,actor_identifier_snapshot,action,target_type,target_identifier_snapshot,metadata)
 values(auth.uid(),coalesce((select pseudonym from public.profiles where id=auth.uid()),auth.uid()::text),'mention_email_sending_changed','system','mention_emails',jsonb_build_object('enabled',p_enabled));
end $$;
revoke all on function public.admin_get_mention_email_status(),public.set_mention_email_sending_enabled(boolean) from public,anon;
grant execute on function public.admin_get_mention_email_status(),public.set_mention_email_sending_enabled(boolean) to authenticated;
commit;
