-- ============================================================
-- TEMPA — LETTER ARRIVAL EMAIL DELIVERY SYSTEM: VERIFICATION
-- Run AFTER 2026-10-01-arrival-email-delivery.sql has been applied.
-- Every statement below is a SELECT/has_*_privilege check — no
-- mutation of any kind.
--
-- NOTE: this verifier has NOT been run against a live database — the
-- migration itself has not been executed yet. Per this repo's own
-- established caveat (see e.g. 2026-09-21-adult-eligibility-and-legal-
-- acceptance-verify.sql's header), some checks may need whitespace/
-- catalog-shape follow-up once actually run against real Postgres. The
-- SUMMARY query's individually named columns are what make that
-- tractable.
-- ============================================================

-- ============================================================
-- SUMMARY — one row, PASS/FAIL per critical property. Run this first.
-- ============================================================
with
tables_check as (
  select
    bool_and(present) as all_tables_present,
    bool_and(rls_on) as all_rls_enabled
  from (
    select
      t.relname,
      exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = t.relname
      ) as present,
      coalesce((
        select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = t.relname
      ), false) as rls_on
    from (values
      ('arrival_email_preferences'),
      ('arrival_email_queue'),
      ('arrival_email_system_config'),
      ('arrival_email_provider_requests')
    ) as t(relname)
  ) as checked
),
preferences_grant_check as (
  select
    case when to_regclass('public.arrival_email_preferences') is null then false
      else has_table_privilege('authenticated', 'public.arrival_email_preferences', 'SELECT') end as authenticated_select,
    case when to_regclass('public.arrival_email_preferences') is null then false
      else not has_table_privilege('authenticated', 'public.arrival_email_preferences', 'INSERT') end as authenticated_no_insert,
    case when to_regclass('public.arrival_email_preferences') is null then false
      else not has_table_privilege('authenticated', 'public.arrival_email_preferences', 'UPDATE') end as authenticated_no_update,
    case when to_regclass('public.arrival_email_preferences') is null then false
      else not has_table_privilege('anon', 'public.arrival_email_preferences', 'SELECT') end as anon_no_select
),
preferences_policy_check as (
  select
    pol.polname is not null as exists_at_all,
    coalesce(pg_get_expr(pol.polqual, pol.polrelid) ~* 'auth\.uid\(\)\s*=\s*user_id', false) as scoped_to_own_user_id
  from (select 1 as anchor) _anchor
  left join pg_policy pol
    on pol.polname = 'arrival_email_preferences_own'
    and pol.polrelid = to_regclass('public.arrival_email_preferences')
),
queue_grant_check as (
  select
    case when to_regclass('public.arrival_email_queue') is null then false
      else not has_table_privilege('anon', 'public.arrival_email_queue', 'SELECT') end as anon_no_select,
    case when to_regclass('public.arrival_email_queue') is null then false
      else not has_table_privilege('authenticated', 'public.arrival_email_queue', 'SELECT') end as authenticated_no_select,
    case when to_regclass('public.arrival_email_queue') is null then false
      else not has_table_privilege('authenticated', 'public.arrival_email_queue', 'INSERT') end as authenticated_no_insert,
    case when to_regclass('public.arrival_email_queue') is null then false
      else exists (
        select 1 from pg_constraint
        where conrelid = 'public.arrival_email_queue'::regclass
          and contype = 'u'
          and pg_get_constraintdef(oid) ilike '%letter_id%'
      ) end as letter_id_unique
),
config_grant_check as (
  select
    case when to_regclass('public.arrival_email_system_config') is null then false
      else not has_table_privilege('anon', 'public.arrival_email_system_config', 'SELECT') end as anon_no_select,
    case when to_regclass('public.arrival_email_system_config') is null then false
      else not has_table_privilege('authenticated', 'public.arrival_email_system_config', 'SELECT') end as authenticated_no_select,
    -- The worker reads this row directly with the service_role key
    -- (bypassing RLS, not via an RPC) — explicit confirmation that
    -- path is actually open, not merely "not revoked by omission".
    case when to_regclass('public.arrival_email_system_config') is null then false
      else has_table_privilege('service_role', 'public.arrival_email_system_config', 'SELECT') end as service_role_can_select
),
config_state_check as (
  select
    (select count(*) from public.arrival_email_system_config) = 1 as exactly_one_row,
    coalesce((select sending_enabled from public.arrival_email_system_config where id = true), true) = false as sending_starts_disabled,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'arrival_email_system_config'
        and column_name = 'enqueue_after' and is_nullable = 'NO' and data_type = 'timestamp with time zone'
    ) as enqueue_after_column_present
),
queue_fencing_columns_check as (
  select
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'arrival_email_queue'
        and column_name = 'claim_token' and data_type = 'uuid'
    ) as claim_token_column_present,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'arrival_email_queue'
        and column_name = 'provider_message_id' and data_type = 'text'
    ) as provider_message_id_column_present,
    exists (
      select 1 from pg_constraint
      where conrelid = 'public.arrival_email_queue'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%manual_review%'
    ) as manual_review_status_present
),
provider_requests_grant_check as (
  select
    case when to_regclass('public.arrival_email_provider_requests') is null then false
      else not has_table_privilege('anon', 'public.arrival_email_provider_requests', 'SELECT') end as anon_no_select,
    case when to_regclass('public.arrival_email_provider_requests') is null then false
      else not has_table_privilege('authenticated', 'public.arrival_email_provider_requests', 'SELECT') end as authenticated_no_select,
    case when to_regclass('public.arrival_email_provider_requests') is null then false
      else exists (
        select 1 from pg_constraint
        where conrelid = 'public.arrival_email_provider_requests'::regclass and contype = 'p'
      ) end as queue_id_primary_key_present
),
snapshot_function_check as (
  select
    has_function_privilege('service_role', 'public.record_or_fetch_arrival_email_snapshot(uuid, uuid, text, text, text, text, text, text)', 'EXECUTE') as service_role_can,
    not has_function_privilege('authenticated', 'public.record_or_fetch_arrival_email_snapshot(uuid, uuid, text, text, text, text, text, text)', 'EXECUTE') as authenticated_cannot,
    not has_function_privilege('anon', 'public.record_or_fetch_arrival_email_snapshot(uuid, uuid, text, text, text, text, text, text)', 'EXECUTE') as anon_cannot
),
-- Fencing guard (independent audit correction) — proves, against the
-- function's own live pg_get_functiondef, that it actually checks
-- status = 'processing' and claim_token = p_claim_token before ever
-- touching arrival_email_provider_requests, the same shape
-- adult-eligibility-and-legal-acceptance-verify.sql already uses to
-- prove a function's internal logic, not just its signature/grants.
snapshot_function_fencing_check as (
  select
    coalesce(pg_get_functiondef(p.oid) ilike '%status = ''processing''%', false) as checks_processing_status,
    coalesce(pg_get_functiondef(p.oid) ilike '%claim_token = p_claim_token%', false) as checks_claim_token,
    coalesce(pg_get_functiondef(p.oid) ilike '%claimed_at = now()%', false) as refreshes_claimed_at,
    coalesce(
      position('for update' in pg_get_functiondef(p.oid)) > 0
      and position('insert into public.arrival_email_provider_requests' in pg_get_functiondef(p.oid)) > 0
      and position('for update' in pg_get_functiondef(p.oid))
        < position('insert into public.arrival_email_provider_requests' in pg_get_functiondef(p.oid)),
      false
    ) as ownership_lock_precedes_insert
  from (select 1 as anchor) _anchor
  left join pg_proc p
    on p.oid = to_regprocedure(
      'public.record_or_fetch_arrival_email_snapshot(uuid, uuid, text, text, text, text, text, text)'
    )
),
worker_function_check as (
  select
    bool_and(service_role_can and not authenticated_can and not anon_can) as worker_only_functions_locked_down
  from (
    select
      has_function_privilege('service_role', f.sig, 'EXECUTE') as service_role_can,
      has_function_privilege('authenticated', f.sig, 'EXECUTE') as authenticated_can,
      has_function_privilege('anon', f.sig, 'EXECUTE') as anon_can
    from (values
      ('public.enqueue_arrival_emails()'),
      ('public.claim_arrival_email_jobs(integer, text)'),
      ('public.resolve_arrival_email_context(uuid)'),
      ('public.complete_arrival_email_job(uuid, uuid, text, text, text, boolean)')
    ) as f(sig)
  ) as checked
),
staff_function_check as (
  select
    bool_and(authenticated_can and not anon_can) as staff_functions_reachable
  from (
    select
      has_function_privilege('authenticated', f.sig, 'EXECUTE') as authenticated_can,
      has_function_privilege('anon', f.sig, 'EXECUTE') as anon_can
    from (values
      ('public.admin_get_arrival_email_status()'),
      ('public.set_arrival_email_sending_enabled(boolean)')
    ) as f(sig)
  ) as checked
),
preference_write_function_check as (
  select
    has_function_privilege('authenticated', 'public.set_arrival_email_preference(boolean)', 'EXECUTE') as authenticated_can,
    not has_function_privilege('anon', 'public.set_arrival_email_preference(boolean)', 'EXECUTE') as anon_cannot
)
select
  t.all_tables_present,
  t.all_rls_enabled,
  p.authenticated_select as prefs_authenticated_select,
  p.authenticated_no_insert as prefs_authenticated_no_insert,
  p.authenticated_no_update as prefs_authenticated_no_update,
  p.anon_no_select as prefs_anon_no_select,
  pp.exists_at_all as prefs_policy_exists,
  pp.scoped_to_own_user_id as prefs_policy_scoped_to_own_row,
  q.anon_no_select as queue_anon_no_select,
  q.authenticated_no_select as queue_authenticated_no_select,
  q.authenticated_no_insert as queue_authenticated_no_insert,
  q.letter_id_unique as queue_letter_id_unique,
  c.anon_no_select as config_anon_no_select,
  c.authenticated_no_select as config_authenticated_no_select,
  c.service_role_can_select as config_service_role_can_select,
  cs.exactly_one_row as config_exactly_one_row,
  cs.sending_starts_disabled as config_sending_starts_disabled,
  cs.enqueue_after_column_present as config_enqueue_after_column_present,
  qf.claim_token_column_present as queue_claim_token_column_present,
  qf.provider_message_id_column_present as queue_provider_message_id_column_present,
  qf.manual_review_status_present as queue_manual_review_status_present,
  pr.anon_no_select as provider_requests_anon_no_select,
  pr.authenticated_no_select as provider_requests_authenticated_no_select,
  pr.queue_id_primary_key_present as provider_requests_queue_id_primary_key_present,
  sn.service_role_can as snapshot_function_service_role_can,
  sn.authenticated_cannot as snapshot_function_authenticated_cannot,
  sn.anon_cannot as snapshot_function_anon_cannot,
  sf2.checks_processing_status as snapshot_function_checks_processing_status,
  sf2.checks_claim_token as snapshot_function_checks_claim_token,
  sf2.refreshes_claimed_at as snapshot_function_refreshes_claimed_at,
  sf2.ownership_lock_precedes_insert as snapshot_function_ownership_lock_precedes_insert,
  wf.worker_only_functions_locked_down,
  sf.staff_functions_reachable,
  pw.authenticated_can as pref_write_authenticated_can,
  pw.anon_cannot as pref_write_anon_cannot,
  (
    t.all_tables_present and t.all_rls_enabled
    and p.authenticated_select and p.authenticated_no_insert and p.authenticated_no_update and p.anon_no_select
    and pp.exists_at_all and pp.scoped_to_own_user_id
    and q.anon_no_select and q.authenticated_no_select and q.authenticated_no_insert and q.letter_id_unique
    and c.anon_no_select and c.authenticated_no_select and c.service_role_can_select
    and cs.exactly_one_row and cs.sending_starts_disabled and cs.enqueue_after_column_present
    and qf.claim_token_column_present and qf.provider_message_id_column_present and qf.manual_review_status_present
    and pr.anon_no_select and pr.authenticated_no_select and pr.queue_id_primary_key_present
    and sn.service_role_can and sn.authenticated_cannot and sn.anon_cannot
    and sf2.checks_processing_status and sf2.checks_claim_token and sf2.refreshes_claimed_at
    and sf2.ownership_lock_precedes_insert
    and wf.worker_only_functions_locked_down
    and sf.staff_functions_reachable
    and pw.authenticated_can and pw.anon_cannot
  ) as overall_pass
from tables_check t, preferences_grant_check p, preferences_policy_check pp,
     queue_grant_check q, config_grant_check c, config_state_check cs,
     queue_fencing_columns_check qf, provider_requests_grant_check pr, snapshot_function_check sn,
     snapshot_function_fencing_check sf2,
     worker_function_check wf, staff_function_check sf, preference_write_function_check pw;
