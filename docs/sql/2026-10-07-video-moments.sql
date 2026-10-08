-- Tempa — 10-second Video Moments
-- Reconciled 2026-10-08 against the live letter RPC signatures.
-- Forward-only: extends Moment storage and preserves all current letter behavior.
begin;

alter table public.moments add column if not exists trim_start_seconds numeric;
alter table public.moments add column if not exists duration_seconds numeric;

alter table public.moments drop constraint if exists moments_type_check;
alter table public.moments add constraint moments_type_check
  check (type in ('photo','video','postcard'));

alter table public.moments drop constraint if exists moments_type_fields_consistent;
alter table public.moments add constraint moments_type_fields_consistent check (
  (type = 'photo' and image_path is not null and postcard_key is null and trim_start_seconds is null and duration_seconds is null)
  or
  (type = 'video' and image_path is not null and postcard_key is null and trim_start_seconds >= 0 and duration_seconds > 0 and duration_seconds <= 10)
  or
  (type = 'postcard' and postcard_key is not null and image_path is null and trim_start_seconds is null and duration_seconds is null)
);

CREATE OR REPLACE FUNCTION public.write_letter(p_correspondence_id uuid, p_body text, p_safety_evaluation_id uuid, p_reply_to_id uuid DEFAULT NULL::uuid, p_moments jsonb DEFAULT '[]'::jsonb, p_postcard jsonb DEFAULT NULL::jsonb, p_warning_acknowledged boolean DEFAULT false)
 RETURNS letters_for_participant
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$

declare
  corr public.correspondences;
  recipient uuid;
  reply_to_correspondence uuid;
  new_id uuid;
  result public.letters_for_participant;
  moment_count integer;
  paragraph_count integer;
  has_photo boolean;
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
  into corr

  from public.correspondences

  where id = p_correspondence_id

  for update;


  if not found then
    raise exception 'Correspondence not found.';
  end if;


  if auth.uid() <> corr.participant_low and auth.uid() <> corr.participant_high then
    raise exception 'You are not a participant in this correspondence.';
  end if;


  recipient := case
    when auth.uid() = corr.participant_low then corr.participant_high
    else corr.participant_low
  end;

  if tempa_private.is_correspondence_blocked_pair(auth.uid(), recipient) then
    raise exception 'Correspondence not found.';
  end if;

  v_status := public.current_account_status();
  if v_status in ('suspended', 'banned') then
    raise exception 'Correspondence not found.';
  end if;


  if corr.status <> 'active' or corr.established_at is null then
    raise exception
      'This correspondence is not yet established for ongoing letters.';
  end if;


  if p_reply_to_id is not null then

    select correspondence_id
    into reply_to_correspondence

    from public.letters

    where id = p_reply_to_id;

    if reply_to_correspondence is null or reply_to_correspondence <> p_correspondence_id then
      raise exception 'reply_to_id must reference a letter in this same correspondence.';
    end if;

  end if;


  moment_count := coalesce(jsonb_array_length(p_moments), 0);
  has_photo := false;

  if moment_count > 0 and v_status = 'restricted' then
    raise exception
      'Moments are not available in this correspondence yet.';
  end if;

  if moment_count > 0 and not public.moments_qualified_for_viewer(p_correspondence_id) then
    raise exception
      'Moments are not available in this correspondence yet.';
  end if;

  if moment_count > 0 then

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

    if v_status = 'restricted' then
      raise exception
        'A Postcard is not available in this correspondence yet.';
    end if;

    if not public.moments_qualified_for_viewer(p_correspondence_id) then
      raise exception
        'A Postcard is not available in this correspondence yet.';
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
  where correspondence_id = p_correspondence_id
    and sender_id = auth.uid()
    and recipient_id = recipient
  order by created_at desc
  limit 1;

  new_id := pg_catalog.gen_random_uuid();
  v_natural_deliver_at := public.compute_deliver_at(auth.uid(), recipient, new_id);

  v_deliver_at := greatest(v_natural_deliver_at, v_previous_deliver_at + interval '1 minute');


  -- Checkpoint 3 — the one trusted consumption path. Placed after
  -- new_id is generated (so the evaluation's own signal, if any, can be
  -- linked to this exact Letter) and after every other validation above
  -- (so a request that would fail anyway for an unrelated reason never
  -- wastefully locks/consumes the evaluation row first), but strictly
  -- before the actual insert below, so a denied/invalid/already-used
  -- evaluation blocks the Letter from ever being created.
  perform tempa_private.consume_safety_evaluation(
    p_safety_evaluation_id,
    auth.uid(),
    'write_anytime',
    p_correspondence_id,
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
    recipient,
    p_reply_to_id,
    p_correspondence_id,
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

    where id = p_correspondence_id;

  end if;


  select *
  into result

  from public.letters_for_participant

  where id = new_id;


  return result;

end;
$function$
;

revoke all on function public.write_letter(uuid, text, uuid, uuid, jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.write_letter(uuid, text, uuid, uuid, jsonb, jsonb, boolean) to authenticated;

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
    and status = 'sent'
    and deliver_at <= now()
    and (
      reply_to_id is not null
      or expires_at > now()
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


  update public.letters

  set
    status = 'replied',
    replied_at = now()

  where id = original.id;


  if is_first_reply then

    update public.correspondences

    set
      status = 'active',
      established_at = coalesce(established_at, now())

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

revoke all on function public.reply_to_letter(uuid, text, uuid, jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.reply_to_letter(uuid, text, uuid, jsonb, jsonb, boolean) to authenticated;

commit;
