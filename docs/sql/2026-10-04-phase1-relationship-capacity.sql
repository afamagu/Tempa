-- ============================================================
-- TEMPA — PHASE 1: RELATIONSHIP CAPACITY FOUNDATION
-- PREPARED 2026-10-04. REVIEW BEFORE PRODUCTION EXECUTION.
--
-- PURPOSE
-- -------
-- Tempa's pilot deliberately keeps private correspondence small enough
-- for people to sustain. This migration makes that product rule a
-- database invariant instead of a UI convention.
--
-- Pilot rules encoded here:
--   * 5 committed private correspondences by default.
--   * A controlled per-member override may raise that limit only to 6–10.
--   * No paid-capacity concept exists here.
--   * At most 2 unresolved OUTGOING first letters.
--   * At most 2 unresolved INCOMING first letters.
--   * An outgoing unresolved first letter reserves one sender slot.
--   * An incoming unresolved first letter does NOT reserve a recipient slot.
--   * The recipient consumes a slot only when their first reciprocal reply
--     establishes the correspondence.
--   * Existing established correspondences are never terminated merely
--     because a member is already at/above the pilot limit.
--   * Ongoing writing inside an established correspondence is never gated
--     by this capacity layer.
--
-- ARCHITECTURE
-- ------------
-- Capacity is enforced on the durable database transitions, NOT by
-- duplicating checks in one particular UI or RPC version:
--
--   1) BEFORE INSERT on public.letters for a genuine first-contact root
--      (reply_to_id IS NULL + question_answer_id IS NOT NULL + pending
--      correspondence). This protects every first-contact write path.
--
--   2) BEFORE UPDATE on public.correspondences when pending -> active with
--      established_at set. This protects the first reciprocal reply even
--      if reply_to_letter is later replaced by another migration.
--
-- This is deliberate: docs/sql/2026-10-05-safety-checkpoint3-letter-wiring.sql
-- later replaces the letter RPC definitions to require Safety evaluations.
-- Trigger-level capacity enforcement therefore survives that replacement
-- and does not weaken or duplicate Safety's own chokepoint.
--
-- Concurrency is serialized with transaction-scoped advisory locks keyed
-- per member. First-contact inserts lock BOTH sender and recipient in
-- deterministic UUID order; establishment locks the accepting member.
-- Concurrent tabs/requests therefore cannot race past either the 5-slot
-- committed limit or either 2-first-letter limit.
--
-- PREREQUISITE
-- ------------
-- Requires the pending/active/closed correspondence lifecycle prepared by
-- the September correspondence hardening: a new first contact owns a
-- status='pending' correspondence, and its first reciprocal reply changes
-- it to status='active' and sets established_at.
-- ============================================================

begin;

-- Fail loudly rather than installing against the superseded lifecycle in
-- which new correspondence rows began as active.
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
-- Pilot default is 5. Overrides exist only so a deliberate experiment can
-- place a member at 6–10 without changing application code. There is no
-- subscription/commerce/paid-plan field by design.
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
-- 2. CAPACITY LOCKS
-- ============================================================
-- A stable member-keyed transaction lock. hashtextextended supplies the
-- signed bigint required by pg_advisory_xact_lock. Transaction-scoped means
-- no cleanup is required: commit/rollback releases it automatically.
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

-- Lock a pair in global UUID order. Every first-contact insertion uses this
-- helper, so overlapping sender/recipient pairs cannot deadlock by taking
-- the same two member locks in opposite order.
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
-- "Unresolved first letter" deliberately keys on BOTH the root letter and
-- its still-pending correspondence. This matters because a crossed first
-- contact can place two root letters (one each direction) inside the same
-- pending correspondence. Once either first reciprocal reply establishes
-- the episode, c.status becomes active and neither root remains a pending
-- reservation/incoming request for capacity purposes.
--
-- Effective expiry is respected even if the scheduled expiry job has not
-- yet closed the root letter: expires_at > now() is required.
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
      and l.question_answer_id is not null
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
      and l.question_answer_id is not null
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
-- 4. MEMBER-SAFE READ RPC
-- ============================================================
-- UI surfaces can ask the database once rather than reimplementing what
-- counts as full. It exposes only the caller's own aggregate state.
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
  -- reply_to_id NULL also occurs for Write Anytime letters. A genuine
  -- first-contact root is the only root that carries its Discovery
  -- question_answer_id, and its correspondence must still be pending.
  if new.reply_to_id is not null or new.question_answer_id is null then
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

  -- Serialize BOTH constraints before counting. The existing RPC may have
  -- already locked the correspondence row; these advisory locks protect
  -- the cross-correspondence per-member totals that row locks cannot.
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

  -- The recipient's ACTIVE capacity is intentionally irrelevant here:
  -- incoming first letters do not consume an active slot. Only the
  -- independent incoming-pending limit is enforced at arrival time.
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
  -- Only the one lifecycle edge that creates an established relationship.
  -- Ordinary updates to an already-active correspondence and closure never
  -- enter this branch.
  if not (
    old.status = 'pending'
    and old.established_at is null
    and new.status = 'active'
    and new.established_at is not null
  ) then
    return new;
  end if;

  -- In the normal reply_to_letter path auth.uid() is exactly the person
  -- accepting the incoming first letter. Keep a defensive fallback for a
  -- trusted server path: the direct reply inserted earlier in the same
  -- transaction identifies the participant who actually replied.
  v_accepting_user := auth.uid();

  if v_accepting_user is null
     or (v_accepting_user <> old.participant_low and v_accepting_user <> old.participant_high) then
    select reply.sender_id
    into v_accepting_user
    from public.letters root
    join public.letters reply on reply.reply_to_id = root.id
    where root.correspondence_id = old.id
      and root.reply_to_id is null
      and root.question_answer_id is not null
    order by reply.created_at desc, reply.id desc
    limit 1;
  end if;

  if v_accepting_user is null then
    raise exception 'Could not resolve the member establishing this correspondence.'
      using errcode = 'P0001', detail = 'RELATIONSHIP_CAPACITY_ACTOR_UNRESOLVED';
  end if;

  perform tempa_private.lock_relationship_capacity(v_accepting_user);

  -- Crossed first contacts are important: if the accepting member ALSO
  -- sent an unresolved first letter inside this same pending episode, they
  -- already reserved this correspondence in their committed total. Turning
  -- that one reservation into an active relationship must not charge them
  -- a second slot.
  select exists (
    select 1
    from public.letters l
    where l.correspondence_id = old.id
      and l.sender_id = v_accepting_user
      and l.reply_to_id is null
      and l.question_answer_id is not null
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


-- ============================================================
-- 7. DOCUMENT THE INVARIANTS WHERE FUTURE MIGRATIONS WILL SEE THEM
-- ============================================================
comment on function public.get_relationship_capacity() is
  'Caller-only canonical Phase 1 relationship capacity: active established relationships + unresolved outgoing first contacts consume committed capacity; unresolved incoming first contacts do not.';

comment on trigger letters_enforce_first_contact_capacity on public.letters is
  'Phase 1 invariant: max committed/private capacity, max 2 outgoing pending, max 2 incoming pending. Uses transaction-scoped per-member locks for race safety.';

comment on trigger correspondences_enforce_establishment_capacity on public.correspondences is
  'Phase 1 invariant: pending -> active establishment requires capacity for the accepting member unless this same correspondence already reserved their slot via a crossed outgoing first contact.';

commit;
