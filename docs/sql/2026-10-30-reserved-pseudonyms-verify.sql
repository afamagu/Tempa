-- Run after 2026-10-30-reserved-pseudonyms.sql. All probes roll back.
-- Scratch INSERTs exercise the SAME trigger functions without creating auth
-- users. Static checks also confirm the guard is attached to real profiles.
begin;
create temp table reserved_verify(n integer, check_name text, pass boolean) on commit drop;
create temp table reserved_profile_probe(pseudonym text, is_editorial boolean default false, editorial_title text) on commit drop;
create trigger force_editorial before insert on reserved_profile_probe
for each row execute function tempa_private.force_initial_profile_editorial();
create trigger reserved_guard before insert or update on reserved_profile_probe
for each row execute function tempa_private.guard_reserved_pseudonym();

do $verify$
declare
  candidate text;
  n integer := 0;
  blocked boolean;
  claims text := coalesce(current_setting('request.jwt.claims', true), '');
begin
  insert into reserved_verify values (1, 'Real profiles guard attached and enabled', exists (
    select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass
    and tgname = 'profiles_reserved_pseudonym_guard' and tgenabled <> 'D'
    and tgfoid = 'tempa_private.guard_reserved_pseudonym()'::regprocedure));
  insert into reserved_verify values (2, 'Guard is SECURITY DEFINER with pinned path', exists (
    select 1 from pg_proc where oid = 'tempa_private.guard_reserved_pseudonym()'::regprocedure
    and prosecdef and array_to_string(proconfig, ',') like '%search_path=pg_catalog%'));
  insert into reserved_verify values (3, 'No direct member/anon execution of trigger',
    not has_function_privilege('authenticated', 'tempa_private.guard_reserved_pseudonym()', 'EXECUTE')
    and not has_function_privilege('anon', 'tempa_private.guard_reserved_pseudonym()', 'EXECUTE'));
  insert into reserved_verify values (4, 'Ordinary member names comply', not exists (
    select 1 from public.profiles where not is_editorial and public.is_reserved_pseudonym(pseudonym)));
  insert into reserved_verify values (5, 'Existing Lady Larkspur house identity preserved', (
    select count(*) = 1 and bool_and(is_editorial and editorial_title = 'Tempa House Columnist')
    from public.profiles where pseudonym_key = public.canonicalize_pseudonym('Lady Larkspur')));
  n := 5;
  foreach candidate in array array['Tempa', 'TEMPA', 'Tempa Support', 'T e m p a',
    'Lady Larkspur', 'lady-larkspur', ' Lady Larkspurr ', 'Lady Larkspur99'] loop
    n := n + 1;
    insert into reserved_verify values (n, 'Reserved: ' || candidate, public.is_reserved_pseudonym(candidate));
  end loop;
  foreach candidate in array array['Evening Quill', 'Larkspur', 'Temperance'] loop
    n := n + 1;
    insert into reserved_verify values (n, 'Allowed: ' || candidate, not public.is_reserved_pseudonym(candidate));
  end loop;
  insert into reserved_verify values (17, 'Availability refuses reserved variant', not public.is_pseudonym_available('Lady Larkspurr'));
  insert into reserved_verify values (18, 'Suggestions never extend a reserved identity', cardinality(public.suggest_available_pseudonyms('Tempa')) = 0);
  insert into reserved_verify values (19, 'Ordinary suggestions remain usable', cardinality(public.suggest_available_pseudonyms('Quiet River')) > 0);

  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  blocked := false;
  begin
    insert into reserved_profile_probe(pseudonym) values ('Lady Larkspurr');
  exception when check_violation then blocked := sqlerrm = 'That name is reserved.'; end;
  insert into reserved_verify values (20, 'Member INSERT blocked with recognizable message', blocked);
  blocked := false;
  begin
    insert into reserved_profile_probe values ('Tempa Support', true, 'Tempa House Columnist');
  exception when check_violation then blocked := sqlerrm = 'That name is reserved.'; end;
  insert into reserved_verify values (21, 'Spoofed editorial INSERT blocked', blocked);
  insert into reserved_profile_probe(pseudonym) values ('Quiet River');
  insert into reserved_verify values (22, 'Ordinary INSERT works', exists(select 1 from reserved_profile_probe where pseudonym = 'Quiet River' and not is_editorial));
  blocked := false;
  begin
    update reserved_profile_probe set pseudonym = 'Tempa' where pseudonym = 'Quiet River';
  exception when check_violation then blocked := true; end;
  insert into reserved_verify values (23, 'Member UPDATE blocked even as function owner with member JWT', blocked);

  perform set_config('request.jwt.claims', '', true);
  blocked := false;
  begin
    insert into reserved_profile_probe(pseudonym) values ('Tempa');
  exception when check_violation then blocked := true; end;
  insert into reserved_verify values (24, 'Direct-session reserved ordinary INSERT also blocked', blocked);
  update reserved_profile_probe set is_editorial = true, editorial_title = 'Tempa House Columnist', pseudonym = 'Lady Larkspur2' where pseudonym = 'Quiet River';
  insert into reserved_verify values (25, 'Privileged designation and reserved house rename works', exists(select 1 from reserved_profile_probe where pseudonym = 'Lady Larkspur2' and is_editorial));
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  update reserved_profile_probe set editorial_title = 'Tempa House Columnist' where pseudonym = 'Lady Larkspur2';
  insert into reserved_verify values (26, 'Unrelated update preserves existing house pseudonym', exists(select 1 from reserved_profile_probe where pseudonym = 'Lady Larkspur2'));
  blocked := false;
  begin
    update reserved_profile_probe set pseudonym = 'Lady Larkspur3' where pseudonym = 'Lady Larkspur2';
  exception when check_violation then blocked := true; end;
  insert into reserved_verify values (27, 'Member cannot rename a house identity', blocked);
  perform set_config('request.jwt.claims', claims, true);
end
$verify$;
select n, check_name, pass from reserved_verify
union all select 999, 'OVERALL', bool_and(pass) from reserved_verify order by n;
rollback;
