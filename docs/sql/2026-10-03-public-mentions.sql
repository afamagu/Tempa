-- Public mention identity, atomic publication, and recipient notifications.
-- No email sending is enabled by this migration.
begin;
do $$
declare operation text; installed integer;
begin
 foreach operation in array array['publish_dispatch','update_dispatch','publish_official_dispatch','update_official_dispatch',
  'publish_dispatch_with_web_visibility','update_dispatch_with_web_visibility',
  'publish_official_dispatch_with_web_visibility','update_official_dispatch_with_web_visibility',
  'publish_question_answer','create_reply'] loop
  select count(*) into installed from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname=operation and p.prokind='f';
  if installed<>1 then raise exception 'Expected one installed public.% publication function; found %. Nothing applied.',operation,installed; end if;
 end loop;
end $$;
-- Shared by the picker and publication: selecting a non-correspondent is
-- allowed, but never bypasses account, discovery or block restrictions.
create function public.can_mention_member(p_member uuid)
returns boolean language sql stable security definer set search_path='pg_catalog' as $$
 select auth.uid() is not null and p_member is not null and p_member<>auth.uid()
 and public.current_account_status()='active'
 and tempa_private.author_content_publicly_visible(p_member)
 and not tempa_private.is_blocked_pair(auth.uid(),p_member)
 and not tempa_private.is_correspondence_blocked_pair(auth.uid(),p_member)
 and not tempa_private.hidden_from_discovery(auth.uid(),p_member)
 and exists(select 1 from public.public_profiles p where p.id=p_member and nullif(btrim(p.pseudonym),'') is not null)
$$;
revoke all on function public.can_mention_member(uuid) from public,anon;
grant execute on function public.can_mention_member(uuid) to authenticated;

create function public.mention_picker_page(p_search text default '',p_limit integer default 21,p_offset integer default 0)
returns table(user_id uuid,pseudonym text,mark_id uuid)
language sql stable security invoker set search_path='pg_catalog' as $$
 with partners as (
  select c.id,case when c.participant_low=auth.uid() then c.participant_high else c.participant_low end as user_id
  from public.correspondences c where c.status='active' and c.established_at is not null
  and (c.participant_low=auth.uid() or c.participant_high=auth.uid())
  and not exists(select 1 from public.correspondence_hidden_for_user h where h.user_id=auth.uid() and h.correspondence_id=c.id)
 ), ranked as (
  select c.user_id,count(l.id) as exchanges,max(l.created_at) as latest
  from partners c join public.letters_for_participant l on l.correspondence_id=c.id
  where public.can_pick_correspondent(c.user_id) group by c.user_id
 )
 select p.id,p.pseudonym,p.mark_id from public.public_profiles p left join ranked r on r.user_id=p.id
 where public.can_mention_member(p.id)
 and case when nullif(btrim(p_search),'') is null then r.user_id is not null
  else starts_with(lower(p.pseudonym),lower(btrim(p_search))) end
 order by (r.user_id is not null) desc,r.exchanges desc nulls last,r.latest desc nulls last,lower(p.pseudonym),p.id
 limit least(greatest(coalesce(p_limit,21),1),21) offset least(greatest(coalesce(p_offset,0),0),100000)
$$;
revoke all on function public.mention_picker_page(text,integer,integer) from public,anon;
grant execute on function public.mention_picker_page(text,integer,integer) to authenticated;

create table public.public_mentions (
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in ('dispatch','reply','answer')),
 source_id uuid not null,
 sender_id uuid not null references auth.users(id) on delete cascade,
 recipient_id uuid not null references auth.users(id) on delete cascade,
 selected_name text not null,
 created_at timestamptz not null default now(),
 read_at timestamptz,
 unique(kind,source_id,recipient_id),
 check(sender_id <> recipient_id)
);
alter table public.public_mentions enable row level security;
revoke all on public.public_mentions from public,anon,authenticated;
create index public_mentions_recipient on public.public_mentions(recipient_id,created_at desc);
create index public_mentions_sender_created on public.public_mentions(sender_id,created_at);

create function tempa_private.mention_token_present(p_body text,p_name text)
returns boolean language plpgsql immutable set search_path='pg_catalog' as $$
declare v_tail text:=coalesce(p_body,''); v_token text:='@'||p_name; v_at integer; v_before text; v_after text;
begin
 if p_name is null or p_name='' then return false; end if;
 loop
  v_at:=strpos(v_tail,v_token); if v_at=0 then return false; end if;
  v_before:=case when v_at>1 then substr(v_tail,v_at-1,1) else '' end;
  v_after:=substr(v_tail,v_at+length(v_token),1);
  if v_before !~ '[[:alnum:]_@]' and v_after !~ '[[:alnum:]_]' then return true; end if;
  v_tail:=substr(v_tail,v_at+length(v_token));
 end loop;
end $$;
revoke all on function tempa_private.mention_token_present(text,text) from public,anon,authenticated;

