-- ============================================================
-- TEMPA — PHASE 16: FOUNDING CORRESPONDENTS PILOT
-- PREPARED 2026-10-06. FORWARD-ONLY.
--
-- PURPOSE
-- -------
-- Close Tempa to a controlled Founding Correspondents cohort while
-- preserving every existing account, and give admins aggregate pilot-health
-- metrics derived from existing correspondence metadata.
--
-- NON-NEGOTIABLES
-- ----------------
-- * Existing auth accounts are grandfathered.
-- * Future accounts require an admin-issued email invitation.
-- * Pilot access never changes moderation, blocking, Safety, or capacity.
-- * Relationship capacity remains the existing canonical 5 active/committed,
--   max 2 outgoing pending, max 2 incoming pending.
-- * No private letter body is copied, inspected, summarized, ranked, or
--   returned by pilot reporting.
-- * Metrics are aggregate only: first contact, establishment, third/fifth
--   turns, and 30/60/90-day survival.
-- * Commerce/premium access does not affect pilot access.
-- ============================================================

begin;

create table if not exists tempa_private.pilot_invites (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  email_canonical text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'revoked')),
  note text,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_user_id uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  constraint pilot_invites_email_check check (
    char_length(email_canonical) between 3 and 320
    and email_canonical = lower(btrim(email_canonical))
    and position('@' in email_canonical) > 1
  ),
  constraint pilot_invites_note_check check (
    note is null or char_length(note) <= 500
  )
);

create table if not exists tempa_private.pilot_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  source text not null check (source in ('grandfathered', 'invite', 'admin')),
  invite_id uuid references tempa_private.pilot_invites(id) on delete set null,
  joined_at timestamptz not null default now()
);

comment on table tempa_private.pilot_invites is
  'Phase 16 private Founding Correspondents invitations. Email addresses are admin-only operational data and never public profile data.';

comment on table tempa_private.pilot_members is
  'Phase 16 controlled pilot membership. Existing auth accounts are grandfathered; future members join through a matching active invitation.';

alter table tempa_private.pilot_invites enable row level security;
alter table tempa_private.pilot_members enable row level security;

revoke all on table tempa_private.pilot_invites
  from public, anon, authenticated;
revoke all on table tempa_private.pilot_members
  from public, anon, authenticated;

-- Every account that exists at migration time remains usable. This includes
-- accounts part-way through onboarding, not only members who already have a
-- profiles row.
insert into tempa_private.pilot_members (user_id, source, joined_at)
select u.id, 'grandfathered', coalesce(u.created_at, now())
from auth.users u
on conflict (user_id) do nothing;


-- ------------------------------------------------------------
-- MEMBER ACCESS GATE
-- ------------------------------------------------------------
-- Called after authentication. If a future account's verified auth email
-- matches a pending invitation, the invitation is atomically claimed and
-- durable pilot membership is created. No email is accepted from the client.
create or replace function public.current_pilot_access()
returns boolean
language plpgsql
security definer
set search_path = 'pg_catalog'
as $function$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_invite tempa_private.pilot_invites%rowtype;
begin
  if v_uid is null then
    return false;
  end if;

  if exists (
    select 1
    from tempa_private.pilot_members pm
    where pm.user_id = v_uid
  ) then
    return true;
  end if;

  select lower(btrim(u.email))
  into v_email
  from auth.users u
  where u.id = v_uid;

  if v_email is null or v_email = '' then
    return false;
  end if;

  select i.*
  into v_invite
  from tempa_private.pilot_invites i
  where i.email_canonical = v_email
    and i.status = 'pending'
    and i.revoked_at is null
  for update;

  if not found then
    return false;
  end if;

  insert into tempa_private.pilot_members (
    user_id,
    source,
    invite_id,
    joined_at
  )
  values (
    v_uid,
    'invite',
    v_invite.id,
    now()
  )
  on conflict (user_id) do nothing;

  update tempa_private.pilot_invites
  set status = 'claimed',
      claimed_at = coalesce(claimed_at, now()),
      claimed_user_id = v_uid,
      updated_at = now()
  where id = v_invite.id;

  return true;
end;
$function$;

revoke all on function public.current_pilot_access()
  from public, anon;
grant execute on function public.current_pilot_access()
  to authenticated;

comment on function public.current_pilot_access() is
  'Authenticated Phase 16 pilot gate. Uses only auth.uid() and the verified auth email; claims a matching pending invitation once, otherwise returns false.';


-- ------------------------------------------------------------
-- ADMIN INVITATION OPERATIONS
-- ------------------------------------------------------------
create or replace function public.admin_pilot_invite_email(
  p_email text,
  p_note text default null
)
returns table (
  invite_id uuid,
  email text,
  status text
)
language plpgsql
security definer
set search_path = 'pg_catalog'
as $function$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
  v_status text;
  v_current_total integer;
