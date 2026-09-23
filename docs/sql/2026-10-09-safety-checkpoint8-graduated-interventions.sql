-- ============================================================
-- TEMPA — SAFETY 2, CHECKPOINT 8: GRADUATED HUMAN INTERVENTIONS
-- STATUS: NOT EXECUTED — review, then run in the Supabase SQL editor,
-- AFTER every earlier Safety migration (docs/sql/2026-10-08-safety-
-- checkpoint7-admin-needs-attention.sql and everything before it). Does
-- NOT merge to main, deploy, or enable enforcement for real members.
-- ============================================================
--
-- READ-ONLY ENFORCEMENT AUDIT (performed before writing anything below)
-- — the actual current behavior of account_enforcement_state/current_
-- account_status()/admin_set_account_status/AccountStatusActions, and
-- the real, current difference between active/restricted/suspended/
-- banned (never assumed):
--
--   - account_enforcement_state (docs/sql/2026-09-11-safety-blocking-
--     foundation.sql): one row per member EVER touched by a status
--     change (absence of a row means 'active'); status is a plain CHECK
--     enum ('active','restricted','suspended','banned'); status_reason/
--     changed_by/changed_at. RLS: the OWNING member can SELECT their
--     OWN row (`account_enforcement_state_select_own`, `using (auth.uid()
--     = user_id)`, `grant select ... to authenticated`) — no INSERT/
--     UPDATE/DELETE policy for anyone; every write goes through admin_
--     set_account_status (SECURITY DEFINER).
--
--   - current_account_status(): returns ONLY the CALLER's own status
--     (`where user_id = auth.uid()`), defaulting to 'active' when no row
--     exists. Every mutation RPC across this codebase reads its OWN
--     caller's status this way — never another member's.
--
--   - admin_set_account_status(p_user_id, p_status, p_reason): is_staff
--     ('moderator') gate; p_status must be one of the four enum values;
--     p_reason required, trimmed, <= 500 chars; a STAFF account (exists
--     in public.staff_roles) can never be targeted ("Staff accounts
--     must be managed separately."); upserts account_enforcement_state
--     (`on conflict (user_id) do update`); writes ONE admin_audit_log
--     row (action='set_account_status', target_type='account_status',
--     target_id=p_user_id, metadata old/new status). No locking/
--     staleness check of any kind today — a plain read-modify-write.
--
--   - AccountStatusActions (app/admin/account-status-actions.tsx):
--     Restore/Restrict/Suspend/Ban, each requiring a typed reason before
--     a Cancel/Confirm step; the current status's own button is excluded
--     from the choice list; every destructive action uses the SAME
--     destructiveButtonClass (no size/color escalation toward Ban) —
--     already exactly the "no visually irresistible highest-risk button"
--     posture item 8 below asks for, reused as the visual convention for
--     the new case-linked UI rather than invented fresh.
--
--   BEHAVIORAL MATRIX (traced directly from every real RPC gate, not
--   assumed — grep across docs/sql/*.sql for every current_account_
--   status() call site):
--     - The overwhelming majority of gates are a single flat check:
--       `if current_account_status() in ('restricted','suspended',
--       'banned') then raise exception` — first_letter, publish_dispatch,
--       update_dispatch, create_reply, publish_question_answer, and
--       every other CREATE-shaped mutation across the app treat all
--       three non-active statuses IDENTICALLY: fully blocked.
--     - The one real behavioral SPLIT exists ONLY in write_letter/
--       reply_to_letter (docs/sql/2026-09-13-write-letter-reply-to-
--       letter-ambiguous-m-fix.sql and later revisions): `suspended`/
--       `banned` are blocked from the ENTIRE mutation (the letter/reply
--       is refused outright, worded identically to "not found"); a
--       `restricted` caller MAY still send/reply with plain text, but is
--       blocked specifically from attaching Moments (and, by the same
--       shape, a Postcard) — i.e. restricted = ordinary correspondence
--       continues, rich-media attachments do not. CORRECTION: this
--       plain-text exception is specific to established Letter
--       correspondence (write_letter/reply_to_letter) ONLY — it does
--       NOT generalize to Dispatch publish/update, Dispatch Reply, or
--       Question answers, all of which are already covered by the FIRST
--       bullet above (the flat `in ('restricted','suspended','banned')`
--       gate: publish_dispatch/update_dispatch/create_reply/publish_
--       question_answer all fully block a `restricted` caller, exactly
--       like `suspended`/`banned`). A `restricted` member cannot publish
--       or edit a Dispatch, cannot reply to one, and cannot publish a
--       Question answer — only an existing Letter correspondence's own
--       plain-text reply/write is the narrow exception.
--     - No RPC anywhere in this codebase distinguishes `suspended` from
--       `banned` behaviorally — every gate that checks either checks
--       both together. The only place 'banned' is read alone is a pure
--       admin metrics COUNT (docs/sql/2026-09-10-admin-overview-
--       metrics.sql, "how many banned members," a dashboard number, not
--       a behavior gate). Today, suspended and banned are functionally
--       IDENTICAL — the distinction is administrative/semantic only
--       (temporary vs. permanent framing), not enforced by any different
--       code path. This checkpoint does not change that; it is reported,
--       not "fixed" (no instruction asked for a behavioral split, and
--       inventing one would be new product behavior beyond this
--       checkpoint's own scope).
--
--   MEMBER-FACING VISIBILITY OF status_reason (audited per this
--   checkpoint's own explicit instruction): account_enforcement_state's
--   OWN RLS policy lets a member SELECT their own row directly (not
--   merely through current_account_status(), which returns only the
--   bare status string) — meaning status_reason IS technically
--   queryable by the affected member via a direct client call, even
--   though NO page in this app's own UI ever renders it (grep confirms
--   zero non-admin, non-test reference to account_enforcement_state or
--   status_reason anywhere in app/). This is a PRE-EXISTING structural
--   fact, not something this checkpoint introduces or changes — Admin
--   reasons written through admin_set_account_status (directly OR via
--   this checkpoint's own new intervention RPC, which calls it
--   unmodified) already carry this same exposure today, with or without
--   Checkpoint 8. Fixing the RLS/visibility boundary itself is outside
--   this checkpoint's scope (Checkpoint 9 territory — "RLS/IDOR broad
--   audit" is explicitly listed as NOT this checkpoint's job) and is
--   reported here, not silently worked around. Reviewers writing an
--   intervention reason should therefore write it the same way they
--   already should for any admin_set_account_status reason today:
--   factual and non-inflammatory, since it is not provably invisible to
--   the affected member.
--
--   THE "warned" CASE STATUS — audited per item 5: this codebase's one
--   genuine admin-to-member messaging channel is admin_send_first_letter/
--   AdminContactMember (app/admin/members/[id]/admin-contact-member.tsx)
--   — a GENERIC "write a first-contact letter to this member" tool (used
--   for ordinary support/outreach), with no structured "this is a Safety
--   warning" framing, no copy safeguard against pasting internal
--   reasoning or evidence into a real, permanent, repliable Letter, and
--   no acknowledgment tracking. It is not a purpose-built, reviewed
--   Safety-warning mechanism — reusing it as one here, unreviewed, risks
--   exactly the "invent a fake implementation" and "email private
--   evidence/accusation details" failures item 5 explicitly warns
--   against. Per that item's own explicit instruction, no new
--   notification subsystem is built for this checkpoint: `warned`
--   remains a real, valid value in safety_cases' own CHECK constraint
--   (Checkpoint 2's original domain, unchanged) but is NOT a reachable
--   p_new_status value through any RPC in this migration — the Admin
--   UI never offers it as an action. The already-built pre-send Safety
--   warning (Checkpoint 3's own SafetyWarningDialog, shown at compose
--   time before a risky message is ever sent) remains the current
--   member-facing warning mechanism; this checkpoint does not add a
--   second, ex-post-facto one.
--
-- ARCHITECTURE REUSED, NOT DUPLICATED: account_enforcement_state stays
-- the one authoritative enforcement table; admin_set_account_status
-- stays the one enforcement write path, called from inside the new
-- function below with its own body otherwise UNCHANGED (Postgres nested
-- calls inside one PL/pgSQL function body run in the SAME transaction —
-- no savepoint, no exception handler around the call — so a later
-- failure, including the case UPDATE or the audit INSERT, rolls the
-- account-status change back with it, and a failure INSIDE admin_set_
-- account_status itself (blank reason, staff-account target, unknown
-- status) aborts before the case is ever touched). Its own staff-
-- account protection and validation are reused by CALLING it, never
-- re-implemented.
--
-- INDEPENDENT AUDIT CORRECTION — CONCURRENCY (post-approval): the
-- original version of this migration locked account_enforcement_state
-- itself FOR UPDATE and, when no row existed yet (a never-before-
-- enforced member), reasoned that "there is nothing to lock, so nothing
-- can race" — that reasoning was the bug. `FOR UPDATE` locks nothing
-- when the target row does not exist, so two concurrent paths could
-- both observe "no row, therefore active" and then both proceed to
-- write, with whichever commits second silently overwriting whichever
-- committed first (e.g. the case-intervention path reads absence ->
-- expects 'active', the ordinary member-workspace path independently
-- creates 'suspended', and the case-intervention path's own later
-- upsert to 'restricted' then overwrites that newer suspension — the
-- exact stale-downgrade item 6 exists to prevent). Fixed by locking a
-- row that ALWAYS exists instead: admin_set_account_status is
-- redefined below (Part 0) to lock the target's own public.profiles row
-- FOR UPDATE before it ever reads/upserts account_enforcement_state,
-- and admin_apply_safety_case_intervention (Part 1) locks that SAME
-- profiles row, the same way, before its own account_enforcement_state
-- read. Both the ordinary Restore/Restrict/Suspend/Ban path and the
-- case-intervention path therefore always serialize on one common,
-- always-existing row — whichever gets there first completes and
-- commits; the second waits, then re-reads the now-current status and
-- correctly rejects a stale expected value rather than silently
-- downgrading it. No new locking table or advisory-lock subsystem —
-- profiles already exists, one row per member, exactly the "one shared
-- always-existing lock" this correction asks for.

begin;

-- ============================================================
-- 0. ADMIN_SET_ACCOUNT_STATUS — redefined ONLY to lock the target's own
--    profiles row before reading/upserting account_enforcement_state
-- ============================================================
-- Reproduced in full from its current live definition (docs/sql/2026-
-- 09-17-reporting-and-admin-moderation.sql) with EXACTLY ONE behavioral
-- change: the existing `if not exists (select 1 from public.profiles
-- where id = p_user_id)` existence check now also takes `for update` on
-- that same row — still the identical "Member not found." rejection
-- when the profile doesn't exist, now ALSO holding a row lock for the
-- rest of this transaction when it does. Every other line — the
-- is_staff('moderator') gate, status/reason validation, the staff-
-- account protection, the account_enforcement_state upsert, and its own
-- 'set_account_status' audit row — is byte-for-byte unchanged. Signature
-- unchanged (still admin_set_account_status(uuid, text, text)), so
-- AccountStatusActions/setAccountStatus (the ordinary member-workspace
-- path) and its own audit history keep working exactly as before, with
-- no client-side change of any kind.
create or replace function public.admin_set_account_status(
  p_user_id uuid,
  p_status text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$

declare
  v_old_status text;
  v_reason text;
  v_actor_pseudonym text;
  v_target_pseudonym text;

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('moderator') then
    raise exception 'Not authorized.';
  end if;

  if p_status not in ('active', 'restricted', 'suspended', 'banned') then
    raise exception 'Unknown status.';
  end if;

  v_reason := trim(both from coalesce(p_reason, ''));
  if char_length(v_reason) = 0 then
    raise exception 'A reason is required.';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'Reason is too long.';
  end if;

  -- INDEPENDENT AUDIT CORRECTION: `for update` added — this is now the
  -- one shared, always-existing lock both this function and
  -- admin_apply_safety_case_intervention serialize on before either
  -- touches account_enforcement_state, closing the race a nonexistent-
  -- row FOR UPDATE could never have prevented on its own.
  if not exists (select 1 from public.profiles where id = p_user_id for update) then
    raise exception 'Member not found.';
  end if;

  if exists (
    select 1
    from public.staff_roles
    where user_id = p_user_id
  ) then
    raise exception 'Staff accounts must be managed separately.';
  end if;

  select status into v_old_status
  from public.account_enforcement_state
  where user_id = p_user_id;

  v_old_status := coalesce(v_old_status, 'active');

  insert into public.account_enforcement_state (
    user_id, status, status_reason, changed_by, changed_at
  ) values (
    p_user_id, p_status, v_reason, auth.uid(), now()
  )
  on conflict (user_id) do update
    set status = excluded.status,
        status_reason = excluded.status_reason,
        changed_by = excluded.changed_by,
        changed_at = excluded.changed_at;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();
  select pseudonym into v_target_pseudonym from public.profiles where id = p_user_id;

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot,
    reason, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'set_account_status',
    'account_status', p_user_id, coalesce(v_target_pseudonym, p_user_id::text),
    v_reason, jsonb_build_object('old_status', v_old_status, 'new_status', p_status)
  );

end;
$function$;

revoke all on function public.admin_set_account_status(uuid, text, text) from public;
grant execute on function public.admin_set_account_status(uuid, text, text) to authenticated;


-- ============================================================
-- 1. ADMIN_APPLY_SAFETY_CASE_INTERVENTION — the one case-aware,
--    transactional enforcement path
-- ============================================================
-- Human authority only (item 3): reachable ONLY from an explicit Admin
-- UI action; nothing in this migration, or any earlier Safety
-- migration, ever calls this function automatically from a content-
-- classification or behavioral-detection code path. Grep confirms zero
-- reference to this function's name anywhere in docs/sql/2026-10-03-
-- safety-persistence.sql, the Checkpoint 3/4/5 wiring files, or
-- Checkpoint 7's own file — this checkpoint adds a NEW capability, it
-- does not wire anything existing INTO it.
--
-- CONCURRENCY (item 6): locks the case row FOR UPDATE, then the
-- subject's own public.profiles row FOR UPDATE — the SAME always-
-- existing row admin_set_account_status (Part 0 above) now also locks
-- before it reads/upserts account_enforcement_state — BEFORE comparing
-- either the case or the account status against the caller's own
-- p_expected_case_status/p_expected_account_status. Locking profiles
-- (never account_enforcement_state itself, which may not have a row
-- yet for a never-before-enforced member — see Part 0's own "audit
-- correction" note for why that was the bug) is what actually
-- serializes this function against a concurrent admin_set_account_
-- status call made directly from the ordinary member workspace
-- (app/admin/members/[id]/page.tsx): both functions lock the identical
-- physical row before touching enforcement state, so whichever gets
-- there first completes and commits, and the second necessarily waits,
-- then re-reads the NOW-current status. This is what makes "Admin A's
-- stale Restrict click must not silently downgrade a suspension Admin B
-- already applied a moment earlier" true even when the account had NO
-- account_enforcement_state row at all when Admin A's page first
-- loaded, whichever of the two paths Admin B used.
--
-- ATOMICITY (item 7): one PL/pgSQL function, no internal exception
-- handler around any of its three real effects (the account-status
-- upsert via admin_set_account_status, the case UPDATE, the audit
-- INSERT) — any one of them raising aborts the whole transaction, so
-- "account = banned while case remains reviewing" or the reverse can
-- never persist. admin_set_account_status's OWN audit row (action=
-- 'set_account_status') is preserved unchanged; this function adds a
-- SEPARATE, case-specific audit row (action=
-- 'apply_safety_case_intervention') with structured metadata only —
-- case id, subject id, old/new case status, old/new account status —
-- never private Letter text or Safety evidence.
--
-- TERMINAL (item 4): p_new_status is restricted to exactly ('restricted',
-- 'suspended', 'banned') — never 'warned' (deferred, see this file's own
-- header) and never a value admin_transition_safety_case (Checkpoint 7)
-- already handles ('reviewing'/'no_action'/'resolved'). Once a case
-- reaches one of these three statuses, THIS same function's own
-- v_case.status check (must currently be 'open' or 'reviewing') makes
-- any further intervention on it impossible, and Checkpoint 7's
-- admin_transition_safety_case's own fixed allow-list (unchanged,
-- `v_current_status in ('open','reviewing')`) already independently
-- rejects any further review-only transition too — the case's own
-- historical signals/evidence are never deleted or rewritten by either
-- path.
create or replace function public.admin_apply_safety_case_intervention(
  p_case_id uuid,
  p_expected_case_status text,
  p_expected_account_status text,
  p_new_status text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_case record;
  v_actual_account_status text;
  v_reason text;
  v_actor_pseudonym text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff() then
    raise exception 'Not authorized.';
  end if;

  if p_new_status not in ('restricted', 'suspended', 'banned') then
    raise exception 'Unknown or unsupported intervention status.';
  end if;

  v_reason := nullif(trim(both from coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'A reason is required.';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'Reason is too long.';
  end if;

  select id, status, subject_user_id
  into v_case
  from public.safety_cases
  where id = p_case_id
  for update;

  if v_case.id is null then
    raise exception 'Case not found.';
  end if;

  -- IS DISTINCT FROM, never <> — same NULL-safety discipline already
  -- established for admin_transition_safety_case (Checkpoint 7).
  if v_case.status is distinct from p_expected_case_status then
    raise exception 'This case has changed since you loaded it. Please refresh and try again.' using errcode = '22023';
  end if;

  if v_case.status not in ('open', 'reviewing') then
    raise exception 'That case transition is not allowed.' using errcode = '22023';
  end if;

  -- INDEPENDENT AUDIT CORRECTION: lock the subject's own profiles row —
  -- the SAME always-existing row admin_set_account_status (Part 0)
  -- locks before touching account_enforcement_state — rather than
  -- trying to lock account_enforcement_state itself, which may have NO
  -- row at all for a never-before-enforced member. `FOR UPDATE` locks
  -- nothing when the target row doesn't exist, so locking THAT table
  -- alone could never have prevented two concurrent paths from both
  -- observing "no row, therefore active" and racing to write — this is
  -- what closes that race: both this function and admin_set_account_
  -- status now serialize on the identical physical profiles row before
  -- either one reads or writes account_enforcement_state. The subject's
  -- profile is guaranteed to exist here (admin_get_safety_case/admin_
  -- list_safety_cases both INNER JOIN profiles to even produce a case
  -- the UI could show in the first place), so no existence check is
  -- needed — only the lock itself.
  perform 1 from public.profiles where id = v_case.subject_user_id for update;

  select status into v_actual_account_status
  from public.account_enforcement_state
  where user_id = v_case.subject_user_id;

  v_actual_account_status := coalesce(v_actual_account_status, 'active');

  if v_actual_account_status is distinct from p_expected_account_status then
    raise exception 'This member''s account status has changed since you loaded it. Please refresh and try again.' using errcode = '22023';
  end if;

  -- The one enforcement write path, reused with its own behavior
  -- otherwise unchanged (Part 0's only change is the added profile
  -- lock, already held again harmlessly here — re-acquiring a FOR
  -- UPDATE lock a transaction already holds on the same row is a safe
  -- no-op in Postgres, never a self-deadlock). Its own is_staff gate,
  -- status validation, reason validation, and staff-account protection
  -- all apply exactly as they already do for the ordinary member-
  -- workspace path — nothing here duplicates or re-implements any of
  -- them. If this raises for any reason, everything above (the case
  -- lock and the profile lock) rolls back with the rest of this
  -- transaction; nothing below it ever executes.
  perform public.admin_set_account_status(v_case.subject_user_id, p_new_status, v_reason);

  update public.safety_cases
  set
    status = p_new_status,
    updated_at = now(),
    reviewed_at = now(),
    reviewed_by = auth.uid()
  where id = p_case_id;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, reason, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'apply_safety_case_intervention',
    'safety_case', p_case_id, v_reason,
    jsonb_build_object(
      'subject_user_id', v_case.subject_user_id,
      'old_case_status', v_case.status,
      'new_case_status', p_new_status,
      'old_account_status', v_actual_account_status,
      'new_account_status', p_new_status
    )
  );
end;
$function$;

revoke all on function public.admin_apply_safety_case_intervention(uuid, text, text, text, text) from public;
grant execute on function public.admin_apply_safety_case_intervention(uuid, text, text, text, text) to authenticated;


-- ============================================================
-- 2. ADMIN_LIST_SAFETY_CASES — widened status-filter domain only
-- ============================================================
-- Checkpoint 7's own case queue already sorts/labels every status
-- correctly by construction (only 'open'/'reviewing' were ever treated
-- as "active," per its own ordering key, unchanged) — the ONLY gap is
-- that its p_status filter validation rejected the four historical
-- outcome values outright, so an Admin could never filter the queue
-- down to "Restricted," "Suspended," "Banned," or (structurally valid,
-- though unreachable as an action) "Warned" cases. Reproduced in full
-- from its current definition with ONLY that validation list widened —
-- no other line changed, no ordering/aggregation logic touched.
create or replace function public.admin_list_safety_cases(
  p_status text default 'active',
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  id uuid,
  subject_user_id uuid,
  subject_pseudonym text,
  status text,
  highest_risk_band text,
  signal_count integer,
  opened_at timestamptz,
  updated_at timestamptz,
  reason_codes text[]
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_limit integer;
  v_offset integer;
begin
  if not public.is_staff() then
    raise exception 'Not authorized.';
  end if;

  if p_status is not null and p_status not in (
    'active', 'open', 'reviewing', 'no_action', 'resolved',
    'warned', 'restricted', 'suspended', 'banned'
  ) then
    raise exception 'Invalid status filter.';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  return query
    select
      c.id, c.subject_user_id, p.pseudonym, c.status, c.highest_risk_band, c.signal_count,
      c.opened_at, c.updated_at,
      coalesce((
        select array_agg(distinct code)
        from public.safety_signals s, unnest(s.reason_codes) as code
        where s.case_id = c.id
      ), '{}')
    from public.safety_cases c
    join public.profiles p on p.id = c.subject_user_id
    where
      p_status is null
      or (p_status = 'active' and c.status in ('open', 'reviewing'))
      or c.status = p_status
    order by (c.status in ('open', 'reviewing')) desc, c.updated_at desc
    limit v_limit offset v_offset;
end;
$function$;

revoke all on function public.admin_list_safety_cases(text, integer, integer) from public;
grant execute on function public.admin_list_safety_cases(text, integer, integer) to authenticated;

commit;
