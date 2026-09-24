-- ============================================================
-- TEMPA — SAFETY 2, CHECKPOINT 3: WIRING SAFETY INTO THE LETTER
-- MUTATION RPCS
-- STATUS: NOT EXECUTED — review, then run in the Supabase SQL editor,
-- AFTER docs/sql/2026-10-03-safety-persistence.sql (this migration
-- calls tempa_private.consume_safety_evaluation, which that migration
-- prepares). Does NOT merge to main, deploy, or enable enforcement for
-- real members until both have actually been run and verified.
-- ============================================================
--
-- Wires public.send_first_letter/reply_to_letter/write_letter — real,
-- LIVE, already-shipped production functions — to REQUIRE a Safety
-- clearance before any Letter can be created. Each is reproduced in
-- FULL below from its current live definition (re-read directly from
-- docs/sql/2026-09-28-title-postcard-and-edit-window.sql immediately
-- before writing this migration, not from memory — send_first_letter's
-- own latest definition is docs/sql/2026-09-30-mark-identity-and-admin-
-- member-workspace.sql, also re-read directly), with ONLY the specific
-- lines below actually changed:
--   - a new REQUIRED p_safety_evaluation_id uuid parameter;
--   - a new p_warning_acknowledged boolean default false parameter;
--   - one call to tempa_private.consume_safety_evaluation, placed right
--     before each function's own `insert into public.letters`, after
--     that function's own new_id has already been generated (needed so
--     consume_safety_evaluation can link this evaluation's own signal,
--     if it produced one, to the specific Letter about to exist — see
--     that function's own header comment, docs/sql/2026-10-03-safety-
--     persistence.sql);
--   - send_first_letter only: a new server-side body length check
--     (Checkpoint 3's own B6 correction — see that section below).
-- Every existing check, every existing side effect, every existing
-- error message is otherwise byte-for-byte unchanged.
--
-- WHY A NEW SIGNATURE, NOT A DEFAULTED PARAMETER: an optional Safety
-- parameter would let an unscreened call keep working by simply
-- omitting it — the whole point of this migration is that this is no
-- longer possible. p_safety_evaluation_id has no default, and is placed
-- BEFORE any parameter that already has one (Postgres requires
-- defaulted parameters to trail non-defaulted ones) — write_letter's
-- and reply_to_letter's own existing p_reply_to_id/p_moments/p_postcard
-- keep their positions relative to EACH OTHER, with only
-- p_safety_evaluation_id inserted ahead of them. Every real call site in
-- this codebase already uses Supabase's named-parameter RPC calling
-- convention (`.rpc(name, {p_...: ...})`), so this reordering has zero
-- effect on any actual caller — it exists purely to satisfy Postgres's
-- own parameter-ordering rule for a REQUIRED parameter.
--
-- Each function's OLD signature is explicitly DROPPED before being
-- recreated under its new one — CREATE OR REPLACE alone would leave the
-- old, unscreened signature callable side-by-side with the new one
-- (Postgres treats a different parameter list as a genuinely different
-- overload, not a replacement), which would defeat this migration's own
-- purpose. This is why "old RPC signature no longer resolves" is one of
-- Checkpoint 3's own required regression tests.
--
-- THE VERIFY SET (identical for all three, delegated entirely to
-- tempa_private.consume_safety_evaluation — see that function's own
-- header comment, docs/sql/2026-10-03-safety-persistence.sql, for the
-- full ordered list): the evaluation belongs to the caller, is for the
-- correct surface/context/Question-answer, is not expired, is not
-- already consumed, and — critically — its stored fingerprint is
-- RECOMPUTED here from this function's own actual received p_body (and
-- p_postcard, where applicable) and must match exactly. Editing the
-- body OR the Postcard after evaluation therefore always invalidates
-- the evaluation and requires a fresh one; there is no way to evaluate
-- one piece of content and send a different one. 'deny' never proceeds
-- regardless of p_warning_acknowledged; 'warn' proceeds only once
-- p_warning_acknowledged is explicitly true.
--
-- TRANSACTIONAL SAFETY: each of these three functions already runs as
-- ONE implicit transaction (ordinary PL/pgSQL function semantics, no
-- explicit BEGIN/COMMIT needed or used). tempa_private.consume_safety_
-- evaluation's own UPDATE (setting consumed_at) is therefore
-- automatically rolled back if anything LATER in the same function
-- raises for any reason (a subsequent check, the Letter INSERT itself,
-- anything at all) — "Safety consumption must roll back with it" is a
-- structural property of calling it from inside the same function,
-- requiring no special-casing.
--
-- B6 — FIRST-LETTER SERVER-SIDE LENGTH CAP: send_first_letter had no
-- server-side body length enforcement at all — only first-letter-
-- composer.tsx's own client-side gate (QUESTION_ANSWER_MAX_CHARS,
-- lib/questions.ts, currently 2000), verified by directly reading that
-- composer's actual submit path: `p_body` is sent as exactly
-- `docToPlainBody(editor.getJSON())`, the SAME string its own char
-- count (`Array.from(text).length`, a Unicode code-point count) is
-- computed over, with no additional trim before either the count or the
-- RPC call. char_length() here counts the same way for the same
-- reason — the two only ever diverge from a byte/octet count, never
-- from each other, for ordinary UTF8 content. This is a first_letter-
-- ONLY cap: reply_to_letter/write_letter remain deliberately uncapped,
-- unchanged by this migration — an established correspondence has no
-- product-level length limit, and this migration does not add one.

