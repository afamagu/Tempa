-- ============================================================
-- TEMPA — PHASE 3: WRITING RHYTHM FOUNDATION
-- PREPARED 2026-10-04. REVIEW BEFORE PRODUCTION EXECUTION.
--
-- PURPOSE
-- -------
-- Give correspondence a visible, human pace without turning Tempa into
-- a deadline-driven messaging product.
--
-- Canonical member rhythms:
--   few_days  — Within a few days        (approx horizon: 4 days)
--   one_week  — About a week             (approx horizon: 7 days)
--   two_weeks — Within two weeks         (approx horizon: 14 days)
--   one_month — I write slowly — up to a month (approx horizon: 30 days)
--
-- There is deliberately NO unbounded “whenever / when I have something to
-- say” option. The point of rhythm is to make silence interpretable.
--
-- Existing members remain NULL until they choose. NULL means Tempa must not
-- infer an overdue state or send cadence reminders for that member.
--
-- Per-correspondence override:
-- A member can use a different rhythm with one established correspondent.
-- The override belongs only to its owner, but the effective rhythm is visible
-- to the other participant through a participant-only RPC.
-- ============================================================

begin;

-- ============================================================
-- 1. MEMBER DEFAULT RHYTHM
-- ============================================================
alter table public.profiles
  add column if not exists writing_rhythm text;

alter table public.profiles
  drop constraint if exists profiles_writing_rhythm_check;

alter table public.profiles
  add constraint profiles_writing_rhythm_check
  check (
    writing_rhythm is null
    or writing_rhythm in ('few_days', 'one_week', 'two_weeks', 'one_month')
  );

comment on column public.profiles.writing_rhythm is
  'Member default correspondence rhythm. NULL means not chosen yet; no cadence status/reminder may be inferred from NULL.';


-- ============================================================
-- 2. PER-CORRESPONDENCE OVERRIDES
-- ============================================================
create table if not exists public.correspondence_rhythm_overrides (
  correspondence_id uuid not null
    references public.correspondences(id)
    on delete cascade,
  user_id uuid not null
    references auth.users(id)
    on delete cascade,
  rhythm text not null
    check (rhythm in ('few_days', 'one_week', 'two_weeks', 'one_month')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (correspondence_id, user_id)
);

comment on table public.correspondence_rhythm_overrides is
  'Owner-specific writing-rhythm override for one established correspondence. The other participant reads only the effective rhythm through a participant-only RPC.';

alter table public.correspondence_rhythm_overrides enable row level security;

revoke all on table public.correspondence_rhythm_overrides
  from public, anon, authenticated;

grant select, insert, update, delete on table public.correspondence_rhythm_overrides
  to authenticated;

drop policy if exists correspondence_rhythm_overrides_select_own on public.correspondence_rhythm_overrides;
create policy correspondence_rhythm_overrides_select_own
on public.correspondence_rhythm_overrides
for select
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.correspondences c
    where c.id = correspondence_id
      and c.status = 'active'
      and c.established_at is not null
      and (c.participant_low = auth.uid() or c.participant_high = auth.uid())
  )
);

drop policy if exists correspondence_rhythm_overrides_insert_own on public.correspondence_rhythm_overrides;
create policy correspondence_rhythm_overrides_insert_own
on public.correspondence_rhythm_overrides
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.correspondences c
    where c.id = correspondence_id
      and c.status = 'active'
      and c.established_at is not null
      and (c.participant_low = auth.uid() or c.participant_high = auth.uid())
  )
);

drop policy if exists correspondence_rhythm_overrides_update_own on public.correspondence_rhythm_overrides;
create policy correspondence_rhythm_overrides_update_own
on public.correspondence_rhythm_overrides
for update
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.correspondences c
    where c.id = correspondence_id
      and c.status = 'active'
      and c.established_at is not null
      and (c.participant_low = auth.uid() or c.participant_high = auth.uid())
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.correspondences c
    where c.id = correspondence_id
      and c.status = 'active'
      and c.established_at is not null
      and (c.participant_low = auth.uid() or c.participant_high = auth.uid())
  )
);

drop policy if exists correspondence_rhythm_overrides_delete_own on public.correspondence_rhythm_overrides;
create policy correspondence_rhythm_overrides_delete_own
on public.correspondence_rhythm_overrides
for delete
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.correspondences c
    where c.id = correspondence_id
      and c.status = 'active'
      and c.established_at is not null
      and (c.participant_low = auth.uid() or c.participant_high = auth.uid())
  )
);


-- ============================================================
-- 3. CANONICAL RHYTHM HORIZON
-- ============================================================
create or replace function tempa_private.writing_rhythm_days(
  p_rhythm text
)
returns integer
language sql
immutable
security definer
set search_path to 'pg_catalog'
as $function$
  select case p_rhythm
    when 'few_days' then 4
    when 'one_week' then 7
    when 'two_weeks' then 14
    when 'one_month' then 30
    else null
  end
$function$;

revoke all on function tempa_private.writing_rhythm_days(text)
  from public, anon, authenticated, service_role;


-- ============================================================
-- 4. EFFECTIVE RHYTHM FOR ONE PARTICIPANT
-- ============================================================
create or replace function tempa_private.effective_writing_rhythm(
  p_correspondence_id uuid,
  p_user_id uuid
)
returns text
language sql
stable
security definer
set search_path to 'pg_catalog'
as $function$
  select coalesce(
    (
      select o.rhythm
      from public.correspondence_rhythm_overrides o
      where o.correspondence_id = p_correspondence_id
        and o.user_id = p_user_id
    ),
    (
      select p.writing_rhythm
      from public.profiles p
      where p.id = p_user_id
    )
  )
