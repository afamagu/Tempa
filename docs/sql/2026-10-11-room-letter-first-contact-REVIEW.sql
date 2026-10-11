-- REVIEW-ONLY SCRIPT: room-first-contact transactional migration, prepared from LIVE
-- pg_get_functiondef on 2026-10-11. NOT APPLIED TO PRODUCTION.
-- Before deployment: test on disposable DB clone, diff definitions, run full
-- database/security tests, generate a proper Supabase CLI migration and verify
-- grants/rollback. Owner authorization required before production DDL.
--
-- Dependency order: CHECK domains -> authorization/recording -> behavior
-- -> common sender core -> legacy wrapper and new member-only wrapper.
-- The old Question answer path retains the same public RPC signature.
begin;


-- Preserve past first-letter evidence; enforce the two distinct source contracts.
alter table public.safety_evaluations
  drop constraint safety_evaluations_surface_check,
  add constraint safety_evaluations_surface_check check (
    surface in ('first_letter','first_letter_from_room_letter','reply','write_anytime',
      'dispatch_publish','dispatch_update','question_answer','dispatch_reply',
      'behavior_mass_first_contact','behavior_near_duplicate_outreach',
      'behavior_high_contact_velocity','behavior_repeated_solicitation',
      'behavior_report_spike','behavior_block_spike','behavior_account_velocity')
  );
alter table public.safety_evaluations
  drop constraint safety_evaluations_question_answer_id_matches_surface,
  add constraint safety_evaluations_question_answer_id_matches_surface check (
    (surface='first_letter' and question_answer_id is not null)
    or (surface <> 'first_letter' and question_answer_id is null)
  );
alter table public.safety_evaluations
  drop constraint safety_evaluations_secondary_context_id_only_for_dispatch_reply,
  add constraint safety_evaluations_secondary_context_id_only_for_dispatch_reply check (
    (surface='first_letter_from_room_letter' and secondary_context_id is not null)
    or (surface <> 'first_letter_from_room_letter'
      and (secondary_context_id is null or surface='dispatch_reply'))
  );


