-- Tempa — restrained first-contact follow-up
-- 2026-10-08
--
-- Contract:
-- * one initial first-contact letter;
-- * if it remains unanswered, exactly one follow-up becomes available after 7 days;
-- * an explicit recipient pass is final;
-- * a third first-contact attempt is impossible;
-- * removing/hiding mail from a viewer's Letterbox never resets eligibility.
begin;

CREATE OR REPLACE FUNCTION public.send_first_letter(p_recipient_id uuid, p_question_answer_id uuid, p_body text, p_safety_evaluation_id uuid, p_warning_acknowledged boolean DEFAULT false)
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
    and l.question_answer_id is not null;

  select l.*
  into v_previous_first_letter
  from public.letters l
  where l.sender_id = auth.uid()
    and l.recipient_id = p_recipient_id
    and l.reply_to_id is null
    and l.question_answer_id is not null
  order by l.created_at desc
  limit 1
  for update;

  if v_attempt_count = 0 then
    if not exists (
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

    if p_question_answer_id is distinct from v_previous_first_letter.question_answer_id
       or not exists (
         select 1
         from public.question_answers qa
         where qa.id = p_question_answer_id
           and qa.user_id = p_recipient_id
       ) then
      raise exception 'The follow-up context does not match the first letter.'
        using errcode = 'P0001', detail = 'FIRST_CONTACT_CONTEXT_MISMATCH';
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
    'first_letter',
    p_recipient_id,
    p_question_answer_id,
    null,
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

  select * into result
  from public.letters_for_participant
  where id = v_new_id;

  return result;
end;
$function$

;

revoke all on function public.send_first_letter(uuid, uuid, text, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.send_first_letter(uuid, uuid, text, uuid, boolean)
  to authenticated;

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

  if p_surface = 'first_letter' then
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

    if p_question_answer_id is null then
      return false;
    end if;

    select count(*)::integer
    into v_first_contact_attempt_count
    from public.letters l
    where l.sender_id = auth.uid()
      and l.recipient_id = p_context_id
      and l.reply_to_id is null
      and l.question_answer_id is not null;

    select l.*
    into v_previous_first_letter
    from public.letters l
    where l.sender_id = auth.uid()
      and l.recipient_id = p_context_id
      and l.reply_to_id is null
      and l.question_answer_id is not null
    order by l.created_at desc
    limit 1;

    if v_first_contact_attempt_count = 0 then
      if not exists (
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
        and p_question_answer_id = v_previous_first_letter.question_answer_id
        and exists (
          select 1
          from public.question_answers qa
          where qa.id = p_question_answer_id
            and qa.user_id = p_context_id
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

;

revoke all on function public.can_evaluate_safety_context(text, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.can_evaluate_safety_context(text, uuid, uuid, uuid, jsonb)
  to authenticated;

commit;