-- Every read rechecks source visibility; removed/hidden/blocked writing disappears.
create function tempa_private.mention_source(p_kind text,p_id uuid,p_viewer uuid)
returns table(author_id uuid,body text,href text)
language plpgsql stable security definer set search_path='pg_catalog' as $$
begin
 if p_viewer is null or not tempa_private.author_content_publicly_visible(p_viewer) then return; end if;
 if p_kind='dispatch' then
  return query select d.author_id,d.body,'/board/'||d.id::text
   from public.dispatches d where d.id=p_id and d.status='published' and d.moderation_status='visible'
   and tempa_private.author_content_publicly_visible(d.author_id)
   and not tempa_private.is_blocked_pair(p_viewer,d.author_id);
 elsif p_kind='reply' then
  return query select r.author_id,r.body,'/board/'||d.id::text||'#reply-'||r.id::text
   from public.dispatch_replies r join public.dispatches d on d.id=r.dispatch_id
   where r.id=p_id and r.deleted_at is null and r.moderation_status='visible'
   and d.status='published' and d.moderation_status='visible'
   and tempa_private.author_content_publicly_visible(d.author_id)
   and tempa_private.author_content_publicly_visible(r.author_id)
   and not tempa_private.is_blocked_pair(p_viewer,d.author_id)
   and not tempa_private.is_blocked_pair(p_viewer,r.author_id);
 elsif p_kind='answer' then
  return query select a.user_id,a.body,'/room/'||a.user_id::text||'?answer='||a.id::text||'&returnTo=%2Fhome'
   from public.question_answers a join public.questions q on q.id=a.question_id
   where a.id=p_id and a.moderation_status='visible'
   and (q.is_flagship or (q.is_active and q.current_position is not null)
    or exists(select 1 from public.admin_audit_log l where l.target_type='question' and l.target_id=q.id and l.action='room_question_made_current'))
   and tempa_private.author_content_publicly_visible(a.user_id)
   and not tempa_private.is_blocked_pair(p_viewer,a.user_id)
   and not tempa_private.hidden_from_discovery(p_viewer,a.user_id);
 end if;
end $$;
revoke all on function tempa_private.mention_source(text,uuid,uuid) from public,anon,authenticated;

create function public.sync_public_mentions(p_kind text,p_source_id uuid,p_mentions jsonb)
returns void language plpgsql security definer set search_path='pg_catalog' as $$
declare src record; selection record; recipient uuid; actual_name text;
begin
 if auth.uid() is null then raise exception 'Member access required.' using errcode='42501'; end if;
 if jsonb_typeof(p_mentions) <> 'array' or p_mentions is null or jsonb_array_length(p_mentions)>50 then
  raise exception 'Invalid mentions.';
 end if;
 select * into src from tempa_private.mention_source(p_kind,p_source_id,auth.uid());
 if src.author_id is distinct from auth.uid() then raise exception 'Writing unavailable.' using errcode='42501'; end if;
 -- Serialize this sender's checks so concurrent publications cannot exceed
 -- notification limits. Existing events never count as a new notification.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 -- Existing records remain as deduplication history. Visibility checks below
 -- suppress removed names; re-adding the same person never creates another alert.
 for selection in select value as person from jsonb_array_elements(p_mentions) loop
  recipient:=(selection.person->>'userId')::uuid;
  if not public.can_mention_member(recipient) then raise exception 'A selected member is no longer available.'; end if;
  select p.pseudonym into actual_name from public.profiles p where p.id=recipient;
  if actual_name is distinct from selection.person->>'pseudonym' then raise exception 'A selected name changed. Please select that person again.'; end if;
  if not tempa_private.mention_token_present(src.body,actual_name) then continue; end if;
  if not exists(select 1 from tempa_private.mention_source(p_kind,p_source_id,recipient)) then raise exception 'This person cannot view the writing.'; end if;
  if not exists(select 1 from public.public_mentions m where m.kind=p_kind and m.source_id=p_source_id and m.recipient_id=recipient) then
   if (select count(*) from public.public_mentions m where m.sender_id=auth.uid() and m.created_at>now()-interval '1 day')>=100
    or (select count(*) from public.public_mentions m where m.sender_id=auth.uid() and m.recipient_id=recipient and m.created_at>now()-interval '1 day')>=10 then
    raise exception 'Mention notification limit reached. Remove the new mention or try again later.';
   end if;
  end if;
  insert into public.public_mentions(kind,source_id,sender_id,recipient_id,selected_name)
   values(p_kind,p_source_id,auth.uid(),recipient,actual_name) on conflict(kind,source_id,recipient_id) do nothing;
 end loop;
end $$;
revoke all on function public.sync_public_mentions(text,uuid,jsonb) from public,anon;
grant execute on function public.sync_public_mentions(text,uuid,jsonb) to authenticated;

