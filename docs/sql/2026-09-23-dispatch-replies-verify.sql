-- ============================================================
-- TEMPA — BOARD EXPERIENCE, PHASE 2B: READ-ONLY VERIFICATION
-- Run AFTER 2026-09-23-dispatch-replies.sql has been applied.
-- Every statement below is a SELECT/has_*_privilege check — no
-- mutation of any kind.
--
-- FINAL VERIFIER HARDENING PASS (2026-09-23 follow-up):
--   A. Every catalog-name cast that could hard-error on a missing
--      object (`::regclass`) is replaced with the null-safe
--      `to_regclass`/`to_regprocedure` equivalents.
--   B. Every CTE that used to drive its FROM off a possibly-zero-row
--      catalog lookup (a missing policy/function/constraint) now drives
--      off a fixed one-row anchor or a fixed VALUES list instead, with
--      every derived column wrapped in `coalesce(..., false)`. The
--      SUMMARY query below is therefore guaranteed to return EXACTLY
--      ONE row against any reachable database — overall_pass is false
--      when something is missing, never a silently empty result set.
--   C. fk_check now proves the existence AND delete-behavior AND target
--      table of all five expected foreign keys via an expected-values
--      relation LEFT JOINed against pg_constraint (previously it only
--      validated whatever FK rows happened to already exist).
--   D. New, more tightly-scoped security assertions for the Reply RLS
--      parent gate, create_reply's author-visibility checks, and
--      report_content's reply branch — using long adjacent-fragment
--      ilike patterns (matching the exact SQL as written) rather than a
--      single vague substring that could accidentally match unrelated
--      code elsewhere in a large function.
--   E. admin_hide_reply/admin_restore_reply now get a full introspection
--      check each: exact signature, SECURITY DEFINER, grants, the
--      moderator-staff gate, the admin-bypass-or-report-existence gate,
--      the audit-log write, and the correct hidden/visible transition.
--
-- FINAL CONCURRENCY + VERIFIER ROBUSTNESS PASS (2026-09-23 follow-up):
--   F. policy_check no longer depends on pg_get_expr's exact pretty-
--      printed form (which may omit `public.`, add parentheses, append
--      `::text` casts, or normalize whitespace differently). Every check
--      is now a `~*` regex tolerant of that variance, and the parent-
--      Dispatch-gate checks are additionally SCOPED to a substring
--      extraction (dispatch_gate_text) so they can never be accidentally
--      satisfied by the Reply's own, textually similar clause — see
--      policy_check's own comment for the full three-CTE derivation.
--   G. Every function-existence CTE (delete_dispatch, create_reply,
--      delete_reply, admin_hide_reply, admin_restore_reply,
--      report_content) now LEFT JOINs pg_proc by the EXACT oid
--      to_regprocedure resolves for that function's fixed signature,
--      not merely by proname — a proname-only join could both violate
--      the "exactly one summary row" guarantee and silently validate
--      the wrong overload's body if one were ever introduced.
--      report_content_check also now proves anon lacks EXECUTE
--      (report_content_anon_no_exec), matching every other RPC checked.
-- ============================================================

