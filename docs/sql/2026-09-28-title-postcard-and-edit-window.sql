-- ============================================================
-- TEMPA — SMOKE-TEST CONTRACT COMPLETION: DISPATCH TITLE 140,
-- POSTCARD BACK 300, PUBLISHED-DISPATCH EDIT WINDOW / REPLY LOCK
-- PREPARED — NOT APPLIED. Review, then run in the Supabase SQL editor.
-- See docs/sql/2026-09-28-title-postcard-and-edit-window-verify.sql for
-- the read-only structural proof to run immediately afterward.
-- ============================================================
--
-- Three independent, pre-approved product contracts, completed together
-- in one migration because all three are small, focused value/logic
-- changes to the same small family of RPCs:
--
--   1. Dispatch title: 70 -> 140 characters. Table CHECK
--      (dispatches_title_max_length) plus BOTH create and edit RPCs
--      (publish_dispatch, update_dispatch) widened together — the two
--      have always shared one ceiling, and continue to.
--
--   2. Postcard back message: 200 -> 300 characters, for BOTH the
--      Letter surface (letter_postcards_back_message_length,
--      write_letter, reply_to_letter) and the Dispatch surface
--      (dispatch_postcards_back_message_length, publish_dispatch) —
--      the two Postcard instance tables have always mirrored this exact
--      invariant. Front-side Reveal Line (32 chars) is NOT touched.
--
--   3. A published Dispatch becomes permanently locked from ordinary
--      author editing once EITHER (a) 30 minutes have elapsed since
--      publish_dispatch's own published_at, OR (b) at least one
--      dispatch_replies row exists for it — checked as bare row
--      EXISTENCE, deliberately unfiltered by moderation_status/
--      deleted_at. This is not a new persistence concept: docs/sql/
--      2026-09-23-dispatch-replies.sql already established that NO
--      dispatch_replies row can ever be hard-deleted (delete_reply is a
--      soft tombstone; delete_dispatch outright refuses to delete a
--      Dispatch that has any Reply row at all) — so "a reply once
--      existed" is already a durable, monotonic fact this schema can
--      answer correctly forever, with no new column or table. Enforced
--      SERVER-SIDE, inside update_dispatch itself, evaluated fresh on
--      every call (never trusted from a page-load-time client read) —
--      this is what closes the "reply arrives between page load and
--      save" race, not any client-side check. The eligibility SELECT
--      takes FOR UPDATE on the Dispatch row, the same lock
--      update_dispatch's own subsequent UPDATE already implicitly
--      requires (acquired explicitly and early, not an escalation —
--      same reasoning delete_dispatch's own FOR UPDATE comment gives),
--      which serializes against create_reply's FOR SHARE on that same
--      row (docs/sql/2026-09-23-dispatch-replies.sql) — both functions
--      only ever lock the Dispatch row, in the same order, so no
--      deadlock cycle can form.
--
-- Every function below is reproduced in FULL from its current live
-- definition (publish_dispatch and get_shared_dispatch's Postcard shape
-- from docs/sql/2026-09-25-dispatch-postcards.sql; update_dispatch from
-- docs/sql/2026-09-11-safety-blocking-foundation.sql; write_letter/
-- reply_to_letter from docs/sql/2026-09-14-letter-level-postcards.sql —
-- each individually re-read from that file, not from memory, before
-- being copied below) with ONLY the specific lines this migration's own
-- three contracts require changed. No argument list, return type,
-- security mode, or search_path changes for any function — CREATE OR
-- REPLACE is safe and sufficient for all of them; none needed a DROP
-- FUNCTION first. No grant is reissued for any function whose signature
-- is unchanged (CREATE OR REPLACE on an identical signature preserves
-- existing grants/ACL automatically, same reasoning already documented
-- in docs/sql/2026-09-12-scoped-blocking-and-fixes.sql for
-- is_blocked_pair) — this migration only touches grants for functions
-- whose signature genuinely changes, which is none of them here.
--
-- Historical migration files are NOT edited — this file is the sole,
-- additive forward migration for this checkpoint.

begin;

-- ============================================================
-- 1. DISPATCH TITLE — table constraint, 70 -> 140
-- ============================================================
-- A pure widening: every existing row already satisfies char_length <=
-- 70, which trivially satisfies <= 140 too — no backfill, no data
-- rewrite, no existing title can become invalid.
alter table public.dispatches drop constraint dispatches_title_max_length;
alter table public.dispatches add constraint dispatches_title_max_length
  check (char_length(title) <= 140);


-- ============================================================
-- 2. POSTCARD BACK MESSAGE — table constraints, 200 -> 300
-- ============================================================
-- Same reasoning: a pure widening of an existing BETWEEN 1 AND N check;
-- every existing back_message already satisfies <= 200, which trivially
-- satisfies <= 300 too.
alter table public.dispatch_postcards drop constraint dispatch_postcards_back_message_length;
alter table public.dispatch_postcards add constraint dispatch_postcards_back_message_length
  check (char_length(trim(both from back_message)) between 1 and 300);

alter table public.letter_postcards drop constraint letter_postcards_back_message_length;
alter table public.letter_postcards add constraint letter_postcards_back_message_length
  check (char_length(trim(both from back_message)) between 1 and 300);


-- ============================================================
-- 3. PUBLISH_DISPATCH — title check 70 -> 140, Postcard back-message
--    check 200 -> 300. Reproduced in full from its current live 5-arg
--    definition (docs/sql/2026-09-25-dispatch-postcards.sql). Same
--    signature, same SECURITY DEFINER, same search_path — CREATE OR
--    REPLACE only, no DROP FUNCTION needed (the argument list is
--    unchanged from the live version).
-- ============================================================
create or replace function public.publish_dispatch(
  p_title text,
  p_body text,
  p_topics text[] default '{}',
  p_moments jsonb default '[]'::jsonb,
  p_postcard jsonb default null
)
returns public.dispatches
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$

declare
  new_id uuid;
  result public.dispatches;
  topic text;
  normalized_topics text[] := '{}';
  paragraph_count integer;
  m jsonb;
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

  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'This action is not available right now.';
  end if;

  if char_length(trim(p_title)) = 0 then
    raise exception 'A Dispatch needs a title.';
  end if;

  -- CHANGED (smoke-test contract completion): 70 -> 140.
  if char_length(p_title) > 140 then
    raise exception 'Title is too long.';
  end if;

  if array_length(p_topics, 1) is not null and array_length(p_topics, 1) > 3 then
    raise exception 'A Dispatch may carry at most 3 topics.';
  end if;

  foreach topic in array coalesce(p_topics, '{}') loop
    topic := trim(topic);
    if char_length(topic) = 0 then
      continue;
    end if;
    if char_length(topic) > 40 then
      raise exception 'A topic is too long.';
    end if;
    if not exists (
      select 1 from unnest(normalized_topics) t where lower(t) = lower(topic)
    ) then
      normalized_topics := array_append(normalized_topics, topic);
    end if;
  end loop;

  if array_length(normalized_topics, 1) is not null and array_length(normalized_topics, 1) > 3 then
    raise exception 'A Dispatch may carry at most 3 topics.';
  end if;


  has_postcard := p_postcard is not null;

  if has_postcard then

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
      raise exception 'A Postcard needs its own written message before it can be published.';
    end if;

    -- CHANGED (smoke-test contract completion): 200 -> 300.
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


  insert into public.dispatches (author_id, title, body, status, published_at)
  values (auth.uid(), p_title, p_body, 'published', now())
  returning id into new_id;


  if array_length(normalized_topics, 1) is not null then
    insert into public.dispatch_topics (dispatch_id, topic)
    select new_id, t from unnest(normalized_topics) as t;
  end if;


  if coalesce(jsonb_array_length(p_moments), 0) > 0 then

    paragraph_count := coalesce(
      array_length(
        regexp_split_to_array(trim(both from p_body), '\n\s*\n'),
        1
      ),
      1
    );

    for m in select * from jsonb_array_elements(p_moments)
    loop

      if m->>'type' is distinct from 'photo' then
        raise exception 'Only still-image Moments are supported in a Dispatch.';
      end if;

      if
        (m->>'position')::integer < 0
        or (m->>'position')::integer >= paragraph_count
      then
        raise exception 'Moment position is out of range for this Dispatch.';
      end if;

      if auth.uid()::text is distinct from (storage.foldername(m->>'image_path'))[1] then
        raise exception 'A Moment photo must belong to the author.';
      end if;

    end loop;

    insert into public.dispatch_moments (dispatch_id, position, image_path)
    select
      new_id,
      (elem->>'position')::integer,
      elem->>'image_path'
    from jsonb_array_elements(p_moments) as elem;

  end if;


  if has_postcard then

    insert into public.dispatch_postcards (
      dispatch_id,
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


  select * into result from public.dispatches where id = new_id;

  return result;

end;
$function$;

-- Signature unchanged from the live 5-arg version — no DROP, no
-- re-grant needed. Left uncommented-out here only as an explicit,
-- readable confirmation of that fact, not because anything runs.
-- (revoke/grant intentionally NOT reissued — see this file's own header.)


-- ============================================================
-- 4. UPDATE_DISPATCH — title check 70 -> 140, PLUS the two new
--    eligibility checks (30-minute window, reply lock). Reproduced in
--    full from its current live definition (docs/sql/2026-09-11-safety-
--    blocking-foundation.sql; docs/sql/2026-09-23-dispatch-replies.sql
--    added dispatch_replies afterward but never touched this function).
--    Same signature, same SECURITY DEFINER, same search_path.
-- ============================================================
create or replace function public.update_dispatch(
  p_dispatch_id uuid,
  p_title text,
  p_body text,
  p_topics text[] default '{}',
  p_moments jsonb default '[]'::jsonb
)
returns public.dispatches
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  result public.dispatches;
  -- NEW: captures published_at alongside the existence check itself, so
  -- the 30-minute comparison below needs no second query.
  v_dispatch record;
  topic text;
  normalized_topics text[] := '{}';
  paragraph_count integer;
  m jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'This action is not available right now.';
  end if;

  -- CHANGED (smoke-test contract completion): was a bare EXISTS; now a
  -- SELECT ... FOR UPDATE capturing published_at, so the ownership/
  -- status check, the FOR UPDATE lock this function's own eventual
  -- UPDATE requires anyway, and the timestamp needed for the 30-minute
  -- check below all happen in one query, against one snapshot. See this
  -- file's own header for the deadlock-free lock-ordering reasoning
  -- (matches create_reply's FOR SHARE on this same row).
  select d.id, d.published_at
  into v_dispatch
  from public.dispatches d
  where d.id = p_dispatch_id
    and d.author_id = auth.uid()
    and d.status = 'published'
  for update;

  if v_dispatch.id is null then
    raise exception 'Only the author of a published Dispatch may edit it.';
  end if;

  -- NEW: the 30-minute post-publish edit window. published_at is the
  -- ONLY authoritative anchor (dispatches has no updated_at column at
  -- all, and this function itself never sets one) — editing during the
  -- window never resets or extends it, by construction, since nothing
  -- below this point ever touches published_at.
  if now() > v_dispatch.published_at + interval '30 minutes' then
    raise exception 'This Dispatch can no longer be edited.';
  end if;

  -- NEW: the reply lock. Deliberately unfiltered by moderation_status/
  -- deleted_at — bare row EXISTENCE is the correct, permanent signal
  -- (see this file's own header for why: no dispatch_replies row can
  -- ever be hard-deleted). Evaluated fresh on every call, under the
  -- FOR UPDATE lock already taken above, so a reply that lands after
  -- this author's page loaded but before they click Save is already
  -- visible here — the race this checkpoint's own instructions warn
  -- about is closed by re-checking here, not by anything the client
  -- does.
  if exists (
    select 1 from public.dispatch_replies where dispatch_id = p_dispatch_id
  ) then
    raise exception 'This Dispatch can no longer be edited.';
  end if;

  if char_length(trim(p_title)) = 0 then
    raise exception 'A Dispatch needs a title.';
  end if;

  -- CHANGED (smoke-test contract completion): 70 -> 140, the same
  -- ceiling publish_dispatch now uses — create and edit continue to
  -- agree.
  if char_length(p_title) > 140 then
    raise exception 'Title is too long.';
  end if;

  if array_length(p_topics, 1) is not null and array_length(p_topics, 1) > 3 then
    raise exception 'A Dispatch may carry at most 3 topics.';
  end if;

  foreach topic in array coalesce(p_topics, '{}') loop
    topic := trim(topic);
    if char_length(topic) = 0 then
      continue;
    end if;
    if char_length(topic) > 40 then
      raise exception 'A topic is too long.';
    end if;
    if not exists (
      select 1 from unnest(normalized_topics) t where lower(t) = lower(topic)
    ) then
      normalized_topics := array_append(normalized_topics, topic);
    end if;
  end loop;

  if array_length(normalized_topics, 1) is not null and array_length(normalized_topics, 1) > 3 then
    raise exception 'A Dispatch may carry at most 3 topics.';
  end if;

  if coalesce(jsonb_array_length(p_moments), 0) > 0 then
    paragraph_count := coalesce(
      array_length(regexp_split_to_array(trim(both from p_body), '\n\s*\n'), 1),
      1
    );

    for m in select * from jsonb_array_elements(p_moments)
    loop
      if m->>'type' is distinct from 'photo' then
        raise exception 'Only still-image Moments are supported in a Dispatch.';
      end if;

      if
        (m->>'position')::integer < 0
        or (m->>'position')::integer >= paragraph_count
      then
        raise exception 'Moment position is out of range for this Dispatch.';
      end if;

      if auth.uid()::text is distinct from (storage.foldername(m->>'image_path'))[1] then
        raise exception 'A Moment photo must belong to the author.';
      end if;
    end loop;
  end if;

  update public.dispatches
  set title = p_title,
      body = p_body
  where id = p_dispatch_id;

  delete from public.dispatch_topics where dispatch_id = p_dispatch_id;
  if array_length(normalized_topics, 1) is not null then
    insert into public.dispatch_topics (dispatch_id, topic)
    select p_dispatch_id, t from unnest(normalized_topics) as t;
  end if;

  delete from public.dispatch_moments where dispatch_id = p_dispatch_id;
  if coalesce(jsonb_array_length(p_moments), 0) > 0 then
    insert into public.dispatch_moments (dispatch_id, position, image_path)
    select
      p_dispatch_id,
      (elem->>'position')::integer,
      elem->>'image_path'
    from jsonb_array_elements(p_moments) as elem;
  end if;

  select * into result from public.dispatches where id = p_dispatch_id;
  return result;
end;
$function$;

-- Signature unchanged — no DROP, no re-grant needed.


-- ============================================================
-- 5. WRITE_LETTER — Postcard back-message check 200 -> 300 only.
--    Reproduced in full from its current live definition (docs/sql/
--    2026-09-14-letter-level-postcards.sql). Same signature, same
--    SECURITY DEFINER, same search_path.
-- ============================================================
create or replace function public.write_letter(
  p_correspondence_id uuid,
  p_body text,
  p_reply_to_id uuid default null,
  p_moments jsonb default '[]'::jsonb,
  p_postcard jsonb default null
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

    -- CHANGED (smoke-test contract completion): 200 -> 300.
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

-- Signature unchanged — no DROP, no re-grant needed.


-- ============================================================
-- 6. REPLY_TO_LETTER — same single change as write_letter above.
--    Reproduced in full from its current live definition (docs/sql/
--    2026-09-14-letter-level-postcards.sql). Same signature, same
--    SECURITY DEFINER, same search_path.
-- ============================================================
create or replace function public.reply_to_letter(
  p_letter_id uuid,
  p_body text,
  p_moments jsonb default '[]'::jsonb,
  p_postcard jsonb default null
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

    -- CHANGED (smoke-test contract completion): 200 -> 300.
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

-- Signature unchanged — no DROP, no re-grant needed.

commit;
