-- Tempa — fix "column reference "m" is ambiguous" in reply_to_letter's
-- Moments INSERT.
-- PREPARED 2026-09-02. NOT EXECUTED — review, then run in the Supabase
-- SQL editor.
--
-- Delta on top of the already-applied 2026-09-01-letter2-moments-gate-fix.sql
-- — deliberately a NEW migration rather than an edit to that file, so
-- the applied-migration history stays truthful: that file's content on
-- disk matches exactly what was run, and this one records the
-- correction separately with its own timestamp and reasoning.
--
-- LIVE ERROR (confirmed via real send attempt): "column reference "m"
-- is ambiguous".
--
-- BUG: the function declares a PL/pgSQL variable
--
--   declare
--     ...
--     m jsonb;
--
-- which stays in scope for the whole function body. The earlier
-- validation block,
--
--   for m in select * from jsonb_array_elements(p_moments)
--   loop
--     if m->>'type' not in ('photo', 'postcard') then ...
--
-- is fine — that inner query never names anything "m" itself, so the
-- FOR-loop construct cleanly reuses the outer variable as its
-- iteration target with no ambiguity.
--
-- The Moments INSERT further down is different — it explicitly
-- introduces a SQL-level table alias also named "m":
--
--   insert into public.moments (...)
--   select
--     new_id,
--     (m->>'position')::integer,
--     m->>'type',
--     m->>'image_path',
--     m->>'postcard_key'
--   from jsonb_array_elements(p_moments) as m;
--
-- Inside that SELECT, every "m->>'...'" reference is now ambiguous
-- between the outer PL/pgSQL variable m (still in scope) and the
-- FROM-clause alias m (this query's own jsonb_array_elements row) —
-- both visible, both plausible, and Postgres refuses to guess which
-- one is meant. That's exactly the live "column reference "m" is
-- ambiguous" error, and it fires on every reply that includes at least
-- one Moment (moment_count > 0), regardless of paragraph position,
-- Moment type, or photo-consent state — which is also why the
-- paragraph-position hypothesis from the prior checkpoint turned out
-- not to be the cause: the function never got far enough to evaluate
-- that logic's own outcome; it fails while INSERTing the Moments rows
-- themselves, after every validation in the FOR loop has already
-- passed.
--
-- FIX: rename ONLY this one FROM-clause alias, from `m` to `elem`, and
-- update this one SELECT's four `m->>'...'` references to `elem->>'...'`
-- accordingly. The `declare m jsonb;` line and the earlier validation
-- loop are both left completely untouched — they were never ambiguous
-- and don't need to change. Nothing else in the function is modified:
-- same signature (uuid, text, jsonb), same security definer /
-- search_path, same Letter-2 Moments gate (is_first_reply), same
-- photo-consent check, same paragraph_count/position validation values
-- (only how they're referenced changes), same sender_id/recipient_id
-- assignment, same correspondence-status handling, same grants below.
--
-- This is a full CREATE OR REPLACE of reply_to_letter (Postgres
-- functions can't be patched line-by-line) — the body is byte-for-byte
-- identical to the currently-live version from
-- 2026-09-01-letter2-moments-gate-fix.sql except for this one
-- identifier rename (5 occurrences: the alias itself plus its 4 uses).

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

    -- THE FIX — was `from jsonb_array_elements(p_moments) as m`, whose
    -- alias `m` collided with the `m jsonb;` variable declared above,
    -- making every `m->>'...'` reference below ambiguous. Renamed to
    -- `elem`; values and columns are otherwise unchanged.
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
