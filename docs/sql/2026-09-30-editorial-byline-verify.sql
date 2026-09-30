-- TEMPA — EDITORIAL BYLINE: verifier for 2026-09-30-editorial-byline.sql
-- Run in the Supabase SQL editor AFTER the migration. Leaves NO changes:
-- every write probe runs inside its own sub-block that is rolled back
-- before the next check, and results go to a session temp table.
--
-- Expected: one row per check, every `pass` = true, and a final
-- "OVERALL" row with pass = true. `detail` shows what actually happened.
--
-- The member probes impersonate an ordinary member exactly the way
-- PostgREST does (request.jwt.claims with role 'authenticated' and the
-- member's id as sub), in two ways:
--   * "direct" — also SET ROLE authenticated, i.e. a member hitting the
--     table from the browser with their own session;
--   * "inside an RPC" — JWT is the member's but the statement runs as the
--     table owner, i.e. any SECURITY DEFINER member function that updates
--     profiles. This is the case table privileges alone cannot stop.

drop table if exists pg_temp.editorial_verify;
create temp table editorial_verify (n int, check_name text, pass boolean, detail text);

do $verify$
declare
  v_member uuid;
  v_larkspur uuid;
  v_state text;
  v_rows integer;
  v_member_claims text;
begin
  select id into v_larkspur
  from public.profiles
  where pseudonym_key = public.canonicalize_pseudonym('Lady Larkspur');

  select id into v_member
  from public.profiles
  where not is_editorial
  order by id
  limit 1;

  if v_member is null then
    raise exception 'No ordinary member profile exists to probe with.';
  end if;
  v_member_claims := json_build_object('sub', v_member, 'role', 'authenticated')::text;

  -- ---------- static shape ----------
  insert into editorial_verify
  select 1, 'Columns: is_editorial boolean NOT NULL DEFAULT false; editorial_title text NULL',
    count(*) = 2,
    string_agg(format('%s %s nullable=%s default=%s', column_name, data_type, is_nullable, coalesce(column_default, 'none')), '; ')
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles'
    and ((column_name = 'is_editorial' and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false')
      or (column_name = 'editorial_title' and data_type = 'text' and is_nullable = 'YES'));

  insert into editorial_verify
  select 2, 'Triggers present and enabled (insert force + update guard)',
    count(*) = 2,
    string_agg(tgname || ' enabled=' || tgenabled::text, '; ')
  from pg_trigger
  where tgrelid = 'public.profiles'::regclass and not tgisinternal and tgenabled <> 'D'
    and ((tgname = 'profiles_force_initial_editorial'
          and tgfoid = 'tempa_private.force_initial_profile_editorial()'::regprocedure)
      or (tgname = 'profiles_editorial_guard'
          and tgfoid = 'tempa_private.guard_profile_editorial()'::regprocedure));

  insert into editorial_verify
  select 3, 'Exactly one editorial account: Lady Larkspur, "Tempa House Columnist"',
    count(*) = 1 and bool_and(id = v_larkspur and editorial_title = 'Tempa House Columnist'),
    coalesce(string_agg(pseudonym || ' / ' || editorial_title, '; '), 'none')
  from public.profiles
  where is_editorial;

  insert into editorial_verify
  select 4, 'editorial_bylines() returns exactly ladylarkspur',
    count(*) = 1 and bool_and(b.pseudonym_key = 'ladylarkspur' and b.editorial_title = 'Tempa House Columnist'),
    coalesce(string_agg(b.pseudonym_key || ' / ' || b.editorial_title, '; '), 'none')
  from public.editorial_bylines() b;

  insert into editorial_verify
  select 5, 'editorial_bylines() executable by anon + authenticated',
    has_function_privilege('anon', 'public.editorial_bylines()', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.editorial_bylines()', 'EXECUTE'),
    format('anon=%s authenticated=%s',
      has_function_privilege('anon', 'public.editorial_bylines()', 'EXECUTE'),
      has_function_privilege('authenticated', 'public.editorial_bylines()', 'EXECUTE'));

  -- ---------- member probes ----------

  -- 6. Direct: member's own session tries to make their own account editorial.
  v_state := null;
  begin
    perform set_config('request.jwt.claims', v_member_claims, true);
    execute 'set local role authenticated';
    update public.profiles
    set is_editorial = true, editorial_title = 'Forged'
    where id = v_member;
    get diagnostics v_rows = row_count;
    v_state := 'rows updated=' || v_rows;
    raise exception using errcode = 'P0099', message = 'probe rollback';
  exception
    when sqlstate 'P0099' then null;
    when others then v_state := sqlstate || ': ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  insert into editorial_verify values (6,
    'Member, direct: cannot set is_editorial on OWN account',
    v_state like '42501:%' or v_state = 'rows updated=0', v_state);

  -- 7. Inside an RPC: member JWT, owner privileges, own account.
  v_state := null;
  begin
    perform set_config('request.jwt.claims', v_member_claims, true);
    update public.profiles
    set is_editorial = true, editorial_title = 'Forged'
    where id = v_member;
    v_state := 'ALLOWED';
    raise exception using errcode = 'P0099', message = 'probe rollback';
  exception
    when sqlstate 'P0099' then null;
    when others then v_state := sqlstate || ': ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into editorial_verify values (7,
    'Member, inside an RPC: cannot set is_editorial on OWN account',
    v_state like '42501:%Editorial status can only be set by Tempa%', v_state);

  -- 8. Inside an RPC: member tries to strip Lady Larkspur's label.
  v_state := null;
  begin
    perform set_config('request.jwt.claims', v_member_claims, true);
    update public.profiles
    set is_editorial = false, editorial_title = null
    where id = v_larkspur;
    v_state := 'ALLOWED';
    raise exception using errcode = 'P0099', message = 'probe rollback';
  exception
    when sqlstate 'P0099' then null;
    when others then v_state := sqlstate || ': ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into editorial_verify values (8,
    'Member, inside an RPC: cannot change ANOTHER account (Lady Larkspur)',
    v_state like '42501:%Editorial status can only be set by Tempa%', v_state);

  -- 9. Insert: whatever a new profile row supplies, it starts non-editorial.
  --    Exercised on a scratch table carrying the SAME trigger function
  --    (a real profile insert needs a fresh auth.users row); check 2
  --    proves that function is the one wired to public.profiles.
  v_state := null;
  begin
    execute 'create temp table editorial_insert_probe (is_editorial boolean, editorial_title text)';
    execute 'create trigger editorial_insert_probe_force before insert on editorial_insert_probe
             for each row execute function tempa_private.force_initial_profile_editorial()';
    execute 'insert into editorial_insert_probe values (true, ''Forged'')';
    execute 'select format(''%s/%s'', is_editorial::text, coalesce(editorial_title, ''null'')) from editorial_insert_probe'
      into v_state;
    raise exception using errcode = 'P0099', message = 'probe rollback';
  exception
    when sqlstate 'P0099' then null;
    when others then v_state := sqlstate || ': ' || sqlerrm;
  end;
  insert into editorial_verify values (9,
    'Insert with is_editorial = true is stored as false/null',
    v_state = 'false/null', v_state);

  -- ---------- privileged paths still work ----------

  -- 10. Service role.
  v_state := null;
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    update public.profiles
    set is_editorial = true, editorial_title = 'Probe'
    where id = v_member;
    v_state := 'ALLOWED';
    raise exception using errcode = 'P0099', message = 'probe rollback';
  exception
    when sqlstate 'P0099' then null;
    when others then v_state := sqlstate || ': ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into editorial_verify values (10, 'Service role CAN set it', v_state = 'ALLOWED', v_state);

  -- 11. SQL editor / no JWT, plus the both-or-neither shape rule.
  v_state := null;
  begin
    update public.profiles
    set is_editorial = true, editorial_title = null
    where id = v_member;
    v_state := 'ALLOWED';
    raise exception using errcode = 'P0099', message = 'probe rollback';
  exception
    when sqlstate 'P0099' then null;
    when others then v_state := sqlstate || ': ' || sqlerrm;
  end;
  insert into editorial_verify values (11,
    'Shape rule: is_editorial without a title is rejected',
    v_state like '23514:%', v_state);

  -- 12. Nothing above persisted.
  insert into editorial_verify
  select 12, 'Probe member left unchanged',
    not is_editorial and editorial_title is null,
    format('%s/%s', is_editorial::text, coalesce(editorial_title, 'null'))
  from public.profiles where id = v_member;
end
$verify$;

select n, check_name, pass, detail from editorial_verify
union all
select 99, 'OVERALL', bool_and(pass) and count(*) = 12, count(*) || ' checks'
from editorial_verify
order by n;