$function$;

revoke all on function tempa_private.effective_writing_rhythm(uuid, uuid)
  from public, anon, authenticated, service_role;


-- ============================================================
-- 5. CALLER'S DEFAULT RHYTHM
-- ============================================================
create or replace function public.get_my_writing_rhythm()
returns table (
  rhythm text,
  approximate_days integer
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_rhythm text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select p.writing_rhythm
  into v_rhythm
  from public.profiles p
  where p.id = auth.uid();

  return query
  select v_rhythm, tempa_private.writing_rhythm_days(v_rhythm);
end;
$function$;

revoke all on function public.get_my_writing_rhythm() from public, anon;
grant execute on function public.get_my_writing_rhythm() to authenticated;


-- ============================================================
-- 6. SET CALLER'S DEFAULT RHYTHM
-- ============================================================
create or replace function public.set_my_writing_rhythm(
  p_rhythm text
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_rhythm not in ('few_days', 'one_week', 'two_weeks', 'one_month') then
    raise exception 'Invalid writing rhythm.'
      using errcode = '22023';
  end if;

  update public.profiles
  set writing_rhythm = p_rhythm
  where id = auth.uid();

  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;
end;
$function$;

revoke all on function public.set_my_writing_rhythm(text) from public, anon;
grant execute on function public.set_my_writing_rhythm(text) to authenticated;


-- ============================================================
-- 7. PARTICIPANT-ONLY CORRESPONDENCE RHYTHM STATE
-- ============================================================
create or replace function public.get_correspondence_rhythm(
  p_correspondence_id uuid
)
returns table (
  viewer_id uuid,
  counterpart_id uuid,
  viewer_rhythm text,
  viewer_approximate_days integer,
  viewer_uses_override boolean,
  counterpart_rhythm text,
  counterpart_approximate_days integer
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_correspondence public.correspondences%rowtype;
  v_viewer uuid := auth.uid();
  v_counterpart uuid;
  v_viewer_rhythm text;
  v_counterpart_rhythm text;
begin
  if v_viewer is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select *
  into v_correspondence
  from public.correspondences c
  where c.id = p_correspondence_id
    and c.status = 'active'
    and c.established_at is not null
    and (c.participant_low = v_viewer or c.participant_high = v_viewer);

  if not found then
    raise exception 'Established correspondence not found.' using errcode = 'P0002';
  end if;

  v_counterpart := case
    when v_correspondence.participant_low = v_viewer then v_correspondence.participant_high
    else v_correspondence.participant_low
  end;

  v_viewer_rhythm := tempa_private.effective_writing_rhythm(p_correspondence_id, v_viewer);
  v_counterpart_rhythm := tempa_private.effective_writing_rhythm(p_correspondence_id, v_counterpart);

  return query
  select
    v_viewer,
    v_counterpart,
    v_viewer_rhythm,
    tempa_private.writing_rhythm_days(v_viewer_rhythm),
    exists (
      select 1
      from public.correspondence_rhythm_overrides o
      where o.correspondence_id = p_correspondence_id
        and o.user_id = v_viewer
    ),
    v_counterpart_rhythm,
    tempa_private.writing_rhythm_days(v_counterpart_rhythm);
end;
$function$;

revoke all on function public.get_correspondence_rhythm(uuid) from public, anon;
grant execute on function public.get_correspondence_rhythm(uuid) to authenticated;


-- ============================================================
-- 8. SET/CLEAR ONE CORRESPONDENCE OVERRIDE
-- ============================================================
create or replace function public.set_correspondence_rhythm_override(
  p_correspondence_id uuid,
  p_rhythm text
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_viewer uuid := auth.uid();
begin
  if v_viewer is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.correspondences c
    where c.id = p_correspondence_id
      and c.status = 'active'
      and c.established_at is not null
      and (c.participant_low = v_viewer or c.participant_high = v_viewer)
  ) then
    raise exception 'Established correspondence not found.' using errcode = 'P0002';
  end if;

  -- NULL means “use my default again”.
  if p_rhythm is null then
    delete from public.correspondence_rhythm_overrides
    where correspondence_id = p_correspondence_id
      and user_id = v_viewer;
    return;
  end if;

  if p_rhythm not in ('few_days', 'one_week', 'two_weeks', 'one_month') then
    raise exception 'Invalid writing rhythm.' using errcode = '22023';
  end if;

  insert into public.correspondence_rhythm_overrides (
    correspondence_id,
    user_id,
    rhythm,
    updated_at
  )
  values (
    p_correspondence_id,
    v_viewer,
    p_rhythm,
    now()
  )
  on conflict (correspondence_id, user_id)
  do update set
    rhythm = excluded.rhythm,
    updated_at = now();
end;
$function$;

revoke all on function public.set_correspondence_rhythm_override(uuid, text)
  from public, anon;
grant execute on function public.set_correspondence_rhythm_override(uuid, text)
  to authenticated;


-- ============================================================
-- 9. DOCUMENTATION
-- ============================================================
comment on function public.get_my_writing_rhythm() is
  'Caller-only default writing rhythm. NULL means the member has not chosen one; Tempa must not infer overdue state from NULL.';

comment on function public.get_correspondence_rhythm(uuid) is
  'Participant-only effective writing rhythms for an established correspondence, including whether the caller uses a per-correspondence override.';

comment on function public.set_correspondence_rhythm_override(uuid, text) is
  'Set one correspondence-specific rhythm for the caller; NULL clears the override and returns to the caller default.';

commit;
