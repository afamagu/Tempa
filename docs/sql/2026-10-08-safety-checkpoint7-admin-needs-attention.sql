-- ============================================================
-- TEMPA — SAFETY 2, CHECKPOINT 7: ADMIN "NEEDS ATTENTION" REVIEW
-- WORKSPACE
-- STATUS: NOT EXECUTED — review, then run in the Supabase SQL editor,
-- AFTER every earlier Safety migration (docs/sql/2026-10-03-safety-
-- persistence.sql and everything dated after it). Does NOT merge to
-- main, deploy, or enable enforcement for real members.
-- ============================================================
--
-- ADMIN ARCHITECTURE AUDIT (performed before writing anything below):
--   - Authorization: public.is_staff(p_min_role default 'moderator')
--     (docs/sql/2026-09-11-safety-blocking-foundation.sql) is the ONE
--     authoritative "am I staff" check, already re-checked inside every
--     admin RPC's own body (never relying on app/admin/layout.tsx's own
--     server-side route gate alone, and never a parallel auth system).
--     Every RPC below follows the exact same shape every existing admin
--     RPC already uses: `if not public.is_staff() then raise exception
--     'Not authorized.'; end if;` as its first real statement.
--   - Audit logging: public.admin_audit_log (docs/sql/2026-09-11-safety-
--     blocking-foundation.sql) is the ONE append-only audit table — no
--     client read/write path exists for it at all; every existing
--     privileged RPC (admin_set_account_status, admin_mark_report_
--     reviewed — docs/sql/2026-09-17-reporting-and-admin-moderation.sql)
--     inserts into it itself, inside its own transaction, immediately
--     after its real mutation. The case-transition RPC below follows
--     this exact pattern — reused, not reinvented.
--   - Read RPC shape: admin_list_reports/admin_get_report/
--     admin_get_member all `returns table(...)`, join public.profiles
--     DIRECTLY (never public_profiles, which silently drops a row across
--     the STAFF member's own unrelated block) for pseudonyms, and
--     paginate via `p_limit`/`p_offset` clamped server-side (docs/sql/
--     2026-09-18-admin-operations-refinement.sql's own admin_list_
--     reports). Every read RPC below matches this shape exactly.
--   - Private-content evidence: report_content/admin_get_report's own
--     pattern is a PERMANENT snapshot captured AT REPORT TIME
--     (reports.evidence_snapshot jsonb) — that pattern does not apply
--     here, because Checkpoint 2 deliberately never stores raw Letter/
--     Dispatch/Postcard text in any Safety table at signal time (see
--     that migration's own "PRIVACY" header). The narrow-evidence
--     pattern this checkpoint instead reuses is admin_get_report's own
--     private-Letter branch itself: `select l.body, ... from public.
--     letters l where l.id = p_target_id and (l.sender_id = auth.uid()
--     or l.recipient_id = auth.uid())` — narrowed here to "the exact one
--     letter id a verified safety_signals row already names," a LIVE,
--     read-time fetch gated by a server-verified signal→content chain
--     rather than a pre-captured snapshot. See Part 4 below.
--   - Public content: app/admin/moderation/public-content/page.tsx never
--     embeds a Dispatch/Answer's own text in the admin UI at all — it
--     links to the SAME public page (`/board/{id}`, `/minds/{authorId}`)
--     any member could already reach. This checkpoint's own evidence
--     path for dispatch_publish/dispatch_update/dispatch_reply/
--     question_answer signals does the same — no embedding, no new
--     private read path, just enough identity for the UI to link out.
--   - Moderation nav: app/admin/moderation/moderation-tabs.tsx currently
--     switches between exactly two children (Reports, Public Content)
--     under the shared app/admin/moderation/layout.tsx, itself nested
--     under the one already-audited app/admin/layout.tsx gate. Needs
--     Attention becomes a third, coequal child — added in the TS layer,
--     not this file; this migration is SQL-only.
--
-- PRIVATE-CONTENT BOUNDARY (item 4, the load-bearing guarantee this
-- whole file exists to enforce): there is NO RPC anywhere below that
-- accepts a raw Letter id, a correspondence id, or a recipient id as
-- client input. admin_get_safety_signal_evidence takes ONLY a
-- safety_signals id; every content id it ever returns is one that
-- specific, already-existing signal row already names in its own
-- source_content_id column — never a client-supplied content id, never
-- an arbitrary lookup, never a list, never next/previous navigation.
-- An Admin who has never had a real Safety signal point at a given
-- Letter has no path through this file to that Letter's body at all.
--
-- EVIDENCE MINIMIZATION (item 5): no RPC below ever selects
-- fingerprint, outreach_fingerprint, consumed_at, or any advisory-lock/
-- dedup implementation detail from safety_evaluations — only
-- warning_required/warning_issued_at/warning_acknowledged_at/
-- mutation_disposition, the four fields item 3 explicitly asks to
-- surface. No IP/device/country field is read from anywhere. No raw
-- OCR transcript exists anywhere in this codebase (Checkpoint 6) and
-- none is introduced here.

begin;

-- ============================================================
-- 1. ADMIN_LIST_SAFETY_CASES — the case queue
-- ============================================================
-- p_status accepts a real status ('open'/'reviewing'/'no_action'/
-- 'resolved' — the four this checkpoint's own workflow can ever
-- produce; 'warned'/'restricted'/'suspended'/'banned' are Checkpoint
-- 8's own future statuses, structurally still part of safety_cases'
-- domain but never reachable through this file), the synthetic value
-- 'active' (open OR reviewing — the UI's own default view), or null
-- (every status). Ordering: unresolved/active cases first, most-
-- recently-updated within each group — "useful to an operator" per this
-- checkpoint's own instruction, never a numeric fraud score.
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

  if p_status is not null and p_status not in ('active', 'open', 'reviewing', 'no_action', 'resolved') then
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


-- ============================================================
-- 2. ADMIN_GET_SAFETY_CASE — case detail header
-- ============================================================
-- Member context per item 8: pseudonym, current account status
-- (reused from account_enforcement_state, the SAME source admin_get_
-- member already reads — never a new profile dossier), account age
-- (auth.users.created_at — the SAME source tempa_private.evaluate_
-- behavior already established as canonical, docs/sql/2026-10-03-
-- safety-persistence.sql's own Checkpoint 5 notes; public.profiles has
-- no confirmable created_at of its own), and report/block counts
-- AGAINST this subject (the same two counts already legitimately
-- computable from public.reports/public.blocked_users — reports
-- already surfaced via admin_list_member_reports, blocks newly counted
-- here the same direct way BLOCK_SPIKE's own query already does). No
-- country-mismatch or demographic field is read.
create or replace function public.admin_get_safety_case(p_case_id uuid)
returns table (
  id uuid,
  subject_user_id uuid,
  subject_pseudonym text,
  subject_account_status text,
  subject_account_created_at timestamptz,
  subject_report_count integer,
  subject_block_count integer,
  status text,
  highest_risk_band text,
  signal_count integer,
  opened_at timestamptz,
  updated_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by_pseudonym text
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if not public.is_staff() then
    raise exception 'Not authorized.';
  end if;

  return query
    select
      c.id, c.subject_user_id, p.pseudonym,
      coalesce(aes.status, 'active'),
      au.created_at,
      (select count(*)::integer from public.reports r where r.reported_user_id = c.subject_user_id),
      (select count(*)::integer from public.blocked_users b where b.blocked_id = c.subject_user_id),
      c.status, c.highest_risk_band, c.signal_count, c.opened_at, c.updated_at, c.reviewed_at,
      rb.pseudonym
    from public.safety_cases c
    join public.profiles p on p.id = c.subject_user_id
    join auth.users au on au.id = c.subject_user_id
    left join public.account_enforcement_state aes on aes.user_id = c.subject_user_id
    left join public.profiles rb on rb.id = c.reviewed_by
    where c.id = p_case_id;
end;
$function$;

revoke all on function public.admin_get_safety_case(uuid) from public;
grant execute on function public.admin_get_safety_case(uuid) to authenticated;


-- ============================================================
-- 3. ADMIN_LIST_CASE_SIGNALS — the structured evidence list
-- ============================================================
-- Joins safety_evaluations ONLY for the four fields item 3 explicitly
-- asks for (warning_required/warning_issued_at/warning_acknowledged_at/
-- mutation_disposition) — never fingerprint/outreach_fingerprint/
-- consumed_at/expires_at, which stay exactly as internal as they
-- already were (item 5). observed_counts (Checkpoint 5's own
-- behavioral structured counts, e.g. "8 distinct recipients in 1
-- hour") is returned AS-IS — it was already designed at that
-- checkpoint to be numbers/labels only, never raw text, so no further
-- minimization is needed here.
create or replace function public.admin_list_case_signals(p_case_id uuid)
returns table (
  id uuid,
  surface text,
  context_id uuid,
  reason_codes text[],
  risk_band text,
  created_at timestamptz,
  warning_required boolean,
  warning_issued_at timestamptz,
  warning_acknowledged_at timestamptz,
  mutation_disposition text,
  proceeded_at timestamptz,
  source_content_id uuid,
  observed_counts jsonb
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if not public.is_staff() then
    raise exception 'Not authorized.';
  end if;

  if not exists (select 1 from public.safety_cases where id = p_case_id) then
    raise exception 'Case not found.';
  end if;

  return query
    select
      s.id, s.surface, s.context_id, s.reason_codes, s.risk_band, s.created_at,
      e.warning_required, e.warning_issued_at, e.warning_acknowledged_at, e.mutation_disposition,
      s.proceeded_at, s.source_content_id, s.observed_counts
    from public.safety_signals s
    left join public.safety_evaluations e on e.id = s.evaluation_id
    where s.case_id = p_case_id
    order by s.created_at desc;
end;
$function$;

revoke all on function public.admin_list_case_signals(uuid) from public;
grant execute on function public.admin_list_case_signals(uuid) to authenticated;


-- ============================================================
-- 4. ADMIN_GET_SAFETY_SIGNAL_EVIDENCE — the narrowest possible
--    private-content evidence path
-- ============================================================
-- Takes ONLY a safety_signals id — see this file's own header for why
-- that alone is what closes off "arbitrary Letter-ID lookup" entirely:
-- there is no parameter here a caller could substitute a guessed
-- content id into. Resolves content ONLY via that exact signal's own
-- already-recorded source_content_id (set exactly once, only on a
-- genuine proceeded mutation — tempa_private.consume_safety_evaluation)
-- — never a live search, never a join keyed on anything client-
-- supplied. Every successful call is audited (admin_audit_log), the
-- same "an action and its audit record can never be split into two
-- separate client-controllable calls" property every other privileged
-- RPC in this codebase already has.
--
-- Surface-dependent resolution:
--   - first_letter/reply/write_anytime: the ONE flagged Letter's own
--     body/sender/recipient/created_at — private content, so this is
--     the only branch that actually returns text, and only this one
--     verified row's text, never any other letter in the same
--     correspondence or mailbox.
--   - dispatch_publish/dispatch_update/dispatch_reply/question_answer:
--     PUBLIC content already reachable through the ordinary product UI
--     — returns only enough identity (content_type + id, plus the
--     Dispatch id for a Reply, since Replies have no page of their own)
--     for the caller to link out to the EXISTING public page, matching
--     "reuse existing moderation rendering/access where practical."
--     Never embeds the live row's own text here.
--   - any behavior_* surface, or a signal whose source_content_id is
--     still null (evaluated but never proceeded): no content evidence
--     exists — returns evidence_kind = 'none'; the caller already has
--     this signal's own observed_counts/reason_codes from Part 3 above.
create or replace function public.admin_get_safety_signal_evidence(p_signal_id uuid)
returns table (
  evidence_kind text,
  letter_body text,
  letter_sender_pseudonym text,
  letter_recipient_pseudonym text,
  letter_created_at timestamptz,
  public_content_type text,
  public_content_id uuid,
  public_dispatch_id uuid
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_signal record;
  v_actor_pseudonym text;
  v_letter record;
  v_reply record;
begin
  if not public.is_staff() then
    raise exception 'Not authorized.';
  end if;

  select id, surface, source_content_id
  into v_signal
  from public.safety_signals
  where id = p_signal_id;

  if v_signal.id is null then
    raise exception 'Signal not found.';
  end if;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();

  if v_signal.source_content_id is null then
    return query select 'none'::text, null::text, null::text, null::text, null::timestamptz, null::text, null::uuid, null::uuid;
    return;
  end if;

  if v_signal.surface in ('first_letter', 'reply', 'write_anytime') then

    select l.body, sp.pseudonym as sender_pseudonym, rp.pseudonym as recipient_pseudonym, l.created_at
    into v_letter
    from public.letters l
    join public.profiles sp on sp.id = l.sender_id
    join public.profiles rp on rp.id = l.recipient_id
    where l.id = v_signal.source_content_id;

    if v_letter.body is null then
      -- The signal is real, but the letter it once pointed to is gone
      -- (deleted/cascaded) — no evidence to show, not an error.
      return query select 'unavailable'::text, null::text, null::text, null::text, null::timestamptz, null::text, null::uuid, null::uuid;
    else
      insert into public.admin_audit_log (
        actor_id, actor_identifier_snapshot, action, target_type, target_id
      ) values (
        auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'view_safety_evidence',
        'letter', v_signal.source_content_id
      );
      return query select 'letter'::text, v_letter.body, v_letter.sender_pseudonym, v_letter.recipient_pseudonym, v_letter.created_at, null::text, null::uuid, null::uuid;
    end if;

  elsif v_signal.surface in ('dispatch_publish', 'dispatch_update') then

    insert into public.admin_audit_log (
      actor_id, actor_identifier_snapshot, action, target_type, target_id
    ) values (
      auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'view_safety_evidence',
      'dispatch', v_signal.source_content_id
    );
    return query select 'public'::text, null::text, null::text, null::text, null::timestamptz, 'dispatch'::text, v_signal.source_content_id, v_signal.source_content_id;

  elsif v_signal.surface = 'dispatch_reply' then

    select dispatch_id into v_reply from public.dispatch_replies where id = v_signal.source_content_id;

    insert into public.admin_audit_log (
      actor_id, actor_identifier_snapshot, action, target_type, target_id
    ) values (
      auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'view_safety_evidence',
      'dispatch_reply', v_signal.source_content_id
    );
    return query select 'public'::text, null::text, null::text, null::text, null::timestamptz, 'dispatch_reply'::text, v_signal.source_content_id, v_reply.dispatch_id;

  elsif v_signal.surface = 'question_answer' then

    insert into public.admin_audit_log (
      actor_id, actor_identifier_snapshot, action, target_type, target_id
    ) values (
      auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'view_safety_evidence',
      'question_answer', v_signal.source_content_id
    );
    return query select 'public'::text, null::text, null::text, null::text, null::timestamptz, 'question_answer'::text, v_signal.source_content_id, null::uuid;

  else

    return query select 'none'::text, null::text, null::text, null::text, null::timestamptz, null::text, null::uuid, null::uuid;

  end if;
end;
$function$;

revoke all on function public.admin_get_safety_signal_evidence(uuid) from public;
grant execute on function public.admin_get_safety_signal_evidence(uuid) to authenticated;


-- ============================================================
-- 5. ADMIN_TRANSITION_SAFETY_CASE — the one review-workflow write path
-- ============================================================
-- Narrow, review-only transitions: open -> reviewing; open/reviewing ->
-- no_action; open/reviewing -> resolved. Nothing here ever sets status
-- to 'warned'/'restricted'/'suspended'/'banned' — those remain
-- structurally part of safety_cases' own domain (Checkpoint 8's own
-- future graduated-intervention RPCs will set them) but are simply
-- never a reachable p_new_status value through this function; the
-- ALLOWED_TRANSITIONS check below is a fixed, explicit allow-list, not
-- "everything except a blocklist."
--
-- CONCURRENCY (item 7): locks the case row FOR UPDATE before validating
-- anything, so two concurrent calls on the same case serialize rather
-- than race. p_expected_status is optimistic-concurrency-control on top
-- of that lock: the caller states the status it believes the case is
-- currently in (what its own already-loaded page showed); if the
-- FRESH, just-locked row disagrees, the transition is rejected
-- outright — "reviewing -> no_action" issued by a stale tab that still
-- thinks the case is "reviewing" when another Admin already moved it to
-- "resolved" a moment ago must never silently succeed and re-open a
-- closed review.
create or replace function public.admin_transition_safety_case(
  p_case_id uuid,
  p_expected_status text,
  p_new_status text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_current_status text;
  v_subject_user_id uuid;
  v_actor_pseudonym text;
  v_reason text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff() then
    raise exception 'Not authorized.';
  end if;

  if p_new_status not in ('reviewing', 'no_action', 'resolved') then
    raise exception 'Unknown or unsupported case status.';
  end if;

  v_reason := nullif(trim(both from coalesce(p_reason, '')), '');
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'Reason is too long.';
  end if;

  select status, subject_user_id into v_current_status, v_subject_user_id
  from public.safety_cases
  where id = p_case_id
  for update;

  if v_current_status is null then
    raise exception 'Case not found.';
  end if;

  -- IS DISTINCT FROM, never <> — a NULL p_expected_status must be
  -- rejected exactly like a genuinely stale one, never silently skip
  -- the staleness check the way `<>` against NULL would (NULL <> x is
  -- NULL, which `if` treats as false and never raises).
  if v_current_status is distinct from p_expected_status then
    raise exception 'This case has changed since you loaded it. Please refresh and try again.' using errcode = '22023';
  end if;

  if not (
    (v_current_status = 'open' and p_new_status = 'reviewing')
    or (v_current_status in ('open', 'reviewing') and p_new_status in ('no_action', 'resolved'))
  ) then
    raise exception 'That case transition is not allowed.' using errcode = '22023';
  end if;

  update public.safety_cases
  set
    status = p_new_status,
    updated_at = now(),
    reviewed_at = case when p_new_status in ('no_action', 'resolved') then now() else reviewed_at end,
    reviewed_by = case when p_new_status in ('no_action', 'resolved') then auth.uid() else reviewed_by end
  where id = p_case_id;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, reason, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'transition_safety_case',
    'safety_case', p_case_id, v_reason,
    jsonb_build_object('old_status', v_current_status, 'new_status', p_new_status, 'subject_user_id', v_subject_user_id)
  );
end;
$function$;

revoke all on function public.admin_transition_safety_case(uuid, text, text, text) from public;
grant execute on function public.admin_transition_safety_case(uuid, text, text, text) to authenticated;

commit;
