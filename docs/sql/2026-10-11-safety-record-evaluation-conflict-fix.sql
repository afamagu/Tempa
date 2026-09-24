-- ============================================================
-- TEMPA — SAFETY 2: FORWARD-ONLY PRODUCTION REPAIR OF
-- public.record_safety_evaluation (PostgreSQL error 42702)
-- STATUS: NOT EXECUTED — review, then run in the Supabase SQL editor.
-- Does NOT merge, deploy, or change any Safety policy.
-- ============================================================
--
-- WHAT IS BROKEN IN PRODUCTION
-- public.record_safety_evaluation is declared
--   RETURNS TABLE (evaluation_id uuid, expires_at timestamptz, is_new boolean)
-- In PL/pgSQL every RETURNS TABLE column is an output VARIABLE for the
-- whole function body. Its safety_signals insert used
--   ON CONFLICT (evaluation_id) DO NOTHING
-- where the conflict-target column name "evaluation_id" is also that
-- output variable's name, so PostgreSQL rejects the statement with
--   ERROR 42702: column reference "evaluation_id" is ambiguous
-- That statement only executes when a signal is created (risk band
-- meaningful / high / severe, or escalate_case), so band none/weak
-- evaluations (allow) worked while EVERY warn/deny evaluation raised,
-- rolled back its whole transaction, and reached the member as HTTP 500
-- -> the fail-closed "couldn't complete the safety check" copy. Nothing
-- meaningful was ever recorded (read-only production diagnostics
-- confirmed safety_signals = 0 and zero meaningful-or-higher
-- evaluations).
--
-- Reproduced on real PostgreSQL (PGlite): the ambiguous form errors with
-- 42702; ON CONFLICT ON CONSTRAINT <name> succeeds.
--
-- THE REPAIR (forward-only; no historical migration is edited)
-- Reproduces the CURRENT canonical definition from
-- docs/sql/2026-10-03-safety-persistence.sql (the only place this
-- function is defined) and changes EXACTLY ONE clause:
--   ON CONFLICT (evaluation_id) DO NOTHING
--     -> ON CONFLICT ON CONSTRAINT safety_signals_evaluation_id_key DO NOTHING
-- safety_signals_evaluation_id_key is the automatically named UNIQUE
-- constraint from safety_signals.evaluation_id's inline UNIQUE; its
-- existence in production was confirmed by read-only diagnostics.
-- ON CONSTRAINT names the constraint directly, so it cannot be confused
-- with an output variable. Signature, return shape, SECURITY DEFINER,
-- search_path, every validation, the dedup/advisory-lock logic, the case
-- upsert (its "on conflict (subject_user_id) where status in ..." target
-- is not an output-variable name, so it was never affected), the
-- Checkpoint 5 behavioral hook, and the grants are all unchanged.
--
-- Same signature => CREATE OR REPLACE is a true in-place replacement
-- (no DROP, no new overload). One BEGIN/COMMIT. Run
-- 2026-10-11-safety-record-evaluation-conflict-fix-verify.sql after.

begin;

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

commit;
