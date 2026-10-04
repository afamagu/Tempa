-- TEMPA — PHASE 5: FAMILIAR FACES
-- Forward-only, repeatable RPC over the existing member_introduction_history ledger.
-- No parallel familiarity table. No popularity score. No permanent dismissal.
--
-- Eligibility:
--   * the viewer has genuinely encountered the person before
--   * at least seven days have passed since the latest encounter/action
--   * the person is still visible through public_profiles (Safety/RLS)
--   * no active correspondence exists between the pair
--   * the viewer has not already sent that person a first letter
--   * the viewer can currently begin another correspondence
--
-- Ordering is deterministic: oldest eligible encounter first, then candidate id.
-- The surface is deliberately bounded to at most three people.

begin;

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

  -- Familiar Faces is a path toward a possible new correspondence, so it
  -- disappears calmly when the canonical capacity authority says there is no
  -- room. Search/Room/Board remain independently available to the member.
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
