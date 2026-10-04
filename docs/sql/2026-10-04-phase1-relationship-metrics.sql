-- ============================================================
-- TEMPA — PHASE 1: RELATIONSHIP HEALTH MEASUREMENT
-- PREPARED 2026-10-04. REVIEW BEFORE PRODUCTION EXECUTION.
--
-- PURPOSE
-- -------
-- Capture only the historical facts Tempa cannot reconstruct later, then
-- derive pilot relationship-health metrics from existing Letter metadata.
-- No private letter body, Moment, Postcard text, photo, or private note is
-- copied into this measurement layer.
--
-- What is snapshotted at establishment:
--   * each participant's active-limit at that moment;
--   * established relationship count INCLUDING the relationship just formed;
--   * committed count (established + other live outgoing reservations);
--   * outgoing/incoming pending counts.
--
-- What is derived later from public.letters metadata:
--   * sender turns (consecutive letters by the same sender collapse to one);
--   * third/fifth turn progression;
--   * participant turn balance / reciprocity ratio;
--   * whether the relationship has any / mutual activity after day 30.
--
-- IMPORTANT
-- ---------
-- Existing relationships are deliberately NOT backfilled. Their true chair
-- load at the historical establishment moment cannot be reconstructed
-- faithfully. Pilot metrics therefore begin with correspondences established
-- after this migration is installed.
-- ============================================================

begin;

-- Phase 1 capacity foundation must already be live.
do $prerequisite$
begin
  if to_regprocedure('tempa_private.relationship_capacity_state(uuid)') is null
     or to_regclass('public.correspondences') is null
     or to_regclass('public.letters') is null then
    raise exception
      'PREREQUISITE FAILED: apply Phase 1 relationship capacity before Phase 1 relationship metrics.';
  end if;
end
$prerequisite$;


-- ============================================================
-- 1. IMMUTABLE ESTABLISHMENT SNAPSHOTS
-- ============================================================
create table if not exists public.relationship_establishment_snapshots (
  correspondence_id uuid not null
    references public.correspondences(id)
    on delete cascade,

  user_id uuid not null
    references auth.users(id)
    on delete cascade,

  counterpart_id uuid not null
    references auth.users(id)
    on delete cascade,

  established_at timestamptz not null,

  active_limit_at_establishment integer not null
    check (active_limit_at_establishment > 0),

  established_count_at_establishment integer not null
    check (established_count_at_establishment >= 0),

  outgoing_pending_count_at_establishment integer not null
    check (outgoing_pending_count_at_establishment >= 0),

  incoming_pending_count_at_establishment integer not null
    check (incoming_pending_count_at_establishment >= 0),

  committed_count_at_establishment integer not null
    check (committed_count_at_establishment >= 0),

  captured_at timestamptz not null default now(),

  primary key (correspondence_id, user_id),

  constraint relationship_establishment_snapshot_not_self
    check (user_id <> counterpart_id)
);

comment on table public.relationship_establishment_snapshots is
  'Private pilot-measurement snapshot captured only when a correspondence becomes established. Contains relationship/capacity metadata only; never private letter content.';

alter table public.relationship_establishment_snapshots enable row level security;

revoke all on table public.relationship_establishment_snapshots
  from public, anon, authenticated;

grant select on table public.relationship_establishment_snapshots
  to service_role;


-- ============================================================
-- 2. CAPTURE ON THE ONE ESTABLISHMENT TRANSITION
-- ============================================================
create or replace function tempa_private.capture_relationship_establishment_snapshot()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_user_id uuid;
  v_counterpart_id uuid;
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

  foreach v_user_id in array array[new.participant_low, new.participant_high]
  loop
    v_counterpart_id := case
      when v_user_id = new.participant_low then new.participant_high
      else new.participant_low
    end;

    -- AFTER UPDATE means relationship_capacity_state already sees this new
    -- relationship as established. That is exactly the chair count we want
    -- to compare with later third/fifth-turn and 30-day behavior.
    select * into v_state
    from tempa_private.relationship_capacity_state(v_user_id);

    insert into public.relationship_establishment_snapshots (
      correspondence_id,
      user_id,
      counterpart_id,
      established_at,
      active_limit_at_establishment,
      established_count_at_establishment,
      outgoing_pending_count_at_establishment,
      incoming_pending_count_at_establishment,
      committed_count_at_establishment
    )
    values (
      new.id,
      v_user_id,
      v_counterpart_id,
      new.established_at,
      v_state.active_limit,
      v_state.established_count,
      v_state.outgoing_pending_count,
      v_state.incoming_pending_count,
      v_state.committed_count
    )
    on conflict (correspondence_id, user_id) do nothing;
  end loop;

  return new;
