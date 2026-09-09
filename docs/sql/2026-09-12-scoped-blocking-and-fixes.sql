-- ============================================================
-- TEMPA — SAFETY & TRUST, CHECKPOINT 1C: SCOPED BLOCKING
-- (letters vs. full) + PUBLISH_DISPATCH LIVE-TEST FIX
-- PREPARED 2026-09-12. NOT EXECUTED — review, then run in the Supabase
-- SQL editor.
-- ============================================================
--
-- Incremental against the CURRENT LIVE database, which by this point
-- already has:
--   - docs/sql/2026-09-11-safety-blocking-foundation.sql executed
--     (blocked_users, tempa_private.is_blocked_pair, block_user/
--     unblock_user, account_enforcement_state, current_account_status,
--     the block-aware public_profiles/dispatches/question_answers,
--     get_post_closure_recommendations's block exclusion, kept_minds
--     RPC-only conversion, staff_roles, admin_audit_log — all live);
--   - a manual, unmigrated live hotfix to publish_dispatch's INSERT
--     (adding explicit status/published_at) applied directly by hand
--     during live testing, which this migration now makes the
--     CANONICAL tracked source of truth for, so a future migration
--     built from this file can never reintroduce the stale version.
--
-- This file does NOT recreate blocked_users or any other table from
-- scratch, does NOT redefine anything not explicitly listed below, and
-- preserves every already-verified security property from the previous
-- migration (hardened search_path, explicit role scopes, no public
-- block-check oracle, etc.) in everything it touches.
--
-- Revision note: this version incorporates corrections from an
-- independent PostgreSQL-level audit of an earlier draft, specifically:
-- (1) block_user is now TWO unambiguous overloads by argument count
-- (see section 4) rather than one function with a defaulted new
-- parameter, which would have collided with the pre-existing
-- block_user(uuid) and made one-argument calls ambiguous; (2)
-- tempa_private.is_correspondence_blocked_pair now carries an explicit
-- REVOKE (Postgres grants EXECUTE to PUBLIC by default on function
-- creation); (3) comments on tempa_private.is_blocked_pair no longer
-- incorrectly claim "no client grant" — its live-verified state is
-- anon=false/authenticated=true, and this migration does not disturb
-- that.

begin;

-- ============================================================
-- 1. BLOCKED_USERS — add a scope column
-- ============================================================
-- `alter table ... add column ... not null default 'full'` on Postgres
-- 11+ is a metadata-only operation for existing rows (no table rewrite,
-- no per-row UPDATE) — every row that already exists effectively reads
-- back as 'full' the instant this column exists, satisfying "existing
-- rows must preserve their current meaning" without a separate UPDATE
-- statement. New rows must specify a value explicitly or also get
-- 'full' via the same default.
alter table public.blocked_users
  add column scope text not null default 'full'
    check (scope in ('letters', 'full'));

-- No grant change needed on blocked_users itself — the existing
-- `grant select ... to authenticated` (from the prior migration)
-- already covers reading this new column for the caller's own rows;
-- there is still no INSERT/UPDATE/DELETE policy or grant of any kind,
-- so scope can only ever be set via block_user below.


-- ============================================================
-- 2. TEMPA_PRIVATE.IS_BLOCKED_PAIR — now means "FULL block, either
-- direction" (redefinition, not a new function)
-- ============================================================
-- Every existing caller of this function (public_profiles,
-- dispatches_select_published, the question_answers cross-user policy,
-- get_post_closure_recommendations, can_view_letter_photo,
-- dispatch_photo_is_visible, keep_mind) needs ZERO changes — they all
-- just call `tempa_private.is_blocked_pair(...)` by name, and this
-- redefinition of its BODY automatically narrows what all of them mean
-- to "full block only," which is exactly the intended behavior per the
-- product decision ("FULL BLOCK ONLY" surface list): a letters-only
-- block must never hide a profile, a Dispatch, a Question answer, or
-- gate Keep. Same signature, same security properties (SECURITY
-- DEFINER, pg_catalog search_path) — only the WHERE clause gains
-- `scope = 'full'`.
--
-- Live-verified privilege state (independent audit correction — this is
-- NOT "no client grant"): `anon` EXECUTE = false, `authenticated`
-- EXECUTE = true. Authenticated must retain EXECUTE because public RLS
-- policies (dispatches_select_published, the question_answers policy,
-- etc.) invoke this helper directly under the querying user's own role.
-- `tempa_private` itself stays outside Supabase's Data API Exposed
-- Schemas (manually verified), which is what actually prevents a client
-- from calling this directly by name — the schema boundary, not a
-- missing grant. CREATE OR REPLACE on this EXACT existing signature
-- preserves its current grants automatically (same function OID, ACL
-- untouched) — no revoke/grant statements are issued here, deliberately,
-- so as not to disturb that already-correct live state.
create or replace function tempa_private.is_blocked_pair(a uuid, b uuid)
returns boolean
language sql
security definer
set search_path to 'pg_catalog'
stable
as $$
  select exists (
    select 1 from public.blocked_users
    where scope = 'full'
      and (
        (blocker_id = a and blocked_id = b)
        or (blocker_id = b and blocked_id = a)
      )
  )