CREATE OR REPLACE FUNCTION public.can_evaluate_safety_context(p_surface text, p_context_id uuid, p_question_answer_id uuid, p_secondary_context_id uuid, p_postcard jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_corr public.correspondences;
  v_recipient uuid;
  v_status text;
  v_first_letter_corr public.correspondences;
  v_reply_letter public.letters;
  v_dispatch_row record;
  v_question_active boolean;
  v_answer_moderation_status text;
  v_reply_dispatch record;
  v_parent_reply record;
  v_first_contact_attempt_count integer;
  v_previous_first_letter public.letters%rowtype;
begin
  if auth.uid() is null then
    return false;
  end if;

  if p_context_id is null then
    return false;
  end if;

  if p_surface in ('first_letter', 'first_letter_from_room_letter') then
    if p_context_id = auth.uid() then
      return false;
    end if;

    if public.current_account_status() in ('restricted', 'suspended', 'banned') then
      return false;
    end if;

    if tempa_private.is_correspondence_blocked_pair(auth.uid(), p_context_id) then
      return false;
    end if;

    if not exists (select 1 from public.profiles where id = p_context_id) then
      return false;
    end if;

    if p_surface = 'first_letter_from_room_letter' then
      if p_question_answer_id is not null or p_secondary_context_id is null then
        return false;
      end if;
      if not exists (
        select 1 from public.dispatches d
        where d.id = p_secondary_context_id
          and d.author_id = p_context_id
          and d.status = 'published'
          and d.moderation_status = 'visible'
          and coalesce(d.published_as,'member')='member'
          and not tempa_private.is_blocked_pair(auth.uid(), d.author_id)
          and tempa_private.author_content_publicly_visible(d.author_id)
      ) then
        return false;
      end if;
    elsif p_question_answer_id is null or p_secondary_context_id is not null then
      return false;
    end if;

    select count(*)::integer
    into v_first_contact_attempt_count
    from public.letters l
    where l.sender_id = auth.uid()
      and l.recipient_id = p_context_id
      and l.reply_to_id is null
      and (
        l.question_answer_id is not null
        or exists (select 1 from public.dispatch_letter_contexts src where src.letter_id=l.id)
      );

    select l.*
    into v_previous_first_letter
    from public.letters l
    where l.sender_id = auth.uid()
      and l.recipient_id = p_context_id
      and l.reply_to_id is null
      and (
        l.question_answer_id is not null
        or exists (select 1 from public.dispatch_letter_contexts src where src.letter_id=l.id)
      )
    order by l.created_at desc
    limit 1;

    if v_first_contact_attempt_count = 0 then
      if p_surface = 'first_letter' and not exists (
        select 1
        from public.question_answers qa
        join public.questions q on q.id = qa.question_id
        where qa.id = p_question_answer_id
          and qa.user_id = p_context_id
          and ((qa.is_current = true and q.is_active = true) or public.room_answer_can_start_letter(qa.id, qa.user_id))
      ) then
        return false;
      end if;
    elsif v_first_contact_attempt_count = 1 then
      if not (
        (
          v_previous_first_letter.status = 'sent'
          or (
            v_previous_first_letter.status = 'closed'
            and v_previous_first_letter.closed_by = 'system'
          )
        )
        and v_previous_first_letter.created_at <= now() - interval '7 days'
        and (
          (p_surface = 'first_letter'
           and p_question_answer_id = v_previous_first_letter.question_answer_id
           and exists (
             select 1 from public.question_answers qa
             where qa.id = p_question_answer_id and qa.user_id = p_context_id
           ))
          or
          (p_surface = 'first_letter_from_room_letter'
           and v_previous_first_letter.question_answer_id is null
           and exists (
             select 1 from public.dispatch_letter_contexts src
             where src.letter_id=v_previous_first_letter.id
               and src.dispatch_id=p_secondary_context_id
           ))
        )
      ) then
        return false;
      end if;
    else
      return false;
    end if;

    -- Correspondence-state check — see this section's own header
    -- comment. Read-only: no insert, no FOR UPDATE.
    select * into v_first_letter_corr
    from public.correspondences c
    where c.participant_low = least(auth.uid(), p_context_id)
      and c.participant_high = greatest(auth.uid(), p_context_id)
      and c.status in ('pending', 'active');

    if found then
      if v_first_letter_corr.status = 'active' or v_first_letter_corr.established_at is not null then
        return false;
      end if;

    end if;

    return true;

  elsif p_surface = 'reply' then
    select * into v_reply_letter
    from public.letters l
    where l.id = p_context_id
      and l.recipient_id = auth.uid()
      and l.deliver_at <= now()
      and (
        (l.reply_to_id is not null and l.status = 'sent')
        or
        (
          l.reply_to_id is null
          and (
            l.status = 'sent'
            or (l.status = 'closed' and l.closed_by = 'system')
          )
        )
      );

    if not found then
      return false;
    end if;

    if tempa_private.is_correspondence_blocked_pair(auth.uid(), v_reply_letter.sender_id) then
      return false;
    end if;

    v_status := public.current_account_status();

    if v_status in ('suspended', 'banned') then
      return false;
    end if;

    if p_postcard is not null then
      if v_status = 'restricted' then
        return false;
      end if;

      -- A first, establishing reply cannot carry a Postcard — mirrors
      -- reply_to_letter's own `if is_first_reply then raise 'A Postcard
      -- is not available until after your first reply...'`. Unlike
      -- write_anytime below, reply_to_letter's own Postcard block never
      -- checks moments_qualified_for_viewer — preserved here exactly as
      -- the real RPC currently permits it (independent audit correction).
      if v_reply_letter.reply_to_id is null then
        return false;
      end if;

      if not tempa_private.postcard_shape_is_valid(p_postcard) then
        return false;
      end if;
    end if;

    return true;

  elsif p_surface = 'write_anytime' then
    select * into v_corr from public.correspondences where id = p_context_id;

    if not found then
      return false;
    end if;

    if auth.uid() <> v_corr.participant_low and auth.uid() <> v_corr.participant_high then
      return false;
    end if;

    v_recipient := case when auth.uid() = v_corr.participant_low then v_corr.participant_high else v_corr.participant_low end;

    if tempa_private.is_correspondence_blocked_pair(auth.uid(), v_recipient) then
      return false;
    end if;

    v_status := public.current_account_status();

    if v_status in ('suspended', 'banned') then
      return false;
    end if;

    if p_postcard is not null then
      if v_status = 'restricted' then
        return false;
      end if;

      -- write_letter's own Postcard block additionally requires
      -- moments_qualified_for_viewer — reply_to_letter's own does NOT
      -- (see the reply branch above); preserved as a genuinely
      -- surface-specific rule, not folded into postcard_shape_is_valid
      -- (independent audit correction).
      if not public.moments_qualified_for_viewer(p_context_id) then
        return false;
      end if;

      if not tempa_private.postcard_shape_is_valid(p_postcard) then
        return false;
      end if;
    end if;

    return v_corr.status = 'active' and v_corr.established_at is not null;

  -- ============================================================
  -- Checkpoint 4 — public text surfaces. Every check below is copied
  -- from the actual live RPC bodies (docs/sql/2026-09-28-title-postcard-
  -- and-edit-window.sql's publish_dispatch/update_dispatch, docs/sql/
  -- 2026-09-29-your-mark-production.sql's publish_question_answer,
  -- docs/sql/2026-09-23-dispatch-replies.sql's create_reply), re-read
  -- directly before writing this, not from memory. Title/topic/body
  -- length ceilings are NOT re-checked here — those are pure, DB-free
  -- product-shape rules, mirrored once in lib/safety/route-contract.ts
  -- against the SAME exported constants lib/dispatches.ts/lib/
  -- replies.ts already use (TITLE_MAX_CHARS/TOPIC_MAX_CHARS/
  -- TOPIC_MAX_COUNT/REPLY_MAX_CHARS), the same split already established
  -- for first_letter's own 2,000-char cap — this function only ever
  -- checks what actually needs a database read.
  -- ============================================================

  elsif p_surface = 'dispatch_publish' then
    -- No pre-existing Dispatch id at evaluation time — the trusted
    -- publish-context identity is the acting member's own auth.uid(),
    -- derived server-side (see this migration's own header note on
    -- safety_evaluations.context_id and lib/safety/route-contract.ts) —
    -- never a client-invented placeholder UUID. The Route Handler is
    -- what actually sets p_context_id := the authenticated user's own
    -- id; this check merely confirms that binding was honored.
    if p_context_id <> auth.uid() then
      return false;
    end if;

    -- publish_dispatch's own top-level gate is a single blanket check —
    -- unlike write_letter/reply_to_letter, 'restricted' blocks
    -- publishing a Dispatch AT ALL here, not merely a Postcard/Moment
    -- attachment, so there is no separate restricted-Postcard branch
    -- the way reply/write_anytime above have one.
    if public.current_account_status() in ('restricted', 'suspended', 'banned') then
      return false;
    end if;

    if p_postcard is not null and not tempa_private.postcard_shape_is_valid(p_postcard) then
      return false;
    end if;

    return true;

  elsif p_surface = 'dispatch_update' then
    if public.current_account_status() in ('restricted', 'suspended', 'banned') then
      return false;
    end if;

    -- update_dispatch has no p_postcard parameter at all — never invent
    -- one here either.
    if p_postcard is not null then
      return false;
    end if;

    select id, published_at into v_dispatch_row
    from public.dispatches
    where id = p_context_id
      and author_id = auth.uid()
      and status = 'published';

    if not found then
      return false;
    end if;

    -- The 30-minute post-publish edit window — published_at is the only
    -- authoritative anchor, exactly like update_dispatch's own check.
    if now() > v_dispatch_row.published_at + interval '30 minutes' then
      return false;
    end if;

    -- The Reply lock — bare row EXISTENCE, deliberately unfiltered by
    -- moderation_status/deleted_at, matching update_dispatch's own
    -- check exactly (no dispatch_replies row can ever be hard-deleted).
    if exists (select 1 from public.dispatch_replies where dispatch_id = p_context_id) then
      return false;
    end if;

    return true;

  elsif p_surface = 'question_answer' then
    if public.current_account_status() in ('restricted', 'suspended', 'banned') then
      return false;
    end if;

    -- publish_question_answer's own is_active check is NULL-tolerant in
    -- a specific way (a nonexistent p_question_id never raises from that
    -- check alone — SELECT INTO leaves the variable NULL, and `is not
    -- null and not v_question_active` is then simply false) — mirrored
    -- exactly below, EXCEPT this function additionally confirms the
    -- Question actually exists at all: an evaluation must not be
    -- authorized for a target that would fail with a foreign-key
    -- violation the instant the real INSERT ran, which is exactly the
    -- "payload the mutation could never accept" case this checkpoint
    -- exists to close — never a "fix" to publish_question_answer's own
    -- accepted behavior, which is untouched.
    if not exists (select 1 from public.questions where id = p_context_id) then
      return false;
    end if;

    select is_active into v_question_active from public.questions where id = p_context_id;
    if v_question_active is not null and not v_question_active then
      return false;
    end if;

    -- The hidden-answer freeze — mirrors publish_question_answer's own
    -- `if existing_moderation_status = 'hidden' then raise`.
    select moderation_status into v_answer_moderation_status
    from public.question_answers
    where user_id = auth.uid() and question_id = p_context_id;

    if v_answer_moderation_status = 'hidden' then
      return false;
    end if;

    return true;

  elsif p_surface = 'dispatch_reply' then
    if public.current_account_status() in ('restricted', 'suspended', 'banned') then
      return false;
    end if;

    select id, author_id, status, moderation_status into v_reply_dispatch
    from public.dispatches
    where id = p_context_id;

    if not found then
      return false;
    end if;

    -- LOCKED RULE, no exception for the Dispatch's own author — mirrors
    -- create_reply's own unconditional gate exactly.
    if v_reply_dispatch.status <> 'published' or v_reply_dispatch.moderation_status <> 'visible' then
      return false;
    end if;

    -- Full-scope block, either direction — the SAME helper create_reply
    -- itself uses (tempa_private.is_blocked_pair, never
    -- is_correspondence_blocked_pair: a Letters-scope Stop letters block
    -- must have zero effect here).
    if tempa_private.is_blocked_pair(auth.uid(), v_reply_dispatch.author_id)
       or not tempa_private.author_content_publicly_visible(v_reply_dispatch.author_id) then
      return false;
    end if;

    if p_secondary_context_id is not null then
      select id, dispatch_id, author_id, moderation_status, deleted_at into v_parent_reply
      from public.dispatch_replies
      where id = p_secondary_context_id;

      if not found then
        return false;
      end if;

      if v_parent_reply.dispatch_id <> p_context_id then
        return false;
      end if;

      -- A moderator-hidden OR member-deleted parent is not a legitimate
      -- new-Reply target — mirrors create_reply's own check exactly.
      if v_parent_reply.moderation_status <> 'visible' or v_parent_reply.deleted_at is not null then
        return false;
      end if;

      if tempa_private.is_blocked_pair(auth.uid(), v_parent_reply.author_id)
         or not tempa_private.author_content_publicly_visible(v_parent_reply.author_id) then
        return false;
      end if;
    end if;

    return true;

  else
    return false;
  end if;
end;
$function$


CREATE OR REPLACE FUNCTION public.record_safety_evaluation(p_user_id uuid, p_surface text, p_context_id uuid, p_question_answer_id uuid, p_secondary_context_id uuid, p_title text, p_topics text[], p_postcard jsonb, p_body text, p_risk_band text, p_reason_codes text[], p_mutation_disposition text, p_escalate_case boolean)
 RETURNS TABLE(evaluation_id uuid, expires_at timestamp with time zone, is_new boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
    'first_letter', 'first_letter_from_room_letter', 'reply', 'write_anytime',
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

  if p_surface = 'first_letter_from_room_letter' and p_secondary_context_id is null then
    raise exception 'p_secondary_context_id must identify the Room letter.' using errcode='22004';
  end if;
  if p_surface not in ('dispatch_reply','first_letter_from_room_letter') and p_secondary_context_id is not null then
    raise exception 'p_secondary_context_id is only valid for a dispatch reply or Room-letter first contact.' using errcode='22023';
  end if;

  if p_surface not in ('dispatch_publish', 'dispatch_update') and (p_title is not null or coalesce(array_length(p_topics, 1), 0) > 0) then
    raise exception 'p_title/p_topics are only valid for dispatch_publish/dispatch_update.' using errcode = '22023';
  end if;

  if p_surface in ('first_letter','first_letter_from_room_letter') and p_postcard is not null then
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
  if p_surface in ('first_letter','first_letter_from_room_letter') then
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
$function$


CREATE OR REPLACE FUNCTION tempa_private.consume_safety_evaluation(p_evaluation_id uuid, p_user_id uuid, p_surface text, p_context_id uuid, p_question_answer_id uuid, p_secondary_context_id uuid, p_title text, p_topics text[], p_postcard jsonb, p_body text, p_warning_acknowledged boolean, p_new_content_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
  if p_surface in ('first_letter', 'first_letter_from_room_letter', 'reply', 'write_anytime')
     and p_new_content_id is not null
     and 'PERSONAL_CONTACT_SHARING' = any(v_eval.reason_codes)
  then
    insert into public.letter_safety_notices (letter_id, kind)
    values (p_new_content_id, 'contact_sharing')
    on conflict (letter_id) do nothing;
  end if;
end;
$function$


CREATE OR REPLACE FUNCTION tempa_private.evaluate_behavior(p_subject_user_id uuid, p_first_contact_outreach_fingerprint text DEFAULT NULL::text, p_new_content_reason_codes text[] DEFAULT NULL::text[], p_report_check boolean DEFAULT false, p_block_check boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
      and reply_to_id is null
      and (
        question_answer_id is not null or exists (
          select 1 from public.dispatch_letter_contexts src
          where src.letter_id = letters.id
        )
      )
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
      and reply_to_id is null
      and (
        question_answer_id is not null or exists (
          select 1 from public.dispatch_letter_contexts src
          where src.letter_id = letters.id
        )
      )
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
      and surface in ('first_letter','first_letter_from_room_letter')
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
        and reply_to_id is null
      and (
        question_answer_id is not null or exists (
          select 1 from public.dispatch_letter_contexts src
          where src.letter_id = letters.id
        )
      )
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
$function$


CREATE OR REPLACE FUNCTION tempa_private.safety_target_key(p_user_id uuid, p_surface text, p_context_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_other uuid;
begin
  if p_surface in ('first_letter','first_letter_from_room_letter') then
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
$function$


CREATE OR REPLACE FUNCTION tempa_private.send_first_letter_core(p_recipient_id uuid, p_question_answer_id uuid, p_room_letter_id uuid, p_body text, p_safety_evaluation_id uuid, p_warning_acknowledged boolean DEFAULT false)
 RETURNS letters_for_participant
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_new_id uuid;
  v_correspondence_id uuid;
  v_participant_low uuid;
  v_participant_high uuid;
  v_correspondence_status text;
  v_established_at timestamptz;
  v_deliver_at timestamptz;
  v_expires_at timestamptz;
  v_attempt_count integer;
  v_previous_first_letter public.letters%rowtype;
  v_previous_correspondence public.correspondences%rowtype;
  result public.letters_for_participant;
  v_room public.dispatches%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if auth.uid() = p_recipient_id then
    raise exception 'You cannot write a first-contact letter to yourself.';
  end if;

  -- B6 correction — see this migration's own header comment. Placed
  -- early, alongside the other cheap param-only checks, before any row
  -- lookup.
  if char_length(p_body) > 2000 then
    raise exception 'This letter is too long.' using errcode = '22023';
  end if;

  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'Recipient does not exist.';
  end if;

  if tempa_private.is_correspondence_blocked_pair(auth.uid(), p_recipient_id) then
    raise exception 'Recipient does not exist.';
  end if;

  if not exists (
    select 1 from public.profiles where id = p_recipient_id
  ) then
    raise exception 'Recipient does not exist.';
  end if;

  -- These two independent source types can never be mixed or forged.
  -- The public Room source must be authored by the intended recipient.
  if p_room_letter_id is not null then
    if p_question_answer_id is not null then
      raise exception 'Choose one first-contact source.' using errcode='22023';
    end if;
    select d.* into v_room
      from public.dispatches d
     where d.id = p_room_letter_id
       and d.author_id = p_recipient_id
       and d.status = 'published'
       and d.moderation_status = 'visible'
       and coalesce(d.published_as, 'member') = 'member'
       and not tempa_private.is_blocked_pair(auth.uid(), d.author_id)
       and tempa_private.author_content_publicly_visible(d.author_id)
     for share;
    if not found then
      raise exception 'This letter is no longer available for first contact.' using errcode='P0002';
    end if;
  elsif p_question_answer_id is null then
    raise exception 'A first-contact source is required.' using errcode='22023';
  end if;

  v_participant_low := least(auth.uid(), p_recipient_id);
  v_participant_high := greatest(auth.uid(), p_recipient_id);

  perform tempa_private.lock_relationship_capacity_pair(
    v_participant_low,
    v_participant_high
  );

  select count(*)::integer
  into v_attempt_count
  from public.letters l
  where l.sender_id = auth.uid()
    and l.recipient_id = p_recipient_id
    and l.reply_to_id is null
    and (
      l.question_answer_id is not null
      or exists (select 1 from public.dispatch_letter_contexts src where src.letter_id=l.id)
    );

  select l.*
  into v_previous_first_letter
  from public.letters l
  where l.sender_id = auth.uid()
    and l.recipient_id = p_recipient_id
    and l.reply_to_id is null
    and (
      l.question_answer_id is not null
      or exists (select 1 from public.dispatch_letter_contexts src where src.letter_id=l.id)
    )
  order by l.created_at desc
  limit 1
  for update;

  if v_attempt_count = 0 then
    if p_room_letter_id is null and not exists (
      select 1
      from public.question_answers qa
      join public.questions q on q.id = qa.question_id
      where qa.id = p_question_answer_id
        and qa.user_id = p_recipient_id
        and ((qa.is_current = true and q.is_active = true) or public.room_answer_can_start_letter(qa.id, qa.user_id))
    ) then
      raise exception
        'That Question answer is not currently a live Discovery entry for the intended recipient.';
    end if;

    insert into public.correspondences(participant_low, participant_high)
    values (v_participant_low, v_participant_high)
    on conflict (participant_low, participant_high)
      where status = any (array['pending'::text, 'active'::text, 'paused'::text])
    do nothing
    returning id into v_correspondence_id;

    if v_correspondence_id is null then
      select c.id, c.status, c.established_at
      into v_correspondence_id, v_correspondence_status, v_established_at
      from public.correspondences c
      where c.participant_low = v_participant_low
        and c.participant_high = v_participant_high
        and c.status in ('pending', 'active', 'paused')
      for update;
    else
      select c.status, c.established_at
      into v_correspondence_status, v_established_at
      from public.correspondences c
      where c.id = v_correspondence_id
      for update;
    end if;

    if v_correspondence_status = 'active' or v_established_at is not null then
      raise exception
        'This correspondence is already established. Use write_letter instead.';
    end if;
  elsif v_attempt_count = 1 then
    if v_previous_first_letter.status = 'closed'
       and v_previous_first_letter.closed_by = 'recipient' then
      raise exception 'The recipient passed on the first letter.'
        using errcode = 'P0001', detail = 'FIRST_CONTACT_RECIPIENT_PASSED';
    end if;

    if not (
      v_previous_first_letter.status = 'sent'
      or (
        v_previous_first_letter.status = 'closed'
        and v_previous_first_letter.closed_by = 'system'
      )
    ) then
      raise exception 'The first letter is no longer eligible for a follow-up.'
        using errcode = 'P0001', detail = 'FIRST_CONTACT_NOT_UNANSWERED';
    end if;

    if v_previous_first_letter.created_at > now() - interval '7 days' then
      raise exception 'A follow-up is not available yet.'
        using errcode = 'P0001', detail = 'FIRST_CONTACT_FOLLOW_UP_TOO_SOON';
    end if;

    if p_room_letter_id is not null then
      if v_previous_first_letter.question_answer_id is not null
         or not exists (
           select 1 from public.dispatch_letter_contexts src
           where src.letter_id = v_previous_first_letter.id
             and src.dispatch_id = p_room_letter_id
         ) then
        raise exception 'The follow-up source does not match the first letter.'
          using errcode='P0001', detail='FIRST_CONTACT_CONTEXT_MISMATCH';
      end if;
    elsif p_question_answer_id is distinct from v_previous_first_letter.question_answer_id
       or not exists (
         select 1 from public.question_answers qa
         where qa.id = p_question_answer_id and qa.user_id = p_recipient_id
       ) then
      raise exception 'The follow-up context does not match the first letter.'
        using errcode='P0001', detail='FIRST_CONTACT_CONTEXT_MISMATCH';
    end if;

    v_correspondence_id := v_previous_first_letter.correspondence_id;

    select c.*
    into v_previous_correspondence
    from public.correspondences c
    where c.id = v_correspondence_id
    for update;

    if not found
       or v_previous_correspondence.established_at is not null
       or v_previous_correspondence.status in ('active', 'paused')
       or v_previous_correspondence.ended_by is not null then
      raise exception 'This correspondence is no longer available for a follow-up.'
        using errcode = 'P0001', detail = 'FIRST_CONTACT_NOT_UNANSWERED';
    end if;

    if exists (
      select 1
      from public.correspondences c
      where c.id <> v_correspondence_id
        and c.participant_low = v_participant_low
        and c.participant_high = v_participant_high
        and c.status in ('pending', 'active', 'paused')
    ) then
      raise exception 'There is already another open correspondence episode with this member.'
        using errcode = 'P0001', detail = 'FIRST_CONTACT_OTHER_EPISODE_OPEN';
    end if;

    if v_previous_correspondence.status = 'closed' then
      update public.correspondences
      set status = 'pending',
          closed_at = null
      where id = v_correspondence_id;
    elsif v_previous_correspondence.status <> 'pending' then
      raise exception 'This correspondence is no longer available for a follow-up.'
        using errcode = 'P0001', detail = 'FIRST_CONTACT_NOT_UNANSWERED';
    end if;
  else
    raise exception 'The one follow-up has already been used.'
      using errcode = 'P0001', detail = 'FIRST_CONTACT_FOLLOW_UP_USED';
  end if;

  v_new_id := pg_catalog.gen_random_uuid();
  v_deliver_at := now();
  v_expires_at := v_deliver_at + interval '72 hours';

  -- Checkpoint 3 — the one trusted consumption path. first_letter has
  -- no Postcard (p_postcard is always null here). Placed after v_new_id
  -- is generated so the evaluation's own signal (if any) can be linked
  -- to this exact Letter, and before the actual insert so a denied/
  -- invalid/already-used evaluation blocks the Letter from ever being
  -- created.
  perform tempa_private.consume_safety_evaluation(
    p_safety_evaluation_id,
    auth.uid(),
    case when p_room_letter_id is null then 'first_letter' else 'first_letter_from_room_letter' end,
    p_recipient_id,
    p_question_answer_id,
    p_room_letter_id,
    null,
    null,
    null,
    p_body,
    p_warning_acknowledged,
    v_new_id
  );

  insert into public.letters(
    id, sender_id, recipient_id, question_answer_id, correspondence_id,
    body, deliver_at, expires_at
  ) values (
    v_new_id, auth.uid(), p_recipient_id, p_question_answer_id,
    v_correspondence_id, p_body, v_deliver_at, v_expires_at
  );

  if p_room_letter_id is not null then
    insert into public.dispatch_letter_contexts(letter_id,dispatch_id,title_snapshot)
    values(v_new_id,v_room.id,v_room.title);
  end if;

  select * into result
  from public.letters_for_participant
  where id = v_new_id;

  return result;
end;
$function$


create or replace function public.send_first_letter(p_recipient_id uuid, p_question_answer_id uuid, p_body text, p_safety_evaluation_id uuid, p_warning_acknowledged boolean DEFAULT false)
returns public.letters_for_participant language plpgsql security definer
set search_path to 'pg_catalog' as $$
begin
  return tempa_private.send_first_letter_core(p_recipient_id,p_question_answer_id,null,p_body,p_safety_evaluation_id,p_warning_acknowledged);
end;
$$;

create or replace function public.send_first_letter_from_room_letter(
  p_recipient_id uuid, p_room_letter_id uuid, p_body text,
  p_safety_evaluation_id uuid, p_warning_acknowledged boolean default false
) returns public.letters_for_participant language plpgsql security definer
set search_path to 'pg_catalog' as $$
begin
  return tempa_private.send_first_letter_core(p_recipient_id,null,p_room_letter_id,p_body,p_safety_evaluation_id,p_warning_acknowledged);
end;
$$;
-- A security-definer function in an exposed schema is never executable by anon or PUBLIC.
revoke all on function public.send_first_letter_from_room_letter(uuid,uuid,text,uuid,boolean) from public, anon;
grant execute on function public.send_first_letter_from_room_letter(uuid,uuid,text,uuid,boolean) to authenticated;
revoke all on function tempa_private.send_first_letter_core(uuid,uuid,uuid,text,uuid,boolean) from public, anon, authenticated;


commit;
