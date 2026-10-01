-- TEMPA PR #54 — COMPLETE PRODUCTION MIGRATION PACK
-- NOT EXECUTED. Run the whole file, then the verification pack.
-- One transaction: any error rolls back every migration in this pack.
-- Prerequisite: the already-applied editorial-byline foundation.
begin;
-- Source: 2026-10-30-reserved-pseudonyms.sql
-- TEMPA — reserved pseudonyms. NOT YET APPLIED.
-- Run after the editorial-byline migration, then run the matching verifier.
-- Protect canonical prefixes tempa / ladylarkspur, including suffixes such
-- as Tempa Support and Lady Larkspurr. Existing house identity is preserved.
-- No profile is renamed; abort if an ordinary member already uses a prefix.

do $preflight$
begin
  if to_regprocedure('public.canonicalize_pseudonym(text)') is null
     or not exists (select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles'
         and column_name = 'is_editorial') then
    raise exception 'Apply the editorial-byline migration first. Nothing changed.';
  end if;
end
$preflight$;

create or replace function public.is_reserved_pseudonym(candidate text)
returns boolean
language sql immutable security invoker
set search_path to 'pg_catalog'
as $function$
  select coalesce(public.canonicalize_pseudonym(candidate) like 'tempa%'
    or public.canonicalize_pseudonym(candidate) like 'ladylarkspur%', false)
$function$;
revoke all on function public.is_reserved_pseudonym(text) from public, anon, authenticated;
grant execute on function public.is_reserved_pseudonym(text) to authenticated;

do $audit$
begin
  if exists (select 1 from public.profiles
    where not is_editorial and public.is_reserved_pseudonym(pseudonym)) then
    raise exception 'An ordinary member has a reserved name. Review those profiles before applying; nothing changed.';
  end if;
end
$audit$;

create schema if not exists tempa_private;
create or replace function tempa_private.guard_reserved_pseudonym()
returns trigger
language plpgsql security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_jwt_role text;
begin
  -- Unrelated edits to the existing house profile remain possible.
  if tg_op = 'UPDATE' and new.pseudonym is not distinct from old.pseudonym then
    return new;
  end if;
  if not public.is_reserved_pseudonym(new.pseudonym) then return new; end if;

  v_jwt_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    nullif(current_setting('request.jwt.claim.role', true), ''), '');

  -- House profiles are designated by privileged UPDATE, never by a member
  -- setting is_editorial during onboarding. The editorial INSERT trigger
  -- also forces false. JWT checks still hold inside SECURITY DEFINER RPCs.
  if tg_op = 'UPDATE' and new.is_editorial
     and v_jwt_role in ('', 'service_role')
     and coalesce(current_setting('role', true), '') not in ('anon', 'authenticated') then
    return new;
  end if;
  raise exception 'That name is reserved.' using errcode = '23514';
end
$function$;
revoke all on function tempa_private.guard_reserved_pseudonym() from public, anon, authenticated;

drop trigger if exists profiles_reserved_pseudonym_guard on public.profiles;
create trigger profiles_reserved_pseudonym_guard
before insert or update on public.profiles
for each row execute function tempa_private.guard_reserved_pseudonym();

create or replace function public.is_pseudonym_available(candidate text)
returns boolean
language sql security definer
set search_path to 'pg_catalog'
as $function$
  select not public.is_reserved_pseudonym(candidate) and not exists (
    select 1 from public.profiles p
    where p.pseudonym_key = public.canonicalize_pseudonym(candidate))
$function$;
revoke all on function public.is_pseudonym_available(text) from public, anon, authenticated;
grant execute on function public.is_pseudonym_available(text) to authenticated;

create or replace function public.suggest_available_pseudonyms(base text, needed integer default 3)
returns text[]
language plpgsql security definer
set search_path to 'pg_catalog'
as $function$
declare
  suggestions text[] := '{}';
  candidate text;
  clean_base text := coalesce(nullif(btrim(base), ''), 'friend');
  suffix text;
  tries integer := 0;
begin
  if public.is_reserved_pseudonym(clean_base) then return suggestions; end if;
  while cardinality(suggestions) < least(greatest(coalesce(needed, 3), 0), 10) and tries < 40 loop
    tries := tries + 1;
    suffix := (trunc(random() * 90) + 10)::integer::text;
    candidate := left(clean_base, 24 - length(suffix)) || suffix;
    if candidate <> clean_base and not (candidate = any(suggestions))
       and public.is_pseudonym_available(candidate) then
      suggestions := array_append(suggestions, candidate);
    end if;
  end loop;
  return suggestions;
end
$function$;
revoke all on function public.suggest_available_pseudonyms(text, integer) from public, anon, authenticated;
grant execute on function public.suggest_available_pseudonyms(text, integer) to authenticated;


-- Source: 2026-09-30-room-fair-exposure.sql
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

alter table private.room_discovery_config enable row level security;

revoke all on private.room_discovery_config from public, anon, authenticated;

