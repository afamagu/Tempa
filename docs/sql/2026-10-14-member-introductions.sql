-- ============================================================
-- TEMPA — MEMBER INTRODUCTIONS ("People to meet")
-- STATUS: NOT EXECUTED — review, then run in the Supabase SQL editor
-- BEFORE deploying the application code that calls these functions.
-- Forward-only. Edits no historical migration. Changes no Safety,
-- visibility, block, restriction, or People-discovery policy.
-- ============================================================
--
-- WHAT THIS ADDS
--
-- 1. public.member_introduction_state — one row per VIEWER, created
--    lazily the first time get_member_introductions runs for them.
--    baseline_at = the moment this feature initialized for that viewer.
--    Everyone whose account existed before it is "established" for that
--    viewer; accounts created after it are "newcomers".
--
-- 2. public.member_introduction_history — one row per (viewer, candidate)
--    ONLY once that candidate's card actually became the active card
--    (presented) or was acted on (consumed). Never pre-created for the
--    population, so it grows with real interaction, not N^2.
--      consumed_at / consumed_reason ('advanced' | 'write' | 'profile')
--    A consumed candidate never returns to this feature (they remain in
--    People as normal).
--
-- 3. public.get_member_introductions(p_limit) — up to SEVEN cards
--    (clamped here, at the database boundary) for auth.uid() only.
--    SECURITY INVOKER: eligibility is computed from the SAME surfaces as
--    public.discover_people (2026-10-13-prelaunch-performance.sql), read
--    under the member's own session —
--      public.public_profiles   (block-aware, hides banned members)
--      public.question_answers  (RLS: active question, visible, not
--                                blocked, not hidden_from_discovery —
--                                i.e. restricted/suspended/banned)
--      public.correspondences   (active partners excluded)
--      public.letters_for_participant (already-contacted answers excluded)
--    with the same representative-response rule (current Flagship, else
--    is_current, else latest visible). No new visibility logic.
--
--    PRIORITY (exact):
--      tier 0  never presented AND newcomer (account created after the
--              viewer's baseline_at)
--      tier 1  never presented AND established
--      tier 2  presented before, not consumed (least recently presented
--              first)
--      within a tier:
--        more shared languages first,
--        then more shared public intents,
--        then hashtext('intro:' || viewer || ':' || candidate) — a
--        deterministic per-viewer tie-break.
--    Only explicit public profile fields (languages, intent) are compared
--    — never Reading Interests, age, gender, or anything private.
--
-- 4. public.mark_member_introduction_presented(p_candidate_id)
--    public.consume_member_introduction(p_candidate_id, p_reason)
--    Always act for auth.uid() — there is no viewer argument. SECURITY
--    INVOKER; the history table's own-row RLS is the boundary.
--
-- WHY ONE SECURITY DEFINER HELPER
-- "Newcomer" needs each candidate's account-creation time. That lives in
-- auth.users (guaranteed by Supabase; public.profiles.created_at is not
-- confirmable from this repo's migration history — see
-- 2026-09-18-admin-operations-refinement.sql's MEMBER COUNTING DECISION),
-- which a member cannot read. tempa_private.member_introduction_newcomer_ids()
-- therefore runs as definer, but takes NO argument: it returns only the
-- ids of accounts created after the CALLER's own baseline. It returns no
-- timestamps and no other field; visibility of those ids is still decided
-- by the invoker-rights surfaces above (an id alone never surfaces a
-- card). tempa_private is not an API-exposed schema, and anon has no
-- USAGE on it.
--
-- "Newcomer" approximates "became discoverable after my baseline" with
-- account creation time. A member who created an account earlier but
-- only became discoverable later is still shown — just in tier 1, not
-- tier 0. No profile-lifecycle change is made for this feature.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. TABLES
-- ------------------------------------------------------------
create table if not exists public.member_introduction_state (
  viewer_id uuid primary key
    references auth.users(id) on delete cascade,
  baseline_at timestamptz not null default now()
);

alter table public.member_introduction_state enable row level security;

create policy member_introduction_state_select_own
  on public.member_introduction_state
  for select to authenticated
  using (viewer_id = auth.uid());

create policy member_introduction_state_insert_own
  on public.member_introduction_state
  for insert to authenticated
  with check (viewer_id = auth.uid());

revoke all on public.member_introduction_state from public, anon, authenticated;
grant select, insert on public.member_introduction_state to authenticated;


create table if not exists public.member_introduction_history (
  viewer_id uuid not null
    references auth.users(id) on delete cascade,
  candidate_id uuid not null
    references auth.users(id) on delete cascade,
  first_presented_at timestamptz,
  last_presented_at timestamptz,
  presented_count integer not null default 0,
  consumed_at timestamptz,
  consumed_reason text
    check (consumed_reason in ('advanced', 'write', 'profile')),
  primary key (viewer_id, candidate_id),
  check (viewer_id <> candidate_id),
  check ((consumed_at is null) = (consumed_reason is null))
);

-- The primary key (viewer_id, candidate_id) serves every per-viewer
-- lookup this feature makes. The candidate-side index exists only so an
-- account deletion's ON DELETE CASCADE on candidate_id is not a full scan.
create index if not exists member_introduction_history_candidate_idx
  on public.member_introduction_history (candidate_id);

alter table public.member_introduction_history enable row level security;

create policy member_introduction_history_select_own
  on public.member_introduction_history
  for select to authenticated
  using (viewer_id = auth.uid());

create policy member_introduction_history_insert_own
  on public.member_introduction_history
  for insert to authenticated
  with check (viewer_id = auth.uid());

create policy member_introduction_history_update_own
  on public.member_introduction_history
  for update to authenticated
  using (viewer_id = auth.uid())
  with check (viewer_id = auth.uid());

revoke all on public.member_introduction_history from public, anon, authenticated;
grant select, insert, update on public.member_introduction_history to authenticated;


-- ------------------------------------------------------------
-- 2. NEWCOMER HELPER (definer; caller-scoped; ids only)
-- ------------------------------------------------------------
create or replace function tempa_private.member_introduction_newcomer_ids()
returns table (id uuid)
language sql
stable
security definer
set search_path to 'pg_catalog'
as $function$
  select u.id
  from auth.users u
  join public.member_introduction_state s
    on s.viewer_id = auth.uid()
  where auth.uid() is not null
    and u.created_at > s.baseline_at
    and u.id <> auth.uid()
$function$;

revoke all on function tempa_private.member_introduction_newcomer_ids() from public, anon;
grant execute on function tempa_private.member_introduction_newcomer_ids() to authenticated;


-- ------------------------------------------------------------
-- 3. RETRIEVAL (bounded, max 7)
-- ------------------------------------------------------------
create or replace function public.get_member_introductions(p_limit integer default 7)
returns table (
  candidate_id uuid,
  pseudonym text,
  country text,
  gender text,
  gender_custom text,
  age_range text,
  mark_id uuid,
  languages text[],
  intent text[],
  shared_languages text[],
  shared_intents text[],
  answer_id uuid,
  prompt text,
  body text,
  priority_tier integer
)
language plpgsql
volatile
security invoker
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  -- Lazily initialize this viewer's baseline (first visit only).
  insert into public.member_introduction_state (viewer_id)
  values (auth.uid())
  on conflict (viewer_id) do nothing;

  return query
  -- Every working set is MATERIALIZED once and hash-joined. Without this
  -- the planner re-scans the security-barrier public_profiles view (and
  -- its Safety helper calls) once per candidate — O(N^2); see the
  -- 2026-10-13 prelaunch-performance migration.
  with viewer as materialized (
    select
      auth.uid() as id,
      -- languages / intent normalized through jsonb so this works whether
      -- the columns are text[] or jsonb arrays.
      array(select jsonb_array_elements_text(case when jsonb_typeof(to_jsonb(vp.languages)) = 'array' then to_jsonb(vp.languages) else '[]'::jsonb end)) as languages,
      array(select jsonb_array_elements_text(case when jsonb_typeof(to_jsonb(vp.intent)) = 'array' then to_jsonb(vp.intent) else '[]'::jsonb end)) as intent
    from (select 1) _one
    left join public.public_profiles vp on vp.id = auth.uid()
  ),
  flagship as (
    select q.id from public.questions q where q.is_flagship = true limit 1
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
  history as materialized (
    select h.candidate_id as user_id, h.last_presented_at, h.consumed_at
    from public.member_introduction_history h
    cross join viewer v
    where h.viewer_id = v.id
  ),
  newcomers as materialized (
    select n.id as user_id from tempa_private.member_introduction_newcomer_ids() n
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
    select p.id, p.pseudonym, p.country, p.gender, p.gender_custom, p.age_range, p.mark_id,
      array(select jsonb_array_elements_text(case when jsonb_typeof(to_jsonb(p.languages)) = 'array' then to_jsonb(p.languages) else '[]'::jsonb end)) as languages,
      array(select jsonb_array_elements_text(case when jsonb_typeof(to_jsonb(p.intent)) = 'array' then to_jsonb(p.intent) else '[]'::jsonb end)) as intent
    from public.public_profiles p
    cross join viewer v
    where p.id <> v.id
  ),
  candidates as materialized (
    select
      p.*,
      r.id as answer_id,
      r.question_id,
      r.body,
      array(select unnest(p.languages) intersect select unnest(v.languages) order by 1) as shared_languages,
      array(select unnest(p.intent) intersect select unnest(v.intent) order by 1) as shared_intents,
      case
        when h.user_id is not null then 2
        when nc.user_id is not null then 0
        else 1
      end as tier,
      h.last_presented_at,
      hashtext('intro:' || v.id::text || ':' || p.id::text) as sort_key
    from representative r
    join visible_profiles p on p.id = r.user_id
    cross join viewer v
    left join history h on h.user_id = p.id
    left join newcomers nc on nc.user_id = p.id
    where not exists (select 1 from partners x where x.user_id = p.id)
      and not exists (select 1 from contacted c where c.answer_id = r.id)
      and (h.user_id is null or h.consumed_at is null)
  ),
  picked as (
    select c.*
    from candidates c
    order by
      c.tier,
      c.last_presented_at asc nulls first,
      cardinality(c.shared_languages) desc,
      cardinality(c.shared_intents) desc,
      c.sort_key,
      c.id
    limit least(greatest(coalesce(p_limit, 7), 1), 7)
  )
  select
    pk.id::uuid,
    pk.pseudonym::text,
    pk.country::text,
    pk.gender::text,
    pk.gender_custom::text,
    pk.age_range::text,
    pk.mark_id::uuid,
    pk.languages::text[],
    pk.intent::text[],
    pk.shared_languages::text[],
    pk.shared_intents::text[],
    pk.answer_id::uuid,
    q.prompt::text,
    pk.body::text,
    pk.tier::integer
  from picked pk
  left join public.questions q on q.id = pk.question_id
  order by
    pk.tier,
    pk.last_presented_at asc nulls first,
    cardinality(pk.shared_languages) desc,
    cardinality(pk.shared_intents) desc,
    pk.sort_key,
    pk.id;
end;
$function$;

revoke all on function public.get_member_introductions(integer) from public, anon;
grant execute on function public.get_member_introductions(integer) to authenticated;


-- ------------------------------------------------------------
-- 4. PRESENTED / CONSUMED (self-scoped)
-- ------------------------------------------------------------
create or replace function public.mark_member_introduction_presented(p_candidate_id uuid)
returns void
language plpgsql
volatile
security invoker
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;
  if p_candidate_id is null or p_candidate_id = auth.uid() then
    return;
  end if;

  insert into public.member_introduction_history as h
    (viewer_id, candidate_id, first_presented_at, last_presented_at, presented_count)
  values (auth.uid(), p_candidate_id, now(), now(), 1)
  on conflict (viewer_id, candidate_id) do update
    set last_presented_at = now(),
        first_presented_at = coalesce(h.first_presented_at, now()),
        presented_count = h.presented_count + 1
    where h.consumed_at is null;
end;
$function$;

revoke all on function public.mark_member_introduction_presented(uuid) from public, anon;
grant execute on function public.mark_member_introduction_presented(uuid) to authenticated;


create or replace function public.consume_member_introduction(p_candidate_id uuid, p_reason text)
returns void
language plpgsql
volatile
security invoker
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;
  if p_reason is null or p_reason not in ('advanced', 'write', 'profile') then
    raise exception 'Invalid introduction consume reason.';
  end if;
  if p_candidate_id is null or p_candidate_id = auth.uid() then
    return;
  end if;

  -- Consuming implies the card was on screen, so presentation fields are
  -- filled if missing. The FIRST consume wins; later calls are no-ops.
  insert into public.member_introduction_history as h
    (viewer_id, candidate_id, first_presented_at, last_presented_at, presented_count, consumed_at, consumed_reason)
  values (auth.uid(), p_candidate_id, now(), now(), 1, now(), p_reason)
  on conflict (viewer_id, candidate_id) do update
    set consumed_at = now(),
        consumed_reason = p_reason,
        first_presented_at = coalesce(h.first_presented_at, now()),
        last_presented_at = coalesce(h.last_presented_at, now()),
        presented_count = greatest(h.presented_count, 1)
    where h.consumed_at is null;
end;
$function$;

revoke all on function public.consume_member_introduction(uuid, text) from public, anon;
grant execute on function public.consume_member_introduction(uuid, text) to authenticated;

commit;
