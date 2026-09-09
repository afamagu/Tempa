-- Tempa — Mail Call / Delayed Delivery: CORRECTION — first contact is
-- immediate, Mail Call begins at Letter 2.
-- PREPARED 2026-09-04. NOT EXECUTED.
--
-- Product decision, made immediately after the Mail Call atomic
-- deployment: Letter 1 (send_first_letter) always delivers immediately
-- — a member gets the reward of a new connection before Tempa's slow-
-- correspondence rhythm begins. Letter 2 (reply_to_letter) and every
-- letter after (write_letter) still get the full Mail Call delay,
-- unchanged.
--
-- Redefines ONLY public.send_first_letter. Does NOT touch
-- compute_deliver_at, reply_to_letter, write_letter,
-- letters_for_participant, search_letterbox, can_view_letter_photo,
-- mark_letter_opened, close_letter, expire_stale_first_contacts,
-- letters_select_participant, any grant/revoke, any RLS policy, the
-- deliver_at immutability trigger, or any application code. The
-- recipient visibility boundary (deliver_at <= now()) is untouched —
-- first-contact letters simply satisfy it immediately now, by
-- construction, because their own deliver_at IS now().
--
-- Exactly one line changes from the currently-live canonical
-- send_first_letter (the version in
-- 2026-09-04-mail-call-atomic-deployment.sql):
--
--   v_deliver_at := public.compute_deliver_at(auth.uid(), p_recipient_id, v_new_id);
--
-- becomes:
--
--   v_deliver_at := now();
--
-- v_expires_at := v_deliver_at + interval '72 hours' is unchanged —
-- the recipient still gets the full 72-hour first-contact decision
-- window, now counted from an immediate delivery instead of a delayed
-- one. v_new_id is still generated via pg_catalog.gen_random_uuid() —
-- it's still needed as the letter's own primary key, even though it's
-- no longer also used as a compute_deliver_at jitter seed.
--
-- now() is transaction-stable in Postgres (the same value everywhere
-- it's evaluated within one transaction) — since created_at resolves
-- via the table's own now()-based default in this SAME INSERT
-- statement's transaction, v_deliver_at ends up not merely "close to"
-- but EXACTLY equal to created_at, to the same microsecond. See
-- verification query 1.
--
-- Reverse-direction reuse (S3) is unaffected structurally: there is no
-- branch between S1 and S3 at the point v_deliver_at is computed — both
-- paths reach the same INSERT with the same now()-derived value, so a
-- crossed first contact is immediate in EITHER direction, exactly as
-- required ("a crossed reverse-direction first contact is also a
-- Letter 1 from that sender -> immediate").
--
-- Same-direction clamp interaction, checked: reply_to_letter's clamp
-- looks for a previous letter in the REPLIER's own direction (replier
-- -> original sender) — Letter 1 was sent in the opposite direction, so
-- there is never a "previous" row for Letter 2's clamp to find; it's
-- unaffected by Letter 1 having an immediate deliver_at. If a sender
-- later sends ANOTHER letter in the same direction as their original
-- Letter 1 (e.g. via write_letter), Letter 1's now-very-early deliver_at
-- could theoretically be found as "previous" — but since every later
-- letter's own natural compute_deliver_at result is already computed
-- from a send time strictly after Letter 1's created_at, plus at least
-- the same-region band's ~2h45m floor, it always already exceeds
-- "Letter 1's deliver_at + 1 minute" on its own — the clamp is a no-op
-- in this case, not a bug.

begin;

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

  -- CORRECTION: first contact is immediate. Mail Call begins at
  -- Letter 2 (reply_to_letter) — this is the only change from the
  -- previously-live version, which called
  -- public.compute_deliver_at(auth.uid(), p_recipient_id, v_new_id)
  -- here instead. now() is transaction-stable, so v_deliver_at ends up
  -- exactly equal to created_at's own now()-derived default value.
  v_deliver_at := now();
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


commit;


-- ============================================================
-- TRANSITION-WINDOW DIAGNOSTIC — run this FIRST, before deciding
-- whether any corrective data treatment is needed. Read-only, count
-- only, no letter bodies exposed. I cannot run this myself — no
-- service-role key/CLI in this environment.
-- ============================================================

-- How many root letters were created under the OLD (compute_deliver_at-
-- based) send_first_letter — i.e., between the atomic deployment going
-- live and this correction landing. The 1-minute buffer excludes
-- ordinary clock/transaction noise, so this only counts genuine
-- compute_deliver_at-derived delays.
select count(*) as transition_window_first_contacts
from public.letters
where reply_to_id is null
  and deliver_at > created_at + interval '1 minute';

-- Split by whether they've already delivered (nothing to reconsider)
-- vs are still pending (the population a corrective decision would
-- actually affect).
select
  count(*) filter (where deliver_at <= now()) as already_delivered,
  count(*) filter (where deliver_at > now()) as still_pending
from public.letters
where reply_to_id is null
  and deliver_at > created_at + interval '1 minute';


-- ============================================================
-- VERIFY (optional — NOT read-only for scenarios 4/5/6: they call the
-- writer RPCs and create real rows via the established auth-
-- impersonation pattern. Run only after this correction has been
-- executed. I cannot run any of this myself — every placeholder needs a
-- real id substituted in.
-- ============================================================

-- select set_config('request.jwt.claims', json_build_object('sub','<A-uuid>','role','authenticated')::text, true);
-- set local role authenticated;

-- 1. New first contact: deliver_at EXACTLY equal to created_at (not
--    merely close), and expires_at - deliver_at = exactly 72 hours.
-- select id as a_to_b_id, created_at, deliver_at, expires_at,
--   deliver_at = created_at as deliver_at_exactly_equals_created_at,
--   (expires_at - deliver_at) = interval '72 hours' as expiry_exactly_72h_after_delivery
-- from send_first_letter('<B-uuid>', '<answer-of-B>', 'immediate first contact test');

-- 2. First contact immediately visible to its recipient — no waiting,
--    no separate delivery event.
-- select set_config('request.jwt.claims', json_build_object('sub','<B-uuid>','role','authenticated')::text, true);
-- set local role authenticated;
-- select * from public.letters_for_participant where id = '<a_to_b_id captured in scenario 1>';
-- Expect: one row, immediately — not zero rows waiting on a future deliver_at.

-- 3. Replying to that first contact (Letter 2) still creates a FUTURE
--    deliver_at — Mail Call begins here, unaffected by Letter 1 being
--    immediate.
-- select id as letter_2_id, created_at, deliver_at,
--   deliver_at > created_at + interval '1 minute' as delayed_as_expected
-- from reply_to_letter('<a_to_b_id captured in scenario 1>', 'Letter 2, should be delayed');
-- Expect: delayed_as_expected = true.

-- 4. A later write_letter (Letter 3+) still creates a future
--    deliver_at.
-- select id as letter_3_id, created_at, deliver_at,
--   deliver_at > created_at + interval '1 minute' as delayed_as_expected
-- from write_letter('<correspondence-id>', 'Letter 3, should also be delayed');
-- Expect: delayed_as_expected = true.

-- 5. Crossed first contacts are BOTH immediate, independently — no
--    dependency on send order or on each other.
-- select id, deliver_at, deliver_at = created_at as immediate
--   from send_first_letter('<B-uuid>', '<answer-of-B>', 'A to B crossed');  -- (as A)
-- select id, deliver_at, deliver_at = created_at as immediate
--   from send_first_letter('<A-uuid>', '<answer-of-A>', 'B to A crossed');  -- (as B)
-- Expect: both rows show immediate = true.

-- 6. No visibility/security predicate was weakened — this migration
--    never touched letters_for_participant, search_letterbox,
--    can_view_letter_photo, mark_letter_opened, close_letter,
--    expire_stale_first_contacts, letters_select_participant, or any
--    grant. Confirms that directly rather than assuming it.
select pg_get_viewdef('public.letters_for_participant'::regclass, true) as view_definition;
-- Expect: unchanged — still (auth.uid() = sender_id) OR ((auth.uid() = recipient_id) AND (deliver_at <= now())).

select
  polname,
  pg_get_expr(polqual, polrelid) as using_expression
from pg_policy
where polrelid = 'public.letters'::regclass
  and polname = 'letters_select_participant';
-- Expect: unchanged, same predicate shape as above.

select proname, prosecdef, proconfig
from pg_proc
where proname = 'send_first_letter';
-- Expect: prosecdef = true, proconfig containing search_path=pg_catalog — unchanged from before this correction.
