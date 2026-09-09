-- ============================================================
-- TEMPA — SAFETY & TRUST, CHECKPOINT 1B: READ-ONLY VERIFICATION
-- Run AFTER 2026-09-11-safety-blocking-foundation.sql has been applied.
-- Every statement below is a SELECT/has_*_privilege check — no
-- mutation of any kind.
-- ============================================================

-- ============================================================
-- SUMMARY — one row, PASS/FAIL per critical security property.
-- Run this first. Detailed diagnostic queries follow below for
-- anything that reads FAIL.
-- ============================================================
with
blocked_users_check as (
  select
    (select relrowsecurity from pg_class where oid = 'public.blocked_users'::regclass) as rls_on,
    (select count(*) from pg_policies where schemaname='public' and tablename='blocked_users') as policy_count,
    (select count(*) from information_schema.role_table_grants
       where table_schema='public' and table_name='blocked_users' and grantee='anon') as anon_grant_count,
    (select array_agg(distinct privilege_type) from information_schema.role_table_grants
       where table_schema='public' and table_name='blocked_users' and grantee='authenticated') as authenticated_privs
),
tempa_private_check as (
  select count(*) as grant_count
  from information_schema.role_routine_grants
  where routine_schema = 'tempa_private'
),
is_blocked_pair_check as (
  select
    has_function_privilege('anon', 'tempa_private.is_blocked_pair(uuid, uuid)', 'EXECUTE') as anon_exec,
    has_function_privilege('authenticated', 'tempa_private.is_blocked_pair(uuid, uuid)', 'EXECUTE') as authenticated_exec,
    p.prosecdef as is_definer,
    coalesce((select string_agg(cfg,',') from unnest(p.proconfig) as cfg where cfg like 'search_path=%'), '') as search_path_setting
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'tempa_private' and p.proname = 'is_blocked_pair'
),
account_state_check as (
  select
    (select relrowsecurity from pg_class where oid = 'public.account_enforcement_state'::regclass) as rls_on,
    (select count(*) from pg_policies where schemaname='public' and tablename='account_enforcement_state') as policy_count,
    (select count(*) from information_schema.role_table_grants
       where table_schema='public' and table_name='account_enforcement_state' and grantee='anon') as anon_grant_count,
    (select array_agg(distinct privilege_type) from information_schema.role_table_grants
       where table_schema='public' and table_name='account_enforcement_state' and grantee='authenticated') as authenticated_privs
),
public_profiles_check as (
  select
    (select count(*) from information_schema.role_table_grants
       where table_schema='public' and table_name='public_profiles' and grantee='anon') as anon_grant_count,
    (select array_agg(distinct privilege_type) from information_schema.role_table_grants
       where table_schema='public' and table_name='public_profiles' and grantee='authenticated') as authenticated_privs,
    (select pg_get_viewdef('public.public_profiles'::regclass, true) ilike '%is_blocked_pair%') as view_is_block_aware
),
dispatches_check as (
  select qual ilike '%is_blocked_pair%' as policy_is_block_aware
  from pg_policies
  where schemaname='public' and tablename='dispatches' and policyname='dispatches_select_published'
),
question_answers_check as (
  select
    qual ilike '%is_blocked_pair%' as policy_is_block_aware,
    qual ilike '%is_active%' as policy_still_checks_active
  from pg_policies
  where schemaname='public' and tablename='question_answers'
    and policyname = 'Answers to active questions are readable by authenticated users'
),
recommendations_check as (
  select
    p.prosecdef as is_definer,
    pg_get_functiondef(p.oid) ilike '%is_blocked_pair%' as body_is_block_aware,
    has_function_privilege('authenticated', 'public.get_post_closure_recommendations(uuid)', 'EXECUTE') as authenticated_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='get_post_closure_recommendations'
),
kept_minds_check as (
  select array_agg(distinct privilege_type) as authenticated_privs
  from information_schema.role_table_grants
  where table_schema='public' and table_name='kept_minds' and grantee='authenticated'
),
staff_roles_check as (
  select
    (select relrowsecurity from pg_class where oid = 'public.staff_roles'::regclass) as rls_on,
    (select count(*) from pg_policies where schemaname='public' and tablename='staff_roles') as policy_count,
    (select count(*) from information_schema.role_table_grants
       where table_schema='public' and table_name='staff_roles' and grantee='anon') as anon_grant_count,
    (select array_agg(distinct privilege_type) from information_schema.role_table_grants
       where table_schema='public' and table_name='staff_roles' and grantee='authenticated') as authenticated_privs,
    has_function_privilege('anon', 'public.is_staff(text)', 'EXECUTE') as anon_can_call_is_staff,
    has_function_privilege('authenticated', 'public.is_staff(text)', 'EXECUTE') as authenticated_can_call_is_staff
),
admin_audit_log_check as (
  select
    (select relrowsecurity from pg_class where oid = 'public.admin_audit_log'::regclass) as rls_on,
    (select count(*) from pg_policies where schemaname='public' and tablename='admin_audit_log') as policy_count,
    (select count(*) from information_schema.role_table_grants
       where table_schema='public' and table_name='admin_audit_log' and grantee in ('anon','authenticated')) as client_grant_count
),
privilege_hardening_check as (
  select
    (select count(*) from information_schema.role_table_grants
       where table_schema='public' and table_name in ('profiles','question_answers') and grantee='anon') as anon_grants_on_profiles_qa,
    (select count(*) from information_schema.role_table_grants
       where table_schema='public' and table_name in ('profiles','question_answers') and grantee='authenticated'
         and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES','DELETE')) as dangerous_authenticated_privs
),
new_tables_privilege_check as (
  -- No new-table (blocked_users, account_enforcement_state, staff_roles,
  -- admin_audit_log) should grant TRUNCATE/TRIGGER/REFERENCES/INSERT/
  -- UPDATE/DELETE to anon or authenticated — the explicit `revoke all`
  -- + narrow re-grant pattern each table's own section uses should have
  -- neutralized Supabase's broad default privileges entirely.
  select count(*) as unexpected_priv_count
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('blocked_users','account_enforcement_state','staff_roles','admin_audit_log')
    and grantee in ('anon','authenticated')
    and not (grantee = 'authenticated' and privilege_type = 'SELECT'
             and table_name in ('blocked_users','account_enforcement_state','staff_roles'))
)
select
  case when (select rls_on from blocked_users_check) then '[OK]' else '[FAIL]' end as blocked_users_rls_enabled,
  case when (select policy_count from blocked_users_check) = 1 then '[OK]' else '[FAIL]' end as blocked_users_exactly_one_policy,
  case when (select anon_grant_count from blocked_users_check) = 0 then '[OK]' else '[FAIL]' end as blocked_users_anon_zero_grants,
  case when (select authenticated_privs from blocked_users_check) = array['SELECT'] then '[OK]' else '[FAIL]' end as blocked_users_authenticated_select_only,

  case when (select grant_count from tempa_private_check) = 0 then '[OK]' else '[FAIL]' end as tempa_private_zero_client_grants,
  case when (select not anon_exec and not authenticated_exec from is_blocked_pair_check) then '[OK]' else '[FAIL]' end as is_blocked_pair_unreachable_by_clients,
  case when (select is_definer from is_blocked_pair_check) then '[OK]' else '[FAIL]' end as is_blocked_pair_is_definer,
  case when (select search_path_setting ilike '%pg_catalog%' from is_blocked_pair_check) then '[OK]' else '[FAIL]' end as is_blocked_pair_hardened_search_path,

  case when (select rls_on from account_state_check) then '[OK]' else '[FAIL]' end as account_state_rls_enabled,
  case when (select policy_count from account_state_check) = 1 then '[OK]' else '[FAIL]' end as account_state_exactly_one_policy,
  case when (select anon_grant_count from account_state_check) = 0 then '[OK]' else '[FAIL]' end as account_state_anon_zero_grants,
  case when (select authenticated_privs from account_state_check) = array['SELECT'] then '[OK]' else '[FAIL]' end as account_state_authenticated_select_only,

  case when (select anon_grant_count from public_profiles_check) = 0 then '[OK]' else '[FAIL]' end as public_profiles_anon_zero_grants,
  case when (select authenticated_privs from public_profiles_check) = array['SELECT'] then '[OK]' else '[FAIL]' end as public_profiles_authenticated_select_only,
  case when (select view_is_block_aware from public_profiles_check) then '[OK]' else '[FAIL]' end as public_profiles_is_block_aware,

  case when (select policy_is_block_aware from dispatches_check) then '[OK]' else '[FAIL]' end as dispatches_select_is_block_aware,

  case when (select policy_is_block_aware from question_answers_check) then '[OK]' else '[FAIL]' end as question_answers_select_is_block_aware,
  case when (select policy_still_checks_active from question_answers_check) then '[OK]' else '[FAIL]' end as question_answers_select_still_checks_active,

  case when (select is_definer from recommendations_check) then '[OK]' else '[FAIL]' end as recommendations_is_definer_as_expected,
  case when (select body_is_block_aware from recommendations_check) then '[OK]' else '[FAIL]' end as recommendations_is_block_aware,
  case when (select authenticated_exec from recommendations_check) then '[OK]' else '[FAIL]' end as recommendations_grant_preserved,

  case when (select authenticated_privs from kept_minds_check) = array['SELECT'] then '[OK]' else '[FAIL]' end as kept_minds_authenticated_select_only,

  case when (select rls_on from staff_roles_check) then '[OK]' else '[FAIL]' end as staff_roles_rls_enabled,
  case when (select policy_count from staff_roles_check) = 1 then '[OK]' else '[FAIL]' end as staff_roles_exactly_one_policy,
  case when (select anon_grant_count from staff_roles_check) = 0 then '[OK]' else '[FAIL]' end as staff_roles_anon_zero_grants,
  case when (select authenticated_privs from staff_roles_check) = array['SELECT'] then '[OK]' else '[FAIL]' end as staff_roles_authenticated_select_only,
  case when (select not anon_can_call_is_staff and authenticated_can_call_is_staff from staff_roles_check) then '[OK]' else '[FAIL]' end as is_staff_grants_correct,

  case when (select rls_on from admin_audit_log_check) then '[OK]' else '[FAIL]' end as admin_audit_log_rls_enabled,
  case when (select policy_count from admin_audit_log_check) = 0 then '[OK]' else '[FAIL]' end as admin_audit_log_zero_policies,
  case when (select client_grant_count from admin_audit_log_check) = 0 then '[OK]' else '[FAIL]' end as admin_audit_log_zero_client_grants,

  case when (select anon_grants_on_profiles_qa from privilege_hardening_check) = 0 then '[OK]' else '[FAIL]' end as profiles_qa_anon_zero_grants,
  case when (select dangerous_authenticated_privs from privilege_hardening_check) = 0 then '[OK]' else '[FAIL]' end as profiles_qa_no_dangerous_authenticated_privs,

  case when (select unexpected_priv_count from new_tables_privilege_check) = 0 then '[OK]' else '[FAIL]' end as new_tables_no_unexpected_privileges;

-- If every column above reads [OK], the migration's security-critical
-- properties are all confirmed correct. Any [FAIL] — investigate using
-- the matching detailed query below before treating the migration as
-- successfully applied.


-- ============================================================
-- DETAILED DIAGNOSTICS (unchanged from the original verification pass,
-- plus the two new sections for get_post_closure_recommendations and
-- staff/audit foundation)
-- ============================================================

-- 1. Privilege hardening — TRUNCATE/TRIGGER/REFERENCES gone for both
--    roles on both tables; anon has zero privileges on either.
select
  'profiles/question_answers privilege hardening' as check_name,
  table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('profiles', 'question_answers')
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;
-- Expect: zero rows for grantee = anon; for authenticated, only
-- SELECT/INSERT/UPDATE remain (no TRUNCATE/TRIGGER/REFERENCES/DELETE).

select
  'public_profiles privilege hardening' as check_name,
  grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'public_profiles'
order by grantee, privilege_type;
-- Expect: only SELECT for authenticated.

-- 2. blocked_users exists, RLS enabled, correctly scoped.
select 'blocked_users RLS' as check_name, relrowsecurity
from pg_class where oid = 'public.blocked_users'::regclass;

select 'blocked_users policies' as check_name, policyname, cmd, roles, qual
from pg_policies where schemaname = 'public' and tablename = 'blocked_users';
-- Expect: exactly one policy, blocked_users_select_own, SELECT, roles
-- = {authenticated}, qual referencing blocker_id only.

-- 3. tempa_private schema is not in PostgREST's exposed-schema list —
-- this cannot be verified from SQL alone (it's a project config
-- setting); confirm manually in Supabase Dashboard → Settings → API →
-- "Exposed schemas" that tempa_private is NOT listed.
select 'tempa_private function grants (expect zero rows)' as check_name,
  grantee, privilege_type
from information_schema.role_routine_grants
where routine_schema = 'tempa_private';

-- 4. account_enforcement_state exists, self-select only.
select 'account_enforcement_state RLS' as check_name, relrowsecurity
from pg_class where oid = 'public.account_enforcement_state'::regclass;

select 'account_enforcement_state policies' as check_name, policyname, cmd, roles
from pg_policies where schemaname = 'public' and tablename = 'account_enforcement_state';
-- Expect: exactly one policy, select-only, roles = {authenticated}.

-- 5. public_profiles is block-aware — functional test using two real
-- user ids you control (replace the placeholders). Run once as UserA
-- (via an authenticated session/JWT for that user), once as UserB,
-- both before and after calling block_user.
-- select * from public.public_profiles where id = '<the-other-users-id>';
-- Expect: a row before blocking, zero rows after either direction
-- blocks, for BOTH viewers.

-- View definition text check, and the exact column list it exposes —
-- confirms only the 9 intended columns, nothing added.
select pg_get_viewdef('public.public_profiles'::regclass, true) as public_profiles_definition;

-- 6. dispatches_select_published is block-aware.
select 'dispatches_select_published policy' as check_name, policyname, cmd, roles, qual
from pg_policies where schemaname = 'public' and tablename = 'dispatches'
  and policyname = 'dispatches_select_published';
-- Expect: qual contains tempa_private.is_blocked_pair.

-- 7. question_answers cross-user policy is block-aware.
select 'question_answers cross-user policy' as check_name, policyname, cmd, roles, qual
from pg_policies where schemaname = 'public' and tablename = 'question_answers'
  and policyname = 'Answers to active questions are readable by authenticated users';
-- Expect: qual contains both the is_active exists() clause AND
-- tempa_private.is_blocked_pair.

-- 7b. get_post_closure_recommendations — full body, security mode, and
-- grant, per the pre-execution audit's specific finding that this
-- SECURITY DEFINER function reads question_answers/profiles directly
-- and bypasses the RLS fix above unless independently patched.
select
  'get_post_closure_recommendations security mode' as check_name,
  p.prosecdef as is_security_definer,
  coalesce((select string_agg(cfg,',') from unnest(p.proconfig) as cfg where cfg like 'search_path=%'), '(none)') as search_path_setting
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'get_post_closure_recommendations';

select pg_get_functiondef(p.oid) as get_post_closure_recommendations_definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'get_post_closure_recommendations';
-- Expect: definition text contains "tempa_private.is_blocked_pair".

select
  has_function_privilege('anon', 'public.get_post_closure_recommendations(uuid)', 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', 'public.get_post_closure_recommendations(uuid)', 'EXECUTE') as authenticated_can_execute;
-- Expect: anon false, authenticated true (grant preserved from its
-- original creation — CREATE OR REPLACE does not reset an existing
-- function's ACL).

-- 8. kept_minds is RPC-only now.
select
  'kept_minds grants (expect only select for authenticated)' as check_name,
  grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'kept_minds'
  and grantee = 'authenticated';

-- 9a. get_blocked_profiles exists and is not broadly callable by anon.
select
  has_function_privilege('anon', 'public.get_blocked_profiles()', 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', 'public.get_blocked_profiles()', 'EXECUTE') as authenticated_can_execute;
-- Expect: anon false, authenticated true. Functional check (run as an
-- authenticated user who has blocked someone):
-- select * from public.get_blocked_profiles();
-- Expect: exactly the members THIS caller has blocked, with pseudonym
-- resolved despite public_profiles itself excluding that same pair.

-- 9. New/modified functions exist with the expected security mode.
select
  'new/modified function security modes' as check_name,
  n.nspname as schema, p.proname, p.prosecdef as is_security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where (n.nspname = 'public' and p.proname in (
        'block_user', 'unblock_user', 'current_account_status',
        'keep_mind', 'unkeep_mind', 'send_first_letter', 'reply_to_letter',
        'write_letter', 'request_photo_sharing', 'respond_photo_sharing',
        'can_view_letter_photo', 'dispatch_photo_is_visible',
        'publish_dispatch', 'update_dispatch', 'share_dispatch',
        'pin_dispatch', 'publish_question_answer', 'set_current_answer',
        'get_post_closure_recommendations', 'is_staff'
      ))
   or (n.nspname = 'tempa_private' and p.proname = 'is_blocked_pair')
order by schema, p.proname;

-- 10. No public block-check oracle: is_blocked_pair must be
-- unreachable by any client role.
select
  has_function_privilege('anon', 'tempa_private.is_blocked_pair(uuid, uuid)', 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', 'tempa_private.is_blocked_pair(uuid, uuid)', 'EXECUTE') as authenticated_can_execute;
-- Expect: both false.

-- 11. staff_roles exists, RLS enabled, self-select only, no client
-- write path of any kind.
select 'staff_roles RLS' as check_name, relrowsecurity
from pg_class where oid = 'public.staff_roles'::regclass;

select 'staff_roles policies (expect exactly one, select-only)' as check_name,
  policyname, cmd, roles, qual
from pg_policies where schemaname = 'public' and tablename = 'staff_roles';

select
  'staff_roles grants (expect only select for authenticated)' as check_name,
  grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'staff_roles';

select
  has_function_privilege('anon', 'public.is_staff(text)', 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', 'public.is_staff(text)', 'EXECUTE') as authenticated_can_execute;
-- Expect: anon false, authenticated true.

-- 12. admin_audit_log exists, RLS enabled, ZERO policies and ZERO
-- client-facing grants of any kind — not even staff can read it
-- through PostgREST yet.
select 'admin_audit_log RLS' as check_name, relrowsecurity
from pg_class where oid = 'public.admin_audit_log'::regclass;

select 'admin_audit_log policies (expect zero rows)' as check_name,
  policyname, cmd, roles
from pg_policies where schemaname = 'public' and tablename = 'admin_audit_log';

select
  'admin_audit_log grants (expect zero rows for anon/authenticated)' as check_name,
  grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'admin_audit_log'
  and grantee in ('anon', 'authenticated');

-- 13. staff-foundation function security modes — both should be
-- SECURITY DEFINER with a pg_catalog search_path, matching every other
-- new function in this migration.
select
  'staff-foundation function security modes' as check_name,
  n.nspname as schema, p.proname, p.prosecdef as is_security_definer,
  coalesce((select string_agg(cfg, ',') from unnest(p.proconfig) as cfg where cfg like 'search_path=%'), '(none)') as search_path_setting
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'is_staff';

-- 14. No new table introduced by this migration grants anything
-- unexpected to anon or authenticated (a direct test that Supabase's
-- broad default table privileges were fully neutralized by each
-- table's own explicit revoke/grant pass, independent of the
-- project-wide default-privilege decision this migration deliberately
-- does not touch).
select
  'new-table privilege audit (expect only the intended rows below)' as check_name,
  table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('blocked_users', 'account_enforcement_state', 'staff_roles', 'admin_audit_log')
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;
-- Expect EXACTLY these rows and no others: (blocked_users,
-- authenticated, SELECT), (account_enforcement_state, authenticated,
-- SELECT), (staff_roles, authenticated, SELECT). admin_audit_log and
-- every anon row: zero.
