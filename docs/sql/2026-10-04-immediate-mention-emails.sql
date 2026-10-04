-- After MENTION_EMAILS_READY. Preserves the current sending switch and all existing outcomes.
begin;
alter table private.mention_email_jobs alter column next_attempt_at set default now();

create or replace function tempa_private.mention_email_skip_reason(p_id uuid)
returns text language plpgsql stable security definer set search_path='pg_catalog' as $$
declare m public.public_mentions; audience text; source_body text;
begin
 select * into m from public.public_mentions where id=p_id;
 if not found then return 'Mention no longer exists'; end if;
 if m.read_at is not null then return 'Mention already opened in Tempa'; end if;
 if m.created_at<=now()-interval '24 hours' then return 'Mention is more than 24 hours old'; end if;
 if m.created_at<(select enabled_since from private.mention_email_config where singleton) then return 'Mention predates latest email activation'; end if;
 if not exists(select 1 from auth.users where id=m.recipient_id and email_confirmed_at is not null and nullif(email,'') is not null) then return 'Recipient has no confirmed email address'; end if;
 if not tempa_private.author_content_publicly_visible(m.sender_id) or not tempa_private.author_content_publicly_visible(m.recipient_id)
 or exists(select 1 from public.account_enforcement_state where user_id in(m.sender_id,m.recipient_id) and status<>'active')
 or exists(select 1 from public.account_deactivations where user_id in(m.sender_id,m.recipient_id) and reactivated_at is null) then return 'Sender or recipient account is unavailable'; end if;
 if tempa_private.is_correspondence_blocked_pair(m.sender_id,m.recipient_id) then return 'A block prevents this notification'; end if;
 select p.audience into audience from public.mention_email_preferences p where p.user_id=m.recipient_id;
 if audience='off' then return 'Recipient turned mention emails off'; end if;
 if audience='correspondents' and not tempa_private.mention_email_correspondents(m.sender_id,m.recipient_id) then return 'Recipient accepts email from correspondents only'; end if;
 select src.body into source_body from tempa_private.mention_source(m.kind,m.source_id,m.recipient_id) src;
 if not found then return 'Writing is no longer visible to the recipient'; end if;
 if not tempa_private.mention_token_present(source_body,m.selected_name) then return 'Mention was removed from the writing'; end if;
 return null;
end $$;
revoke all on function tempa_private.mention_email_skip_reason(uuid) from public,anon,authenticated;

create function public.claim_immediate_mention_emails(p_sender_id uuid)
returns table(mention_id uuid,claim_token uuid)
language plpgsql security definer set search_path='pg_catalog' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required.' using errcode='42501'; end if;
 if p_sender_id is null then return; end if;
 if not exists(select 1 from private.mention_email_config where singleton and sending_enabled) then return; end if;
 -- Concurrent wake-ups cannot reclaim an existing lease or expedite a retry.
 if not pg_try_advisory_xact_lock(hashtextextended(p_sender_id::text,32)) then return; end if;
 return query with picked as (
  select j.mention_id from private.mention_email_jobs j join public.public_mentions m on m.id=j.mention_id
  where m.sender_id=p_sender_id and j.status='pending' and j.attempts=0 and j.next_attempt_at<=now()
  order by j.next_attempt_at,j.mention_id limit 10 for update of j skip locked
 ) update private.mention_email_jobs j set status='processing',claim_token=gen_random_uuid(),claimed_at=now(),attempts=j.attempts+1,updated_at=now()
 from picked where j.mention_id=picked.mention_id returning j.mention_id,j.claim_token;
end $$;
revoke all on function public.claim_immediate_mention_emails(uuid) from public,anon,authenticated;
grant execute on function public.claim_immediate_mention_emails(uuid) to service_role;

create or replace function public.prepare_mention_email(p_mention_id uuid,p_claim_token uuid,p_site_origin text,p_from text)
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
  update private.mention_email_jobs set status='skipped',last_error=coalesce(tempa_private.mention_email_skip_reason(m.id),'Writing is no longer eligible'),snapshot=null,updated_at=now() where mention_id=p_mention_id; return null;
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

create or replace function public.freeze_mention_email(p_mention_id uuid,p_claim_token uuid,p_request jsonb)
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
  update private.mention_email_jobs set status='skipped',last_error=coalesce(tempa_private.mention_email_skip_reason(m.id),'Writing is no longer eligible'),snapshot=null,updated_at=now() where mention_id=p_mention_id; return null;
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

create or replace function public.admin_get_mention_email_status()
returns jsonb language plpgsql stable security definer set search_path='pg_catalog' as $$
begin
 if not public.is_staff('moderator') then raise exception 'Staff access required.' using errcode='42501'; end if;
 return jsonb_build_object('sendingEnabled',(select sending_enabled from private.mention_email_config where singleton),'lastWorkerAt',(select last_worker_at from private.mention_email_config where singleton),'canManage',public.is_staff('admin'),
 'counts',(select coalesce(jsonb_object_agg(s.status,s.n),'{}'::jsonb) from (select status,count(*) as n from private.mention_email_jobs group by status) s),
 'recent',(select coalesce(jsonb_agg(r),'[]'::jsonb) from (select j.mention_id,p.pseudonym as recipient,m.kind,j.status,j.attempts,j.last_error,j.updated_at,j.provider_message_id
  from private.mention_email_jobs j join public.public_mentions m on m.id=j.mention_id left join public.profiles p on p.id=m.recipient_id order by j.updated_at desc limit 30) r));
end $$;

commit;
