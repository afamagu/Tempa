-- ============================================================
-- TEMPA — ADMIN COMMAND CENTER PHASE 1: OVERVIEW AGGREGATE RPCs
-- PREPARED 2026-09-10. NOT EXECUTED — review, then run in the Supabase
-- SQL editor.
-- ============================================================
--
-- Adds exactly two new staff-only aggregate RPCs backing the new
-- /admin Overview page (app/admin/page.tsx) — nothing else. No new
-- tables, no RLS change on public.letters or public.correspondences,
-- no Realtime publication change, no feature-flag mechanism. Every
-- other admin surface (Reports, Members, moderation actions, audit
-- history — docs/sql/2026-09-17-reporting-and-admin-moderation.sql)
-- is completely untouched.
--
-- Same convention as every other migration in this codebase: SECURITY
-- DEFINER functions use `set search_path to 'pg_catalog'`, every
-- application object is fully `public.`- or `auth.`-qualified, every
-- function gets an explicit `revoke all ... from public` then a
-- targeted `grant execute ... to authenticated`, and is_staff() is
-- checked as the first statement inside the function body — never
-- relying on RLS or the /admin route's own server-side gate alone.
--
-- Both functions return AGGREGATES ONLY (counts, one row per day) —
-- neither ever returns a letter body, a correspondence's participants,
-- or any other row-level private content. A SECURITY DEFINER function
-- reading public.letters/public.correspondences directly (bypassing
-- RLS as the function owner, same as report_content and the evidence-
-- snapshot branches already do in the reporting migration) is safe
-- specifically BECAUSE the only thing it ever returns is a count.
--
-- MEMBER COUNTING DECISION: public.profiles' own `created_at` column
-- is not confirmable from this repo's tracked migration history (the
-- table predates it — see the audit that produced this migration).
-- auth.users.created_at is guaranteed by Supabase itself, so "new
-- members" here means "profiles joined to auth.users, bucketed by the
-- auth account's own created_at" — i.e. a completed member (has a
-- profile row) counted at the moment their account was actually
-- created. This deliberately excludes an abandoned magic-link attempt
-- that never finished onboarding (no profile row), which is the more
-- honest definition of "member" for an operational dashboard.
--
-- FIRST-LETTER DEFINITION (locked): reply_to_id IS NULL AND
-- question_answer_id IS NOT NULL. A bare `reply_to_id is null` is NOT
-- sufficient — Write Anytime's quill also sends ordinary,
-- established-correspondence letters with reply_to_id = null (see
-- write_letter's own doc comment, docs/sql/2026-09-14-letter-level-
-- postcards.sql) — only send_first_letter ever sets
-- question_answer_id, so the AND is what actually isolates a genuine
-- first-contact letter.
--
-- PHOTO MOMENTS (revised after independent review): the UI label is
-- the generic "Photo Moments," not "Letter Photo Moments" — so the
-- count means the feature across all of TEMPA, not just private
-- correspondence. public.moments (type='photo') covers letters;
-- public.dispatch_moments covers Dispatches — that table carries no
-- `type` column at all because every row in it IS a photo (Dispatches
-- have no Postcard entry point, see moments-composer.tsx's own doc
-- comment), so it needs no filter, only a plain count. Historical
-- Postcard Moments (moments.type='postcard') are excluded from both
-- terms exactly as before — this only ever adds dispatch_moments, it
-- never changes what already counted as a photo.
--
-- DAILY SERIES (revised after independent review): rewritten to GROUP
-- BY day ONCE per underlying source (members/letters/correspondences/
-- reports), each pre-filtered to the requested window, then LEFT
-- JOINed onto the generated calendar — never a per-day correlated
-- subquery. Same output shape, same privacy, far less repeated
-- scanning as this table grows; this is permanent infrastructure
-- polled every ~45s, so the query shape was worth getting right now
-- rather than letting it become a scaling problem later.
--
-- One BEGIN/COMMIT.

begin;

