-- TEMPA — DEVICE LOCATION INTEGRITY EVIDENCE
-- Forward-only. Raw device coordinates are moderation evidence, never profile data.
begin;

create table if not exists public.user_location_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('signup','writing_trust_review')),
  source text not null check (source in ('device_gps','device_network','permission_denied','unavailable')),
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  claimed_country text,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint location_coordinates_consistent check (
    (source in ('device_gps','device_network') and latitude between -90 and 90 and longitude between -180 and 180)
    or (source in ('permission_denied','unavailable') and latitude is null and longitude is null)
  )
);

create index if not exists user_location_evidence_user_observed_idx
  on public.user_location_evidence (user_id, observed_at desc);

alter table public.user_location_evidence enable row level security;
revoke all on public.user_location_evidence from public, anon, authenticated;

create or replace function public.record_my_location_evidence(
  p_purpose text,
  p_source text,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy_m double precision default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_country text;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if p_purpose not in ('signup','writing_trust_review') then raise exception 'invalid purpose'; end if;
  if p_source not in ('device_gps','device_network','permission_denied','unavailable') then raise exception 'invalid source'; end if;
  if p_source in ('device_gps','device_network') and
     (p_latitude is null or p_longitude is null or p_latitude not between -90 and 90 or p_longitude not between -180 and 180)
  then raise exception 'valid coordinates required'; end if;
  if p_source in ('permission_denied','unavailable') and (p_latitude is not null or p_longitude is not null)
  then raise exception 'coordinates must be absent'; end if;

  if p_purpose = 'signup' then
    select id into v_id from public.user_location_evidence
    where user_id=v_user and purpose='signup' order by observed_at asc limit 1;
    if v_id is not null then return v_id; end if;
  end if;

  select country into v_country from public.profiles where id = v_user;

  insert into public.user_location_evidence(user_id,purpose,source,latitude,longitude,accuracy_m,claimed_country)
  values(v_user,p_purpose,p_source,p_latitude,p_longitude,p_accuracy_m,v_country)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.record_my_location_evidence(text,text,double precision,double precision,double precision) from public, anon;
grant execute on function public.record_my_location_evidence(text,text,double precision,double precision,double precision) to authenticated;

create or replace function public.admin_list_location_evidence(p_user_id uuid, p_limit integer default 20)
returns table(id uuid,purpose text,source text,latitude double precision,longitude double precision,accuracy_m double precision,claimed_country text,observed_at timestamptz)
language plpgsql security definer set search_path=public
as $$
begin
  if not public.is_staff('moderator') then raise exception 'staff access required'; end if;
  return query
    select e.id,e.purpose,e.source,e.latitude,e.longitude,e.accuracy_m,e.claimed_country,e.observed_at
    from public.user_location_evidence e
    where e.user_id=p_user_id
    order by e.observed_at desc
    limit greatest(1,least(coalesce(p_limit,20),100));
end;
$$;
revoke all on function public.admin_list_location_evidence(uuid,integer) from public, anon, authenticated;
grant execute on function public.admin_list_location_evidence(uuid,integer) to authenticated;

comment on table public.user_location_evidence is 'Restricted anti-abuse evidence. Raw device location is never public/member-readable and must not be used as automatic proof of deception.';
commit;

-- verification: all booleans should be true
select
  to_regclass('public.user_location_evidence') is not null as evidence_table_exists,
  not has_table_privilege('authenticated','public.user_location_evidence','SELECT') as members_cannot_read_raw_evidence,
  has_function_privilege('authenticated','public.record_my_location_evidence(text,text,double precision,double precision,double precision)','EXECUTE') as member_can_submit_own_evidence,
  has_function_privilege('authenticated','public.admin_list_location_evidence(uuid,integer)','EXECUTE') as admin_rpc_callable;
