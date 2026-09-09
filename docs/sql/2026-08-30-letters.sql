-- Tempa — first-contact / first-letter lifecycle.
-- APPLIED 2026-08-30. This is the exact text that ran successfully —
-- kept verbatim (reformatted by the user before running; semantically
-- identical to the reviewed version) as the historical record of what
-- is now live. Do not re-run: create table / create view / create
-- function are not idempotent as written, and re-running would error or
-- (for the create-or-replace statements) silently reapply — there is no
-- reason to.

-- ============================================================
-- LETTERS TABLE
-- ============================================================

create table public.letters (
  id uuid primary key default gen_random_uuid(),

  sender_id uuid not null
    references auth.users(id)
    on delete cascade,

  recipient_id uuid not null
    references auth.users(id)
    on delete cascade,

  -- Exact Discovery answer that led to this first-contact letter.
  -- Set only on original first-contact letters.
  question_answer_id uuid
    references public.question_answers(id)
    on delete set null,

  -- Null = original first-contact letter.
  -- Non-null = reply to another letter.
  reply_to_id uuid
    references public.letters(id)
    on delete set null,

  body text not null,

  status text not null default 'sent',

  created_at timestamptz not null default now(),

  -- Ordinary protected column rather than a generated column.
  -- PostgreSQL rejects timestamptz + interval in a generated expression
  -- because that expression is not considered immutable.
  -- now() is stable within the statement/transaction, so created_at and
  -- expires_at are established from the same transaction time.
  expires_at timestamptz not null
    default (now() + interval '72 hours'),

  -- Recipient-only internal state.
  -- Raw opened_at is never exposed through the public read surface.
  opened_at timestamptz,

  replied_at timestamptz,

  closed_at timestamptz,

  closed_by text,

  close_reason text,

  constraint letters_status_check
    check (
      status in ('sent', 'replied', 'closed')
    ),

  constraint letters_body_not_blank
    check (
      char_length(
        regexp_replace(body, '\s+', '', 'g')
      ) > 0
    ),

  constraint letters_body_max_length
    check (
      char_length(body) <= 4000
    ),

  constraint letters_no_self_letter
    check (
      sender_id <> recipient_id
    ),

  constraint letters_replied_consistent
    check (
      (status = 'replied') = (replied_at is not null)
    ),

  -- Every valid closed-state combination is encoded here.
  --
  -- Recipient closure:
  --   status = closed
  --   closed_by = recipient
  --   close_reason must be one of the approved reasons
  --
  -- System expiry:
  --   status = closed
  --   closed_by = system
  --   close_reason must remain null
  constraint letters_closed_fields_consistent
    check (
      (
        status <> 'closed'
        and closed_by is null
        and close_reason is null
        and closed_at is null
      )
      or
      (
        status = 'closed'
        and closed_by = 'recipient'
        and closed_at is not null
        and close_reason in (
          'I can''t take on another correspondence right now.',
          'I don''t think we''re the right correspondence.',
          'I''m taking a break from new letters.'
        )
      )
      or
      (
        status = 'closed'
        and closed_by = 'system'
        and closed_at is not null
        and close_reason is null
      )
    )
);


-- ============================================================
-- INDEXES
-- ============================================================

-- One original first-contact attempt per sender → recipient pair.
-- Direction matters: B may still independently initiate toward A later.
create unique index letters_one_first_contact_per_pair
  on public.letters (
    sender_id,
    recipient_id
  )
  where reply_to_id is null;


-- At most one direct reply to each letter.
create unique index letters_one_reply_per_original
  on public.letters (
    reply_to_id
  )
  where reply_to_id is not null;


create index letters_recipient_status_idx
  on public.letters (
    recipient_id,
    status
  );


create index letters_sender_idx
  on public.letters (
    sender_id
  );


create index letters_reply_to_idx
  on public.letters (
    reply_to_id
  );


-- Helps the scheduled expiry process locate stale first contacts.
create index letters_expiry_scan_idx
  on public.letters (
    expires_at
  )
  where
    status = 'sent'
    and reply_to_id is null;


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.letters
enable row level security;


