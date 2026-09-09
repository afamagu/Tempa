-- Tempa — Mail Call: Moments unlock only after Letter 2 has actually
-- DELIVERED, for BOTH participants.
-- PREPARED 2026-09-04. NOT EXECUTED — review, then run in the Supabase
-- SQL editor.
--
-- Product rule: Letter 1 and Letter 2 stay text-only. Letter 3 onward
-- may carry Moments — but only once Letter 2 (the letter that
-- establishes the correspondence) has itself reached deliver_at <=
-- now(), for BOTH the Letter-2 sender and the Letter-1 sender alike.
-- This is DISTINCT from Write Anytime entitlement
-- (isEstablishedForViewer, 2026-09-04-mail-call-first-contact-immediate
-- and earlier): the Letter-2 sender may already be writing Letter 3,
-- 4, 5... back-to-back while Letter 2 is still travelling — those
-- letters just stay text-only until Letter 2 itself arrives.
--
-- Why letters_for_participant cannot answer this: that view never
-- selects deliver_at at all (see docs/sql/2026-09-04-mail-call-
-- enforcement.sql's view definition) — by design, since exposing raw
-- deliver_at to the client is unnecessary anywhere the app currently
-- reads that view and would be one more thing to keep leak-free.
-- Reproducing "deliver_at <= now()" in TypeScript against a client-
-- supplied clock is exactly the kind of security-relevant duplication
-- the checkpoint asked to avoid, so this is a new, narrow, read-only
-- RPC instead — the smallest thing that can answer it, computed
-- entirely from now() on the database's own clock.
--
-- One BEGIN/COMMIT: write_letter's new body calls
-- moments_qualified_for_viewer, so both objects must land together —
-- matches the same all-or-nothing convention as every prior Mail Call
-- migration in this directory.

begin;

-- ============================================================
-- MOMENTS_QUALIFIED_FOR_VIEWER
-- ============================================================
--
-- IDENTIFYING "LETTER 2" DETERMINISTICALLY — not via MIN(created_at).
--
-- Traced from the exact live reply_to_letter body (docs/sql/2026-09-
-- 04-mail-call-atomic-deployment.sql): established_at is written in
-- EXACTLY ONE place in the entire schema —
--
--   update public.correspondences
--   set status = 'active', established_at = coalesce(established_at, now())
--   where id = original.correspondence_id;
--
-- — inside the `if is_first_reply then ... end if;` block, where
-- is_first_reply := original.reply_to_id is null (the letter being
-- replied to is a root). Two facts make created_at = established_at a
-- PROVEN, not assumed, identity for the reply that actually set it:
--
--   1. now() is transaction-stable in Postgres — the same value
--      everywhere it's evaluated within one call (already the exact
--      proof basis for deliver_at = created_at in
--      2026-09-04-mail-call-first-contact-immediate.sql, citing this
--      same letters.created_at default now() column).
--   2. The INSERT that creates the new reply letter (this same
--      function invocation, same transaction) never sets created_at
--      explicitly — it uses the column's own `default now()`
--      (docs/sql/2026-08-30-letters.sql). So for the SPECIFIC call
--      where is_first_reply is true AND established_at was NULL
--      beforehand, established_at and the new row's created_at are
--      set from the IDENTICAL now() — exactly equal, not merely close.
--
-- Why this rules out the crossed-root false-positive: a correspondence
-- can carry a SECOND reply-type row (the reverse-direction case: both
-- people sent an original first-contact letter to each other before
-- either replied, and the correspondence's OTHER, still-unreplied root
-- can still legitimately be replied to via reply_to_letter even after
-- establishment through the first root — resolveLetterActionState's
-- showFirstContactResponse stays reachable for that surviving root
-- until establishedForViewer flips true for that specific viewer).
-- That second reply ALSO has is_first_reply = true (its own target was
-- also a root) — so the `if is_first_reply` block runs again — but
-- coalesce(established_at, now()) now returns the EXISTING (already
-- non-null) established_at, not a fresh now(). established_at never
-- moves. The second reply's own created_at is from a later, separate
-- transaction/call — strictly later in wall-clock time — so it can
-- never equal the frozen established_at. No matter how early that
-- second reply's own deliver_at turns out to be, it can never satisfy
-- created_at = established_at, so it can never be mistaken for the
-- letter that actually established the correspondence.
--
-- Returns true only when:
--   1. auth.uid() is not null, AND
--   2. the caller is actually a participant in this correspondence
--      (public.is_correspondence_participant, already live since
--      2026-08-31-moments.sql, reused rather than re-implemented), AND
--   3. the ONE letter whose created_at equals this correspondence's
--      own established_at — i.e. the letter that actually set it —
--      has deliver_at <= now().
--
-- Structured as an explicit CASE, not a plain boolean AND: SQL does
-- not guarantee AND operand evaluation order, so `exists(...) and
-- is_correspondence_participant(...)` does not itself guarantee the
-- participant check runs first. CASE WHEN branches are evaluated in
-- order and short-circuit — a non-participant (or unauthenticated)
-- caller returns false from the second WHEN branch, without the ELSE
-- branch's correspondence-letter lookup ever running.
--
-- Reads public.letters/public.correspondences directly (not the view)
-- because the view doesn't expose deliver_at — this function is itself
-- the security boundary for that read, and never returns anything but
-- the derived boolean, so bypassing letters_for_participant here
-- exposes nothing letters_for_participant itself protects (no body,
-- no metadata, no row data of any kind reaches the caller).
create or replace function public.moments_qualified_for_viewer(
  p_correspondence_id uuid
)
returns boolean
language sql
security definer
set search_path to 'pg_catalog'
stable
as $function$
  select
    case
      when auth.uid() is null then false
      when not public.is_correspondence_participant(p_correspondence_id) then false
      else exists (
        select 1
        from public.letters l
        where l.correspondence_id = p_correspondence_id
          and l.created_at = (
            select c.established_at
            from public.correspondences c
            where c.id = p_correspondence_id
          )
          and l.deliver_at <= now()
      )
    end;