begin;

-- ============================================================
-- 1. SEND_FIRST_LETTER
-- ============================================================

drop function public.send_first_letter(uuid, uuid, text);

create or replace function public.send_first_letter(
  p_recipient_id uuid,
  p_question_answer_id uuid,
  p_body text,
  p_safety_evaluation_id uuid,
  p_warning_acknowledged boolean default false
)
returns public.letters_for_participant
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_new_id uuid;
  v_correspondence_id uuid;
  v_participant_low uuid;
  v_participant_high uuid;
  v_correspondence_status text;
  v_established_at timestamptz;
  v_deliver_at timestamptz;
  v_expires_at timestamptz;
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

  if not exists (
    select 1
    from public.question_answers qa
    join public.questions q on q.id = qa.question_id
    where qa.id = p_question_answer_id
      and qa.user_id = p_recipient_id
      and qa.is_current = true
      and q.is_active = true
  ) then
    raise exception
      'That Question answer is not currently a live Discovery entry for the intended recipient.';
  end if;

  v_participant_low := least(auth.uid(), p_recipient_id);
  v_participant_high := greatest(auth.uid(), p_recipient_id);

  insert into public.correspondences(participant_low, participant_high)
  values (v_participant_low, v_participant_high)
  on conflict (participant_low, participant_high)
    where status = any (array['pending'::text, 'active'::text])
  do nothing
  returning id into v_correspondence_id;

  if v_correspondence_id is null then
    select c.id, c.status, c.established_at
    into v_correspondence_id, v_correspondence_status, v_established_at
    from public.correspondences c
    where c.participant_low = v_participant_low
      and c.participant_high = v_participant_high
      and c.status in ('pending', 'active')
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

  if exists (
    select 1 from public.letters l
    where l.correspondence_id = v_correspondence_id
      and l.reply_to_id is null
      and l.sender_id = auth.uid()
  ) then
    raise exception
      'You have already sent a first-contact letter to this recipient.'
      using errcode = '23505';
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
$function$;

revoke all on function public.send_first_letter(uuid, uuid, text, uuid, boolean) from public, anon;
grant execute on function public.send_first_letter(uuid, uuid, text, uuid, boolean) to authenticated;


-- ============================================================
-- 2. WRITE_LETTER
-- ============================================================

drop function public.write_letter(uuid, text, uuid, jsonb, jsonb);

create or replace function public.write_letter(
  p_correspondence_id uuid,
  p_body text,
  p_safety_evaluation_id uuid,
  p_reply_to_id uuid default null,
  p_moments jsonb default '[]'::jsonb,
  p_postcard jsonb default null,
  p_warning_acknowledged boolean default false
)
returns public.letters_for_participant
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$

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

      if m->>'type' <> 'photo' then
        raise exception 'Unknown Moment type.';
      end if;

      if
        (m->>'position')::integer < 0
        or (m->>'position')::integer >= paragraph_count
      then
        raise exception 'Moment position is out of range for this letter.';
      end if;

      has_photo := true;

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
    v_back_message := p_postcard->>'back_message';

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

    if v_back_message is null or char_length(trim(both from v_back_message)) = 0 then
      raise exception 'A Postcard needs its own written message before it can be sent.';
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
      postcard_key
    )
    select
      new_id,
      (elem->>'position')::integer,
      elem->>'type',
      elem->>'image_path',
      elem->>'postcard_key'
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
$function$;

revoke all on function public.write_letter(uuid, text, uuid, uuid, jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.write_letter(uuid, text, uuid, uuid, jsonb, jsonb, boolean) to authenticated;


-- ============================================================
-- 3. REPLY_TO_LETTER
-- ============================================================

drop function public.reply_to_letter(uuid, text, jsonb, jsonb);

create or replace function public.reply_to_letter(
  p_letter_id uuid,
  p_body text,
  p_safety_evaluation_id uuid,
  p_moments jsonb default '[]'::jsonb,
  p_postcard jsonb default null,
  p_warning_acknowledged boolean default false
)
returns public.letters_for_participant
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$

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

      if m->>'type' <> 'photo' then
        raise exception 'Unknown Moment type.';
      end if;

      if
        (m->>'position')::integer < 0
        or (m->>'position')::integer >= paragraph_count
      then
        raise exception 'Moment position is out of range for this letter.';
      end if;

      has_photo := true;

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
    v_back_message := p_postcard->>'back_message';

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

    if v_back_message is null or char_length(trim(both from v_back_message)) = 0 then
      raise exception 'A Postcard needs its own written message before it can be sent.';
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
      postcard_key
    )
    select
      new_id,
      (elem->>'position')::integer,
      elem->>'type',
      elem->>'image_path',
      elem->>'postcard_key'
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
$function$;

revoke all on function public.reply_to_letter(uuid, text, uuid, jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.reply_to_letter(uuid, text, uuid, jsonb, jsonb, boolean) to authenticated;

commit;
