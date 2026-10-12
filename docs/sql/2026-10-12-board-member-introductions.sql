CREATE OR REPLACE FUNCTION public.get_member_introductions_v2(p_limit integer DEFAULT 7)
 RETURNS TABLE(candidate_id uuid, pseudonym text, country text, gender text, gender_custom text, age_range text, mark_id uuid, languages text[], intent text[], shared_languages text[], shared_intents text[], answer_id uuid, prompt text, body text, priority_tier integer, source_type text)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
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
      array(
        select jsonb_array_elements_text(
          case
            when jsonb_typeof(to_jsonb(vp.languages)) = 'array'
              then to_jsonb(vp.languages)
            else '[]'::jsonb
          end
        )
      ) as languages,
      array(
        select jsonb_array_elements_text(
          case
            when jsonb_typeof(to_jsonb(vp.intent)) = 'array'
              then to_jsonb(vp.intent)
            else '[]'::jsonb
          end
        )
      ) as intent
    from (select 1) _one
    left join public.public_profiles vp on vp.id = auth.uid()
  ),
  flagship as (
    select q.id
    from public.questions q
    where q.is_flagship = true
    limit 1
  ),
  partners as materialized (
    select
      case
        when c.participant_low = v.id then c.participant_high
        else c.participant_low
      end as user_id
    from public.correspondences c
    cross join viewer v
    where c.status in ('pending', 'active', 'paused')
      and (
        c.participant_low = v.id
        or c.participant_high = v.id
      )
  ),
  contacted as materialized (
    select l.recipient_id as user_id
    from public.letters_for_participant l
    cross join viewer v
    where l.sender_id = v.id
      and l.reply_to_id is null
  ),
  history as materialized (
    select
      h.candidate_id as user_id,
      greatest(
        h.last_presented_at,
        h.consumed_at
      ) as last_presented_at
    from public.member_introduction_history h
    cross join viewer v
    where h.viewer_id = v.id
  ),
  newcomers as materialized (
    select n.id as user_id
    from tempa_private.member_introduction_newcomer_ids() n
  ),
  representative as materialized (
    select distinct on (writing.user_id) writing.*
    from (
      select d.id, d.author_id as user_id, null::uuid as question_id,
        d.body, 'board_letter'::text as source_type, 0 as source_rank,
        coalesce(d.published_at,d.created_at) as written_at
      from public.dispatches d
      where d.status='published' and d.moderation_status='visible'
        and d.published_as='member' and d.author_id<>auth.uid()
      union all
      select qa.id,qa.user_id,qa.question_id,qa.body,
        'question_answer'::text,1,qa.updated_at
      from public.question_answers qa
      where qa.moderation_status='visible' and qa.user_id<>auth.uid()
    ) writing
    order by writing.user_id,writing.source_rank,writing.written_at desc nulls last,writing.id
  ),
  visible_profiles as materialized (
    select
      p.id,
      p.pseudonym,
      p.country,
      p.gender,
      p.gender_custom,
      p.age_range,
      p.mark_id,
      array(
        select jsonb_array_elements_text(
          case
            when jsonb_typeof(to_jsonb(p.languages)) = 'array'
              then to_jsonb(p.languages)
            else '[]'::jsonb
          end
        )
      ) as languages,
      array(
        select jsonb_array_elements_text(
          case
            when jsonb_typeof(to_jsonb(p.intent)) = 'array'
              then to_jsonb(p.intent)
            else '[]'::jsonb
          end
        )
      ) as intent
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
      r.source_type,
      array(
        select unnest(p.languages)
        intersect
        select unnest(v.languages)
        order by 1
      ) as shared_languages,
      array(
        select unnest(p.intent)
        intersect
        select unnest(v.intent)
        order by 1
      ) as shared_intents,
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
    where not exists (
      select 1
      from partners x
      where x.user_id = p.id
    )
      and not exists (
        select 1
        from contacted c
        where c.user_id = p.id
      )
      and (
        h.user_id is null
        or h.last_presented_at <= now() - interval '7 days'
      )
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
    pk.tier::integer,
    pk.source_type::text
  from picked pk
  left join public.questions q on q.id = pk.question_id
  order by
    pk.tier,
    pk.sort_key,
    pk.id;
end;
$function$;
revoke all on function public.get_member_introductions_v2(integer) from public,anon;
grant execute on function public.get_member_introductions_v2(integer) to authenticated;

