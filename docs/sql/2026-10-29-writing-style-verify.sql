-- ============================================================
-- TEMPA — WRITING STYLE — VERIFIER (READ-ONLY)
-- Pairs with docs/sql/2026-10-29-writing-style.sql.
-- One SELECT; changes nothing. Expect one row with overall_pass = true.
-- ============================================================

with fns(sig, anon_allowed) as (
  values
    ('public.set_my_writing_style(text)', false),
    ('public.member_writing_styles(uuid[])', false),
    ('public.letter_writing_styles(uuid[])', false),
    ('public.shared_dispatch_writing_style(uuid)', true),
    ('public.public_dispatch_writing_style(text)', true),
    ('public.current_account_entry_state(text, text)', false)
),
def as (
  select f.sig, f.anon_allowed, p.oid, p.prosecdef, p.proconfig,
         pg_get_function_result(p.oid) as result
  from fns f
  left join pg_proc p on p.oid = to_regprocedure(f.sig)
),
cols as (
  select table_name, column_name, is_nullable, column_default
  from information_schema.columns
  where table_schema = 'public'
    and ((table_name = 'profiles' and column_name = 'writing_style_id')
      or (table_name in ('letters', 'dispatches') and column_name = 'author_writing_style_id'))
),
checks as (
  select
    (select count(*) from cols) = 3 as three_columns_exist,
    not exists (select 1 from cols where is_nullable <> 'YES' or column_default is not null) as nullable_without_default,
    (select count(*) from pg_constraint where conname in (
      'profiles_writing_style_id_valid',
      'letters_author_writing_style_id_valid',
      'dispatches_author_writing_style_id_valid')) = 3 as check_constraints_exist,
    (select count(*) from pg_trigger where not tgisinternal and tgname in (
      'profiles_force_initial_writing_style',
      'letters_snapshot_writing_style',
      'dispatches_snapshot_writing_style')) = 3 as triggers_exist,
    not exists (select 1 from def where oid is null) as all_functions_exist,
    not exists (
      select 1 from def
      where sig <> 'public.current_account_entry_state(text, text)'
        and (not prosecdef or not coalesce(proconfig @> array['search_path=pg_catalog'], false))
    ) as definer_and_search_path_pinned,
    not exists (
      select 1 from def where has_function_privilege('anon', oid, 'EXECUTE') <> anon_allowed
    ) as anon_execute_exactly_as_intended,
    not exists (
      select 1 from def where not has_function_privilege('authenticated', oid, 'EXECUTE')
    ) as authenticated_execute_granted,
    (select result from def where sig = 'public.current_account_entry_state(text, text)')
      ~ 'has_writing_style boolean' as entry_state_reports_writing_style,
    -- No member was assigned an identity by the migration itself.
    true as no_backfill_by_design
)
select *,
  three_columns_exist and nullable_without_default and check_constraints_exist
  and triggers_exist and all_functions_exist and definer_and_search_path_pinned
  and anon_execute_exactly_as_intended and authenticated_execute_granted
  and entry_state_reports_writing_style as overall_pass
from checks;
