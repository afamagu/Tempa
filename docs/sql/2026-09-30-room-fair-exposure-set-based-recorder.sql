-- TEMPA — ROOM FAIR EXPOSURE SET-BASED RECORDER
-- STATUS: NOT EXECUTED IN PRODUCTION
-- Forward-only follow-up to 2026-09-30-room-fair-exposure.sql.
--
-- Purpose:
--   * remove the per-candidate PL/pgSQL loop from record_room_exposures;
--   * preserve one distinct-viewer fairness opportunity per candidate/week;
--   * preserve one total_times_served increment and one raw event per served
--     candidate for every recorder call;
--   * keep the weekly transition concurrency-safe by retaining the conditional
--     ON CONFLICT update as the atomic counting gate.

begin;

create or replace function public.record_room_exposures(
  p_viewer uuid,
  p_candidate_ids uuid[],
  p_surface text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $function$
declare
  v_week date := date_trunc('week', now())::date;
  v_served_at timestamptz := now();
  v_candidates uuid[] := array[]::uuid[];
  v_counted_ids uuid[] := array[]::uuid[];
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;
  if p_surface not in ('home_room', 'room', 'room_question') then
    raise exception 'invalid Room exposure surface';
  end if;

  -- Discovery results are expected to be unique, but normalize defensively so
  -- one bulk INSERT can never attempt to affect the same conflict key twice.
  select coalesce(array_agg(candidate_id order by candidate_id), array[]::uuid[])
  into v_candidates
  from (
    select distinct candidate_id
    from unnest(coalesce(p_candidate_ids, array[]::uuid[])) as supplied(candidate_id)
    where candidate_id is not null
      and candidate_id <> p_viewer
  ) normalized;

  if cardinality(v_candidates) = 0 then
    return;
  end if;

  -- First serve ever, or first serve in a new accounting week, crosses this
  -- atomic gate. Under concurrent calls PostgreSQL re-checks the WHERE clause
  -- against the locked current row, so only one call can count the viewer for
  -- this candidate/week.
  with counted as (
    insert into private.room_member_exposure (
      viewer_id,
      candidate_id,
      first_served_at,
      last_served_at,
      last_accounting_week,
      total_times_served
    )
    select
      p_viewer,
      candidate_id,
      v_served_at,
      v_served_at,
      v_week,
      1
    from unnest(v_candidates) as candidates(candidate_id)
    on conflict (viewer_id, candidate_id) do update
      set last_served_at = excluded.last_served_at,
          last_accounting_week = excluded.last_accounting_week,
          total_times_served = private.room_member_exposure.total_times_served + 1
      where private.room_member_exposure.last_accounting_week is distinct from excluded.last_accounting_week
    returning candidate_id
  )
  select coalesce(array_agg(candidate_id order by candidate_id), array[]::uuid[])
  into v_counted_ids
  from counted;

  -- Candidates already counted for this viewer/week still represent a real
  -- serving, so advance their recency and lifetime serve count exactly once.
  -- Newly counted rows are excluded because the upsert above already did so.
  update private.room_member_exposure as exposure
  set last_served_at = v_served_at,
      total_times_served = exposure.total_times_served + 1
  from unnest(v_candidates) as candidates(candidate_id)
  where exposure.viewer_id = p_viewer
    and exposure.candidate_id = candidates.candidate_id
    and exposure.last_accounting_week = v_week
    and not (exposure.candidate_id = any(v_counted_ids));

  -- Update weekly fairness totals only for candidates that crossed the atomic
  -- gate above. In the same statement, retain one private operational event for
  -- every candidate actually served by this call.
  with weekly_counts as (
    insert into private.room_candidate_week_exposure (
      candidate_id,
      week_start,
      distinct_viewers,
      first_exposure_at,
      last_exposure_at
    )
    select
      candidate_id,
      v_week,
      1,
      v_served_at,
      v_served_at
    from unnest(v_counted_ids) as counted(candidate_id)
    on conflict (candidate_id, week_start) do update
      set distinct_viewers = private.room_candidate_week_exposure.distinct_viewers + 1,
          first_exposure_at = coalesce(
            private.room_candidate_week_exposure.first_exposure_at,
            excluded.first_exposure_at
          ),
          last_exposure_at = excluded.last_exposure_at
    returning candidate_id
  )
  insert into private.room_exposure_events (
    viewer_id,
    candidate_id,
    surface,
    served_at
  )
  select
    p_viewer,
    candidate_id,
    p_surface,
    v_served_at
  from unnest(v_candidates) as candidates(candidate_id);
end
$function$;

revoke all on function public.record_room_exposures(uuid, uuid[], text)
  from public, anon, authenticated;
grant execute on function public.record_room_exposures(uuid, uuid[], text)
  to service_role;

commit;
