-- Tempa — Write Anytime, part 4: the write_letter RPC.
-- PREPARED 2026-09-03. NOT EXECUTED — review, then run in the Supabase
-- SQL editor, LAST — after 2026-09-03-correspondence-established-at.sql,
-- 2026-09-03-reply-to-letter-established-at.sql, and
-- 2026-09-03-drop-one-reply-per-original.sql.
--
-- The sole INSERT path for an ORDINARY letter inside an already-
-- established correspondence — never for first contact (send_first_letter,
-- unchanged) and never for the specific reply that establishes a
-- correspondence (reply_to_letter, unchanged — Letter 2 is still what
-- sets established_at, per the previous migration).
--
-- Authorization is entirely correspondence-level: caller must be one of
-- the two participants, correspondence.status must be 'active', and
-- established_at must be not null. It does NOT matter whether
-- p_reply_to_id's target letter has already been "replied to" —
-- reply_to_id is contextual ancestry only (see the previous migration),
-- so writing a new letter never reads or mutates any other ordinary
-- letter's status. Recipient is always derived server-side from the
-- correspondence's own participant pair — never trusted from the
-- client. Body length/blank checks are enforced by the existing table
-- constraints (letters_body_not_blank, letters_body_max_length) the
-- same way every other letters-writing RPC relies on them, so they are
-- not duplicated here. Moments/photo-consent validation is copied
-- verbatim from reply_to_letter's own block, since established_at not
-- null already implies "past Letter 2," i.e. every letter written here
-- is Moments-eligible by construction — there is no separate
-- is_first_reply-style gate to apply.

create or replace function public.write_letter(
  p_correspondence_id uuid,
  p_body text,
  p_reply_to_id uuid default null,
  p_moments jsonb default '[]'::jsonb
)
returns public.letters_for_participant
language plpgsql
security definer
set search_path to 'public'
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


  if corr.status <> 'active' or corr.established_at is null then
    raise exception
      'This correspondence is not yet established for ongoing letters.';
  end if;


  recipient := case
    when auth.uid() = corr.participant_low then corr.participant_high
    else corr.participant_low
  end;


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

      if m->>'type' not in ('photo', 'postcard') then
        raise exception 'Unknown Moment type.';
      end if;

      if
        (m->>'position')::integer < 0
        or (m->>'position')::integer >= paragraph_count
      then
        raise exception 'Moment position is out of range for this letter.';
      end if;

      if m->>'type' = 'photo' then
        has_photo := true;

        if corr.photo_consent_status not in ('no_request', 'enabled') then
          raise exception
            'Photo sharing is not available in this correspondence right now.';
        end if;
      end if;

    end loop;

  end if;


  insert into public.letters (
    sender_id,
    recipient_id,
    reply_to_id,
    correspondence_id,
    body
  )
  values (
    auth.uid(),
    recipient,
    p_reply_to_id,
    p_correspondence_id,
    p_body
  )
  returning id
  into new_id;


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
      (m->>'position')::integer,
      m->>'type',
      m->>'image_path',
      m->>'postcard_key'
    from jsonb_array_elements(p_moments) as m;

  end if;


  if has_photo and corr.photo_consent_status = 'no_request' then

    update public.correspondences

    set
      photo_consent_status = 'pending',
      photo_consent_requested_by = auth.uid(),
      photo_consent_requested_at = now()

    where id = p_correspondence_id;

  end if;


  -- Deliberately NOT updating any other letter's status here — an
  -- ordinary write_letter send never mutates a sibling letter, unlike
  -- reply_to_letter's original.status = 'replied'. See migration header.


  select *
  into result

  from public.letters_for_participant

  where id = new_id;


  return result;

end;
$function$;

revoke all
on function public.write_letter(uuid, text, uuid, jsonb)
from public;

grant execute
on function public.write_letter(uuid, text, uuid, jsonb)
to authenticated;
