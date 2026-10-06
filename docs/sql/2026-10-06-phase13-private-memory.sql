-- ============================================================
-- TEMPA — PHASE 13: PRIVATE MEMORY
-- PREPARED 2026-10-06. FORWARD-ONLY.
--
-- Product contract:
-- * Private Memory is manual. Tempa never extracts notes from letters.
-- * One note belongs to one authenticated owner inside one established
--   correspondence episode.
-- * The correspondent cannot read, write, infer, or receive the note.
-- * Notes never enter public profiles, discovery, ranking, advertising,
--   recommendations, reminders, or correspondence eligibility.
-- * Pausing or ending a correspondence preserves its private note with that
--   episode's history. A later episode between the same people starts clean.
-- * "Latest letter" context stays presentation-only: the app reads the same
--   participant-safe letter data it already has instead of copying letter
--   content into this table.
-- ============================================================

begin;

create table if not exists tempa_private.correspondence_private_memory (
  owner_id uuid not null
    references auth.users(id)
    on delete cascade,

  correspondence_id uuid not null
    references public.correspondences(id)
    on delete cascade,

  note_text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (owner_id, correspondence_id),

  constraint correspondence_private_memory_note_text_check
    check (
      char_length(note_text) between 1 and 4000
      and char_length(btrim(note_text)) > 0
    )
);

comment on table tempa_private.correspondence_private_memory is
  'Phase 13 owner-only manual memory for one established correspondence episode. Never public, never AI-extracted, and never an input to discovery/ranking/advertising.';

alter table tempa_private.correspondence_private_memory
  enable row level security;

-- Defense in depth. The client never receives direct table privileges; these
-- policies still make ownership explicit if table privileges are ever changed.
drop policy if exists correspondence_private_memory_select
  on tempa_private.correspondence_private_memory;
create policy correspondence_private_memory_select
  on tempa_private.correspondence_private_memory
  for select
  using (
    auth.uid() = owner_id
    and exists (
      select 1
      from public.correspondences c
      where c.id = correspondence_id
        and c.established_at is not null
        and auth.uid() in (c.participant_low, c.participant_high)
    )
  );

drop policy if exists correspondence_private_memory_insert
  on tempa_private.correspondence_private_memory;
create policy correspondence_private_memory_insert
  on tempa_private.correspondence_private_memory
  for insert
  with check (
    auth.uid() = owner_id
    and exists (
      select 1
      from public.correspondences c
      where c.id = correspondence_id
        and c.established_at is not null
        and auth.uid() in (c.participant_low, c.participant_high)
    )
  );

drop policy if exists correspondence_private_memory_update
  on tempa_private.correspondence_private_memory;
create policy correspondence_private_memory_update
  on tempa_private.correspondence_private_memory
  for update
  using (auth.uid() = owner_id)
  with check (
    auth.uid() = owner_id
    and exists (
      select 1
      from public.correspondences c
      where c.id = correspondence_id
        and c.established_at is not null
        and auth.uid() in (c.participant_low, c.participant_high)
    )
  );

drop policy if exists correspondence_private_memory_delete
  on tempa_private.correspondence_private_memory;
create policy correspondence_private_memory_delete
  on tempa_private.correspondence_private_memory
  for delete
  using (auth.uid() = owner_id);

revoke all on table tempa_private.correspondence_private_memory
  from public, anon, authenticated;


-- ------------------------------------------------------------
-- READ
-- ------------------------------------------------------------
create or replace function public.get_my_correspondence_private_memory(
  p_correspondence_id uuid
)
returns table (
  note_text text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = 'pg_catalog'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Authentication required.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.correspondences c
    where c.id = p_correspondence_id
      and c.established_at is not null
      and v_uid in (c.participant_low, c.participant_high)
  ) then
    return;
  end if;

  return query
  select m.note_text, m.updated_at
  from tempa_private.correspondence_private_memory m
  where m.owner_id = v_uid
    and m.correspondence_id = p_correspondence_id;
end;
$function$;

revoke all on function public.get_my_correspondence_private_memory(uuid)
  from public, anon;

grant execute on function public.get_my_correspondence_private_memory(uuid)
  to authenticated;

comment on function public.get_my_correspondence_private_memory(uuid) is
  'Returns only the authenticated caller''s manual note for an established correspondence they participate in.';


