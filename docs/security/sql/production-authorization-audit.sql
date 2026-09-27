-- ============================================================
-- TEMPA — PRODUCTION AUTHORIZATION AUDIT (READ-ONLY)
-- Pre-beta security workstream, Phase 13.
--
-- Run in the Supabase SQL editor against PRODUCTION. Every statement is a
-- SELECT over system catalogs — it reads no member content and changes
-- nothing. Run each block separately and export the results; they replace
-- the migration-derived assumptions in docs/security/RLS-AUTHORIZATION-
-- MATRIX.md with the real production state.
--
-- Why: several core tables (profiles, questions, …) predate docs/sql, and
-- production already differs from the migration files (e.g. anon cannot
-- execute is_pseudonym_available, which no migration revokes). Migration
-- files are therefore not proof of production authorization.
-- ============================================================

-- A. Every public table: RLS on? forced? which client privileges?
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
  has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE') as anon_write,
  has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select,
  has_table_privilege('authenticated', c.oid, 'INSERT') as auth_insert,
  has_table_privilege('authenticated', c.oid, 'UPDATE') as auth_update,
  has_table_privilege('authenticated', c.oid, 'DELETE') as auth_delete,
  has_table_privilege('authenticated', c.oid, 'TRUNCATE') as auth_truncate,
  (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
order by (not c.relrowsecurity) desc, auth_update desc, auth_insert desc, c.relname;

-- B. Every policy (who, which command, the actual expressions)
select tablename, policyname, cmd, roles, permissive, qual, with_check
from pg_policies
where schemaname in ('public', 'storage')
order by schemaname, tablename, cmd, policyname;

-- C. PRIORITY: tables where members hold a WRITE privilege — each needs a
--    policy that constrains exactly which rows/columns they may write.
select c.relname, p.policyname, p.cmd, p.qual, p.with_check
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
where n.nspname = 'public' and c.relkind = 'r'
  and (has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE')
       or has_table_privilege('authenticated', c.oid, 'DELETE'))
order by c.relname, p.cmd;

-- D. PRIORITY: functions executable by anon or authenticated, with
--    SECURITY DEFINER / search_path. Service-only functions (e.g.
--    record_safety_evaluation, check_rate_limit, the arrival-email
--    functions) must show authenticated_can_execute = false.
select
  p.oid::regprocedure as function,
  p.prosecdef as security_definer,
  coalesce(array_to_string(p.proconfig, ','), '') as config,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'tempa_private')
  and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
order by anon_can_execute desc, p.prosecdef desc, 1;

-- E. PRIORITY spot-check: the service-only functions by name.
select p.oid::regprocedure as function,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('record_safety_evaluation', 'check_rate_limit', 'resolve_arrival_email_context',
                    'record_or_fetch_arrival_email_snapshot', 'complete_arrival_email_job', 'claim_arrival_email_jobs',
                    'cleanup_expired_safety_evaluations', 'compute_deliver_at')
order by 1;

-- F. SECURITY DEFINER functions WITHOUT a pinned search_path (hijack risk).
select p.oid::regprocedure as function
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'tempa_private') and p.prosecdef
  and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
order by 1;

-- G. Views: are they security_invoker or security_barrier? who can read?
select c.relname as view_name,
       coalesce((select option_value from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), 'false') as security_invoker,
       coalesce((select option_value from pg_options_to_table(c.reloptions) where option_name = 'security_barrier'), 'false') as security_barrier,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
       has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('v', 'm')
order by 1;

-- H. Storage buckets (public flag, size and MIME limits).
select id, public, file_size_limit, allowed_mime_types, created_at
from storage.buckets order by id;

-- I. Profiles specifically (created outside docs/sql): privileges + policies.
select has_table_privilege('authenticated', 'public.profiles', 'INSERT') as can_insert,
       has_table_privilege('authenticated', 'public.profiles', 'UPDATE') as can_update,
       has_table_privilege('authenticated', 'public.profiles', 'DELETE') as can_delete,
       (select json_agg(json_build_object('policy', policyname, 'cmd', cmd, 'qual', qual, 'check', with_check))
          from pg_policies where schemaname = 'public' and tablename = 'profiles') as policies,
       (select json_agg(column_name order by column_name) from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'profiles' and grantee = 'authenticated' and privilege_type = 'UPDATE') as updatable_columns;

-- J. Default privileges that would auto-grant future objects to clients.
select pg_get_userbyid(d.defaclrole) as owner, n.nspname as schema, d.defaclobjtype as object_type, d.defaclacl
from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
order by 1, 2, 3;
