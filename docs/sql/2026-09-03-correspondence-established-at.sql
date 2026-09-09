-- Tempa — Write Anytime, part 1: correspondences.established_at.
-- PREPARED 2026-09-03. NOT EXECUTED — review, then run in the Supabase
-- SQL editor. Run this BEFORE
-- 2026-09-03-reply-to-letter-established-at.sql and
-- 2026-09-03-drop-one-reply-per-original.sql (in that order) and
-- 2026-09-03-write-letter-rpc.sql.
--
-- Why this column exists: correspondences.status defaults to 'active'
-- at row creation (2026-08-31-correspondences.sql) — it is already
-- 'active' during the pre-reply establishment window, not only once
-- established. status alone therefore cannot distinguish "first
-- contact sent, not yet accepted" from "an ongoing, established
-- correspondence." established_at is the explicit signal Write Anytime
-- (write_letter) and Moments eligibility both key off.
--
-- CRITICAL: this migration backfills existing data. It does not leave
-- real/test correspondences stranded at established_at = null.

alter table public.correspondences
  add column if not exists established_at timestamptz null;

comment on column public.correspondences.established_at is
  'Set exactly once, the moment this correspondence''s first reply lands (see reply_to_letter / write_letter). Null means first contact was sent but never accepted. status=''active'' alone cannot distinguish these — it is already active from row creation.';

-- ============================================================
-- BACKFILL
--
-- Evidence used: for each correspondence, find its root letter
-- (reply_to_id is null — exactly one per correspondence, since
-- send_first_letter creates both atomically) and any letter whose
-- reply_to_id points at that root (its first reply, at most one today
-- since letters_one_reply_per_original is still live at this point in
-- the migration sequence — this backfill MUST run before that index is
-- dropped). A correspondence whose root has no such reply is left
-- untouched (established_at stays null) — never guessed at.
--
-- established_at is set to the first reply's actual created_at, not
-- now() — a defensible historical timestamp, not today's date stamped
-- onto old data. min() is a defensive no-op today (at most one reply
-- per root while the old constraint holds) that costs nothing and
-- guards against any future ambiguity in this one-time backfill.
--
-- Guarded by `established_at is null` so this is safe to re-run.
-- ============================================================

update public.correspondences c
set established_at = first_reply.first_reply_at
from (
  select
    root.correspondence_id,
    min(reply.created_at) as first_reply_at
  from public.letters root
  join public.letters reply
    on reply.reply_to_id = root.id
  where root.reply_to_id is null
  group by root.correspondence_id
) first_reply
where c.id = first_reply.correspondence_id
  and c.established_at is null;

-- ============================================================
-- VERIFY (optional — read-only, safe to run or skip)
-- ============================================================

-- 1. Correspondence, participants, established_at, root letter, first
--    reply timestamp — one row per correspondence.
select
  c.id as correspondence_id,
  c.participant_low,
  c.participant_high,
  c.status,
  c.established_at,
  root.id as root_letter_id,
  root.status as root_letter_status,
  reply.id as first_reply_letter_id,
  reply.created_at as first_reply_created_at
from public.correspondences c
join public.letters root
  on root.correspondence_id = c.id and root.reply_to_id is null
left join public.letters reply
  on reply.reply_to_id = root.id
order by c.created_at desc;

-- 2. Sanity totals.
select
  count(*) filter (where established_at is not null) as established_count,
  count(*) filter (where established_at is null) as unestablished_count
from public.correspondences;

-- 3. Must return zero rows: any correspondence whose root letter
--    already shows status='replied' (proof a reply landed) but that
--    the backfill somehow left established_at null.
select c.id
from public.correspondences c
join public.letters root
  on root.correspondence_id = c.id and root.reply_to_id is null
where root.status = 'replied' and c.established_at is null;

-- 4. Must also return zero rows: established_at set on a correspondence
--    whose root has no reply at all (would mean established_at was set
--    on unproven evidence).
select c.id
from public.correspondences c
join public.letters root
  on root.correspondence_id = c.id and root.reply_to_id is null
where c.established_at is not null
  and not exists (
    select 1 from public.letters reply where reply.reply_to_id = root.id
  );
