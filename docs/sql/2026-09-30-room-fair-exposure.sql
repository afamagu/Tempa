-- TEMPA — ROOM FAIR EXPOSURE + DISCOVERY V2
-- STATUS: NOT EXECUTED IN PRODUCTION
-- Forward-only migration. Do not edit older discovery migrations.
--
-- Purpose:
--   * keep candidate eligibility under the caller's normal RLS context;
--   * remember viewer/candidate encounters privately;
--   * give unseen and underexposed people priority without popularity signals;
--   * keep the existing stable viewer/candidate hash only as the final tie-break;
--   * support current-Question-only discovery without hiding nonparticipants from
--     ordinary Read the Room discovery.
--
-- Recovery: application code is required to fall back to public.discover_people
-- if discover_people_v2 is unavailable. The objects below can therefore be left
-- unused while production is inspected/recovered; do not DROP data as rollback.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.room_member_exposure (
  viewer_id uuid not null references auth.users(id) on delete cascade,
  candidate_id uuid not null references auth.users(id) on delete cascade,
  first_served_at timestamptz not null default now(),
  last_served_at timestamptz not null default now(),
  last_accounting_week date not null default date_trunc('week', now())::date,
  total_times_served bigint not null default 1 check (total_times_served >= 1),
  primary key (viewer_id, candidate_id),
  check (viewer_id <> candidate_id)
);

create table if not exists private.room_candidate_week_exposure (
  candidate_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  distinct_viewers bigint not null default 0 check (distinct_viewers >= 0),
  first_exposure_at timestamptz,
  last_exposure_at timestamptz,
  primary key (candidate_id, week_start)
);

create table if not exists private.room_exposure_events (
  id bigint generated always as identity primary key,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  candidate_id uuid not null references auth.users(id) on delete cascade,
  surface text not null check (surface in ('home_room', 'room', 'room_question')),
  served_at timestamptz not null default now()
);

create index if not exists room_member_exposure_candidate_idx
  on private.room_member_exposure (candidate_id, last_served_at);
create index if not exists room_candidate_week_exposure_week_idx
  on private.room_candidate_week_exposure (week_start, distinct_viewers, candidate_id);
create index if not exists room_exposure_events_served_idx
  on private.room_exposure_events (served_at, surface);

alter table private.room_member_exposure enable row level security;
alter table private.room_candidate_week_exposure enable row level security;
alter table private.room_exposure_events enable row level security;

revoke all on private.room_member_exposure from public, anon, authenticated;
revoke all on private.room_candidate_week_exposure from public, anon, authenticated;
revoke all on private.room_exposure_events from public, anon, authenticated;

-- One source of truth for the initial new-member floor. These values can be
-- tuned later from Pulse evidence without scattering constants through app code.
create table if not exists private.room_discovery_config (
  singleton boolean primary key default true check (singleton),
  new_member_window_days integer not null check (new_member_window_days between 1 and 90),
  new_member_floor_distinct_viewers integer not null check (new_member_floor_distinct_viewers between 1 and 1000)
);

insert into private.room_discovery_config (singleton, new_member_window_days, new_member_floor_distinct_viewers)
values (true, 7, 6)
on conflict (singleton) do nothing;

revoke all on private.room_discovery_config from public, anon, authenticated;

