-- ============================================================
-- TEMPA — PHASE 1: RELATIONSHIP CAPACITY FOUNDATION
-- PREPARED 2026-10-04. REVIEW BEFORE PRODUCTION EXECUTION.
--
-- Pilot invariants:
--   * 5 committed private correspondences by default.
--   * Controlled per-member experiment overrides may be 5–10.
--   * No paid-capacity concept exists here.
--   * Max 2 unresolved OUTGOING first letters.
--   * Max 2 unresolved INCOMING first letters.
--   * Outgoing unresolved first letters reserve sender capacity.
--   * Incoming unresolved first letters do NOT reserve recipient capacity.
--   * The first reciprocal reply establishes the correspondence and then
--     consumes recipient capacity.
--   * Existing established correspondences are never terminated merely
--     because a member is already at/above the current limit.
--   * Ongoing writing inside an established correspondence is never gated.
--
-- Enforcement deliberately lives on durable database state transitions:
--   1) a root Letter inserted into a still-pending correspondence;
--   2) pending -> active + established_at on first reciprocal reply.
-- This survives later RPC rewrites (including Safety wiring) and covers
-- every first-contact source, not only Question-answer entry points.
-- ============================================================

begin;

-- Refuse to install against the superseded lifecycle where a new
-- correspondence was active immediately. Phase 1 requires pending first.
do $prerequisite$
begin
  if to_regclass('public.correspondences') is null
     or to_regclass('public.letters') is null
     or not exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'correspondences'
         and column_name = 'status'
         and column_default = '''pending''::text'
     )
     or not exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'correspondences'
         and column_name = 'established_at'
     ) then
    raise exception
      'PREREQUISITE FAILED: apply the pending/active correspondence lifecycle before Phase 1 relationship capacity.';
  end if;
end
$prerequisite$;


-- ============================================================
-- 1. CONTROLLED CAPACITY OVERRIDES
-- ============================================================
create table if not exists public.correspondence_capacity_overrides (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_correspondence_limit smallint not null
    check (active_correspondence_limit between 5 and 10),
  reason text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.correspondence_capacity_overrides is
  'Controlled pilot experiment overrides for private-correspondence capacity. Default is 5; override range is 5–10. Not a billing or subscription table.';

alter table public.correspondence_capacity_overrides enable row level security;
revoke all on table public.correspondence_capacity_overrides from public, anon, authenticated;
grant select, insert, update, delete on table public.correspondence_capacity_overrides to service_role;


-- ============================================================
-- 2. TRANSACTION-SCOPED MEMBER LOCKS
-- ============================================================
create or replace function tempa_private.lock_relationship_capacity(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if p_user_id is null then
    raise exception 'A member id is required for relationship-capacity locking.'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tempa:relationship-capacity:' || p_user_id::text, 0)
  );
end;
$function$;

revoke all on function tempa_private.lock_relationship_capacity(uuid)
  from public, anon, authenticated, service_role;

create or replace function tempa_private.lock_relationship_capacity_pair(
  p_user_a uuid,
  p_user_b uuid
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_low uuid;
  v_high uuid;
begin
  if p_user_a is null or p_user_b is null then
    raise exception 'Two member ids are required for relationship-capacity locking.'
      using errcode = '22023';
  end if;

  v_low := least(p_user_a, p_user_b);
  v_high := greatest(p_user_a, p_user_b);

  perform tempa_private.lock_relationship_capacity(v_low);
  if v_high <> v_low then
    perform tempa_private.lock_relationship_capacity(v_high);
  end if;
end;
$function$;

revoke all on function tempa_private.lock_relationship_capacity_pair(uuid, uuid)
  from public, anon, authenticated, service_role;


-- ============================================================
-- 3. ONE CANONICAL CAPACITY STATE
-- ============================================================
-- A genuine unresolved first contact is a root letter inside a pending,
-- unestablished correspondence. This deliberately does NOT key on
-- question_answer_id: member-question and future first-contact sources must
-- receive exactly the same capacity treatment. Write Anytime root letters
-- cannot be mistaken for first contacts because they belong to established
-- active correspondences, never pending ones.
create or replace function tempa_private.relationship_capacity_state(
  p_user_id uuid
)
returns table (
  active_limit integer,
  established_count integer,
  outgoing_pending_count integer,
  incoming_pending_count integer,
  committed_count integer,
  available_slots integer,
  outgoing_pending_limit integer,
  incoming_pending_limit integer
)
language sql
stable
security definer
set search_path to 'pg_catalog'
as $function$
  with effective_limit as (
    select coalesce(
      (
        select o.active_correspondence_limit::integer
        from public.correspondence_capacity_overrides o
        where o.user_id = p_user_id
          and (o.expires_at is null or o.expires_at > now())
      ),
      5
    ) as active_limit
  ),
  established as (
    select count(*)::integer as n
    from public.correspondences c
    where c.status = 'active'
      and c.established_at is not null
      and (c.participant_low = p_user_id or c.participant_high = p_user_id)
  ),
  outgoing_pending as (
    select count(distinct l.correspondence_id)::integer as n
    from public.letters l
    join public.correspondences c on c.id = l.correspondence_id
    where l.sender_id = p_user_id
      and l.reply_to_id is null
      and l.status = 'sent'
      and l.expires_at > now()
      and c.status = 'pending'
      and c.established_at is null
  ),
  incoming_pending as (
    select count(distinct l.correspondence_id)::integer as n
    from public.letters l
    join public.correspondences c on c.id = l.correspondence_id
    where l.recipient_id = p_user_id
      and l.reply_to_id is null
      and l.status = 'sent'
      and l.expires_at > now()
      and c.status = 'pending'
      and c.established_at is null
  )
  select
    lim.active_limit,
    est.n,
    outp.n,
    inp.n,
    est.n + outp.n,
    greatest(lim.active_limit - (est.n + outp.n), 0),
    2,
    2
  from effective_limit lim
  cross join established est
  cross join outgoing_pending outp
  cross join incoming_pending inp
$function$;

revoke all on function tempa_private.relationship_capacity_state(uuid)
  from public, anon, authenticated, service_role;


-- ============================================================
-- 4. CALLER-ONLY CAPACITY READ RPC
-- ============================================================
create or replace function public.get_relationship_capacity()
returns table (
  active_limit integer,
  established_count integer,
  outgoing_pending_count integer,
  incoming_pending_count integer,
  committed_count integer,
  available_slots integer,
  outgoing_pending_limit integer,
  incoming_pending_limit integer,
  can_start_first_contact boolean,
  can_receive_first_contact boolean,
  grandfathered boolean
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  return query
  select
    s.active_limit,
    s.established_count,
    s.outgoing_pending_count,
    s.incoming_pending_count,
    s.committed_count,
    s.available_slots,
    s.outgoing_pending_limit,
    s.incoming_pending_limit,
    s.committed_count < s.active_limit
      and s.outgoing_pending_count < s.outgoing_pending_limit,
    s.incoming_pending_count < s.incoming_pending_limit,
    s.established_count > s.active_limit
  from tempa_private.relationship_capacity_state(auth.uid()) s;
end;
$function$;

revoke all on function public.get_relationship_capacity() from public, anon;
grant execute on function public.get_relationship_capacity() to authenticated;


-- ============================================================
-- 5. FIRST-CONTACT INSERT ENFORCEMENT
-- ============================================================
create or replace function tempa_private.enforce_first_contact_capacity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_correspondence public.correspondences%rowtype;
  v_sender record;
  v_recipient record;
begin
  -- A root letter alone is not enough: Write Anytime can also write a root
  -- letter. The pending correspondence is the durable first-contact marker.
  if new.reply_to_id is not null then
    return new;
  end if;

  select *
  into v_correspondence
  from public.correspondences c
  where c.id = new.correspondence_id;

  if not found
     or v_correspondence.status <> 'pending'
     or v_correspondence.established_at is not null then
    return new;
  end if;

  -- Lock both members in deterministic UUID order. This serializes the
  -- sender's committed/outgoing count and recipient's incoming count across
  -- concurrent tabs and different counterparties.
  perform tempa_private.lock_relationship_capacity_pair(new.sender_id, new.recipient_id);

  select * into v_sender
  from tempa_private.relationship_capacity_state(new.sender_id);

  if v_sender.committed_count >= v_sender.active_limit then
    raise exception 'You are already at your correspondence capacity.'
      using errcode = 'P0001', detail = 'RELATIONSHIP_CAPACITY_REACHED';
  end if;

  if v_sender.outgoing_pending_count >= v_sender.outgoing_pending_limit then
    raise exception 'You already have two first letters waiting for a response.'
      using errcode = 'P0001', detail = 'OUTGOING_FIRST_CONTACT_LIMIT_REACHED';
  end if;

  select * into v_recipient
  from tempa_private.relationship_capacity_state(new.recipient_id);

  -- Incoming first letters deliberately do not consume recipient active
  -- capacity. Only the independent incoming-pending ceiling applies here.
  if v_recipient.incoming_pending_count >= v_recipient.incoming_pending_limit then
    raise exception 'This member is not taking another first letter right now.'
      using errcode = 'P0001', detail = 'RECIPIENT_FIRST_CONTACT_LIMIT_REACHED';
  end if;

  return new;
end;
$function$;

revoke all on function tempa_private.enforce_first_contact_capacity()
  from public, anon, authenticated, service_role;

drop trigger if exists letters_enforce_first_contact_capacity on public.letters;
create trigger letters_enforce_first_contact_capacity
before insert on public.letters
for each row
execute function tempa_private.enforce_first_contact_capacity();


-- ============================================================
-- 6. FIRST-REPLY / ESTABLISHMENT ENFORCEMENT
-- ============================================================
create or replace function tempa_private.enforce_correspondence_establishment_capacity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_accepting_user uuid;
  v_has_reserved_slot boolean := false;
  v_state record;
begin
  if not (
    old.status = 'pending'
    and old.established_at is null
    and new.status = 'active'
    and new.established_at is not null
  ) then
    return new;
  end if;

  -- Normally reply_to_letter runs as the accepting authenticated member.
  -- The fallback keeps a trusted/server execution resolvable from the direct
  -- reply already inserted earlier in the same transaction.
  v_accepting_user := auth.uid();

  if v_accepting_user is null
     or (v_accepting_user <> old.participant_low and v_accepting_user <> old.participant_high) then
    select reply.sender_id
    into v_accepting_user
    from public.letters root
    join public.letters reply on reply.reply_to_id = root.id
    where root.correspondence_id = old.id
      and root.reply_to_id is null
    order by reply.created_at desc, reply.id desc
    limit 1;
  end if;

  if v_accepting_user is null then
    raise exception 'Could not resolve the member establishing this correspondence.'
      using errcode = 'P0001', detail = 'RELATIONSHIP_CAPACITY_ACTOR_UNRESOLVED';
  end if;

  perform tempa_private.lock_relationship_capacity(v_accepting_user);

  -- Crossed first contacts: if this accepting member also sent a still-live
  -- root first letter inside the same pending correspondence, that episode
  -- already reserves one of their committed slots. Establishment converts
  -- that reservation into active; it must not charge a second slot.
  select exists (
    select 1
    from public.letters l
    where l.correspondence_id = old.id
      and l.sender_id = v_accepting_user
      and l.reply_to_id is null
      and l.status = 'sent'
      and l.expires_at > now()
  ) into v_has_reserved_slot;

  if not v_has_reserved_slot then
    select * into v_state
    from tempa_private.relationship_capacity_state(v_accepting_user);

    if v_state.committed_count >= v_state.active_limit then
      raise exception 'You need an open correspondence slot before accepting another correspondence.'
        using errcode = 'P0001', detail = 'RELATIONSHIP_CAPACITY_REACHED';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function tempa_private.enforce_correspondence_establishment_capacity()
  from public, anon, authenticated, service_role;

drop trigger if exists correspondences_enforce_establishment_capacity on public.correspondences;
create trigger correspondences_enforce_establishment_capacity
before update of status, established_at on public.correspondences
for each row
execute function tempa_private.enforce_correspondence_establishment_capacity();


comment on function public.get_relationship_capacity() is
  'Caller-only canonical Phase 1 relationship capacity: established active relationships + unresolved outgoing first contacts consume committed capacity; unresolved incoming first contacts do not.';

comment on trigger letters_enforce_first_contact_capacity on public.letters is
  'Phase 1 invariant: max committed/private capacity, max 2 outgoing pending, max 2 incoming pending, enforced for every root letter in a pending correspondence.';

comment on trigger correspondences_enforce_establishment_capacity on public.correspondences is
  'Phase 1 invariant: pending -> active establishment requires capacity for the accepting member unless this correspondence already reserved their slot via a crossed outgoing first contact.';

commit;