-- Defense in depth.
--
-- Ordinary authenticated clients receive no direct SELECT grant on the
-- base table below. This policy still ensures that any direct read path
-- that might exist in the future is participant-restricted.
create policy letters_select_participant
  on public.letters
  for select
  using (
    auth.uid() = sender_id
    or auth.uid() = recipient_id
  );


-- ============================================================
-- SAFE READ SURFACE
-- ============================================================

-- Clients read correspondence through this view rather than public.letters.
--
-- opened_at is deliberately omitted.
--
-- The recipient gets only a derived is_unread boolean. For the sender,
-- is_unread is always false, so it cannot serve as a read receipt.

create view public.letters_for_participant
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
  ) as is_unread

from public.letters l

where
  auth.uid() = l.sender_id
  or auth.uid() = l.recipient_id;


-- ============================================================
-- IMMUTABILITY TRIGGER
-- ============================================================

-- Identity, content, original timestamps and expiry deadline cannot
-- change after creation.
--
-- Lifecycle fields may change only through the controlled RPCs.
--
-- Once a letter reaches replied or closed, its status cannot leave that
-- terminal state.

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


create trigger letters_enforce_immutability
  before update
  on public.letters
  for each row
  execute function public.enforce_letter_immutability();


-- ============================================================
-- SEND FIRST LETTER
-- ============================================================

