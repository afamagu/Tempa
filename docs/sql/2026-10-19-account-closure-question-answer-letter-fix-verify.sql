-- ============================================================
-- TEMPA — ACCOUNT CLOSURE QUESTION-ANSWER / LETTER FIX — VERIFIER (READ-ONLY)
-- Pairs with docs/sql/2026-10-19-account-closure-question-answer-letter-fix.sql.
-- One SELECT; changes nothing. Expect exactly one row with
-- overall_pass = true (every other column true as well).
-- ============================================================

with trg as (
  select coalesce(pg_get_functiondef(to_regprocedure('public.enforce_letter_immutability()')), '') as def
),
helper as (
  select
    (select p.prosecdef from pg_proc p where p.oid = to_regprocedure('tempa_private.letter_question_answer_is_deleted(uuid)')) as secdef,
    (select p.proconfig from pg_proc p where p.oid = to_regprocedure('tempa_private.letter_question_answer_is_deleted(uuid)')) as config,
    coalesce(pg_get_functiondef(to_regprocedure('tempa_private.letter_question_answer_is_deleted(uuid)')), '') as def
),
closer as (
  select coalesce(pg_get_functiondef(to_regprocedure('public.close_my_account(text, text)')), '') as def
),
checks as (
  select
    -- the trigger is still installed exactly as before
    exists (
      select 1 from pg_trigger t
      where t.tgrelid = 'public.letters'::regclass and t.tgname = 'letters_enforce_immutability'
        and t.tgfoid = to_regprocedure('public.enforce_letter_immutability()')
        and t.tgenabled <> 'D' and not t.tgisinternal
        and (t.tgtype & 2) = 2      -- BEFORE
        and (t.tgtype & 16) = 16    -- UPDATE
        and (t.tgtype & 1) = 1      -- FOR EACH ROW
    ) as immutability_trigger_installed,

    -- the narrow exception
    (select def ~* 'old\.question_answer_id is not null\s+and new\.question_answer_id is null'
       and def ~* '\(to_jsonb\(new\) - ''question_answer_id'' - ''body_search''\)\s*=\s*\(to_jsonb\(old\) - ''question_answer_id'' - ''body_search''\)'
       and def ~* 'tempa_private\.letter_question_answer_is_deleted\(old\.question_answer_id\)'
     from trg) as exception_is_null_only_whole_row_and_answer_deleted,

    -- every original immutability rule still present
    (select def ~* 'new\.sender_id <> old\.sender_id'
       and def ~* 'new\.recipient_id <> old\.recipient_id'
       and def ~* 'new\.question_answer_id is distinct from old\.question_answer_id'
       and def ~* 'new\.reply_to_id is distinct from old\.reply_to_id'
       and def ~* 'new\.correspondence_id <> old\.correspondence_id'
       and def ~* 'new\.body <> old\.body'
       and def ~* 'new\.created_at <> old\.created_at'
       and def ~* 'new\.expires_at <> old\.expires_at'
       and def ~* 'new\.deliver_at <> old\.deliver_at'
       and def ~* 'Letters are immutable except for their lifecycle status fields\.'
     from trg) as original_field_rules_intact,
    (select def ~* 'old\.status in \(''replied'', ''closed''\)\s+and new\.status <> old\.status'
       and def ~* 'This letter has already reached a terminal state\.' from trg) as terminal_state_rule_intact,

    -- the helper cannot be fooled by RLS and is not callable by clients
    coalesce((select secdef from helper), false) as helper_security_definer,
    coalesce((select 'search_path=pg_catalog' = any(config) from helper), false) as helper_search_path_pg_catalog,
    (select def ~* 'not exists \(select 1 from public\.question_answers qa where qa\.id = p_question_answer_id\)' from helper) as helper_checks_answer_absent,
    not coalesce(has_function_privilege('anon', to_regprocedure('tempa_private.letter_question_answer_is_deleted(uuid)'), 'execute'), false)
      and not coalesce(has_function_privilege('authenticated', to_regprocedure('tempa_private.letter_question_answer_is_deleted(uuid)'), 'execute'), false)
      as helper_not_client_callable,

    -- members still cannot edit letters directly: RLS is on and no policy
    -- permits UPDATE (every letter write goes through SECURITY DEFINER RPCs)
    coalesce((select c.relrowsecurity from pg_class c where c.oid = 'public.letters'::regclass), false)
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = 'letters' and p.cmd in ('UPDATE', 'ALL')
      ) as members_cannot_update_letters,

    -- the foreign key keeps its intended ON DELETE SET NULL
    exists (
      select 1 from pg_constraint c
      where c.conrelid = 'public.letters'::regclass and c.contype = 'f'
        and c.confrelid = 'public.question_answers'::regclass
        and c.confdeltype = 'n'
    ) as question_answer_fk_on_delete_set_null,

    -- close_my_account is still the 2026-10-18 version (own-reply fix kept)
    (select def ~* 'delete from public\.dispatch_replies\s+where dispatch_id = any \(v_deletable\) and author_id = v_uid'
       and def ~* 'delete from public\.question_answers where user_id = v_uid' from closer) as closure_function_keeps_10_18_fix
)
select *,
  (immutability_trigger_installed and exception_is_null_only_whole_row_and_answer_deleted
   and original_field_rules_intact and terminal_state_rule_intact and helper_security_definer
   and helper_search_path_pg_catalog and helper_checks_answer_absent and helper_not_client_callable
   and members_cannot_update_letters and question_answer_fk_on_delete_set_null
   and closure_function_keeps_10_18_fix) as overall_pass
from checks;
