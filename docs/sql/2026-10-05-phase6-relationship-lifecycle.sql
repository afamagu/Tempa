-- ============================================================
-- TEMPA — PHASE 6: RELATIONSHIP LIFECYCLE COMPLETION
-- PREPARED 2026-10-05. REVIEW BEFORE PRODUCTION EXECUTION.
--
-- Completes the finite relationship model introduced in Phases 1–5.
--
-- Invariants completed here:
--   * pending AND active correspondences are both OPEN relationships for
--     discovery purposes; neither participant may be surfaced as someone
--     new to meet while an unresolved first-contact episode exists.
--   * automatic first-contact expiry is root-aware, not correspondence-
--     naive: expiring one crossed root never closes a shared pending episode
--     while another live root remains.
--   * automatic expiry never closes an already-established correspondence,
--     even if a redundant crossed root remains status='sent'.
--   * capacity is released exactly when the final live root in a genuinely
--     pending/unestablished correspondence resolves or expires.
--
-- This migration is forward-only. It does not rewrite historical migrations,
-- change Safety/RLS, alter Mail Call delivery, invent a synthetic reply, or
-- terminate an established relationship.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. SAFE AUTOMATIC EXPIRY
-- ------------------------------------------------------------
-- The historical implementation closed every correspondence touched by an
-- expired root. That was valid only when one first letter owned one episode.
-- Crossed first contacts now share one pending correspondence, so expiry must
-- resolve roots first and close the episode only after re-checking the shared
-- correspondence under lock.
create or replace function public.expire_stale_first_contacts()
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_correspondence_id uuid;
  v_expired integer := 0;
begin
  -- Lock candidate correspondence rows in deterministic id order. The
  -- correspondence lock serializes against send_first_letter's open-episode
  -- resolution and reply_to_letter's establishment update.
  for v_correspondence_id in
    select distinct c.id
    from public.correspondences c
    join public.letters l on l.correspondence_id = c.id
    where c.status = 'pending'
      and c.established_at is null
      and l.reply_to_id is null
      and l.status = 'sent'
      and l.expires_at <= now()
    order by c.id
    for update of c
  loop
    -- Resolve only roots that are actually stale at the instant this
    -- correspondence is locked. A concurrent reply/send that won the lock
    -- first therefore changes what this transaction is allowed to close.
    with expired as (
      update public.letters l
      set
        status = 'closed',
        closed_at = now(),
        closed_by = 'system',
        close_reason = null
      where l.correspondence_id = v_correspondence_id
        and l.reply_to_id is null
        and l.status = 'sent'
        and l.expires_at <= now()
      returning 1
    )
    select v_expired + count(*)::integer
    into v_expired
    from expired;

    -- Close the episode only if it is STILL genuinely pending and no live
    -- first-contact root remains in either direction. If a crossed root is
    -- still live, the pending episode survives. If a reciprocal reply already
    -- established it, status/established_at prevent closure entirely.
    update public.correspondences c
    set
      status = 'closed',
      closed_at = now()
    where c.id = v_correspondence_id
      and c.status = 'pending'
      and c.established_at is null
      and not exists (
        select 1
        from public.letters live
        where live.correspondence_id = c.id
          and live.reply_to_id is null
          and live.status = 'sent'
          and live.expires_at > now()
      );
  end loop;

  return v_expired;
end;
$function$;

revoke all on function public.expire_stale_first_contacts() from public, anon, authenticated;
grant execute on function public.expire_stale_first_contacts() to service_role;

comment on function public.expire_stale_first_contacts() is
  'Phase 6 root-aware expiry: expires stale pending first-contact roots, preserves crossed episodes while another live root remains, and never closes established correspondence.';


