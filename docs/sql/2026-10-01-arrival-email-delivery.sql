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

  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'skipped', 'failed')),

  attempts int not null default 0,
  max_attempts int not null default 5,
  next_attempt_at timestamptz not null default now(),

  claimed_at timestamptz,
  claimed_by text,

  sent_at timestamptz,
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
-- 3. ARRIVAL_EMAIL_SYSTEM_CONFIG — single-row global kill switch
-- ============================================================
-- `id boolean primary key default true` with a check(id) constraint is
-- the standard singleton-table trick: exactly one row can ever exist.
-- Starts with sending_enabled = false per the launch requirement —
-- nothing sends until a staff admin explicitly flips it on through
-- set_arrival_email_sending_enabled below.

create table public.arrival_email_system_config (
  id boolean primary key default true,
  sending_enabled boolean not null default false,
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
-- service_role reads the row directly (bypasses RLS) before sending.


-- ============================================================
-- 4. ENQUEUE_ARRIVAL_EMAILS — worker-only, arrival-triggered
-- ============================================================
-- Enqueues exactly the letters that have actually arrived
-- (deliver_at <= now()) and have no queue row yet. Never triggered by
-- sender submission — a letter with a future deliver_at (the normal
-- Mail Call case, everything after Letter 1) is invisible to this
-- query until the scheduler runs again after that instant passes.
-- The left join + `q.id is null` is the primary duplicate guard (keeps
-- the query planner from re-scanning already-queued letters every
-- tick); `on conflict (letter_id) do nothing` is the transactional
-- backstop against two overlapping scheduler runs racing this exact
-- statement.

create or replace function public.enqueue_arrival_emails()
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  v_count integer;
begin
  insert into public.arrival_email_queue (letter_id, recipient_id)
  select l.id, l.recipient_id
  from public.letters l
  left join public.arrival_email_queue q on q.letter_id = l.id
  where l.deliver_at <= now()
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
-- 7. COMPLETE_ARRIVAL_EMAIL_JOB — worker-only, records the outcome
-- ============================================================
-- 'sent' and 'skipped' are terminal. 'failed' is terminal only once
-- attempts has reached max_attempts (claim_arrival_email_jobs already
-- incremented attempts at claim time) — otherwise it goes back to
-- 'pending' with an exponential backoff (5m, 10m, 20m, 40m before the
-- 5th and final attempt), so a transient provider outage retries
-- itself without manual intervention, and a permanently-failing job
-- still stops retrying instead of looping forever.

create or replace function public.complete_arrival_email_job(
  p_queue_id uuid,
  p_result text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  v_job public.arrival_email_queue;
  v_backoff interval;
begin
  if p_result not in ('sent', 'skipped', 'failed') then
    raise exception 'Invalid result: %', p_result using errcode = '22023';
  end if;

  select * into v_job from public.arrival_email_queue where id = p_queue_id for update;
  if not found then
    return;
  end if;

  if p_result = 'sent' then
    update public.arrival_email_queue
    set status = 'sent', sent_at = now(), last_error = null, updated_at = now()
    where id = p_queue_id;
  elsif p_result = 'skipped' then
    update public.arrival_email_queue
    set status = 'skipped', skipped_reason = p_error, updated_at = now()
    where id = p_queue_id;
  else
    if v_job.attempts >= v_job.max_attempts then
      update public.arrival_email_queue
      set status = 'failed', last_error = p_error, updated_at = now()
      where id = p_queue_id;
    else
      v_backoff := (interval '5 minutes') * power(2, v_job.attempts);
      update public.arrival_email_queue
      set status = 'pending',
          next_attempt_at = now() + v_backoff,
          last_error = p_error,
          updated_at = now()
      where id = p_queue_id;
    end if;
  end if;
end;
$$;

revoke all on function public.complete_arrival_email_job(uuid, text, text) from public;
grant execute on function public.complete_arrival_email_job(uuid, text, text) to service_role;


-- ============================================================
-- 8. ADMIN_GET_ARRIVAL_EMAIL_STATUS — staff visibility, no content
-- ============================================================
-- Counts by status plus the 50 most recently updated rows. Every
-- column returned is an id, a status/error string, or a timestamp —
-- never a letter body, Moment, or Postcard, and never even a recipient
-- email or sender pseudonym (staff already has admin_get_member for
-- that if a specific letter_id/recipient_id needs following up).

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
               last_error, skipped_reason, created_at, sent_at, updated_at
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

commit;
