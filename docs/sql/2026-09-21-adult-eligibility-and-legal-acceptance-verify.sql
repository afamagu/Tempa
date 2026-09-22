-- ============================================================
-- TEMPA — ADULT ELIGIBILITY + LEGAL ACCEPTANCE GATE: VERIFICATION
-- Run AFTER 2026-09-21-adult-eligibility-and-legal-acceptance.sql has
-- been applied. Every statement below is a SELECT/has_*_privilege
-- check — no mutation of any kind.
--
-- NOTE: this verifier has NOT been run against a live database (the
-- migration itself has not been executed — see this checkpoint's own
-- implementation report). Text-matching checks against pg_get_
-- functiondef are written against this migration's own literal source,
-- but Postgres's stored/reformatted function body can legitimately
-- differ in whitespace from what was typed (extra spaces, wrapped
-- lines) without the underlying logic being wrong — this repo's other
-- verifiers (e.g. docs/sql/2026-09-24-dispatch-worth-reading-verify.sql)
-- needed several live-diagnostic-driven whitespace-normalization passes
-- before every check passed cleanly. Expect this file may need the
-- same kind of follow-up once actually run; the SUMMARY query's
-- individual named columns (not just overall_pass) are what make that
-- follow-up tractable.
-- ============================================================

-- ============================================================
-- SUMMARY — one row, PASS/FAIL per critical property. Run this first.
-- ============================================================
with
eligibility_table_check as (
  select
    exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'account_eligibility'
    ) as table_exists,
    exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'account_eligibility' and c.relrowsecurity
    ) as rls_enabled
),
eligibility_column_check as (
  select bool_and(present) as all_columns_present
  from (
    select
      col_name,
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'account_eligibility'
          and column_name = col_name
          and (is_nullable = expected_nullable)
      ) as present
    from (values
      ('user_id', 'NO'),
      ('date_of_birth', 'YES'),
      ('status', 'NO'),
      ('eligible_on', 'YES'),
      ('checked_at', 'NO'),
      ('updated_at', 'NO')
    ) as expected(col_name, expected_nullable)
  ) as checked
),
eligibility_policy_check as (
  select
    pol.polname is not null as exists_at_all,
    coalesce(pg_get_expr(pol.polqual, pol.polrelid) ~* 'auth\.uid\(\)\s*=\s*user_id', false) as scoped_to_own_user_id
  from (select 1 as anchor) _anchor
  left join pg_policy pol
    on pol.polname = 'account_eligibility_own'
    and pol.polrelid = to_regclass('public.account_eligibility')
),
eligibility_grant_check as (
  select
    case when to_regclass('public.account_eligibility') is null then false
      else has_table_privilege('authenticated', 'public.account_eligibility', 'SELECT') end as authenticated_select,
    case when to_regclass('public.account_eligibility') is null then false
      else not has_table_privilege('authenticated', 'public.account_eligibility', 'INSERT') end as authenticated_no_insert,
    case when to_regclass('public.account_eligibility') is null then false
      else not has_table_privilege('authenticated', 'public.account_eligibility', 'UPDATE') end as authenticated_no_update,
    case when to_regclass('public.account_eligibility') is null then false
      else not has_table_privilege('anon', 'public.account_eligibility', 'SELECT') end as anon_no_select
),
legal_table_check as (
  select
    exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'legal_acceptances'
    ) as table_exists,
    exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'legal_acceptances' and c.relrowsecurity
    ) as rls_enabled
),
legal_unique_check as (
  select
    coalesce(bool_and(att.attname in ('user_id', 'document_type', 'document_version')) and count(*) = 3, false)
      as has_composite_unique_on_all_three
  from (select 1 as anchor) _anchor
  left join pg_constraint con
    on con.conrelid = to_regclass('public.legal_acceptances')
    and con.contype = 'u'
  left join lateral unnest(con.conkey) as k(attnum) on true
  left join pg_attribute att
    on att.attrelid = con.conrelid and att.attnum = k.attnum
),
legal_policy_check as (
  select
    pol.polname is not null as exists_at_all,
    coalesce(pg_get_expr(pol.polqual, pol.polrelid) ~* 'auth\.uid\(\)\s*=\s*user_id', false) as scoped_to_own_user_id
  from (select 1 as anchor) _anchor
  left join pg_policy pol
    on pol.polname = 'legal_acceptances_own'
    and pol.polrelid = to_regclass('public.legal_acceptances')
),
legal_grant_check as (
  select
    case when to_regclass('public.legal_acceptances') is null then false
      else has_table_privilege('authenticated', 'public.legal_acceptances', 'SELECT') end as authenticated_select,
    case when to_regclass('public.legal_acceptances') is null then false
      else not has_table_privilege('authenticated', 'public.legal_acceptances', 'INSERT') end as authenticated_no_insert,
    case when to_regclass('public.legal_acceptances') is null then false
      else not has_table_privilege('anon', 'public.legal_acceptances', 'SELECT') end as anon_no_select
),
submit_dob_function_check as (
  select
    to_regprocedure('public.submit_dob_eligibility(integer, integer, integer)') is not null as exact_signature_exists,
    p.oid is not null as exists_at_all,
    coalesce(p.prosecdef, false) as is_security_definer,
    coalesce(exists (select 1 from unnest(p.proconfig) cfg where cfg = 'search_path=pg_catalog'), false)
      as search_path_fixed,
    coalesce(pg_get_functiondef(p.oid) ilike '%auth.uid() is null%', false) as checks_auth,
    coalesce(pg_get_functiondef(p.oid) ilike '%v_dob > current_date%', false) as rejects_future_date,
    coalesce(
      pg_get_functiondef(p.oid) ilike '%v_existing.status = ''ineligible''%current_date < v_existing.eligible_on%',
      false
    ) as respects_ineligible_window,
    -- CONCURRENCY FIX (independent audit correction): a transaction-
    -- scoped advisory lock, keyed from auth.uid() only, acquired BEFORE
    -- the account_eligibility read — position()-ordering (both
    -- positions > 0 before comparing) proves the lock statement
    -- appears strictly before the existing-row SELECT.
    coalesce(pg_get_functiondef(p.oid) ilike '%pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0))%', false)
      as acquires_account_scoped_advisory_lock,
    coalesce(
      position('pg_advisory_xact_lock' in pg_get_functiondef(p.oid)) > 0
      and position('select * into v_existing' in pg_get_functiondef(p.oid)) > 0
      and position('pg_advisory_xact_lock' in pg_get_functiondef(p.oid))
        < position('select * into v_existing' in pg_get_functiondef(p.oid)),
      false
    ) as advisory_lock_precedes_existing_row_read,
    -- DOB IMMUTABILITY (independent audit correction): an already-
    -- eligible account's submission is returned unchanged, never
    -- evaluated. Proven via position()-ordering (both positions > 0
    -- before comparing — position() returns 0, not NULL, for a missing
    -- substring, so an unguarded comparison could otherwise read a
    -- false premise as "correctly ordered"): the eligible short-circuit
    -- must appear BEFORE the date-validation block.
    coalesce(
      position('v_existing.status = ''eligible''' in pg_get_functiondef(p.oid)) > 0
      and position('p_year is null or p_month is null or p_day is null' in pg_get_functiondef(p.oid)) > 0
      and position('v_existing.status = ''eligible''' in pg_get_functiondef(p.oid))
        < position('p_year is null or p_month is null or p_day is null' in pg_get_functiondef(p.oid)),
      false
    ) as eligible_dob_is_immutable,
    coalesce(pg_get_functiondef(p.oid) ilike '%date_of_birth = null%status = ''ineligible''%', false)
      as does_not_retain_minor_dob,
    coalesce(pg_get_functiondef(p.oid) ilike '%tempa_private.derive_age_range%', false)
      as syncs_derived_age_range,
    coalesce(pg_get_functiondef(p.oid) ilike '%tempa_private.calculate_age%', false)
      as uses_canonical_age_function,
    coalesce(pg_get_functiondef(p.oid) ilike '%tempa_private.calculate_eligible_on%', false)
      as uses_canonical_eligible_on_function,
    coalesce(not (pg_get_functiondef(p.oid) ilike '%age(current_date%'), false)
      as never_uses_builtin_age_function,
    coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as authenticated_exec,
    coalesce(not has_function_privilege('anon', p.oid, 'EXECUTE'), false) as anon_no_exec
  from (select 1 as anchor) _anchor
  left join pg_proc p
    on p.oid = to_regprocedure('public.submit_dob_eligibility(integer, integer, integer)')
),
accept_legal_function_check as (
  select
    -- LEGAL VERSION AUTHORITY CORRECTION (independent audit
    -- correction): the parameterless signature IS the fix — proves an
    -- authenticated caller can no longer supply/influence which
    -- version strings get recorded.
    to_regprocedure('public.accept_current_legal_documents()') is not null as exact_signature_exists,
    to_regprocedure('public.accept_current_legal_documents(text, text)') is null
      as old_client_supplied_signature_gone,
    p.oid is not null as exists_at_all,
    coalesce(p.prosecdef, false) as is_security_definer,
    coalesce(exists (select 1 from unnest(p.proconfig) cfg where cfg = 'search_path=pg_catalog'), false)
      as search_path_fixed,
    coalesce(pg_get_functiondef(p.oid) ilike '%current_account_status()%', false) as checks_account_status,
    coalesce(pg_get_functiondef(p.oid) ilike '%v_status is distinct from ''eligible''%', false)
      as requires_eligible_first,
    coalesce(pg_get_functiondef(p.oid) ilike '%on conflict (user_id, document_type, document_version) do nothing%', false)
      as inserts_idempotently,
    -- The two accepted versions are SQL CONSTANTs inside the function
    -- body — never read from a parameter.
    coalesce(pg_get_functiondef(p.oid) ilike '%v_terms_version constant text%', false)
      as terms_version_is_server_constant,
    coalesce(pg_get_functiondef(p.oid) ilike '%v_community_guidelines_version constant text%', false)
      as community_guidelines_version_is_server_constant,
    coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as authenticated_exec,
    coalesce(not has_function_privilege('anon', p.oid, 'EXECUTE'), false) as anon_no_exec
  from (select 1 as anchor) _anchor
  left join pg_proc p
    on p.oid = to_regprocedure('public.accept_current_legal_documents()')
),
calculate_age_check as (
  select
    to_regprocedure('tempa_private.calculate_age(date, date)') is not null as exact_signature_exists,
    p.oid is not null as exists_at_all,
    coalesce(not has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as authenticated_no_exec
  from (select 1 as anchor) _anchor
  left join pg_proc p
    on p.oid = to_regprocedure('tempa_private.calculate_age(date, date)')
),
calculate_eligible_on_check as (
  select
    to_regprocedure('tempa_private.calculate_eligible_on(date)') is not null as exact_signature_exists,
    p.oid is not null as exists_at_all,
    -- Feb 29 -> March 1 (never February 28) in a non-leap target year.
    coalesce(pg_get_functiondef(p.oid) ilike '%make_date(v_target_year, 3, 1)%', false)
      as resolves_feb29_to_march_first,
    coalesce(not (pg_get_functiondef(p.oid) ilike '%make_date(v_target_year, 2, 28)%'), false)
      as never_resolves_feb29_to_feb28
  from (select 1 as anchor) _anchor
  left join pg_proc p
    on p.oid = to_regprocedure('tempa_private.calculate_eligible_on(date)')
),
derive_age_range_check as (
  select
    to_regprocedure('tempa_private.derive_age_range(date)') is not null as exact_signature_exists,
    p.oid is not null as exists_at_all,
    coalesce(pg_get_functiondef(p.oid) ilike '%tempa_private.calculate_age%', false)
      as uses_canonical_age_function,
    coalesce(not (pg_get_functiondef(p.oid) ilike '%age(current_date%'), false)
      as never_uses_builtin_age_function
  from (select 1 as anchor) _anchor
  left join pg_proc p
    on p.oid = to_regprocedure('tempa_private.derive_age_range(date)')
),
profiles_trigger_check as (
  select
    exists (
      select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'profiles'
        and t.tgname = 'profiles_enforce_adult_eligibility'
        and not t.tgisinternal
    ) as trigger_exists,
    coalesce(
      (
        select p.prosecdef
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'tempa_private' and p.proname = 'enforce_profile_adult_eligibility'
      ),
      false
    ) as trigger_function_is_security_definer,
    -- TRIGGER PRIVILEGE CORRECTION (independent audit correction): must
    -- be SECURITY DEFINER, not SECURITY INVOKER, so its nested call to
    -- derive_age_range (which authenticated cannot directly EXECUTE)
    -- succeeds during an ordinary authenticated profile INSERT.
    coalesce(
      (
        select pg_get_functiondef(p.oid) ilike '%new.id is distinct from auth.uid()%'
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'tempa_private' and p.proname = 'enforce_profile_adult_eligibility'
      ),
      false
    ) as trigger_function_has_ownership_backstop,
    coalesce(
      (
        select pg_get_functiondef(p.oid) ilike '%v_status is distinct from ''eligible''%'
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'tempa_private' and p.proname = 'enforce_profile_adult_eligibility'
      ),
      false
    ) as trigger_function_checks_eligibility,
    coalesce(
      (
        select pg_get_functiondef(p.oid) ilike '%new.age_range := tempa_private.derive_age_range(v_dob)%'
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'tempa_private' and p.proname = 'enforce_profile_adult_eligibility'
      ),
      false
    ) as trigger_function_overwrites_age_range
)
select
  et.table_exists as eligibility_table_exists,
  et.rls_enabled as eligibility_rls_enabled,
  ec.all_columns_present as eligibility_columns_present,
  ep.exists_at_all as eligibility_policy_exists,
  ep.scoped_to_own_user_id as eligibility_policy_scoped,
  eg.authenticated_select as eligibility_authenticated_select,
  eg.authenticated_no_insert as eligibility_authenticated_no_insert,
  eg.authenticated_no_update as eligibility_authenticated_no_update,
  eg.anon_no_select as eligibility_anon_no_select,
  lt.table_exists as legal_table_exists,
  lt.rls_enabled as legal_rls_enabled,
  lu.has_composite_unique_on_all_three as legal_unique_constraint_present,
  lp.exists_at_all as legal_policy_exists,
  lp.scoped_to_own_user_id as legal_policy_scoped,
  lg.authenticated_select as legal_authenticated_select,
  lg.authenticated_no_insert as legal_authenticated_no_insert,
  lg.anon_no_select as legal_anon_no_select,
  sd.exact_signature_exists as submit_dob_exists,
  sd.is_security_definer as submit_dob_is_security_definer,
  sd.search_path_fixed as submit_dob_search_path_fixed,
  sd.checks_auth as submit_dob_checks_auth,
  sd.rejects_future_date as submit_dob_rejects_future_date,
  sd.respects_ineligible_window as submit_dob_respects_ineligible_window,
  sd.acquires_account_scoped_advisory_lock as submit_dob_acquires_account_scoped_advisory_lock,
  sd.advisory_lock_precedes_existing_row_read as submit_dob_advisory_lock_precedes_existing_row_read,
  sd.eligible_dob_is_immutable as submit_dob_eligible_dob_is_immutable,
  sd.does_not_retain_minor_dob as submit_dob_does_not_retain_minor_dob,
  sd.syncs_derived_age_range as submit_dob_syncs_derived_age_range,
  sd.uses_canonical_age_function as submit_dob_uses_canonical_age_function,
  sd.uses_canonical_eligible_on_function as submit_dob_uses_canonical_eligible_on_function,
  sd.never_uses_builtin_age_function as submit_dob_never_uses_builtin_age_function,
  sd.authenticated_exec as submit_dob_authenticated_exec,
  sd.anon_no_exec as submit_dob_anon_no_exec,
  al.exact_signature_exists as accept_legal_exists,
  al.old_client_supplied_signature_gone as accept_legal_old_client_supplied_signature_gone,
  al.is_security_definer as accept_legal_is_security_definer,
  al.search_path_fixed as accept_legal_search_path_fixed,
  al.checks_account_status as accept_legal_checks_account_status,
  al.requires_eligible_first as accept_legal_requires_eligible_first,
  al.inserts_idempotently as accept_legal_inserts_idempotently,
  al.terms_version_is_server_constant as accept_legal_terms_version_is_server_constant,
  al.community_guidelines_version_is_server_constant as accept_legal_community_guidelines_version_is_server_constant,
  al.authenticated_exec as accept_legal_authenticated_exec,
  al.anon_no_exec as accept_legal_anon_no_exec,
  cage.exact_signature_exists as calculate_age_exists,
  cage.authenticated_no_exec as calculate_age_authenticated_no_exec,
  celig.exact_signature_exists as calculate_eligible_on_exists,
  celig.resolves_feb29_to_march_first,
  celig.never_resolves_feb29_to_feb28,
  dar.exact_signature_exists as derive_age_range_exists,
  dar.uses_canonical_age_function as derive_age_range_uses_canonical_age_function,
  dar.never_uses_builtin_age_function as derive_age_range_never_uses_builtin_age_function,
  pt.trigger_exists as profiles_trigger_exists,
  pt.trigger_function_is_security_definer,
  pt.trigger_function_has_ownership_backstop,
  pt.trigger_function_checks_eligibility,
  pt.trigger_function_overwrites_age_range,
  (
    et.table_exists and et.rls_enabled and ec.all_columns_present
    and ep.exists_at_all and ep.scoped_to_own_user_id
    and eg.authenticated_select and eg.authenticated_no_insert and eg.authenticated_no_update and eg.anon_no_select
    and lt.table_exists and lt.rls_enabled and lu.has_composite_unique_on_all_three
    and lp.exists_at_all and lp.scoped_to_own_user_id
    and lg.authenticated_select and lg.authenticated_no_insert and lg.anon_no_select
    and sd.exact_signature_exists and sd.is_security_definer and sd.search_path_fixed
    and sd.checks_auth and sd.rejects_future_date and sd.respects_ineligible_window
    and sd.acquires_account_scoped_advisory_lock and sd.advisory_lock_precedes_existing_row_read
    and sd.eligible_dob_is_immutable
    and sd.does_not_retain_minor_dob and sd.syncs_derived_age_range
    and sd.uses_canonical_age_function and sd.uses_canonical_eligible_on_function
    and sd.never_uses_builtin_age_function
    and sd.authenticated_exec and sd.anon_no_exec
    and al.exact_signature_exists and al.old_client_supplied_signature_gone
    and al.is_security_definer and al.search_path_fixed
    and al.checks_account_status and al.requires_eligible_first and al.inserts_idempotently
    and al.terms_version_is_server_constant and al.community_guidelines_version_is_server_constant
    and al.authenticated_exec and al.anon_no_exec
    and cage.exact_signature_exists and cage.authenticated_no_exec
    and celig.exact_signature_exists and celig.resolves_feb29_to_march_first and celig.never_resolves_feb29_to_feb28
    and dar.exact_signature_exists and dar.uses_canonical_age_function and dar.never_uses_builtin_age_function
    and pt.trigger_exists and pt.trigger_function_is_security_definer
    and pt.trigger_function_has_ownership_backstop
    and pt.trigger_function_checks_eligibility and pt.trigger_function_overwrites_age_range
  ) as overall_pass
from eligibility_table_check et, eligibility_column_check ec, eligibility_policy_check ep, eligibility_grant_check eg,
     legal_table_check lt, legal_unique_check lu, legal_policy_check lp, legal_grant_check lg,
     submit_dob_function_check sd, accept_legal_function_check al,
     calculate_age_check cage, calculate_eligible_on_check celig, derive_age_range_check dar,
     profiles_trigger_check pt;


-- ============================================================
-- DETAIL — full source of the new objects, for manual reading
-- alongside the migration file itself.
-- ============================================================
select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'submit_dob_eligibility';

select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'accept_current_legal_documents';

select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'tempa_private' and p.proname = 'enforce_profile_adult_eligibility';

select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'tempa_private' and p.proname = 'calculate_age';

select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'tempa_private' and p.proname = 'calculate_eligible_on';

-- Live data spot-check (safe to run even with zero rows): no account
-- should ever have an 'ineligible' status with a NON-NULL date_of_birth
-- (the whole point of the under-18 retention rule), and no 'eligible'
-- status should ever have a NULL date_of_birth (an eligible decision
-- always retains the confirming DOB).
select
  count(*) filter (where status = 'ineligible' and date_of_birth is not null) as ineligible_rows_wrongly_retaining_dob,
  count(*) filter (where status = 'eligible' and date_of_birth is null) as eligible_rows_missing_dob
from public.account_eligibility;
