-- Tempa — Mail Call / Delayed Delivery: FINAL ATOMIC DEPLOYMENT.
-- PREPARED 2026-09-04. NOT EXECUTED.
--
-- This is the single transaction to paste into the Supabase SQL editor.
-- It is the writer-integration migration
-- (2026-09-04-mail-call-writer-integration.sql) and the enforcement
-- migration (2026-09-04-mail-call-enforcement.sql), CANONICALIZED: every
-- object appears exactly once, already containing its final merged
-- behavior. reply_to_letter and close_letter previously appeared twice
-- in this file (an intermediate writer-integration body followed by a
-- superseding enforcement body, relying on CREATE OR REPLACE to pick
-- the winner) — that has been collapsed. Each now appears exactly once,
-- with the writer-integration logic (deliver_at computation, the same-
-- direction clamp, and — for close_letter — the conditional
-- correspondence-closure guard) and the enforcement addition (the
-- deliver_at <= now() delivery guard) combined into one body from the
-- start. No behavior changed in this pass — only the number of times
-- each definition appears.
--
-- Prerequisite, already live and verified, NOT included in this file:
-- Migration 1 (letters.deliver_at), Migration 2 (profiles.country_code
-- + country_continent), Migration 3 (compute_deliver_at).
--
-- Every SECURITY DEFINER function below uses
-- set search_path to 'pg_catalog', with every non-pg_catalog object
-- explicitly schema-qualified (public.*, auth.uid()) and every
-- gen_random_uuid() call qualified as pg_catalog.gen_random_uuid().
--
-- Verification SQL lives separately in
-- docs/sql/2026-09-04-mail-call-atomic-verify.sql — nothing below reads
-- or writes any row that a real user's action didn't already create.

BEGIN;

-- ============================================================
-- ENFORCE_LETTER_IMMUTABILITY
-- Freezes deliver_at alongside the fields it already froze. Not
-- SECURITY DEFINER (never has been) — no search_path hardening
-- applicable; no schema-resolvable references in its body at all (only
-- NEW/OLD record field access and RAISE EXCEPTION).
-- ============================================================

create or replace function public.enforce_letter_immutability()
returns trigger
language plpgsql
as $function$
begin

  if
       new.sender_id <> old.sender_id
    or new.recipient_id <> old.recipient_id
    or new.question_answer_id is distinct from old.question_answer_id
    or new.reply_to_id is distinct from old.reply_to_id
    or new.correspondence_id <> old.correspondence_id
    or new.body <> old.body
    or new.created_at <> old.created_at
    or new.expires_at <> old.expires_at
    or new.deliver_at <> old.deliver_at
  then
    raise exception
      'Letters are immutable except for their lifecycle status fields.';
  end if;


  if
    old.status in ('replied', 'closed')
    and new.status <> old.status
  then
    raise exception
      'This letter has already reached a terminal state.';
  end if;


  return new;

end;
$function$;


-- ============================================================
-- SEND_FIRST_LETTER
-- Reverse-direction-safe state machine (S1-S5): S1 no correspondence
-- exists -> create, allow. S2 caller already sent their own root into
-- the active correspondence -> reject, errcode 23505 (matches the
-- existing client's "You've already written to them" branch, still
-- accurate for this case). S3 only the OTHER participant has an
-- undelivered/unestablished root -> silently reuse the correspondence,
-- allow caller's own root, response identical to S1's, no exception. S4
-- correspondence is established -> reject, deliberately untagged
-- (default SQLSTATE P0001, NOT 23505 — sharing S2's code would make the
-- client show the misleading "already written" string for an ongoing
-- established correspondence). S5 only closed historical
-- correspondence(s) exist -> the ON CONFLICT target only constrains
-- ACTIVE rows, so the INSERT succeeds normally, identical to S1.
-- deliver_at is computed server-side via compute_deliver_at;
-- expires_at = deliver_at + 72h, set explicitly, never via the column
-- default.
-- ============================================================

