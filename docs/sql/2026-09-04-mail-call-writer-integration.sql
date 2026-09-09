-- Tempa — Mail Call / Delayed Delivery, Migration 4 of N: writer
-- integration (real deliver_at, same-direction clamp, reverse-direction
-- state machine, conditional correspondence closure).
-- PREPARED 2026-09-04. NOT EXECUTED.
--
-- ============================================================
-- DO NOT RUN THIS FILE ON ITS OWN
-- ============================================================
--
-- This migration makes newly-created letters get real, meaningful
-- future deliver_at values — but letters_for_participant, search_
-- letterbox, can_view_letter_photo, and mark_letter_opened are
-- deliberately UNTOUCHED here, so nothing about recipient visibility
-- changes yet, per this checkpoint's explicit scope.
--
-- That gap is the problem. The shortest delay this system can produce
-- is ~2h45m (same-region band, see the compute_deliver_at migration's
-- effective-range analysis). Any letter created after THIS migration
-- lands but BEFORE the enforcement migration lands would be immediately
-- fully visible to its recipient (enforcement hasn't changed), carrying
-- a real future deliver_at — and then, the instant enforcement flips
-- on, that letter would DISAPPEAR from the recipient's Letterbox/
-- reader/search if its deliver_at hasn't passed yet. Not a privacy
-- leak (nothing is exposed that wasn't already exposed under today's
-- behavior), but a real, confusing, entirely avoidable product bug — a
-- letter a recipient could see now silently vanishing later.
--
-- "Run back-to-back in one maintenance window" reduces the odds of a
-- letter landing in that gap but does not eliminate it — it's a timing
-- promise on a live app with real signed-up users, not a guarantee.
-- The only actual guarantee is transactional: wrap this file's function
-- bodies and the enforcement migration's (once prepared) together in
-- ONE BEGIN...COMMIT at execution time, so the gap is zero wall-clock
-- time by construction, not by discipline. This file keeps its own
-- BEGIN/COMMIT for review purposes only — combine before running.
--
-- ============================================================
-- SCOPE
-- ============================================================
--
-- Changes: send_first_letter, reply_to_letter, write_letter,
-- close_letter, expire_stale_first_contacts, enforce_letter_immutability.
-- Does NOT change: letters_for_participant, search_letterbox,
-- can_view_letter_photo, mark_letter_opened, any RLS policy, historical
-- letters, photo consent logic, Moments validation, reply_to_id
-- meaning, established_at meaning, write_letter's own authorization
-- gate, hidden-correspondence behavior, or any application code.
--
-- ============================================================
-- SEARCH-PATH HARDENING PASS
-- ============================================================
--
-- All four SECURITY DEFINER functions in this file now use
-- `set search_path to 'pg_catalog'` (previously 'public'), matching
-- search_letterbox's and compute_deliver_at's existing convention.
-- Audited every unqualified reference in each body first: every
-- public.* table/view/function and auth.uid() call was already
-- explicitly schema-qualified; the one genuine gap was gen_random_uuid()
-- in send_first_letter/reply_to_letter/write_letter, now qualified as
-- pg_catalog.gen_random_uuid() explicitly (Postgres 13+ provides this
-- natively in pg_catalog, no pgcrypto/extensions dependency expected —
-- see checkpoint report for the recommended pre-flight verification
-- query). expire_stale_first_contacts needed no reference changes at
-- all, only the search_path line, since it generates no new UUIDs and
-- every table reference was already public.*-qualified. No logic
-- changed anywhere in this pass — only the search_path declarations and
-- the gen_random_uuid() qualification.
--
-- enforce_letter_immutability is NOT part of this hardening pass — it
-- is not, and has never been, SECURITY DEFINER (confirmed from its
-- original definition and unchanged here), so it has no privilege
-- elevation for a hijacked search-path lookup to exploit. It also has
-- zero schema-resolvable references in its body (only NEW/OLD record
-- field access and RAISE EXCEPTION) — out of scope for this audit, and
-- nothing to harden even if it were in scope.
--
-- ============================================================
-- FINDINGS FROM RE-READING CURRENT LIVE DEFINITIONS
-- ============================================================
--
-- 1. enforce_letter_immutability does not yet freeze deliver_at —
--    Migration 1 added the column but this trigger was out of scope
--    then. Added here (deliver_at is NOT NULL, so a plain <> comparison
--    is correct, matching created_at/expires_at's existing treatment).
--
-- 2. reply_to_letter's current locking is insufficient for the new
--    same-direction clamp. It locks only the target letter, and only
--    conditionally locks the correspondence (when moment_count > 0).
--    Two concurrent replies to two different letters in the same
--    correspondence would take different target-letter locks and never
--    serialize against each other. Fixed by taking an UNCONDITIONAL
--    correspondence lock once, reused by both the existing moments
--    validation and the new clamp (removing the now-redundant
--    conditional re-lock). write_letter already locks the
--    correspondence unconditionally — confirmed sufficient, unchanged.
--
-- correspondences_one_active_per_pair (unique partial index on
-- (participant_low, participant_high) where status = 'active') is what
-- the ON CONFLICT clause below targets — confirmed unchanged.
-- letters_one_first_contact_per_pair and letters_one_reply_per_original
-- are both already dropped by earlier migrations — nothing at the
-- schema level limits how many root letters (reply_to_id is null) a
-- correspondence can have; that is now enforced entirely by
-- send_first_letter's own state-machine logic below.
--
-- ============================================================
-- SEND_FIRST_LETTER STATE MACHINE
-- ============================================================
--
-- S1 no correspondence exists for the pair -> create, allow.
-- S2 caller already sent their own root into the active correspondence
--    -> reject (duplicate). SQLSTATE 23505 (explicitly tagged via USING
--    ERRCODE, not a real constraint violation), message "You have
--    already sent a first-contact letter to this recipient." — tagged
--    specifically so the EXISTING client-side `sendError.code ===
--    '23505'` branch in first-letter-composer.tsx keeps showing its
--    current, still-accurate message without any TypeScript change.
-- S3 only the OTHER participant has an undelivered/unestablished root
--    -> reuse the correspondence silently, allow caller's own root,
--    client response identical to S1's. No exception, no special code.
-- S4 correspondence is established (established_at is not null) ->
--    reject. Deliberately NOT tagged 23505 — see the exception site and
--    "KNOWN CLIENT-SIDE CONSEQUENCE" below for why sharing S2's code
--    would actively mislead here. SQLSTATE P0001 (plpgsql's default),
--    message "This correspondence is already established. Use
--    write_letter instead."
-- S5 only closed historical correspondence(s) exist, no active one ->
--    the ON CONFLICT target only constrains ACTIVE rows, so the INSERT
--    succeeds normally, identical to S1. No special-casing needed.
--
-- Locking: INSERT ... ON CONFLICT (...) WHERE status='active' DO
-- NOTHING is the synchronization primitive for the "does an active row
-- already exist" race (Postgres's speculative-insertion protocol blocks
-- the losing transaction until the winner's ENTIRE transaction commits
-- or aborts — not just its INSERT statement — so by the time the loser
-- proceeds, the winner's own letter insert, including its "do I already
-- have a root" check, has already committed). The subsequent
-- established_at read is done via a SELECT ... FOR UPDATE against the
-- resolved correspondence id regardless of which branch produced it —
-- for the fresh-create branch this is a no-op lock (already implicitly
-- held via the uncommitted own-transaction insert) but keeps the code
-- path uniform and correctly serializes the reuse branch, including
-- against a same-caller double-submit. No advisory lock needed — this
-- was checked, not assumed (see report).
--
-- ============================================================
-- SAME-DIRECTION ORDERING CLAMP
-- ============================================================
--
-- deliver_at(new) = greatest(natural_deliver_at, previous_same_direction_
-- deliver_at + interval '1 minute'), where "previous" means the most
-- recently CREATED letter with the same sender_id/recipient_id/
-- correspondence_id (order by created_at desc limit 1) — never across
-- directions. Implemented as a single GREATEST() call rather than an
-- IF/ELSE: Postgres's GREATEST ignores a null argument (only returns
-- null if every argument is null), so when there is no previous letter
-- the expression correctly collapses to natural_deliver_at alone with
-- no branching needed. Applies in reply_to_letter and write_letter,
-- both now correspondence-lock-protected (see finding 2). Does NOT
-- apply in send_first_letter: a root letter is, by construction of the
-- state machine above, always the caller's ONLY letter in that
-- correspondence so far (S2 rejects a second one before any insert), so
-- there is never a "previous same-direction letter" to clamp against
-- for a first-contact send.
--
-- ============================================================
-- FIRST-CONTACT EXPIRY
-- ============================================================
--
-- send_first_letter explicitly sets expires_at = deliver_at + 72h on
-- its own INSERT, never relying on the column default. reply_to_letter
-- and write_letter do not set expires_at at all — it keeps getting the
-- table's plain default, exactly as today, harmless and unread for
-- non-root letters (every eligibility check that matters is already
-- gated on reply_to_id is null).
--
-- ============================================================
-- REVERSE-DIRECTION LIFECYCLE CORRECTION
-- ============================================================
--
-- Once a correspondence can carry two root letters (one per direction),
-- close_letter and expire_stale_first_contacts must not close the whole
-- correspondence just because ONE root is declined/expired. "Live" is
-- defined precisely as the SAME eligibility predicate already used
-- everywhere else a root's actionability is checked (reply_to_letter's
-- own original-letter lookup): status = 'sent' and expires_at > now()
-- (reply_to_id is not null never applies to a root by definition, so
-- that half of the usual predicate is omitted here). No new lifecycle
-- column introduced. Rule: close the correspondence only when
-- established_at is null AND no other root in it is still live.
--
-- expire_stale_first_contacts also now de-duplicates correspondence ids
-- before its second UPDATE (select distinct ...) — a genuine, newly-
-- possible scenario where TWO roots in the SAME correspondence expire
-- in the SAME batch run needed this; the previous version's own comment
-- ("every expired row owns exactly one correspondence... can never
-- contain two rows pointing at the same correspondence_id") is no
-- longer true once reverse-direction reuse exists, and is corrected
-- here rather than left stale.
--
-- BEHAVIOR-MEANING CHANGE, worth flagging explicitly: this function's
-- returned integer previously meant "letters expired = correspondences
-- closed" under the old 1:1 assumption. It still returns "correspondences
-- closed" (same statement position as before), but that number may now
-- be LESS than the number of letters actually expired in the same run,
-- whenever the new established_at/other-live-root guard keeps a
-- correspondence open despite one of its roots expiring. Nothing
-- currently reads this return value, but noting it for whoever eventually
-- does.
--
-- ============================================================
-- KNOWN CLIENT-SIDE CONSEQUENCE — not fixed here, TypeScript untouched
-- per this checkpoint's scope
-- ============================================================
--
-- Before this migration, EVERY case that raised 23505 from
-- send_first_letter (duplicate self-send, established, reverse-
-- direction) came from the same real pair-level unique-constraint
-- violation, and first-letter-composer.tsx's `sendError.code ===
-- '23505'` branch caught all of them, showing "You've already written
-- to {name}." — the same string regardless of which case it actually
-- was, since the client only inspects the CODE, never the message text.
--
-- After this migration:
--   S3 (reverse-direction) no longer errors at all — succeeds normally,
--     exactly as required.
--   S2 (genuine duplicate) is preserved via an explicit `USING ERRCODE
--     = '23505'` tag, so the EXISTING unmodified client code keeps
--     showing its current message — still accurate for this case.
--   S4 (established) is deliberately LEFT UNTAGGED (default SQLSTATE
--     P0001), specifically because reusing S2's code would make the
--     client show the SAME "You've already written to them" string for
--     an ongoing, established correspondence — misleading, since that
--     phrasing implies one unanswered letter, not an active exchange.
--     Untagged, it falls through to the client's generic "Could not
--     send your letter. Please try again." — less specific, but not
--     wrong. A dedicated client-side message for this case is future
--     TypeScript-checkpoint work, out of scope here.
-- Nothing further is needed for THIS checkpoint's scope, but the
-- eventual TypeScript checkpoint should stop branching on error CODE as
-- a compatibility shim for S2 too, and read distinct signals directly.

begin;

-- ============================================================
-- ENFORCE_LETTER_IMMUTABILITY — now also freezes deliver_at
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
  -- did), silently reuse it instead of raising. See header for the full
  -- locking analysis.
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
    -- Deliberately NOT tagged errcode 23505, unlike S2 below. The
    -- existing client (first-letter-composer.tsx) only branches on
    -- error CODE, not message text — tagging both S2 and S4 with 23505
    -- would make an established-correspondence attempt render the
    -- SAME "You've already written to {name}" string as a genuine
    -- duplicate, which is actively misleading here (this is an ongoing
    -- correspondence, not one unsent letter). Left untagged (default
    -- PL/pgSQL SQLSTATE P0001), it falls through to the client's
    -- generic "Could not send your letter" message instead — less
    -- specific, but not wrong. A dedicated client-side branch for this
    -- case is future TypeScript-checkpoint work, out of scope here.
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
-- REPLY_TO_LETTER
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


  -- Unconditional correspondence lock (see header, finding 2) — needed
  -- by the clamp below on EVERY reply, not just moment-bearing ones, so
  -- this replaces the previous conditional lock inside the moments
  -- block; that block now reuses corr rather than re-selecting.
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


  -- Same-direction ordering clamp — see header. The correspondence lock
  -- above serializes this against any other concurrent letter creation
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


  -- Same-direction ordering clamp — see header. write_letter already
  -- locks the correspondence row unconditionally (above), confirmed
  -- sufficient for this.
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
-- CLOSE_LETTER — now closes the correspondence conditionally
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


  -- Conditional closure — see header "REVERSE-DIRECTION LIFECYCLE
  -- CORRECTION". A correspondence may now carry up to two root letters,
  -- one per direction; closing THIS one must not also close the
  -- correspondence if it's already established or the OTHER direction's
  -- root is still live.
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
-- EXPIRE_STALE_FIRST_CONTACTS — now closes correspondences conditionally
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


commit;


-- ============================================================
-- VERIFY (optional — NOT read-only: these exercise the RPCs against
-- real data using the established auth-impersonation pattern. Run only
-- after the COMBINED migration — this file plus the enforcement
-- migration — has been executed together, per the header above. I
-- cannot run any of this myself in this environment (no service-role
-- key/CLI) — every query below needs real profile ids substituted in.
-- ============================================================

-- Find real candidate profiles first (reuse Migration 3's query 0).
select id, country, region, country_code from public.profiles order by country_code nulls last;

-- ------------------------------------------------------------
-- Auth impersonation pattern, as established earlier this session.
-- ------------------------------------------------------------
-- select set_config('request.jwt.claims', json_build_object('sub','<A-uuid>','role','authenticated')::text, true);
-- set local role authenticated;

-- 1 & 2. New first contact: deliver_at > created_at, and
--    expires_at - deliver_at = exactly 72 hours.
-- select send_first_letter('<B-uuid>', '<some-current-answer-id-of-B>', 'test letter body');
-- select id, created_at, deliver_at, expires_at,
--   deliver_at > created_at as deliver_after_created,
--   (expires_at - deliver_at) = interval '72 hours' as expiry_exactly_72h_after_delivery
-- from public.letters
-- where sender_id = '<A-uuid>' and recipient_id = '<B-uuid>' and reply_to_id is null
-- order by created_at desc limit 1;

-- 3. Same-direction second letter >= previous + 1 minute. Requires an
--    ESTABLISHED correspondence between A and B first (reply once as B,
--    then send two ordinary letters A->B back to back via write_letter).
-- select write_letter('<correspondence-id>', 'first ordinary letter');
-- select write_letter('<correspondence-id>', 'second ordinary letter, sent moments later');
-- select id, created_at, deliver_at
-- from public.letters
-- where correspondence_id = '<correspondence-id>' and sender_id = '<A-uuid>' and recipient_id = '<B-uuid>'
-- order by created_at asc;
-- Expect: second row's deliver_at >= first row's deliver_at + interval '1 minute'.

-- 4. Crossed letters remain independent — A sends B, B sends A, neither
--    blocks the other, each gets its own deliver_at unrelated to the
--    other's. Use a pair with no prior first-contact history for this
--    test (or capture correspondence_id directly from the RPC return
--    values below rather than re-deriving it), since the original
--    version of this query used a bare subquery
--    (select correspondence_id from letters where sender_id=A and
--    recipient_id=B and reply_to_id is null) that would ERROR ("more
--    than one row returned by a subquery used as an expression") if A
--    has ever re-contacted B across a prior closed-then-reopened
--    correspondence (send_first_letter's own S5 case) — fixed below by
--    capturing the id explicitly instead of re-querying ambiguously.
-- select id as a_to_b_letter_id, correspondence_id as fixture_correspondence_id
--   from send_first_letter('<B-uuid>', '<answer-of-B>', 'A to B');  -- (as A) capture both columns
-- select id as b_to_a_letter_id
--   from send_first_letter('<A-uuid>', '<answer-of-A>', 'B to A');  -- (as B)
-- select sender_id, recipient_id, deliver_at, correspondence_id
-- from public.letters
-- where correspondence_id = '<fixture-correspondence-id-captured-above>'
-- order by created_at;
-- Expect: two rows, opposite directions, independently-computed deliver_at values (no relationship enforced between them).

-- 5. Reverse-direction first contacts share exactly one correspondence
--    row — direct database proof, not just the client-visible response.
--    Scoped to the SPECIFIC correspondence captured in test 4, not to
--    "every root ever exchanged between A and B" — the original version
--    of this query counted across A and B's entire history, which would
--    wrongly show more than 1 if this pair has any prior closed-and-
--    reopened correspondence (again, the S5 case) rather than indicating
--    a bug.
-- select count(distinct correspondence_id) as distinct_correspondences
-- from public.letters
-- where reply_to_id is null
--   and correspondence_id = '<fixture-correspondence-id-captured-in-test-4>';
-- Expect: 1.

-- 6. Duplicate same-sender first contact still rejected.
-- select set_config('request.jwt.claims', json_build_object('sub','<A-uuid>','role','authenticated')::text, true);
-- set local role authenticated;
-- select send_first_letter('<B-uuid>', '<answer-of-B>', 'trying again');
-- Expect: exception "You have already sent a first-contact letter to this recipient." (errcode 23505).

-- 7. Established correspondence rejects send_first_letter.
-- (after B has replied to A, establishing the correspondence)
-- select send_first_letter('<B-uuid>', '<answer-of-B>', 'should be rejected');
-- Expect: exception "This correspondence is already established. Use write_letter instead."
-- (SQLSTATE P0001, the plpgsql default — deliberately NOT 23505, see header).

-- 8. Closing/expiring one root does not close the correspondence while
--    the other root remains live. Using the crossed-letters pair from
--    test 4 (neither yet replied/established):
-- (as B, declining A's letter)
-- select close_letter('<A-to-B-letter-id>', 'I can''t take on another correspondence right now.');
-- select status, established_at from public.correspondences where id = '<correspondence-id>';
-- Expect: status = 'active' still (NOT 'closed'), because B's own letter to A is still a live root.
-- select status from public.letters where id = '<B-to-A-letter-id>';
-- Expect: 'sent', untouched by A's-side closure.

-- 9. Established correspondence cannot be closed by expiry of an old
--    root. CORRECTED from an earlier draft that tried to UPDATE
--    expires_at directly — that cannot work, since this same migration
--    installs enforce_letter_immutability, which explicitly freezes
--    expires_at (a BEFORE UPDATE trigger). Do not weaken or disable
--    immutability to make this test pass.
--
--    Instead, create the fixture via a direct INSERT (never an UPDATE)
--    — the trigger only fires on UPDATE, so setting expires_at already-
--    in-the-past as a row's INITIAL value at creation time never
--    touches it at all. Run as a privileged role in the SQL editor
--    (bypasses RLS/grants by design — this is seeding initial state,
--    not mutating an existing row). This fixture is also the crossed-
--    root scenario itself: an already-established correspondence
--    containing one surviving root, still status='sent', already past
--    its own individual expiry.
--
--    PRECONDITION, explicit: the direct INSERT below will itself
--    violate correspondences_one_active_per_pair if the chosen pair
--    already has an active correspondence (e.g., reusing A/B from
--    scenarios 4-8 above without cleanup). Use genuinely fresh
--    disposable profiles X, Y here, distinct from any pair used in
--    earlier scenarios, or explicitly clean up (delete) an earlier
--    test correspondence for the same pair first.
--
-- insert into public.correspondences (participant_low, participant_high, status, established_at)
-- values (least('<X-uuid>','<Y-uuid>'), greatest('<X-uuid>','<Y-uuid>'), 'active', now())
-- returning id;
-- -- capture as <fixture-correspondence-id>
--
-- insert into public.letters (sender_id, recipient_id, correspondence_id, body, deliver_at, expires_at, status)
-- values ('<Y-uuid>', '<X-uuid>', '<fixture-correspondence-id>',
--         'fixture: surviving crossed root, already past its own expiry',
--         now() - interval '2 hours', now() - interval '1 hour', 'sent');
--
-- select expire_stale_first_contacts();
--
-- select status, established_at from public.correspondences where id = '<fixture-correspondence-id>';
-- Expect: status = 'active' (untouched — established_at is not null, so the guard prevents closure
-- even though a root just expired).
--
-- select status, closed_by from public.letters
-- where correspondence_id = '<fixture-correspondence-id>' and sender_id = '<Y-uuid>';
-- Expect: status = 'closed', closed_by = 'system' — the LETTER itself still correctly expires;
-- only the CORRESPONDENCE-level closure is suppressed.
--
-- -- Cleanup (cascades to the fixture letter via correspondence_id's ON DELETE CASCADE):
-- delete from public.correspondences where id = '<fixture-correspondence-id>';

-- Immutability check — confirm deliver_at is now frozen.
-- update public.letters set deliver_at = now() where id = '<any-letter-id>';
-- Expect: exception "Letters are immutable except for their lifecycle status fields."
