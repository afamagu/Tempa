-- Tempa — Mail Call / Delayed Delivery, Migration 1 of N: the
-- letters.deliver_at foundation column only.
-- PREPARED 2026-09-04. NOT EXECUTED — review, then run in the Supabase
-- SQL editor.
--
-- Scope, deliberately narrow (see TEMPA-DELAYED-DELIVERY-SPEC.md and this
-- session's two prior investigation/correction-pass reports): this
-- migration adds and backfills letters.deliver_at ONLY. It does not
-- touch letters_for_participant, send_first_letter, reply_to_letter,
-- write_letter, close_letter, expire_stale_first_contacts,
-- search_letterbox, can_view_letter_photo, mark_letter_opened, any RLS
-- policy, or any application code. No writer RPC yet populates
-- deliver_at, and no reader yet enforces it — this migration is
-- required to produce ZERO user-visible behavior change.
--
-- Deliberately NO DEFAULT on the new column. Every letters.* insert
-- already goes through exactly three SECURITY DEFINER RPCs
-- (send_first_letter / reply_to_letter / write_letter) — the base table
-- itself carries `revoke all ... from public, anon, authenticated`
-- (docs/sql/2026-08-30-letters.sql), so there is no other insert path
-- that could ever "forget" to set deliver_at and ship silently. A future
-- migration that updates those three RPCs to compute deliver_at but
-- misses one of them will fail that RPC's very next INSERT outright
-- (not-null violation) rather than quietly producing an immediate-
-- delivery letter — this is the intended, deliberate safety property,
-- not an oversight.
--
-- Backfill: deliver_at = created_at for every existing row. This is
-- historically true (every letter sent before this feature existed was,
-- in effect, delivered at send time) and is what guarantees no
-- historical letter is affected once a later migration turns on
-- delivery-based visibility enforcement — its deliver_at will already be
-- safely in the past.
--
-- Single explicit transaction: schema change, backfill, the in-
-- transaction null-count assertion, and the NOT NULL conversion all
-- happen together. If anything fails, Postgres rolls the whole thing
-- back — nothing here is left partially applied.

begin;

-- ============================================================
-- 1. ADD COLUMN — nullable, no default. Metadata-only change (no table
--    rewrite): a plain ADD COLUMN with no default and no NOT NULL is one
--    of the fast-path DDL forms in modern Postgres.
-- ============================================================

alter table public.letters
  add column deliver_at timestamptz;


-- ============================================================
-- 2. BACKFILL — every existing row gets deliver_at = created_at.
--    Row-rewriting UPDATE (ROW EXCLUSIVE lock, does not block reads),
--    trivial at current data volume.
-- ============================================================

update public.letters
set deliver_at = created_at
where deliver_at is null;


-- ============================================================
-- 3. IN-TRANSACTION ASSERTION — explicit, self-documenting guarantee
--    that the backfill left no row behind, rather than relying only on
--    SET NOT NULL's own implicit scan below to catch it. If this ever
--    raises, the whole transaction aborts and nothing in this migration
--    is applied — same guarantee either way, stated explicitly here so
--    the failure mode is legible rather than an opaque constraint error.
-- ============================================================

do $$
declare
  remaining integer;
begin
  select count(*) into remaining
  from public.letters
  where deliver_at is null;

  if remaining <> 0 then
    raise exception
      'Migration 1 aborted: % letters row(s) still have deliver_at is null after backfill.',
      remaining;
  end if;
end;
$$;


-- ============================================================
-- 4. SET NOT NULL — safe now that every row is backfilled and verified
--    above. Requires a brief ACCESS EXCLUSIVE lock and a full-table scan
--    (no pre-existing valid CHECK constraint to skip it) — trivial at
--    current table size, and still zero user-visible behavior change:
--    nothing reads or enforces this column yet.
-- ============================================================

alter table public.letters
  alter column deliver_at set not null;


commit;


-- ============================================================
-- VERIFY (optional — read-only, safe to run or skip, run AFTER the
-- transaction above has committed)
-- ============================================================

-- 1–4. Column exists, type is timestamptz, is NOT NULL, has no default —
--      one row, all four facts at once.
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'letters'
  and column_name = 'deliver_at';
-- Expect: data_type = 'timestamp with time zone',
--         is_nullable = 'NO', column_default = null.

-- 5. Must be zero.
select count(*) as null_deliver_at_count
from public.letters
where deliver_at is null;

-- 6. Must be zero — every historical row's deliver_at exactly matches
--    its created_at (the backfill did nothing else to any row).
select count(*) as mismatched_backfill_count
from public.letters
where deliver_at <> created_at;

-- 7. Visual sample, newest first.
select id, created_at, deliver_at
from public.letters
order by created_at desc
limit 20;