-- ============================================================
-- 1. ADMIN_OVERVIEW_COUNTS — the Overview page's scalar counters
-- ============================================================
-- One row, ~27 columns, every one of them a plain count(*) (or
-- count(distinct ...)) over a fixed time window. Grouped in the same
-- order the Overview UI groups them (members / writing-correspondence
-- / safety / secondary product signals) purely for readability — the
-- client is free to reorder for display.
create or replace function public.admin_overview_counts()
returns table (
  total_members bigint,
  new_members_today bigint,
  new_members_7d bigint,
  new_members_30d bigint,

  letters_sent_today bigint,
  letters_sent_7d bigint,
  letters_sent_30d bigint,
  letters_travelling bigint,
  total_correspondences bigint,
  new_correspondences_7d bigint,
  first_letters bigint,
  correspondences_2plus bigint,
  correspondences_5plus bigint,
  members_wrote_7d bigint,

  open_reports bigint,
  reports_today bigint,
  reviewed_reports_total bigint,
  restricted_members bigint,
  suspended_members bigint,
  banned_members bigint,

  published_dispatches_total bigint,
  published_dispatches_7d bigint,
  photo_moments_total bigint,
  photo_moments_7d bigint,
  postcards_sent_total bigint,
  postcards_sent_7d bigint,
  living_postcards_total bigint
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$

declare
  v_today timestamptz;
  v_7d timestamptz;
  v_30d timestamptz;

begin

  if not public.is_staff() then
    raise exception 'Not authorized.';
  end if;

  -- Midnight UTC today, as a timestamptz — never the server session's
  -- own timezone, which is not guaranteed stable across environments.
  v_today := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_7d := now() - interval '7 days';
  v_30d := now() - interval '30 days';

  return query
  select
    -- MEMBERS
    (select count(*) from public.profiles),
    (select count(*) from public.profiles p join auth.users u on u.id = p.id where u.created_at >= v_today),
    (select count(*) from public.profiles p join auth.users u on u.id = p.id where u.created_at >= v_7d),
    (select count(*) from public.profiles p join auth.users u on u.id = p.id where u.created_at >= v_30d),

    -- WRITING / CORRESPONDENCE
    (select count(*) from public.letters where created_at >= v_today),
    (select count(*) from public.letters where created_at >= v_7d),
    (select count(*) from public.letters where created_at >= v_30d),
    -- "Currently travelling" is purely deliver_at > now() — Mail Call
    -- has no separate delivery job/pipeline; a letter "delivers" the
    -- instant a query runs after its own deliver_at passes.
    (select count(*) from public.letters where deliver_at > now()),
    (select count(*) from public.correspondences),
    (select count(*) from public.correspondences where created_at >= v_7d),
    -- Locked definition — see header comment. NEVER bare reply_to_id
    -- is null.
    (select count(*) from public.letters where reply_to_id is null and question_answer_id is not null),
    (select count(*) from (
      select correspondence_id from public.letters group by correspondence_id having count(*) >= 2
    ) t2),
    (select count(*) from (
      select correspondence_id from public.letters group by correspondence_id having count(*) >= 5
    ) t5),
    -- Labeled in the UI exactly as "Members who wrote in the last 7
    -- days" — never presented as a generic "active members" claim.
    (select count(distinct sender_id) from public.letters where created_at >= v_7d),

    -- SAFETY
    (select count(*) from public.reports where status = 'open'),
    (select count(*) from public.reports where created_at >= v_today),
    -- reports has no reviewed_at column — this is a total, never a
    -- "reviewed today" figure, which isn't derivable from the schema
    -- as it stands.
    (select count(*) from public.reports where status = 'reviewed'),
    (select count(*) from public.account_enforcement_state where status = 'restricted'),
    (select count(*) from public.account_enforcement_state where status = 'suspended'),
    (select count(*) from public.account_enforcement_state where status = 'banned'),

    -- SECONDARY PRODUCT SIGNALS
    (select count(*) from public.dispatches where status = 'published'),
    (select count(*) from public.dispatches where status = 'published' and published_at >= v_7d),
    -- Photo Moments across ALL of TEMPA — letters (moments.type='photo')
    -- PLUS Dispatches (dispatch_moments, which carries no `type` column
    -- since every row in it is inherently a photo). Never a historical
    -- Postcard Moment (moments.type='postcard'), which this deliberately
    -- excludes on both terms.
    (
      (select count(*) from public.moments where type = 'photo')
      + (select count(*) from public.dispatch_moments)
    ),
    (
      (select count(*) from public.moments where type = 'photo' and created_at >= v_7d)
      + (select count(*) from public.dispatch_moments where created_at >= v_7d)
    ),
    (select count(*) from public.letter_postcards),
    (select count(*) from public.letter_postcards where created_at >= v_7d),
    -- "Living" has no boolean column — a postcard_versions row counts
    -- as Living iff motion_src is set (the established convention;
    -- see docs/sql/2026-09-14-letter-level-postcards.sql).
    (select count(*) from public.letter_postcards lp
      join public.postcard_versions pv on pv.id = lp.postcard_version_id
      where pv.motion_src is not null);

end;
$function$;

revoke all on function public.admin_overview_counts() from public;
grant execute on function public.admin_overview_counts() to authenticated;


-- ============================================================
-- 2. ADMIN_OVERVIEW_DAILY_SERIES — the 4 chart series
-- ============================================================
-- Deliberately a SEPARATE RPC from admin_overview_counts, not folded
-- into it: a scalar-counters row and a 30-row-per-metric daily series
-- are genuinely different result shapes, and splitting them keeps
-- each function's single `return query select` trivially readable
-- rather than forcing an awkward composite/array return type onto the
-- scalar RPC. p_days is clamped to [1, 90] — staff-only already, this
-- is just sane-input hygiene, not a security boundary. Zero-filled via
-- generate_series so a quiet day still renders as 0, never a gap the
-- chart would have to guess about.
--
-- Each underlying source is GROUPED BY its own UTC day exactly ONCE
-- (members_by_day/letters_by_day/correspondences_by_day/reports_by_day
-- below), pre-filtered to the requested window via v_start — never a
-- per-day correlated subquery re-scanning the whole table 30 (or up to
-- 90) times per source. Those four grouped results are then LEFT
-- JOINed onto the generated `days` calendar, coalesced to 0 for a
-- quiet day. Same output shape as before; far less repeated scanning
-- as this table grows, which matters since this is permanent
-- infrastructure polled every ~45s.
create or replace function public.admin_overview_daily_series(p_days integer default 30)
returns table (
  day date,
  new_members bigint,
  letters_sent bigint,
  new_correspondences bigint,
  reports bigint
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$

declare
  v_days integer;
  v_start date;

begin

  if not public.is_staff() then
    raise exception 'Not authorized.';
  end if;

  v_days := least(greatest(coalesce(p_days, 30), 1), 90);
  v_start := (now() at time zone 'utc')::date - (v_days - 1);

  return query
  with days as (
    select generate_series(
      v_start,
      (now() at time zone 'utc')::date,
      interval '1 day'
    )::date as day
  ),
  -- Same TEMPA-member constraint as admin_overview_counts: a genuine
  -- profiles row is required, auth.users.created_at supplies only the
  -- timestamp — never a raw, possibly-abandoned auth.users signup.
  members_by_day as (
    select (u.created_at at time zone 'utc')::date as day, count(*) as n
    from public.profiles p
    join auth.users u on u.id = p.id
    where (u.created_at at time zone 'utc')::date >= v_start
    group by 1
  ),
  letters_by_day as (
    select (l.created_at at time zone 'utc')::date as day, count(*) as n
    from public.letters l
    where (l.created_at at time zone 'utc')::date >= v_start
    group by 1
  ),
  correspondences_by_day as (
    select (c.created_at at time zone 'utc')::date as day, count(*) as n
    from public.correspondences c
    where (c.created_at at time zone 'utc')::date >= v_start
    group by 1
  ),
  reports_by_day as (
    select (r.created_at at time zone 'utc')::date as day, count(*) as n
    from public.reports r
    where (r.created_at at time zone 'utc')::date >= v_start
    group by 1
  )
  select
    d.day,
    coalesce(mbd.n, 0),
    coalesce(lbd.n, 0),
    coalesce(cbd.n, 0),
    coalesce(rbd.n, 0)
  from days d
  left join members_by_day mbd on mbd.day = d.day
  left join letters_by_day lbd on lbd.day = d.day
  left join correspondences_by_day cbd on cbd.day = d.day
  left join reports_by_day rbd on rbd.day = d.day
  order by d.day;

end;
$function$;

revoke all on function public.admin_overview_daily_series(integer) from public;
grant execute on function public.admin_overview_daily_series(integer) to authenticated;

commit;
