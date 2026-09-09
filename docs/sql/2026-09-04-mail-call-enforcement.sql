-- Tempa — Mail Call / Delayed Delivery, Migration 5 of N: recipient
-- visibility enforcement.
-- PREPARED 2026-09-04. NOT EXECUTED.
--
-- ============================================================
-- DO NOT RUN THIS FILE ON ITS OWN
-- ============================================================
--
-- Fixed deployment decision (approved): writer integration
-- (2026-09-04-mail-call-writer-integration.sql) and this enforcement
-- migration will be executed together, in ONE BEGIN...COMMIT, so there
-- is never a state where a letter carries a real future deliver_at
-- without that value being enforced. Neither file is ever run alone.
--
-- CRITICAL COMBINATION DETAIL, easy to get wrong: do NOT paste this
-- file's own BEGIN...COMMIT directly after the writer-integration
-- file's own BEGIN...COMMIT. Postgres does not nest transactions — a
-- second top-level BEGIN while already inside one just emits a warning
-- and is a no-op, and the FIRST file's matching COMMIT would then
-- commit that file's changes early, before this file's statements ever
-- run — silently breaking the exact atomicity guarantee this whole
-- deployment shape exists for. The correct procedure: take the
-- statements BETWEEN writer-integration's BEGIN/COMMIT, take the
-- statements BETWEEN this file's BEGIN/COMMIT, concatenate ONLY those
-- inner statements, and wrap the combined result in exactly ONE
-- BEGIN...COMMIT pair. See report §6 for the full proposed order.
--
-- Two functions below (reply_to_letter, close_letter) are COMPLETE,
-- FINAL bodies — they already include everything from the writer-
-- integration migration (the same-direction clamp, the correspondence
-- lock, the conditional correspondence closure) PLUS this migration's
-- new deliver_at guard, not just a delta on top. This is deliberate:
-- since these two files are only ever combined, presenting a complete
-- final body here avoids any ambiguity about which version "wins" —
-- CREATE OR REPLACE is safe to apply twice in one transaction (the
-- writer-integration file's own definitions of these two functions
-- become harmless, immediately-superseded intermediate steps when both
-- files run in sequence within the same transaction).
--
-- ============================================================
-- SEARCH-PATH HARDENING PASS
-- ============================================================
--
-- can_view_letter_photo, mark_letter_opened, reply_to_letter, and
-- close_letter now all use `set search_path to 'pg_catalog'`
-- (previously 'public'), matching search_letterbox's and
-- compute_deliver_at's existing convention. Audited every unqualified
-- reference in each body: public.moments/public.letters/
-- public.correspondences/public.letters_for_participant and auth.uid()
-- were already explicitly schema-qualified everywhere in all four —
-- the only genuine gap was gen_random_uuid() in reply_to_letter, now
-- qualified as pg_catalog.gen_random_uuid() explicitly (see checkpoint
-- report for the recommended pre-flight verification query). No logic
-- changed in this pass, in any of the four functions — only the
-- search_path declaration and the one UUID-generation call site.
--
-- ============================================================
-- SCOPE
-- ============================================================
--
-- Changes: letters_for_participant (view), search_letterbox,
-- can_view_letter_photo, mark_letter_opened, reply_to_letter (complete,
-- superseding body), close_letter (complete, superseding body),
-- letters_select_participant (RLS policy, defense-in-depth hardening).
-- Does NOT change: send_first_letter, write_letter,
-- expire_stale_first_contacts, photo consent logic, Moments validation,
-- reply_to_id/established_at meaning, hidden-correspondence behavior,
-- any application/TypeScript/UI code.
--
-- ============================================================
-- ENFORCEMENT SURFACES — see checkpoint report for the full trace
-- ============================================================
--
-- Fixed here: letters_for_participant, search_letterbox (both CTEs),
-- can_view_letter_photo, mark_letter_opened, reply_to_letter,
-- close_letter, letters_select_participant.
--
-- NEW findings from tracing reply_to_letter/close_letter specifically
-- (not previously scoped as enforcement points): both operate on the
-- base letters table directly, bypassing letters_for_participant
-- entirely — a direct RPC call with a guessed/known undelivered
-- letter id could previously reply to, or decline, content the caller
-- was never shown. Both now require deliver_at <= now() before
-- considering the target letter, closing this gap.
--
-- Confirmed NOT needing a change: expire_stale_first_contacts — safe
-- by construction, since expires_at = deliver_at + 72h always (writer-
-- integration migration), so deliver_at > now() implies expires_at >
-- now() too; this function's own expires_at <= now() filter can never
-- match an undelivered letter, mathematically, not merely by
-- convention — no redundant check added for a scenario that cannot
-- occur. send_first_letter / write_letter — neither reads or returns
-- another party's letter content in a way distinguishable by delivery
-- status. moments_select_participant (RLS on public.moments) and
-- getMomentsForLetters (TypeScript) both inherit the fix for free,
-- since both ultimately depend on letters_for_participant or on ids
-- already resolved through it.
--
-- Deliberately NOT exposing deliver_at on letters_for_participant's
-- SELECT list in this migration — that's a UI-affordance concern (a
-- sender-side "In transit" indicator), not a security requirement, and
-- is left for the later, explicitly-deferred application checkpoint.
--
-- ============================================================
-- CROSSED-ROOT SCENARIO — traced, not newly fixed here
-- ============================================================
--
-- See checkpoint report §2 for the full trace. Once either root
-- establishes a correspondence, the surviving root in the other
-- direction remains fully deliverable/readable on its own schedule
-- (visibility/unread are correspondence-agnostic, unaffected by any
-- change in this file) — and its old first-contact Close/accept UI is
-- already correctly suppressed by the existing, already-live
-- `!established` guard in resolveLetterActionState (lib/letters.ts,
-- built earlier this session for an unrelated race-condition fix, and
-- confirmed by tracing to generalize correctly to this scenario too).
-- No code change was needed for this, in this file or the writer-
-- integration one — it was verified, not assumed.
--
-- ============================================================
-- FIRST-CONTACT EXPIRY / DELAYED DELIVERY INTERACTION
-- ============================================================
--
-- Already resolved by the writer-integration migration
-- (expires_at = deliver_at + 72h at send time). This migration's new
-- deliver_at <= now() guard on reply_to_letter/close_letter means
-- neither function can even consider a letter before it's delivered —
-- so by the time expires_at > now() is evaluated, deliver_at has
-- necessarily already passed. The 72-hour decision window begins at
-- actual delivery with no further arithmetic required anywhere.
--
-- ============================================================
-- NECESSARY LATER UI/TYPESCRIPT CHANGES — identified, not made here
-- ============================================================
--
-- 1. getActiveCorrespondencePartnerIds (lib/letters.ts) — used by both
--    Discovery/Minds pool exclusion and the public profile page's
--    "Write to this mind" vs "Open your correspondence" button swap.
--    Currently queries correspondences directly (symmetric, not
--    delivery-aware) — a pre-existing gap, not newly introduced here,
--    but not closed by this SQL-only migration either. Needs a
--    direction-aware rework: exclude unconditionally when the viewer is
--    sender, only after ≥1 delivered letter when the viewer is
--    recipient.
-- 2. app/minds/[userId]/page.tsx inherits the fix automatically once #1
--    is fixed — no separate change needed there beyond #1.
-- 3. getLetterboxPeople's candidate-correspondence derivation — NOT
--    required for correctness (re-verified this checkpoint: already
--    safe under the fixed view, for both a brand-new undelivered
--    correspondence and a known correspondent's new in-transit
--    letter), but an explicit deliverableIds intersection is still
--    recommended for auditability rather than relying on an implicit
--    property of buildLetterboxPeople's activity-map gate.
-- 4. Exposing deliver_at on the Letter type/LETTER_COLUMNS and a
--    sender-side "In transit" affordance on the archive card/reader —
--    cosmetic, not a security requirement, deferred.
--
-- None of these four are addressed in this file, per this checkpoint's
-- explicit scope (SQL-only, no TypeScript/UI changes).