-- Narrow privileged helper. It validates that the requested viewer is the
-- authenticated caller and returns only rank facts for the supplied bounded
-- candidate set. It does not expose a public profile statistic endpoint.
create or replace function public.room_discovery_rank_facts(
  p_viewer uuid,
  p_candidate_ids uuid[]
)
returns table (
  candidate_id uuid,
  seen_bucket integer,
  weekly_exposure_count bigint,
  new_member_below_floor integer,
  last_served_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public, private, auth
as $function$
  with guard as (
    select auth.uid() as caller
  ),
  cfg as (
    select new_member_window_days, new_member_floor_distinct_viewers
    from private.room_discovery_config
    where singleton = true
  ),
  ids as (
    select distinct unnest(coalesce(p_candidate_ids, array[]::uuid[])) as candidate_id
  )
  select
    i.candidate_id,
    case when me.viewer_id is null then 0 else 1 end as seen_bucket,
    coalesce(cw.distinct_viewers, 0) as weekly_exposure_count,
    case
      when au.created_at >= now() - make_interval(days => cfg.new_member_window_days)
       and coalesce(cw.distinct_viewers, 0) < cfg.new_member_floor_distinct_viewers
      then 1 else 0
    end as new_member_below_floor,
    me.last_served_at
  from ids i
  cross join guard g
  cross join cfg
  left join private.room_member_exposure me
    on me.viewer_id = p_viewer and me.candidate_id = i.candidate_id
  left join private.room_candidate_week_exposure cw
    on cw.candidate_id = i.candidate_id
   and cw.week_start = date_trunc('week', now())::date
  left join auth.users au on au.id = i.candidate_id
  where g.caller is not null and g.caller = p_viewer
$function$;

revoke all on function public.room_discovery_rank_facts(uuid, uuid[]) from public, anon;
grant execute on function public.room_discovery_rank_facts(uuid, uuid[]) to authenticated;

-- Trusted server/service-role recorder. One viewer/candidate contributes at
-- most one fairness opportunity per accounting week, even across refreshes.
-- Raw events remain useful operationally for surface auditing, but are private.
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
  v_candidate uuid;
  v_week date := date_trunc('week', now())::date;
  v_counted uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;
  if p_surface not in ('home_room', 'room', 'room_question') then
    raise exception 'invalid Room exposure surface';
  end if;

  foreach v_candidate in array coalesce(p_candidate_ids, array[]::uuid[]) loop
    if v_candidate is null or v_candidate = p_viewer then continue; end if;
    v_counted := null;

    insert into private.room_member_exposure (
      viewer_id, candidate_id, first_served_at, last_served_at,
      last_accounting_week, total_times_served
    ) values (
      p_viewer, v_candidate, now(), now(), v_week, 1
    )
    on conflict (viewer_id, candidate_id) do update
      set last_served_at = excluded.last_served_at,
          last_accounting_week = excluded.last_accounting_week,
          total_times_served = private.room_member_exposure.total_times_served + 1
      where private.room_member_exposure.last_accounting_week is distinct from excluded.last_accounting_week
    returning candidate_id into v_counted;

    -- Record the serving event for operations regardless of whether it is a new
    -- weekly fairness opportunity. It never affects ranking by popularity.
    insert into private.room_exposure_events (viewer_id, candidate_id, surface)
    values (p_viewer, v_candidate, p_surface);

    if v_counted is not null then
      insert into private.room_candidate_week_exposure (
        candidate_id, week_start, distinct_viewers, first_exposure_at, last_exposure_at
      ) values (
        v_candidate, v_week, 1, now(), now()
      )
      on conflict (candidate_id, week_start) do update
        set distinct_viewers = private.room_candidate_week_exposure.distinct_viewers + 1,
            first_exposure_at = coalesce(private.room_candidate_week_exposure.first_exposure_at, excluded.first_exposure_at),
            last_exposure_at = excluded.last_exposure_at;
    else
      update private.room_member_exposure
      set last_served_at = now(),
          total_times_served = total_times_served + 1
      where viewer_id = p_viewer and candidate_id = v_candidate;
    end if;
  end loop;
end
$function$;

revoke all on function public.record_room_exposures(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.record_room_exposures(uuid, uuid[], text) to service_role;

-- V2 keeps candidate eligibility SECURITY INVOKER. Only the narrow rank helper
-- above can see private exposure state.
create or replace function public.discover_people_v2(
  p_country text default null,
  p_gender text default null,
  p_age_range text default null,
  p_question_id uuid default null,
  p_exclude_user_ids uuid[] default array[]::uuid[],
  p_offset integer default 0,
  p_limit integer default 6
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $function$
  with viewer as (
    select auth.uid() as id
  ),
  flagship as (
    select q.id from public.questions q where q.is_flagship = true limit 1
  ),
  room_question as (
    select q.id
    from public.questions q
    where q.is_active = true
      and q.is_flagship = false
      and q.current_position is not null
    order by q.current_position asc
    limit 1
  ),
  partners as materialized (
    select case when c.participant_low = v.id then c.participant_high else c.participant_low end as user_id
    from public.correspondences c
    cross join viewer v
    where c.status = 'active'
      and (c.participant_low = v.id or c.participant_high = v.id)
  ),
  contacted as materialized (
    select l.question_answer_id as answer_id
    from public.letters_for_participant l
    cross join viewer v
    where l.sender_id = v.id
      and l.reply_to_id is null
      and l.question_answer_id is not null
  ),
  representative as materialized (
    select distinct on (qa.user_id)
      qa.id, qa.user_id, qa.question_id, qa.body
    from public.question_answers qa
    cross join viewer v
    where qa.moderation_status = 'visible'
      and qa.user_id <> v.id
      and (p_question_id is null or qa.question_id = p_question_id)
    order by
      qa.user_id,
      case
        when p_question_id is not null and qa.question_id = p_question_id then 0
        when qa.question_id = (select rq.id from room_question rq) then 1
        when qa.question_id = (select f.id from flagship f) then 2
        when qa.is_current then 3
        else 4
      end,
      qa.updated_at desc nulls last,
      qa.id
  ),
  visible_profiles as materialized (
    select p.id, p.pseudonym, p.country, p.gender, p.gender_custom, p.age_range, p.mark_id
    from public.public_profiles p
    cross join viewer v
    where p.id <> v.id
  ),
  eligible as materialized (
    select
      r.id as answer_id,
      r.question_id,
      r.body,
      p.id as user_id,
      p.pseudonym,
      p.country,
      p.gender,
      p.gender_custom,
      p.age_range,
      p.mark_id,
      case when r.question_id = (select rq.id from room_question rq) then 1 else 0 end as current_question_relevance,
      hashtext(v.id::text || ':' || p.id::text) as stable_hash
    from representative r
    join visible_profiles p on p.id = r.user_id
    cross join viewer v
    where not exists (select 1 from partners x where x.user_id = r.user_id)
      and not exists (select 1 from contacted c where c.answer_id = r.id)
      and not (r.user_id = any(coalesce(p_exclude_user_ids, array[]::uuid[])))
  ),
  filtered as materialized (
    select e.*
    from eligible e
    where (nullif(p_country, '') is null or e.country = p_country)
      and (
        nullif(p_gender, '') is null
        or e.gender = p_gender
        or (e.gender = 'Self-describe' and e.gender_custom = p_gender)
      )
      and (nullif(p_age_range, '') is null or e.age_range = p_age_range)
  ),
  facts as materialized (
    select rf.*
    from public.room_discovery_rank_facts(
      (select id from viewer),
      coalesce((select array_agg(f.user_id) from filtered f), array[]::uuid[])
    ) rf
  ),
  ranked as materialized (
    select f.*, rf.seen_bucket, rf.weekly_exposure_count,
           rf.new_member_below_floor, rf.last_served_at
    from filtered f
    join facts rf on rf.candidate_id = f.user_id
  ),
  page as (
    select r.*
    from ranked r
    order by
      r.seen_bucket asc,
      case when r.seen_bucket = 1 then r.last_served_at end asc nulls first,
      r.weekly_exposure_count asc,
      r.new_member_below_floor desc,
      r.current_question_relevance desc,
      r.stable_hash,
      r.user_id
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 6), 1), 24)
  )
  select jsonb_build_object(
    'eligible_count', (select count(*) from eligible),
    'filtered_count', (select count(*) from filtered),
    'entries', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'user_id', pg.user_id,
            'pseudonym', pg.pseudonym,
            'country', pg.country,
            'gender', pg.gender,
            'gender_custom', pg.gender_custom,
            'age_range', pg.age_range,
            'mark_id', pg.mark_id,
            'answer_id', pg.answer_id,
            'body', pg.body,
            'prompt', q.prompt
          )
          order by
            pg.seen_bucket asc,
            case when pg.seen_bucket = 1 then pg.last_served_at end asc nulls first,
            pg.weekly_exposure_count asc,
            pg.new_member_below_floor desc,
            pg.current_question_relevance desc,
            pg.stable_hash,
            pg.user_id
        )
        from page pg
        left join public.questions q on q.id = pg.question_id
      ),
      '[]'::jsonb
    )
  )