-- ------------------------------------------------------------
-- SAVE / REPLACE
-- ------------------------------------------------------------
create or replace function public.save_my_correspondence_private_memory(
  p_correspondence_id uuid,
  p_note_text text
)
returns timestamptz
language plpgsql
security definer
set search_path = 'pg_catalog'
as $function$
declare
  v_uid uuid := auth.uid();
  v_saved_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Authentication required.'
      using errcode = '42501';
  end if;

  if p_note_text is null
     or char_length(btrim(p_note_text)) = 0
     or char_length(p_note_text) > 4000 then
    raise exception 'Private memory must contain between 1 and 4000 characters.'
      using errcode = '22023', detail = 'PRIVATE_MEMORY_INVALID_LENGTH';
  end if;

  if not exists (
    select 1
    from public.correspondences c
    where c.id = p_correspondence_id
      and c.established_at is not null
      and v_uid in (c.participant_low, c.participant_high)
  ) then
    raise exception 'Established correspondence not found.'
      using errcode = 'P0002', detail = 'PRIVATE_MEMORY_CORRESPONDENCE_NOT_FOUND';
  end if;

  insert into tempa_private.correspondence_private_memory (
    owner_id,
    correspondence_id,
    note_text
  )
  values (
    v_uid,
    p_correspondence_id,
    p_note_text
  )
  on conflict (owner_id, correspondence_id)
  do update
  set note_text = excluded.note_text,
      updated_at = now()
  returning updated_at into v_saved_at;

  return v_saved_at;
end;
$function$;

revoke all on function public.save_my_correspondence_private_memory(uuid, text)
  from public, anon;

grant execute on function public.save_my_correspondence_private_memory(uuid, text)
  to authenticated;

comment on function public.save_my_correspondence_private_memory(uuid, text) is
  'Creates or replaces only the authenticated caller''s manual Private Memory note for one established correspondence.';


-- ------------------------------------------------------------
-- CLEAR
-- ------------------------------------------------------------
create or replace function public.delete_my_correspondence_private_memory(
  p_correspondence_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = 'pg_catalog'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Authentication required.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.correspondences c
    where c.id = p_correspondence_id
      and c.established_at is not null
      and v_uid in (c.participant_low, c.participant_high)
  ) then
    raise exception 'Established correspondence not found.'
      using errcode = 'P0002', detail = 'PRIVATE_MEMORY_CORRESPONDENCE_NOT_FOUND';
  end if;

  delete from tempa_private.correspondence_private_memory m
  where m.owner_id = v_uid
    and m.correspondence_id = p_correspondence_id;

  return true;
end;
$function$;

revoke all on function public.delete_my_correspondence_private_memory(uuid)
  from public, anon;

grant execute on function public.delete_my_correspondence_private_memory(uuid)
  to authenticated;

comment on function public.delete_my_correspondence_private_memory(uuid) is
  'Deletes only the authenticated caller''s Private Memory note. It never changes the correspondence or any letter.';

commit;


-- ============================================================
-- READ-ONLY VERIFICATION — 14 BOOLEANS, EVERY ONE SHOULD BE TRUE
-- ============================================================

select
  to_regclass('tempa_private.correspondence_private_memory') is not null
    as private_memory_table_ready,

  coalesce((
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'tempa_private'
      and c.relname = 'correspondence_private_memory'
  ), false)
    as private_memory_rls_enabled,

  not has_table_privilege(
    'authenticated',
    'tempa_private.correspondence_private_memory',
    'SELECT'
  )
    as authenticated_has_no_direct_read,

  not has_table_privilege(
    'authenticated',
    'tempa_private.correspondence_private_memory',
    'INSERT'
  )
    as authenticated_has_no_direct_write,

  to_regprocedure(
    'public.get_my_correspondence_private_memory(uuid)'
  ) is not null
    as private_memory_read_rpc_ready,

  to_regprocedure(
    'public.save_my_correspondence_private_memory(uuid,text)'
  ) is not null
    as private_memory_save_rpc_ready,

  to_regprocedure(
    'public.delete_my_correspondence_private_memory(uuid)'
  ) is not null
    as private_memory_delete_rpc_ready,

  has_function_privilege(
    'authenticated',
    'public.get_my_correspondence_private_memory(uuid)',
    'EXECUTE'
  )
    as authenticated_can_read_own_memory,

  has_function_privilege(
    'authenticated',
    'public.save_my_correspondence_private_memory(uuid,text)',
    'EXECUTE'
  )
    as authenticated_can_save_own_memory,

  not has_function_privilege(
    'anon',
    'public.get_my_correspondence_private_memory(uuid)',
    'EXECUTE'
  )
    as anon_cannot_read_memory,

  not has_function_privilege(
    'anon',
    'public.save_my_correspondence_private_memory(uuid,text)',
    'EXECUTE'
  )
    as anon_cannot_save_memory,

  position(
    'c.established_at is not null'
    in pg_get_functiondef(
      'public.save_my_correspondence_private_memory(uuid,text)'::regprocedure
    )
  ) > 0
    as save_requires_established_correspondence,

  position(
    'm.owner_id = v_uid'
    in pg_get_functiondef(
      'public.get_my_correspondence_private_memory(uuid)'::regprocedure
    )
  ) > 0
    as read_is_owner_bound,

  position(
    'char_length(p_note_text) > 4000'
    in pg_get_functiondef(
      'public.save_my_correspondence_private_memory(uuid,text)'::regprocedure
    )
  ) > 0
    as note_length_is_bounded;