begin;

-- ============================================================
-- LETTERS_FOR_PARTICIPANT — the core enforcement point
-- ============================================================
--
-- Sender branch unconditional (unchanged) — a sender always sees their
-- own outgoing letter immediately, including while in transit. Recipient
-- branch now additionally requires deliver_at <= now() — this is a
-- ROW-LEVEL exclusion: an undelivered letter is simply absent from the
-- result set for its recipient, not present-with-masked-fields. This is
-- what every downstream read path (getMyLetters, getLetterById,
-- getLettersForCorrespondence, getFirstContact, getReplyTo,
-- getWaitingLetterCount, getLetterArchiveWithUser,
-- getFirstLockedPhotoLetterMoment, moments_select_participant,
-- getMomentsForLetters) inherits automatically, with zero further
-- changes, since all of them already read exclusively through this
-- view or through data derived from it.

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
-- raw body directly), so it must independently reproduce both halves
-- of the same rule: the people branch must not surface an undelivered
-- first-contact sender's pseudonym at all, and the letters branch must
-- not surface an undelivered letter's excerpt.
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
    -- Mail Call addition: a person is only a candidate if the viewer
    -- has at least one row visible to them in the (now delivery-fixed)
    -- letters_for_participant view for that correspondence — reusing
    -- the view's own predicate rather than re-deriving it a third time,
    -- so this stays in lockstep with the view automatically.
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
    -- Mail Call addition: the recipient branch now also requires
    -- deliver_at <= now() — the sender branch stays unconditional.
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
-- policy; bypasses the view, must independently enforce delivery.
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
-- MARK_LETTER_OPENED — bypasses the view, must independently enforce
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
-- REPLY_TO_LETTER — complete, final body (writer-integration logic +
-- new deliver_at guard). See file header for why this is a full
-- redefinition, not a delta.
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
-- CLOSE_LETTER — complete, final body (writer-integration logic + new
-- deliver_at guard). See file header for why this is a full
-- redefinition, not a delta.
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
-- LETTERS_SELECT_PARTICIPANT — base-table RLS policy, defense-in-depth
-- hardening only. Currently unreachable (authenticated has zero grant
-- on public.letters), so this changes no live behavior today — but if
-- a future migration ever accidentally grants direct table access,
-- this ensures the policy is already correct rather than compounding a
-- new leak on top of an old oversight. Matches this codebase's existing
-- convention of stating privilege boundaries explicitly rather than
-- relying on "it's unreachable anyway."
-- ============================================================