create or replace function public.send_first_letter(
  p_recipient_id uuid,
  p_question_answer_id uuid,
  p_body text
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
  v_established_at timestamptz;
  v_deliver_at timestamptz;
  v_expires_at timestamptz;
  result public.letters_for_participant;

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;


  if auth.uid() = p_recipient_id then
    raise exception
      'You cannot write a first-contact letter to yourself.';
  end if;


  if not exists (
    select 1
    from public.profiles
    where id = p_recipient_id
  ) then
    raise exception 'Recipient does not exist.';
  end if;


  if not exists (
    select 1

    from public.question_answers qa

    join public.questions q
      on q.id = qa.question_id

    where
      qa.id = p_question_answer_id
      and qa.user_id = p_recipient_id
      and qa.is_current = true
      and q.is_active = true
  ) then
    raise exception
      'That Question answer is not currently a live Discovery entry for the intended recipient.';
  end if;


  v_participant_low := least(auth.uid(), p_recipient_id);
  v_participant_high := greatest(auth.uid(), p_recipient_id);


  -- Reverse-direction-safe correspondence resolution (S1/S3/S5): create
  -- if no active episode exists for this pair; if one already does
  -- (either because caller already sent, or because the OTHER party
  -- did), silently reuse it instead of raising.
  insert into public.correspondences (participant_low, participant_high)
  values (v_participant_low, v_participant_high)
  on conflict (participant_low, participant_high) where status = 'active'
  do nothing
  returning id into v_correspondence_id;

  if v_correspondence_id is null then
    select id
    into v_correspondence_id
    from public.correspondences
    where participant_low = v_participant_low
      and participant_high = v_participant_high
      and status = 'active';
  end if;

  select established_at
  into v_established_at
  from public.correspondences
  where id = v_correspondence_id
  for update;


  if v_established_at is not null then
    -- Deliberately NOT tagged errcode 23505, unlike S2 below.
    raise exception
      'This correspondence is already established. Use write_letter instead.';
  end if;


  if exists (
    select 1
    from public.letters
    where correspondence_id = v_correspondence_id
      and reply_to_id is null
      and sender_id = auth.uid()
  ) then
    raise exception
      'You have already sent a first-contact letter to this recipient.'
      using errcode = '23505';
  end if;


  v_new_id := pg_catalog.gen_random_uuid();
  v_deliver_at := public.compute_deliver_at(auth.uid(), p_recipient_id, v_new_id);
  v_expires_at := v_deliver_at + interval '72 hours';


  insert into public.letters (
    id,
    sender_id,
    recipient_id,
    question_answer_id,
    correspondence_id,
    body,
    deliver_at,
    expires_at
  )
  values (
    v_new_id,
    auth.uid(),
    p_recipient_id,
    p_question_answer_id,
    v_correspondence_id,
    p_body,
    v_deliver_at,
    v_expires_at
  );


  select *
  into result

  from public.letters_for_participant

  where id = v_new_id;


  return result;

end;
$function$;


-- ============================================================
-- REPLY_TO_LETTER — single canonical definition.
-- Combines: deliver_at computation via compute_deliver_at, the same-
-- direction ordering clamp (unconditional correspondence lock, taken
-- once, reused by both the moments-validation block and the clamp —
-- required for the clamp to be race-safe against a concurrent
-- reply_to_letter/write_letter call in the same correspondence), AND
-- the recipient delivery guard (deliver_at <= now() in the target-
-- letter lookup, so a direct RPC call on a guessed/known undelivered
-- letter id cannot reply to content the caller was never shown).
-- ============================================================

create or replace function public.reply_to_letter(
  p_letter_id uuid,
  p_body text,
  p_moments jsonb default '[]'::jsonb
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


  -- Same-direction ordering clamp. The correspondence lock above
  -- serializes this against any other concurrent letter creation
  -- (reply_to_letter or write_letter) in this same correspondence.
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

  -- GREATEST ignores a null argument (only returns null if every
  -- argument is), so this correctly collapses to v_natural_deliver_at
  -- alone when there is no previous same-direction letter.
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


-- ============================================================
-- WRITE_LETTER
-- Already-established-correspondence letter creation; deliver_at via
-- compute_deliver_at with the same-direction clamp; the correspondence
-- lock taken unconditionally at the top already covers the clamp's
-- race-safety needs.
-- ============================================================

create or replace function public.write_letter(
  p_correspondence_id uuid,
  p_body text,
  p_reply_to_id uuid default null,
  p_moments jsonb default '[]'::jsonb
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


  -- Same-direction ordering clamp. write_letter already locks the
  -- correspondence row unconditionally (above), confirmed sufficient
  -- for this.
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


  select *
  into result

  from public.letters_for_participant

  where id = new_id;


  return result;

end;
$function$;


-- ============================================================
-- CLOSE_LETTER — single canonical definition.
-- Combines: the conditional correspondence-closure guard (a
-- correspondence may carry two root letters, one per direction —
-- closing THIS one must not also close the correspondence if it's
-- already established or the OTHER direction's root is still live) AND
-- the recipient delivery guard (deliver_at <= now() in the UPDATE's
-- WHERE clause, so a direct RPC call on a guessed/known undelivered
-- letter id cannot decline content the caller was never shown).
-- ============================================================

create or replace function public.close_letter(
  p_letter_id uuid,
  p_reason text
)
returns public.letters_for_participant
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$

declare
  closed_letter public.letters;
  corr public.correspondences;
  other_root_live boolean;
  result public.letters_for_participant;

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;


  update public.letters

  set
    status = 'closed',
    closed_at = now(),
    closed_by = 'recipient',
    close_reason = p_reason

  where
    id = p_letter_id
    and recipient_id = auth.uid()
    and reply_to_id is null
    and status = 'sent'
    and expires_at > now()
    and deliver_at <= now()

  returning *
  into closed_letter;


  if not found then
    raise exception
      'Letter not found, not addressed to you, or no longer awaiting a decision.';
  end if;


  select *
  into corr

  from public.correspondences

  where id = closed_letter.correspondence_id

  for update;


  select exists (
    select 1
    from public.letters
    where correspondence_id = corr.id
      and reply_to_id is null
      and id <> closed_letter.id
      and status = 'sent'
      and expires_at > now()
  )
  into other_root_live;

  if corr.established_at is null and not other_root_live then

    update public.correspondences

    set
      status = 'closed',
      closed_at = closed_letter.closed_at

    where id = corr.id;

  end if;


  select *
  into result

  from public.letters_for_participant

  where id = p_letter_id;


  return result;

end;
$function$;


-- ============================================================
-- EXPIRE_STALE_FIRST_CONTACTS
-- Closes correspondences conditionally (established_at is null AND no
-- other root remains live), de-duplicating correspondence ids before
-- the second UPDATE since two roots in the same correspondence can now
-- legitimately expire in the same batch run. Never needs a deliver_at
-- guard: expires_at = deliver_at + 72h always, so deliver_at > now()
-- implies expires_at > now() too — this function's own
-- expires_at <= now() filter can never match an undelivered letter,
-- mathematically.
-- ============================================================

create or replace function public.expire_stale_first_contacts()
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$

declare
  affected integer;

begin

  with expired as (
    update public.letters

    set
      status = 'closed',
      closed_at = now(),
      closed_by = 'system',
      close_reason = null

    where
      status = 'sent'
      and reply_to_id is null
      and expires_at <= now()

    returning id, correspondence_id
  )
  update public.correspondences c

  set
    status = 'closed',
    closed_at = now()

  from (select distinct correspondence_id from expired) e

  where c.id = e.correspondence_id
    and c.established_at is null
    and not exists (
      select 1
      from public.letters l
      where l.correspondence_id = c.id
        and l.reply_to_id is null
        and l.status = 'sent'
        and l.expires_at > now()
    );


  get diagnostics affected = row_count;


  return affected;

end;
$function$;


-- ============================================================
-- LETTERS_FOR_PARTICIPANT — the core enforcement point.
-- Sender branch unconditional — a sender always sees their own
-- outgoing letter immediately, including while in transit. Recipient
-- branch requires deliver_at <= now() — a ROW-LEVEL exclusion, not
-- field-masking. Every downstream read path (getMyLetters,
-- getLetterById, getLettersForCorrespondence, getFirstContact,
-- getReplyTo, getWaitingLetterCount, getLetterArchiveWithUser,
-- getFirstLockedPhotoLetterMoment, moments_select_participant,
-- getMomentsForLetters) inherits this automatically.
-- ============================================================

create or replace view public.letters_for_participant
with (
  security_barrier = true
)
as
select
  l.id,
  l.sender_id,
  l.recipient_id,
  l.question_answer_id,
  l.reply_to_id,
  l.body,
  l.status,
  l.created_at,
  l.expires_at,
  l.replied_at,
  l.closed_at,
  l.closed_by,
  l.close_reason,

  (
    l.recipient_id = auth.uid()
    and l.opened_at is null
  ) as is_unread,

  l.correspondence_id

from public.letters l

where
  auth.uid() = l.sender_id
  or (auth.uid() = l.recipient_id and l.deliver_at <= now());


-- ============================================================
-- SEARCH_LETTERBOX — bypasses the view by design (needs body_search /
-- raw body directly), so it independently reproduces the same delivery
-- rule in both branches: the people branch requires at least one row
-- already visible through letters_for_participant for that
-- correspondence; the letters branch requires deliver_at <= now() on
-- the recipient side, sender side unconditional.
-- ============================================================

create or replace function public.search_letterbox(
  p_query text,
  p_people_limit int default 5,
  p_letters_limit int default 20,
  p_letters_offset int default 0
)
returns table (
  kind text,
  person_id uuid,
  pseudonym text,
  letter_id uuid,
  correspondence_id uuid,
  other_pseudonym text,
  created_at timestamptz,
  excerpt text,
  rank real
)
language plpgsql
security definer
set search_path to 'pg_catalog'
stable
as $function$

declare
  v_uid uuid := auth.uid();
  v_query text := trim(coalesce(p_query, ''));
  v_escaped_query text;
  v_people_limit int := least(greatest(coalesce(p_people_limit, 5), 1), 20);
  v_letters_limit int := least(greatest(coalesce(p_letters_limit, 20), 1), 50);
  v_letters_offset int := least(greatest(coalesce(p_letters_offset, 0), 0), 10000);
  v_tsquery tsquery;

begin

  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  if v_query = '' then
    return;
  end if;

  v_escaped_query := replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_');

  v_tsquery := websearch_to_tsquery('simple'::regconfig, v_query);

  return query
  with people as (
    select
      'person'::text as kind,
      p.id as person_id,
      p.pseudonym,
      null::uuid as letter_id,
      null::uuid as correspondence_id,
      null::text as other_pseudonym,
      null::timestamptz as created_at,
      null::text as excerpt,
      null::real as rank
    from (
      select distinct
        case when c.participant_low = v_uid then c.participant_high else c.participant_low end as other_id
      from public.correspondences c
      where (c.participant_low = v_uid or c.participant_high = v_uid)
        and not exists (
          select 1 from public.correspondence_hidden_for_user h
          where h.correspondence_id = c.id and h.user_id = v_uid
        )
        and exists (
          select 1 from public.letters_for_participant lp
          where lp.correspondence_id = c.id
        )
    ) candidates
    join public.profiles p on p.id = candidates.other_id
    where p.pseudonym ilike ('%' || v_escaped_query || '%') escape '\'
    order by
      (lower(p.pseudonym) = lower(v_query)) desc,
      (p.pseudonym ilike (v_escaped_query || '%') escape '\') desc,
      p.pseudonym asc,
      p.id asc
    limit v_people_limit
  ),
  letters as (
    select *
    from (
      select
        'letter'::text as kind,
        null::uuid as person_id,
        null::text as pseudonym,
        l.id as letter_id,
        l.correspondence_id,
        other_p.pseudonym as other_pseudonym,
        l.created_at,
        ts_headline(
          'simple'::regconfig,
          l.body,
          v_tsquery,
          'StartSel=⟦⟦, StopSel=⟧⟧, MaxWords=20, MinWords=6, ShortWord=3, HighlightAll=false'
        ) as excerpt,
        ts_rank(l.body_search, v_tsquery) as rank
      from public.letters l
      join public.profiles other_p
        on other_p.id = case when l.sender_id = v_uid then l.recipient_id else l.sender_id end
      where (l.sender_id = v_uid or (l.recipient_id = v_uid and l.deliver_at <= now()))
        and l.body_search @@ v_tsquery
        and not exists (
          select 1 from public.correspondence_hidden_for_user h
          where h.correspondence_id = l.correspondence_id and h.user_id = v_uid
        )
    ) letter_candidates
    order by
      letter_candidates.rank desc,
      letter_candidates.created_at desc,
      letter_candidates.letter_id asc
    limit v_letters_limit
    offset v_letters_offset
  ),
  combined as (
    select * from people
    union all
    select * from letters
  )
  select
    combined.kind,
    combined.person_id,
    combined.pseudonym,
    combined.letter_id,
    combined.correspondence_id,
    combined.other_pseudonym,
    combined.created_at,
    combined.excerpt,
    combined.rank
  from combined
  order by
    (combined.kind = 'letter') asc,
    (lower(combined.pseudonym) = lower(v_query)) desc nulls last,
    (combined.pseudonym ilike (v_escaped_query || '%') escape '\') desc nulls last,
    combined.pseudonym asc nulls last,
    combined.person_id asc nulls last,
    combined.rank desc nulls last,
    combined.created_at desc nulls last,
    combined.letter_id asc nulls last;

end;
$function$;

revoke all on function public.search_letterbox(text, int, int, int) from public;
revoke all on function public.search_letterbox(text, int, int, int) from anon;
revoke all on function public.search_letterbox(text, int, int, int) from authenticated;
grant execute on function public.search_letterbox(text, int, int, int) to authenticated;


-- ============================================================
-- CAN_VIEW_LETTER_PHOTO — backs the letter_photos_select storage
-- policy; bypasses the view, independently enforces delivery. Photo-
-- consent semantics unchanged; deliver_at <= now() is an additional AND
-- on the recipient branch only — sender branch untouched.
-- ============================================================

create or replace function public.can_view_letter_photo(
  p_path text
)
returns boolean
language sql
security definer
set search_path to 'pg_catalog'
stable
as $$
  select exists (
    select 1
    from public.moments m
    join public.letters l on l.id = m.letter_id
    join public.correspondences c on c.id = l.correspondence_id
    where m.image_path = p_path
      and (c.participant_low = auth.uid() or c.participant_high = auth.uid())
      and (
        l.sender_id = auth.uid()
        or (c.photo_consent_status = 'enabled' and l.deliver_at <= now())
      )
  );
$$;


-- ============================================================
-- MARK_LETTER_OPENED — bypasses the view, independently enforces
-- delivery (defense in depth: the app can't reach an undelivered id
-- once the view is fixed, but a direct RPC call could otherwise).
-- ============================================================

create or replace function public.mark_letter_opened(
  p_letter_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;


  update public.letters

  set opened_at = now()

  where
    id = p_letter_id
    and recipient_id = auth.uid()
    and opened_at is null
    and deliver_at <= now();

end;
$function$;


-- ============================================================
-- LETTERS_SELECT_PARTICIPANT — base-table RLS policy, defense-in-depth
-- hardening. Currently unreachable (authenticated has zero grant on
-- public.letters); this policy change alone grants no new table
-- privilege — it only ever restricts a role that already has a grant.
-- ============================================================

drop policy if exists letters_select_participant on public.letters;

create policy letters_select_participant
  on public.letters
  for select
  using (
    auth.uid() = sender_id
    or (auth.uid() = recipient_id and deliver_at <= now())
  );


COMMIT;
