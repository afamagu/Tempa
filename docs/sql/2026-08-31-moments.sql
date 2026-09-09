-- Tempa — Moments (Photo / Postcard), photo-sharing consent, and guide
-- completion tracking.
-- APPLIED 2026-08-31. Do not re-run: create table / create policy /
-- the storage bucket insert are not idempotent as written, and
-- re-running would error rather than silently reapply.
--
-- Builds on the now-applied 2026-08-31-correspondences.sql. Every write
-- path here goes through SECURITY DEFINER functions or narrow RLS
-- policies, matching the existing letters/correspondences pattern —
-- nothing is left to client-side enforcement alone.

-- ============================================================
-- MOMENTS TABLE
-- ============================================================

-- A Moment sits in the GAP after a specific paragraph of its letter's
-- existing `body` — letters.body is untouched (still one text blob,
-- still the same textarea/whitespace-pre-wrap model already tested for
-- first contact and replies). `position` is the 0-based index of the
-- paragraph it follows once body is split on blank lines
-- (regexp_split_to_array(body, '\n\s*\n'), mirrored client-side). This
-- was chosen over a normalized letter_blocks table specifically to
-- avoid restructuring how letter content is stored, validated
-- (letters_body_max_length etc.), and rendered everywhere it already
-- works today — Moments become a pure additive overlay instead.
create table public.moments (
  id uuid primary key default gen_random_uuid(),

  letter_id uuid not null
    references public.letters(id)
    on delete cascade,

  position integer not null,

  type text not null,

  -- Exactly one of these is set, matching `type`.
  image_path text,
  postcard_key text,

  created_at timestamptz not null default now(),

  constraint moments_position_nonnegative
    check (position >= 0),

  constraint moments_type_check
    check (type in ('photo', 'postcard')),

  constraint moments_type_fields_consistent
    check (
      (type = 'photo' and image_path is not null and postcard_key is null)
      or
      (type = 'postcard' and postcard_key is not null and image_path is null)
    ),

  -- At most one Moment per paragraph gap — the ⊕ affordance is replaced
  -- by the Moment once one exists there, never stacked.
  constraint moments_unique_gap
    unique (letter_id, position)
);

create index moments_letter_idx
  on public.moments (letter_id);


-- No INSERT/UPDATE/DELETE policy at all — moments are only ever written
-- by reply_to_letter below, atomically with the letter they belong to,
-- and are never modified afterward (stricter than letters, which at
-- least allows lifecycle-field updates).
alter table public.moments
enable row level security;

create policy moments_select_participant
  on public.moments
  for select
  using (
    exists (
      select 1
      from public.letters l
      where l.id = moments.letter_id
        and (l.sender_id = auth.uid() or l.recipient_id = auth.uid())
    )
  );

revoke all
on public.moments
from public, anon, authenticated;

grant select
on public.moments
to authenticated;


-- ============================================================
-- LETTERS_FOR_PARTICIPANT — expose correspondence_id
-- ============================================================

-- Appended at the end, after is_unread — CREATE OR REPLACE VIEW only
-- allows adding columns at the end, never reordering or removing
-- existing ones. Not sensitive (unlike opened_at): both participants
-- already know which correspondence a letter belongs to.
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
  or auth.uid() = l.recipient_id;


-- ============================================================
-- CORRESPONDENCES — photo-sharing consent state
-- ============================================================

-- One consent state per correspondence EPISODE, not per pair — this is
-- exactly why photo consent must never be inferred from anything other
-- than the current episode's own correspondence_id, and why a new
-- episode after closure starts at 'no_request' with nothing carried
-- over (see docs/tempa-build-guide.md).
--
--   no_request — never asked. Default for every new episode.
--   pending    — one participant has asked; awaiting the other's answer.
--   deferred   — the asked participant chose "Maybe later". The
--                original requester cannot ask again; the asked
--                participant can reopen the decision at any time.
--   enabled    — both participants may attach Photo moments.
--   photo_free — the asked participant chose to keep this correspondence
--                photo-free. Only they may later reopen it (they become
--                the requester if they do).
alter table public.correspondences
  add column photo_consent_status text not null default 'no_request',
  add column photo_consent_requested_by uuid references auth.users(id),
  add column photo_consent_requested_at timestamptz,
  add column photo_consent_resolved_by uuid references auth.users(id),
  add column photo_consent_resolved_at timestamptz;

