-- ============================================================
-- TEMPA — PHASE 10: ROOM FINAL INTEGRATION
-- PREPARED 2026-10-06. FORWARD-ONLY.
--
-- Product contract:
-- * The Room has one exact live Question identity at a time.
-- * Starting a fresh weekly round never reuses old answers as new-week answers.
-- * Historical Room answers remain readable and remain valid conversation origins.
-- * Question reading is public-to-members and capacity-independent.
-- * Private first-contact capacity is enforced only when a member tries to write.
-- * Current Question answer reading is fairness-first, six at a time, with
--   identities already shown explicitly excluded by the caller.
-- * No likes, popularity ranking, fastest-answer ranking, follower mechanics,
--   or paid exposure are introduced.
-- ============================================================

begin;

-- ============================================================
-- 1. FRESH WEEKLY QUESTION IDENTITY
-- ============================================================

create or replace function public.admin_start_room_question(
  p_question_id uuid,
  p_restart boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = 'pg_catalog'
as $function$
declare
  v_source public.questions%rowtype;
  v_id uuid;
  v_actor text;
begin
  if auth.uid() is null
     or not coalesce(public.is_staff('admin'), false) then
    raise exception 'Not authorized.';
  end if;

  perform pg_advisory_xact_lock(hashtext('tempa-current-room-question'));

  select *
  into v_source
  from public.questions
  where id = p_question_id
  for update;

  if not found
     or v_source.is_flagship
     or not v_source.is_active then
    raise exception 'Choose an active non-Flagship Question.';
  end if;

  if p_restart and v_source.current_position is null then
    raise exception
      'The current Question changed. Refresh before starting a fresh week.';
  end if;

  if not p_restart and v_source.current_position is not null then
    return v_source.id;
  end if;

  select pseudonym
  into v_actor
  from public.profiles
  where id = auth.uid();

  -- Preserve publication evidence for the outgoing Question. No answer is
  -- moved, rewritten or deleted.
  insert into public.admin_audit_log (
    actor_id,
    actor_identifier_snapshot,
    action,
    target_type,
    target_id,
    target_identifier_snapshot
  )
  select
    auth.uid(),
    coalesce(v_actor, auth.uid()::text),
    'room_question_archived',
    'question',
    q.id,
    q.prompt
  from public.questions q
  where q.is_active
    and not q.is_flagship
    and q.current_position is not null;

  v_id := v_source.id;

  -- Reusing wording is allowed; reusing an answered weekly identity is not.
  if p_restart
     or exists (
       select 1
       from public.question_answers
       where question_id = v_source.id
     ) then
    insert into public.questions (
      prompt,
      family,
      is_active,
      is_flagship
    )
    values (
      v_source.prompt,
      v_source.family,
      true,
      false
    )
    returning id into v_id;
  end if;

  perform public.admin_make_current_room_question(v_id);

  insert into public.admin_audit_log (
    actor_id,
    actor_identifier_snapshot,
    action,
    target_type,
    target_id,
    target_identifier_snapshot,
    metadata
  )
  values (
    auth.uid(),
    coalesce(v_actor, auth.uid()::text),
    'room_question_started',
    'question',
    v_id,
    v_source.prompt,
    jsonb_build_object(
      'source_question_id', v_source.id,
      'fresh_question', v_id <> v_source.id
    )
  );

  return v_id;
end;
$function$;

revoke all on function public.admin_start_room_question(uuid, boolean)
  from public, anon;
grant execute on function public.admin_start_room_question(uuid, boolean)
  to authenticated;


-- ============================================================
-- 2. PUBLISHED ROOM HISTORY + EXACT ANSWER CONVERSATION ORIGIN
-- ============================================================

create or replace function public.room_question_published(
  p_question_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = 'pg_catalog'
as $function$
  select public.room_reading_allowed()
    and exists (
      select 1
      from public.questions q
      where q.id = p_question_id
        and (
          q.is_flagship
          or (q.is_active and q.current_position is not null)
          or exists (
            select 1
            from public.admin_audit_log a
            where a.target_type = 'question'
              and a.target_id = q.id
              and a.action in (
                'room_question_made_current',
                'room_question_archived',
                'room_question_started'
              )
          )
        )
    )
$function$;

revoke all on function public.room_question_published(uuid)
  from public, anon;
grant execute on function public.room_question_published(uuid)
  to authenticated;

create or replace function public.room_answer_can_start_letter(
  p_answer uuid,
  p_author uuid
)
returns boolean
language sql
stable
security definer
set search_path = 'pg_catalog'
as $function$
  select auth.uid() is not null
    and auth.uid() <> p_author
    and public.room_reading_allowed()
    and public.member_question_author_visible(p_author)
    and not tempa_private.is_correspondence_blocked_pair(auth.uid(), p_author)
    and not tempa_private.hidden_from_discovery(auth.uid(), p_author)
    and exists (
      select 1
      from public.question_answers a
      where a.id = p_answer
        and a.user_id = p_author
        and a.moderation_status = 'visible'
        and public.room_question_published(a.question_id)
    )
$function$;

revoke all on function public.room_answer_can_start_letter(uuid, uuid)
  from public, anon;
grant execute on function public.room_answer_can_start_letter(uuid, uuid)
  to authenticated;

-- Keep every later Safety/lifecycle refinement installed in these functions.
-- Only broaden the exact answer-origin predicate, and refuse an unexpected
-- live function shape instead of copying a stale implementation.
do $answer_origin_patch$
declare
  v_signature text;
  v_definition text;
  v_updated text;
  v_matches integer;
  v_pattern text :=
    'and qa\.is_current = true[[:space:]]+and q\.is_active = true';
begin
  foreach v_signature in array array[
    'public.send_first_letter(uuid,uuid,text,uuid,boolean)',
    'public.can_evaluate_safety_context(text,uuid,uuid,uuid,jsonb)'
  ]
  loop
    if to_regprocedure(v_signature) is null then
      raise exception 'Missing required function: %', v_signature;
    end if;

    select pg_get_functiondef(to_regprocedure(v_signature))
    into v_definition;

    if position(
      'public.room_answer_can_start_letter(qa.id, qa.user_id)'
      in v_definition
    ) > 0 then
      continue;
    end if;

    select count(*)
    into v_matches
    from regexp_matches(v_definition, v_pattern, 'g');

    if v_matches <> 1 then
      raise exception
        'Unexpected answer guard in %. Review the live definition first.',
        v_signature;
    end if;

    v_updated := regexp_replace(
      v_definition,
      v_pattern,
      'and ((qa.is_current = true and q.is_active = true) or public.room_answer_can_start_letter(qa.id, qa.user_id))'
    );

    execute v_updated;
  end loop;
end;
$answer_origin_patch$;


-- ============================================================
-- 3. FAIR SIX-AT-A-TIME CURRENT QUESTION READING
-- ============================================================

create or replace function public.room_read_question_answer_batch(
  p_question_id uuid,
  p_exclude_user_ids uuid[] default array[]::uuid[],
  p_limit integer default 6,
  p_country text default null,
  p_gender text default null,
  p_age text default null
)
returns table (
  answer_id uuid,
  user_id uuid,
  body text,
  created_at timestamptz,
  pseudonym text,
  country text,
  gender text,
  gender_custom text,
  age_range text,
  mark_id uuid,
  prompt text
)
language sql
stable
security invoker
set search_path = 'pg_catalog'
as $function$
  with viewer as (
    select auth.uid() as id
  ),
  eligible as materialized (
    select distinct on (a.user_id)
      a.id as answer_id,
      a.user_id,
      a.body,
      a.created_at,
      a.updated_at,
      p.pseudonym,
      p.country,
      p.gender,
      p.gender_custom,
      p.age_range,
      p.mark_id,
      q.prompt
    from public.question_answers a
    join public.public_profiles p on p.id = a.user_id
    join public.questions q on q.id = a.question_id
    cross join viewer v
    where v.id is not null
      and public.room_reading_allowed()
      and public.room_question_published(p_question_id)
      and a.question_id = p_question_id
      and a.moderation_status = 'visible'
      and public.member_question_author_visible(a.user_id)
      and not tempa_private.is_blocked_pair(v.id, a.user_id)
      and not tempa_private.hidden_from_discovery(v.id, a.user_id)
      and not (
        a.user_id = any(
          coalesce(p_exclude_user_ids, array[]::uuid[])
        )
      )
      and (nullif(p_country, '') is null or p.country = p_country)
      and (
        nullif(p_gender, '') is null
        or p.gender = p_gender
        or (p.gender = 'Self-describe' and p.gender_custom = p_gender)
      )
      and (nullif(p_age, '') is null or p.age_range = p_age)
    order by
      a.user_id,
      a.updated_at desc nulls last,
      a.created_at desc,
      a.id
  ),
  facts as materialized (
    select rf.*
    from public.room_discovery_rank_facts(
      (select id from viewer),
      coalesce(
        (
          select array_agg(e.user_id)
          from eligible e
          where e.user_id <> (select id from viewer)
        ),
        array[]::uuid[]
      )
    ) rf
  ),
  ranked as materialized (
    select
      e.*,
      case
        when e.user_id = (select id from viewer) then 1
        else 0
      end as self_rank,
      coalesce(f.fair_rank, 2147483647::bigint) as fair_rank,
      hashtextextended(
        (select id from viewer)::text
          || ':' || p_question_id::text
          || ':' || e.user_id::text,
        0
      ) as stable_hash
    from eligible e
    left join facts f on f.candidate_id = e.user_id
  )
  select
    r.answer_id,
    r.user_id,
    r.body,
    r.created_at,
    r.pseudonym,
    r.country,
    r.gender,
    r.gender_custom,
    r.age_range,
    r.mark_id,
    r.prompt
  from ranked r
  order by
    r.self_rank,
    r.fair_rank,
    r.stable_hash,
    r.user_id
  limit least(greatest(coalesce(p_limit, 6), 1), 24) + 1
$function$;

revoke all on function public.room_read_question_answer_batch(
  uuid, uuid[], integer, text, text, text
) from public, anon;

grant execute on function public.room_read_question_answer_batch(
  uuid, uuid[], integer, text, text, text
) to authenticated;

commit;


-- ============================================================
-- READ-ONLY VERIFICATION — EVERY BOOLEAN SHOULD BE TRUE
-- ============================================================

select
  to_regprocedure('public.admin_start_room_question(uuid,boolean)') is not null
    as fresh_week_ready,

  to_regprocedure('public.room_answer_can_start_letter(uuid,uuid)') is not null
    as room_answer_origin_ready,

  to_regprocedure(
    'public.room_read_question_answer_batch(uuid,uuid[],integer,text,text,text)'
  ) is not null
    as six_answer_batch_ready,

  position(
    'room_question_archived'
    in pg_get_functiondef(
      'public.room_question_published(uuid)'::regprocedure
    )
  ) > 0
    as archived_question_history_readable,

  position(
    'public.room_answer_can_start_letter(qa.id, qa.user_id)'
    in pg_get_functiondef(
      'public.send_first_letter(uuid,uuid,text,uuid,boolean)'::regprocedure
    )
  ) > 0
    as sender_accepts_published_room_answer,

  position(
    'public.room_answer_can_start_letter(qa.id, qa.user_id)'
    in pg_get_functiondef(
      'public.can_evaluate_safety_context(text,uuid,uuid,uuid,jsonb)'::regprocedure
    )
  ) > 0
    as safety_accepts_published_room_answer,

  position(
    'room_discovery_rank_facts'
    in pg_get_functiondef(
      'public.room_read_question_answer_batch(uuid,uuid[],integer,text,text,text)'::regprocedure
    )
  ) > 0
    as room_batch_uses_fairness_rank,

  position(
    'p_exclude_user_ids'
    in pg_get_functiondef(
      'public.room_read_question_answer_batch(uuid,uuid[],integer,text,text,text)'::regprocedure
    )
  ) > 0
    as room_batch_excludes_shown_people,

  not has_function_privilege(
    'anon',
    'public.admin_start_room_question(uuid,boolean)',
    'EXECUTE'
  )
    as anon_cannot_start_week,

  not has_function_privilege(
    'anon',
    'public.room_read_question_answer_batch(uuid,uuid[],integer,text,text,text)',
    'EXECUTE'
  )
    as anon_cannot_read_member_room_batch;