-- ------------------------------------------------------------
-- 2. PEOPLE DISCOVERY: EXCLUDE ALL OPEN CORRESPONDENCES
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
  partners as materialized (
    select case when c.participant_low = v.id then c.participant_high else c.participant_low end as user_id
    from public.correspondences c
    cross join viewer v
    where c.status in ('pending', 'active')
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
-- 3. PASSIVE INTRODUCTIONS: EXCLUDE ALL OPEN CORRESPONDENCES
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

  insert into public.member_introduction_state (viewer_id)
  values (auth.uid())
  on conflict (viewer_id) do nothing;

  return query
  with viewer as materialized (
    select
      auth.uid() as id,
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
    where c.status in ('pending', 'active')
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
-- 4. FAMILIAR FACES: EXCLUDE ALL OPEN CORRESPONDENCES
-- ------------------------------------------------------------
create or replace function public.get_familiar_faces(p_limit integer default 3)
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
  answer_id uuid,
  prompt text,
  body text,
  last_encountered_at timestamptz,
  presented_count integer
)
language plpgsql
stable
security invoker
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not coalesce((
    select c.can_start_first_contact
    from public.get_relationship_capacity() c
    limit 1
  ), false) then
    return;
  end if;

  return query
  with viewer as materialized (
    select auth.uid() as id
  ),
  partners as materialized (
    select case when c.participant_low = v.id then c.participant_high else c.participant_low end as user_id
    from public.correspondences c
    cross join viewer v
    where c.status in ('pending', 'active')
      and (c.participant_low = v.id or c.participant_high = v.id)
  ),
  contacted as materialized (
    select l.recipient_id as user_id
    from public.letters_for_participant l
    cross join viewer v
    where l.sender_id = v.id
      and l.reply_to_id is null
  ),
  eligible_history as materialized (
    select
      h.candidate_id,
      greatest(h.last_presented_at, h.consumed_at) as last_encountered_at,
      h.presented_count
    from public.member_introduction_history h
    cross join viewer v
    where h.viewer_id = v.id
      and h.presented_count >= 1
      and greatest(h.last_presented_at, h.consumed_at) <= now() - interval '7 days'
      and not exists (select 1 from partners p where p.user_id = h.candidate_id)
      and not exists (select 1 from contacted c where c.user_id = h.candidate_id)
  ),
  flagship as (
    select q.id from public.questions q where q.is_flagship = true limit 1
  ),
  representative as materialized (
    select distinct on (qa.user_id)
      qa.id,
      qa.user_id,
      qa.question_id,
      qa.body
    from public.question_answers qa
    where qa.moderation_status = 'visible'
    order by
      qa.user_id,
      (qa.question_id = (select f.id from flagship f)) desc nulls last,
      qa.is_current desc nulls last,
      qa.updated_at desc nulls last,
      qa.id
  ),
  picked as (
    select
      p.id,
      p.pseudonym,
      p.country,
      p.gender,
      p.gender_custom,
      p.age_range,
      p.mark_id,
      array(select jsonb_array_elements_text(case when jsonb_typeof(to_jsonb(p.languages)) = 'array' then to_jsonb(p.languages) else '[]'::jsonb end)) as languages,
      array(select jsonb_array_elements_text(case when jsonb_typeof(to_jsonb(p.intent)) = 'array' then to_jsonb(p.intent) else '[]'::jsonb end)) as intent,
      r.id as answer_id,
      r.question_id,
      r.body,
      h.last_encountered_at,
      h.presented_count
    from eligible_history h
    join public.public_profiles p on p.id = h.candidate_id
    join representative r on r.user_id = p.id
    order by h.last_encountered_at asc, p.id asc
    limit least(greatest(coalesce(p_limit, 3), 1), 3)
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
    pk.answer_id::uuid,
    q.prompt::text,
    pk.body::text,
    pk.last_encountered_at::timestamptz,
    pk.presented_count::integer
  from picked pk
  left join public.questions q on q.id = pk.question_id
  order by pk.last_encountered_at asc, pk.id asc;
end;
$function$;

revoke all on function public.get_familiar_faces(integer) from public, anon;
grant execute on function public.get_familiar_faces(integer) to authenticated;

commit;
