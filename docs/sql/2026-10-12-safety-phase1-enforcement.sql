-- ============================================================
-- TEMPA — TRUST & SAFETY COMPLETION, PHASE 1: ENFORCEMENT, EVIDENCE,
-- OFFICIAL NOTICES
-- STATUS: NOT EXECUTED — review, then run in the Supabase SQL editor,
-- AFTER every earlier Safety migration, including
-- docs/sql/2026-10-11-safety-record-evaluation-conflict-fix.sql (already
-- applied to production). Forward-only: nothing earlier is edited, no
-- table or column is dropped, nothing is deleted. Does not merge, deploy
-- or enable anything by itself.
-- Run order: 1) this file  2) 2026-10-12-safety-phase1-enforcement-verify.sql
-- (read-only; overall_pass must be true).
-- ============================================================
--
-- WHAT THIS ADDS (one coherent extension of the existing Safety 2
-- architecture — no parallel moderation/restriction framework):
--
--  A. EVIDENCE — public.safety_attempt_evidence (ADMIN-ONLY): the text
--     of an attempt that produced a Safety signal, including a DENIED
--     attempt that was never sent. Written by record_safety_evaluation,
--     cascades with its evaluation. Read only through
--     admin_get_safety_case_review (is_staff first, audited).
--  B. AUTOMATIC RESTRICTION — evaluate_behavior's REPEATED_SOLICITATION
--     now counts DISTINCT recipient/correspondence contexts of
--     QUALIFYING (denied) financial-solicitation attempts. Three within
--     the rolling 72 hours place the account RESTRICTED — PENDING REVIEW
--     (account_enforcement_state.status = 'restricted', changed_by NULL)
--     via tempa_private.apply_pending_review_restriction. Restriction
--     only; a permanent ban remains a human admin action.
--  C. ENFORCEMENT CHOKEPOINT — consume_safety_evaluation refuses
--     restricted/suspended/banned accounts. Every authored write already
--     consumes an evaluation, so this closes replies and Write Anytime
--     for restricted accounts too (previously plain text was allowed).
--  D. OFFICIAL NOTICES — public.member_notices ("From Tempa", one-way,
--     not replyable, not a member account) written on restriction,
--     restore and permanent decision; public.letter_safety_notices
--     carries the recipient-side contact-sharing reminder for a letter.
--  E. DISCOVERY — restricted/suspended/banned members are excluded from
--     People discovery and post-closure recommendations (existing pen
--     pals still see them); a banned member is also hidden from
--     public_profiles.
--  F. RETENTION — cleanup_expired_safety_evaluations keeps the evidence
--     of an account that is currently restricted/suspended/banned.
--
-- RETENTION ASSUMPTIONS (documented, not new policy): attempt evidence
-- follows its safety_evaluations row — kept while the case is active or
-- the account is under enforcement, otherwise eligible for the existing
-- 30-day-after-expiry manual cleanup. Full attempt text is capped at
-- 20,000 characters. Nothing here stores device fingerprints, IP
-- addresses or any identifier beyond the existing auth identity, which
-- is never deleted on a ban (so the same account/email cannot simply
-- re-register).
--
-- SAME-RECIPIENT REWRITES: target_key normalises to the OTHER PERSON
-- (first letter / reply / write-anytime all resolve to that person's id),
-- so five rewrites of one letter to one recipient are five visible
-- attempts but ONE context. Identical repeated evaluations still dedup
-- in record_safety_evaluation as before.

begin;

-- ============================================================
-- 1. TABLES
-- ============================================================
create table if not exists public.safety_attempt_evidence (
  evaluation_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  surface text not null,
  target_key text,
  reason_codes text[] not null default '{}',
  risk_band text not null,
  mutation_disposition text not null,
  qualifying boolean not null default false,
  attempted_title text,
  attempted_topics text[],
  attempted_body text,
  attempted_postcard jsonb,
  created_at timestamptz not null default now(),
  constraint safety_attempt_evidence_pkey primary key (evaluation_id),
  constraint safety_attempt_evidence_evaluation_fkey
    foreign key (evaluation_id) references public.safety_evaluations(id) on delete cascade
);

create index if not exists safety_attempt_evidence_user_recent_idx
  on public.safety_attempt_evidence (user_id, created_at desc);

alter table public.safety_attempt_evidence enable row level security;
revoke all on public.safety_attempt_evidence from public, anon, authenticated;
-- No policy, no grant, for any client role: reachable only through the
-- SECURITY DEFINER functions below (owner privileges).

create table if not exists public.member_notices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null
    check (kind in ('restriction_applied', 'restriction_lifted', 'permanent_decision', 'general')),
  title text not null default 'A quick note from Tempa',
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists member_notices_user_recent_idx
  on public.member_notices (user_id, created_at desc);

alter table public.member_notices enable row level security;
revoke all on public.member_notices from public, anon, authenticated;
grant select on public.member_notices to authenticated;

drop policy if exists member_notices_select_own on public.member_notices;
create policy member_notices_select_own
  on public.member_notices
  for select
  to authenticated
  using (auth.uid() = user_id);

create table if not exists public.letter_safety_notices (
  letter_id uuid primary key
    references public.letters(id) on delete cascade
    deferrable initially deferred,
  kind text not null check (kind in ('contact_sharing')),
  created_at timestamptz not null default now()
);

alter table public.letter_safety_notices enable row level security;
revoke all on public.letter_safety_notices from public, anon, authenticated;
grant select on public.letter_safety_notices to authenticated;

-- Only the RECIPIENT of the letter can see its note (the letters table's
-- own RLS still applies inside the subquery, so an undelivered letter
-- exposes nothing).
drop policy if exists letter_safety_notices_select_recipient on public.letter_safety_notices;
create policy letter_safety_notices_select_recipient
  on public.letter_safety_notices
  for select
  to authenticated
  using (
    exists (
      select 1 from public.letters l
      where l.id = letter_safety_notices.letter_id
        and l.recipient_id = auth.uid()
    )
  );

-- A member may mark their own notices read — the only member write path.
create or replace function public.mark_member_notice_read(p_notice_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  update public.member_notices
  set read_at = coalesce(read_at, now())
  where id = p_notice_id and user_id = auth.uid();
end;
$function$;

revoke all on function public.mark_member_notice_read(uuid) from public;
grant execute on function public.mark_member_notice_read(uuid) to authenticated;


-- ============================================================
-- 2. HELPERS
-- ============================================================
-- The normalised "who was this aimed at" key. A private letter surface
-- resolves to the OTHER PERSON (never the letter/correspondence id), so
-- rewriting one message to one person stays one context. Public
-- surfaces key on the public thing addressed.
create or replace function tempa_private.safety_target_key(
  p_user_id uuid,
  p_surface text,
  p_context_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_other uuid;
begin
  if p_surface = 'first_letter' then
    return 'person:' || p_context_id::text;
  end if;

  if p_surface = 'reply' then
    select case when l.sender_id = p_user_id then l.recipient_id else l.sender_id end
    into v_other
    from public.letters l
    where l.id = p_context_id;
    return 'person:' || coalesce(v_other::text, p_context_id::text);
  end if;

  if p_surface = 'write_anytime' then
    select case when c.participant_low = p_user_id then c.participant_high else c.participant_low end
    into v_other
    from public.correspondences c
    where c.id = p_context_id;
    return 'person:' || coalesce(v_other::text, p_context_id::text);
  end if;

  if p_surface = 'dispatch_publish' then
    return 'public:dispatch_publish';
  end if;
  if p_surface in ('dispatch_update', 'dispatch_reply') then
    return 'dispatch:' || p_context_id::text;
  end if;
  if p_surface = 'question_answer' then
    return 'question:' || p_context_id::text;
  end if;

  return p_surface || ':' || coalesce(p_context_id::text, '');
end;
$function$;

revoke all on function tempa_private.safety_target_key(uuid, text, uuid) from public, anon, authenticated, service_role;

-- Discovery/recommendation visibility. A banned member is hidden from
-- every other member. A restricted/suspended member is hidden from
-- DISCOVERY, but a member who already corresponds with them keeps seeing
-- them (existing correspondence must not silently break). Called from
-- an RLS policy, so — like is_blocked_pair — deliberately NOT revoked
-- from PUBLIC; tempa_private is not an exposed schema.
create or replace function tempa_private.hidden_from_discovery(p_viewer uuid, p_author uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog'
as $$
  select p_viewer is distinct from p_author
    and (
      exists (
        select 1 from public.account_enforcement_state s
        where s.user_id = p_author and s.status = 'banned'
      )
      or (
        exists (
          select 1 from public.account_enforcement_state s
          where s.user_id = p_author and s.status in ('restricted', 'suspended')
        )
        and not exists (
          select 1 from public.letters l
          where (l.sender_id = p_viewer and l.recipient_id = p_author)
             or (l.sender_id = p_author and l.recipient_id = p_viewer)
        )
      )
    )
$$;

create or replace function tempa_private.account_is_banned(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog'
as $$
  select exists (
    select 1 from public.account_enforcement_state s
    where s.user_id = p_user_id and s.status = 'banned'
  )
$$;

-- The automatic restriction. Locks the member's own profiles row — the
-- same always-existing row admin_set_account_status and the case-
-- intervention RPC serialise on — and only ever moves an ACTIVE account
-- to restricted (never downgrades suspended/banned, never touches staff).
create or replace function tempa_private.apply_pending_review_restriction(
  p_user_id uuid,
  p_distinct_contexts integer
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_rows integer;
  v_pseudonym text;
begin
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then
    return;
  end if;

  if exists (select 1 from public.staff_roles where user_id = p_user_id) then
    return;
  end if;

  insert into public.account_enforcement_state (user_id, status, status_reason, changed_by, changed_at)
  values (
    p_user_id, 'restricted',
    'Automatic restriction pending review: financial-solicitation attempts involving three different people within 72 hours.',
    null, now()
  )
  on conflict (user_id) do update
    set status = excluded.status,
        status_reason = excluded.status_reason,
        changed_by = null,
        changed_at = now()
    where public.account_enforcement_state.status = 'active';

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return;
  end if;

  select pseudonym into v_pseudonym from public.profiles where id = p_user_id;

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot,
    reason, metadata
  ) values (
    null, 'system:automatic-restriction', 'automatic_restriction_pending_review',
    'account_status', p_user_id, coalesce(v_pseudonym, p_user_id::text),
    'Three qualifying financial-solicitation attempts to three distinct recipients within 72 hours.',
    jsonb_build_object(
      'old_status', 'active', 'new_status', 'restricted',
      'distinct_contexts', p_distinct_contexts, 'window_hours', 72
    )
  );

  insert into public.member_notices (user_id, kind, body)
  values (p_user_id, 'restriction_applied', 'We''ve temporarily restricted your account while we review activity that may conflict with Tempa''s safety rules.

You can still read your existing correspondence, but you won''t be able to write, reply, publish or comment during the review.

This is a temporary safety measure, not a final decision.');
end;
$function$;

revoke all on function tempa_private.apply_pending_review_restriction(uuid, integer) from public, anon, authenticated, service_role;


-- ============================================================
-- 3. SOLICITATION CODE SET
-- ============================================================
create or replace function tempa_private.solicitation_reason_codes()
returns text[]
language sql
immutable
set search_path to 'pg_catalog'
as $$
  select array[
    'DIRECT_MONEY_REQUEST', 'LOAN_OR_BILL_REQUEST', 'PAYMENT_DETAILS',
    'CRYPTO_SOLICITATION', 'INVESTMENT_SOLICITATION', 'GIFT_CARD_REQUEST',
    'EMERGENCY_MONEY_REQUEST', 'MONEY_INTERMEDIARY_REQUEST'
  ]
$$;

revoke all on function tempa_private.solicitation_reason_codes() from public, anon, authenticated, service_role;


-- ============================================================
-- 4. EVALUATE_BEHAVIOR — REPEATED_SOLICITATION over distinct contexts,
--    with the automatic restriction (reproduced from
--    2026-10-03-safety-persistence.sql; ONLY that block changes)
-- ============================================================
create or replace function tempa_private.evaluate_behavior(
  p_subject_user_id uuid,
  p_first_contact_outreach_fingerprint text default null,
  p_new_content_reason_codes text[] default null,
  p_report_check boolean default false,
  p_block_check boolean default false
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_policy record;
  v_count integer;
  v_distinct_recipients integer;
  v_account_created_at timestamptz;
  v_last_status_reset timestamptz;
begin
  select * into v_policy from tempa_private.behavior_policy();

  if p_first_contact_outreach_fingerprint is not null then

    -- MASS_FIRST_CONTACT — raw first-contact volume, any recipients.
    select count(*) into v_count
    from public.letters
    where sender_id = p_subject_user_id
      and reply_to_id is null and question_answer_id is not null
      and created_at > now() - v_policy.mass_first_contact_window;

    if v_count >= v_policy.mass_first_contact_threshold then
      perform tempa_private.record_behavior_signal(
        p_subject_user_id, 'MASS_FIRST_CONTACT', v_policy.mass_first_contact_risk_band,
        v_policy.mass_first_contact_window,
        jsonb_build_object(
          'window_hours', extract(epoch from v_policy.mass_first_contact_window) / 3600,
          'first_contact_count', v_count
        ),
        v_policy.mass_first_contact_escalate
      );
    end if;

    -- HIGH_CONTACT_VELOCITY — distinct recipients in a short burst.
    select count(distinct recipient_id) into v_distinct_recipients
    from public.letters
    where sender_id = p_subject_user_id
      and reply_to_id is null and question_answer_id is not null
      and created_at > now() - v_policy.high_velocity_window;

    if v_distinct_recipients >= v_policy.high_velocity_distinct_recipients_threshold then
      perform tempa_private.record_behavior_signal(
        p_subject_user_id, 'HIGH_CONTACT_VELOCITY', v_policy.high_velocity_risk_band,
        v_policy.high_velocity_window,
        jsonb_build_object(
          'window_hours', extract(epoch from v_policy.high_velocity_window) / 3600,
          'distinct_recipients', v_distinct_recipients
        ),
        v_policy.high_velocity_escalate
      );
    end if;

    -- NEAR_DUPLICATE_OUTREACH — see outreach_fingerprint's own doc
    -- comment: exact/normalized-text match only, deliberately not fuzzy.
    select count(distinct context_id) into v_distinct_recipients
    from public.safety_evaluations
    where user_id = p_subject_user_id
      and surface = 'first_letter'
      and outreach_fingerprint = p_first_contact_outreach_fingerprint
      and created_at > now() - v_policy.near_duplicate_window;

    if v_distinct_recipients >= v_policy.near_duplicate_distinct_recipients_threshold then
      perform tempa_private.record_behavior_signal(
        p_subject_user_id, 'NEAR_DUPLICATE_OUTREACH', v_policy.near_duplicate_risk_band,
        v_policy.near_duplicate_window,
        jsonb_build_object(
          'window_hours', extract(epoch from v_policy.near_duplicate_window) / 3600,
          'distinct_recipients_same_pitch', v_distinct_recipients
        ),
        v_policy.near_duplicate_escalate
      );
    end if;

    -- ACCOUNT_VELOCITY — context, not guilt: only ever fires when BOTH a
    -- genuinely new account AND a meaningfully elevated velocity co-
    -- occur, at this check's own (lower) threshold — never on account
    -- age alone, and never for an established account no matter how
    -- fast it is writing (that is HIGH_CONTACT_VELOCITY's own job,
    -- above, entirely independent of account age).
    select created_at into v_account_created_at from auth.users where id = p_subject_user_id;

    if v_account_created_at is not null
       and v_account_created_at > now() - v_policy.account_velocity_new_account_age
    then
      select count(distinct recipient_id) into v_distinct_recipients
      from public.letters
      where sender_id = p_subject_user_id
        and reply_to_id is null and question_answer_id is not null
        and created_at > now() - v_policy.account_velocity_window;

      if v_distinct_recipients >= v_policy.account_velocity_distinct_recipients_threshold then
        perform tempa_private.record_behavior_signal(
          p_subject_user_id, 'ACCOUNT_VELOCITY', v_policy.account_velocity_risk_band,
          v_policy.account_velocity_window,
          jsonb_build_object(
            'window_hours', extract(epoch from v_policy.account_velocity_window) / 3600,
            'distinct_recipients', v_distinct_recipients,
            'account_age_hours', extract(epoch from now() - v_account_created_at) / 3600
          ),
          v_policy.account_velocity_escalate
        );
      end if;
    end if;

  end if;

  if p_new_content_reason_codes is not null
     and p_new_content_reason_codes && tempa_private.solicitation_reason_codes()
  then
    -- PHASE 1: only QUALIFYING attempts count (a financial-solicitation
    -- attempt that was DENIED — see safety_attempt_evidence.qualifying),
    -- and what is counted is DISTINCT RECIPIENT/CORRESPONDENCE CONTEXTS
    -- (target_key), not raw attempts or evaluations: rewriting the same
    -- letter to the same person five times is five attempts but ONE
    -- context, so it can never add up to three "victims". Contact-
    -- sharing / off-platform mentions are not solicitation codes and
    -- never count. Attempts made before the account's last restore-to-
    -- active are not counted again (a falsely restricted member who was
    -- restored is not re-restricted by the very evidence that was
    -- reviewed and dismissed).
    select s.changed_at into v_last_status_reset
    from public.account_enforcement_state s
    where s.user_id = p_subject_user_id and s.status = 'active';

    select count(distinct e.target_key) into v_count
    from public.safety_attempt_evidence e
    where e.user_id = p_subject_user_id
      and e.qualifying
      and e.target_key is not null
      and e.created_at > now() - v_policy.repeated_solicitation_window
      and e.created_at > coalesce(v_last_status_reset, '-infinity'::timestamptz);

    if v_count >= v_policy.repeated_solicitation_distinct_contexts_threshold then
      perform tempa_private.record_behavior_signal(
        p_subject_user_id, 'REPEATED_SOLICITATION', v_policy.repeated_solicitation_risk_band,
        v_policy.repeated_solicitation_window,
        jsonb_build_object(
          'window_hours', extract(epoch from v_policy.repeated_solicitation_window) / 3600,
          'distinct_contexts', v_count
        ),
        v_policy.repeated_solicitation_escalate
      );

      -- The LOCKED automatic restriction: three qualifying attempts to
      -- three distinct contexts inside the rolling window place the
      -- account RESTRICTED — PENDING REVIEW. Restriction only — never a
      -- permanent ban (that stays a human decision).
      perform tempa_private.apply_pending_review_restriction(p_subject_user_id, v_count);
    end if;
  end if;

  if p_report_check then
    select count(distinct reporter_user_id) into v_count
    from public.reports
    where reported_user_id = p_subject_user_id
      and created_at > now() - v_policy.report_spike_window;

    if v_count >= v_policy.report_spike_distinct_reporters_threshold then
      perform tempa_private.record_behavior_signal(
        p_subject_user_id, 'REPORT_SPIKE', v_policy.report_spike_risk_band,
        v_policy.report_spike_window,
        jsonb_build_object(
          'window_hours', extract(epoch from v_policy.report_spike_window) / 3600,
          'distinct_reporters', v_count
        ),
        v_policy.report_spike_escalate
      );
    end if;
  end if;

  if p_block_check then
    select count(*) into v_count
    from public.blocked_users
    where blocked_id = p_subject_user_id
      and created_at > now() - v_policy.block_spike_window;

    if v_count >= v_policy.block_spike_threshold then
      perform tempa_private.record_behavior_signal(
        p_subject_user_id, 'BLOCK_SPIKE', v_policy.block_spike_risk_band,
        v_policy.block_spike_window,
        jsonb_build_object(
          'window_hours', extract(epoch from v_policy.block_spike_window) / 3600,
          'distinct_blockers', v_count
        ),
        v_policy.block_spike_escalate
      );
    end if;
  end if;

end;
$function$;

revoke all on function tempa_private.evaluate_behavior(uuid, text, text[], boolean, boolean) from public, anon, authenticated, service_role;


-- ============================================================
-- 5. RECORD_SAFETY_EVALUATION — also records the attempt as evidence
--    (reproduced from the 42702 repair; ONLY the evidence insert is new)
-- ============================================================
create or replace function public.record_safety_evaluation(
  p_user_id uuid,
  p_surface text,
  p_context_id uuid,
  p_question_answer_id uuid,
  p_secondary_context_id uuid,
  p_title text,
  p_topics text[],
  p_postcard jsonb,
  p_body text,
  p_risk_band text,
  p_reason_codes text[],
  p_mutation_disposition text,
  p_escalate_case boolean
)
returns table (
  evaluation_id uuid,
  expires_at timestamptz,
  is_new boolean
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_fingerprint text;
  v_outreach_fingerprint text;
  v_lock_key bigint;
  v_existing_id uuid;
  v_existing_expires_at timestamptz;
  v_existing_risk_band text;
  v_existing_reason_codes text[];
  v_existing_mutation_disposition text;
  v_existing_escalate_case boolean;
  v_new_id uuid;
  v_expires_at timestamptz;
  v_case_id uuid;
  v_signal_created boolean;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required.' using errcode = '22004';
  end if;

  if p_surface not in (
    'first_letter', 'reply', 'write_anytime',
    'dispatch_publish', 'dispatch_update', 'question_answer', 'dispatch_reply'
  ) then
    raise exception 'Unknown safety surface: %', p_surface using errcode = '22023';
  end if;

  if p_context_id is null then
    raise exception 'p_context_id is required.' using errcode = '22004';
  end if;

  if p_surface = 'first_letter' and p_question_answer_id is null then
    raise exception 'p_question_answer_id is required for first_letter.' using errcode = '22004';
  end if;

  if p_surface <> 'first_letter' and p_question_answer_id is not null then
    raise exception 'p_question_answer_id is only valid for first_letter.' using errcode = '22023';
  end if;

  if p_surface <> 'dispatch_reply' and p_secondary_context_id is not null then
    raise exception 'p_secondary_context_id is only valid for dispatch_reply.' using errcode = '22023';
  end if;

  if p_surface not in ('dispatch_publish', 'dispatch_update') and (p_title is not null or coalesce(array_length(p_topics, 1), 0) > 0) then
    raise exception 'p_title/p_topics are only valid for dispatch_publish/dispatch_update.' using errcode = '22023';
  end if;

  if p_surface = 'first_letter' and p_postcard is not null then
    raise exception 'first_letter has no Postcard.' using errcode = '22023';
  end if;

  if p_surface in ('question_answer', 'dispatch_reply', 'dispatch_update') and p_postcard is not null then
    raise exception '% has no Postcard.', p_surface using errcode = '22023';
  end if;

  if p_body is null or length(trim(both from p_body)) = 0 then
    raise exception 'p_body must not be empty.' using errcode = '22023';
  end if;

  if p_risk_band not in ('none', 'weak', 'meaningful', 'high', 'severe') then
    raise exception 'Unknown risk band: %', p_risk_band using errcode = '22023';
  end if;

  if p_mutation_disposition not in ('allow', 'warn', 'deny') then
    raise exception 'Unknown mutation disposition: %', p_mutation_disposition using errcode = '22023';
  end if;

  v_fingerprint := tempa_private.safety_fingerprint(
    p_user_id, p_surface, p_context_id, p_question_answer_id, p_secondary_context_id, p_title, p_topics, p_postcard, p_body
  );

  -- Checkpoint 5 — see outreach_fingerprint's own column comment above.
  -- Computed regardless of dedup outcome below (cheap, pure) but only
  -- ever stored for first_letter; null for every other surface.
  if p_surface = 'first_letter' then
    v_outreach_fingerprint := tempa_private.outreach_fingerprint(p_user_id, p_body);
  end if;

  -- Concurrency guard — see this section's own header comment. Must run
  -- BEFORE the dedup lookup below, not after.
  v_lock_key := ('x' || substr(v_fingerprint, 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  select e.id, e.expires_at, e.risk_band, e.reason_codes, e.mutation_disposition, e.escalate_case
  into v_existing_id, v_existing_expires_at, v_existing_risk_band, v_existing_reason_codes,
       v_existing_mutation_disposition, v_existing_escalate_case
  from public.safety_evaluations e
  where e.user_id = p_user_id
    and e.surface = p_surface
    and e.context_id = p_context_id
    and e.fingerprint = v_fingerprint
    and e.consumed_at is null
    and e.expires_at > now()
  order by e.created_at desc
  limit 1;

  if v_existing_id is not null then
    if v_existing_risk_band = p_risk_band
       and v_existing_reason_codes = coalesce(p_reason_codes, '{}')
       and v_existing_mutation_disposition = p_mutation_disposition
       and v_existing_escalate_case = p_escalate_case
    then
      return query select v_existing_id, v_existing_expires_at, false;
      return;
    end if;

    -- Stale policy — see this section's own header comment. Invalidate
    -- immediately so it can never be dedup-matched again, then fall
    -- through to record a fresh evaluation below.
    update public.safety_evaluations set expires_at = now() where id = v_existing_id;
  end if;

  v_expires_at := now() + interval '15 minutes';

  -- warning_issued_at is set HERE, not left for a later step: the HTTP
  -- response this same request produces (buildEvaluateResponse, lib/
  -- safety/route-contract.ts) is itself "the server actually serving
  -- that warning copy to the member" — there is no separate later
  -- moment to distinguish it from for a warn disposition.
  insert into public.safety_evaluations (
    user_id, surface, context_id, question_answer_id, secondary_context_id, fingerprint,
    outreach_fingerprint,
    risk_band, reason_codes, mutation_disposition, escalate_case,
    warning_required, warning_issued_at, expires_at
  ) values (
    p_user_id, p_surface, p_context_id, p_question_answer_id, p_secondary_context_id, v_fingerprint,
    v_outreach_fingerprint,
    p_risk_band, coalesce(p_reason_codes, '{}'), p_mutation_disposition, p_escalate_case,
    (p_mutation_disposition = 'warn'),
    case when p_mutation_disposition = 'warn' then now() else null end,
    v_expires_at
  )
  returning id into v_new_id;

  if p_escalate_case then
    insert into public.safety_cases (subject_user_id, status, highest_risk_band, signal_count)
    values (p_user_id, 'open', p_risk_band, 1)
    on conflict (subject_user_id) where status in ('open', 'reviewing')
    do update set
      signal_count = public.safety_cases.signal_count + 1,
      highest_risk_band = case
        when tempa_private.safety_risk_band_rank(excluded.highest_risk_band)
           > tempa_private.safety_risk_band_rank(public.safety_cases.highest_risk_band)
        then excluded.highest_risk_band
        else public.safety_cases.highest_risk_band
      end,
      updated_at = now()
    returning id into v_case_id;
  end if;

  -- A case must never gain signal_count without an actual linked
  -- signal — escalate_case is independent from risk_band (see the
  -- header comment and safety_signals' own widened domain above), so a
  -- signal is recorded whenever EITHER condition holds, not only when
  -- the band itself is meaningful/high/severe.
  v_signal_created := p_risk_band in ('meaningful', 'high', 'severe') or p_escalate_case;
  if v_signal_created then
    insert into public.safety_signals (evaluation_id, user_id, surface, context_id, risk_band, reason_codes, case_id)
    values (v_new_id, p_user_id, p_surface, p_context_id, p_risk_band, coalesce(p_reason_codes, '{}'), v_case_id)
    on conflict on constraint safety_signals_evaluation_id_key do nothing;
  end if;

  -- PHASE 1 — the attempt itself is evidence. Whenever this evaluation
  -- produced a signal (band meaningful+ or escalated), the text that
  -- caused it is snapshotted into the ADMIN-ONLY safety_attempt_evidence
  -- table so a reviewer can read the actual attempt — including a
  -- denied attempt that was never sent, which exists nowhere else.
  -- Same transaction as the evaluation; cascades away with it. Written
  -- BEFORE the behavioral check below so that check can count it.
  if v_signal_created then
    insert into public.safety_attempt_evidence (
      evaluation_id, user_id, surface, target_key, reason_codes, risk_band,
      mutation_disposition, qualifying,
      attempted_title, attempted_topics, attempted_body, attempted_postcard
    ) values (
      v_new_id, p_user_id, p_surface,
      tempa_private.safety_target_key(p_user_id, p_surface, p_context_id),
      coalesce(p_reason_codes, '{}'), p_risk_band,
      p_mutation_disposition,
      (p_mutation_disposition = 'deny'
        and coalesce(p_reason_codes, '{}') && tempa_private.solicitation_reason_codes()),
      p_title, p_topics, left(p_body, 20000), p_postcard
    )
    on conflict on constraint safety_attempt_evidence_pkey do nothing;
  end if;

  -- Checkpoint 5 — behavioral state, evaluated at this content-
  -- evaluation mutation point (see tempa_private.evaluate_behavior's own
  -- header for the full timing rationale: first-contact volume/velocity/
  -- near-duplicate/account-velocity checks run for EVERY first_letter
  -- evaluation regardless of THIS evaluation's own risk band — they are
  -- about pattern, not this one message's content; REPEATED_SOLICITATION
  -- runs only when this evaluation actually produced a signal whose own
  -- reason codes qualify). Wrapped in its own exception-guarded block —
  -- a PL/pgSQL BEGIN/EXCEPTION is an implicit subtransaction (savepoint):
  -- if the behavioral check fails for any reason, execution rolls back
  -- to that savepoint only, is logged, and this function's own real
  -- work (the evaluation just recorded above) is completely unaffected
  -- and still returned/committed normally. A durable POST-EVENT
  -- observation, deliberately never allowed to become a dependency of
  -- evaluation succeeding — see this checkpoint's own migration header
  -- for why this, report_content, and block_user all use this same
  -- pattern rather than a bare `perform`.
  begin
    perform tempa_private.evaluate_behavior(
      p_user_id,
      v_outreach_fingerprint,
      case when v_signal_created then p_reason_codes else null end,
      false,
      false
    );
  exception when others then
    raise warning '[safety] evaluate_behavior failed for user %, surface %: %', p_user_id, p_surface, sqlerrm;
  end;

  return query select v_new_id, v_expires_at, true;
end;
$function$;

revoke all on function public.record_safety_evaluation(uuid, text, uuid, uuid, uuid, text, text[], jsonb, text, text, text[], text, boolean) from public;
grant execute on function public.record_safety_evaluation(uuid, text, uuid, uuid, uuid, text, text[], jsonb, text, text, text[], text, boolean) to service_role;


-- ============================================================
-- 6. CONSUME_SAFETY_EVALUATION — enforcement chokepoint + recipient
--    contact note (reproduced from 2026-10-03; two additions)
-- ============================================================
create or replace function tempa_private.consume_safety_evaluation(
  p_evaluation_id uuid,
  p_user_id uuid,
  p_surface text,
  p_context_id uuid,
  p_question_answer_id uuid,
  p_secondary_context_id uuid,
  p_title text,
  p_topics text[],
  p_postcard jsonb,
  p_body text,
  p_warning_acknowledged boolean,
  p_new_content_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_eval public.safety_evaluations;
  v_fingerprint text;
  v_status text;
begin
  select * into v_eval
  from public.safety_evaluations
  where id = p_evaluation_id
  for update;

  if not found then
    raise exception 'Safety evaluation not found.' using errcode = '22023';
  end if;

  if v_eval.user_id <> p_user_id then
    raise exception 'Safety evaluation does not belong to this member.' using errcode = '22023';
  end if;

  -- PHASE 1 — the ONE server-side chokepoint for "an account that may not
  -- write cannot write". Every authored-write RPC (send_first_letter,
  -- reply_to_letter, write_letter, publish_dispatch, update_dispatch,
  -- create_reply, publish_question_answer) must consume a Safety
  -- evaluation before it creates anything, so a RESTRICTED (including
  -- RESTRICTED — PENDING REVIEW), suspended or banned account is stopped
  -- here regardless of which route it used or whether a client-side
  -- check was bypassed. Nothing is consumed and nothing is created.
  select s.status into v_status
  from public.account_enforcement_state s
  where s.user_id = p_user_id;

  if coalesce(v_status, 'active') in ('restricted', 'suspended', 'banned') then
    raise exception 'This action is not available right now.' using errcode = '42501';
  end if;

  if v_eval.surface <> p_surface then
    raise exception 'Safety evaluation is for a different surface.' using errcode = '22023';
  end if;

  if v_eval.context_id <> p_context_id then
    raise exception 'Safety evaluation is for a different context.' using errcode = '22023';
  end if;

  if v_eval.question_answer_id is distinct from p_question_answer_id then
    raise exception 'Safety evaluation is for a different Question-answer.' using errcode = '22023';
  end if;

  -- Checkpoint 4 — a Safety evaluation for a top-level Reply must not be
  -- replayable for a nested Reply (or vice versa), and changing the
  -- parent target after evaluation must invalidate clearance. IS
  -- DISTINCT FROM is NULL-safe: both null (two top-level Replies) is a
  -- match; either side non-null and differing from the other is not.
  if v_eval.secondary_context_id is distinct from p_secondary_context_id then
    raise exception 'Safety evaluation is for a different target.' using errcode = '22023';
  end if;

  if v_eval.consumed_at is not null then
    raise exception 'This Safety evaluation has already been used.' using errcode = '22023';
  end if;

  if v_eval.expires_at <= now() then
    raise exception 'This Safety evaluation has expired. Please try again.' using errcode = '22023';
  end if;

  v_fingerprint := tempa_private.safety_fingerprint(
    p_user_id, p_surface, p_context_id, p_question_answer_id, p_secondary_context_id, p_title, p_topics, p_postcard, p_body
  );

  if v_fingerprint <> v_eval.fingerprint then
    raise exception 'This content has changed since it was last checked. Please try again.' using errcode = '22023';
  end if;

  if v_eval.mutation_disposition = 'deny' then
    raise exception 'This message cannot be sent.' using errcode = '22023';
  end if;

  -- IS NOT TRUE, never `not p_warning_acknowledged` — the latter is
  -- Postgres's ordinary three-valued boolean logic, where `not null` is
  -- itself null, not true, so `and not p_warning_acknowledged` silently
  -- fails to raise when p_warning_acknowledged is NULL (a NULL simply
  -- makes the whole `and` condition null, which `if` treats as false —
  -- the raise never fires). p_warning_acknowledged has no NOT NULL
  -- constraint (PL/pgSQL parameters never do), so a caller passing NULL
  -- must be rejected exactly like false, never silently treated as
  -- acknowledged. IS NOT TRUE is NULL-safe: true for both false and
  -- null, false only for an explicit true (independent audit correction).
  if v_eval.mutation_disposition = 'warn' and p_warning_acknowledged is not true then
    raise exception 'Please acknowledge the warning before sending.' using errcode = '22023';
  end if;

  update public.safety_evaluations
  set
    consumed_at = now(),
    -- Gated on BOTH the stored disposition actually being 'warn' AND an
    -- explicit true — an 'allow' evaluation submitted with
    -- p_warning_acknowledged = true must never create a fake warning
    -- acknowledgement in the audit record (independent audit correction).
    warning_acknowledged_at = case
      when v_eval.mutation_disposition = 'warn' and p_warning_acknowledged is true then now()
      else warning_acknowledged_at
    end
  where id = p_evaluation_id
    and consumed_at is null
    and expires_at > now();

  if not found then
    raise exception 'This Safety evaluation could not be consumed.' using errcode = '22023';
  end if;

  update public.safety_signals
  set source_content_id = p_new_content_id, proceeded_at = now()
  where evaluation_id = p_evaluation_id;

  -- PHASE 1 — a private letter whose sender shared personal contact
  -- details / an off-platform invitation carries a short, non-
  -- accusatory privacy note for its RECIPIENT. Attached at delivery
  -- time, in the same transaction as the letter (the FK is deferred
  -- until commit because this runs just before the letter INSERT).
  if p_surface in ('first_letter', 'reply', 'write_anytime')
     and p_new_content_id is not null
     and 'PERSONAL_CONTACT_SHARING' = any(v_eval.reason_codes)
  then
    insert into public.letter_safety_notices (letter_id, kind)
    values (p_new_content_id, 'contact_sharing')
    on conflict (letter_id) do nothing;
  end if;
end;
$function$;

revoke all on function tempa_private.consume_safety_evaluation(uuid, uuid, text, uuid, uuid, uuid, text, text[], jsonb, text, boolean, uuid) from public, anon, authenticated, service_role;


-- ============================================================
-- 7. ADMIN_SET_ACCOUNT_STATUS — official notices on restrict / restore /
--    permanent decision (reproduced from Checkpoint 8; one addition)
-- ============================================================
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

  -- PHASE 1 — every restriction / restore / permanent decision leaves an
  -- official "From Tempa" notice the member can read (member_notices).
  -- Audited above; the notice wording is Tempa's, never the reviewer's
  -- private reason text.
  if p_status = 'restricted' and v_old_status <> 'restricted' then
    insert into public.member_notices (user_id, kind, body)
    values (p_user_id, 'restriction_applied', 'We''ve temporarily restricted your account while we review activity that may conflict with Tempa''s safety rules.

You can still read your existing correspondence, but you won''t be able to write, reply, publish or comment during the review.

This is a temporary safety measure, not a final decision.');
  elsif p_status = 'active' and v_old_status in ('restricted', 'suspended') then
    insert into public.member_notices (user_id, kind, body)
    values (p_user_id, 'restriction_lifted', 'We''ve lifted the temporary restriction on your account. You can write, reply, publish and comment again.

Thank you for your patience while we reviewed your account.');
  elsif p_status = 'banned' and v_old_status <> 'banned' then
    insert into public.member_notices (user_id, kind, body)
    values (p_user_id, 'permanent_decision', 'After reviewing activity on your account, we have made a permanent decision that it can no longer be used on Tempa.

This decision was made by a person on the Tempa team, not automatically.');
  end if;

end;
$function$;

revoke all on function public.admin_set_account_status(uuid, text, text) from public;
grant execute on function public.admin_set_account_status(uuid, text, text) to authenticated;


-- ============================================================
-- 8. CLEANUP — retain evidence for accounts under enforcement
-- ============================================================
create or replace function public.cleanup_expired_safety_evaluations(
  p_retention interval default interval '30 days'
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_count integer;
begin
  delete from public.safety_evaluations e
  where e.expires_at < now() - p_retention
    and not exists (
      select 1
      from public.safety_signals s
      join public.safety_cases c on c.id = s.case_id
      where s.evaluation_id = e.id
        and c.status in ('open', 'reviewing')
    )
    -- PHASE 1 — evidence for an account that is currently restricted,
    -- suspended or banned is retained for as long as that state lasts
    -- (including a permanent ban's evidence), independent of case state.
    and not exists (
      select 1
      from public.account_enforcement_state st
      where st.user_id = e.user_id
        and st.status in ('restricted', 'suspended', 'banned')
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.cleanup_expired_safety_evaluations(interval) from public;
grant execute on function public.cleanup_expired_safety_evaluations(interval) to service_role;


-- ============================================================
-- 9. DISCOVERY — restricted/suspended/banned members are not discoverable
-- ============================================================
drop policy "Answers to active questions are readable by authenticated users"
  on public.question_answers;

create policy "Answers to active questions are readable by authenticated users"
  on public.question_answers
  for select
  to authenticated
  using (
    exists (
      select 1 from public.questions q
      where q.id = question_answers.question_id
        and q.is_active = true
    )
    and question_answers.moderation_status = 'visible'
    and not tempa_private.is_blocked_pair(auth.uid(), question_answers.user_id)
    and not tempa_private.hidden_from_discovery(auth.uid(), question_answers.user_id)
  );

create or replace function public.get_post_closure_recommendations(
  p_letter_id uuid
)
returns table (
  answer_id uuid,
  user_id uuid,
  question_id uuid,
  body text,
  pseudonym text,
  country text,
  gender text,
  gender_custom text,
  age_range text,
  prompt text
)
language plpgsql
security definer
set search_path to 'pg_catalog'
stable
as $function$

declare
  target public.letters;

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;


  select *
  into target

  from public.letters

  where
    id = p_letter_id
    and sender_id = auth.uid()
    and reply_to_id is null;


  if not found then
    raise exception
      'Letter not found or not a first-contact letter you sent.';
  end if;


  if
    target.status <> 'closed'
    and not (
      target.status = 'sent'
      and target.expires_at <= now()
    )
  then
    raise exception
      'Recommendations are only available once this letter has closed.';
  end if;


  return query

    select
      qa.id as answer_id,
      qa.user_id,
      qa.question_id,
      qa.body,
      p.pseudonym,
      p.country,
      p.gender,
      p.gender_custom,
      p.age_range,
      q.prompt

    from public.question_answers qa

    join public.questions q
      on q.id = qa.question_id
      and q.is_active = true

    join public.profiles p
      on p.id = qa.user_id

    where
      qa.is_current = true
      and qa.user_id <> auth.uid()
      and qa.user_id <> target.recipient_id
      and not tempa_private.is_blocked_pair(auth.uid(), qa.user_id)
      -- the one addition from this migration's first pass — never
      -- recommend a hidden answer.
      and qa.moderation_status = 'visible'
      -- PHASE 1 — never recommend a restricted/suspended/banned member.
      and not tempa_private.hidden_from_discovery(auth.uid(), qa.user_id)

    order by

      power(

        -- Deterministic u in (0, 1].
        (
          (
            (
              hashtext(
                p_letter_id::text
                || ':'
                || qa.id::text
              )
              & 2147483647
            )::bigint
            + 1
          )::double precision

          / 2147483648.0
        ),

        1.0 / (

          case

            when
              extract(
                epoch from (
                  now() - p.created_at
                )
              ) / 86400.0 <= 30
            then 1.5

            when
              extract(
                epoch from (
                  now() - p.created_at
                )
              ) / 86400.0 <= 90
            then 1.25

            else 1.0

          end

        )

      ) desc

    limit 3;

end;
$function$;

-- A banned member is not visible to other members at all. (Restricted
-- and suspended members stay visible on existing correspondence.)
create or replace view public.public_profiles
with (security_barrier = true)
as
select
  p.id,
  p.pseudonym,
  p.country,
  p.gender,
  p.gender_custom,
  p.age_range,
  p.languages,
  p.intent,
  p.pinned_dispatch_id,
  p.mark_id
from public.profiles p
where auth.uid() = p.id
   or (
     not tempa_private.is_blocked_pair(auth.uid(), p.id)
     and not tempa_private.account_is_banned(p.id)
   );

revoke all on public.public_profiles from anon;
revoke insert, update, delete, truncate, trigger, references
  on public.public_profiles from authenticated;
grant select on public.public_profiles to authenticated;


-- ============================================================
-- 10. ADMIN — the attempt evidence behind a case
-- ============================================================
-- Takes ONLY a case id; returns the subject's own qualifying/flagged
-- attempts (their text, surface, timestamps, reason codes) plus the
-- behavioural summary a reviewer needs. Recipients are shown only as
-- anonymous ordinals (Person A, B, C) — never ids or names — and no
-- other correspondence is ever read. Every call is audited.
create or replace function public.admin_get_safety_case_review(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_subject uuid;
  v_actor_pseudonym text;
  v_subject_pseudonym text;
  v_summary jsonb;
  v_attempts jsonb;
  v_state record;
  v_created_at timestamptz;
begin
  if not public.is_staff() then
    raise exception 'Not authorized.';
  end if;

  select c.subject_user_id into v_subject
  from public.safety_cases c
  where c.id = p_case_id;

  if v_subject is null then
    raise exception 'Case not found.';
  end if;

  select pseudonym into v_subject_pseudonym from public.profiles where id = v_subject;
  select u.created_at into v_created_at from auth.users u where u.id = v_subject;
  select s.status, s.status_reason, s.changed_by, s.changed_at
  into v_state
  from public.account_enforcement_state s
  where s.user_id = v_subject;

  v_summary := jsonb_build_object(
    'subject_pseudonym', v_subject_pseudonym,
    'account_created_at', v_created_at,
    'account_age_days', case when v_created_at is null then null else floor(extract(epoch from now() - v_created_at) / 86400) end,
    'account_status', coalesce(v_state.status, 'active'),
    'restriction_pending_review', coalesce(v_state.status = 'restricted' and v_state.changed_by is null, false),
    'status_changed_at', v_state.changed_at,
    'qualifying_attempts_72h', (
      select count(*) from public.safety_attempt_evidence e
      where e.user_id = v_subject and e.qualifying and e.created_at > now() - interval '72 hours'
    ),
    'distinct_contexts_72h', (
      select count(distinct e.target_key) from public.safety_attempt_evidence e
      where e.user_id = v_subject and e.qualifying and e.created_at > now() - interval '72 hours'
    ),
    'qualifying_attempts_total', (
      select count(*) from public.safety_attempt_evidence e where e.user_id = v_subject and e.qualifying
    ),
    'first_qualifying_attempt_at', (
      select min(e.created_at) from public.safety_attempt_evidence e where e.user_id = v_subject and e.qualifying
    ),
    'last_qualifying_attempt_at', (
      select max(e.created_at) from public.safety_attempt_evidence e where e.user_id = v_subject and e.qualifying
    ),
    'first_contacts_24h', (
      select count(*) from public.letters l
      where l.sender_id = v_subject and l.reply_to_id is null and l.question_answer_id is not null
        and l.created_at > now() - interval '24 hours'
    ),
    'distinct_first_contact_recipients_24h', (
      select count(distinct l.recipient_id) from public.letters l
      where l.sender_id = v_subject and l.reply_to_id is null and l.question_answer_id is not null
        and l.created_at > now() - interval '24 hours'
    ),
    'contact_sharing_evaluations_30d', (
      select count(*) from public.safety_evaluations ev
      where ev.user_id = v_subject and 'PERSONAL_CONTACT_SHARING' = any(ev.reason_codes)
        and ev.created_at > now() - interval '30 days'
    ),
    'behavioral_signals_30d', coalesce((
      select jsonb_object_agg(t.code, t.n)
      from (
        select unnest(s.reason_codes) as code, count(*) as n
        from public.safety_signals s
        where s.user_id = v_subject and s.created_at > now() - interval '30 days'
        group by 1
      ) t
    ), '{}'::jsonb)
  );

  select coalesce(jsonb_agg(a.row order by a.created_at desc), '[]'::jsonb)
  into v_attempts
  from (
    select
      e.created_at,
      jsonb_build_object(
        'evaluation_id', e.evaluation_id,
        'created_at', e.created_at,
        'surface', e.surface,
        'recipient_ordinal', 'Person ' || chr(64 + dense_rank() over (order by e.target_key)::int),
        'reason_codes', e.reason_codes,
        'risk_band', e.risk_band,
        'mutation_disposition', e.mutation_disposition,
        'qualifying', e.qualifying,
        'sent', (e.mutation_disposition <> 'deny'),
        'attempted_title', e.attempted_title,
        'attempted_topics', e.attempted_topics,
        'attempted_body', e.attempted_body
      ) as row
    from public.safety_attempt_evidence e
    where e.user_id = v_subject
    order by e.created_at desc
    limit 50
  ) a;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot,
    reason, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'view_safety_attempt_evidence',
    'safety_case', p_case_id, coalesce(v_subject_pseudonym, v_subject::text),
    null,
    jsonb_build_object('attempts_returned', jsonb_array_length(v_attempts))
  );

  return jsonb_build_object('summary', v_summary, 'attempts', v_attempts);
end;
$function$;

revoke all on function public.admin_get_safety_case_review(uuid) from public;
grant execute on function public.admin_get_safety_case_review(uuid) to authenticated;

commit;