end;
$function$;

revoke all on function tempa_private.capture_relationship_establishment_snapshot()
  from public, anon, authenticated, service_role;

drop trigger if exists correspondences_capture_relationship_establishment_snapshot
  on public.correspondences;

create trigger correspondences_capture_relationship_establishment_snapshot
after update of status, established_at on public.correspondences
for each row
execute function tempa_private.capture_relationship_establishment_snapshot();


-- ============================================================
-- 3. SERVICE-ONLY RELATIONSHIP HEALTH REPORT
-- ============================================================
-- A "turn" is one or more consecutive letters by the same sender. This is
-- deliberately stricter than raw letter count: Write Anytime follow-ups from
-- one person do not falsely look like additional reciprocity.
create or replace function public.get_relationship_pilot_metrics()
returns table (
  correspondence_id uuid,
  user_id uuid,
  counterpart_id uuid,
  established_at timestamptz,
  active_limit_at_establishment integer,
  established_count_at_establishment integer,
  committed_count_at_establishment integer,
  chair_band text,
  total_turns integer,
  user_turns integer,
  counterpart_turns integer,
  third_turn_at timestamptz,
  fifth_turn_at timestamptz,
  reached_third_turn boolean,
  reached_fifth_turn boolean,
  thirty_day_eligible boolean,
  any_activity_after_30_days boolean,
  mutual_activity_after_30_days boolean,
  last_turn_at timestamptz,
  reciprocity_ratio numeric
)
language sql
stable
security definer
set search_path to 'pg_catalog'
as $function$
  with tracked as (
    select distinct s.correspondence_id
    from public.relationship_establishment_snapshots s
  ),
  ordered_letters as (
    select
      l.correspondence_id,
      l.id,
      l.sender_id,
      l.created_at,
      lag(l.sender_id) over (
        partition by l.correspondence_id
        order by l.created_at, l.id
      ) as previous_sender_id
    from public.letters l
    join tracked t on t.correspondence_id = l.correspondence_id
  ),
  marked_letters as (
    select
      o.*,
      case
        when o.previous_sender_id is distinct from o.sender_id then 1
        else 0
      end as starts_new_turn
    from ordered_letters o
  ),
  numbered_letters as (
    select
      m.*,
      sum(m.starts_new_turn) over (
        partition by m.correspondence_id
        order by m.created_at, m.id
        rows between unbounded preceding and current row
      )::integer as turn_number
    from marked_letters m
  ),
  turns as (
    select
      n.correspondence_id,
      n.turn_number,
      n.sender_id,
      min(n.created_at) as turn_at
    from numbered_letters n
    group by n.correspondence_id, n.turn_number, n.sender_id
  )
  select
    s.correspondence_id,
    s.user_id,
    s.counterpart_id,
    s.established_at,
    s.active_limit_at_establishment,
    s.established_count_at_establishment,
    s.committed_count_at_establishment,
    case
      when s.established_count_at_establishment between 1 and 3 then '1-3'
      when s.established_count_at_establishment between 4 and 5 then '4-5'
      when s.established_count_at_establishment between 6 and 10 then '6-10'
      else '11+'
    end as chair_band,
    coalesce(m.total_turns, 0),
    coalesce(m.user_turns, 0),
    coalesce(m.counterpart_turns, 0),
    m.third_turn_at,
    m.fifth_turn_at,
    m.third_turn_at is not null,
    m.fifth_turn_at is not null,
    now() >= s.established_at + interval '30 days',
    coalesce(m.any_activity_after_30_days, false),
    coalesce(m.user_activity_after_30_days, false)
      and coalesce(m.counterpart_activity_after_30_days, false),
    m.last_turn_at,
    case
      when greatest(coalesce(m.user_turns, 0), coalesce(m.counterpart_turns, 0)) = 0 then null
      else round(
        least(coalesce(m.user_turns, 0), coalesce(m.counterpart_turns, 0))::numeric
        / greatest(coalesce(m.user_turns, 0), coalesce(m.counterpart_turns, 0))::numeric,
        4
      )
    end as reciprocity_ratio
  from public.relationship_establishment_snapshots s
  left join lateral (
    select
      count(*)::integer as total_turns,
      count(*) filter (where t.sender_id = s.user_id)::integer as user_turns,
      count(*) filter (where t.sender_id = s.counterpart_id)::integer as counterpart_turns,
      min(t.turn_at) filter (where t.turn_number = 3) as third_turn_at,
      min(t.turn_at) filter (where t.turn_number = 5) as fifth_turn_at,
      bool_or(t.turn_at >= s.established_at + interval '30 days') as any_activity_after_30_days,
      bool_or(
        t.sender_id = s.user_id
        and t.turn_at >= s.established_at + interval '30 days'
      ) as user_activity_after_30_days,
      bool_or(
        t.sender_id = s.counterpart_id
        and t.turn_at >= s.established_at + interval '30 days'
      ) as counterpart_activity_after_30_days,
      max(t.turn_at) as last_turn_at
    from turns t
    where t.correspondence_id = s.correspondence_id
  ) m on true
  order by s.established_at, s.correspondence_id, s.user_id