-- ============================================================
-- SUMMARY — one row, PASS/FAIL per critical property. Run this first.
-- Guaranteed to return exactly one row (see hardening note B above).
-- ============================================================
with
table_check as (
  select
    exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'dispatch_replies'
    ) as table_exists,
    exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'dispatch_replies' and c.relrowsecurity
    ) as rls_enabled
),
-- Column shape: every locked field present with the correct
-- nullability. Driven off a fixed 11-row VALUES list, so this always
-- returns one row regardless of whether the table exists.
column_check as (
  select
    bool_and(present) as all_columns_present
  from (
    select
      col_name,
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'dispatch_replies'
          and column_name = col_name
          and (is_nullable = expected_nullable)
      ) as present
    from (values
      ('id', 'NO'),
      ('dispatch_id', 'NO'),
      ('author_id', 'NO'),
      ('body', 'NO'),
      ('parent_reply_id', 'YES'),
      ('root_reply_id', 'YES'),
      ('reply_to_user_id', 'YES'),
      ('moderation_status', 'NO'),
      ('moderated_at', 'YES'),
      ('deleted_at', 'YES'),
      ('created_at', 'NO')
    ) as expected(col_name, expected_nullable)
  ) as checked
),
-- Foreign-key ON DELETE behavior AND target table, proven for all five
-- EXPECTED FKs via an expected-values relation LEFT JOINed against
-- pg_constraint — a completely MISSING FK now correctly fails this
-- check (previously: fk_check only validated whichever FK rows already
-- happened to exist, so a missing FK could silently pass). confdeltype:
-- 'a' = NO ACTION, 'c' = CASCADE, 'n' = SET NULL, 'r' = RESTRICT,
-- 'd' = SET DEFAULT. dispatch_id is expected NO ACTION (pre-SQL
-- correction — a Dispatch delete must never destroy Replies).
fk_check as (
  select
    bool_and(
      actual.oid is not null
      and actual.confdeltype = expected.expected_deltype
      and actual.confrelid = to_regclass(expected.expected_target)
    ) as all_fks_correct
  from (values
    ('dispatch_replies_dispatch_id_fkey', 'a', 'public.dispatches'),
    ('dispatch_replies_author_id_fkey', 'c', 'auth.users'),
    ('dispatch_replies_parent_reply_id_fkey', 'n', 'public.dispatch_replies'),
    ('dispatch_replies_root_reply_id_fkey', 'n', 'public.dispatch_replies'),
    ('dispatch_replies_reply_to_user_id_fkey', 'n', 'auth.users')
  ) as expected(conname, expected_deltype, expected_target)
  left join pg_constraint actual
    on actual.conname = expected.conname
    and actual.conrelid = to_regclass('public.dispatch_replies')
    and actual.contype = 'f'
),
constraint_check as (
  select
    exists (
      select 1 from pg_constraint
      where conrelid = to_regclass('public.dispatch_replies')
        and conname = 'dispatch_replies_no_self_parent'
    ) as has_no_self_parent_check,
    exists (
      select 1 from pg_constraint
      where conrelid = to_regclass('public.dispatch_replies')
        and conname = 'dispatch_replies_body_length'
    ) as has_body_length_check
),
-- Driven off a fixed 5-element array, so this always returns one row.
index_check as (
  select
    bool_and(present) as all_indexes_present
  from (
    select exists (select 1 from pg_indexes where schemaname = 'public' and indexname = idx) as present
    from unnest(array[
      'dispatch_replies_dispatch_id_created_at_idx',
      'dispatch_replies_parent_reply_id_idx',
      'dispatch_replies_root_reply_id_idx',
      'dispatch_replies_author_id_idx',
      'dispatch_replies_reply_to_user_id_idx'
    ]) as idx
  ) as checked
),
-- Final security review correction (Defect 1) + verifier hardening
-- (weakness 5, 2026-09-23 follow-up): pg_get_expr's exact pretty-printed
-- output is NOT a stable contract — it may omit the `public.` schema
-- prefix, add parentheses, append `::text` casts to string-literal
-- comparisons, or normalize whitespace differently across Postgres
-- versions. None of the checks below depend on one exact pretty-printed
-- form; every literal comparison tolerates an optional `::text` cast,
-- and every multi-token phrase tolerates arbitrary whitespace and
-- Postgres-added parentheses via `~*` (case-insensitive regex) instead
-- of `ilike`.
--
-- Four-step derivation, so every predicate check can be properly SCOPED
-- to the parent-Dispatch exists() clause specifically (never a vague
-- "occurs somewhere in the whole policy," which could otherwise be
-- accidentally satisfied by the REPLY's own, textually similar,
-- unqualified `moderation_status = 'visible'` clause):
--   policy_source  — resolves the policy row + its full USING clause.
--   policy_gate    — extracts dispatch_gate_text: everything from
--                    "dispatches d" through the Dispatch-author's own
--                    author_content_publicly_visible(d.author_id) call —
--                    the LAST predicate specific to the parent gate, and
--                    a marker only that gate can contain, since the
--                    Reply's own equivalent call uses the unqualified
--                    author_content_publicly_visible(author_id) instead.
--                    A non-greedy match bridges any formatting/parens/
--                    whitespace Postgres inserts in between.
--   policy_gate2   — reply_gate_text: everything in using_clause AFTER
--                    the matched dispatch_gate_text (the Reply's own
--                    visibility clause), computed once here rather than
--                    re-derived in every column below.
--   policy_check   — the actual pass/fail columns, each scoped to
--                    whichever of dispatch_gate_text/reply_gate_text is
--                    correct for it, so parent-gate and Reply-own-clause
--                    checks can never cross-satisfy each other.
policy_source as (
  select
    pol.polname,
    pg_get_expr(pol.polqual, pol.polrelid) as using_clause
  from (select 1 as anchor) _anchor
  left join pg_policy pol
    on pol.polname = 'dispatch_replies_select_published'
    and pol.polrelid = to_regclass('public.dispatch_replies')
),
policy_gate as (
  select
    ps.polname,
    ps.using_clause,
    substring(
      coalesce(ps.using_clause, '')
      from 'dispatches\s+d.*?tempa_private\.author_content_publicly_visible\s*\(\s*d\.author_id\s*\)'
    ) as dispatch_gate_text
  from policy_source ps
),
policy_gate2 as (
  select
    pg.polname,
    pg.dispatch_gate_text,
    case
      when pg.dispatch_gate_text is null or pg.using_clause is null then null
      else substring(pg.using_clause, position(pg.dispatch_gate_text in pg.using_clause) + length(pg.dispatch_gate_text))
    end as reply_gate_text,
    pg.using_clause
  from policy_gate pg
),
policy_check as (
  select
    pg2.polname is not null as exists_at_all,
    coalesce(pg2.dispatch_gate_text ~* 'dispatches\s+d\y', false) as joins_through_dispatches,
    -- The parent gate's four required conditions, checked individually,
    -- scoped to dispatch_gate_text and tolerant of an optional ::text
    -- cast on each string-literal comparison...
    coalesce(pg2.dispatch_gate_text ~* 'd\.status\s*=\s*''published''(::text)?', false)
      as parent_requires_published,
    coalesce(pg2.dispatch_gate_text ~* 'd\.moderation_status\s*=\s*''visible''(::text)?', false)
      as parent_requires_moderation_visible,
    coalesce(
      pg2.dispatch_gate_text ~* 'not\s*\(*\s*tempa_private\.is_blocked_pair\s*\(\s*auth\.uid\(\)\s*,\s*d\.author_id\s*\)',
      false
    ) as parent_checks_author_blocking,
    coalesce(
      pg2.dispatch_gate_text ~* 'tempa_private\.author_content_publicly_visible\s*\(\s*d\.author_id\s*\)',
      false
    ) as parent_checks_author_visibility,
    -- ...AND as one combined boolean requiring all five, still scoped to
    -- dispatch_gate_text alone — the substring extraction above is what
    -- makes this genuinely scoped, not merely "all patterns found
    -- somewhere in the policy in any order."
    coalesce(
      pg2.dispatch_gate_text is not null
      and pg2.dispatch_gate_text ~* 'dispatches\s+d\y'
      and pg2.dispatch_gate_text ~* 'd\.status\s*=\s*''published''(::text)?'
      and pg2.dispatch_gate_text ~* 'd\.moderation_status\s*=\s*''visible''(::text)?'
      and pg2.dispatch_gate_text ~* 'tempa_private\.is_blocked_pair\s*\(\s*auth\.uid\(\)\s*,\s*d\.author_id\s*\)'
      and pg2.dispatch_gate_text ~* 'tempa_private\.author_content_publicly_visible\s*\(\s*d\.author_id\s*\)',
      false
    ) as parent_gate_full_boundary,
    -- The locked absence: no own-author bypass anywhere in the parent
    -- gate specifically (an author's own draft/hidden Dispatch must not
    -- leak its Replies to the public surface either) — tolerant of
    -- either operand order.
    coalesce(
      pg2.dispatch_gate_text is not null
      and not (
        pg2.dispatch_gate_text ~* '(d\.author_id\s*=\s*auth\.uid\(\)|auth\.uid\(\)\s*=\s*d\.author_id)'
      ),
      false
    ) as no_parent_dispatch_own_author_bypass,
    -- The Reply's own clause, scoped to reply_gate_text so it can never
    -- be satisfied by the Dispatch's own, textually similar, d.-
    -- qualified conditions.
    coalesce(pg2.reply_gate_text ~* 'moderation_status\s*=\s*''visible''(::text)?', false)
      as checks_own_moderation,
    coalesce(pg2.reply_gate_text ~* 'is_blocked_pair', false) as checks_blocking,
    coalesce(pg2.reply_gate_text ~* 'author_content_publicly_visible', false) as checks_account_visibility,
    coalesce(
      pg2.reply_gate_text ~* 'or\s*\(*\s*author_id\s*=\s*auth\.uid\(\)\s*\)*',
      false
    ) as author_exception_preserved,
    coalesce(not (pg2.using_clause ~* 'is_correspondence_blocked_pair'), false) as never_uses_letters_only_helper
  from policy_gate2 pg2
),
-- Table itself: SELECT only to authenticated, nothing to anon, and
-- critically NO direct INSERT/UPDATE/DELETE grant to authenticated —
-- every mutation must be RPC-only. Guarded against a missing table
-- (has_table_privilege errors on an unresolvable relation name).
grant_check as (
  select
    case when to_regclass('public.dispatch_replies') is null then false
      else has_table_privilege('authenticated', 'public.dispatch_replies', 'SELECT') end as authenticated_select,
    case when to_regclass('public.dispatch_replies') is null then false
      else not has_table_privilege('authenticated', 'public.dispatch_replies', 'INSERT') end as authenticated_no_insert,
    case when to_regclass('public.dispatch_replies') is null then false
      else not has_table_privilege('authenticated', 'public.dispatch_replies', 'UPDATE') end as authenticated_no_update,
    case when to_regclass('public.dispatch_replies') is null then false
      else not has_table_privilege('authenticated', 'public.dispatch_replies', 'DELETE') end as authenticated_no_delete,
    case when to_regclass('public.dispatch_replies') is null then false
      else not has_table_privilege('anon', 'public.dispatch_replies', 'SELECT') end as anon_no_select
),
-- delete_dispatch (reproduced/extended by this migration, not created
-- by it) must now refuse to delete a Dispatch that still has any Reply
-- row, with one clear exception message rather than a raw FK error.
-- Verifier hardening (weakness 6): joined against the EXACT oid
-- to_regprocedure resolves for this fixed signature, not merely by
-- proname — a proname-only join could violate the "exactly one summary
-- row" guarantee if an overload of this name were ever present, and
-- would silently validate the wrong overload's body.
delete_dispatch_reply_guard_check as (
  select
    to_regprocedure('public.delete_dispatch(uuid)') is not null as exact_signature_exists,
    p.oid is not null as exists_at_all,
    coalesce(p.prosecdef, false) as is_security_definer,
    coalesce(
      pg_get_functiondef(p.oid) ilike '%from public.dispatch_replies where dispatch_id = p_dispatch_id%',
      false
    ) as checks_for_existing_replies,
    coalesce(
      pg_get_functiondef(p.oid) ilike '%This Dispatch cannot be deleted while it still has Replies.%',
      false
    ) as raises_clear_reply_guard_message,
    coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as authenticated_exec,
    coalesce(not has_function_privilege('anon', p.oid, 'EXECUTE'), false) as anon_no_exec
  from (select 1 as anchor) _anchor
  left join pg_proc p
    on p.oid = to_regprocedure('public.delete_dispatch(uuid)')
),
-- create_reply's Dispatch-eligibility check (status = 'published' and
-- moderation_status = 'visible') must have NO exception for the
-- Dispatch's own author. Final security review correction (Defect 2)
-- adds: the Dispatch author's own public-visibility check AND the
-- parent Reply author's own public-visibility check, each verified as
-- one long adjacent-fragment pattern scoped to its own specific
-- block-check `if` clause (not merely "the helper occurs somewhere").
create_reply_check as (
  select
    to_regprocedure('public.create_reply(uuid, text, uuid)') is not null as exact_signature_exists,
    p.oid is not null as exists_at_all,
    coalesce(p.prosecdef, false) as is_security_definer,
    coalesce(pg_get_functiondef(p.oid) ilike '%current_account_status()%', false) as checks_account_status,
    coalesce(pg_get_functiondef(p.oid) ilike '%is_blocked_pair%', false) as checks_blocking,
    coalesce(not (pg_get_functiondef(p.oid) ilike '%is_correspondence_blocked_pair%'), false)
      as never_uses_letters_only_helper,
    coalesce(
      pg_get_functiondef(p.oid) ilike
        '%v_dispatch.status <> ''published'' or v_dispatch.moderation_status <> ''visible''%',
      false
    ) as requires_published_and_visible,
    coalesce(not (pg_get_functiondef(p.oid) ilike '%v_dispatch.author_id = auth.uid()%'), false)
      as no_own_author_publish_bypass,
    -- Defect 2: Dispatch author's own public-visibility, adjacent to
    -- its own blocking check specifically.
    coalesce(
      pg_get_functiondef(p.oid) ilike
        '%is_blocked_pair(auth.uid(), v_dispatch.author_id)%or not tempa_private.author_content_publicly_visible(v_dispatch.author_id)%',
      false
    ) as checks_dispatch_author_public_visibility,
    -- Defect 2: parent Reply author's own public-visibility, adjacent
    -- to ITS OWN blocking check specifically (not the Dispatch one).
    coalesce(
      pg_get_functiondef(p.oid) ilike
        '%is_blocked_pair(auth.uid(), v_parent.author_id)%or not tempa_private.author_content_publicly_visible(v_parent.author_id)%',
      false
    ) as checks_parent_author_public_visibility,
    coalesce(pg_get_functiondef(p.oid) ilike '%coalesce(v_parent.root_reply_id, v_parent.id)%', false)
      as computes_root_single_hop,
    coalesce(pg_get_functiondef(p.oid) ilike '%v_reply_to_user_id := v_parent.author_id%', false)
      as derives_reply_to_from_parent,
    coalesce(pg_get_functiondef(p.oid) ilike '%char_length(v_body) > 500%', false) as enforces_500_char_limit,
    coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as authenticated_exec,
    coalesce(not has_function_privilege('anon', p.oid, 'EXECUTE'), false) as anon_no_exec
  from (select 1 as anchor) _anchor
  left join pg_proc p
    on p.oid = to_regprocedure('public.create_reply(uuid, text, uuid)')
),
-- Verifier hardening (weakness 6): exact-oid join, same reasoning as
-- delete_dispatch_reply_guard_check above.
delete_reply_check as (
  select
    to_regprocedure('public.delete_reply(uuid)') is not null as exact_signature_exists,
    p.oid is not null as exists_at_all,
    coalesce(p.prosecdef, false) as is_security_definer,
    coalesce(pg_get_functiondef(p.oid) ilike '%body = ''''%', false) as clears_body,
    coalesce(pg_get_functiondef(p.oid) ilike '%and author_id = auth.uid()%', false) as author_only,
    coalesce(not (pg_get_functiondef(p.oid) ilike '%current_account_status()%'), false)
      as no_account_status_gate,
    coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as authenticated_exec,
    coalesce(not has_function_privilege('anon', p.oid, 'EXECUTE'), false) as anon_no_exec
  from (select 1 as anchor) _anchor
  left join pg_proc p
    on p.oid = to_regprocedure('public.delete_reply(uuid)')
),
-- Verifier hardening, weakness D: admin_hide_reply/admin_restore_reply
-- each get a full introspection check, not merely existence — exact
-- signature, SECURITY DEFINER, grants, the moderator-staff gate, the
-- admin-bypass-or-report-existence gate, the audit-log write, and the
-- correct moderation_status transition.
admin_hide_reply_check as (
  select
    to_regprocedure('public.admin_hide_reply(uuid, text)') is not null as exact_signature_exists,
    p.oid is not null as exists_at_all,
    coalesce(p.prosecdef, false) as is_security_definer,
    coalesce(pg_get_functiondef(p.oid) ilike '%is_staff(''moderator'')%', false) as checks_moderator_staff,
    coalesce(
      pg_get_functiondef(p.oid) ilike
        '%is_staff(''admin'')%if not exists (%select 1 from public.reports%where target_type = ''reply'' and target_id = p_reply_id%',
      false
    ) as checks_admin_bypass_or_report_existence,
    coalesce(pg_get_functiondef(p.oid) ilike '%insert into public.admin_audit_log%', false)
      as writes_audit_log,
    coalesce(
      pg_get_functiondef(p.oid) ilike '%set moderation_status = ''hidden''%',
      false
    ) as transitions_to_hidden,
    coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as authenticated_exec,
    coalesce(not has_function_privilege('anon', p.oid, 'EXECUTE'), false) as anon_no_exec
  from (select 1 as anchor) _anchor
  left join pg_proc p
    on p.oid = to_regprocedure('public.admin_hide_reply(uuid, text)')
),
admin_restore_reply_check as (
  select
    to_regprocedure('public.admin_restore_reply(uuid, text)') is not null as exact_signature_exists,
    p.oid is not null as exists_at_all,
    coalesce(p.prosecdef, false) as is_security_definer,
    coalesce(pg_get_functiondef(p.oid) ilike '%is_staff(''moderator'')%', false) as checks_moderator_staff,
    coalesce(
      pg_get_functiondef(p.oid) ilike
        '%is_staff(''admin'')%if not exists (%select 1 from public.reports%where target_type = ''reply'' and target_id = p_reply_id%',
      false
    ) as checks_admin_bypass_or_report_existence,
    coalesce(pg_get_functiondef(p.oid) ilike '%insert into public.admin_audit_log%', false)
      as writes_audit_log,
    coalesce(
      pg_get_functiondef(p.oid) ilike '%set moderation_status = ''visible''%',
      false
    ) as transitions_to_visible,
    coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as authenticated_exec,
    coalesce(not has_function_privilege('anon', p.oid, 'EXECUTE'), false) as anon_no_exec
  from (select 1 as anchor) _anchor
  left join pg_proc p
    on p.oid = to_regprocedure('public.admin_restore_reply(uuid, text)')
),
reports_target_type_check as (
  select
    coalesce(pg_get_constraintdef(con.oid) ilike '%''reply''%', false) as includes_reply
  from (select 1 as anchor) _anchor
  left join pg_constraint con
    on con.conrelid = to_regclass('public.reports')
    and con.conname = 'reports_target_type_check'
),
-- report_content's reply branch (Defect 3) must match Reply readability
-- exactly: the Reply's own state AND the full parent-Dispatch public-
-- visibility gate. Checked both as individual flags and as ONE long
-- adjacent-fragment pattern requiring all seven WHERE conditions in
-- their exact written order — scoped specifically to the reply branch's
-- own WHERE clause, since the 'dispatch'/'question_answer' branches
-- have SIMILAR but not identical fragments (they lack the Reply-author
-- checks entirely), so a shorter/looser pattern could accidentally
-- match the wrong branch.
report_content_check as (
  select
    to_regprocedure('public.report_content(text, uuid, text, text)') is not null as exact_signature_exists,
    p.oid is not null as exists_at_all,
    coalesce(p.prosecdef, false) as is_security_definer,
    coalesce(pg_get_functiondef(p.oid) ilike '%p_target_type = ''reply''%', false) as has_reply_branch,
    coalesce(pg_get_functiondef(p.oid) ilike '%from public.dispatch_replies r%', false)
      as reply_branch_reads_correct_table,
    coalesce(pg_get_functiondef(p.oid) ilike '%''question_answer'', ''reply''%', false)
      as target_type_list_includes_reply,
    coalesce(pg_get_functiondef(p.oid) ilike '%d.status = ''published''%and d.moderation_status = ''visible''%and not tempa_private.is_blocked_pair(auth.uid(), d.author_id)%and tempa_private.author_content_publicly_visible(d.author_id)%and r.moderation_status = ''visible''%', false)
      as reply_branch_checks_dispatch_gate,
    coalesce(pg_get_functiondef(p.oid) ilike '%and not tempa_private.is_blocked_pair(auth.uid(), r.author_id)%and tempa_private.author_content_publicly_visible(r.author_id)%', false)
      as reply_branch_checks_reply_author_gate,
    -- The full seven-condition WHERE clause, in order, as one proof.
    coalesce(
      pg_get_functiondef(p.oid) ilike
        '%where r.id = p_target_id%and d.status = ''published''%and d.moderation_status = ''visible''%and not tempa_private.is_blocked_pair(auth.uid(), d.author_id)%and tempa_private.author_content_publicly_visible(d.author_id)%and r.moderation_status = ''visible''%and not tempa_private.is_blocked_pair(auth.uid(), r.author_id)%and tempa_private.author_content_publicly_visible(r.author_id)%',
      false
    ) as reply_branch_full_visibility_boundary,
    coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as authenticated_exec,
    -- Verifier hardening (weakness 7): report_content is SECURITY
    -- DEFINER like every other mutation/report RPC checked above — anon
    -- must not have EXECUTE, consistent with those. No migration grant
    -- change is needed for this; the migration already revokes all then
    -- grants execute to authenticated only.
    coalesce(not has_function_privilege('anon', p.oid, 'EXECUTE'), false) as anon_no_exec
  from (select 1 as anchor) _anchor
  left join pg_proc p
    on p.oid = to_regprocedure('public.report_content(text, uuid, text, text)')
),
no_scope_creep_check as (
  select
    not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('reply_likes', 'reply_reactions', 'reply_votes', 'notifications', 'events')
    ) as no_new_relations_of_concern,
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'dispatch_replies' and column_name = 'updated_at'
    ) as no_updated_at_column
)
select
  t.table_exists,
  t.rls_enabled,
  col.all_columns_present,
  fk.all_fks_correct,
  cons.has_no_self_parent_check,
  cons.has_body_length_check,
  idx.all_indexes_present,
  pol.exists_at_all as policy_exists,
  pol.joins_through_dispatches,
  pol.parent_requires_published,
  pol.parent_requires_moderation_visible,
  pol.parent_checks_author_blocking,
  pol.parent_checks_author_visibility,
  pol.parent_gate_full_boundary,
  pol.no_parent_dispatch_own_author_bypass,
  pol.checks_own_moderation,
  pol.checks_blocking,
  pol.checks_account_visibility,
  pol.author_exception_preserved,
  pol.never_uses_letters_only_helper as policy_never_uses_letters_only_helper,
  g.authenticated_select,
  g.authenticated_no_insert,
  g.authenticated_no_update,
  g.authenticated_no_delete,
  g.anon_no_select,
  cr.exact_signature_exists as create_reply_exact_signature_exists,
  cr.is_security_definer as create_reply_is_security_definer,
  cr.checks_account_status as create_reply_checks_account_status,
  cr.checks_blocking as create_reply_checks_blocking,
  cr.never_uses_letters_only_helper as create_reply_never_uses_letters_only_helper,
  cr.requires_published_and_visible as create_reply_requires_published_and_visible,
  cr.no_own_author_publish_bypass as create_reply_no_own_author_publish_bypass,
  cr.checks_dispatch_author_public_visibility,
  cr.checks_parent_author_public_visibility,
  cr.computes_root_single_hop,
  cr.derives_reply_to_from_parent,
  cr.enforces_500_char_limit,
  cr.authenticated_exec as create_reply_authenticated_exec,
  cr.anon_no_exec as create_reply_anon_no_exec,
  dd.exact_signature_exists as delete_dispatch_exact_signature_exists,
  dd.exists_at_all as delete_dispatch_exists,
  dd.is_security_definer as delete_dispatch_is_security_definer,
  dd.checks_for_existing_replies as delete_dispatch_checks_for_existing_replies,
  dd.raises_clear_reply_guard_message as delete_dispatch_raises_clear_reply_guard_message,
  dd.authenticated_exec as delete_dispatch_authenticated_exec,
  dd.anon_no_exec as delete_dispatch_anon_no_exec,
  dr.exact_signature_exists as delete_reply_exact_signature_exists,
  dr.exists_at_all as delete_reply_exists,
  dr.is_security_definer as delete_reply_is_security_definer,
  dr.clears_body as delete_reply_clears_body,
  dr.author_only as delete_reply_author_only,
  dr.no_account_status_gate as delete_reply_no_account_status_gate,
  dr.authenticated_exec as delete_reply_authenticated_exec,
  dr.anon_no_exec as delete_reply_anon_no_exec,
  ahr.exact_signature_exists as admin_hide_reply_exact_signature_exists,
  ahr.exists_at_all as admin_hide_reply_exists,
  ahr.is_security_definer as admin_hide_reply_is_security_definer,
  ahr.checks_moderator_staff as admin_hide_reply_checks_moderator_staff,
  ahr.checks_admin_bypass_or_report_existence as admin_hide_reply_checks_admin_bypass_or_report_existence,
  ahr.writes_audit_log as admin_hide_reply_writes_audit_log,
  ahr.transitions_to_hidden as admin_hide_reply_transitions_to_hidden,
  ahr.authenticated_exec as admin_hide_reply_authenticated_exec,
  ahr.anon_no_exec as admin_hide_reply_anon_no_exec,
  arr.exact_signature_exists as admin_restore_reply_exact_signature_exists,
  arr.exists_at_all as admin_restore_reply_exists,
  arr.is_security_definer as admin_restore_reply_is_security_definer,
  arr.checks_moderator_staff as admin_restore_reply_checks_moderator_staff,
  arr.checks_admin_bypass_or_report_existence as admin_restore_reply_checks_admin_bypass_or_report_existence,
  arr.writes_audit_log as admin_restore_reply_writes_audit_log,
  arr.transitions_to_visible as admin_restore_reply_transitions_to_visible,
  arr.authenticated_exec as admin_restore_reply_authenticated_exec,
  arr.anon_no_exec as admin_restore_reply_anon_no_exec,
  rtt.includes_reply as reports_target_type_includes_reply,
  rc.exact_signature_exists as report_content_exact_signature_exists,
  rc.exists_at_all as report_content_exists,
  rc.is_security_definer as report_content_is_security_definer,
  rc.has_reply_branch as report_content_has_reply_branch,
  rc.reply_branch_reads_correct_table,
  rc.target_type_list_includes_reply,
  rc.reply_branch_checks_dispatch_gate,
  rc.reply_branch_checks_reply_author_gate,
  rc.reply_branch_full_visibility_boundary,
  rc.authenticated_exec as report_content_authenticated_exec,
  rc.anon_no_exec as report_content_anon_no_exec,
  n.no_new_relations_of_concern,
  n.no_updated_at_column,
  (
    t.table_exists and t.rls_enabled
    and col.all_columns_present
    and fk.all_fks_correct
    and cons.has_no_self_parent_check and cons.has_body_length_check
    and idx.all_indexes_present
    and pol.exists_at_all and pol.joins_through_dispatches
    and pol.parent_requires_published and pol.parent_requires_moderation_visible
    and pol.parent_checks_author_blocking and pol.parent_checks_author_visibility
    and pol.parent_gate_full_boundary and pol.no_parent_dispatch_own_author_bypass
    and pol.checks_own_moderation and pol.checks_blocking and pol.checks_account_visibility
    and pol.author_exception_preserved and pol.never_uses_letters_only_helper
    and g.authenticated_select and g.authenticated_no_insert and g.authenticated_no_update
    and g.authenticated_no_delete and g.anon_no_select
    and cr.exact_signature_exists and cr.is_security_definer and cr.checks_account_status
    and cr.checks_blocking and cr.never_uses_letters_only_helper
    and cr.requires_published_and_visible and cr.no_own_author_publish_bypass
    and cr.checks_dispatch_author_public_visibility and cr.checks_parent_author_public_visibility
    and cr.computes_root_single_hop
    and cr.derives_reply_to_from_parent and cr.enforces_500_char_limit
    and cr.authenticated_exec and cr.anon_no_exec
    and dd.exact_signature_exists and dd.exists_at_all and dd.is_security_definer
    and dd.checks_for_existing_replies
    and dd.raises_clear_reply_guard_message and dd.authenticated_exec and dd.anon_no_exec
    and dr.exact_signature_exists and dr.exists_at_all and dr.is_security_definer
    and dr.clears_body and dr.author_only
    and dr.no_account_status_gate and dr.authenticated_exec and dr.anon_no_exec
    and ahr.exact_signature_exists and ahr.exists_at_all and ahr.is_security_definer
    and ahr.checks_moderator_staff and ahr.checks_admin_bypass_or_report_existence
    and ahr.writes_audit_log and ahr.transitions_to_hidden
    and ahr.authenticated_exec and ahr.anon_no_exec
    and arr.exact_signature_exists and arr.exists_at_all and arr.is_security_definer
    and arr.checks_moderator_staff and arr.checks_admin_bypass_or_report_existence
    and arr.writes_audit_log and arr.transitions_to_visible
    and arr.authenticated_exec and arr.anon_no_exec
    and rtt.includes_reply
    and rc.exact_signature_exists and rc.exists_at_all and rc.is_security_definer and rc.has_reply_branch
    and rc.reply_branch_reads_correct_table and rc.target_type_list_includes_reply
    and rc.reply_branch_checks_dispatch_gate and rc.reply_branch_checks_reply_author_gate
    and rc.reply_branch_full_visibility_boundary
    and rc.authenticated_exec and rc.anon_no_exec
    and n.no_new_relations_of_concern and n.no_updated_at_column
  ) as overall_pass
from table_check t, column_check col, fk_check fk, constraint_check cons, index_check idx,
     policy_check pol, grant_check g, create_reply_check cr, delete_dispatch_reply_guard_check dd,
     delete_reply_check dr, admin_hide_reply_check ahr, admin_restore_reply_check arr,
     reports_target_type_check rtt, report_content_check rc, no_scope_creep_check n;


-- ============================================================
-- DETAIL — full source of the new/changed objects, for manual reading
-- alongside the migration file itself.
-- ============================================================
select pg_get_expr(pol.polqual, pol.polrelid) as dispatch_replies_select_published_using_clause
from pg_policy pol join pg_class c on c.oid = pol.polrelid
where c.relname = 'dispatch_replies' and pol.polname = 'dispatch_replies_select_published';

select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'create_reply';

select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'delete_dispatch';

select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'delete_reply';

select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'admin_hide_reply';

select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'admin_restore_reply';

select pg_get_constraintdef(oid) as reports_target_type_check_definition
from pg_constraint
where conrelid = to_regclass('public.reports') and conname = 'reports_target_type_check';

select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'report_content';

-- Live data spot-check (safe to run even with zero rows): confirms the
-- deletion-compatible body invariant holds for every existing row —
-- nothing should ever violate "deleted implies empty body" or "active
-- implies 1..500 chars."
select
  count(*) as total_rows,
  count(*) filter (where deleted_at is not null and body <> '') as impossible_deleted_with_body,
  count(*) filter (where deleted_at is null and char_length(trim(body)) not between 1 and 500) as impossible_active_body_length
from public.dispatch_replies;
