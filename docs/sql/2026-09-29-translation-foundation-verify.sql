-- ============================================================
-- TEMPA — TRANSLATION FOUNDATION VERIFICATION
-- READ-ONLY RESULT: this script rolls back its one test reservation.
-- Run AFTER docs/sql/2026-09-29-translation-foundation.sql.
-- ============================================================

begin;

do $$
declare
  v_allowed boolean;
  v_reserved bigint;
begin
  if to_regclass('public.translation_cache') is null then
    raise exception 'translation_cache is missing';
  end if;
  if to_regclass('public.translation_usage_monthly') is null then
    raise exception 'translation_usage_monthly is missing';
  end if;

  if not (
    select relrowsecurity
      from pg_class
     where oid = 'public.translation_cache'::regclass
  ) then
    raise exception 'translation_cache RLS is not enabled';
  end if;

  if not (
    select relrowsecurity
      from pg_class
     where oid = 'public.translation_usage_monthly'::regclass
  ) then
    raise exception 'translation_usage_monthly RLS is not enabled';
  end if;

  if has_table_privilege('anon', 'public.translation_cache', 'SELECT')
     or has_table_privilege('authenticated', 'public.translation_cache', 'SELECT') then
    raise exception 'translation_cache is readable by a client role';
  end if;

  if has_table_privilege('anon', 'public.translation_cache', 'INSERT')
     or has_table_privilege('authenticated', 'public.translation_cache', 'INSERT') then
    raise exception 'translation_cache is writable by a client role';
  end if;

  if has_table_privilege('anon', 'public.translation_usage_monthly', 'SELECT')
     or has_table_privilege('authenticated', 'public.translation_usage_monthly', 'SELECT') then
    raise exception 'translation_usage_monthly is readable by a client role';
  end if;

  if has_function_privilege(
       'anon',
       'public.reserve_translation_characters(integer,bigint)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.reserve_translation_characters(integer,bigint)',
       'EXECUTE'
     ) then
    raise exception 'translation quota RPC is executable by a client role';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.reserve_translation_characters(integer,bigint)',
    'EXECUTE'
  ) then
    raise exception 'service_role cannot execute translation quota RPC';
  end if;

  -- Exercise the lock/reservation path with an enormous temporary ceiling.
  -- ROLLBACK below removes this one-character reservation completely.
  select r.allowed, r.reserved_total
    into v_allowed, v_reserved
    from public.reserve_translation_characters(1, 9000000000000000000) r;

  if not v_allowed or v_reserved is null or v_reserved < 1 then
    raise exception 'translation quota reservation did not succeed';
  end if;
end;
$$;

rollback;

-- Expected: no exception, then ROLLBACK.