$$;


-- ============================================================
-- 3. TEMPA_PRIVATE.IS_CORRESPONDENCE_BLOCKED_PAIR — NEW: "ANY active
-- block (letters or full), either direction"
-- ============================================================
-- DIFFERENT privilege posture than is_blocked_pair, deliberately: this
-- helper is never called directly by an RLS policy (nothing public-
-- facing needs "any block" — only the correspondence RPCs below do,
-- and they call it internally as SECURITY DEFINER functions owned by
-- the same role, which needs no grant of its own to reach it). Target
-- state: `anon` EXECUTE = false, `authenticated` EXECUTE = false. Lives
-- in tempa_private (never Data-API-exposed) as additional defense in
-- depth on top of that schema boundary.
--
-- This is a NEW function, and Postgres grants EXECUTE to PUBLIC by
-- default on function creation unless explicitly revoked — independent
-- audit correction: the previous draft of this migration stated "no
-- grant to public/anon/authenticated" in a comment but never actually
-- issued a REVOKE, leaving the default PUBLIC grant silently in place.
-- Corrected below with an explicit revoke immediately after creation.
create or replace function tempa_private.is_correspondence_blocked_pair(a uuid, b uuid)
returns boolean
language sql
security definer
set search_path to 'pg_catalog'
stable
as $$
  select exists (
    select 1 from public.blocked_users
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  )
$$;

revoke all on function tempa_private.is_correspondence_blocked_pair(uuid, uuid)
  from public, anon, authenticated;

-- Deliberately no grant to anon or authenticated — this helper is only
-- ever called from inside the SECURITY DEFINER correspondence RPCs
-- (send_first_letter, reply_to_letter, write_letter,
-- request_photo_sharing, respond_photo_sharing), which execute under
-- their owning role and need no EXECUTE grant of their own to call
-- another function owned by that same role.


