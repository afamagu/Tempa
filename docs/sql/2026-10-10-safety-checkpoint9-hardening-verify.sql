-- ============================================================
-- TEMPA — SAFETY 2, CHECKPOINT 9: HARDENING VERIFICATION
-- Run AFTER 2026-10-10-safety-checkpoint9-hardening.sql has been
-- applied (and after every earlier Safety migration). Every statement
-- below is a SELECT/has_*_privilege check — no mutation of any kind.
--
-- NOTE: this verifier has NOT been run against a live database — the
-- migration itself has not been executed yet.
-- ============================================================

with
bypass_closure_check as (
  select
    not has_table_privilege('authenticated', 'public.dispatch_moments', 'INSERT') as authenticated_cannot_insert_dispatch_moments,
    not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'dispatch_moments' and policyname = 'dispatch_moments_insert_own'
    ) as dispatch_moments_insert_own_policy_gone,
    has_table_privilege('authenticated', 'public.dispatch_moments', 'SELECT') as authenticated_can_still_read_dispatch_moments
),
status_reason_privacy_check as (
  select
    not has_table_privilege('authenticated', 'public.account_enforcement_state', 'SELECT') as authenticated_cannot_select_enforcement_state,
    not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'account_enforcement_state' and policyname = 'account_enforcement_state_select_own'
    ) as self_select_policy_gone,
    to_regprocedure('public.current_account_status()') is not null as current_account_status_still_present,
    has_function_privilege('authenticated', 'public.current_account_status()', 'EXECUTE') as authenticated_can_still_call_current_account_status
),
rate_limit_signatures_check as (
  select
    to_regprocedure('public.check_rate_limit(uuid, text)') is not null as check_rate_limit_present,
    to_regprocedure('tempa_private.rate_limit_policy(text)') is not null as policy_present,
    to_regprocedure('public.cleanup_expired_rate_limit_counters(interval)') is not null as cleanup_present,
    to_regprocedure('public.report_content(text, uuid, text, text)') is not null as report_content_present,
    to_regprocedure('public.block_user(uuid, text)') is not null as block_user_present,
    to_regprocedure('public.unblock_user(uuid)') is not null as unblock_user_present
),
rate_limit_grant_check as (
  select
    not has_function_privilege('authenticated', 'public.check_rate_limit(uuid, text)', 'EXECUTE') as authenticated_cannot_call_check_rate_limit_directly,
    not has_function_privilege('anon', 'public.check_rate_limit(uuid, text)', 'EXECUTE') as anon_cannot_call_check_rate_limit,
    has_function_privilege('service_role', 'public.check_rate_limit(uuid, text)', 'EXECUTE') as service_role_can_call_check_rate_limit,
    not has_table_privilege('authenticated', 'public.rate_limit_counters', 'SELECT') as authenticated_cannot_read_counters,
    not has_table_privilege('authenticated', 'public.rate_limit_counters', 'INSERT') as authenticated_cannot_write_counters
),
rate_limit_wiring_check as (
  select
    coalesce(
      pg_get_functiondef(p1.oid) ilike '%check_rate_limit(auth.uid(), ''report'')%',
      false
    ) as report_content_checks_rate_limit,
    coalesce(
      pg_get_functiondef(p2.oid) ilike '%check_rate_limit(auth.uid(), ''block'')%',
      false
    ) as block_user_checks_rate_limit,
    coalesce(
      pg_get_functiondef(p3.oid) ilike '%check_rate_limit(auth.uid(), ''unblock'')%',
      false
    ) as unblock_user_checks_rate_limit
  from (select 1 as anchor) _anchor
  left join pg_proc p1 on p1.oid = to_regprocedure('public.report_content(text, uuid, text, text)')
  left join pg_proc p2 on p2.oid = to_regprocedure('public.block_user(uuid, text)')
  left join pg_proc p3 on p3.oid = to_regprocedure('public.unblock_user(uuid)')
),
anon_hygiene_check as (
  select
    not has_table_privilege('anon', 'public.dispatches', 'SELECT') as anon_cannot_select_dispatches,
    not has_table_privilege('anon', 'public.dispatch_topics', 'SELECT') as anon_cannot_select_dispatch_topics,
    not has_table_privilege('anon', 'public.dispatch_moments', 'SELECT') as anon_cannot_select_dispatch_moments,
    not has_table_privilege('anon', 'public.dispatch_views', 'SELECT') as anon_cannot_select_dispatch_views,
    not has_table_privilege('anon', 'public.kept_minds', 'SELECT') as anon_cannot_select_kept_minds,
    not has_table_privilege('anon', 'public.dispatch_shares', 'SELECT') as anon_cannot_select_dispatch_shares,
    not has_table_privilege('anon', 'public.dispatch_replies', 'SELECT') as anon_cannot_select_dispatch_replies
),
privilege_hygiene_check as (
  select
    not has_table_privilege('authenticated', 'public.dispatches', 'TRUNCATE') as authenticated_cannot_truncate_dispatches,
    not has_table_privilege('authenticated', 'public.dispatches', 'TRIGGER') as authenticated_cannot_trigger_dispatches,
    not has_table_privilege('authenticated', 'public.dispatches', 'REFERENCES') as authenticated_cannot_references_dispatches,
    not has_table_privilege('authenticated', 'public.dispatch_topics', 'TRUNCATE') as authenticated_cannot_truncate_dispatch_topics,
    not has_table_privilege('authenticated', 'public.dispatch_topics', 'TRIGGER') as authenticated_cannot_trigger_dispatch_topics,
    not has_table_privilege('authenticated', 'public.dispatch_topics', 'REFERENCES') as authenticated_cannot_references_dispatch_topics,
    not has_table_privilege('authenticated', 'public.dispatch_moments', 'TRUNCATE') as authenticated_cannot_truncate_dispatch_moments,
    not has_table_privilege('authenticated', 'public.dispatch_moments', 'TRIGGER') as authenticated_cannot_trigger_dispatch_moments,
    not has_table_privilege('authenticated', 'public.dispatch_moments', 'REFERENCES') as authenticated_cannot_references_dispatch_moments,
    not has_table_privilege('authenticated', 'public.dispatch_views', 'TRUNCATE') as authenticated_cannot_truncate_dispatch_views,
    not has_table_privilege('authenticated', 'public.dispatch_views', 'TRIGGER') as authenticated_cannot_trigger_dispatch_views,
    not has_table_privilege('authenticated', 'public.dispatch_views', 'REFERENCES') as authenticated_cannot_references_dispatch_views,
    not has_table_privilege('authenticated', 'public.dispatch_replies', 'TRUNCATE') as authenticated_cannot_truncate_dispatch_replies,
    not has_table_privilege('authenticated', 'public.dispatch_replies', 'TRIGGER') as authenticated_cannot_trigger_dispatch_replies,
    not has_table_privilege('authenticated', 'public.dispatch_replies', 'REFERENCES') as authenticated_cannot_references_dispatch_replies,
    -- Legitimate CRUD must remain untouched by this narrow revoke.
    has_table_privilege('authenticated', 'public.dispatch_views', 'SELECT') as authenticated_can_still_select_dispatch_views,
    has_table_privilege('authenticated', 'public.dispatch_replies', 'SELECT') as authenticated_can_still_select_dispatch_replies
),
storage_bucket_check as (
  select
    (select file_size_limit from storage.buckets where id = 'letter-photos') = 5242880 as letter_photos_size_limit_set,
    (select allowed_mime_types from storage.buckets where id = 'letter-photos') = array['image/jpeg'] as letter_photos_mime_restricted,
    (select file_size_limit from storage.buckets where id = 'dispatch-photos') = 5242880 as dispatch_photos_size_limit_set,
    (select allowed_mime_types from storage.buckets where id = 'dispatch-photos') = array['image/jpeg'] as dispatch_photos_mime_restricted
)
select
  bc.authenticated_cannot_insert_dispatch_moments, bc.dispatch_moments_insert_own_policy_gone, bc.authenticated_can_still_read_dispatch_moments,
  sr.authenticated_cannot_select_enforcement_state, sr.self_select_policy_gone, sr.current_account_status_still_present, sr.authenticated_can_still_call_current_account_status,
  rls.check_rate_limit_present, rls.policy_present, rls.cleanup_present, rls.report_content_present, rls.block_user_present, rls.unblock_user_present,
  rlg.authenticated_cannot_call_check_rate_limit_directly, rlg.anon_cannot_call_check_rate_limit, rlg.service_role_can_call_check_rate_limit,
  rlg.authenticated_cannot_read_counters, rlg.authenticated_cannot_write_counters,
  rlw.report_content_checks_rate_limit, rlw.block_user_checks_rate_limit, rlw.unblock_user_checks_rate_limit,
  ah.anon_cannot_select_dispatches, ah.anon_cannot_select_dispatch_topics, ah.anon_cannot_select_dispatch_moments,
  ah.anon_cannot_select_dispatch_views, ah.anon_cannot_select_kept_minds, ah.anon_cannot_select_dispatch_shares, ah.anon_cannot_select_dispatch_replies,
  ph.authenticated_cannot_truncate_dispatches, ph.authenticated_cannot_trigger_dispatches, ph.authenticated_cannot_references_dispatches,
  ph.authenticated_cannot_truncate_dispatch_topics, ph.authenticated_cannot_trigger_dispatch_topics, ph.authenticated_cannot_references_dispatch_topics,
  ph.authenticated_cannot_truncate_dispatch_moments, ph.authenticated_cannot_trigger_dispatch_moments, ph.authenticated_cannot_references_dispatch_moments,
  ph.authenticated_cannot_truncate_dispatch_views, ph.authenticated_cannot_trigger_dispatch_views, ph.authenticated_cannot_references_dispatch_views,
  ph.authenticated_cannot_truncate_dispatch_replies, ph.authenticated_cannot_trigger_dispatch_replies, ph.authenticated_cannot_references_dispatch_replies,
  ph.authenticated_can_still_select_dispatch_views, ph.authenticated_can_still_select_dispatch_replies,
  sb.letter_photos_size_limit_set, sb.letter_photos_mime_restricted, sb.dispatch_photos_size_limit_set, sb.dispatch_photos_mime_restricted,
  (
    bc.authenticated_cannot_insert_dispatch_moments and bc.dispatch_moments_insert_own_policy_gone and bc.authenticated_can_still_read_dispatch_moments
    and sr.authenticated_cannot_select_enforcement_state and sr.self_select_policy_gone
    and sr.current_account_status_still_present and sr.authenticated_can_still_call_current_account_status
    and rls.check_rate_limit_present and rls.policy_present and rls.cleanup_present
    and rls.report_content_present and rls.block_user_present and rls.unblock_user_present
    and rlg.authenticated_cannot_call_check_rate_limit_directly and rlg.anon_cannot_call_check_rate_limit and rlg.service_role_can_call_check_rate_limit
    and rlg.authenticated_cannot_read_counters and rlg.authenticated_cannot_write_counters
    and rlw.report_content_checks_rate_limit and rlw.block_user_checks_rate_limit and rlw.unblock_user_checks_rate_limit
    and ah.anon_cannot_select_dispatches and ah.anon_cannot_select_dispatch_topics and ah.anon_cannot_select_dispatch_moments
    and ah.anon_cannot_select_dispatch_views and ah.anon_cannot_select_kept_minds and ah.anon_cannot_select_dispatch_shares and ah.anon_cannot_select_dispatch_replies
    and ph.authenticated_cannot_truncate_dispatches and ph.authenticated_cannot_trigger_dispatches and ph.authenticated_cannot_references_dispatches
    and ph.authenticated_cannot_truncate_dispatch_topics and ph.authenticated_cannot_trigger_dispatch_topics and ph.authenticated_cannot_references_dispatch_topics
    and ph.authenticated_cannot_truncate_dispatch_moments and ph.authenticated_cannot_trigger_dispatch_moments and ph.authenticated_cannot_references_dispatch_moments
    and ph.authenticated_cannot_truncate_dispatch_views and ph.authenticated_cannot_trigger_dispatch_views and ph.authenticated_cannot_references_dispatch_views
    and ph.authenticated_cannot_truncate_dispatch_replies and ph.authenticated_cannot_trigger_dispatch_replies and ph.authenticated_cannot_references_dispatch_replies
    and ph.authenticated_can_still_select_dispatch_views and ph.authenticated_can_still_select_dispatch_replies
    and sb.letter_photos_size_limit_set and sb.letter_photos_mime_restricted and sb.dispatch_photos_size_limit_set and sb.dispatch_photos_mime_restricted
  ) as overall_pass
from bypass_closure_check bc, status_reason_privacy_check sr, rate_limit_signatures_check rls,
     rate_limit_grant_check rlg, rate_limit_wiring_check rlw, anon_hygiene_check ah, privilege_hygiene_check ph, storage_bucket_check sb;