begin
  if not public.is_staff('admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  if char_length(v_email) not between 3 and 320
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;

  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'Pilot invite note is too long.' using errcode = '22023';
  end if;

  -- The target pilot is 150–200 adults. Grandfathered test/admin accounts
  -- count toward the ceiling so this cannot silently turn into an open beta.
  select
    (select count(*) from tempa_private.pilot_members)
    +
    (select count(*) from tempa_private.pilot_invites
      where status = 'pending' and revoked_at is null)
  into v_current_total;

  if v_current_total >= 200
     and not exists (
       select 1 from tempa_private.pilot_invites i
       where i.email_canonical = v_email
     ) then
    raise exception 'The Founding Correspondents cohort has reached its 200-account ceiling.'
      using errcode = 'P0001', detail = 'PILOT_COHORT_FULL';
  end if;

  insert into tempa_private.pilot_invites (
    email_canonical,
    status,
    note,
    invited_by,
    created_at,
    updated_at,
    claimed_at,
    claimed_user_id,
    revoked_at
  )
  values (
    v_email,
    'pending',
    v_note,
    auth.uid(),
    now(),
    now(),
    null,
    null,
    null
  )
  on conflict (email_canonical)
  do update
  set status = case
        when tempa_private.pilot_invites.status = 'claimed'
             and tempa_private.pilot_invites.claimed_user_id is not null
          then 'claimed'
        else 'pending'
      end,
      note = excluded.note,
      invited_by = excluded.invited_by,
      updated_at = now(),
      revoked_at = case
        when tempa_private.pilot_invites.status = 'claimed'
          then tempa_private.pilot_invites.revoked_at
        else null
      end
  returning id, tempa_private.pilot_invites.status
  into v_id, v_status;

  return query select v_id, v_email, v_status;
end;
$function$;

revoke all on function public.admin_pilot_invite_email(text, text)
  from public, anon;
grant execute on function public.admin_pilot_invite_email(text, text)
  to authenticated;


create or replace function public.admin_revoke_pilot_invite(
  p_invite_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = 'pg_catalog'
as $function$
begin
  if not public.is_staff('admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  update tempa_private.pilot_invites i
  set status = 'revoked',
      revoked_at = now(),
      updated_at = now()
  where i.id = p_invite_id
    and i.status = 'pending';

  return found;
end;
$function$;

revoke all on function public.admin_revoke_pilot_invite(uuid)
  from public, anon;
grant execute on function public.admin_revoke_pilot_invite(uuid)
  to authenticated;


create or replace function public.admin_list_pilot_invites()
returns table (
  id uuid,
  email text,
  status text,
  note text,
  created_at timestamptz,
  claimed_at timestamptz,
  member_pseudonym text
)
language plpgsql
stable
security definer
set search_path = 'pg_catalog'
as $function$
begin
  if not public.is_staff('admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  return query
  select
    i.id,
    i.email_canonical,
    i.status,
    i.note,
    i.created_at,
    i.claimed_at,
    p.pseudonym
  from tempa_private.pilot_invites i
  left join public.profiles p on p.id = i.claimed_user_id
  order by i.created_at desc, i.id desc
  limit 250;
end;
$function$;

revoke all on function public.admin_list_pilot_invites()
  from public, anon;
grant execute on function public.admin_list_pilot_invites()
  to authenticated;


-- ------------------------------------------------------------
-- AGGREGATE PILOT HEALTH
-- ------------------------------------------------------------
-- No body/content column is read. A "turn" is one sent letter in the same
-- correspondence. Survival at N days means an established correspondence was
-- old enough to be evaluated AND had at least one sent letter on/after its
-- N-day anniversary.
create or replace function public.admin_pilot_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = 'pg_catalog'
as $function$
declare
  v_result jsonb;
begin
  if not public.is_staff('admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  with pilot_pairs as (
    select c.id, c.status, c.established_at, c.created_at
    from public.correspondences c
    where exists (
      select 1 from tempa_private.pilot_members pm
      where pm.user_id = c.participant_low
    )
      and exists (
        select 1 from tempa_private.pilot_members pm
        where pm.user_id = c.participant_high
      )
  ),
  letter_stats as (
    select
      pp.id,
      pp.status,
      pp.established_at,
      pp.created_at,
      count(l.id) filter (where l.status = 'sent')::integer as sent_turns,
      bool_or(
        l.status = 'sent'
        and pp.established_at is not null
        and l.created_at >= pp.established_at + interval '30 days'
      ) as active_after_30,
      bool_or(
        l.status = 'sent'
        and pp.established_at is not null
        and l.created_at >= pp.established_at + interval '60 days'
      ) as active_after_60,
      bool_or(
        l.status = 'sent'
        and pp.established_at is not null
        and l.created_at >= pp.established_at + interval '90 days'
      ) as active_after_90
    from pilot_pairs pp
    left join public.letters l on l.correspondence_id = pp.id
    group by pp.id, pp.status, pp.established_at, pp.created_at
  ),
  aggregate as (
    select
      count(*) filter (where sent_turns >= 1)::integer as first_contact_correspondences,
      count(*) filter (where established_at is not null)::integer as established_correspondences,
      count(*) filter (where established_at is not null and sent_turns >= 3)::integer as third_turn_correspondences,
      count(*) filter (where established_at is not null and sent_turns >= 5)::integer as fifth_turn_correspondences,

      count(*) filter (
        where established_at is not null
          and established_at <= now() - interval '30 days'
      )::integer as survival_30_eligible,
      count(*) filter (
        where established_at is not null
          and established_at <= now() - interval '30 days'
          and active_after_30
      )::integer as survival_30_alive,

      count(*) filter (
        where established_at is not null
          and established_at <= now() - interval '60 days'
      )::integer as survival_60_eligible,
      count(*) filter (
        where established_at is not null
          and established_at <= now() - interval '60 days'
          and active_after_60
      )::integer as survival_60_alive,

      count(*) filter (
        where established_at is not null
          and established_at <= now() - interval '90 days'
      )::integer as survival_90_eligible,
      count(*) filter (
        where established_at is not null
          and established_at <= now() - interval '90 days'
          and active_after_90
      )::integer as survival_90_alive
    from letter_stats
  )
  select jsonb_build_object(
    'cohort_members', (select count(*) from tempa_private.pilot_members),
    'pending_invites', (
      select count(*)
      from tempa_private.pilot_invites
      where status = 'pending' and revoked_at is null
    ),
    'profiles_created', (
      select count(*)
      from public.profiles p
      join tempa_private.pilot_members pm on pm.user_id = p.id
    ),
    'first_contact_correspondences', a.first_contact_correspondences,
    'established_correspondences', a.established_correspondences,
    'third_turn_correspondences', a.third_turn_correspondences,
    'fifth_turn_correspondences', a.fifth_turn_correspondences,
    'survival_30_eligible', a.survival_30_eligible,
    'survival_30_alive', a.survival_30_alive,
    'survival_60_eligible', a.survival_60_eligible,
    'survival_60_alive', a.survival_60_alive,
    'survival_90_eligible', a.survival_90_eligible,
    'survival_90_alive', a.survival_90_alive
  )
  into v_result
  from aggregate a;

  return coalesce(v_result, '{}'::jsonb);
end;
$function$;

revoke all on function public.admin_pilot_health()
  from public, anon;
grant execute on function public.admin_pilot_health()
  to authenticated;

comment on function public.admin_pilot_health() is
  'Admin-only aggregate Founding Correspondents pilot funnel. Reads correspondence/letter metadata only; never letter bodies or public popularity signals.';

commit;


-- ============================================================
-- READ-ONLY VERIFICATION — 16 BOOLEANS, EVERY ONE SHOULD BE TRUE
-- ============================================================

select
  to_regclass('tempa_private.pilot_invites') is not null
    as pilot_invites_table_ready,

  to_regclass('tempa_private.pilot_members') is not null
    as pilot_members_table_ready,

  coalesce((
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'tempa_private' and c.relname = 'pilot_invites'
  ), false)
    as pilot_invites_rls_enabled,

  not has_table_privilege(
    'authenticated',
    'tempa_private.pilot_invites',
    'SELECT'
  )
    as authenticated_cannot_read_invite_emails_directly,

  to_regprocedure('public.current_pilot_access()') is not null
    as pilot_access_rpc_ready,

  has_function_privilege(
    'authenticated',
    'public.current_pilot_access()',
    'EXECUTE'
  )
    as authenticated_can_check_own_pilot_access,

  not has_function_privilege(
    'anon',
    'public.current_pilot_access()',
    'EXECUTE'
  )
    as anon_cannot_check_pilot_access,

  position(
    'from auth.users u'
    in pg_get_functiondef('public.current_pilot_access()'::regprocedure)
  ) > 0
    as pilot_access_uses_verified_auth_email,

  position(
    'tempa_private.pilot_members'
    in pg_get_functiondef('public.current_pilot_access()'::regprocedure)
  ) > 0
    as pilot_access_becomes_durable,

  to_regprocedure('public.admin_pilot_invite_email(text,text)') is not null
    as admin_pilot_invite_rpc_ready,

  to_regprocedure('public.admin_revoke_pilot_invite(uuid)') is not null
    as admin_pilot_revoke_rpc_ready,

  to_regprocedure('public.admin_list_pilot_invites()') is not null
    as admin_pilot_list_rpc_ready,

  to_regprocedure('public.admin_pilot_health()') is not null
    as admin_pilot_health_rpc_ready,

  position(
    'public.is_staff(''admin'')'
    in pg_get_functiondef('public.admin_pilot_health()'::regprocedure)
  ) > 0
    as pilot_health_is_admin_only,

  position(
    'l.created_at'
    in pg_get_functiondef('public.admin_pilot_health()'::regprocedure)
  ) > 0
    and position(
      'l.body'
      in pg_get_functiondef('public.admin_pilot_health()'::regprocedure)
    ) = 0
    as pilot_health_uses_metadata_not_letter_bodies,

  exists (
    select 1
    from tempa_private.pilot_members pm
  )
    as existing_accounts_grandfathered;
