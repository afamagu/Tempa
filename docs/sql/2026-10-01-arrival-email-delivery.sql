-- ============================================================
-- TEMPA — LETTER ARRIVAL EMAIL DELIVERY SYSTEM
-- STATUS: NOT EXECUTED — review, then run in the Supabase SQL editor.
-- ============================================================
--
-- Builds the durable queue + worker-facing RPC surface for "a letter
-- has arrived" emails (docs/tempa-build-guide.md §21/§24-F/§32). Does
-- NOT touch public.letters, public.correspondences, public.profiles,
-- public.blocked_users, public.account_enforcement_state or
-- public.correspondence_hidden_for_user — every one of those is read
-- only, from inside SECURITY DEFINER function bodies below. Also reuses
-- (never redefines) tempa_private.is_correspondence_blocked_pair from
-- docs/sql/2026-09-12-scoped-blocking-and-fixes.sql — already live —
-- for the blocking check, rather than re-deriving that logic here.
--
-- Privacy rule this whole system is built around: the email (see
-- lib/email/arrival.ts, already live on this branch) never carries the
-- letter body, a Moment, or a Postcard — only "a letter has arrived"
-- plus a deep link. Nothing added here changes that: the queue table
-- stores ids/status/error text only, never letter content.
--
-- arrival_email_provider_requests (added by an independent audit
-- correction, see Part 10 below) is a stricter case of the same rule:
-- it holds the exact frozen From/To/subject/HTML/text Resend request
-- for a queue event, which does include the recipient's email address
-- and the rendered arrival-email markup (still never letter/Moment/
-- Postcard content — the renderer never receives any of that). It has
-- no RLS policy, no grant to any role, and — unlike arrival_email_
-- queue — is never read by any admin_* RPC either: nothing in this
-- migration ever exposes it to a member or to staff.
--
-- Convention followed throughout (same as every prior checkpoint):
-- SECURITY DEFINER functions use `set search_path to 'pg_catalog'`,
-- every object is fully `public.`-qualified, every new table gets an
-- explicit `revoke all ... from public, anon, authenticated` (Supabase
-- projects grant broad default privileges on table creation — see the
-- Checkpoint 1B note in docs/sql/2026-09-11-safety-blocking-
-- foundation.sql for why this is always done explicitly), and every
-- function gets `revoke all ... from public` then a targeted grant.
--
-- Two authorization shapes are used, matching the two kinds of caller:
--   - Worker-only RPCs (enqueue/claim/resolve/complete): granted to
--     service_role ONLY, never to anon/authenticated. The grant itself
--     is the boundary — Postgres refuses the call outright for any
--     other role — so, unlike the staff-gated RPCs below, these do not
--     also re-check the caller's role inside the function body; there
--     is no such internal check anywhere else in this codebase's
--     RPCs either (grant/revoke is always the sole enforcement for a
--     role-scoped, non-user-scoped function).
--   - Staff-gated RPCs (admin_get_arrival_email_status,
--     set_arrival_email_sending_enabled): granted to `authenticated`
--     (any signed-in user can call them) but each independently
--     re-checks `is_staff()` in its own body, exactly like every other
--     admin_* RPC (see lib/admin.ts's header comment) — the real gate
--     is server-side and inside the function, app/admin/layout.tsx is
--     defense in depth only.
--
-- One BEGIN/COMMIT — this is one coherent, all-or-nothing feature; a
-- partial application would leave the worker unable to run safely.

begin;

-- ============================================================
-- 1. ARRIVAL_EMAIL_PREFERENCES — member opt-out, default enabled
-- ============================================================
-- Mirrors the Reading Interests pattern (lib/profile-interests.ts):
-- RLS grants SELECT of the caller's own row only; every write goes
-- through the RPC below so the row is always keyed by auth.uid(), never
-- a client-supplied user id. No row yet = enabled (see the app-level
-- getter in lib/email-preferences.ts, which treats "no row" as true) —
-- this table only ever needs to exist for members who have changed the
-- default at least once.

create table public.arrival_email_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  arrival_emails_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.arrival_email_preferences enable row level security;

revoke all on public.arrival_email_preferences from public, anon, authenticated;
grant select on public.arrival_email_preferences to authenticated;

create policy arrival_email_preferences_own
  on public.arrival_email_preferences
  for select
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.set_arrival_email_preference(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  insert into public.arrival_email_preferences (user_id, arrival_emails_enabled, updated_at)
  values (auth.uid(), p_enabled, now())
  on conflict (user_id)
  do update set arrival_emails_enabled = excluded.arrival_emails_enabled,
                updated_at = now();
end;
$$;

revoke all on function public.set_arrival_email_preference(boolean) from public;
grant execute on function public.set_arrival_email_preference(boolean) to authenticated;


-- ============================================================
-- 2. ARRIVAL_EMAIL_QUEUE — the durable queue itself
-- ============================================================
-- One row per letter that has ever reached its deliver_at instant.
-- `letter_id` is unique — that uniqueness (plus the anti-join in
-- enqueue_arrival_emails below) IS the duplicate-prevention mechanism:
-- a letter can be enqueued at most once no matter how many overlapping
-- scheduler runs try. No RLS policy is granted to any client role —
-- this table is never read or written directly by anon/authenticated,
-- only by service_role (bypasses RLS) and by the staff-gated
-- admin_get_arrival_email_status() RPC below (SECURITY DEFINER, runs
-- as owner, so needs no policy of its own to see every row).

create table public.arrival_email_queue (
  id uuid primary key default gen_random_uuid(),

  letter_id uuid not null unique references public.letters(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,

  -- 'manual_review' (independent audit correction) is a distinct
  -- terminal outcome from 'failed': it means Resend's own 24-hour
  -- idempotency protection window has elapsed since this event's first
  -- provider attempt without a confirmed outcome, so the worker
  -- refuses to guess and auto-resend — a human needs to check Resend's
  -- own dashboard for this idempotency key before deciding anything.
  -- See record_or_fetch_arrival_email_snapshot and
  -- complete_arrival_email_job below.
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'skipped', 'failed', 'manual_review')),

  attempts int not null default 0,
  max_attempts int not null default 5,
  next_attempt_at timestamptz not null default now(),

  claimed_at timestamptz,
  claimed_by text,
  -- A fresh lease token issued on every claim (including a reclaim of
  -- a stuck 'processing' row). complete_arrival_email_job only ever
  -- applies a completion when BOTH status = 'processing' AND the
  -- caller's token matches this exact value — see that function's own
  -- comment for why (independent audit correction: fences a late/
  -- crashed worker out of completing a job another invocation already
  -- reclaimed).
  claim_token uuid,

  sent_at timestamptz,
  -- Resend's own email id on success — lets Admin correlate a Tempa
  -- queue job with provider acceptance without storing any letter
  -- content (independent audit correction).
  provider_message_id text,
  skipped_reason text,
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index arrival_email_queue_claim_idx
  on public.arrival_email_queue (status, next_attempt_at);

create index arrival_email_queue_updated_at_idx
  on public.arrival_email_queue (updated_at desc);

alter table public.arrival_email_queue enable row level security;

revoke all on public.arrival_email_queue from public, anon, authenticated;
-- Deliberately no policy for any role — see header note above.


-- ============================================================
-- 3. ARRIVAL_EMAIL_SYSTEM_CONFIG — single-row global kill switch +
--    rollout cutover boundary
-- ============================================================
-- `id boolean primary key default true` with a check(id) constraint is
-- the standard singleton-table trick: exactly one row can ever exist.
-- Starts with sending_enabled = false per the launch requirement —
-- nothing sends until a staff admin explicitly flips it on through
-- set_arrival_email_sending_enabled below.
--
-- `enqueue_after` is the rollout/cutover boundary (independent audit
-- correction): without it, the very first enqueue_arrival_emails() run
-- against a live production database would treat every historical
-- letter with deliver_at <= now() — the app's entire pre-existing
-- letter history — as newly "arrived," queuing a backlog of arrival
-- emails for correspondence that in some cases finished long before
-- this feature existed. `default now()` makes this server-authoritative
-- and self-setting: whatever instant this migration is actually
-- applied at becomes the cutover, captured once, in the database,
-- never supplied by a client or an env var. enqueue_arrival_emails()
-- below requires deliver_at >= enqueue_after in addition to
-- deliver_at <= now() — a letter delivered before the system went live
-- can never later generate an arrival email merely because the queue
-- was introduced; a letter delivered at/after that instant is treated
-- normally.

create table public.arrival_email_system_config (
  id boolean primary key default true,
  sending_enabled boolean not null default false,
  enqueue_after timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint arrival_email_system_config_singleton check (id)
);

insert into public.arrival_email_system_config (id, sending_enabled)
values (true, false);

alter table public.arrival_email_system_config enable row level security;

revoke all on public.arrival_email_system_config from public, anon, authenticated;
-- Deliberately no policy for any role — read via
-- admin_get_arrival_email_status(), written via
-- set_arrival_email_sending_enabled(), both staff-gated below.
--
-- The worker (lib/email/arrival-worker.ts) reads this row directly —
-- a plain `.from('arrival_email_system_config').select(...)`, not an
-- RPC — under the service_role key. service_role bypasses RLS, but
-- RLS bypass is not the same thing as holding the SELECT privilege
-- this migration actually intends it to have; without an explicit
-- grant that privilege would only exist by accident, via whatever
-- broad default privileges this Supabase project happens to have
-- bootstrapped onto every new table (see the Checkpoint 1B note
-- referenced in this file's own header) — exactly the kind of implicit
-- dependency this codebase's convention says never to rely on
-- (independent audit correction).
grant select on public.arrival_email_system_config to service_role;


-- ============================================================
-- 4. ENQUEUE_ARRIVAL_EMAILS — worker-only, arrival-triggered
-- ============================================================
-- Enqueues exactly the letters that have actually arrived
-- (deliver_at <= now()), arrived AT OR AFTER the rollout cutover
-- (deliver_at >= arrival_email_system_config.enqueue_after — see that
-- table's own comment; this is the independent-audit fix that keeps a
-- first production run from backlog-queuing the app's entire
-- pre-existing letter history), and have no queue row yet. Never
-- triggered by sender submission — a letter with a future deliver_at
-- (the normal Mail Call case, everything after Letter 1) is invisible
-- to this query until the scheduler runs again after that instant
-- passes. The left join + `q.id is null` is the primary duplicate
-- guard (keeps the query planner from re-scanning already-queued
-- letters every tick); `on conflict (letter_id) do nothing` is the
-- transactional backstop against two overlapping scheduler runs racing
-- this exact statement.

create or replace function public.enqueue_arrival_emails()
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  v_count integer;
  v_cutoff timestamptz;
begin
  select enqueue_after into v_cutoff
  from public.arrival_email_system_config
  where id = true;

  insert into public.arrival_email_queue (letter_id, recipient_id)
  select l.id, l.recipient_id
  from public.letters l
  left join public.arrival_email_queue q on q.letter_id = l.id
  where l.deliver_at <= now()
    and l.deliver_at >= v_cutoff
    and q.id is null
  on conflict (letter_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.enqueue_arrival_emails() from public;
grant execute on function public.enqueue_arrival_emails() to service_role;

-- Supports the anti-join above — letters is a live, already-populated
-- table; a plain (non-CONCURRENT) index is acceptable at current scale
-- but CREATE INDEX takes a brief lock. If letters has grown large by
-- the time this runs, split this one statement into its own
-- CREATE INDEX CONCURRENTLY migration outside this transaction instead
-- (the same split this repo already used for the postcard-artwork
-- Storage migration — see docs/sql/2026-09-21-postcard-admin-and-
-- keepsakes.sql's deployment-history note).
create index if not exists letters_deliver_at_idx on public.letters (deliver_at);


-- ============================================================
-- 5. CLAIM_ARRIVAL_EMAIL_JOBS — worker-only, safe under overlap
-- ============================================================
-- `for update skip locked` is what makes this safe against two
-- overlapping scheduler runs (or a scheduler retry firing before the
-- previous run finished): each run only ever claims rows no other
-- concurrent run has already locked, so the same job is never claimed
-- twice. The second arm of the WHERE clause reclaims a job stuck in
-- 'processing' for more than 15 minutes — a crashed worker (process
-- killed mid-send, function timeout, etc.) never leaves a job stranded
-- forever; it just becomes claimable again like any other retry.
--
-- Every claim — a fresh 'pending' row or a reclaimed stale
-- 'processing' one — gets a brand-new claim_token
-- (gen_random_uuid()). A reclaim therefore always invalidates whatever
-- token the earlier (crashed/slow) worker was holding: that worker's
-- eventual, late complete_arrival_email_job call will present the old
-- token, which no longer matches, and is fenced out as a no-op rather
-- than clobbering the newer claim's outcome (independent audit
-- correction — see complete_arrival_email_job below).

create or replace function public.claim_arrival_email_jobs(
  p_limit integer default 20,
  p_worker text default 'worker'
)
returns setof public.arrival_email_queue
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
begin
  return query
  with claimable as (
    select q.id
    from public.arrival_email_queue q
    where (q.status = 'pending' and q.next_attempt_at <= now())
       or (q.status = 'processing' and q.claimed_at < now() - interval '15 minutes')
    order by q.next_attempt_at
    limit greatest(p_limit, 0)
    for update skip locked
  )
  update public.arrival_email_queue q
  set status = 'processing',
      claimed_at = now(),
      claimed_by = p_worker,
      claim_token = gen_random_uuid(),
      attempts = q.attempts + 1,
      updated_at = now()
  from claimable
  where q.id = claimable.id
  returning q.*;
end;
$$;

revoke all on function public.claim_arrival_email_jobs(integer, text) from public;
grant execute on function public.claim_arrival_email_jobs(integer, text) to service_role;


-- ============================================================
-- 6. RESOLVE_ARRIVAL_EMAIL_CONTEXT — worker-only, send-time revalidation
-- ============================================================
-- Everything the worker needs to decide whether to send, and what to
-- render, resolved FRESH at send time (never trusted from enqueue
-- time — a letter can sit in the queue for a while, e.g. while the
-- kill switch is off, and any of these can change in the meantime).
-- Checked in order, first disqualifier wins:
--   1. recipient's account_enforcement_state must be 'active' (or no
--      row at all, which also means active — see
--      docs/sql/2026-09-11-safety-blocking-foundation.sql, rows are
--      only created once a status other than the implicit default is
--      set).
--   2. no active block between sender and recipient, either direction,
--      either scope ('letters' or 'full') — a 'letters'-scoped block
--      is exactly the case that should suppress this email.
--   3. the recipient has not hidden this correspondence
--      (correspondence_hidden_for_user is a per-participant hide, so
--      this is keyed on the recipient specifically).
--   4. the recipient's own arrival-email preference is not explicitly
--      disabled (no row = enabled, matches the table's default).
--   5. the recipient has a resolvable auth.users.email.
-- Only once all five pass does it resolve sender_pseudonym/
-- sender_country_code and first_contact (from
-- correspondences.established_at — null means this correspondence has
-- never had a reply sent yet, i.e. the recipient has never heard from
-- this sender before; see lib/email/arrival.ts's own doc comment on
-- ArrivalEmailInput.firstContact for why that's the right signal, not
-- letters.reply_to_id, which Write Anytime also leaves null on later
-- letters in an already-established correspondence).

create or replace function public.resolve_arrival_email_context(p_queue_id uuid)
returns table (
  eligible boolean,
  skip_reason text,
  recipient_email text,
  first_contact boolean,
  sender_pseudonym text,
  sender_country_code text
)
language plpgsql
security definer
set search_path to 'pg_catalog'
stable
as $$
declare
  v_letter public.letters;
  v_letter_id uuid;
  v_recipient_id uuid;
  v_recipient_status text;
  v_blocked boolean;
  v_hidden boolean;
  v_pref_enabled boolean;
  v_email text;
  v_pseudonym text;
  v_country text;
  v_established_at timestamptz;
begin
  select q.recipient_id, q.letter_id into v_recipient_id, v_letter_id
  from public.arrival_email_queue q
  where q.id = p_queue_id;

  if not found then
    return query select false, 'queue_row_not_found', null::text, null::boolean, null::text, null::text;
    return;
  end if;

  select * into v_letter from public.letters where id = v_letter_id;

  if not found then
    return query select false, 'letter_not_found', null::text, null::boolean, null::text, null::text;
    return;
  end if;

  select ae.status into v_recipient_status
  from public.account_enforcement_state ae
  where ae.user_id = v_recipient_id;

  if v_recipient_status is not null and v_recipient_status <> 'active' then
    return query select false, 'recipient_account_' || v_recipient_status, null::text, null::boolean, null::text, null::text;
    return;
  end if;

  -- Reuses the existing helper rather than re-deriving block logic here
  -- — it's built exactly for this: "only ever called from inside the
  -- SECURITY DEFINER correspondence RPCs ... which execute under their
  -- owning role and need no EXECUTE grant of their own to call another
  -- function owned by that same role" (its own comment, docs/sql/
  -- 2026-09-12-scoped-blocking-and-fixes.sql). Same "any scope, either
  -- direction" semantics send_first_letter/reply_to_letter/write_letter
  -- already gate new correspondence on.
  select tempa_private.is_correspondence_blocked_pair(v_letter.sender_id, v_letter.recipient_id)
    into v_blocked;

  if v_blocked then
    return query select false, 'blocked', null::text, null::boolean, null::text, null::text;
    return;
  end if;

  select exists (
    select 1 from public.correspondence_hidden_for_user h
    where h.user_id = v_letter.recipient_id
      and h.correspondence_id = v_letter.correspondence_id
  ) into v_hidden;

  if v_hidden then
    return query select false, 'correspondence_hidden', null::text, null::boolean, null::text, null::text;
    return;
  end if;

  select p.arrival_emails_enabled into v_pref_enabled
  from public.arrival_email_preferences p
  where p.user_id = v_letter.recipient_id;

  if v_pref_enabled is false then
    return query select false, 'preference_disabled', null::text, null::boolean, null::text, null::text;
    return;
  end if;

  select u.email into v_email from auth.users u where u.id = v_letter.recipient_id;

  if v_email is null then
    return query select false, 'recipient_email_missing', null::text, null::boolean, null::text, null::text;
    return;
  end if;

  select c.established_at into v_established_at
  from public.correspondences c
  where c.id = v_letter.correspondence_id;

  select pr.pseudonym, pr.country_code into v_pseudonym, v_country
  from public.profiles pr
  where pr.id = v_letter.sender_id;

  return query select
    true,
    null::text,
    v_email,
    (v_established_at is null),
    v_pseudonym,
    v_country;
end;
$$;

revoke all on function public.resolve_arrival_email_context(uuid) from public;
grant execute on function public.resolve_arrival_email_context(uuid) to service_role;


-- ============================================================
-- 7. COMPLETE_ARRIVAL_EMAIL_JOB — worker-only, records the outcome,
--    fenced to the exact claim that is completing it
-- ============================================================
-- Requires BOTH `status = 'processing'` AND `claim_token = p_claim_token`
-- before touching the row at all (independent audit correction). This
-- is what makes claim_arrival_email_jobs' stale-processing reclaim
-- actually safe end to end: without this fence, a worker that claimed
-- a job, stalled past the 15-minute reclaim window, and only THEN
-- finished its (redundant) send could still overwrite whatever the
-- worker that reclaimed and already completed the job had recorded —
-- e.g. stomping a genuine 'sent' back to 'failed', or restarting the
-- backoff clock on a job that already succeeded. With the fence, that
-- late completion call simply finds no row matching both conditions
-- (`not found`) and returns false — a no-op, not a correction. This is
-- defense in depth alongside the provider's own Idempotency-Key (see
-- lib/email/provider.ts) — that key stops Resend from actually sending
-- a second email; this fence stops the stale worker from corrupting
-- this table's bookkeeping about what happened.
--
-- 'sent', 'skipped', and 'manual_review' (independent audit
-- correction — see arrival_email_provider_requests and record_or_
-- fetch_arrival_email_snapshot above) are all terminal. 'failed' is
-- terminal once EITHER attempts has reached max_attempts (claim_
-- arrival_email_jobs already incremented attempts at claim time) OR
-- the caller reports the failure as non-retryable (p_retryable = false
-- — e.g. the provider rejected the request with a 4xx that will never
-- succeed by retrying, such as an invalid recipient address, OR the
-- worker detected the recipient's email changed since the first
-- provider attempt and refused to send under the frozen payload's
-- idempotency key). Otherwise it goes back to 'pending' with an
-- exponential backoff. Backoff formula uses `attempts - 1`
-- (independent audit correction — the previous formula used `attempts`
-- directly, which produced 10m/20m/40m/80m instead of the documented
-- 5m/10m/20m/40m, because attempts is already incremented to 1 by the
-- time the FIRST failure is recorded here): attempts=1 → 5m,
-- attempts=2 → 10m, attempts=3 → 20m, attempts=4 → 40m, before the 5th
-- and final attempt — matching the doc comment, now actually verified
-- by lib/__tests__/simulateArrivalEmailRpcs.ts.

create or replace function public.complete_arrival_email_job(
  p_queue_id uuid,
  p_claim_token uuid,
  p_result text,
  p_error text default null,
  p_provider_message_id text default null,
  p_retryable boolean default true
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  v_job public.arrival_email_queue;
  v_backoff interval;
begin
  if p_result not in ('sent', 'skipped', 'failed', 'manual_review') then
    raise exception 'Invalid result: %', p_result using errcode = '22023';
  end if;

  select * into v_job
  from public.arrival_email_queue
  where id = p_queue_id
    and status = 'processing'
    and claim_token = p_claim_token
  for update;

  if not found then
    return false;
  end if;

  if p_result = 'sent' then
    update public.arrival_email_queue
    set status = 'sent', sent_at = now(), provider_message_id = p_provider_message_id,
        last_error = null, updated_at = now()
    where id = p_queue_id;
  elsif p_result = 'skipped' then
    update public.arrival_email_queue
    set status = 'skipped', skipped_reason = p_error, updated_at = now()
    where id = p_queue_id;
  elsif p_result = 'manual_review' then
    -- Terminal, deliberately never retried automatically — the whole
    -- point is that we no longer trust our own idempotency protection
    -- for this exact request and refuse to guess.
    update public.arrival_email_queue
    set status = 'manual_review', last_error = p_error, updated_at = now()
    where id = p_queue_id;
  else
    if not p_retryable or v_job.attempts >= v_job.max_attempts then
      update public.arrival_email_queue
      set status = 'failed', last_error = p_error, updated_at = now()
      where id = p_queue_id;
    else
      v_backoff := (interval '5 minutes') * power(2, v_job.attempts - 1);
      update public.arrival_email_queue
      set status = 'pending',
          next_attempt_at = now() + v_backoff,
          last_error = p_error,
          updated_at = now()
      where id = p_queue_id;
    end if;
  end if;

  return true;
end;
$$;

revoke all on function public.complete_arrival_email_job(uuid, uuid, text, text, text, boolean) from public;
grant execute on function public.complete_arrival_email_job(uuid, uuid, text, text, text, boolean) to service_role;


-- ============================================================
-- 8. ADMIN_GET_ARRIVAL_EMAIL_STATUS — staff visibility, no content
-- ============================================================
-- Counts by status plus the 50 most recently updated rows. Every
-- column returned is an id, a status/error string, or a timestamp —
-- never a letter body, Moment, or Postcard, and never even a recipient
-- email or sender pseudonym (staff already has admin_get_member for
-- that if a specific letter_id/recipient_id needs following up).
-- provider_message_id is Resend's own id — lets staff correlate a
-- queue row with provider-side delivery logs, still no letter content.

create or replace function public.admin_get_arrival_email_status()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
stable
as $$
declare
  v_result jsonb;
begin
  if not public.is_staff('moderator') then
    raise exception 'Staff access required.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'sendingEnabled', (select sending_enabled from public.arrival_email_system_config where id = true),
    'counts', (
      select coalesce(jsonb_object_agg(s.status, s.cnt), '{}'::jsonb)
      from (
        select status, count(*) as cnt
        from public.arrival_email_queue
        group by status
      ) s
    ),
    'recent', (
      select coalesce(jsonb_agg(r), '[]'::jsonb)
      from (
        select id, letter_id, recipient_id, status, attempts, max_attempts,
               last_error, skipped_reason, provider_message_id, created_at, sent_at, updated_at
        from public.arrival_email_queue
        order by updated_at desc
        limit 50
      ) r
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_get_arrival_email_status() from public;
grant execute on function public.admin_get_arrival_email_status() to authenticated;


-- ============================================================
-- 9. SET_ARRIVAL_EMAIL_SENDING_ENABLED — staff kill switch, audited
-- ============================================================
-- Admin tier (not moderator) — flipping outbound email for the whole
-- member base is a bigger blast radius than the moderator-level read
-- above. Every flip is written to admin_audit_log, matching the
-- pattern every other privileged admin_* RPC already uses (see
-- admin_hide_dispatch in docs/sql/2026-09-10-admin-moderation-and-
-- questions.sql).

create or replace function public.set_arrival_email_sending_enabled(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  v_actor_pseudonym text;
begin
  if not public.is_staff('admin') then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();

  update public.arrival_email_system_config
  set sending_enabled = p_enabled,
      updated_at = now(),
      updated_by = auth.uid()
  where id = true;

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_identifier_snapshot, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text),
    case when p_enabled then 'arrival_email_sending_enabled' else 'arrival_email_sending_disabled' end,
    'system', 'arrival_email_sending',
    jsonb_build_object('enabled', p_enabled)
  );
end;
$$;

revoke all on function public.set_arrival_email_sending_enabled(boolean) from public;
grant execute on function public.set_arrival_email_sending_enabled(boolean) to authenticated;


-- ============================================================
-- 10. ARRIVAL_EMAIL_PROVIDER_REQUESTS — the frozen provider payload
--     (independent audit correction)
-- ============================================================
-- Resend requires the SAME idempotency key AND the SAME request body
-- on every retry — a changed payload under a reused key is exactly
-- what its own 409 invalid_idempotent_request response means. But
-- resolve_arrival_email_context is (deliberately, per Part 6's own
-- comment) re-resolved fresh on every claim, so a retry days apart
-- could see a different sender_pseudonym, a first_contact flip, or a
-- changed recipient email — any of which would change the rendered
-- subject/HTML/text or the To address. This table freezes the exact
-- From/To/subject/HTML/text the FIRST provider attempt used, so every
-- later retry of the same queue event sends byte-for-byte the same
-- request under the same key, no matter what resolve_arrival_email_
-- context returns on that later attempt.
--
-- One row per queue event (queue_id is the primary key — there is
-- structurally no way to freeze two different payloads for the same
-- letter/recipient event). No RLS policy, no grant to any role,
-- content is written and read ONLY through record_or_fetch_arrival_
-- email_snapshot below (service_role only) — never selected directly,
-- never returned by any admin_* or member-facing RPC. It holds the
-- rendered arrival-email HTML and the recipient's email address, which
-- is more sensitive than anything else in this migration's tables even
-- though it is still never letter/Moment/Postcard content.

create table public.arrival_email_provider_requests (
  queue_id uuid primary key references public.arrival_email_queue(id) on delete cascade,
  idempotency_key text not null,
  from_address text not null,
  to_address text not null,
  subject text not null,
  html text not null,
  text_body text not null,
  -- Set once, at INSERT time, by the column default — this IS the
  -- durable "first provider attempt" instant Part 11 below measures
  -- Resend's 24-hour idempotency retention window against. Never
  -- updated after insert.
  first_provider_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.arrival_email_provider_requests enable row level security;

revoke all on public.arrival_email_provider_requests from public, anon, authenticated;
-- Deliberately no policy for any role, and no SELECT grant to
-- service_role either — every access, including the worker's own,
-- goes through record_or_fetch_arrival_email_snapshot (SECURITY
-- DEFINER, runs as owner, needs no grant of its own).


-- ============================================================
-- 11. RECORD_OR_FETCH_ARRIVAL_EMAIL_SNAPSHOT — worker-only, freezes
--     the payload on first use, returns the frozen copy on every
--     retry, fenced to the exact claim requesting it
-- ============================================================
-- Fenced the same way complete_arrival_email_job is (independent audit
-- correction — this function originally had no ownership check at
-- all): requires `id = p_queue_id AND status = 'processing' AND
-- claim_token = p_claim_token`, locked with `for update`, BEFORE any
-- insert or read of the frozen payload. Without this, a worker whose
-- claim had already gone stale and been reclaimed by another
-- invocation (a new claim_token) could still successfully create or
-- fetch a snapshot and proceed all the way to calling Resend — the
-- claim_token fence on complete_arrival_email_job alone only stops the
-- BOOKKEEPING from being corrupted afterward, not the actual duplicate
-- provider call from happening in the first place. Fencing this
-- function closes that gap: an out-of-date caller gets `claim_valid =
-- false` and every other column null, and must stop there — no
-- payload is ever inserted, fetched, or returned to it. See
-- lib/email/arrival-worker.ts: on `claim_valid = false` the worker
-- calls neither sendEmail nor complete_arrival_email_job for that job.
--
-- While holding that locked, still-owned row, `claimed_at` is
-- refreshed to now() before the snapshot is returned — a lease
-- heartbeat taken immediately before the worker's own (bounded, 10s —
-- see lib/email/provider.ts's REQUEST_TIMEOUT_MS) call to Resend. This
-- pushes the 15-minute stale-processing reclaim window in claim_
-- arrival_email_jobs out from THIS instant rather than from whenever
-- the row was originally claimed, so a normal (non-stalled) send can
-- never be reclaimed out from under it mid-flight.
--
-- Otherwise unchanged from before: atomically "insert if this queue
-- event has never been attempted before, otherwise leave the existing
-- row untouched" (ON CONFLICT (queue_id) DO NOTHING), `is_new` reports
-- which case this call got, and `window_expired` is computed server-
-- side against this table's own durable first_provider_attempt_at —
-- now `>=` 24 hours rather than `>` (independent audit correction:
-- Resend guarantees retention for a full 24 hours, not "up to but not
-- including" — once that full window has elapsed, do not keep relying
-- on protection that is no longer guaranteed to still be there).
--
-- Does NOT itself decide whether to send — the worker still does its
-- own fresh eligibility check first (unchanged, Part 6) and its own
-- recipient-email-changed check comparing this call's returned
-- to_address against the just-resolved current recipient email; both
-- of those can still veto sending even after a valid snapshot is
-- returned here.

create or replace function public.record_or_fetch_arrival_email_snapshot(
  p_queue_id uuid,
  p_claim_token uuid,
  p_idempotency_key text,
  p_from text,
  p_to text,
  p_subject text,
  p_html text,
  p_text text
)
returns table (
  claim_valid boolean,
  idempotency_key text,
  from_address text,
  to_address text,
  subject text,
  html text,
  text_body text,
  first_provider_attempt_at timestamptz,
  is_new boolean,
  window_expired boolean
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  v_row_count integer;
  v_locked_id uuid;
begin
  select id into v_locked_id
  from public.arrival_email_queue
  where id = p_queue_id
    and status = 'processing'
    and claim_token = p_claim_token
  for update;

  if not found then
    return query select
      false, null::text, null::text, null::text, null::text, null::text, null::text,
      null::timestamptz, null::boolean, null::boolean;
    return;
  end if;

  insert into public.arrival_email_provider_requests
    (queue_id, idempotency_key, from_address, to_address, subject, html, text_body)
  values
    (p_queue_id, p_idempotency_key, p_from, p_to, p_subject, p_html, p_text)
  on conflict (queue_id) do nothing;

  get diagnostics v_row_count = row_count;

  update public.arrival_email_queue
  set claimed_at = now(), updated_at = now()
  where id = p_queue_id;

  return query
  select
    true,
    r.idempotency_key,
    r.from_address,
    r.to_address,
    r.subject,
    r.html,
    r.text_body,
    r.first_provider_attempt_at,
    (v_row_count > 0) as is_new,
    (now() - r.first_provider_attempt_at >= interval '24 hours') as window_expired
  from public.arrival_email_provider_requests r
  where r.queue_id = p_queue_id;
end;
$$;

revoke all on function public.record_or_fetch_arrival_email_snapshot(uuid, uuid, text, text, text, text, text, text) from public;
grant execute on function public.record_or_fetch_arrival_email_snapshot(uuid, uuid, text, text, text, text, text, text) to service_role;

commit;