-- SECURITY INVOKER: the existing publication RPC retains all its permissions,
-- Safety checks and return shape. Only this fixed public-RPC allowlist is callable.
-- Catalog argument types avoid copying and downgrading installed RPC bodies.
create function public.publish_with_mentions(p_operation text,p_arguments jsonb,p_mentions jsonb)
returns jsonb language plpgsql security invoker set search_path='pg_catalog' as $$
declare f record; arg record; calls text:=''; expr text; result jsonb; source_id uuid; kind text;
begin
 if auth.uid() is null then raise exception 'Member access required.' using errcode='42501'; end if;
 if p_operation not in ('publish_dispatch','update_dispatch','publish_official_dispatch','update_official_dispatch',
  'publish_dispatch_with_web_visibility','update_dispatch_with_web_visibility',
  'publish_official_dispatch_with_web_visibility','update_official_dispatch_with_web_visibility',
  'publish_question_answer','create_reply') then raise exception 'Unsupported publication.'; end if;
 if p_arguments is null or jsonb_typeof(p_arguments)<>'object' then raise exception 'Invalid publication arguments.'; end if;
 select p.oid,p.proargnames,p.proargtypes into strict f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname=p_operation and p.prokind='f';
 if exists(select 1 from jsonb_object_keys(p_arguments) k where not k=any(f.proargnames)) then raise exception 'Unknown publication argument.'; end if;
 for arg in select f.proargnames[i+1] as name,format_type(f.proargtypes[i],null) as typename
  from generate_series(0,array_length(f.proargnames,1)-1) i loop
  if not p_arguments ? arg.name then continue; end if;
  if arg.typename='jsonb' then expr:=format('nullif($1->%L,''null''::jsonb)',arg.name);
  elsif arg.typename in ('text[]','uuid[]') then
   expr:=format('(case when $1->%L=''null''::jsonb then null else array(select jsonb_array_elements_text($1->%L))::%s end)',arg.name,arg.name,arg.typename);
  else expr:=format('($1->>%L)::%s',arg.name,arg.typename); end if;
  calls:=calls||case when calls='' then '' else ',' end||format('%I => %s',arg.name,expr);
 end loop;
 if p_mentions is null or jsonb_typeof(p_mentions)<>'array' or jsonb_array_length(p_mentions)>50 then raise exception 'Invalid mentions.'; end if;
 execute format('select to_jsonb(public.%I(%s))',p_operation,calls) into result using p_arguments;
 if jsonb_array_length(p_mentions)=0 then return result; end if;
 kind:=case when p_operation='publish_question_answer' then 'answer' when p_operation='create_reply' then 'reply' else 'dispatch' end;
 source_id:=coalesce(result->>'id',case when jsonb_typeof(result)='string' then result#>>'{}' else null end)::uuid;
 if source_id is null then raise exception 'Publication did not return an identifier.'; end if;
 perform public.sync_public_mentions(kind,source_id,p_mentions);
 return result;
end $$;
revoke all on function public.publish_with_mentions(text,jsonb,jsonb) from public,anon;
grant execute on function public.publish_with_mentions(text,jsonb,jsonb) to authenticated;

create function public.get_public_mentions(p_offset integer default 0,p_unread_only boolean default false)
returns table(id uuid,kind text,pseudonym text,created_at timestamptz,read_at timestamptz)
language sql stable security definer set search_path='pg_catalog' as $$
 select m.id,m.kind,case when d.published_as='tempa' then 'Tempa'
  when d.published_as='sponsored' then coalesce(nullif(d.sponsor_name,''),'Tempa') else p.pseudonym end,m.created_at,m.read_at
 from public.public_mentions m join public.profiles p on p.id=m.sender_id
 left join public.dispatches d on m.kind='dispatch' and d.id=m.source_id
 cross join lateral tempa_private.mention_source(m.kind,m.source_id,auth.uid()) src
 where m.recipient_id=auth.uid()
 and (not coalesce(p_unread_only,false) or m.read_at is null)
 and not tempa_private.is_correspondence_blocked_pair(m.sender_id,m.recipient_id)
 and tempa_private.mention_token_present(src.body,m.selected_name)
 order by m.created_at desc,m.id desc limit 21 offset least(greatest(coalesce(p_offset,0),0),100000)
$$;
revoke all on function public.get_public_mentions(integer,boolean) from public,anon;
grant execute on function public.get_public_mentions(integer,boolean) to authenticated;

create function public.open_public_mention(p_id uuid)
returns text language plpgsql security definer set search_path='pg_catalog' as $$
declare m public.public_mentions; src record;
begin
 select * into m from public.public_mentions where id=p_id and recipient_id=auth.uid();
 if not found then return null; end if;
 if tempa_private.is_correspondence_blocked_pair(m.sender_id,m.recipient_id) then return null; end if;
 select * into src from tempa_private.mention_source(m.kind,m.source_id,auth.uid());
 if not found or not tempa_private.mention_token_present(src.body,m.selected_name) then return null; end if;
 update public.public_mentions set read_at=coalesce(read_at,now()) where id=m.id;
 return src.href;
end $$;
revoke all on function public.open_public_mention(uuid) from public,anon;
grant execute on function public.open_public_mention(uuid) to authenticated;
commit;
