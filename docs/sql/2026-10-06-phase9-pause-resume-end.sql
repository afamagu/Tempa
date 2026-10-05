-- ============================================================
-- TEMPA — PHASE 9: PAUSE / RESUME / END
-- PREPARED 2026-10-06. FORWARD-ONLY.
--
-- Product contract:
-- * Pause is unilateral, preserves history, disables writing/Return Cards/
--   reply reminders, and releases the active capacity chair.
-- * A paused correspondence remains an existing relationship for discovery.
-- * Resume is mutual: one participant asks, the other accepts or declines.
-- * Acceptance is atomic and succeeds only when BOTH participants currently
--   have relationship capacity.
-- * End is unilateral terminal closure of this episode. History remains.
-- * No action here creates letters, establishes a relationship, deletes
--   history, or suggests replacement people.
-- ============================================================

begin;

-- Add the paused state and explicit lifecycle metadata.
alter table public.correspondences
  drop constraint if exists correspondences_status_check;

alter table public.correspondences
  add constraint correspondences_status_check
  check (status in ('pending', 'active', 'paused', 'closed'));

alter table public.correspondences
  add column if not exists paused_at timestamptz,
  add column if not exists paused_by uuid references auth.users(id) on delete set null,
  add column if not exists resume_requested_at timestamptz,
  add column if not exists resume_requested_by uuid references auth.users(id) on delete set null,
  add column if not exists ended_by uuid references auth.users(id) on delete set null;

-- One open relationship episode per pair. Paused is still the SAME episode.
drop index if exists public.correspondences_one_active_per_pair;
create unique index correspondences_one_active_per_pair
  on public.correspondences (participant_low, participant_high)
  where status in ('pending', 'active', 'paused');

-- Helper: authenticated caller must be a participant.
create or replace function tempa_private.require_correspondence_participant(
  p_correspondence_id uuid
)
returns public.correspondences
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_corr public.correspondences;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_corr
  from public.correspondences c
  where c.id = p_correspondence_id
  for update;

  if not found
     or auth.uid() not in (v_corr.participant_low, v_corr.participant_high) then
    raise exception 'Correspondence not found.' using errcode = 'P0002';
  end if;

  return v_corr;
end;
$function$;

revoke all on function tempa_private.require_correspondence_participant(uuid)
  from public, anon, authenticated, service_role;

