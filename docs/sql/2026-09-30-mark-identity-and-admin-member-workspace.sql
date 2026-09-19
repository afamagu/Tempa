-- TEMPA — Mark identity management + Admin member workspace
-- PREPARED 2026-09-19. DO NOT EXECUTE without review and live preflight.
-- Depends on the prepared 2026-09-29 Your Mark production migration and
-- the already-live Admin/Letters/Scoped Blocking migrations.
-- No source photograph is accepted or stored by any object in this file.

begin;

-- Fail before mutation if the contracts this migration extends are absent.
do $prerequisite$
begin
  if to_regclass('public.profile_marks') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles' and column_name = 'mark_id'
     )
     or to_regprocedure('public.reserve_profile_mark()') is null
     or to_regprocedure('public.discard_profile_mark(uuid)') is null
     or to_regprocedure('public.finalize_profile_mark(uuid)') is null then
    raise exception 'PREREQUISITE FAILED: apply and verify 2026-09-29-your-mark-production.sql first.';
  end if;

  if to_regprocedure('public.is_staff(text)') is null
     or to_regprocedure('public.admin_list_members(text,text,text,timestamptz,timestamptz,integer,integer)') is null
     or to_regprocedure('public.admin_get_member(uuid)') is null
     or to_regprocedure('public.get_blocked_profiles()') is null
     or to_regprocedure('tempa_private.is_correspondence_blocked_pair(uuid,uuid)') is null
     or to_regclass('public.correspondences_one_active_per_pair') is null
     or to_regclass('public.admin_audit_log') is null then
    raise exception 'PREREQUISITE FAILED: live Admin, correspondence, or scoped-blocking contract is missing.';
  end if;
end
$prerequisite$;

-- Owner-only management state. mark_id is already public through the
-- block-aware public_profiles view; next_change_at remains owner-private.
create or replace function public.get_profile_mark_management_status()
returns table(mark_id uuid, can_change boolean, next_change_at timestamptz)
language plpgsql
security definer
set search_path to 'pg_catalog'
stable
as $function$
declare
  v_profile public.profiles%rowtype;
  v_finalized_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles where id = auth.uid();
  if not found then raise exception 'Profile not found.'; end if;

  if v_profile.mark_id is not null then
    select pm.finalized_at into v_finalized_at
    from public.profile_marks pm
    where pm.id = v_profile.mark_id
      and pm.owner_id = auth.uid()
      and pm.status = 'active';
  end if;

  return query select
    v_profile.mark_id,
    v_profile.mark_id is null
      or (v_finalized_at is not null and v_finalized_at + interval '30 days' <= now()),
    case
      when v_profile.mark_id is null or v_finalized_at is null then null
      else v_finalized_at + interval '30 days'
    end;
end;
$function$;

revoke all on function public.get_profile_mark_management_status() from public, anon;
grant execute on function public.get_profile_mark_management_status() to authenticated;

-- Replacement cooldown is checked before a new pending candidate may exist.
-- A member with no Mark is always allowed their first creation.
create or replace function public.reserve_profile_mark()
returns table(mark_id uuid, object_name text, uploaded boolean)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_profile public.profiles%rowtype;
  v_mark public.profile_marks%rowtype;
  v_current_finalized_at timestamptz;
  v_object_name text;
  v_uploaded boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles
  where id = auth.uid() for update;
  if not found then raise exception 'Create your profile before creating a Mark.'; end if;
  if v_profile.onboarding_stage not in ('mark', 'complete') then
    raise exception 'A new Mark cannot be reserved at this onboarding step.';
  end if;

  if v_profile.mark_id is not null then
    select pm.finalized_at into v_current_finalized_at
    from public.profile_marks pm
    where pm.id = v_profile.mark_id and pm.owner_id = auth.uid() and pm.status = 'active';
    if v_current_finalized_at is null then
      raise exception 'The current Mark state is invalid.';
    end if;
    if v_current_finalized_at + interval '30 days' > now() then
      raise exception 'Your Mark can be changed only once every 30 days.' using errcode = 'P0001';
    end if;
  end if;

  select * into v_mark from public.profile_marks pm
  where pm.owner_id = auth.uid() and pm.status = 'pending'
  for update;

  if not found then
    insert into public.profile_marks(owner_id, status)
    values (auth.uid(), 'pending') returning * into v_mark;
  end if;

  v_object_name := v_mark.id::text || '.png';
  select exists (
    select 1 from storage.objects so
    where so.bucket_id = 'profile-marks' and so.name = v_object_name
  ) into v_uploaded;

  return query select v_mark.id, v_object_name, v_uploaded;
