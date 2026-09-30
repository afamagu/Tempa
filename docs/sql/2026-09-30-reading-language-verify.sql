-- ============================================================
-- TEMPA — READING LANGUAGE VERIFICATION
-- STATUS: NOT EXECUTED.
-- READ-ONLY RESULT: every write below happens inside a transaction that
-- ends with ROLLBACK. Run AFTER docs/sql/2026-09-30-reading-language.sql.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.member_language_preferences') is null then
    raise exception 'member_language_preferences is missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.member_language_preferences'::regclass) then
    raise exception 'member_language_preferences RLS is not enabled';
  end if;

  if has_table_privilege('anon', 'public.member_language_preferences', 'SELECT') then
    raise exception 'member_language_preferences is readable by anon';
  end if;

  if has_table_privilege('authenticated', 'public.member_language_preferences', 'INSERT')
     or has_table_privilege('authenticated', 'public.member_language_preferences', 'UPDATE')
     or has_table_privilege('authenticated', 'public.member_language_preferences', 'DELETE')
     or has_table_privilege('anon', 'public.member_language_preferences', 'INSERT') then
    raise exception 'member_language_preferences is directly writable by a client role';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'member_language_preferences'
       and policyname = 'member_language_preferences_select_own'
       and cmd = 'SELECT'
  ) then
    raise exception 'own-row SELECT policy is missing';
  end if;

  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'member_language_preferences') <> 1 then
    raise exception 'unexpected extra policy on member_language_preferences';
  end if;

  if has_function_privilege('anon', 'public.set_my_reading_language(text)', 'EXECUTE') then
    raise exception 'set_my_reading_language is executable by anon';
  end if;

  if not has_function_privilege('authenticated', 'public.set_my_reading_language(text)', 'EXECUTE') then
    raise exception 'set_my_reading_language is not executable by authenticated';
  end if;

  if not exists (
    select 1 from pg_proc
     where oid = 'public.set_my_reading_language(text)'::regprocedure
       and prosecdef
       and array_to_string(proconfig, ',') like '%search_path=pg_catalog%'
  ) then
    raise exception 'set_my_reading_language must be SECURITY DEFINER with a pinned search_path';
  end if;

  -- Never part of the public identity surface.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name in ('profiles', 'public_profiles')
       and column_name ilike '%reading%language%'
  ) then
    raise exception 'reading language leaked onto profiles/public_profiles';
  end if;
end;
$$;

-- Behavioural check: two real members, each acting as themselves.
-- Skipped (with a notice) when fewer than two profiles exist.
do $$
declare
  v_a uuid;
  v_b uuid;
  v_seen int;
  v_rejected boolean := false;
begin
  select id into v_a from public.profiles order by id limit 1;
  select id into v_b from public.profiles where id <> v_a order by id limit 1;
  if v_a is null or v_b is null then
    raise notice 'fewer than two profiles; behavioural check skipped';
    return;
  end if;

  set local role authenticated;

  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  if public.set_my_reading_language('fr') <> 'fr' then
    raise exception 'member A could not save their reading language';
  end if;

  select count(*) into v_seen from public.member_language_preferences where user_id = v_a;
  if v_seen <> 1 then
    raise exception 'member A cannot read their own reading language';
  end if;

  begin
    perform public.set_my_reading_language('<script>');
  exception when others then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'a malformed language code was accepted';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  select count(*) into v_seen from public.member_language_preferences where user_id = v_a;
  if v_seen <> 0 then
    raise exception 'member B can read member A''s reading language';
  end if;

  perform public.set_my_reading_language('ja');
  select count(*) into v_seen from public.member_language_preferences;
  if v_seen <> 1 then
    raise exception 'member B sees rows other than their own';
  end if;

  reset role;

  if (select reading_language from public.member_language_preferences where user_id = v_a) <> 'fr' then
    raise exception 'member B''s write changed member A''s reading language';
  end if;
end;
$$;

rollback;

-- Expected: no exception (at most the "behavioural check skipped" notice), then ROLLBACK.
