-- Tempa introduction recycling. Run after MEMBER_INTRODUCTIONS_READY.
-- Forward-only, repeatable replacement of three existing RPCs; no history deletion.
-- Unseen newcomers (tier 0), unseen established (tier 1), then seen >= 7 days (tier 2).
-- Randomized within each tier on every retrieval; at most seven cards.
-- Active correspondents and recipients of sent first letters remain excluded.
-- Existing consumed timestamps become encounter timestamps, including old dismissals.
-- The client still limits 20-minute returns to tier 0; sign-in may use all tiers.
-- Existing invoker RLS, newcomer helper, table grants and visibility surfaces stay intact.
begin;

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
    select l.recipient_id as user_id
    from public.letters_for_participant l
    cross join viewer v
    where l.sender_id = v.id
      and l.reply_to_id is null
  ),
  history as materialized (
    select h.candidate_id as user_id, greatest(h.last_presented_at, h.consumed_at) as last_presented_at
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
      random() as sort_key
    from representative r
    join visible_profiles p on p.id = r.user_id
    cross join viewer v
    left join history h on h.user_id = p.id
    left join newcomers nc on nc.user_id = p.id
    where not exists (select 1 from partners x where x.user_id = p.id)
      and not exists (select 1 from contacted c where c.user_id = p.id)
      and (h.user_id is null or h.last_presented_at <= now() - interval '7 days')
  ),
  picked as (
    select c.*
    from candidates c
    order by
      c.tier,
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
    pk.sort_key,
    pk.id;
end;
$function$;

revoke all on function public.get_member_introductions(integer) from public, anon;
grant execute on function public.get_member_introductions(integer) to authenticated;


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
;
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

  -- An action records the latest encounter, never permanent dismissal.
  -- Opening Write does not prove a letter was sent; retrieval checks sent letters.
  insert into public.member_introduction_history as h
    (viewer_id, candidate_id, first_presented_at, last_presented_at, presented_count, consumed_at, consumed_reason)
  values (auth.uid(), p_candidate_id, now(), now(), 1, now(), p_reason)
  on conflict (viewer_id, candidate_id) do update
    set consumed_at = now(),
        consumed_reason = p_reason,
        first_presented_at = coalesce(h.first_presented_at, now()),
        last_presented_at = now(),
        presented_count = greatest(h.presented_count, 1)
;
end;
$function$;

revoke all on function public.consume_member_introduction(uuid, text) from public, anon;
grant execute on function public.consume_member_introduction(uuid, text) to authenticated;

commit;