end;
$function$;

revoke all on function public.reserve_profile_mark() from public, anon;
grant execute on function public.reserve_profile_mark() to authenticated;

-- Re-check the cooldown while holding the profile row lock. This prevents a
-- stale or malicious client from reserving in one state and finalizing after
-- a conflicting Mark transition. Existing idempotent retry remains first.
create or replace function public.finalize_profile_mark(p_mark_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_profile public.profiles%rowtype;
  v_mark public.profile_marks%rowtype;
  v_current_finalized_at timestamptz;
  v_object_name text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles
  where id = auth.uid() for update;
  if not found then raise exception 'Create your profile before finalizing a Mark.'; end if;

  select * into v_mark from public.profile_marks pm
  where pm.id = p_mark_id and pm.owner_id = auth.uid()
  for update;
  if not found then raise exception 'Mark reservation not found.'; end if;

  if v_mark.status = 'active' and v_profile.mark_id = v_mark.id then
    return v_mark.id;
  end if;
  if v_mark.status <> 'pending' then raise exception 'This Mark is no longer an active reservation.'; end if;
  if v_profile.onboarding_stage not in ('mark', 'complete') then
    raise exception 'A Mark cannot be finalized at this onboarding step.';
  end if;

  if v_profile.mark_id is not null then
    select pm.finalized_at into v_current_finalized_at
    from public.profile_marks pm
    where pm.id = v_profile.mark_id and pm.owner_id = auth.uid() and pm.status = 'active';
    if v_current_finalized_at is null
       or v_current_finalized_at + interval '30 days' > now() then
      raise exception 'Your Mark can be changed only once every 30 days.' using errcode = 'P0001';
    end if;
  end if;

  v_object_name := v_mark.id::text || '.png';
  if not exists (
    select 1 from storage.objects so
    where so.bucket_id = 'profile-marks' and so.name = v_object_name
  ) then
    raise exception 'The generated Mark has not finished uploading.';
  end if;

  update public.profile_marks set status = 'retired'
  where owner_id = auth.uid() and status = 'active' and id <> v_mark.id;
  update public.profile_marks
  set status = 'active', finalized_at = coalesce(finalized_at, now()), discarded_at = null
  where id = v_mark.id;

  update public.profiles
  set mark_id = v_mark.id,
      onboarding_stage = case when onboarding_stage = 'mark' then 'question' else onboarding_stage end
  where id = auth.uid();

  return v_mark.id;
end;
$function$;

revoke all on function public.finalize_profile_mark(uuid) from public, anon;
grant execute on function public.finalize_profile_mark(uuid) to authenticated;

-- Own outgoing-block management is the narrow exception to the block-aware
-- public_profiles view. Widen only that existing self-scoped RPC with mark_id.
drop function public.get_blocked_profiles();
create function public.get_blocked_profiles()
returns table(id uuid, pseudonym text, country text, scope text, created_at timestamptz, mark_id uuid)
language sql
security definer
set search_path to 'pg_catalog'
stable
as $$
  select p.id, p.pseudonym, p.country, b.scope, b.created_at, p.mark_id
  from public.blocked_users b
  join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid()
  order by b.created_at desc
$$;
revoke all on function public.get_blocked_profiles() from public, anon;
grant execute on function public.get_blocked_profiles() to authenticated;

-- Staff-only member directory/detail. No onboarding_stage, owner_id, tokens,
-- password material, provider metadata, or other Auth internals are returned.
drop function public.admin_list_members(text, text, text, timestamptz, timestamptz, integer, integer);
create function public.admin_list_members(
  p_query text default null,
  p_status text default null,
  p_country text default null,
  p_joined_after timestamptz default null,
  p_joined_before timestamptz default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table(id uuid, pseudonym text, country text, status text, created_at timestamptz, mark_id uuid)
language plpgsql security definer set search_path to 'pg_catalog'
as $function$
declare
  v_query text := nullif(trim(both from coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.is_staff() then raise exception 'Not authorized.'; end if;
  if p_status is not null and p_status not in ('active', 'restricted', 'suspended', 'banned') then
    raise exception 'Invalid account status filter.';
  end if;
  return query
    select p.id, p.pseudonym, p.country, coalesce(aes.status, 'active'), p.created_at, p.mark_id
    from public.profiles p
    left join public.account_enforcement_state aes on aes.user_id = p.id
    where (v_query is null or p.pseudonym ilike '%' || v_query || '%')
      and (p_status is null or coalesce(aes.status, 'active') = p_status)
      and (p_country is null or p.country = p_country)
      and (p_joined_after is null or p.created_at >= p_joined_after)
      and (p_joined_before is null or p.created_at <= p_joined_before)
    order by p.created_at desc limit v_limit offset v_offset;
end;
$function$;
revoke all on function public.admin_list_members(text,text,text,timestamptz,timestamptz,integer,integer) from public, anon;
grant execute on function public.admin_list_members(text,text,text,timestamptz,timestamptz,integer,integer) to authenticated;

drop function public.admin_get_member(uuid);
create function public.admin_get_member(p_user_id uuid)
returns table(
  id uuid, pseudonym text, country text, status text, status_reason text,
  status_changed_at timestamptz, email text, region text, age_range text,
  gender text, gender_custom text, languages text[], intent text[],
  created_at timestamptz, mark_id uuid
)
language plpgsql security definer set search_path to 'pg_catalog'
as $function$
begin
  if not public.is_staff() then raise exception 'Not authorized.'; end if;
  return query
    select p.id, p.pseudonym, p.country, coalesce(aes.status, 'active'),
      aes.status_reason, aes.changed_at, u.email::text, p.region, p.age_range,
      p.gender, p.gender_custom, p.languages, p.intent, p.created_at, p.mark_id
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.account_enforcement_state aes on aes.user_id = p.id
    where p.id = p_user_id;
end;
$function$;
revoke all on function public.admin_get_member(uuid) from public, anon;
grant execute on function public.admin_get_member(uuid) to authenticated;

-- Staff first-contact uses the real correspondence and letters tables. The
-- staff caller becomes a genuine participant, so existing participant RLS,
-- delivery/read state, recipient reply flow, archive and blocking semantics
-- remain authoritative. This RPC only removes the public-discovery-answer
-- prerequisite for a staff-initiated contact; it does not create a parallel
-- inbox or grant staff access to anyone else's private correspondence.
create or replace function public.admin_send_first_letter(p_member_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_body text;
  v_correspondence_id uuid;
  v_letter_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if not public.is_staff() then raise exception 'Not authorized.'; end if;
  if p_member_id = auth.uid() then raise exception 'You cannot write to yourself.'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_member_id) then
    raise exception 'Member not found.';
  end if;
  if tempa_private.is_correspondence_blocked_pair(auth.uid(), p_member_id) then
    raise exception 'This correspondence is not available.';
  end if;

  v_body := trim(both from coalesce(p_body, ''));
  if char_length(v_body) = 0 then raise exception 'A letter needs some writing.'; end if;
  if char_length(v_body) > 4000 then raise exception 'Letter is too long.'; end if;

  if exists (
    select 1 from public.correspondences c
    where c.participant_low = least(auth.uid(), p_member_id)
      and c.participant_high = greatest(auth.uid(), p_member_id)
      and c.status = 'active'
  ) then
    raise exception 'An active correspondence already exists with this member.';
  end if;

  insert into public.correspondences(participant_low, participant_high)
  values (least(auth.uid(), p_member_id), greatest(auth.uid(), p_member_id))
  returning id into v_correspondence_id;

  insert into public.letters(
    sender_id, recipient_id, question_answer_id, correspondence_id,
    body, deliver_at, expires_at
  ) values (
    auth.uid(), p_member_id, null, v_correspondence_id,
    v_body, now(), now() + interval '72 hours'
  ) returning id into v_letter_id;

  insert into public.admin_audit_log(
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot, metadata
  )
  select auth.uid(), coalesce(ap.pseudonym, auth.uid()::text), 'member_contacted',
    'member_correspondence', p_member_id, mp.pseudonym,
    jsonb_build_object('correspondence_id', v_correspondence_id, 'letter_id', v_letter_id)
  from public.profiles mp
  left join public.profiles ap on ap.id = auth.uid()
  where mp.id = p_member_id;

  return v_letter_id;
end;
$function$;
revoke all on function public.admin_send_first_letter(uuid,text) from public, anon;
grant execute on function public.admin_send_first_letter(uuid,text) to authenticated;

commit;