-- Narrow privileged helper. It validates that the requested viewer is the
-- authenticated caller and returns only relative rank and the caller’s own encounter time for the supplied
-- candidate set. Global exposure counts and account creation dates never leave the helper.
create or replace function public.room_discovery_rank_facts(
  p_viewer uuid,
  p_candidate_ids uuid[]
)
returns table (
  candidate_id uuid,
  fair_rank bigint,
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
    dense_rank() over (order by
      case when me.viewer_id is null then 0 else 1 end,
      case when me.viewer_id is not null then me.last_served_at end asc nulls first,
      coalesce(cw.distinct_viewers, 0),
      case when au.created_at >= now() - make_interval(days => cfg.new_member_window_days)
        and coalesce(cw.distinct_viewers, 0) < cfg.new_member_floor_distinct_viewers
        then 1 else 0 end desc
    ) as fair_rank,
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
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required';
  end if;
  if p_surface is null or p_surface not in ('home_room', 'room', 'room_question') then
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
  p_limit integer default 6,
  p_browse_started_at timestamptz default null
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $function$
  with viewer as (
    select auth.uid() as id,
      case when p_browse_started_at between now() - interval '1 day' and now()
        then p_browse_started_at else now() end as browse_started_at
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
    select f.*, rf.fair_rank, rf.last_served_at
    from filtered f
    join facts rf on rf.candidate_id = f.user_id
    -- Recording the previous page moves it down the live ranking. Exclude
    -- pages served during this browse, then take the next front-of-pool page;
    -- OFFSET against that moving ranking would skip unseen people.
    where p_browse_started_at is null
       or rf.last_served_at is null
       or rf.last_served_at < (select browse_started_at from viewer)
  ),
  page as (
    select r.*
    from ranked r
    order by
      r.fair_rank asc,
      r.current_question_relevance desc,
      r.stable_hash,
      r.user_id
    offset case when p_browse_started_at is not null then 0 else greatest(coalesce(p_offset, 0), 0) end
    limit least(greatest(coalesce(p_limit, 6), 1), 24)
  )
  select jsonb_build_object(
    'eligible_count', (select count(*) from eligible),
    'filtered_count', (select count(*) from ranked),
    'browse_started_at', (select browse_started_at from viewer),
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
            pg.fair_rank asc,
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

revoke all on function public.discover_people_v2(text, text, text, uuid, uuid[], integer, integer, timestamptz) from public, anon;
grant execute on function public.discover_people_v2(text, text, text, uuid, uuid[], integer, integer, timestamptz) to authenticated;

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



-- Source: 2026-09-30-room-fair-exposure-set-based-recorder.sql
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
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required';
  end if;
  if p_surface is null or p_surface not in ('home_room', 'room', 'room_question') then
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



-- Source: 2026-09-30-room-current-question.sql
-- TEMPA — CURRENT ROOM QUESTION EDITORIAL ACTION
-- STATUS: NOT EXECUTED IN PRODUCTION
-- Forward-only migration. Historical Question rows/answers are never rewritten.


create or replace function public.admin_make_current_room_question(p_question_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_prompt text;
  v_active boolean;
  v_flagship boolean;
  v_target_position smallint;
  v_actor_pseudonym text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;
  if not coalesce(public.is_staff('admin'), false) then
    raise exception 'Not authorized.';
  end if;

  -- Serialize editorial selections before locking individual Question rows.
  perform pg_advisory_xact_lock(hashtext('tempa-current-room-question'));

  select q.prompt, q.is_active, q.is_flagship
    into v_prompt, v_active, v_flagship
  from public.questions q
  where q.id = p_question_id
  for update;

  if v_prompt is null then
    raise exception 'Question not found.';
  end if;
  if not v_active then
    raise exception 'Only an active Question can be made current in The Room.';
  end if;
  if v_flagship then
    raise exception 'The First Question cannot also be the current Room Question.';
  end if;

  -- Preserve the Flagship wherever it currently sits. The Room uses exactly
  -- one positioned non-Flagship Question; historical non-Flagship Questions
  -- simply become unpositioned, with their answers untouched.
  update public.questions
  set current_position = null
  where is_flagship = false
    and id <> p_question_id
    and current_position is not null;

  select gs::smallint into v_target_position
  from generate_series(1, 3) gs
  where not exists (
    select 1 from public.questions q
    where q.current_position = gs and q.id <> p_question_id
  )
  order by gs
  limit 1;

  if v_target_position is null then
    raise exception 'No current Question slot is available without moving the Flagship.';
  end if;

  update public.questions
  set current_position = v_target_position
  where id = p_question_id;

  select pseudonym into v_actor_pseudonym
  from public.profiles
  where id = auth.uid();

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text),
    'room_question_made_current',
    'question', p_question_id, v_prompt,
    jsonb_build_object('current_position', v_target_position)
  );
end;
$function$;

revoke all on function public.admin_make_current_room_question(uuid) from public, anon;
grant execute on function public.admin_make_current_room_question(uuid) to authenticated;

-- Preserve the Question members already see (the lowest positioned active
-- non-Flagship Question), while retiring extra legacy Room positions. This
-- never changes prompts, answers or the First Question, and invents no Question.
with current_room as (
  select id from public.questions
  where is_active and not is_flagship and current_position is not null
  order by current_position limit 1
)
update public.questions q set current_position = null
where not q.is_flagship and q.current_position is not null
  and exists (select 1 from current_room)
  and q.id <> (select id from current_room);



-- Source: 2026-09-30-room-question-suggestions.sql
-- TEMPA — MEMBER ROOM QUESTION SUGGESTIONS
-- STATUS: NOT EXECUTED IN PRODUCTION
-- Forward-only. Suggestions are private editorial submissions, never public votes.


create table if not exists public.room_question_suggestions (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null references auth.users(id) on delete cascade,
  proposed_question text not null check (char_length(btrim(proposed_question)) between 10 and 500),
  credit_if_used boolean not null default false,
  pseudonym_snapshot text,
  status text not null default 'pending' check (status in ('pending', 'shortlisted', 'scheduled', 'declined', 'used')),
  editorial_notes text,
  published_question_id uuid references public.questions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists room_question_suggestions_status_created_idx
  on public.room_question_suggestions (status, created_at desc);
create index if not exists room_question_suggestions_submitter_idx
  on public.room_question_suggestions (submitted_by, created_at desc);

alter table public.room_question_suggestions enable row level security;
revoke all on public.room_question_suggestions from public, anon, authenticated;

-- Members submit through one narrow RPC. They do not gain table SELECT access,
-- so other members' submissions and internal editorial state remain private.
create or replace function public.submit_room_question_suggestion(
  p_question text,
  p_credit_if_used boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_id uuid;
  v_prompt text := btrim(coalesce(p_question, ''));
  v_pseudonym text;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if char_length(v_prompt) < 10 then raise exception 'Please write a complete question.'; end if;
  if char_length(v_prompt) > 500 then raise exception 'Question is too long.'; end if;

  if public.current_account_status() is distinct from 'active' then
    raise exception 'Account cannot submit suggestions.';
  end if;

  select p.pseudonym into v_pseudonym from public.profiles p where p.id = auth.uid();

  if v_pseudonym is null then raise exception 'Complete your profile first.'; end if;

  -- Serialize submissions from one account before enforcing the daily limit.
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text || ':room-suggestion'));
  if (select count(*) from public.room_question_suggestions
      where submitted_by = auth.uid() and created_at >= now() - interval '1 day') >= 3 then
    raise exception 'Suggestion limit reached. Please try again tomorrow.';
  end if;

  insert into public.room_question_suggestions (
    submitted_by, proposed_question, credit_if_used, pseudonym_snapshot
  ) values (
    auth.uid(), v_prompt, coalesce(p_credit_if_used, false), v_pseudonym
  ) returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.submit_room_question_suggestion(text, boolean) from public, anon;
grant execute on function public.submit_room_question_suggestion(text, boolean) to authenticated;

create or replace function public.admin_list_room_question_suggestions()
returns table (
  id uuid,
  proposed_question text,
  credit_if_used boolean,
  pseudonym_snapshot text,
  status text,
  editorial_notes text,
  published_question_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if not coalesce(public.is_staff('admin'), false) then raise exception 'Not authorized.'; end if;
  return query
    select s.id, s.proposed_question, s.credit_if_used, s.pseudonym_snapshot,
           s.status, s.editorial_notes, s.published_question_id, s.created_at
    from public.room_question_suggestions s
    order by
      case s.status when 'pending' then 0 when 'shortlisted' then 1 when 'scheduled' then 2 when 'used' then 3 else 4 end,
      s.created_at desc
    limit 200;
end;
$function$;

revoke all on function public.admin_list_room_question_suggestions() from public, anon;
grant execute on function public.admin_list_room_question_suggestions() to authenticated;

create or replace function public.admin_update_room_question_suggestion(
  p_suggestion_id uuid,
  p_status text,
  p_editorial_notes text default null,
  p_published_question_id uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_actor_pseudonym text;
  v_prompt text;
begin
  if not coalesce(public.is_staff('admin'), false) then raise exception 'Not authorized.'; end if;
  if p_status is null or p_status not in ('pending', 'shortlisted', 'scheduled', 'declined', 'used') then
    raise exception 'Invalid suggestion status.';
  end if;

  select proposed_question into v_prompt
  from public.room_question_suggestions
  where id = p_suggestion_id
  for update;
  if v_prompt is null then raise exception 'Suggestion not found.'; end if;

  update public.room_question_suggestions
  set status = p_status,
      editorial_notes = nullif(btrim(coalesce(p_editorial_notes, '')), ''),
      published_question_id = p_published_question_id,
      updated_at = now()
  where id = p_suggestion_id;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();
  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text),
    'room_question_suggestion_reviewed',
    'room_question_suggestion', p_suggestion_id, v_prompt,
    jsonb_build_object('status', p_status, 'published_question_id', p_published_question_id)
  );
end;
$function$;

revoke all on function public.admin_update_room_question_suggestion(uuid, text, text, uuid) from public, anon;
grant execute on function public.admin_update_room_question_suggestion(uuid, text, text, uuid) to authenticated;


commit;