-- ============================================================
-- 4. BLOCK_USER — two-signature overload design
-- (independent-audit correction)
-- ============================================================
-- REJECTED APPROACH (the previous draft of this migration): a single
-- `public.block_user(p_blocked_id uuid, p_scope text default 'full')`,
-- reasoned as "CREATE OR REPLACE modifies the existing function in
-- place." That reasoning was wrong. CREATE OR REPLACE FUNCTION can only
-- replace a function with the IDENTICAL argument list — changing the
-- argument list (adding a parameter, even a defaulted one) creates a
-- SEPARATE, NEW overloaded function alongside the pre-existing
-- `block_user(uuid)`, which this migration's own prior draft never
-- dropped. With a DEFAULT on the new second parameter, a one-argument
-- call would then be ambiguous between the two overloads — undefined
-- behavior, not "the old one still works."
--
-- CORRECTED DESIGN: two distinct, unambiguous overloads, differing only
-- in argument COUNT (not merely a default) so PostgREST and plain SQL
-- callers alike resolve to exactly one candidate per call shape:
--
-- A. public.block_user(p_blocked_id uuid, p_scope text) — NO DEFAULT.
--    The actual scope-aware implementation. Every caller passing both
--    arguments resolves here, and only here.
-- B. public.block_user(p_blocked_id uuid) — the pre-existing one-
--    argument signature, redefined as a thin legacy-compatibility
--    wrapper that delegates to (A) with p_scope = 'full'. Any existing
--    one-argument caller (a cached PostgREST schema, an old client
--    build, a direct API call naming only p_blocked_id) keeps producing
--    EXACTLY today's current full-block behavior, unchanged.
--
-- (A) is created first so that (B)'s body, which calls it explicitly
-- with both a uuid and a text literal, always resolves unambiguously at
-- the point Postgres validates/executes it.
create or replace function public.block_user(p_blocked_id uuid, p_scope text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  -- NULL is rejected explicitly and separately from the allow-list
  -- check below — `null not in ('letters', 'full')` evaluates to NULL,
  -- not true, which would silently fall through the IF without raising
  -- anything. A caller must pass one of the two real scopes.
  if p_scope is null then
    raise exception 'Unknown block scope.';
  end if;

  if p_scope not in ('letters', 'full') then
    raise exception 'Unknown block scope.';
  end if;

  if auth.uid() = p_blocked_id then
    raise exception 'You cannot block yourself.';
  end if;

  if not exists (select 1 from public.profiles where id = p_blocked_id) then
    raise exception 'Member not found.';
  end if;

  -- Directional storage, idempotent via ON CONFLICT ... DO UPDATE SET
  -- scope = excluded.scope — calling this again for an already-blocked
  -- pair simply sets scope to whatever was just requested (upgrade
  -- letters -> full, or downgrade full -> letters, both explicitly
  -- supported per the product decision: "A caller should be able to
  -- upgrade a letters-only block to full. If full is later changed back
  -- to letters-only, removed Keep rows are NOT silently restored.").
  insert into public.blocked_users (blocker_id, blocked_id, scope)
  values (auth.uid(), p_blocked_id, p_scope)
  on conflict (blocker_id, blocked_id) do update
    set scope = excluded.scope;

  if p_scope = 'full' then
    -- Keep cascade — approved: a FULL block removes Keep in BOTH
    -- directions, atomically, in the same transaction, whether this is
    -- a fresh full block or an upgrade from letters. Direct table
    -- access (not through keep_mind/unkeep_mind) is correct and
    -- necessary here: SECURITY DEFINER lets this reach the row where
    -- the caller is merely kept_user_id (the other side's Keep of
    -- them), which their own RLS would never permit them to touch
    -- directly. A fresh or resulting 'letters' scope (including a
    -- downgrade from 'full') never enters this branch, so it never
    -- touches kept_minds and never restores a row a prior full block
    -- already deleted.
    delete from public.kept_minds
    where (viewer_user_id = auth.uid() and kept_user_id = p_blocked_id)
       or (viewer_user_id = p_blocked_id and kept_user_id = auth.uid());
  end if;
end;
$function$;

-- Legacy compatibility wrapper — the pre-existing one-argument
-- signature, redefined (same signature as before this checkpoint, so
-- CREATE OR REPLACE genuinely modifies it in place, same OID) to
-- delegate entirely to the two-argument version above with an explicit
-- 'full' literal. Produces IDENTICAL behavior to today's current
-- block_user(uuid): a full block, same validation, same Keep cascade,
-- reached via the shared implementation rather than duplicated.
create or replace function public.block_user(p_blocked_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  perform public.block_user(p_blocked_id, 'full');
end;
$function$;

-- Explicit privilege hardening for BOTH signatures — independent-audit
-- correction: do not rely on inherited/default grants. Postgres grants
-- EXECUTE to PUBLIC by default on function creation, and CREATE OR
-- REPLACE does not change an existing function's ACL, so this
-- explicitly re-establishes the intended state for both overloads
-- regardless of what either had before this migration: unreachable by
-- anon, reachable only by an authenticated caller.
revoke all on function public.block_user(uuid) from public, anon, authenticated;
revoke all on function public.block_user(uuid, text) from public, anon, authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.block_user(uuid, text) to authenticated;

-- unblock_user is completely UNCHANGED — single signature, already
-- deletes the caller's directional row regardless of scope, and already
-- never restores kept_minds. Not reproduced here; nothing about it
-- needs to change for this checkpoint.


-- ============================================================
-- 5. GET_BLOCKED_PROFILES — now also returns scope
-- ============================================================
-- Uses DROP + CREATE rather than CREATE OR REPLACE, deliberately, to
-- avoid ANY ambiguity around Postgres's rules for changing a `RETURNS
-- TABLE(...)` column list via CREATE OR REPLACE (the exact class of
-- risk this engagement already hit once with get_shared_dispatch).
-- get_blocked_profiles has a fixed, trivial signature (no arguments),
-- exactly one caller (lib/blocking.ts's getBlockedProfiles), and no
-- other object depends on its specific OID — dropping and recreating
-- it is unambiguously safe here, and the grant is reissued explicitly
-- immediately after, so nothing is silently left ungranted.
drop function if exists public.get_blocked_profiles();

create function public.get_blocked_profiles()
returns table (
  id uuid,
  pseudonym text,
  country text,
  scope text,
  created_at timestamptz
)
language sql
security definer
set search_path to 'pg_catalog'
stable
as $$
  select p.id, p.pseudonym, p.country, b.scope, b.created_at
  from public.blocked_users b
  join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid()
  order by b.created_at desc
$$;

revoke all on function public.get_blocked_profiles() from public;
grant execute on function public.get_blocked_profiles() to authenticated;


-- ============================================================
-- 6. LETTER-WRITING RPCs — switch from is_blocked_pair to
-- is_correspondence_blocked_pair (now gated by ANY block, not just
-- full)
-- ============================================================
-- Reproduced verbatim from the live 2026-09-11 migration (re-read
-- directly from that file before writing this section, not from
-- memory) with exactly one change per function: every call site that
-- read `tempa_private.is_blocked_pair(...)` for the purpose of
-- refusing NEW correspondence now reads
-- `tempa_private.is_correspondence_blocked_pair(...)` instead. No other
-- line in any of these five functions is different. Historical letter
-- reads (letters_for_participant, reply/write's own row lookups) are
-- completely untouched — a letters-only or full block never hides
-- existing letters, only refuses to create new ones.

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


  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'Recipient does not exist.';
  end if;

  -- CHANGED: is_blocked_pair -> is_correspondence_blocked_pair (any
  -- active block, letters or full, now refuses a new first contact).
  if tempa_private.is_correspondence_blocked_pair(auth.uid(), p_recipient_id) then
    raise exception 'Recipient does not exist.';
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
  v_status text;

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


  -- CHANGED: is_blocked_pair -> is_correspondence_blocked_pair.
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
  v_status text;

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

  -- CHANGED: is_blocked_pair -> is_correspondence_blocked_pair.
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


create or replace function public.request_photo_sharing(
  p_correspondence_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$

declare
  corr public.correspondences;
  other_participant uuid;

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;


  select *
  into corr

  from public.correspondences

  where
    id = p_correspondence_id
    and (participant_low = auth.uid() or participant_high = auth.uid())

  for update;


  if not found then
    raise exception 'Correspondence not found.';
  end if;

  other_participant := case
    when auth.uid() = corr.participant_low then corr.participant_high
    else corr.participant_low
  end;

  -- CHANGED: is_blocked_pair -> is_correspondence_blocked_pair —
  -- initiating a NEW photo-sharing arrangement is new private
  -- interaction, gated the same as a new letter.
  if tempa_private.is_correspondence_blocked_pair(auth.uid(), other_participant) then
    raise exception 'Photo sharing cannot be requested right now.';
  end if;

  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'Photo sharing cannot be requested right now.';
  end if;

  if corr.status <> 'active' then
    raise exception 'This correspondence is not active.';
  end if;


  if corr.photo_consent_status = 'no_request' then

    update public.correspondences

    set
      photo_consent_status = 'pending',
      photo_consent_requested_by = auth.uid(),
      photo_consent_requested_at = now(),
      photo_consent_resolved_by = null,
      photo_consent_resolved_at = null

    where id = p_correspondence_id;

  elsif
    corr.photo_consent_status = 'photo_free'
    and corr.photo_consent_resolved_by = auth.uid()
  then

    update public.correspondences

    set
      photo_consent_status = 'pending',
      photo_consent_requested_by = auth.uid(),
      photo_consent_requested_at = now(),
      photo_consent_resolved_by = null,
      photo_consent_resolved_at = null

    where id = p_correspondence_id;

  else

    raise exception 'Photo sharing cannot be requested right now.';

  end if;

end;
$function$;


create or replace function public.respond_photo_sharing(
  p_correspondence_id uuid,
  p_decision text
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$

declare
  corr public.correspondences;

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if p_decision not in ('enable', 'defer', 'photo_free') then
    raise exception 'Unknown decision.';
  end if;


  select *
  into corr

  from public.correspondences

  where
    id = p_correspondence_id
    and (participant_low = auth.uid() or participant_high = auth.uid())

  for update;


  if not found then
    raise exception 'Correspondence not found.';
  end if;

  -- CHANGED: only the 'enable' decision (new photo capability turning
  -- on — new private interaction) is gated, and now by
  -- is_correspondence_blocked_pair rather than is_blocked_pair —
  -- declining/deferring still remains available regardless of any
  -- block or status, since it never creates new shared media.
  if p_decision = 'enable' then
    if tempa_private.is_correspondence_blocked_pair(
      auth.uid(),
      case when auth.uid() = corr.participant_low then corr.participant_high else corr.participant_low end
    ) then
      raise exception 'There is no photo-sharing request awaiting a response.';
    end if;

    if public.current_account_status() in ('restricted', 'suspended', 'banned') then
      raise exception 'There is no photo-sharing request awaiting a response.';
    end if;
  end if;

  if corr.photo_consent_status not in ('pending', 'deferred') then
    raise exception 'There is no photo-sharing request awaiting a response.';
  end if;

  if corr.photo_consent_requested_by = auth.uid() then
    raise exception 'You cannot respond to your own request.';
  end if;

  if p_decision = 'defer' and corr.photo_consent_status <> 'pending' then
    raise exception 'This request has already been deferred.';
  end if;


  update public.correspondences

  set
    photo_consent_status = case p_decision
      when 'enable' then 'enabled'
      when 'defer' then 'deferred'
      when 'photo_free' then 'photo_free'
    end,
    photo_consent_resolved_by = auth.uid(),
    photo_consent_resolved_at = now()

  where id = p_correspondence_id;

end;
$function$;

-- can_view_letter_photo and dispatch_photo_is_visible are DELIBERATELY
-- NOT changed here — both stay gated on is_blocked_pair (full block
-- only). Viewing a photo already embedded in existing, historical
-- content (a delivered letter or a published Dispatch) is a read of
-- something that already exists, not new private interaction — the
-- same category as "existing delivered letters/history remain
-- visible" and "Public Dispatch Moments remain visible" under the
-- letters-only block's own locked meaning. Only a FULL block, which
-- severs the pair's connection app-wide, also stops new signed URLs
-- for these. This is an explicit interpretation of the two surface
-- lists in the checkpoint (neither list names letter/Dispatch photo
-- visibility specifically) — flagged in the completion report for
-- confirmation, not silently assumed.


-- ============================================================
-- 7. PUBLISH_DISPATCH — canonical fix for the live-tested
-- dispatches_published_at_required failure
-- ============================================================
-- Live finding: the INSERT in the version shipped by the prior
-- migration named only (author_id, title, body) — three columns —
-- relying on column-level defaults for status/published_at that this
-- live database does not currently have in effect (whatever the exact
-- history there — a schema drift from an untracked ALTER, or a
-- constraint added after those defaults were assumed reliable — the
-- live error is the ground truth here, not the older migration text).
-- This was hand-patched directly against the live database during
-- testing; this migration now makes that fix the tracked, canonical
-- source so a future migration authored from this file's own text can
-- never reintroduce the stale three-column INSERT. Every other line of
-- this function — the account-status check added by the prior
-- migration, all validation, topics/Moments handling — is unchanged.
create or replace function public.publish_dispatch(
  p_title text,
  p_body text,
  p_topics text[] default '{}',
  p_moments jsonb default '[]'::jsonb
)
returns public.dispatches
language plpgsql
security invoker
set search_path to 'public'
as $function$

declare
  new_id uuid;
  result public.dispatches;
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

  if char_length(trim(p_title)) = 0 then
    raise exception 'A Dispatch needs a title.';
  end if;

  if char_length(p_title) > 70 then
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


  -- FIXED: explicit status/published_at — the live-tested cause of the
  -- dispatches_published_at_required failure. Every Dispatch this app
  -- version creates is published immediately (no draft state), so
  -- these two values are always the same two literals; never trust an
  -- implicit column default again for a constraint this load-bearing.
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


  select * into result from public.dispatches where id = new_id;

  return result;

end;
$function$;

revoke all on function public.publish_dispatch(text, text, text[], jsonb) from public;
grant execute on function public.publish_dispatch(text, text, text[], jsonb) to authenticated;

commit;