$function$;

revoke all on function public.get_relationship_pilot_metrics()
  from public, anon, authenticated;
grant execute on function public.get_relationship_pilot_metrics()
  to service_role;

comment on function public.get_relationship_pilot_metrics() is
  'Service-only Phase 1 pilot report derived from relationship/letter metadata. Consecutive same-sender letters collapse into one turn; no private letter content is returned.';


-- ============================================================
-- 4. SERVICE-ONLY FIRST-CONTACT FUNNEL
-- ============================================================
-- One row in this report represents one correspondence episode, not one root
-- Letter, so crossed first-contact letters do not double-count the same
-- relationship attempt.
create or replace function public.get_relationship_first_contact_funnel(
  p_since timestamptz default null
)
returns table (
  outcome text,
  episode_count bigint
)
language sql
stable
security definer
set search_path to 'pg_catalog'
as $function$
  with episodes as (
    select
      c.id as correspondence_id,
      c.status as correspondence_status,
      c.established_at,
      min(l.created_at) filter (where l.reply_to_id is null) as first_contact_at,
      bool_or(
        l.reply_to_id is null
        and l.status = 'closed'
        and l.closed_by = 'recipient'
      ) as recipient_passed,
      bool_or(
        l.reply_to_id is null
        and l.status = 'sent'
        and l.expires_at > now()
      ) as has_live_pending_root
    from public.correspondences c
    join public.letters l on l.correspondence_id = c.id
    group by c.id, c.status, c.established_at
  ),
  classified as (
    select
      case
        when e.established_at is not null then 'established'
        when e.recipient_passed then 'passed'
        when e.correspondence_status = 'closed' or not e.has_live_pending_root then 'unanswered'
        else 'pending'
      end as outcome
    from episodes e
    where e.first_contact_at is not null
      and (p_since is null or e.first_contact_at >= p_since)
  )
  select c.outcome, count(*)::bigint
  from classified c
  group by c.outcome
  order by c.outcome
$function$;

revoke all on function public.get_relationship_first_contact_funnel(timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_relationship_first_contact_funnel(timestamptz)
  to service_role;

comment on function public.get_relationship_first_contact_funnel(timestamptz) is
  'Service-only first-contact episode funnel: established, passed, unanswered, or pending. Uses metadata only and counts crossed first contacts once per correspondence episode.';

commit;
