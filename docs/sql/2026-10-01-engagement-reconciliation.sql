-- TEMPA — FINAL LETTERS / DISCOVER RECONCILIATION
-- STATUS: NOT EXECUTED IN PRODUCTION
-- Prerequisites: Room fair exposure migration + set-based recorder + current Question.
-- Forward-only; does not alter existing public_profiles or publishing/safety RPCs.
begin;

create or replace function public.discover_profiles(
  p_country text default null,
  p_gender text default null,
  p_age_range text default null,
  p_language text default null,
  p_intent text default null,
  p_search text default null,
  p_exclude_user_ids uuid[] default array[]::uuid[],
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
    order by
      qa.user_id,
      case
        when qa.question_id = (select rq.id from room_question rq) then 1
        when qa.question_id = (select f.id from flagship f) then 2
        when qa.is_current then 3
        else 4
      end,
      qa.updated_at desc nulls last,
      qa.id
  ),
  visible_profiles as materialized (
    select p.id, p.pseudonym, p.country, p.gender, p.gender_custom, p.age_range, p.mark_id, p.languages, p.intent
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
      p.languages,
      p.intent,
      case when r.question_id = (select rq.id from room_question rq) then 1 else 0 end as current_question_relevance,
      hashtext(v.id::text || ':' || p.id::text) as stable_hash
    from visible_profiles p
    left join representative r on r.user_id = p.id
    cross join viewer v
    where not exists (select 1 from partners x where x.user_id = p.id)
      and not exists (select 1 from contacted c where c.answer_id = r.id)
      and not (p.id = any(coalesce(p_exclude_user_ids, array[]::uuid[])))
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
      and (nullif(p_language, '') is null or p_language = any(e.languages))
      and (nullif(p_intent, '') is null or p_intent = any(e.intent))
      and (nullif(btrim(p_search), '') is null or position(lower(btrim(p_search)) in lower(e.pseudonym)) > 0)
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
  ),
  page as (
    select r.*
    from ranked r
    order by r.fair_rank, r.current_question_relevance desc, r.stable_hash, r.user_id
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
            'languages', pg.languages,
            'intent', pg.intent,
            'answer_id', coalesce(pg.answer_id::text, ''),
            'body', coalesce(pg.body, ''),
            'prompt', q.prompt
          )
          order by pg.fair_rank, pg.current_question_relevance desc, pg.stable_hash, pg.user_id
        )
        from page pg
        left join public.questions q on q.id = pg.question_id
      ),
      '[]'::jsonb
    )
  )
$function$;

revoke all on function public.discover_profiles(text, text, text, text, text, text, uuid[], integer) from public, anon;
grant execute on function public.discover_profiles(text, text, text, text, text, text, uuid[], integer) to authenticated;


-- Restricted eligibility predicate: exposes only whether the caller can name
-- this existing correspondent. No relationship counts/other members' graphs.
create or replace function public.can_pick_correspondent(p_partner uuid)
returns boolean language sql stable security definer set search_path to 'pg_catalog'
as $fn$
  select auth.uid() is not null and p_partner <> auth.uid()
    and public.current_account_status() = 'active'
    and not tempa_private.is_correspondence_blocked_pair(auth.uid(), p_partner)
    and not tempa_private.account_is_banned(p_partner)
    and not exists (select 1 from public.account_deactivations d where d.user_id = p_partner and d.reactivated_at is null)
    and not exists (select 1 from public.account_enforcement_state e where e.user_id = p_partner and e.status <> 'active')
    and exists (
      select 1 from public.correspondences c
      where c.status = 'active' and c.established_at is not null
        and ((c.participant_low = auth.uid() and c.participant_high = p_partner)
          or (c.participant_high = auth.uid() and c.participant_low = p_partner))
        and not exists (select 1 from public.correspondence_hidden_for_user h where h.user_id = auth.uid() and h.correspondence_id = c.id)
        and exists (select 1 from public.letters_for_participant l where l.correspondence_id = c.id and l.reply_to_id is not null)
    )
$fn$;
revoke all on function public.can_pick_correspondent(uuid) from public, anon;
grant execute on function public.can_pick_correspondent(uuid) to authenticated;

-- Filter by pseudonym in SQL, rank by visible exchanged letters, then recency.
-- No letter body is read or returned. The profiles/letter view still use RLS.
create or replace function public.correspondent_picker(p_search text default '', p_limit integer default 20)
returns table(user_id uuid, pseudonym text, mark_id uuid)
language sql stable security invoker set search_path to 'pg_catalog'
as $fn$
  with partners as (
    select c.id, case when c.participant_low = auth.uid() then c.participant_high else c.participant_low end as user_id
    from public.correspondences c
    where c.status = 'active' and c.established_at is not null
      and (c.participant_low = auth.uid() or c.participant_high = auth.uid())
      and not exists (select 1 from public.correspondence_hidden_for_user h where h.user_id=auth.uid() and h.correspondence_id=c.id)
  ), eligible as materialized (
    select p.id, p.pseudonym, p.mark_id, c.id as correspondence_id
    from partners c join public.public_profiles p on p.id = c.user_id
    where public.can_pick_correspondent(p.id)
      and (nullif(btrim(p_search), '') is null or position(lower(btrim(p_search)) in lower(p.pseudonym)) > 0)
  )
  select e.id, e.pseudonym, e.mark_id
  from eligible e join public.letters_for_participant l on l.correspondence_id = e.correspondence_id
  group by e.id, e.pseudonym, e.mark_id
  order by count(l.id) desc, max(l.created_at) desc, e.pseudonym, e.id
  limit least(greatest(coalesce(p_limit, 20), 1), 20)
$fn$;
revoke all on function public.correspondent_picker(text, integer) from public, anon;
grant execute on function public.correspondent_picker(text, integer) to authenticated;

commit;
