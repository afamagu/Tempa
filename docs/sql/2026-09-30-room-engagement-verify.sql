-- TEMPA — ROOM ENGAGEMENT VERIFIER
-- Run after the production migration pack. Probes roll back; no member
-- content, Question choices, notifications or emails are created by this file.
begin;
do $structural$
declare
  name text;
  sig text;
begin
  foreach name in array array['room_member_exposure','room_candidate_week_exposure','room_exposure_events','room_discovery_config'] loop
    if to_regclass('private.' || name) is null then raise exception 'Missing private table: %', name; end if;
    if not (select relrowsecurity from pg_class where oid=to_regclass('private.' || name)) then raise exception 'RLS missing: %', name; end if;
    if has_table_privilege('anon','private.' || name,'SELECT,INSERT,UPDATE,DELETE')
       or has_table_privilege('authenticated','private.' || name,'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'Private table accessible to a member: %', name;
    end if;
  end loop;
  foreach sig in array array[
    'public.room_discovery_rank_facts(uuid,uuid[])',
    'public.discover_people_v2(text,text,text,uuid,uuid[],integer,integer,timestamptz)',
    'public.admin_make_current_room_question(uuid)',
    'public.submit_room_question_suggestion(text,boolean)',
    'public.admin_list_room_question_suggestions()',
    'public.admin_update_room_question_suggestion(uuid,text,text,uuid)'
  ] loop
    if to_regprocedure(sig) is null then raise exception 'Missing function: %', sig; end if;
    if has_function_privilege('anon',sig,'EXECUTE') then raise exception 'Anonymous function access: %', sig; end if;
    if not has_function_privilege('authenticated',sig,'EXECUTE') then raise exception 'Member function grant missing: %', sig; end if;
  end loop;
  foreach sig in array array['public.record_room_exposures(uuid,uuid[],text)','public.room_fairness_snapshot()'] loop
    if to_regprocedure(sig) is null then raise exception 'Missing service function: %', sig; end if;
    if has_function_privilege('authenticated',sig,'EXECUTE') or has_function_privilege('anon',sig,'EXECUTE') then raise exception 'Service-only function exposed: %', sig; end if;
    if not has_function_privilege('service_role',sig,'EXECUTE') then raise exception 'Service grant missing: %', sig; end if;
  end loop;
  if (select prosecdef from pg_proc where oid='public.discover_people_v2(text,text,text,uuid,uuid[],integer,integer,timestamptz)'::regprocedure) then
    raise exception 'Discovery must remain SECURITY INVOKER';
  end if;
  if pg_get_function_result('public.room_discovery_rank_facts(uuid,uuid[])'::regprocedure) ilike '%weekly_exposure_count%'
     or pg_get_function_result('public.room_discovery_rank_facts(uuid,uuid[])'::regprocedure) ilike '%new_member_below_floor%' then
    raise exception 'Private exposure metrics leaked by rank helper';
  end if;
  if not exists(select 1 from private.room_discovery_config where singleton and new_member_window_days=7 and new_member_floor_distinct_viewers=6) then
    raise exception 'Discovery configuration must be 7 days / 6 viewers';
  end if;
  if (select count(*) from public.questions where is_active and is_flagship) <> 1 then
    raise exception 'Expected exactly one active First Question';
  end if;
  if (select count(*) from public.questions where is_active and not is_flagship and current_position is not null) > 1 then
    raise exception 'More than one live Room Question';
  end if;
  if to_regclass('public.room_question_suggestions') is null
     or not (select relrowsecurity from pg_class where oid='public.room_question_suggestions'::regclass) then
    raise exception 'Suggestion table/RLS missing';
  end if;
  if has_table_privilege('authenticated','public.room_question_suggestions','SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('anon','public.room_question_suggestions','SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'Private suggestions directly accessible';
  end if;
end
$structural$;

do $behavior$
declare
  a uuid;
  b uuid;
  before_week bigint;
  before_total bigint;
  before_events bigint;
  accounted boolean;
  expected_week bigint;
  result jsonb;
  ids uuid[];
  rejected boolean;
begin
  select id into a from public.profiles order by id limit 1;
  select id into b from public.profiles where id<>a order by id limit 1;
  if a is null or b is null then raise exception 'Two existing profiles are needed for exposure isolation probes'; end if;
  select coalesce(total_times_served,0), last_accounting_week=date_trunc('week',now())::date
    into before_total,accounted from private.room_member_exposure where viewer_id=a and candidate_id=b;
  before_total := coalesce(before_total,0);
  select coalesce(distinct_viewers,0) into before_week from private.room_candidate_week_exposure
    where candidate_id=b and week_start=date_trunc('week',now())::date;
  before_week := coalesce(before_week,0);
  expected_week := before_week + case when coalesce(accounted,false) then 0 else 1 end;
  select count(*) into before_events from private.room_exposure_events where viewer_id=a and candidate_id=b;
  perform set_config('request.jwt.claims',json_build_object('sub',a,'role','service_role')::text,true);
  set local role service_role;
  perform public.record_room_exposures(a,array[b,b,a,null]::uuid[],'room');
  perform public.record_room_exposures(a,array[b]::uuid[],'home_room');
  reset role;
  if not exists(select 1 from private.room_candidate_week_exposure where candidate_id=b and week_start=date_trunc('week',now())::date and distinct_viewers=expected_week) then
    raise exception 'Refresh/duplicate IDs inflated weekly exposure';
  end if;
  if not exists(select 1 from private.room_member_exposure where viewer_id=a and candidate_id=b and total_times_served=before_total+2) then
    raise exception 'Serving totals did not increment exactly twice';
  end if;
  if (select count(*) from private.room_exposure_events where viewer_id=a and candidate_id=b)<>before_events+2 then
    raise exception 'Expected two private serving events';
  end if;
  perform set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated')::text,true);
  set local role authenticated;
  if exists(select 1 from public.room_discovery_rank_facts(b,array[a])) then raise exception 'Can read another viewer encounter history'; end if;
  rejected:=false;
  begin
    perform public.record_room_exposures(a,array[b],'room');
  exception when insufficient_privilege then rejected:=true;
  end;
  if not rejected then raise exception 'Member could call service-only recorder'; end if;
  result := public.discover_people_v2(p_limit=>6);
  if jsonb_array_length(result->'entries')>6 then raise exception 'Discovery exceeds its page bound'; end if;
  select array_agg((entry->>'user_id')::uuid) into ids from jsonb_array_elements(result->'entries') entry;
  reset role;
  if cardinality(ids)>0 then
    perform set_config('request.jwt.claims',json_build_object('sub',a,'role','service_role')::text,true);
    set local role service_role;
    perform public.record_room_exposures(a,ids,'room');
    reset role;
    perform set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated')::text,true);
    set local role authenticated;
    result := public.discover_people_v2(p_browse_started_at=>(result->>'browse_started_at')::timestamptz);
    if exists(select 1 from jsonb_array_elements(result->'entries') entry where (entry->>'user_id')::uuid=any(ids)) then
      raise exception 'Next browse page repeats a served person';
    end if;
    reset role;
  end if;
end
$behavior$;
rollback;
select 'ROOM_ENGAGEMENT_VERIFIED' as result,
  exists(select 1 from public.questions where is_active and not is_flagship and current_position is not null) as live_room_question_selected;