alter table public.correspondences
  add constraint correspondences_photo_consent_status_check
    check (
      photo_consent_status in (
        'no_request', 'pending', 'deferred', 'enabled', 'photo_free'
      )
    );


-- ============================================================
-- REQUEST PHOTO SHARING
-- ============================================================

-- Either participant may call this from 'no_request'. From
-- 'photo_free', only the participant who originally chose photo-free
-- may call it — they become the new requester. Every other starting
-- state (pending, deferred, enabled) is rejected: the requester cannot
-- re-ask while a decision is pending or deferred, and there's nothing
-- to request once already enabled.
create or replace function public.request_photo_sharing(
  p_correspondence_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$

declare
  corr public.correspondences;

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


-- ============================================================
-- RESPOND TO PHOTO SHARING REQUEST
-- ============================================================

-- Only the participant who did NOT make the request may respond, and
-- only while status is 'pending' or 'deferred'. 'defer' is only a valid
-- decision the first time (from 'pending') — the reopened dialog from a
-- deferred state offers Enable / Keep waiting / Photo-free, not defer
-- again ("keep waiting" is a pure client-side dismiss with no state
-- change, so it has no decision value here).
create or replace function public.respond_photo_sharing(
  p_correspondence_id uuid,
  p_decision text
)
returns void
language plpgsql
security definer
set search_path to 'public'
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


-- ============================================================
-- REPLY TO LETTER — now accepts Moments from Letter 3 onward
-- ============================================================

-- Same signature plus one new, defaulted parameter — every existing
-- call site (including the tested Letter-2 reply path, which never
-- passes p_moments) is unaffected.
--
-- Eligibility is authoritative and lives on correspondences.status —
-- the live lifecycle is exactly: pending (Letter 1 sent, no reply yet)
-- -> active (first reply sent; established) -> closed. This function
-- does NOT use "is the letter being replied to itself a reply" as a
-- second, competing definition of established — reply_to_id is used
-- below for exactly one, narrower, purely mechanical purpose: deciding
-- whether THIS reply is the one that performs the pending -> active
-- transition, never for deciding whether Moments are allowed.
--
-- Server-side gates, not just UI:
--   - p_moments must be empty unless this correspondence's
--     status = 'active' at the moment of sending. While it is still
--     'pending' (composing the first reply), Moments are always
--     rejected — text-only, no exceptions.
--   - any 'photo' Moment requires this correspondence's
--     photo_consent_status = 'enabled'.
--   - every Moment's position must address an actual paragraph gap in
--     the body being sent.
-- CREATE OR REPLACE FUNCTION does not replace a function whose parameter
-- list differs — adding p_moments here would otherwise create a SECOND,
-- separate 2-arg/3-arg overload pair rather than replacing the original,
-- silently leaving the old Moments-less version live and reachable.
-- Drop it explicitly first so there is exactly one reply_to_letter.
drop function if exists public.reply_to_letter(uuid, text);

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

  -- Purely mechanical: identifies whether THIS reply is the one that
  -- establishes the correspondence (Letter 2), so the transition below
  -- fires exactly once, at the right moment. Not used for eligibility.
  is_first_reply := original.reply_to_id is null;


  moment_count := coalesce(jsonb_array_length(p_moments), 0);

  if moment_count > 0 then

    select status, photo_consent_status
    into correspondence_status, consent_status

    from public.correspondences

    where id = original.correspondence_id

    for update;

    if correspondence_status is distinct from 'active' then
      raise exception
        'Moments are not available until this correspondence is active.';
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

      if m->>'type' = 'photo' and consent_status is distinct from 'enabled' then
        raise exception
          'Photo sharing is not enabled in this correspondence.';
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


  update public.letters

  set
    status = 'replied',
    replied_at = now()

  where id = original.id;


  -- The successful send of Letter 2 — and only Letter 2 — is what
  -- establishes the correspondence. Every later reply (Letter 4, 6, ...)
  -- has is_first_reply = false and leaves status alone.
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


-- ============================================================
-- GUIDE COMPLETIONS — per-user, not per-correspondence
-- ============================================================

-- Deliberately plain RLS rather than a SECURITY DEFINER function: a
-- member only ever reads/writes their OWN completion rows, there is no
-- cross-user logic or masking need (unlike letters' opened_at), so an
-- RPC would add ceremony without adding safety here.
create table public.guide_completions (
  user_id uuid not null
    references auth.users(id)
    on delete cascade,

  -- e.g. 'moments'. Free-text rather than an enum so future guides
  -- (First letters, Photos & trust, Postcards, Closing a correspondence,
  -- Safety — none built yet) don't require a migration to add.
  guide_key text not null,

  completed_at timestamptz not null default now(),

  primary key (user_id, guide_key)
);

alter table public.guide_completions
enable row level security;

create policy guide_completions_own
  on public.guide_completions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert
on public.guide_completions
to authenticated;


-- ============================================================
-- PRIVATE STORAGE — letter photos
-- ============================================================

-- Path convention: letter-photos/{correspondence_id}/{random}.jpg —
-- correspondence_id as the first path segment is what the storage
-- policies below key off, via is_correspondence_participant(). Upload
-- happens before the letter itself is sent (moments.image_path is only
-- attached to a letter row once Send succeeds), so the check is against
-- the correspondence, not any specific letter or moment row.
insert into storage.buckets (id, name, public)
values ('letter-photos', 'letter-photos', false)
on conflict (id) do nothing;

create or replace function public.is_correspondence_participant(
  p_correspondence_id uuid
)
returns boolean
language sql
security definer
set search_path to 'public'
stable
as $$
  select exists (
    select 1
    from public.correspondences
    where id = p_correspondence_id
      and (participant_low = auth.uid() or participant_high = auth.uid())
  );
$$;

revoke all
on function public.is_correspondence_participant(uuid)
from public;

grant execute
on function public.is_correspondence_participant(uuid)
to authenticated;

create policy letter_photos_insert
  on storage.objects
  for insert
  with check (
    bucket_id = 'letter-photos'
    and public.is_correspondence_participant(
      ((storage.foldername(name))[1])::uuid
    )
  );

create policy letter_photos_select
  on storage.objects
  for select
  using (
    bucket_id = 'letter-photos'
    and public.is_correspondence_participant(
      ((storage.foldername(name))[1])::uuid
    )
  );

-- Deliberately no UPDATE/DELETE storage policy — a Photo, once attached
-- to a sent letter, is immutable, mirroring the letters table's own
-- immutability trigger. An uploaded-but-never-sent photo (composer
-- abandoned before Send) is a known, accepted orphan for this version —
-- no cleanup job exists yet; see the implementation report.


-- ============================================================
-- PRIVILEGES
-- ============================================================

revoke all
on function public.request_photo_sharing(uuid)
from public;

grant execute
on function public.request_photo_sharing(uuid)
to authenticated;


revoke all
on function public.respond_photo_sharing(uuid, text)
from public;

grant execute
on function public.respond_photo_sharing(uuid, text)
to authenticated;


revoke all
on function public.reply_to_letter(uuid, text, jsonb)
from public;

grant execute
on function public.reply_to_letter(uuid, text, jsonb)
to authenticated;
