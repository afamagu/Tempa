-- Tempa — Write Anytime, part 2: reply_to_letter sets established_at.
-- PREPARED 2026-09-03. NOT EXECUTED — review, then run in the Supabase
-- SQL editor, AFTER 2026-09-03-correspondence-established-at.sql and
-- BEFORE 2026-09-03-drop-one-reply-per-original.sql.
--
-- A NEW dated migration, not an edit to
-- docs/sql/2026-09-01-letter2-moments-gate-fix.sql's history — that
-- file still shows the function's original body as actually applied.
--
-- Only change from the live version: the existing `if is_first_reply`
-- branch (which already sets correspondences.status = 'active' — a
-- no-op today since it's already active, kept for clarity/back-compat)
-- now also sets established_at = coalesce(established_at, now()).
-- coalesce guards against ever overwriting a value the backfill or an
-- earlier run already set. Every other line — all first-contact
-- validation, the 72-hour expiry interaction, the Moments/photo-consent
-- gate inside this same function — is byte-for-byte unchanged.

create or replace function public.reply_to_letter(
  p_letter_id uuid,
  p_body text,
  p_moments jsonb default '[]'::jsonb
)
returns public.letters_for_participant
language plpgsql
security definer
set search_path to 'public'
as $function$

declare
  original public.letters;
  new_id uuid;
  result public.letters_for_participant;
  moment_count integer;
  paragraph_count integer;
  correspondence_status text;
  consent_status text;
  has_photo boolean;
  is_first_reply boolean;
  m jsonb;

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
    and (
      reply_to_id is not null
      or expires_at > now()
    )

  for update;


  if not found then
    raise exception
      'Letter not found, not addressed to you, or no longer awaiting a reply.';
  end if;

  is_first_reply := original.reply_to_id is null;


  moment_count := coalesce(jsonb_array_length(p_moments), 0);
  has_photo := false;

  if moment_count > 0 then

    select status, photo_consent_status
    into correspondence_status, consent_status

    from public.correspondences

    where id = original.correspondence_id

    for update;

    if is_first_reply then
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

        if consent_status not in ('no_request', 'enabled') then
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
    original.sender_id,
    original.id,
    original.correspondence_id,
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


  if has_photo and consent_status = 'no_request' then

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

    -- THE ADDITION — established_at now records the moment this
    -- correspondence became ongoing, alongside the existing (already a
    -- no-op) status = 'active' set.
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

revoke all
on function public.reply_to_letter(uuid, text, jsonb)
from public;

grant execute
on function public.reply_to_letter(uuid, text, jsonb)
to authenticated;