$function$;

revoke all
on function public.moments_qualified_for_viewer(uuid)
from public;

grant execute
on function public.moments_qualified_for_viewer(uuid)
to authenticated;


-- ============================================================
-- WRITE_LETTER — one added guard, otherwise byte-for-byte identical to
-- the currently-live canonical body
-- (docs/sql/2026-09-04-mail-call-atomic-deployment.sql).
-- ============================================================
--
-- Today write_letter accepts p_moments the instant established_at is
-- non-null — meaning a Letter-2 sender who immediately starts Letter 3
-- could currently attach a Moment to it before Letter 2 has actually
-- delivered to the other party, even though the product rule requires
-- Moments to wait for that delivery for BOTH participants. The single
-- change below closes that gap by reusing
-- moments_qualified_for_viewer — never duplicating its logic — and
-- only when moment_count > 0, so a plain text-only letter (still fully
-- allowed at any time once established) is completely unaffected.
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

  -- NEW: Moments unlock only once Letter 2 has actually delivered, for
  -- BOTH participants — established_at being non-null (checked above)
  -- is necessary but not sufficient. A plain text-only letter
  -- (moment_count = 0) is completely unaffected and can still be sent
  -- the instant this correspondence is established, same as today.
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

commit;


-- ============================================================
-- VERIFY (optional — NOT read-only; calls the real RPCs and creates
-- real rows via the established auth-impersonation pattern. Run only
-- after this migration has been executed. I cannot run any of this
-- myself — every placeholder needs a real id substituted in.
-- ============================================================

-- select set_config('request.jwt.claims', json_build_object('sub','<A-uuid>','role','authenticated')::text, true);
-- set local role authenticated;

-- 1. Letter 1 only (no reply yet): moments_qualified_for_viewer is
--    false for both — no established_at at all yet.
-- select moments_qualified_for_viewer('<correspondence-id>');
-- Expect: false.

-- 2. Letter 2 sent (delayed), still in transit: false for BOTH the
--    Letter-2 sender and the Letter-1 sender.
-- select moments_qualified_for_viewer('<correspondence-id>');
-- Expect: false for both auth.uid() values.

-- 3. Attempting write_letter with a photo Moment while still in
--    transit correctly fails.
-- select write_letter('<correspondence-id>', 'Letter 3 attempt', null,
--   '[{"type":"photo","position":0,"image_path":"x"}]'::jsonb);
-- Expect: exception "Moments are not available in this correspondence yet."

-- 4. The SAME send, but with p_moments omitted entirely (moment_count
--    = 0), succeeds normally — the new guard never blocks a plain
--    text-only Letter 3+ while Letter 2 is in transit.
-- select id, deliver_at from write_letter('<correspondence-id>', 'Letter 3, text only');
-- Expect: succeeds.

-- 5. Once Letter 2's deliver_at <= now(): moments_qualified_for_viewer
--    is true for BOTH participants, and a Moment attaches successfully.
-- select moments_qualified_for_viewer('<correspondence-id>');
-- select id from write_letter('<correspondence-id>', 'Letter with a photo', null,
--   '[{"type":"photo","position":0,"image_path":"x"}]'::jsonb);
-- Expect: both succeed.

-- 6. A non-participant gets false, never an error (fails closed, not
--    loud) — mirrors is_correspondence_participant's own behavior.
-- select set_config('request.jwt.claims', json_build_object('sub','<some-other-uuid>','role','authenticated')::text, true);
-- set local role authenticated;
-- select moments_qualified_for_viewer('<correspondence-id>');
-- Expect: false.

-- 7. Crossed-root case: A sends root1 A->B, B sends root2 B->A (both
--    immediate), B replies to root1 (this is the genuine "Letter 2",
--    deliver_at in the future), then A replies to root2 BEFORE B's
--    reply has delivered (reachable today: establishedForViewer for A
--    is still false at this point, so showFirstContactResponse still
--    renders root2's Reply UI for A). If A's reply to root2 happens to
--    have an EARLIER deliver_at than B's reply to root1, qualification
--    must still be false until B's reply (the actual first reply)
--    itself arrives — never flipped early by the second, incidental
--    reply.
-- select id as root1_id from send_first_letter('<B-uuid>', '<answer-of-B>', 'root1'); -- as A
-- select id as root2_id from send_first_letter('<A-uuid>', '<answer-of-A>', 'root2'); -- as B
-- select id as reply1_id, deliver_at as reply1_deliver_at from reply_to_letter('<root1_id>', 'Letter 2, the real one'); -- as B
-- select id as reply2_id, deliver_at as reply2_deliver_at from reply_to_letter('<root2_id>', 'A replies to the crossed root too'); -- as A, while establishedForViewer(A) is still false
-- select moments_qualified_for_viewer('<correspondence-id>'); -- as either A or B
-- Expect: false, until reply1_deliver_at (B's reply to root1, the
-- genuine Letter 2) is itself <= now() — regardless of whether
-- reply2_deliver_at has already passed.

-- 8. Confirms reply_to_letter (Letter 2 itself) is untouched by this
--    migration — it still has no p_moments parameter at all.
select pg_get_function_arguments('public.reply_to_letter'::regproc);
-- Expect: unchanged, no p_moments.

select proname, prosecdef, proconfig
from pg_proc
where proname in ('moments_qualified_for_viewer', 'write_letter');
-- Expect: both prosecdef = true, both proconfig containing search_path=pg_catalog.

-- 9. Direct proof of the created_at = established_at identity on real
--    data — exactly one letter per established correspondence should
--    match, and it should be that correspondence's actual first reply
--    (reply_to_id is not null).
-- select c.id as correspondence_id, c.established_at, l.id as letter_id, l.reply_to_id, l.created_at
-- from public.correspondences c
-- join public.letters l on l.correspondence_id = c.id and l.created_at = c.established_at
-- where c.id = '<correspondence-id>';
-- Expect: exactly one row; that row's reply_to_id is not null.

-- 10. Confirms the CASE structure landed as written (participant check
--     strictly precedes the correspondence-letter lookup), not just
--     asserted from this file.
select pg_get_functiondef('public.moments_qualified_for_viewer'::regproc);
-- Expect: literal "case when auth.uid() is null then false when not
-- public.is_correspondence_participant(...) then false else exists (...) end".