-- Read the latest episode with a person, including paused/ended metadata.
create or replace function public.get_correspondence_lifecycle_with_member(
  p_other_user_id uuid
)
returns table (
  correspondence_id uuid,
  status text,
  established_at timestamptz,
  paused_at timestamptz,
  paused_by uuid,
  resume_requested_at timestamptz,
  resume_requested_by uuid,
  closed_at timestamptz,
  ended_by uuid
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_other_user_id is null or p_other_user_id = v_uid then
    return;
  end if;

  return query
  select
    c.id, c.status, c.established_at, c.paused_at, c.paused_by,
    c.resume_requested_at, c.resume_requested_by, c.closed_at, c.ended_by
  from public.correspondences c
  where c.participant_low = least(v_uid, p_other_user_id)
    and c.participant_high = greatest(v_uid, p_other_user_id)
  order by c.created_at desc, c.id desc
  limit 1;
end;
$function$;

revoke all on function public.get_correspondence_lifecycle_with_member(uuid) from public, anon;
grant execute on function public.get_correspondence_lifecycle_with_member(uuid) to authenticated;

-- Pause: unilateral, active + established only. Capacity releases because the
-- canonical capacity function counts only status='active' established rows.
create or replace function public.pause_correspondence(p_correspondence_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_corr public.correspondences;
begin
  v_corr := tempa_private.require_correspondence_participant(p_correspondence_id);

  if v_corr.status <> 'active' or v_corr.established_at is null then
    raise exception 'Only an active established correspondence can be paused.'
      using errcode = 'P0001', detail = 'CORRESPONDENCE_NOT_PAUSABLE';
  end if;

  update public.correspondences
  set status = 'paused',
      paused_at = now(),
      paused_by = auth.uid(),
      resume_requested_at = null,
      resume_requested_by = null
  where id = p_correspondence_id;

  return true;
end;
$function$;

revoke all on function public.pause_correspondence(uuid) from public, anon;
grant execute on function public.pause_correspondence(uuid) to authenticated;

-- Either participant may ask to resume. Asking alone never restores writing.
create or replace function public.request_resume_correspondence(p_correspondence_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_corr public.correspondences;
begin
  v_corr := tempa_private.require_correspondence_participant(p_correspondence_id);

  if v_corr.status <> 'paused' or v_corr.established_at is null then
    raise exception 'Only a paused established correspondence can be resumed.'
      using errcode = 'P0001', detail = 'CORRESPONDENCE_NOT_PAUSED';
  end if;

  if v_corr.resume_requested_by = auth.uid() then
    return true;
  end if;

  -- If the other person has already asked, this action is the mutual yes.
  if v_corr.resume_requested_by is not null
     and v_corr.resume_requested_by <> auth.uid() then
    perform tempa_private.lock_relationship_capacity_pair(
      v_corr.participant_low, v_corr.participant_high
    );

    if (select s.committed_count >= s.active_limit
        from tempa_private.relationship_capacity_state(v_corr.participant_low) s)
       or
       (select s.committed_count >= s.active_limit
        from tempa_private.relationship_capacity_state(v_corr.participant_high) s) then
      raise exception 'There is not room to resume this correspondence yet.'
        using errcode = 'P0001', detail = 'RESUME_CAPACITY_REACHED';
    end if;

    update public.correspondences
    set status = 'active',
        paused_at = null,
        paused_by = null,
        resume_requested_at = null,
        resume_requested_by = null
    where id = p_correspondence_id
      and status = 'paused';

    return true;
  end if;

  update public.correspondences
  set resume_requested_at = now(),
      resume_requested_by = auth.uid()
  where id = p_correspondence_id
    and status = 'paused';

  return true;
end;
$function$;

revoke all on function public.request_resume_correspondence(uuid) from public, anon;
grant execute on function public.request_resume_correspondence(uuid) to authenticated;

-- Explicit response for the recipient of a resume request.
create or replace function public.respond_resume_correspondence(
  p_correspondence_id uuid,
  p_accept boolean
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_corr public.correspondences;
begin
  v_corr := tempa_private.require_correspondence_participant(p_correspondence_id);

  if v_corr.status <> 'paused'
     or v_corr.resume_requested_by is null
     or v_corr.resume_requested_by = auth.uid() then
    raise exception 'There is no resume request for you to answer.'
      using errcode = 'P0001', detail = 'NO_RESUME_REQUEST';
  end if;

  if not coalesce(p_accept, false) then
    update public.correspondences
    set resume_requested_at = null,
        resume_requested_by = null
    where id = p_correspondence_id
      and status = 'paused';
    return true;
  end if;

  perform tempa_private.lock_relationship_capacity_pair(
    v_corr.participant_low, v_corr.participant_high
  );

  if (select s.committed_count >= s.active_limit
      from tempa_private.relationship_capacity_state(v_corr.participant_low) s)
     or
     (select s.committed_count >= s.active_limit
      from tempa_private.relationship_capacity_state(v_corr.participant_high) s) then
    raise exception 'There is not room to resume this correspondence yet.'
      using errcode = 'P0001', detail = 'RESUME_CAPACITY_REACHED';
  end if;

  update public.correspondences
  set status = 'active',
      paused_at = null,
      paused_by = null,
      resume_requested_at = null,
      resume_requested_by = null
  where id = p_correspondence_id
    and status = 'paused';

  return true;
end;
$function$;

revoke all on function public.respond_resume_correspondence(uuid, boolean) from public, anon;
grant execute on function public.respond_resume_correspondence(uuid, boolean) to authenticated;

-- End: terminal for THIS episode, unilateral, history-preserving.
create or replace function public.end_correspondence(p_correspondence_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_corr public.correspondences;
begin
  v_corr := tempa_private.require_correspondence_participant(p_correspondence_id);

  if v_corr.established_at is null or v_corr.status not in ('active', 'paused') then
    raise exception 'Only an established open correspondence can be ended.'
      using errcode = 'P0001', detail = 'CORRESPONDENCE_NOT_ENDABLE';
  end if;

  update public.correspondences
  set status = 'closed',
      closed_at = now(),
      ended_by = auth.uid(),
      paused_at = null,
      paused_by = null,
      resume_requested_at = null,
      resume_requested_by = null
  where id = p_correspondence_id;

  return true;
end;
$function$;

revoke all on function public.end_correspondence(uuid) from public, anon;
grant execute on function public.end_correspondence(uuid) to authenticated;

-- Discovery must keep paused counterparts out: paused is capacity-free but it
-- is not a new person. Preserve each live function body and patch one predicate.
do $discovery_patch$
declare
  v_signature regprocedure;
  v_definition text;
  v_patched text;
begin
  foreach v_signature in array array[
    'public.discover_people(text,text,text,integer,integer)'::regprocedure,
    'public.get_member_introductions(integer)'::regprocedure,
    'public.get_familiar_faces(integer)'::regprocedure
  ]
  loop
    v_definition := pg_get_functiondef(v_signature);
    if position('where c.status in (''pending'', ''active'')' in v_definition) = 0 then
      raise exception 'Phase 9 could not find the Phase 6 discovery predicate in %.', v_signature::text;
    end if;
    v_patched := replace(
      v_definition,
      'where c.status in (''pending'', ''active'')',
      'where c.status in (''pending'', ''active'', ''paused'')'
    );
    execute v_patched;
  end loop;
end
$discovery_patch$;

-- First-contact creation must also regard paused as an existing episode.
-- Patch the current function in place rather than copying its Safety contract.
do $first_contact_patch$
declare
  v_signature regprocedure :=
    'public.send_first_letter(uuid,uuid,text,uuid,boolean)'::regprocedure;
  v_definition text := pg_get_functiondef(v_signature);
  v_patched text;
begin
  if position('array[''pending''::text, ''active''::text]' in v_definition) = 0
     or position('c.status in (''pending'', ''active'')' in v_definition) = 0 then
    raise exception 'Phase 9 could not find the current open-correspondence predicates in send_first_letter.';
  end if;

  v_patched := replace(
    v_definition,
    'array[''pending''::text, ''active''::text]',
    'array[''pending''::text, ''active''::text, ''paused''::text]'
  );
  v_patched := replace(
    v_patched,
    'c.status in (''pending'', ''active'')',
    'c.status in (''pending'', ''active'', ''paused'')'
  );
  execute v_patched;
end
$first_contact_patch$;

commit;

-- READ-ONLY verification. Every boolean should be true.
select
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='correspondences' and column_name='paused_at'
  ) as pause_columns_installed,
  pg_get_constraintdef((
    select oid from pg_constraint
    where conrelid='public.correspondences'::regclass
      and conname='correspondences_status_check'
  )) ilike '%paused%' as paused_status_allowed,
  to_regprocedure('public.pause_correspondence(uuid)') is not null as pause_rpc_exists,
  to_regprocedure('public.request_resume_correspondence(uuid)') is not null as request_resume_rpc_exists,
  to_regprocedure('public.respond_resume_correspondence(uuid,boolean)') is not null as respond_resume_rpc_exists,
  to_regprocedure('public.end_correspondence(uuid)') is not null as end_rpc_exists,
  to_regprocedure('public.get_correspondence_lifecycle_with_member(uuid)') is not null as lifecycle_read_exists,
  pg_get_functiondef('public.discover_people(text,text,text,integer,integer)'::regprocedure)
    like '%c.status in (''pending'', ''active'', ''paused'')%' as discovery_excludes_paused,
  pg_get_functiondef('public.send_first_letter(uuid,uuid,text,uuid,boolean)'::regprocedure)
    like '%''paused''%' as first_contact_respects_paused,
  pg_get_functiondef('tempa_private.relationship_capacity_state(uuid)'::regprocedure)
    like '%c.status = ''active''%' as paused_releases_capacity,
  pg_get_functiondef('public.get_my_reply_reminders()'::regprocedure)
    like '%c.status = ''active''%' as paused_suppresses_in_product_reminders,
  pg_get_functiondef('public.claim_reply_reminder_email_jobs(integer,text)'::regprocedure)
    like '%c.status = ''active''%' as paused_suppresses_reminder_email_jobs;