-- Sole INSERT path for an original first-contact letter.
--
-- Validates:
--   - authenticated sender
--   - sender is not recipient
--   - recipient exists
--   - referenced Question answer belongs to recipient
--   - answer is currently published
--   - Question is active
--
-- Body validity and one-first-contact-per-pair are enforced by table
-- constraints/indexes.

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


  insert into public.letters (
    sender_id,
    recipient_id,
    question_answer_id,
    body
  )
  values (
    auth.uid(),
    p_recipient_id,
    p_question_answer_id,
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
-- MARK LETTER OPENED
-- ============================================================

-- Recipient-only.
-- opened_at is set once and never returned by this function.

create or replace function public.mark_letter_opened(
  p_letter_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
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
    and opened_at is null;

end;
$function$;


-- ============================================================
-- REPLY TO LETTER
-- ============================================================

-- Sole INSERT path for replies.
--
-- Locks the target letter while processing so concurrent reply/closure
-- actions cannot race.
--
-- Original first-contact letters cannot be replied to after the
-- 72-hour deadline, even if the scheduled expiry process has not yet
-- physically changed their status to closed.
--
-- Later reply letters are not subject to the first-contact deadline.

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
    body
  )
  values (
    auth.uid(),
    original.sender_id,
    original.id,
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
-- RECIPIENT CLOSES FIRST-CONTACT LETTER
-- ============================================================

-- Applies only to original first-contact letters.
-- Recipient must close it before expiry.
-- p_reason is validated by the table constraint.

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
    and expires_at > now();


  if not found then
    raise exception
      'Letter not found, not addressed to you, or no longer awaiting a decision.';
  end if;


  select *
  into result

  from public.letters_for_participant

  where id = p_letter_id;


  return result;

end;
$function$;


-- ============================================================
-- AUTOMATIC 72-HOUR EXPIRY
-- ============================================================

-- Intended for a trusted scheduled/server process.
--
-- Ordinary authenticated users receive no EXECUTE permission.
--
-- System expiry deliberately supplies no human rejection reason.

create or replace function public.expire_stale_first_contacts()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$

declare
  affected integer;

begin

  update public.letters

  set
    status = 'closed',
    closed_at = now(),
    closed_by = 'system',
    close_reason = null

  where
    status = 'sent'
    and reply_to_id is null
    and expires_at <= now();


  get diagnostics affected = row_count;


  return affected;

end;
$function$;


-- ============================================================
-- POST-CLOSURE RECOMMENDATIONS
-- ============================================================

-- Caller supplies only the closed first-contact letter ID.
--
-- Server verifies:
--   - caller is that letter's sender
--   - it is an original first-contact letter
--   - it has actually closed, or has effectively expired
--
-- Recipient to exclude is derived server-side.
--
-- Results:
--   - only current published answers
--   - only active Questions
--   - exclude sender
--   - exclude recipient whose introduction just ended
--   - maximum exactly 3
--
-- Ordering is deterministic for a given (letter, candidate), so
-- refreshing the same closed letter does not create an endless
-- recommendation feed.
--
-- New-member weighting:
--   0–30 days  = 1.5
--   31–90 days = 1.25
--   91+ days   = 1.0
--
-- The bigint cast before "+ 1" prevents a possible int4 overflow when
-- the masked hash equals 2147483647.

create or replace function public.get_post_closure_recommendations(
  p_letter_id uuid
)
returns table (
  answer_id uuid,
  user_id uuid,
  question_id uuid,
  body text,
  pseudonym text,
  country text,
  gender text,
  gender_custom text,
  age_range text,
  prompt text
)
language plpgsql
security definer
set search_path to 'public'
stable
as $function$

declare
  target public.letters;

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;


  select *
  into target

  from public.letters

  where
    id = p_letter_id
    and sender_id = auth.uid()
    and reply_to_id is null;


  if not found then
    raise exception
      'Letter not found or not a first-contact letter you sent.';
  end if;


  if
    target.status <> 'closed'
    and not (
      target.status = 'sent'
      and target.expires_at <= now()
    )
  then
    raise exception
      'Recommendations are only available once this letter has closed.';
  end if;


  return query

    select
      qa.id as answer_id,
      qa.user_id,
      qa.question_id,
      qa.body,
      p.pseudonym,
      p.country,
      p.gender,
      p.gender_custom,
      p.age_range,
      q.prompt

    from public.question_answers qa

    join public.questions q
      on q.id = qa.question_id
      and q.is_active = true

    join public.profiles p
      on p.id = qa.user_id

    where
      qa.is_current = true
      and qa.user_id <> auth.uid()
      and qa.user_id <> target.recipient_id

    order by

      power(

        -- Deterministic u in (0, 1].
        (
          (
            (
              hashtext(
                p_letter_id::text
                || ':'
                || qa.id::text
              )
              & 2147483647
            )::bigint
            + 1
          )::double precision

          / 2147483648.0
        ),

        1.0 / (

          case

            when
              extract(
                epoch from (
                  now() - p.created_at
                )
              ) / 86400.0 <= 30
            then 1.5

            when
              extract(
                epoch from (
                  now() - p.created_at
                )
              ) / 86400.0 <= 90
            then 1.25

            else 1.0

          end

        )

      ) desc

    limit 3;

end;
$function$;


-- ============================================================
-- PRIVILEGES
-- ============================================================

-- Ordinary users receive no direct privileges on the base table.
-- Reads go through letters_for_participant.
-- Writes go through SECURITY DEFINER RPCs.

revoke all
on public.letters
from public, anon, authenticated;


-- Authenticated users may read only the safe masking view.

grant select
on public.letters_for_participant
to authenticated;


-- SECURITY DEFINER functions receive PUBLIC EXECUTE by default in
-- PostgreSQL, so revoke it explicitly and grant only the required roles.

revoke all
on function public.send_first_letter(
  uuid,
  uuid,
  text
)
from public;


grant execute
on function public.send_first_letter(
  uuid,
  uuid,
  text
)
to authenticated;


revoke all
on function public.mark_letter_opened(
  uuid
)
from public;


grant execute
on function public.mark_letter_opened(
  uuid
)
to authenticated;


revoke all
on function public.reply_to_letter(
  uuid,
  text
)
from public;


grant execute
on function public.reply_to_letter(
  uuid,
  text
)
to authenticated;


revoke all
on function public.close_letter(
  uuid,
  text
)
from public;


grant execute
on function public.close_letter(
  uuid,
  text
)
to authenticated;


revoke all
on function public.get_post_closure_recommendations(
  uuid
)
from public;


grant execute
on function public.get_post_closure_recommendations(
  uuid
)
to authenticated;


revoke all
on function public.expire_stale_first_contacts()
from public;


grant execute
on function public.expire_stale_first_contacts()
to service_role;
