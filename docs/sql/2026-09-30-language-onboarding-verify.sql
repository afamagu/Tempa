-- ============================================================
-- TEMPA — LANGUAGE-FIRST ONBOARDING VERIFICATION
-- STATUS: NOT EXECUTED.
-- Run AFTER docs/sql/2026-09-30-language-onboarding.sql.
-- All behavioural writes are rolled back.
-- ============================================================

begin;

do $$
declare
  v_fk_delete_action "char";
begin
  if to_regclass('public.member_language_preferences') is null then
    raise exception 'member_language_preferences is missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'member_language_preferences'
      and column_name = 'interface_locale'
  ) then
    raise exception 'interface_locale is missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'member_language_preferences'
      and column_name = 'language_confirmed_at'
  ) then
    raise exception 'language_confirmed_at is missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.member_language_preferences'::regclass) then
    raise exception 'member_language_preferences RLS is not enabled';
  end if;

  if has_table_privilege('anon', 'public.member_language_preferences', 'SELECT') then
    raise exception 'member_language_preferences is readable by anon';
  end if;

  if has_table_privilege('authenticated', 'public.member_language_preferences', 'INSERT')
     or has_table_privilege('authenticated', 'public.member_language_preferences', 'UPDATE')
     or has_table_privilege('authenticated', 'public.member_language_preferences', 'DELETE') then
    raise exception 'member_language_preferences is directly writable by authenticated';
  end if;

  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'member_language_preferences') <> 1 then
    raise exception 'unexpected policy count on member_language_preferences';
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

  if has_function_privilege('anon', 'public.set_my_tempa_language(text)', 'EXECUTE') then
    raise exception 'set_my_tempa_language is executable by anon';
  end if;

  if not has_function_privilege('authenticated', 'public.set_my_tempa_language(text)', 'EXECUTE') then
    raise exception 'set_my_tempa_language is not executable by authenticated';
  end if;

  if has_function_privilege('anon', 'public.set_my_reading_language(text)', 'EXECUTE') then
    raise exception 'set_my_reading_language is executable by anon';
  end if;

  if not exists (
    select 1 from pg_proc
    where oid = 'public.set_my_tempa_language(text)'::regprocedure
      and prosecdef
      and array_to_string(proconfig, ',') like '%search_path=pg_catalog%'
  ) then
    raise exception 'set_my_tempa_language must be SECURITY DEFINER with pinned search_path';
  end if;

  if not exists (
    select 1 from pg_proc
    where oid = 'public.set_my_reading_language(text)'::regprocedure
      and prosecdef
      and array_to_string(proconfig, ',') like '%search_path=pg_catalog%'
  ) then
    raise exception 'set_my_reading_language must be SECURITY DEFINER with pinned search_path';
  end if;

  -- Preference ownership follows auth.users so a choice can exist before
  -- profile creation, and still cascades when the auth identity is retired.
  select c.confdeltype into v_fk_delete_action
  from pg_constraint c
  where c.conname = 'member_language_preferences_user_id_fkey'
    and c.conrelid = 'public.member_language_preferences'::regclass
    and c.confrelid = 'auth.users'::regclass;

  if v_fk_delete_action is distinct from 'c' then
    raise exception 'language preference FK must reference auth.users ON DELETE CASCADE';
  end if;

  -- Tempa account closure deletes the profile before retiring auth.users;
  -- this trigger preserves the old cleanup behaviour at that boundary too.
  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.profiles'::regclass
      and t.tgname = 'profiles_delete_language_preference'
      and not t.tgisinternal
  ) then
    raise exception 'profile-delete language cleanup trigger is missing';
  end if;

  -- Private preference fields must not leak onto public identity tables/views.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in ('profiles', 'public_profiles')
      and column_name in ('interface_locale', 'reading_language', 'language_confirmed_at')
  ) then
    raise exception 'private language state leaked onto profile identity surface';
  end if;

  -- Every profile present at migration time should now be grandfathered.
  if exists (
    select 1
    from public.profiles p
    left join public.member_language_preferences mlp on mlp.user_id = p.id
    where mlp.language_confirmed_at is null
  ) then
    raise exception 'an existing profile was not grandfathered as language-confirmed';
  end if;
end;
$$;

-- Behavioural own-row check using two real members. Everything is rolled back.
do $$
declare
  v_a uuid;
  v_b uuid;
  v_a_old_reading text;
  v_seen int;
  v_rejected boolean := false;
begin
  select id into v_a from public.profiles order by id limit 1;
  select id into v_b from public.profiles where id <> v_a order by id limit 1;

  if v_a is null or v_b is null then
    raise notice 'fewer than two profiles; behavioural isolation check skipped';
    return;
  end if;

  select reading_language into v_a_old_reading
  from public.member_language_preferences
  where user_id = v_a;

  set local role authenticated;

  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  if public.set_my_tempa_language('fr') <> 'fr' then
    raise exception 'member A could not set Tempa language';
  end if;

  if not exists (
    select 1 from public.member_language_preferences
    where user_id = v_a
      and interface_locale = 'fr'
      and reading_language = 'fr'
      and language_confirmed_at is not null
  ) then
    raise exception 'first-language save did not atomically persist locale, reading language and confirmation';
  end if;

  begin
    perform public.set_my_tempa_language('ja');
  exception when sqlstate '22023' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'unsupported interface locale was accepted';
  end if;

  -- Translation language remains independently writable after confirmation.
  if public.set_my_reading_language('ja') <> 'ja' then
    raise exception 'member A could not set independent reading language';
  end if;
  if not exists (
    select 1 from public.member_language_preferences
    where user_id = v_a and interface_locale = 'fr' and reading_language = 'ja'
  ) then
    raise exception 'reading-language override incorrectly changed interface locale';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  select count(*) into v_seen
  from public.member_language_preferences
  where user_id = v_a;
  if v_seen <> 0 then
    raise exception 'member B can read member A language preferences';
  end if;

  -- There is intentionally no user-id parameter on either write RPC;
  -- with B's JWT active, a write can only affect B.
  perform public.set_my_tempa_language('es');
  if exists (
    select 1 from public.member_language_preferences
    where user_id = v_a and interface_locale = 'es'
  ) then
    raise exception 'member B altered member A language preferences';
  end if;

  reset role;
end;
$$;

rollback;

-- Expected: no exception (possibly the two-profile skip notice), then ROLLBACK.
