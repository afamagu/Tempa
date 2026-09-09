-- Tempa — durable correspondence/episode identity.
-- PREPARED 2026-08-31. NOT EXECUTED. Review only — do not run until
-- explicitly approved, per the same workflow as every other migration
-- in this directory.
--
-- Product rule this implements: a correspondence is one continuous
-- EPISODE between two people, not a permanent relationship row keyed by
-- the unordered pair. First contact -> first reply -> every subsequent
-- letter in that exchange shares one correspondence_id. If that episode
-- closes and the two people are ever allowed to correspond again later,
-- that is a NEW correspondence row with its own fresh state (consent
-- above all does not carry over) — see docs/tempa-build-guide.md.
--
-- This migration is additive to public.letters (one new column) plus
-- one new table, EXCEPT for one deliberate, called-out change: it drops
-- letters_one_first_contact_per_pair, which is superseded and would
-- otherwise permanently block a legitimate future re-contact after a
-- correspondence has properly closed. See the note at that DROP.

-- ============================================================
-- CORRESPONDENCES TABLE
-- ============================================================

create table public.correspondences (
  id uuid primary key default gen_random_uuid(),

  -- Canonical unordered pair. Always stored low/high regardless of who
  -- initiated THIS episode, so "is there already an active episode
  -- between these two people" is one indexed lookup, independent of
  -- direction. Who actually initiated a given episode is recoverable
  -- from that episode's own first-contact letter
  -- (correspondence_id = this row's id and reply_to_id is null) rather
  -- than duplicated here.
  participant_low uuid not null
    references auth.users(id)
    on delete cascade,

  participant_high uuid not null
    references auth.users(id)
    on delete cascade,

  -- 'active'  — episode is open: pending a first reply, or already an
  --             ongoing back-and-forth. Nothing in the product today can
  --             end an ALREADY-REPLIED episode (see build guide) — the
  --             only closure path that exists is a first-contact letter
  --             closing (by its recipient or by expiry) before any
  --             reply, so 'closed' currently only ever arises from that.
  -- 'closed'  — the episode ended. Historical, preserved, never reused.
  status text not null default 'active',

  created_at timestamptz not null default now(),
  closed_at timestamptz,

  constraint correspondences_ordered_pair
    check (participant_low < participant_high),

  constraint correspondences_status_check
    check (status in ('active', 'closed')),

  constraint correspondences_closed_consistent
    check (
      (status = 'closed') = (closed_at is not null)
    )
);


-- At most one ACTIVE episode per unordered pair, in either direction —
-- this is the new, direction-agnostic replacement for
-- letters_one_first_contact_per_pair (see the DROP below). Historical
-- closed rows for the same pair are explicitly allowed to coexist; only
-- 'active' is constrained.
create unique index correspondences_one_active_per_pair
  on public.correspondences (
    participant_low,
    participant_high
  )
  where status = 'active';


create index correspondences_pair_idx
  on public.correspondences (
    participant_low,
    participant_high
  );


-- Row-level security: participant-only, mirroring letters_select_participant.
-- No client INSERT/UPDATE policy — correspondence rows are only ever
-- created/closed from inside the existing SECURITY DEFINER functions
-- (send_first_letter, close_letter, expire_stale_first_contacts), same
-- pattern as letters itself.

alter table public.correspondences
enable row level security;

create policy correspondences_select_participant
  on public.correspondences
  for select
  using (
    auth.uid() = participant_low
    or auth.uid() = participant_high
  );

revoke all
on public.correspondences
from public, anon, authenticated;

grant select
on public.correspondences
to authenticated;


-- ============================================================
-- LETTERS.CORRESPONDENCE_ID
-- ============================================================

-- Nullable for now — backfilled below, then made NOT NULL.
alter table public.letters
  add column correspondence_id uuid
    references public.correspondences(id)
    on delete cascade;


-- ============================================================
-- BACKFILL — by actual first-contact/reply chain, not by pair
-- ============================================================

-- Deliberately NOT "group every historical letter by unordered
-- participant pair" — that would silently merge independent
-- first-contact chains between the same two people into one row if any
-- ever existed. Instead: every first-contact letter (reply_to_id is
-- null) is, by definition, the root of exactly one episode. Every reply
-- inherits its root's new correspondence_id by walking the actual
-- reply_to_id graph (recursively, so a reply-to-a-reply is still
-- attributed correctly), never by re-deriving from the pair.

drop table if exists _correspondence_backfill;

create temporary table _correspondence_backfill (
  root_letter_id uuid primary key,
  correspondence_id uuid not null
);

insert into _correspondence_backfill (root_letter_id, correspondence_id)
select id, gen_random_uuid()
from public.letters
where reply_to_id is null;


insert into public.correspondences (
  id,
  participant_low,
  participant_high,
  status,
  created_at,
  closed_at
)
select
  b.correspondence_id,
  least(l.sender_id, l.recipient_id),
  greatest(l.sender_id, l.recipient_id),
  case when l.status = 'closed' then 'closed' else 'active' end,
  l.created_at,
  l.closed_at
from public.letters l
join _correspondence_backfill b
  on b.root_letter_id = l.id;


with recursive chain as (
  select
    id as letter_id,
    id as root_letter_id
  from public.letters
  where reply_to_id is null

  union all

  select
    l.id,
    c.root_letter_id
  from public.letters l
  join chain c
    on l.reply_to_id = c.letter_id
)
update public.letters l
set correspondence_id = b.correspondence_id
from chain c
join _correspondence_backfill b
  on b.root_letter_id = c.root_letter_id
where l.id = c.letter_id;


drop table _correspondence_backfill;


-- Every letter must now have a correspondence — every letter is either
-- a first-contact root (backfilled directly) or a reply reachable from
-- one via the recursive walk above, so this should never fail on real
-- data. If it does, that indicates orphaned data predating this
-- migration and must be investigated before proceeding, not bypassed.
alter table public.letters
  alter column correspondence_id set not null;


-- ============================================================
-- IMMUTABILITY: a letter's correspondence never changes post-creation
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
-- SEND FIRST LETTER — now also opens the correspondence episode
-- ============================================================

-- Same validation as before, plus: creates the correspondence row for
-- this pair before inserting the letter. The correspondence's own
-- correspondences_one_active_per_pair unique index is what now prevents
-- a second, simultaneous episode between the same two people in EITHER
-- direction — this INSERT is the new authoritative gate, replacing
-- letters_one_first_contact_per_pair (dropped below). A violation here
-- still raises Postgres error 23505, so the existing client-side
-- handling in first-letter-composer.tsx (which already special-cases
-- error.code === '23505') keeps working unchanged.

create or replace function public.send_first_letter(
  p_recipient_id uuid,
  p_question_answer_id uuid,
  p_body text
)
returns public.letters_for_participant
language plpgsql
security definer
set search_path to 'public'
as $function$

declare
  new_correspondence_id uuid;
  new_id uuid;
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


  -- Raises 23505 (correspondences_one_active_per_pair) if an active
  -- episode already exists between these two people, in either
  -- direction. This is the new, direction-agnostic duplicate guard.
  insert into public.correspondences (
    participant_low,
    participant_high
  )
  values (
    least(auth.uid(), p_recipient_id),
    greatest(auth.uid(), p_recipient_id)
  )
  returning id
  into new_correspondence_id;


  insert into public.letters (
    sender_id,
    recipient_id,
    question_answer_id,
    correspondence_id,
    body
  )
  values (
    auth.uid(),
    p_recipient_id,
    p_question_answer_id,
    new_correspondence_id,
    p_body
  )
  returning id
  into new_id;


  select *
  into result

  from public.letters_for_participant

  where id = new_id;


  return result;

end;
$function$;


-- ============================================================
-- REPLY TO LETTER — inherits correspondence_id, never accepts one
-- ============================================================

-- Only change from the applied version: correspondence_id is copied
-- from the letter being replied to (already locked via the existing
-- `for update`) and set explicitly on the new letter's INSERT. There is
-- still no p_correspondence_id parameter anywhere in this function's
-- signature — the client has no way to supply or influence it.

create or replace function public.reply_to_letter(
  p_letter_id uuid,
  p_body text
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


  update public.letters

  set
    status = 'replied',
    replied_at = now()

  where id = original.id;


  select *
  into result

  from public.letters_for_participant

  where id = new_id;


  return result;

end;
$function$;


-- ============================================================
-- CLOSE LETTER — also closes the correspondence episode
-- ============================================================

-- Only ever applies to a first-contact letter that never got a reply
-- (reply_to_id is null and status = 'sent') — same scope as before.
-- Closing it now also closes its correspondence row, since under this
-- product rule that episode never became ongoing and is now over.

create or replace function public.close_letter(
  p_letter_id uuid,
  p_reason text
)
returns public.letters_for_participant
language plpgsql
security definer
set search_path to 'public'
as $function$

declare
  closed_letter public.letters;
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


  update public.correspondences

  set
    status = 'closed',
    closed_at = closed_letter.closed_at

  where id = closed_letter.correspondence_id;


  select *
  into result

  from public.letters_for_participant

  where id = p_letter_id;


  return result;

end;
$function$;


-- ============================================================
-- AUTOMATIC 72-HOUR EXPIRY — also closes the correspondence episode
-- ============================================================

create or replace function public.expire_stale_first_contacts()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$

declare
  affected integer;

begin

  -- `RETURNING ... INTO` a scalar/array only ever captures one row in
  -- PL/pgSQL, so the correspondence closures are chained through a data-
  -- modifying CTE instead. Each expired row here is a first-contact
  -- letter, and every first-contact letter owns exactly one
  -- correspondence (created once, in send_first_letter), so this CTE
  -- can never contain two rows pointing at the same correspondence_id —
  -- the final row_count below is therefore correct for both statements.
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

    returning correspondence_id
  )
  update public.correspondences c

  set
    status = 'closed',
    closed_at = now()

  from expired e

  where c.id = e.correspondence_id;


  get diagnostics affected = row_count;


  return affected;

end;
$function$;


-- ============================================================
-- DROP: letters_one_first_contact_per_pair — superseded, not additive
-- ============================================================

-- This is the one non-additive change in this migration. The old index
-- blocked a second first-contact letter in the SAME direction FOREVER,
-- even after proper closure — which now directly contradicts the
-- product rule that a closed episode may (subject to future product
-- rules) be followed by a brand-new one. That invariant now lives on
-- public.correspondences (correspondences_one_active_per_pair), which
-- is direction-agnostic and active-only, a strictly correct superset of
-- what this index used to do. Safe to drop only once send_first_letter
-- above is live, since that function is what now actually gates re-use.

drop index if exists public.letters_one_first_contact_per_pair;


-- letters_one_reply_per_original is UNCHANGED and still required
-- defense-in-depth: it has nothing to do with the per-pair gate above,
-- it just ensures a given letter can't receive two direct replies.
