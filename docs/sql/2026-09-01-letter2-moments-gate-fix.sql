-- Tempa — fix the Moments-eligibility gate inside reply_to_letter.
-- PREPARED 2026-09-01. NOT EXECUTED — review, then run in the Supabase
-- SQL editor.
--
-- Delta on top of the already-applied 2026-08-31-first-photo-consent.sql
-- ("Success. No rows returned.") — deliberately a NEW migration rather
-- than an edit to that file, so the applied-migration history stays
-- truthful: that file's content on disk now matches exactly what was
-- run, and this one records the correction separately with its own
-- timestamp and reasoning.
--
-- BUG: the live reply_to_letter (from first-photo-consent.sql) blocks
-- Moments with:
--
--   if correspondence_status is distinct from 'active' then
--     raise exception 'Moments are not available until this
--     correspondence is active.';
--   end if;
--
-- correspondences.status defaults to 'active' the moment the row is
-- created (see correspondences_status_check in
-- 2026-08-31-correspondences.sql: `check (status in ('active',
-- 'closed'))`, column default `'active'` — 'pending' is not a value
-- the constraint permits, and no migration ever adds it). So
-- correspondence_status was already 'active' during Letter 2 itself
-- (the very reply this check runs inside, when is_first_reply is
-- true), meaning this condition never actually blocked anything. The
-- product rule — Letter 1 and Letter 2 stay text-only; Letter 2's
-- successful send is what establishes the correspondence; Letter 3
-- onward carries Moments — was therefore enforced only by application
-- code (app/letters/[letterId]/page.tsx's momentsQualified, added this
-- same checkpoint), not by the database. A client that called
-- reply_to_letter directly with p_moments on Letter 2 would have
-- succeeded.
--
-- FIX: replace that check with `if is_first_reply then raise
-- exception ... end if` — is_first_reply is already computed a few
-- lines earlier in this same function (`original.reply_to_id is
-- null`) and is exactly the condition the product rule actually needs:
-- true only for the one reply that completes Letter 2.
--
-- This is a full CREATE OR REPLACE of reply_to_letter (Postgres
-- functions can't be patched line-by-line) — the body is byte-for-byte
-- identical to the currently-live version from first-photo-consent.sql
-- except for this one check, so re-running the whole function here is
-- the only way to ship a one-line fix; it changes no other behavior.

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

    -- THE FIX — was `if correspondence_status is distinct from
    -- 'active' then`, which never actually fired (see header comment).
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