$function$;

revoke all on function public.discover_people_v2(text, text, text, uuid, uuid[], integer, integer) from public, anon;
grant execute on function public.discover_people_v2(text, text, text, uuid, uuid[], integer, integer) to authenticated;

-- Admin/Pulse operational aggregate. Raw member-level exposure state remains
-- private. This is service-role only until the existing Admin surface is wired.
create or replace function public.room_fairness_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, private, auth
as $function$
  with cfg as (
    select * from private.room_discovery_config where singleton = true
  ),
  current_week as (
    select date_trunc('week', now())::date as week_start
  ),
  eligible as (
    select pp.id, au.created_at
    from public.public_profiles pp
    join auth.users au on au.id = pp.id
  ),
  first_seen as (
    select candidate_id, min(first_served_at) as first_exposure_at
    from private.room_member_exposure
    group by candidate_id
  ),
  week_counts as (
    select e.id, coalesce(cw.distinct_viewers, 0) as distinct_viewers
    from eligible e
    cross join current_week w
    left join private.room_candidate_week_exposure cw
      on cw.candidate_id = e.id and cw.week_start = w.week_start
  ),
  delays as (
    select extract(epoch from (fs.first_exposure_at - e.created_at)) / 3600.0 as hours_to_first
    from eligible e join first_seen fs on fs.candidate_id = e.id
    where fs.first_exposure_at >= e.created_at
  )
  select case when auth.role() = 'service_role' then jsonb_build_object(
    'eligible_members', (select count(*) from eligible),
    'eligible_zero_exposures', (select count(*) from eligible e left join first_seen fs on fs.candidate_id=e.id where fs.candidate_id is null),
    'median_hours_to_first_exposure', (select percentile_cont(0.5) within group (order by hours_to_first) from delays),
    'p95_hours_to_first_exposure', (select percentile_cont(0.95) within group (order by hours_to_first) from delays),
    'current_week_min_distinct_viewers', (select min(distinct_viewers) from week_counts),
    'current_week_median_distinct_viewers', (select percentile_cont(0.5) within group (order by distinct_viewers) from week_counts),
    'current_week_max_distinct_viewers', (select max(distinct_viewers) from week_counts),
    'new_members_below_floor', (
      select count(*)
      from eligible e cross join cfg
      left join week_counts wc on wc.id=e.id
      where e.created_at >= now() - make_interval(days => cfg.new_member_window_days)
        and coalesce(wc.distinct_viewers,0) < cfg.new_member_floor_distinct_viewers
    )
  ) else null end
$function$;

revoke all on function public.room_fairness_snapshot() from public, anon, authenticated;
grant execute on function public.room_fairness_snapshot() to service_role;

commit;
