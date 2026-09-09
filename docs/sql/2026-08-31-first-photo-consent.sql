-- Tempa — first-photo-is-the-request consent model + the storage
-- security fix it requires.
-- PREPARED 2026-08-31. APPLIED 2026-08-31 ("Success. No rows returned.")
-- — do not re-run. See 2026-09-01-letter2-moments-gate-fix.sql for a
-- correction layered on top of this, applied as its own delta rather
-- than by editing this file after the fact.
--
-- ============================================================
-- A. REQUIRED — FUNCTIONAL + SECURITY
-- ============================================================
--
-- Product change: there is no more proactive "ask about photos"
-- button. photo_consent_status stays 'no_request' until someone
-- actually sends a letter containing a Photo Moment — that send IS the
-- request. Until the recipient decides, they must not be able to
-- obtain a signed URL for that photo at all, even though they can see
-- that a Photo Moment exists in that position. The sender must always
-- be able to see their own sent photo.
--
-- This is a genuine access-control gap in the currently-applied
-- 2026-08-31-moments.sql: letter_photos_select only checks correspondence
-- participancy, never photo_consent_status or who actually sent the
-- letter the photo belongs to. Both halves below (A1 + A2) are required
-- together — A1 without A2 would still let any participant read any
-- photo regardless of consent.

-- ------------------------------------------------------------
-- A1. reply_to_letter — allow sending from 'no_request', and make that
--     send the thing that opens the request.
-- ------------------------------------------------------------

drop function if exists public.reply_to_letter(uuid, text, jsonb);

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

    if correspondence_status is distinct from 'active' then
      raise exception
        'Moments are not available until this correspondence is active.';
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

        -- The one behavior change from the previous version: a Photo is
        -- now also allowed to send while status = 'no_request' — that
        -- send is what opens the request. Every other non-'enabled'
        -- state (pending/deferred/photo_free) still blocks it exactly
        -- as before.
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


  -- The first Photo Moment IS the request — no separate "ask" action
  -- exists anymore. Only fires when consent was genuinely still
  -- 'no_request' at the top of this call, so it can never re-open an
  -- already-pending/deferred/photo_free/enabled state.
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

    update public.correspondences

    set status = 'active'

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


-- ------------------------------------------------------------
-- A2. Storage security fix — a photo is only downloadable by its
--     sender, or by anyone once photo_consent_status = 'enabled'.
-- ------------------------------------------------------------

-- Takes the exact storage object path (moments.image_path uses this
-- same string), so no change to the upload path convention is needed.
create or replace function public.can_view_letter_photo(
  p_path text
)
returns boolean
language sql
security definer
set search_path to 'public'
stable
as $$
  select exists (
    select 1
    from public.moments m
    join public.letters l on l.id = m.letter_id
    join public.correspondences c on c.id = l.correspondence_id
    where m.image_path = p_path
      and (c.participant_low = auth.uid() or c.participant_high = auth.uid())
      and (l.sender_id = auth.uid() or c.photo_consent_status = 'enabled')
  );
$$;

revoke all
on function public.can_view_letter_photo(text)
from public;

grant execute
on function public.can_view_letter_photo(text)
to authenticated;


drop policy if exists letter_photos_select on storage.objects;

create policy letter_photos_select
  on storage.objects
  for select
  using (
    bucket_id = 'letter-photos'
    and public.can_view_letter_photo(name)
  );

-- letter_photos_insert is unchanged — upload-time access is still just
-- "are you a participant in this correspondence," matching the existing
-- upload flow where the file is written before the letter (and
-- therefore the moment row this function keys off) exists. The actual
-- send is gated by A1 above, not by upload.


-- ============================================================
-- B. OPTIONAL / FUTURE
-- ============================================================
--
-- None required for this checkpoint. The existing
-- request_photo_sharing/respond_photo_sharing RPCs are unchanged —
-- request_photo_sharing's `no_request` branch simply becomes unreachable
-- from the UI now (nothing calls it from that state anymore), but it's
-- harmless to leave as-is rather than removing it, and its
-- `photo_free -> pending` reconsideration branch remains actively used.
-- A future cleanup could narrow request_photo_sharing's accepted
-- starting states to just 'photo_free', but that's cosmetic, not a
-- security or correctness issue, so it's not included here.
