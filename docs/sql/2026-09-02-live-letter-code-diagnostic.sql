-- Tempa — live-database introspection: what code Supabase is ACTUALLY
-- running for letter creation, right now.
-- READ-ONLY. Pure catalog inspection (pg_get_functiondef,
-- pg_get_triggerdef, pg_get_viewdef against pg_proc / pg_trigger /
-- pg_class) — no CREATE/ALTER/DROP/INSERT/UPDATE/DELETE, and it never
-- touches public.letters or any other data table, only system catalogs.
--
-- Purpose: confirm or disprove that the LIVE functions match what's
-- checked into docs/sql/*.sql. Every file in this directory is marked
-- "PREPARED / NOT EXECUTED" until manually run in the Supabase SQL
-- editor — there is no guarantee every file was applied, applied in
-- the order these filenames suggest, or that nothing was ever changed
-- directly against the live database outside of these files. This
-- answers that directly from pg_catalog, not from the repo.

with functions as (
  select
    'function' as section,
    jsonb_build_object(
      'name', p.proname,
      'arguments', pg_get_function_identity_arguments(p.oid),
      'definition', pg_get_functiondef(p.oid)
    ) as detail
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('send_first_letter', 'reply_to_letter')
),
triggers as (
  select
    'trigger' as section,
    jsonb_build_object(
      'trigger_name', t.tgname,
      'table', c.relname,
      'definition', pg_get_triggerdef(t.oid)
    ) as detail
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'letters'
    and not t.tgisinternal
),
views as (
  select
    'view' as section,
    jsonb_build_object(
      'name', c.relname,
      'definition', pg_get_viewdef(c.oid, true)
    ) as detail
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'letters_for_participant'
    and c.relkind in ('v', 'm')
)
select section, detail from functions
union all
select section, detail from triggers
union all
select section, detail from views
order by section;