drop policy if exists letters_select_participant on public.letters;

create policy letters_select_participant
  on public.letters
  for select
  using (
    auth.uid() = sender_id
    or (auth.uid() = recipient_id and deliver_at <= now())
  );


commit;


-- ============================================================
-- VERIFY (optional — NOT read-only, exercises RPCs/views against real
-- data via the established auth-impersonation pattern. Run only after
-- the COMBINED migration has executed. I cannot run any of this myself
-- — no service-role key/CLI in this environment.
-- ============================================================

-- 0. Find real candidate profiles.
select id, country, region, country_code from public.profiles order by country_code nulls last;

-- ------------------------------------------------------------
-- Auth impersonation pattern, as established this session.
-- ------------------------------------------------------------
-- select set_config('request.jwt.claims', json_build_object('sub','<A-uuid>','role','authenticated')::text, true);
-- set local role authenticated;

-- 1. Sender sees own in-transit letter immediately. Captures the new
--    letter's own id directly from the RPC's return value, rather than
--    re-deriving it via a sender/recipient query that could match more
--    than the one row of interest if this pair has prior history.
-- select id as a_to_b_letter_id, deliver_at from send_first_letter('<B-uuid>', '<answer-of-B>', 'A to B, in transit');
-- select id, deliver_at from public.letters_for_participant where id = '<a_to_b_letter_id captured above>';
-- Expect: one row returned, deliver_at in the future — visible to A despite being undelivered.

-- 2. Recipient cannot see it via the view before delivery. CORRECTED:
--    the original version of this query filtered by sender_id/
--    recipient_id, expecting zero rows — wrong whenever A and B have
--    any prior delivered correspondence, since THOSE rows would still
--    correctly be visible to B and the assertion would wrongly read as
--    a failure. Scoped to the exact new letter's id instead, captured
--    from test 1, which is correct regardless of any prior history
--    between this pair.
-- select set_config('request.jwt.claims', json_build_object('sub','<B-uuid>','role','authenticated')::text, true);
-- set local role authenticated;
-- select * from public.letters_for_participant where id = '<a_to_b_letter_id captured in test 1>';
-- Expect: zero rows.

-- 3. Recipient cannot find it via search before delivery. CORRECTED:
--    the original version searched by A's pseudonym expecting "no row
--    naming A" — wrong if A and B have prior established correspondence,
--    since A's person-card would then correctly still appear in search
--    (that's legitimate, unrelated to this specific undelivered letter).
--    Search instead by a distinctive substring unique to THIS test
--    letter's body, and confirm no LETTER-kind result matches it — this
--    is correct regardless of whether A and B have any other history,
--    since it targets the one thing that must never surface: this
--    specific undelivered letter's own content.
-- select send_first_letter('<B-uuid>', '<answer-of-B>', 'zzz-mailcall-test-marker-a-to-b zzz, undelivered');
-- (as B) select * from search_letterbox('zzz-mailcall-test-marker-a-to-b');
-- Expect: no letter-kind row with this excerpt/marker. (A's person-card MAY legitimately
-- appear here if this pair has independent prior established correspondence — that is not a failure.)

-- 4. Recipient cannot mark it opened, reply to it, or close it before delivery.
-- select mark_letter_opened('<A-to-B-letter-id>');
-- select id, opened_at from public.letters where id = '<A-to-B-letter-id>';
-- Expect: opened_at still null — the UPDATE silently affected zero rows (mark_letter_opened returns void).
-- select reply_to_letter('<A-to-B-letter-id>', 'replying before I could have read it');
-- Expect: exception "Letter not found, not addressed to you, or no longer awaiting a reply."
-- select close_letter('<A-to-B-letter-id>', 'I can''t take on another correspondence right now.');
-- Expect: exception "Letter not found, not addressed to you, or no longer awaiting a decision."

-- 5. Recipient cannot obtain a photo via can_view_letter_photo before delivery
--    (requires a letter with a Photo Moment and enabled consent in an
--    established correspondence where a NEW letter is then sent with a
--    photo — construct via write_letter with p_moments, then check
--    before that new letter's own deliver_at):
-- select can_view_letter_photo('<image-path-of-an-undelivered-letters-photo>');
-- Expect: false.

-- 6. Once deliver_at passes (use a same-region test pair for the
--    shortest realistic wait, ~2h45m-3h15m, or backdate a FRESH insert's
--    deliver_at via the same privileged-INSERT technique as scenario 9
--    in the writer-integration file's own VERIFY section — never via
--    UPDATE, which immutability now blocks):
-- select * from public.letters_for_participant where id = '<now-delivered-letter-id>';
-- Expect: one row, fully visible to the recipient.
-- select is_unread from public.letters_for_participant where id = '<now-delivered-letter-id>';
-- Expect: true (until opened).
-- select mark_letter_opened('<now-delivered-letter-id>');
-- select opened_at from public.letters where id = '<now-delivered-letter-id>';
-- Expect: now populated.
-- select * from search_letterbox('<sender-pseudonym-substring>');
-- Expect: now finds it.

-- 7. Crossed-root scenario does not leak and does not close the
--    established correspondence — reuses the exact fixture from the
--    writer-integration file's corrected verification scenario 9 (see
--    that file — same INSERT-based fixture, not UPDATE-based). After
--    running that fixture and confirming the correspondence-closure
--    guard holds, additionally confirm here that the surviving root
--    itself is still governed by the same visibility rule as any other
--    letter (no special-casing, no leak, no early exposure):
-- select set_config('request.jwt.claims', json_build_object('sub','<X-uuid>','role','authenticated')::text, true);
-- set local role authenticated;
-- select * from public.letters_for_participant where correspondence_id = '<fixture-correspondence-id>';
-- Expect: exactly the rows X is entitled to under the same sender/delivered rule as everywhere else —
-- no special treatment because the correspondence happens to be established.

-- Metadata/grant confirmation for the two functions that changed
-- security-relevant WHERE clauses without changing their own grants —
-- confirm nothing about their privilege surface silently regressed.
select proname, prosecdef, proconfig
from pg_proc
where proname in ('search_letterbox', 'can_view_letter_photo', 'mark_letter_opened', 'reply_to_letter', 'close_letter');
-- Expect: prosecdef = true for all five, proconfig containing
-- search_path=pg_catalog for all five — search_letterbox already had
-- this; the other four were hardened from 'public' to 'pg_catalog' in
-- this same pass (see SEARCH-PATH HARDENING PASS in the header).
