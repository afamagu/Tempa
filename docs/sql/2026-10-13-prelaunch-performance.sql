-- ============================================================
-- TEMPA — PRE-LAUNCH PERFORMANCE & SCALABILITY
-- STATUS: NOT EXECUTED — review, then run in the Supabase SQL editor
-- BEFORE deploying the application code that calls these functions.
-- Forward-only. Edits no historical migration. Changes no Safety,
-- visibility, block, or account-restriction policy.
-- ============================================================
--
-- WHAT THIS ADDS
--
-- 1. public.current_account_entry_state(p_terms_version, p_guidelines_version)
--    One self-scoped read for proxy.ts, replacing the four separate
--    round trips it made on every protected navigation
--    (current_account_status RPC, then profiles + account_eligibility +
--    legal_acceptances). Returns ONLY the caller's own state:
--      account_status, eligibility_status, has_profile, onboarding_stage,
--      terms_current, guidelines_current
--    SECURITY INVOKER: every underlying table is read under its existing
--    own-row RLS policy AND an explicit `= auth.uid()` predicate, so
--    there is no argument through which another member's state could be
--    requested. account_status is read through the existing
--    public.current_account_status() (unchanged, self-scoped), so the
--    ban decision is the exact same source proxy.ts already trusted and
--    is read live on every request — nothing is cached. The legal
--    version arguments are the server constants from lib/legal.ts (the
--    one source of truth for required versions stays in TypeScript);
--    they only ever compare against the caller's own acceptance rows.
--
-- 2. public.discover_people(p_country, p_gender, p_age_range, p_offset, p_limit)
--    People discovery (app/minds) and Home's Recommended minds, filtered,
--    ordered and paginated in Postgres. Previously each request pulled
--    every public profile and every visible answer into Next.js.
--    Returns one jsonb object:
--      { eligible_count, filtered_count, entries: [<= p_limit rows] }
--    p_limit is clamped to 1..24, so the application-facing payload is
--    bounded no matter how many members exist.
--    SECURITY INVOKER on purpose: candidates come from the SAME surfaces
--    the page already read through the member's own session —
--      public.public_profiles   (block-aware, hides banned members)
--      public.question_answers  (RLS: active question, visible,
--                                not blocked, not hidden_from_discovery)
--      public.correspondences   (RLS: participant only)
--      public.letters_for_participant
--    — so discovery cannot bypass any block or Safety visibility rule;
--    no new visibility logic is introduced.
--    Semantics preserved from app/minds/page.tsx:
--      - never self;
--      - representative answer per member = current Flagship answer,
--        else the is_current answer, else the latest visible answer
--        (chooseDiscoveryAnswer);
--      - excludes active correspondence partners;
--      - excludes a member whose representative answer the viewer has
--        already written a first-contact letter from;
--      - country / gender (incl. self-described) / age_range filters;
--      - deterministic per-viewer order: hashtext(viewer:candidate),
--        tie-broken by id — stable across refreshes, no stored seed,
--        no ORDER BY random().
--    Pagination stays offset-based (?batch=N, six per batch) so existing
--    "Show me six more" links keep working. The ordering is a top-N over
--    the viewer's candidate set inside Postgres; only the page crosses
--    the wire.
--
-- 3. correspondences_active_participant_high_idx
--    The active-partner lookup filters on participant_low OR
--    participant_high. participant_low is already covered by
--    correspondences_pair_idx; participant_high had no index.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. ACCOUNT ENTRY STATE (self-scoped)
-- ------------------------------------------------------------
create or replace function public.current_account_entry_state(
  p_terms_version text,
  p_guidelines_version text
)
returns table (
  account_status text,
  eligibility_status text,
  has_profile boolean,
  onboarding_stage text,
  terms_current boolean,
  guidelines_current boolean
)
language sql
stable
security invoker
set search_path to 'pg_catalog'
as $function$
  select
    public.current_account_status() as account_status,
    (
      select e.status
      from public.account_eligibility e
      where e.user_id = auth.uid()
    ) as eligibility_status,
    exists (
      select 1 from public.profiles p where p.id = auth.uid()
    ) as has_profile,
    (
      select p.onboarding_stage::text
      from public.profiles p
      where p.id = auth.uid()
    ) as onboarding_stage,
    exists (
      select 1 from public.legal_acceptances la
      where la.user_id = auth.uid()
        and la.document_type = 'terms_of_service'
        and la.document_version = p_terms_version
    ) as terms_current,
    exists (
      select 1 from public.legal_acceptances la
      where la.user_id = auth.uid()
        and la.document_type = 'community_guidelines'
        and la.document_version = p_guidelines_version
    ) as guidelines_current
  where auth.uid() is not null
$function$;

revoke all on function public.current_account_entry_state(text, text) from public, anon;
grant execute on function public.current_account_entry_state(text, text) to authenticated;


-- ------------------------------------------------------------
-- 2. PEOPLE DISCOVERY (bounded page)
-- ------------------------------------------------------------
create or replace function public.discover_people(
  p_country text default null,
  p_gender text default null,
  p_age_range text default null,
  p_offset integer default 0,
  p_limit integer default 6
)
returns jsonb
language sql
stable
security invoker
set search_path to 'pg_catalog'
as $function$
  with viewer as (
    select auth.uid() as id
  ),
  flagship as (
    select q.id from public.questions q where q.is_flagship = true limit 1
  ),
  -- Each input set is MATERIALIZED once, then hash-joined. Without this
  -- the planner re-scans the security-barrier public_profiles view (and
  -- its Safety helper calls) once per candidate — O(N^2).
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
    order by
      qa.user_id,
      (qa.question_id = (select f.id from flagship f)) desc nulls last,
      qa.is_current desc nulls last,
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
      hashtext(v.id::text || ':' || p.id::text) as sort_key
    from representative r
    join visible_profiles p on p.id = r.user_id
    cross join viewer v
    where not exists (select 1 from partners x where x.user_id = r.user_id)
      and not exists (select 1 from contacted c where c.answer_id = r.id)
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
  page as (
    select f.*
    from filtered f
    order by f.sort_key, f.user_id
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
          order by pg.sort_key, pg.user_id
        )
        from page pg
        left join public.questions q on q.id = pg.question_id
      ),
      '[]'::jsonb
    )
  )
$function$;

revoke all on function public.discover_people(text, text, text, integer, integer) from public, anon;
grant execute on function public.discover_people(text, text, text, integer, integer) to authenticated;


-- ------------------------------------------------------------
-- 3. INDEX
-- ------------------------------------------------------------
create index if not exists correspondences_active_participant_high_idx
  on public.correspondences (participant_high)
  where status = 'active';

commit;
