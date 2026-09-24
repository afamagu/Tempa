-- ============================================================
-- TEMPA — SAFETY 2: VERIFY THE record_safety_evaluation 42702 REPAIR
-- Run AFTER 2026-10-11-safety-record-evaluation-conflict-fix.sql has
-- been applied. Every statement is a SELECT / has_*_privilege check —
-- no mutation of any kind.
--
-- NOTE: this verifier has NOT been run against a live database.
--
-- Supersedes ONE check in 2026-10-03-safety-persistence-verify.sql:
-- that file's `signal_dedup_present` looks for the OLD
-- `on conflict (evaluation_id) do nothing` text, which this repair
-- intentionally removes, so it will read false after this repair. That
-- is expected — this file is the authority for that clause from now on.
-- (The regexes below are whitespace-tolerant and case-insensitive.)
-- ============================================================

with
function_check as (
  select
    to_regprocedure('public.record_safety_evaluation(uuid, text, uuid, uuid, uuid, text, text[], jsonb, text, text, text[], text, boolean)') is not null as function_present
),
clause_check as (
  select
    -- 1. the ambiguous form is gone
    not coalesce(
      pg_get_functiondef(p.oid) ~* 'on\s+conflict\s*\(\s*evaluation_id\s*\)\s*do\s+nothing',
      false
    ) as ambiguous_conflict_target_gone,
    -- 2. the unambiguous form is present
    coalesce(
      pg_get_functiondef(p.oid) ~* 'on\s+conflict\s+on\s+constraint\s+safety_signals_evaluation_id_key\s+do\s+nothing',
      false
    ) as on_constraint_form_present,
    -- unrelated, previously-correct case upsert must be untouched
    coalesce(
      pg_get_functiondef(p.oid) ilike '%on conflict (subject_user_id) where status in (''open'', ''reviewing'')%',
      false
    ) as case_upsert_unchanged,
    coalesce(p.prosecdef, false) as still_security_definer
  from (select 1 as anchor) _anchor
  left join pg_proc p on p.oid = to_regprocedure('public.record_safety_evaluation(uuid, text, uuid, uuid, uuid, text, text[], jsonb, text, text, text[], text, boolean)')
),
constraint_check as (
  -- 3. the constraint the ON CONSTRAINT clause names exists, is UNIQUE,
  --    and covers exactly evaluation_id
  select
    exists (
      select 1
      from pg_constraint c
      where c.conrelid = 'public.safety_signals'::regclass
        and c.conname = 'safety_signals_evaluation_id_key'
        and c.contype = 'u'
        and pg_get_constraintdef(c.oid) = 'UNIQUE (evaluation_id)'
    ) as unique_constraint_exists
),
grant_check as (
  -- grants unchanged: service_role only
  select
    has_function_privilege('service_role', 'public.record_safety_evaluation(uuid, text, uuid, uuid, uuid, text, text[], jsonb, text, text, text[], text, boolean)', 'EXECUTE') as service_role_can_execute,
    not has_function_privilege('authenticated', 'public.record_safety_evaluation(uuid, text, uuid, uuid, uuid, text, text[], jsonb, text, text, text[], text, boolean)', 'EXECUTE') as authenticated_cannot_execute,
    not has_function_privilege('anon', 'public.record_safety_evaluation(uuid, text, uuid, uuid, uuid, text, text[], jsonb, text, text, text[], text, boolean)', 'EXECUTE') as anon_cannot_execute
)
select
  f.function_present,
  c.ambiguous_conflict_target_gone,
  c.on_constraint_form_present,
  c.case_upsert_unchanged,
  c.still_security_definer,
  k.unique_constraint_exists,
  g.service_role_can_execute,
  g.authenticated_cannot_execute,
  g.anon_cannot_execute,
  (
    f.function_present
    and c.ambiguous_conflict_target_gone and c.on_constraint_form_present
    and c.case_upsert_unchanged and c.still_security_definer
    and k.unique_constraint_exists
    and g.service_role_can_execute and g.authenticated_cannot_execute and g.anon_cannot_execute
  ) as overall_pass
from function_check f, clause_check c, constraint_check k, grant_check g;
