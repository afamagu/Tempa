-- ============================================================
-- TEMPA — LETTER-LEVEL POSTCARDS V1
-- PREPARED 2026-09-14. FINAL PRE-MIGRATION ARCHITECTURE CORRECTION —
-- this REPLACED every earlier same-day draft in full.
-- STATUS: APPLIED LIVE AND VERIFIED. Post-migration verification
-- passed in full (postcard_catalog/postcard_versions/letter_postcards
-- live, both seeded catalog cards, immutable Version 1 rows,
-- one-current-version enforcement, required RLS/policies/grants, and
-- the Postcard-aware write_letter/reply_to_letter path); a real
-- production letter-level Postcard has been sent successfully. Do not
-- reapply this file, recreate its tables, or duplicate its functions —
-- see docs/sql/2026-09-21-postcard-admin-and-keepsakes.sql for the
-- additive follow-up migration built on top of this one.
--
-- REVISED 2026-09-14 (thumbnail + expanded-experience checkpoint):
-- comment-only cleanup — a previously-discussed landscape-master
-- conversion has been CANCELLED; every "upcoming landscape" reference is
-- removed and replaced with neutral future-version language (e.g. a
-- hypothetical "essaouira-v2.jpg"). Portrait (~9:16) remains the LOCKED
-- master orientation, unchanged from the original Living Postcards
-- checkpoints.
--
-- REVISED AGAIN 2026-09-14 (final surgical pre-execution audit) — a REAL
-- defect found and fixed, and one previously-claimed defect RETRACTED as
-- factually wrong. See §3 and §7 below for the full explanation. Every
-- other table, constraint, function body, policy, or seed VALUE from the
-- expanded-experience revision is unchanged.
-- ============================================================
--
-- LOCKED PRODUCT MODEL: NEW POSTCARDS ARE NOT MOMENTS. A Postcard is one
-- optional designed enclosure belonging to the ENTIRE letter (never a
-- paragraph-positioned node); a Moment stays a photograph belonging to a
-- specific paragraph. A new letter may carry text + zero/many Photo
-- Moments + zero/one Postcard, never more than one.
--
-- ADDITIVE / NON-DESTRUCTIVE to history. Historical `public.moments`
-- rows with type='postcard' are completely untouched — same table, same
-- columns, same CHECK constraints, same client rendering path.
-- moments_select_participant itself is NOT touched by this migration at
-- all (§3/§7 below) — it was already correct.
--
-- Incremental against the CURRENT LIVE database, which by this point has
-- docs/sql/2026-09-13-write-letter-reply-to-letter-ambiguous-m-fix.sql
-- already applied (the `elem`-aliased, disambiguated write_letter /
-- reply_to_letter).
--
-- ============================================================
-- WHAT CHANGED IN THIS FINAL PASS, AND WHY
-- ============================================================
--
-- 1. IMMUTABLE POSTCARD VERSIONING (new). The previous draft stored only
--    `postcard_key` on letter_postcards — a live pointer to whatever the
--    catalog's CURRENT artwork happens to be. The current portrait
--    Essaouira/Bangkok assets (approximately 9:16 — LOCKED master
--    orientation; a previously-discussed landscape conversion has been
--    CANCELLED and is not referenced anywhere in this file) remain the
--    production masters, and TEMPA will keep revising artwork over time
--    regardless — a historical sent Postcard must never silently change
--    artwork, motion, duration, or layout just because the catalog's
--    current version later changes. Introduced `public.postcard_versions`
--    — an immutable production version of a catalog card — and
--    letter_postcards now stores `postcard_version_id`, resolved to
--    whichever version is CURRENT at the moment of Send, frozen forever
--    after. See §1 below for the full model and the honest TS/DB asset-
--    resolution boundary this implies for now.
--
-- 2. SENDER SIGNATURE SNAPSHOT (new). `profiles.pseudonym` is mutable
--    (confirmed in the previous audit — no immutability trigger exists).
--    A sent Postcard is a historical correspondence artifact, distinct
--    from the ordinary letter header (which intentionally keeps
--    resolving a member's CURRENT pseudonym dynamically — see
--    resolveLetterDirection, lib/letters.ts, unchanged and unaffected by
--    this). letter_postcards now carries `sender_pseudonym_snapshot`,
--    populated once at Send from the sender's pseudonym at that exact
--    moment, never rewritten afterward. Recipient identity is NOT
--    snapshotted — V1's letter-level Postcard back renders no recipient
--    name/detail for a real send (resolveLetterPostcardDisplay never
--    overrides recipientLabel/recipientDetail; those stay whatever the
--    static catalog entry happens to carry, unrelated to any real
--    recipient) — flagged as a separate, pre-existing, NOT-fixed-here
--    cosmetic inconsistency in the checkpoint report, out of this SQL-
--    only pass's scope. No sender geography is snapshotted either — V1
--    renders no geographic data on the back at all (postmarkText is a
--    fixed property of the postcard ITSELF, e.g. "depicts Essaouira,"
--    never the sender's real-world location).
--
-- 3. MOMENTS DELIVERY-TIMING RLS GAP — CLAIM RETRACTED. Every earlier
--    draft of this migration (through the expanded-experience revision)
--    asserted that moments_select_participant checked only sender_id/
--    recipient_id against the base letters table, with no deliver_at
--    gate, and planned to "fix" it by replacing it with a policy that
--    queries `public.letters` directly. That description matched the
--    ORIGINAL 2026-08-31-moments.sql policy, but NOT the actual current
--    live one: docs/sql/2026-09-02-moments-select-policy-fix.sql (the
--    most recent, and therefore authoritative, definition — no migration
--    between then and now touches this policy) already rewrote it to
--    delegate through `public.letters_for_participant` instead of the
--    base table:
--
--      exists (
--        select 1
--        from public.letters_for_participant lp
--        where lp.id = moments.letter_id
--      )
--
--    That fix predates Mail Call by two days. When Mail Call later added
--    the `l.deliver_at <= now()` clause to letters_for_participant's own
--    WHERE clause (docs/sql/2026-09-04-mail-call-atomic-deployment.sql),
--    every reader of that VIEW — including this policy, which resolves
--    the view at query time, not at the policy's own creation time —
--    transitively inherited the delayed-delivery gate with ZERO changes
--    to the policy itself. The live moments_select_participant is
--    therefore ALREADY correct today: a recipient cannot read an
--    undelivered letter's Moment rows. This migration makes NO change to
--    moments_select_participant at all — see §6 below for the release-
--    blocking defect that would have been introduced by "fixing" it.
--
-- 4. BACK-MESSAGE INVARIANT STRENGTHENED. The previous table CHECK used
--    `char_length(back_message) >= 1`, which a whitespace-only string
--    technically satisfies. Now `char_length(trim(both from
--    back_message)) between 1 and 200` — whitespace-only content can
--    never satisfy the historical-record invariant at the DATABASE
--    level, not merely in the RPC's own pre-check (which still runs
--    first, for the friendly TEMPA error message). The RPC also now
--    stores the TRIMMED value, so the stored row and the constraint
--    agree by construction.
--
-- 5. CATALOG/VERSION VISIBILITY SEPARATED FROM SEND ELIGIBILITY. The
--    previous draft's postcard_catalog_select_active policy
--    (`using (is_active)`) would have made a deactivated card's own
--    metadata invisible to an ordinary authenticated reader — including
--    a RECIPIENT trying to read a HISTORICAL Postcard whose catalog
--    entry was later deactivated for new sends. Catalog and version
--    metadata carry no private material (title, country_code, asset
--    paths, is_active/is_current flags — never anything user-specific),
--    so both are now readable by any authenticated user unconditionally
--    (`using (true)`), while the SEND RPCs alone still enforce
--    `is_active = true` as their own independent business-logic gate —
--    exactly the separation asked for: visibility of history is never
--    the same question as eligibility for a NEW send.
--
-- 6. VERIFY SECTION HONESTY. The previous draft's "read-only" Section A
--    actually INSERTed and DELETEd fixture rows. Section A below is now
--    genuinely read-only (SELECT/information_schema/pg_catalog only).
--    Every fixture-mutating check moves into Section B, wrapped in its
--    own BEGIN...ROLLBACK so nothing it does ever persists, and Section
--    C (live RLS/RPC behavior via auth impersonation) stays clearly
--    marked manual/optional, exactly as before.
--
-- 7. RELEASE-BLOCKING DEFECT FOUND AND FIXED — a Postgres RLS USING
--    clause runs under the QUERYING ROLE's own table privileges, never
--    definer-like privileges (a plain view or a SECURITY DEFINER function
--    body are the only two things that get definer-like access — an RLS
--    policy is neither). `authenticated` holds ZERO grants on the base
--    `public.letters` table — deliberately revoked in
--    docs/sql/2026-08-30-letters.sql ("Ordinary authenticated clients
--    receive no direct SELECT grant on the base table"), and never
--    reinstated anywhere since. This is the EXACT same condition that
--    already caused a real, confirmed production incident once before
--    (docs/sql/2026-09-02-moments-select-policy-fix.sql: every read of
--    public.moments failed with "permission denied for table letters,"
--    42501, because its policy queried public.letters directly) — fixed
--    then by delegating through public.letters_for_participant, a plain
--    view, which DOES run with definer-like privileges against its own
--    underlying tables.
--
--    Every earlier draft of THIS migration reintroduced that exact same
--    bug twice: (a) the new letter_postcards_select_participant policy's
--    USING clause queried `public.letters l` directly — meaning
--    EVERY read of the brand-new letter_postcards table, by sender or
--    recipient alike, would have failed with 42501 ("permission denied
--    for table letters") the instant this migration was applied; (b) the
--    retracted moments_select_participant "fix" in item 3 above made the
--    exact same mistake, and would have taken WORKING Moments rendering
--    back down with it. Both are fixed below by delegating through
--    public.letters_for_participant instead — the same proven pattern,
--    not a new one — and moments_select_participant itself is no longer
--    touched by this migration at all (nothing was ever wrong with it).
--
-- Nothing else changes: separate client-side Postcard draft, one
-- Postcard maximum, the canonical letterhead slot, PostcardEditor, the
-- real editable PostcardBack region, Living Reveal, Preview, historical
-- inline rendering, the Moments-sheet Cancel alignment, Send-button
-- feedback, current Photo Moment behavior, and Dispatches remaining
-- Postcard-free (nothing here touches dispatches/dispatch_moments/
-- publish_dispatch in any way). p_moments still accepts 'photo' only for
-- new sends (unchanged from the previous pass); a legacy inline
-- postcardMoment draft is still migrated client-side on restore
-- (unchanged, no SQL involved in that half).
--
-- Every existing safety property in write_letter/reply_to_letter is
-- preserved unchanged: blocking (is_correspondence_blocked_pair),
-- current_account_status gating, delayed delivery (compute_deliver_at +
-- the same-direction 1-minute clamp), correspondence authorization,
-- reply_to_id validation, Photo Moments validation/consent, SECURITY
-- DEFINER, `set search_path to 'pg_catalog'`.
--
-- SIGNATURE-CHANGE REMINDER (same trap docs/sql/2026-09-12-scoped-
-- blocking-and-fixes.sql's block_user section had to correct): both
-- RPCs' argument COUNT is unchanged from the 2026-09-13 baseline in THIS
-- revision (still 5 args for write_letter, 4 for reply_to_letter — only
-- p_postcard's own internal resolution/validation logic changes) — the
-- same DROP-then-CREATE of the OLD pre-Postcard signatures is still
-- required and included below.
--
-- ============================================================
-- §1 — THE VERSIONING MODEL, IN FULL
-- ============================================================
-- postcard_catalog  — the enduring PRODUCT/CONCEPT ("Bangkok — Thailand
--                      after rain"). One row per Postcard concept,
--                      forever, regardless of how its artwork evolves.
-- postcard_versions — an IMMUTABLE PRODUCTION VERSION of that concept.
--                      Every field that describes the actual shipped
--                      asset (front image, motion asset, duration,
--                      reveal-line alignment) lives here, frozen at
--                      creation — a version row is never updated once
--                      created (this migration doesn't add an UPDATE
--                      policy for it, and no RPC ever modifies one).
--                      Exactly one version per postcard_key may be
--                      `is_current` at a time (enforced by a partial
--                      unique index, not merely convention).
-- letter_postcards  — a SENT Postcard now stores `postcard_version_id`,
--                      not `postcard_key` — the exact immutable version
--                      that travelled with that letter, resolved ONCE
--                      at Send time from whichever version was current
--                      then. Replacing the catalog's current version
--                      later (any future artwork revision, e.g. a
--                      hypothetical "essaouira-v2.jpg") never touches
--                      this foreign key — the historical row
--                      keeps pointing at the OLD version row forever,
--                      and that row's own columns never change.
--
-- TS/DATABASE ASSET BOUNDARY — CLOSED (2026-09-14, thumbnail + expanded-
-- experience checkpoint): the client (resolveLetterPostcardDisplay,
-- lib/moments.ts; getLetterPostcardsForLetters, lib/letters.ts) now
-- resolves a DELIVERED letter-level Postcard's visual assets (front
-- image, Living Reveal motion asset, duration, reveal-line alignment)
-- from its own resolved postcard_versions row — not from whatever
-- POSTCARD_CATALOG's current entry happens to define — so a historical
-- Postcard can never visually drift just because the catalog's current
-- version later changes. The static TS POSTCARD_CATALOG remains the
-- source for the new-Postcard picker/composer (choosing among CURRENT
-- offerings) and for narrative metadata this table doesn't track
-- (title, location, collection, postmark text) — never for a delivered
-- historical Postcard's own frozen asset paths. This SQL migration is
-- what makes that client-side fix possible; both are prepared together
-- in this checkpoint, applied together once approved.

begin;

-- ============================================================
-- 1. POSTCARD_CATALOG — the enduring product/concept
-- ============================================================
create table public.postcard_catalog (
  key text primary key,
  title text not null,
  country_code text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.postcard_catalog
enable row level security;

-- Catalog metadata carries no private material — separating "can this
-- be read" from "is this eligible for a NEW send" (§5 above). A
-- deactivated card's own metadata must remain readable forever so a
-- historical correspondence referencing it never breaks; the SEND RPCs
-- alone enforce is_active as their own independent business-logic gate.
create policy postcard_catalog_select_all
  on public.postcard_catalog
  for select
  using (true);

revoke all
on public.postcard_catalog
from public, anon, authenticated;

grant select
on public.postcard_catalog
to authenticated;

insert into public.postcard_catalog (key, title, country_code, is_active)
values
  ('essaouira', 'Essaouira', 'MA', true),
  ('bangkokAfterRain', 'Bangkok', 'TH', true);


-- ============================================================
-- 2. POSTCARD_VERSIONS — an immutable production version of a catalog
--    card (new)
-- ============================================================
-- Every field a Living Postcard actually needs frozen, matching
-- lib/moments.ts's PostcardLivingReveal shape 1:1 (front_image_path ~
-- PostcardData.frontImagePath, motion_src/duration_seconds/
-- reveal_line_alignment ~ PostcardLivingReveal's own fields). No
-- speculative commerce field of any kind. motion_src/duration_seconds/
-- reveal_line_alignment are all nullable — a version may describe a
-- plain static Postcard with no Living Reveal at all, exactly like a
-- PostcardData with no `living`.
create table public.postcard_versions (
  id uuid primary key default gen_random_uuid(),

  postcard_key text not null
    references public.postcard_catalog(key),

  version_number integer not null
    check (version_number >= 1),

  front_image_path text not null,

  motion_src text,

  duration_seconds numeric(6, 2),

  reveal_line_alignment text
    check (
      reveal_line_alignment is null
      or reveal_line_alignment in (
        'top-left', 'top-center', 'top-right',
        'center',
        'bottom-left', 'bottom-center', 'bottom-right'
      )
    ),

  is_current boolean not null default true,

  created_at timestamptz not null default now(),

  constraint postcard_versions_unique_number
    unique (postcard_key, version_number)
);

-- Enforced AT THE DATABASE LEVEL, not merely by convention: at most one
-- current version per postcard. A partial unique index is the correct
-- Postgres idiom for "at most one true per group" — attempting to mark a
-- second version `is_current` for the same key without first clearing
-- the old one fails outright, it can never silently happen.
create unique index postcard_versions_one_current_per_key
  on public.postcard_versions (postcard_key)
  where is_current;

alter table public.postcard_versions
enable row level security;

-- Same visibility reasoning as postcard_catalog above — a version row
-- describes production asset metadata, not private data, and a
-- historical Postcard's own version must remain readable regardless of
-- whether it's still `is_current`.
create policy postcard_versions_select_all
  on public.postcard_versions
  for select
  using (true);

revoke all
on public.postcard_versions
from public, anon, authenticated;

grant select
on public.postcard_versions
to authenticated;

-- Seed version 1 of both current cards — the exact production identity
-- already live in lib/moments.ts's POSTCARD_CATALOG today: LOCKED
-- portrait masters (approximately 9:16), unchanged from the original
-- Living Postcards checkpoints. Any future artwork revision (e.g. a
-- hypothetical "essaouira-v2.jpg") becomes a NEW row here (version_number
-- 2, is_current true) plus one UPDATE flipping version 1's is_current to
-- false — never a schema change, and
-- never touching any historical letter_postcards row's own
-- postcard_version_id.
insert into public.postcard_versions
  (postcard_key, version_number, front_image_path, motion_src, duration_seconds, reveal_line_alignment, is_current)
values
  ('essaouira', 1, '/postcards/essaouira.jpg', '/postcards/essaouira-living.mp4', 10.04, null, true),
  ('bangkokAfterRain', 1, '/postcards/bangkok-after-rain.jpg', '/postcards/bangkok-after-rain-living.mp4', 10.04, null, true);


-- ============================================================
-- 3. LETTER_POSTCARDS — the new letter-level Postcard table
-- ============================================================
-- letter_id remains the primary key (strictly one-to-one with a letter,
-- unchanged reasoning from the previous pass). postcard_version_id now
-- replaces postcard_key entirely — the catalog concept is always
-- derivable via postcard_versions.postcard_key if ever needed, so
-- storing both here would be exactly the "casually duplicate data" this
-- whole checkpoint series has been warned against. sender_pseudonym_
-- snapshot is required (every real send has a real, resolvable sender).
-- back_message's CHECK now uses the trimmed length (§4 above).
create table public.letter_postcards (
  letter_id uuid primary key
    references public.letters(id)
    on delete cascade,

  postcard_version_id uuid not null
    references public.postcard_versions(id),

  -- Optional. NULL means "no Reveal Line" — never an empty string sitting
  -- in storage (the client only ever sends a real string or explicit
  -- null, mirroring moments' own opposite-field-is-null convention).
  reveal_line text,

  -- REQUIRED, non-blank once trimmed — "the back is written for this
  -- particular sending," enforced both here and in the RPCs below (the
  -- RPC checks first, for a friendly TEMPA error; the CHECK is the
  -- standing, un-bypassable guarantee).
  back_message text not null,

  -- The sender's pseudonym exactly as it read at the moment this
  -- Postcard was sent — frozen forever, independent of any later
  -- profile change. See §2 above for why this is snapshotted while the
  -- ordinary letter header intentionally is not.
  sender_pseudonym_snapshot text not null,

  created_at timestamptz not null default now(),

  constraint letter_postcards_reveal_line_length
    check (reveal_line is null or char_length(reveal_line) <= 32),

  constraint letter_postcards_back_message_length
    check (char_length(trim(both from back_message)) between 1 and 200)
);

-- No separate index needed — letter_id is already the primary key
-- (unique btree index); postcard_version_id lookups (if ever needed
-- independently) are a small enough table to scan, and this checkpoint
-- adds no query that needs one.

-- No INSERT/UPDATE/DELETE policy at all — ordinary users cannot mutate a
-- delivered Postcard after Send, exactly mirroring public.moments' own
-- write-only-via-SECURITY-DEFINER-RPC posture. Every write happens
-- inside write_letter / reply_to_letter, atomically with the letter
-- itself.
alter table public.letter_postcards
enable row level security;

-- CORRECTED in the final surgical pre-execution audit (§7 above) — every
-- earlier draft queried `public.letters` directly here, which
-- `authenticated` holds zero grants on (docs/sql/2026-08-30-letters.sql),
-- so every read of this table would have failed with 42501 ("permission
-- denied for table letters") regardless of sender/recipient/delivery
-- state. Delegating through public.letters_for_participant instead — a
-- plain view, which runs with definer-like privileges against its own
-- underlying public.letters — reproduces the EXACT same predicate
-- (letters_for_participant's own WHERE clause already is
-- `auth.uid() = sender_id or (auth.uid() = recipient_id and deliver_at
-- <= now())`) without ever touching the base table from an
-- unprivileged context: sender sees their own outgoing Postcard
-- immediately, including while in transit; recipient only once the
-- parent letter has actually delivered.
create policy letter_postcards_select_participant
  on public.letter_postcards
  for select
  using (
    exists (
      select 1
      from public.letters_for_participant lp
      where lp.id = letter_postcards.letter_id
    )
  );

revoke all
on public.letter_postcards
from public, anon, authenticated;

grant select
on public.letter_postcards
to authenticated;


-- ============================================================
-- 4. WRITE_LETTER — resolves the CURRENT immutable version + snapshots
--    the sender's pseudonym at Send
-- ============================================================
drop function if exists public.write_letter(uuid, text, uuid, jsonb);

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
  -- Letter-Level Postcards V1 — deliberately `v_`-prefixed, never bare
  -- column-shaped names, so these can never collide with any table's own
  -- column names the way the `m` alias once collided with `m jsonb;`.
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

      -- NEW POSTCARDS ARE NOT MOMENTS: only 'photo' is ever valid in
      -- p_moments now. A legacy 'postcard' entry is rejected exactly
      -- like any other unrecognized type — this function never creates
      -- a new inline postcard Moment again.
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


  -- Letter-Level Postcards V1 — an entirely SEPARATE payload from
  -- p_moments, reusing this function's OWN existing "is Moments-grade
  -- media available right now" gate (moments_qualified_for_viewer, the
  -- same one Photo Moments above already use).
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

    -- Resolve the CURRENT immutable version — this, not the bare key,
    -- is what gets stored below. A future artwork replacement flips
    -- is_current on a NEW version row; this lookup then simply starts
    -- resolving to that new row for sends from that moment on, while
    -- every already-sent letter_postcards row keeps pointing at
    -- whichever version it originally resolved.
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

    -- "The back is written for this particular sending": a real,
    -- non-blank (once trimmed) message is required at send time. Draft
    -- state may still be blank while composing — this check only ever
    -- runs here, at actual Send.
    if v_back_message is null or char_length(trim(both from v_back_message)) = 0 then
      raise exception 'A Postcard needs its own written message before it can be sent.';
    end if;

    if char_length(trim(both from v_back_message)) > 200 then
      raise exception 'A Postcard''s back message is too long.';
    end if;

    -- Snapshot the sender's CURRENT pseudonym, frozen forever on this
    -- row — see §2 in this file's own header for why.
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


  -- Inserted atomically with the letter itself: same function
  -- invocation/transaction as the letters INSERT above, so if anything
  -- later in this function raises, this row rolls back along with the
  -- letter. back_message is stored TRIMMED, matching the table's own
  -- CHECK exactly (see §4 in this file's own header).
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

revoke all on function public.write_letter(uuid, text, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.write_letter(uuid, text, uuid, jsonb, jsonb) to authenticated;


-- ============================================================
-- 5. REPLY_TO_LETTER — same treatment as write_letter above
-- ============================================================
drop function if exists public.reply_to_letter(uuid, text, jsonb);

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

      -- Same restriction as write_letter above — see its own comment.
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


  -- Reuses THIS function's own existing "Moments-grade media available
  -- right now" gate: never on the establishing first reply, never while
  -- restricted.
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

    if char_length(trim(both from v_back_message)) > 200 then
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

revoke all on function public.reply_to_letter(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.reply_to_letter(uuid, text, jsonb, jsonb) to authenticated;


-- ============================================================
-- 6. MOMENTS_SELECT_PARTICIPANT — NO CHANGE (§3/§7 above).
-- ============================================================
-- Every earlier draft of this migration included a DROP POLICY + CREATE
-- POLICY pair here. Removed: the live policy (docs/sql/2026-09-02-
-- moments-select-policy-fix.sql) already delegates through
-- public.letters_for_participant, which already enforces
-- `deliver_at <= now()` for a recipient (since docs/sql/2026-09-04-
-- mail-call-atomic-deployment.sql), so nothing here was ever broken. The
-- draft this section used to contain would have replaced that working
-- policy with one that queries `public.letters` directly — the same
-- 42501 permission-denied defect fixed in §7's letter_postcards policy
-- above, except here it would have broken EVERY existing read of
-- public.moments (Photo Moments included), not merely a new table.
-- public.moments' own SELECT policy is therefore untouched by this
-- migration, in every respect: same policy name, same definition, same
-- privileges.

commit;


-- ============================================================
-- VERIFY — SECTION A: genuinely read-only. Run after the migration
-- above. Nothing here writes, inserts, or deletes anything.
-- ============================================================

-- A1. postcard_catalog exists, seeded with both current cards, readable
-- unconditionally (visibility no longer tied to is_active).
select key, title, country_code, is_active from public.postcard_catalog order by key;
-- Expect exactly two rows: bangkokAfterRain | Bangkok | TH | true
--                          essaouira        | Essaouira | MA | true

select policyname, cmd, qual
from pg_catalog.pg_policies
where schemaname = 'public' and tablename = 'postcard_catalog';
-- Expect exactly one row: postcard_catalog_select_all | SELECT | true

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'postcard_catalog'
order by grantee, privilege_type;
-- Expect exactly one row: authenticated | SELECT

-- A2. postcard_versions exists, seeded with version 1 of both cards,
-- exactly one current version per key, readable unconditionally.
select postcard_key, version_number, front_image_path, motion_src, duration_seconds, is_current
from public.postcard_versions
order by postcard_key;
-- Expect exactly two rows, both version_number 1, both is_current true,
-- with the exact current front_image_path/motion_src/duration_seconds
-- values already live in lib/moments.ts's POSTCARD_CATALOG today.

select postcard_key, count(*) as current_version_count
from public.postcard_versions
where is_current
group by postcard_key;
-- Expect exactly two rows, each count = 1 (C — enforced structurally by
-- postcard_versions_one_current_per_key, not merely by this seed data).

select indexname, indexdef
from pg_catalog.pg_indexes
where schemaname = 'public' and tablename = 'postcard_versions' and indexname = 'postcard_versions_one_current_per_key';
-- Expect one row whose indexdef contains `WHERE is_current` — the
-- partial unique index that makes C a real constraint, not a convention.

select policyname, cmd, qual
from pg_catalog.pg_policies
where schemaname = 'public' and tablename = 'postcard_versions';
-- Expect exactly one row: postcard_versions_select_all | SELECT | true

-- A3. letter_postcards has the corrected shape: postcard_version_id (not
-- postcard_key), sender_pseudonym_snapshot required, back_message
-- required.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'letter_postcards'
order by ordinal_position;
-- Expect exactly: letter_id (uuid, NO), postcard_version_id (uuid, NO),
-- reveal_line (text, YES), back_message (text, NO),
-- sender_pseudonym_snapshot (text, NO), created_at
-- (timestamp with time zone, NO). No "postcard_key" column.

select conname, contype, pg_catalog.pg_get_constraintdef(oid) as definition
from pg_catalog.pg_constraint
where conrelid = 'public.letter_postcards'::regclass
order by conname;
-- Expect a primary key on letter_id, a foreign key to postcard_versions
-- on postcard_version_id, a foreign key to letters on letter_id, and
-- letter_postcards_back_message_length's definition containing
-- `trim(both`.

select relrowsecurity from pg_catalog.pg_class where oid = 'public.letter_postcards'::regclass;
-- Expect: true

select policyname, cmd, qual
from pg_catalog.pg_policies
where schemaname = 'public' and tablename = 'letter_postcards';
-- Expect exactly one row, policyname letter_postcards_select_participant,
-- cmd SELECT, and `qual` containing `letters_for_participant` (§7 — it
-- delegates to that view rather than querying public.letters directly,
-- which `authenticated` holds no grant on).

-- A3b (§7 — confirms the delegation actually carries the delayed-
-- delivery predicate, rather than merely asserting the view's name
-- appears in the policy text).
select pg_catalog.pg_get_viewdef('public.letters_for_participant'::regclass) ilike '%deliver_at%'
  and pg_catalog.pg_get_viewdef('public.letters_for_participant'::regclass) ilike '%recipient_id%'
  as letters_for_participant_still_enforces_delayed_delivery;
-- Expect: true. This is the actual, transitively-inherited enforcement
-- both letter_postcards_select_participant (just created) and
-- moments_select_participant (untouched, see A6 below) rely on.

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'letter_postcards'
order by grantee, privilege_type;
-- Expect exactly one row: authenticated | SELECT.

-- A4. write_letter / reply_to_letter carry the corrected bodies.
select
  p.proname,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as args,
  p.prosecdef as security_definer,
  p.proconfig as config,
  pg_catalog.pg_get_functiondef(p.oid) ilike '%essaouira%' as still_hardcodes_a_key,
  pg_catalog.pg_get_functiondef(p.oid) ilike '%from public.postcard_versions%' as resolves_current_version,
  pg_catalog.pg_get_functiondef(p.oid) ilike '%sender_pseudonym_snapshot%' as snapshots_sender_pseudonym,
  pg_catalog.pg_get_functiondef(p.oid) ilike '%m->>''type'' not in (''photo'', ''postcard'')%' as still_accepts_legacy_postcard_moment,
  pg_catalog.pg_get_functiondef(p.oid) ilike '%trim(both from v_back_message)%' as stores_trimmed_back_message,
  pg_catalog.pg_get_functiondef(p.oid) ilike '%jsonb_array_elements(p_moments) as elem;%' as moments_alias_fix_intact,
  pg_catalog.pg_get_functiondef(p.oid) ilike '%tempa_private.is_correspondence_blocked_pair%' as has_block_check,
  pg_catalog.pg_get_functiondef(p.oid) ilike '%public.current_account_status()%' as has_account_status_check
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('write_letter', 'reply_to_letter')
order by p.proname;
-- Expect EXACTLY two rows total. For BOTH:
--   security_definer = t, config = {search_path=pg_catalog}
--   still_hardcodes_a_key = false
--   resolves_current_version = true
--   snapshots_sender_pseudonym = true
--   still_accepts_legacy_postcard_moment = false
--   stores_trimmed_back_message = true
--   moments_alias_fix_intact = true
--   has_block_check = true, has_account_status_check = true

select
  p.proname,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('write_letter', 'reply_to_letter')
order by p.proname;
-- Expect: anon_can_execute = false, authenticated_can_execute = true.

-- A5. Historical moments schema (rows/columns/constraints) is completely
-- untouched — this migration makes NO change to public.moments at all,
-- schema or policy (§3/§6/§7 above).
select conname
from pg_catalog.pg_constraint
where conrelid = 'public.moments'::regclass
order by conname;
-- Expect the exact same constraints as before this migration
-- (moments_type_check, moments_type_fields_consistent, etc.) — none
-- touched here.

-- A6 (§3/§6/§7 — CLAIM RETRACTED, see this file's own header). moments'
-- SELECT policy is UNCHANGED by this migration: still delegates through
-- public.letters_for_participant (never queries public.letters
-- directly, which `authenticated` holds no grant on), and that view
-- already enforces the delayed-delivery predicate (confirmed in A3b
-- above) — nothing here was ever broken, so nothing here changes.
select policyname, cmd, qual
from pg_catalog.pg_policies
where schemaname = 'public' and tablename = 'moments';
-- Expect exactly one row, policyname moments_select_participant, cmd
-- SELECT, and `qual` containing `letters_for_participant` — NOT a literal
-- `deliver_at`/`recipient_id` (those live in the view it delegates to,
-- confirmed transitively by A3b above).


-- ============================================================
-- VERIFY — SECTION B (optional): fixture-based checks that WOULD
-- mutate data. Wrapped in its own transaction that always ROLLS BACK, so
-- nothing here ever persists regardless of the outcome. Safe to run, but
-- entirely optional.
-- ============================================================

begin;

-- B1 (E — future Postcard needs no RPC replacement, still true here):
-- inserting a new catalog + version pair is all a NEW Postcard needs;
-- neither RPC's body names any specific key (confirmed in A4 above).
insert into public.postcard_catalog (key, title, country_code, is_active)
values ('zzz_verify_only', 'Verify Fixture', 'FR', true);

insert into public.postcard_versions
  (postcard_key, version_number, front_image_path, motion_src, duration_seconds, reveal_line_alignment, is_current)
values
  ('zzz_verify_only', 1, '/postcards/zzz.jpg', null, null, null, true);

select exists (
  select 1
  from public.postcard_catalog c
  join public.postcard_versions v on v.postcard_key = c.key and v.is_current
  where c.key = 'zzz_verify_only' and c.is_active
) as new_postcard_immediately_sendable_with_zero_rpc_changes;
-- Expect: true

-- B2 (C — the partial unique index genuinely rejects a second current
-- version for the same key, not merely "the seed data happens to have
-- one each").
do $$
begin
  begin
    insert into public.postcard_versions
      (postcard_key, version_number, front_image_path, is_current)
    values
      ('zzz_verify_only', 2, '/postcards/zzz-v2.jpg', true);
    raise exception 'expected a unique-violation and did not get one';
  exception
    when unique_violation then
      raise notice 'B2 passed: a second current version for the same key was correctly rejected';
  end;
end;
$$;

-- B3 (K — deactivating a card leaves its historical catalog/version
-- metadata readable; only NEW-send eligibility is affected).
update public.postcard_catalog set is_active = false where key = 'zzz_verify_only';

select exists (
  select 1 from public.postcard_catalog where key = 'zzz_verify_only'
) as metadata_still_selectable_when_inactive;
-- Expect: true — the row is still readable (RLS is `using (true)`).

select exists (
  select 1 from public.postcard_catalog where key = 'zzz_verify_only' and is_active
) as would_still_pass_the_rpcs_own_send_eligibility_check;
-- Expect: false — this is exactly the condition write_letter/
-- reply_to_letter check before accepting a postcard_key for a NEW send.

rollback;
-- Nothing from B1/B2/B3 persists past this point.


-- ============================================================
-- VERIFY — SECTION C (optional, manual): live RLS/RPC behavior via the
-- auth-impersonation pattern already established in docs/sql/2026-09-04-
-- mail-call-enforcement.sql's own VERIFY section. I cannot run any of
-- this myself (no service-role key/CLI in this environment); provided
-- for manual execution against real data, never against production rows
-- you don't intend to keep.
--   select set_config('request.jwt.claims', json_build_object('sub','<uuid>','role','authenticated')::text, true);
--   set local role authenticated;
-- ============================================================

-- C1 (A/B/D — a new Send resolves the current version; historical
-- letter_postcards references it immutably). As the SENDER, to a
-- correspondence whose natural deliver_at is in the future:
-- select id, deliver_at from write_letter('<correspondence-id>', 'In transit, with a postcard.', null, '[]'::jsonb,
--   json_build_object('postcard_key','essaouira','reveal_line','Keep a little sea with you.','back_message','Made it here at last.')::jsonb);
-- select postcard_version_id from public.letter_postcards where letter_id = '<new-letter-id captured above>';
-- select id, version_number from public.postcard_versions where postcard_key = 'essaouira' and is_current;
-- Expect: the two ids match — the letter references exactly the version
-- that was current at Send time.

-- C2 (B — changing the current version never touches an already-sent
-- Postcard's own reference). After C1, ship a new "version 2":
-- update public.postcard_versions set is_current = false where postcard_key = 'essaouira' and version_number = 1;
-- insert into public.postcard_versions (postcard_key, version_number, front_image_path, is_current)
--   values ('essaouira', 2, '/postcards/essaouira-v2.jpg', true);
-- select postcard_version_id from public.letter_postcards where letter_id = '<letter id from C1>';
-- Expect: UNCHANGED — still references version 1's id, never version 2's,
-- even though essaouira's current version has moved on.

-- C1b (§7 — the actual release-blocking defect this pass fixed). As the
-- SENDER, immediately after C1:
-- select * from public.letter_postcards where letter_id = '<new-letter-id from C1>';
-- Expect: one row, readable immediately — NOT a 42501 "permission denied
-- for table letters" error. (Every earlier draft of this migration would
-- have raised exactly that error here, for both sender and recipient,
-- because its policy queried public.letters directly.)
--
-- Switch impersonation to the RECIPIENT, before deliver_at:
-- select * from public.letter_postcards where letter_id = '<same letter id>';
-- Expect: zero rows (not an error — RLS correctly hides it pre-delivery).
--
-- Once deliver_at has passed, repeat as the recipient:
-- select * from public.letter_postcards where letter_id = '<same letter id>';
-- Expect: one row, now visible.

-- C3 (H/I — Moments delivery-timing gate, UNCHANGED behavior, reconfirmed
-- rather than newly fixed — see §3/§6/§7). As the SENDER, send a
-- Moments-qualified letter with a Photo Moment to a correspondence whose
-- natural deliver_at is in the future, then:
-- select * from public.moments where letter_id = '<that new letter id>';
-- Expect (as sender): the row is visible immediately (H).
--
-- Switch impersonation to the RECIPIENT, before deliver_at:
-- select * from public.moments where letter_id = '<same letter id>';
-- Expect: zero rows (G — already correct before this migration, via
-- letters_for_participant; this migration changes nothing here).
--
-- Once deliver_at has passed, repeat as the recipient:
-- select * from public.moments where letter_id = '<same letter id>';
-- Expect: one row, now visible (I).

-- C4 (E — sender pseudonym is snapshotted, not live-resolved). After C1:
-- select sender_pseudonym_snapshot from public.letter_postcards where letter_id = '<letter id from C1>';
-- Expect: the sender's pseudonym as it read at that Send.
-- Then change that sender's own profile pseudonym (ordinary profile-
-- settings update), and re-run the same select.
-- Expect: UNCHANGED — still the original snapshotted value (F), even
-- though that member's CURRENT pseudonym has since changed.

-- C5 (J — whitespace-only back_message cannot exist). As sender:
-- select write_letter('<correspondence-id>', 'Trying a blank back.', null, '[]'::jsonb,
--   json_build_object('postcard_key','essaouira','reveal_line',null,'back_message','   ')::jsonb);
-- Expect: exception 'A Postcard needs its own written message before it can be sent.'
-- (raised by the RPC's own pre-check before ever reaching the table's
-- own CHECK constraint, which would reject the same value regardless).
