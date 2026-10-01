-- Discover grid and independent compatibility recommendations.
-- No profile/preferences rewrite; no publishing, email or Storage changes.
-- Raw interest selections remain owner-only under their existing RLS.
begin;

create or replace function public.discover_profile_people(
  p_country text default null,
  p_gender text default null,
  p_age_range text default null,
  p_language text default null,
  p_intent text default null,
  p_interest text default null,
  p_search text default null,
  p_exclude_user_ids uuid[] default array[]::uuid[],
  p_seed text default '',
  p_suggested boolean default false,
  p_limit integer default 6,
  p_after_user_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare result jsonb;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated'
     or public.current_account_status() is distinct from 'active' then
    raise exception 'Active member required' using errcode = '42501';
  end if;
  if cardinality(coalesce(p_exclude_user_ids, array[]::uuid[])) > 600
     or length(coalesce(p_seed, '')) > 80
     or length(coalesce(p_search, '')) > 80 then
    raise exception 'Invalid discovery request' using errcode = '22023';
  end if;

  with viewer as (
    select p.id, coalesce(p.intent, array[]::text[]) as intent
    from public.public_profiles p where p.id = auth.uid()
  ), viewer_interests as materialized (
    select i.interest_key from public.profile_interests i where i.viewer_user_id = auth.uid()
  ), candidates as materialized (
    select p.*,
      (select count(*)::integer from public.profile_interests pi
       join viewer_interests vi on vi.interest_key = pi.interest_key
       where pi.viewer_user_id = p.id)
      + (select count(distinct x)::integer from unnest(coalesce(p.intent, array[]::text[])) x
         where x = any(v.intent)) as similarity,
      hashtextextended(p.id::text || ':' || left(coalesce(p_seed,''),80), 0) as shuffle
    from public.public_profiles p cross join viewer v
    where p.id <> v.id
      and not tempa_private.account_is_banned(p.id)
      and not tempa_private.is_correspondence_blocked_pair(v.id, p.id)
      and not exists (select 1 from public.account_deactivations d where d.user_id = p.id and d.reactivated_at is null)
      and not exists (select 1 from public.account_enforcement_state e where e.user_id = p.id and e.status <> 'active')
      and not (p.id = any(coalesce(p_exclude_user_ids, array[]::uuid[])))
      and not exists (
        select 1 from public.correspondences c join public.correspondence_hidden_for_user h on h.correspondence_id = c.id
        where h.user_id = v.id and (c.participant_low = p.id or c.participant_high = p.id)
      )
      -- Recommendations are introductions. Ordinary Discover includes existing
      -- correspondents as well as new members, subject to lifecycle/block rules.
      and (not coalesce(p_suggested, false) or not exists (
        select 1 from public.correspondences c where c.status = 'active'
          and ((c.participant_low = v.id and c.participant_high = p.id)
            or (c.participant_high = v.id and c.participant_low = p.id))
      ))
  ), filtered as materialized (
    select c.* from candidates c
    where (nullif(p_country, '') is null or c.country = p_country)
      and (nullif(p_gender, '') is null or c.gender = p_gender or (c.gender = 'Self-describe' and c.gender_custom = p_gender))
      and (nullif(p_age_range, '') is null or c.age_range = p_age_range)
      and (nullif(p_language, '') is null or p_language = any(c.languages))
      and (nullif(p_intent, '') is null or p_intent = any(c.intent))
      and (nullif(p_interest, '') is null or exists (
        select 1 from public.profile_interests pi where pi.viewer_user_id = c.id and pi.interest_key = p_interest
      ))
      and (nullif(btrim(p_search), '') is null
        or position(lower(btrim(p_search)) in lower(concat_ws(' ', c.pseudonym, c.country,
             array_to_string(c.languages, ' '), array_to_string(c.intent, ' ')))) > 0
        or exists (
          select 1 from public.profile_interests pi join public.interests i on i.key = pi.interest_key
          where pi.viewer_user_id = c.id and position(lower(btrim(p_search)) in lower(i.label)) > 0
        ))
      and (not coalesce(p_suggested, false) or c.similarity > 0)
  ), remaining as materialized (
    select f.* from filtered f
    where coalesce(p_suggested,false) or p_after_user_id is null
      or (f.shuffle, f.id) > (hashtextextended(p_after_user_id::text || ':' || left(coalesce(p_seed,''),80), 0), p_after_user_id)
  ), page as (
    select f.* from remaining f
    order by case when coalesce(p_suggested, false) then f.similarity else 0 end desc, f.shuffle, f.id
    limit least(greatest(coalesce(p_limit,6),1),24)
  )
  select jsonb_build_object(
    'eligible_count', (select count(*) from candidates),
    'filtered_count', (select count(*) from remaining),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', p.id, 'pseudonym', p.pseudonym, 'country', p.country,
        'gender', p.gender, 'gender_custom', p.gender_custom, 'age_range', p.age_range,
        'mark_id', p.mark_id, 'languages', p.languages, 'intent', p.intent,
        'answer_id', coalesce(a.id::text,''), 'body', coalesce(a.body,''), 'prompt', q.prompt
      ) order by case when coalesce(p_suggested,false) then p.similarity else 0 end desc, p.shuffle, p.id)
      from page p
      left join lateral (
        select qa.id, qa.body, qa.question_id from public.question_answers qa
        where qa.user_id = p.id and qa.moderation_status = 'visible'
        order by qa.is_current desc, qa.updated_at desc nulls last, qa.id limit 1
      ) a on true
      left join public.questions q on q.id = a.question_id
    ), '[]'::jsonb)
  ) into result;
  return result;
end
$function$;

revoke all on function public.discover_profile_people(text,text,text,text,text,text,text,uuid[],text,boolean,integer,uuid) from public, anon;
grant execute on function public.discover_profile_people(text,text,text,text,text,text,text,uuid[],text,boolean,integer,uuid) to authenticated;

commit;
