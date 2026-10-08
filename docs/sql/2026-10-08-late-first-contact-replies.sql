-- Tempa — late first-contact replies after the 72-hour reservation window
-- Prepared 2026-10-08. Forward-only.
--
-- Product rule:
-- * 72 hours limits how long a first letter reserves sender capacity.
-- * A recipient who already received the letter may still reply later.
-- * Explicit recipient rejection remains terminal.
-- * A late reply establishes only when both members have current capacity.
-- * A newer open correspondence for the same pair always wins.
begin;

CREATE OR REPLACE FUNCTION public.reply_to_letter(p_letter_id uuid, p_body text, p_safety_evaluation_id uuid, p_moments jsonb DEFAULT '[]'::jsonb, p_postcard jsonb DEFAULT NULL::jsonb, p_warning_acknowledged boolean DEFAULT false)
 RETURNS letters_for_participant
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$

declare
  original public.letters;
  corr public.correspondences;
  new_id uuid;
  result public.letters_for_participant;
  moment_count integer;
  paragraph_count integer;
  has_photo boolean;
  is_first_reply boolean;
  m jsonb;
  v_previous_deliver_at timestamptz;
  v_natural_deliver_at timestamptz;
  v_deliver_at timestamptz;
  v_status text;
  has_postcard boolean;
  v_postcard_key text;
  v_postcard_version_id uuid;
  v_reveal_line text;
  v_back_message text;
  v_sender_pseudonym text;

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;


  select *
  into original

  from public.letters

  where
    id = p_letter_id
    and recipient_id = auth.uid()
    and deliver_at <= now()
    and (
      (reply_to_id is not null and status = 'sent')
      or
      (
        reply_to_id is null
        and (
          status = 'sent'
          or (status = 'closed' and closed_by = 'system')
        )
      )
    )

  for update;


  if not found then
    raise exception
      'Letter not found, not addressed to you, or no longer awaiting a reply.';
  end if;


  if tempa_private.is_correspondence_blocked_pair(auth.uid(), original.sender_id) then
    raise exception
      'Letter not found, not addressed to you, or no longer awaiting a reply.';
  end if;

  v_status := public.current_account_status();
  if v_status in ('suspended', 'banned') then
    raise exception
      'Letter not found, not addressed to you, or no longer awaiting a reply.';
  end if;


  is_first_reply := original.reply_to_id is null;


  select *
  into corr

  from public.correspondences

  where id = original.correspondence_id

  for update;


  if not found then
    raise exception
      'Letter not found, not addressed to you, or no longer awaiting a reply.';
  end if;

  if is_first_reply and exists (
    select 1
    from public.correspondences newer
    where newer.id <> corr.id
      and newer.participant_low = corr.participant_low
      and newer.participant_high = corr.participant_high
      and newer.status in ('pending', 'active', 'paused')
  ) then
    raise exception 'A newer correspondence with this member is already open.'
      using errcode = 'P0001', detail = 'CORRESPONDENCE_ALREADY_OPEN';
  end if;


  moment_count := coalesce(jsonb_array_length(p_moments), 0);
  has_photo := false;

  if moment_count > 0 then

    if is_first_reply then
      raise exception
        'Moments are not available until after your first reply in this correspondence.';
    end if;

    if v_status = 'restricted' then
      raise exception
        'Moments are not available until after your first reply in this correspondence.';
    end if;

    paragraph_count := coalesce(
      array_length(
        regexp_split_to_array(trim(both from p_body), '\n\s*\n'),
        1
      ),
      1
    );

    for m in select * from jsonb_array_elements(p_moments)
    loop

      if m->>'type' not in ('photo', 'video') then
        raise exception 'Unknown Moment type.';
      end if;

      if
        (m->>'position')::integer < 0
        or (m->>'position')::integer >= paragraph_count
      then
        raise exception 'Moment position is out of range for this letter.';
      end if;

      has_photo := true;

      if m->>'type' = 'video' then
        if m->>'image_path' is null
          or m->>'trim_start_seconds' is null
          or m->>'duration_seconds' is null
          or (m->>'trim_start_seconds')::numeric < 0
          or (m->>'duration_seconds')::numeric <= 0
          or (m->>'duration_seconds')::numeric > 10
        then
          raise exception 'Invalid video Moment window.';
        end if;
      end if;

      if corr.photo_consent_status not in ('no_request', 'enabled') then
        raise exception
          'Photo sharing is not available in this correspondence right now.';
      end if;

    end loop;

  end if;


  has_postcard := p_postcard is not null;

  if has_postcard then

    if is_first_reply then
      raise exception
        'A Postcard is not available until after your first reply in this correspondence.';
    end if;

    if v_status = 'restricted' then
      raise exception
        'A Postcard is not available until after your first reply in this correspondence.';
    end if;

    v_postcard_key := p_postcard->>'postcard_key';
    v_reveal_line := p_postcard->>'reveal_line';
    v_back_message := coalesce(p_postcard->>'back_message', '');

    if v_postcard_key is null or char_length(trim(v_postcard_key)) = 0 then
      raise exception 'A Postcard requires a postcard key.';
    end if;

    if not exists (
      select 1 from public.postcard_catalog
      where key = v_postcard_key and is_active
    ) then
      raise exception 'Unknown postcard.';
    end if;

    select id
    into v_postcard_version_id
    from public.postcard_versions
    where postcard_key = v_postcard_key and is_current;

    if v_postcard_version_id is null then
      raise exception 'This postcard has no current version available.';
    end if;

    if v_reveal_line is not null and char_length(v_reveal_line) > 32 then
      raise exception 'A Postcard''s Reveal Line is too long.';
    end if;

    

    if char_length(trim(both from v_back_message)) > 300 then
      raise exception 'A Postcard''s back message is too long.';
    end if;

    select pseudonym
    into v_sender_pseudonym
    from public.profiles
    where id = auth.uid();

    if v_sender_pseudonym is null then
      raise exception 'Could not resolve your pseudonym for this Postcard.';
    end if;

  end if;


  select deliver_at
  into v_previous_deliver_at
  from public.letters
  where correspondence_id = original.correspondence_id
    and sender_id = auth.uid()
    and recipient_id = original.sender_id
  order by created_at desc
  limit 1;

  new_id := pg_catalog.gen_random_uuid();
  v_natural_deliver_at := public.compute_deliver_at(auth.uid(), original.sender_id, new_id);

  v_deliver_at := greatest(v_natural_deliver_at, v_previous_deliver_at + interval '1 minute');


  -- Checkpoint 3 — the one trusted consumption path. context_id is the
  -- letter being replied to (p_letter_id), matching can_evaluate_
  -- safety_context's own 'reply' branch and the Safety Route Handler's
  -- own contract (lib/safety/route-contract.ts). Placed after new_id is
  -- generated and after every other validation above, strictly before
  -- the actual insert below — same reasoning as write_letter's own call.
  perform tempa_private.consume_safety_evaluation(
    p_safety_evaluation_id,
    auth.uid(),
    'reply',
    p_letter_id,
    null,
    null,
    null,
    null,
    p_postcard,
    p_body,
    p_warning_acknowledged,
    new_id
  );

  insert into public.letters (
    id,
    sender_id,
    recipient_id,
    reply_to_id,
    correspondence_id,
    body,
    deliver_at
  )
  values (
    new_id,
    auth.uid(),
    original.sender_id,
    original.id,
    original.correspondence_id,
    p_body,
    v_deliver_at
  );


  if moment_count > 0 then

    insert into public.moments (
      letter_id,
      position,
      type,
      image_path,
      postcard_key,
      trim_start_seconds,
      duration_seconds
    )
    select
      new_id,
      (elem->>'position')::integer,
      elem->>'type',
      elem->>'image_path',
      elem->>'postcard_key',
      nullif(elem->>'trim_start_seconds', '')::numeric,
      nullif(elem->>'duration_seconds', '')::numeric
    from jsonb_array_elements(p_moments) as elem;

  end if;


  if has_postcard then

    insert into public.letter_postcards (
      letter_id,
      postcard_version_id,
      reveal_line,
      back_message,
      sender_pseudonym_snapshot
    )
    values (
      new_id,
      v_postcard_version_id,
      v_reveal_line,
      trim(both from v_back_message),
      v_sender_pseudonym
    );

  end if;


  if has_photo and corr.photo_consent_status = 'no_request' then

    update public.correspondences

    set
      photo_consent_status = 'pending',
      photo_consent_requested_by = auth.uid(),
      photo_consent_requested_at = now()

    where id = original.correspondence_id;

  end if;


  if original.status = 'sent' then
    update public.letters
    set
      status = 'replied',
      replied_at = now()
    where id = original.id;
  end if;


  if is_first_reply then

    update public.correspondences

    set
      status = 'active',
      established_at = coalesce(established_at, now()),
      closed_at = null,
      paused_at = null,
      paused_by = null,
      resume_requested_at = null,
      resume_requested_by = null,
      ended_by = null

    where id = original.correspondence_id;

  end if;


  select *
  into result

  from public.letters_for_participant

  where id = new_id;


  return result;

