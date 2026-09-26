-- ============================================================
-- TEMPA — DISPATCH REPLY SAFETY WHITESPACE FIX — VERIFIER (READ-ONLY)
-- Pairs with docs/sql/2026-10-17-dispatch-reply-safety-whitespace-fix.sql.
-- One SELECT; changes nothing. Expect exactly one row with
-- overall_pass = true (every other column true as well).
-- ============================================================

with fn as (
  select
    coalesce(pg_get_functiondef(to_regprocedure('public.create_reply(uuid, text, uuid, uuid, boolean)')), '') as def,
    (select p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.create_reply(uuid, text, uuid, uuid, boolean)')) as secdef,
    (select p.proconfig from pg_proc p where p.oid = to_regprocedure('public.create_reply(uuid, text, uuid, uuid, boolean)')) as config
),
consume as (
  select coalesce(pg_get_functiondef(to_regprocedure(
    'tempa_private.consume_safety_evaluation(uuid, uuid, text, uuid, uuid, uuid, text, text[], jsonb, text, boolean, uuid)')), '') as def
),
checks as (
  select
    -- signature and grants unchanged
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'create_reply') = 1
      and exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'create_reply'
          and pg_get_function_identity_arguments(p.oid) =
              'p_dispatch_id uuid, p_body text, p_safety_evaluation_id uuid, p_parent_reply_id uuid, p_warning_acknowledged boolean'
      ) as single_unchanged_signature,
    coalesce(has_function_privilege('authenticated',
      to_regprocedure('public.create_reply(uuid, text, uuid, uuid, boolean)'), 'execute'), false) as authenticated_can_execute,
    coalesce((select secdef from fn), false) as security_definer,
    coalesce((select 'search_path=pg_catalog' = any(config) from fn), false) as search_path_pg_catalog,

    -- THE FIX: Safety consumes the exact screened text ...
    (select def ~* 'consume_safety_evaluation\(\s*p_safety_evaluation_id,\s*auth\.uid\(\),\s*''dispatch_reply'',\s*p_dispatch_id,\s*null,\s*p_parent_reply_id,\s*null,\s*null,\s*null,\s*p_body,\s*p_warning_acknowledged,\s*v_new_id\s*\)'
       from fn) as consumes_raw_p_body,
    -- ... and the old trimmed-body consumption is gone
    (select def !~* 'null,\s*v_body,\s*p_warning_acknowledged' from fn) as trimmed_body_no_longer_consumed,

    -- storage + validation still use the trimmed body
    (select def ~* 'v_body\s*:=\s*trim\(both from coalesce\(p_body, ''''\)\)' from fn) as trims_into_v_body,
    (select def ~* 'char_length\(v_body\)\s*=\s*0' and def ~* 'char_length\(v_body\)\s*>\s*500' from fn) as validates_trimmed_length,
    (select def ~* 'v_new_id,\s*p_dispatch_id,\s*auth\.uid\(\),\s*v_body,\s*p_parent_reply_id,\s*v_root_reply_id,\s*v_reply_to_user_id' from fn) as stores_trimmed_v_body,

    -- every other rule preserved
    (select def ~* 'auth\.uid\(\) is null' from fn) as requires_authentication,
    (select def ~* 'current_account_status\(\) in \(''restricted'', ''suspended'', ''banned''\)' from fn) as account_status_gate,
    (select def ~* 'status <> ''published'' or v_dispatch\.moderation_status <> ''visible''' from fn) as dispatch_published_and_visible,
    (select (length(def) - length(replace(def, 'tempa_private.is_blocked_pair(auth.uid()', ''))) / length('tempa_private.is_blocked_pair(auth.uid()') >= 2 from fn) as blocking_checked_for_author_and_parent,
    (select (length(def) - length(replace(def, 'tempa_private.author_content_publicly_visible(', ''))) / length('tempa_private.author_content_publicly_visible(') >= 2 from fn) as author_visibility_checked,
    (select def ~* 'v_parent\.dispatch_id <> p_dispatch_id' and def ~* 'v_parent\.deleted_at is not null' from fn) as nested_parent_validated,
    (select def ~* 'v_root_reply_id := coalesce\(v_parent\.root_reply_id, v_parent\.id\)' and def ~* 'v_reply_to_user_id := v_parent\.author_id' from fn) as threading_preserved,

    -- consumption still enforces single-use, expiry and exact binding
    (select def ~* 'v_fingerprint <> v_eval\.fingerprint'
        and def ~* 'v_eval\.consumed_at is not null'
        and def ~* 'v_eval\.expires_at <= now\(\)'
        and def ~* 'v_eval\.surface <> p_surface'
        and def ~* 'v_eval\.context_id <> p_context_id'
        and def ~* 'v_eval\.secondary_context_id is distinct from p_secondary_context_id'
        and def ~* 'p_warning_acknowledged is not true'
       from consume) as consume_binding_intact,
    to_regprocedure('tempa_private.safety_fingerprint(uuid, text, uuid, uuid, uuid, text, text[], jsonb, text)') is not null as fingerprint_function_present
)
select *,
  (single_unchanged_signature and authenticated_can_execute and security_definer and search_path_pg_catalog
   and consumes_raw_p_body and trimmed_body_no_longer_consumed and trims_into_v_body and validates_trimmed_length
   and stores_trimmed_v_body and requires_authentication and account_status_gate and dispatch_published_and_visible
   and blocking_checked_for_author_and_parent and author_visibility_checked and nested_parent_validated
   and threading_preserved and consume_binding_intact and fingerprint_function_present) as overall_pass
from checks;