end;
$function$
;

revoke all on function public.reply_to_letter(uuid, text, uuid, jsonb, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.reply_to_letter(uuid, text, uuid, jsonb, jsonb, boolean)
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

      if exists (
        select 1 from public.letters l
        where l.correspondence_id = v_first_letter_corr.id
          and l.reply_to_id is null
          and l.sender_id = auth.uid()
      ) then
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

CREATE OR REPLACE FUNCTION tempa_private.enforce_correspondence_establishment_capacity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_user_id uuid;
  v_has_reserved_slot boolean;
  v_state record;
begin
  if not (
    old.status in ('pending', 'closed')
    and old.established_at is null
    and new.status = 'active'
    and new.established_at is not null
  ) then
    return new;
  end if;

  perform tempa_private.lock_relationship_capacity_pair(
    old.participant_low,
    old.participant_high
  );

  foreach v_user_id in array array[old.participant_low, old.participant_high]
  loop
    select exists (
      select 1
      from public.letters l
      where l.correspondence_id = old.id
        and l.sender_id = v_user_id
        and l.reply_to_id is null
        and l.status = 'sent'
        and l.expires_at > now()
    ) into v_has_reserved_slot;

    if not v_has_reserved_slot then
      select * into v_state
      from tempa_private.relationship_capacity_state(v_user_id);

      if v_state.committed_count >= v_state.active_limit then
        raise exception 'Both members need an open correspondence place before this reply can establish the correspondence.'
          using errcode = 'P0001', detail = 'RELATIONSHIP_CAPACITY_REACHED';
      end if;
    end if;
  end loop;

  return new;
end;
$function$;

revoke all on function tempa_private.enforce_correspondence_establishment_capacity()
  from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION tempa_private.capture_relationship_establishment_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_user_id uuid;
  v_counterpart_id uuid;
  v_state record;
begin
  if not (
    old.status in ('pending', 'closed')
    and old.established_at is null
    and new.status = 'active'
    and new.established_at is not null
  ) then
    return new;
  end if;

  foreach v_user_id in array array[new.participant_low, new.participant_high]
  loop
    v_counterpart_id := case
      when v_user_id = new.participant_low then new.participant_high
      else new.participant_low
    end;

    -- AFTER UPDATE means relationship_capacity_state already sees this new
    -- relationship as established. That is exactly the chair count we want
    -- to compare with later third/fifth-turn and 30-day behavior.
    select * into v_state
    from tempa_private.relationship_capacity_state(v_user_id);

    insert into public.relationship_establishment_snapshots (
      correspondence_id,
      user_id,
      counterpart_id,
      established_at,
      active_limit_at_establishment,
      established_count_at_establishment,
      outgoing_pending_count_at_establishment,
      incoming_pending_count_at_establishment,
      committed_count_at_establishment
    )
    values (
      new.id,
      v_user_id,
      v_counterpart_id,
      new.established_at,
      v_state.active_limit,
      v_state.established_count,
      v_state.outgoing_pending_count,
      v_state.incoming_pending_count,
      v_state.committed_count
    )
    on conflict (correspondence_id, user_id) do nothing;
  end loop;

  return new;
end;
$function$
;

revoke all on function tempa_private.capture_relationship_establishment_snapshot()
  from public, anon, authenticated, service_role;

commit;
