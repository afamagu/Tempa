-- ============================================================
-- TEMPA — PHASE 8: GENTLE REPLY REMINDERS
-- PREPARED 2026-10-05. FORWARD-ONLY; REVIEW/APPLY BEFORE FEATURE USE.
--
-- PURPOSE
-- -------
-- Offer a member, only when they have explicitly opted in, one quiet
-- reminder for a specific established correspondence once the newest
-- incoming substantive Letter has moved strictly beyond that member's
-- effective writing rhythm.
--
-- A reminder is notification state only. It NEVER inserts or updates a
-- Letter, never changes public.correspondences, never changes whose turn
-- it is, never establishes/restores a relationship, and never resets the
-- writing-rhythm clock. A substantive reply remains reciprocity. A Return
-- Card remains evidence of continued intent, not a reply, and suppresses
-- the reminder for that overdue episode.
--
-- CONSENT
-- -------
-- Reply reminders are a separate opt-in from arrival emails. No row means
-- disabled. Email reminders are a second opt-in and cannot be enabled when
-- reminders themselves are disabled.
--
-- FREQUENCY
-- ---------
-- public.reply_reminders.source_letter_id is UNIQUE: there can be only one
-- reminder episode for one waiting Letter. The email job lives on that same
-- row and uses a stable provider idempotency key, so there is at most one
-- provider-accepted email for that episode even across worker retries.
-- ============================================================

begin;

-- ============================================================
-- 1. MEMBER PREFERENCE — explicit opt-in, default OFF
-- ============================================================
create table public.reply_reminder_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reminders_enabled boolean not null default false,
  email_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint reply_reminder_email_requires_reminders
    check (not email_enabled or reminders_enabled)
);

alter table public.reply_reminder_preferences enable row level security;
revoke all on table public.reply_reminder_preferences from public, anon, authenticated;
grant select on table public.reply_reminder_preferences to authenticated;

create policy reply_reminder_preferences_own
  on public.reply_reminder_preferences
  for select
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.set_reply_reminder_preferences(
  p_reminders_enabled boolean,
  p_email_enabled boolean
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if coalesce(p_email_enabled, false) and not coalesce(p_reminders_enabled, false) then
    raise exception 'Email reminders require reply reminders to be enabled.' using errcode = '22023';
  end if;

  insert into public.reply_reminder_preferences (
    user_id, reminders_enabled, email_enabled, updated_at
  ) values (
    auth.uid(),
    coalesce(p_reminders_enabled, false),
    coalesce(p_email_enabled, false),
    now()
  )
  on conflict (user_id)
  do update set
    reminders_enabled = excluded.reminders_enabled,
    email_enabled = excluded.email_enabled,
    updated_at = now();
end;
$function$;

revoke all on function public.set_reply_reminder_preferences(boolean, boolean) from public, anon;
grant execute on function public.set_reply_reminder_preferences(boolean, boolean) to authenticated;


-- ============================================================
-- 2. ONE DURABLE REMINDER EPISODE PER SOURCE LETTER
-- ============================================================
create table public.reply_reminders (
  id uuid primary key default gen_random_uuid(),
  source_letter_id uuid not null unique references public.letters(id) on delete cascade,
  correspondence_id uuid not null references public.correspondences(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  counterpart_id uuid not null references auth.users(id) on delete cascade,
  counterpart_pseudonym_snapshot text not null,
  rhythm_snapshot text not null
    check (rhythm_snapshot in ('few_days', 'one_week', 'two_weeks', 'one_month')),
  created_at timestamptz not null default now(),

  email_status text not null default 'pending'
    check (email_status in ('pending', 'processing', 'sent', 'skipped', 'failed', 'manual_review')),
  email_attempts integer not null default 0,
  email_max_attempts integer not null default 5,
  email_next_attempt_at timestamptz not null default now(),
  email_claimed_at timestamptz,
  email_claimed_by text,
  email_claim_token uuid,
  email_sent_at timestamptz,
  email_provider_message_id text,
  email_last_error text,
  email_skipped_reason text,

  -- Frozen provider payload. A retry under the same idempotency key must
  -- send the same request body as the first provider attempt.
  email_idempotency_key text,
  email_from_address text,
  email_to_address text,
  email_subject text,
  email_html text,
  email_text_body text,
  email_first_provider_attempt_at timestamptz,

  constraint reply_reminders_not_self check (recipient_id <> counterpart_id)
);

create index reply_reminders_recipient_created_idx
  on public.reply_reminders (recipient_id, created_at desc);
create index reply_reminders_email_claim_idx
  on public.reply_reminders (email_status, email_next_attempt_at);

alter table public.reply_reminders enable row level security;
revoke all on table public.reply_reminders from public, anon, authenticated;
-- No direct member policy. Members receive only freshly revalidated rows
-- through get_my_reply_reminders(). Workers use service_role RPCs.


-- ============================================================
-- 3. WORKER ENQUEUE — ONLY CURRENTLY ELIGIBLE OVERDUE EPISODES
-- ============================================================
create or replace function public.enqueue_reply_reminders()
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_count integer;
begin
  with latest as (
    select distinct on (l.correspondence_id)
      l.id,
      l.correspondence_id,
      l.sender_id,
      l.recipient_id,
      l.created_at,
      l.deliver_at
    from public.letters l
    order by l.correspondence_id, l.created_at desc, l.id desc
  ), eligible as (
    select
      l.id as source_letter_id,
      l.correspondence_id,
      l.recipient_id,
      l.sender_id as counterpart_id,
      coalesce(nullif(trim(both from p.pseudonym), ''), 'Your correspondent') as counterpart_pseudonym,
      tempa_private.effective_writing_rhythm(l.correspondence_id, l.recipient_id) as rhythm
    from latest l
    join public.correspondences c on c.id = l.correspondence_id
    join public.reply_reminder_preferences pref
      on pref.user_id = l.recipient_id
     and pref.reminders_enabled
    join public.profiles p on p.id = l.sender_id
    where l.deliver_at <= now()
      and c.status = 'active'
      and c.established_at is not null
      and (c.participant_low = l.recipient_id or c.participant_high = l.recipient_id)
      and (c.participant_low = l.sender_id or c.participant_high = l.sender_id)
      and not exists (
        select 1 from public.return_cards rc where rc.source_letter_id = l.id
      )
      and not exists (
        select 1 from public.account_deactivations d
        where d.user_id in (l.recipient_id, l.sender_id)
          and d.reactivated_at is null
      )
      and not exists (
        select 1 from public.account_closures ac
        where ac.user_id in (l.recipient_id, l.sender_id)
      )
      and not tempa_private.is_correspondence_blocked_pair(l.recipient_id, l.sender_id)
  )
  insert into public.reply_reminders (
    source_letter_id,
    correspondence_id,
    recipient_id,
    counterpart_id,
    counterpart_pseudonym_snapshot,
    rhythm_snapshot
  )
  select
    e.source_letter_id,
    e.correspondence_id,
    e.recipient_id,
    e.counterpart_id,
    e.counterpart_pseudonym,
    e.rhythm
  from eligible e
  where e.rhythm is not null
    and now() > (
      select l.created_at
      from public.letters l
      where l.id = e.source_letter_id
    ) + make_interval(days => tempa_private.writing_rhythm_days(e.rhythm))
  on conflict (source_letter_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.enqueue_reply_reminders() from public, anon, authenticated;
grant execute on function public.enqueue_reply_reminders() to service_role;


-- ============================================================
-- 4. MEMBER READ — FRESHLY REVALIDATED, NEVER STALE
-- ============================================================
create or replace function public.get_my_reply_reminders()
returns table (
  reminder_id uuid,
  source_letter_id uuid,
  correspondence_id uuid,
  counterpart_id uuid,
  counterpart_pseudonym text,
  rhythm text,
  reminded_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if public.current_account_status() is distinct from 'active' then
    return;
  end if;

  return query
  select
    r.id,
    r.source_letter_id,
    r.correspondence_id,
    r.counterpart_id,
    coalesce(nullif(trim(both from p.pseudonym), ''), r.counterpart_pseudonym_snapshot),
    tempa_private.effective_writing_rhythm(r.correspondence_id, v_uid),
    r.created_at
  from public.reply_reminders r
  join public.letters source on source.id = r.source_letter_id
  join public.correspondences c on c.id = r.correspondence_id
  left join public.profiles p on p.id = r.counterpart_id
  join public.reply_reminder_preferences pref
    on pref.user_id = v_uid
   and pref.reminders_enabled
  where r.recipient_id = v_uid
    and source.recipient_id = v_uid
    and source.deliver_at <= now()
    and c.status = 'active'
    and c.established_at is not null
    and not exists (
      select 1 from public.return_cards rc where rc.source_letter_id = source.id
    )
    and not exists (
      select 1 from public.account_deactivations d
      where d.user_id = r.counterpart_id and d.reactivated_at is null
    )
    and not exists (
      select 1 from public.account_closures ac where ac.user_id = r.counterpart_id
    )
    and not tempa_private.is_correspondence_blocked_pair(v_uid, r.counterpart_id)
    and source.id = (
      select l2.id
      from public.letters l2
      where l2.correspondence_id = r.correspondence_id
      order by l2.created_at desc, l2.id desc
      limit 1
    )
    and tempa_private.writing_rhythm_days(
      tempa_private.effective_writing_rhythm(r.correspondence_id, v_uid)
    ) is not null
    and now() > source.created_at + make_interval(
      days => tempa_private.writing_rhythm_days(
        tempa_private.effective_writing_rhythm(r.correspondence_id, v_uid)
      )
    )
  order by r.created_at asc;
end;
$function$;

revoke all on function public.get_my_reply_reminders() from public, anon;
grant execute on function public.get_my_reply_reminders() to authenticated;


-- ============================================================
-- 5. CLAIM EMAIL JOBS — REVALIDATE BEFORE CLAIMING
-- ============================================================
create or replace function public.claim_reply_reminder_email_jobs(
  p_limit integer default 20,
  p_worker text default 'worker'
)
returns setof public.reply_reminders
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  -- Terminally suppress episodes whose relationship event has ended or whose
  -- member consent has been withdrawn. A rhythm that merely became slower is
  -- NOT terminal: leave it pending so it can become eligible later.
  update public.reply_reminders r
  set email_status = 'skipped',
      email_skipped_reason = case
        when coalesce(pref.reminders_enabled, false) = false then 'reminders_disabled'
        when coalesce(pref.email_enabled, false) = false then 'email_disabled'
        when c.id is null or c.status <> 'active' or c.established_at is null then 'correspondence_inactive'
        when source.id is null then 'source_missing'
        when exists (select 1 from public.return_cards rc where rc.source_letter_id = r.source_letter_id) then 'return_card_sent'
        when source.id is distinct from (
          select l2.id from public.letters l2
          where l2.correspondence_id = r.correspondence_id
          order by l2.created_at desc, l2.id desc limit 1
        ) then 'substantive_activity_changed'
        when exists (
          select 1 from public.account_deactivations d
          where d.user_id in (r.recipient_id, r.counterpart_id) and d.reactivated_at is null
        ) then 'account_on_break'
        when exists (
          select 1 from public.account_closures ac
          where ac.user_id in (r.recipient_id, r.counterpart_id)
        ) then 'account_closed'
        when tempa_private.is_correspondence_blocked_pair(r.recipient_id, r.counterpart_id) then 'blocked'
        else 'not_eligible'
      end
  from public.reply_reminder_preferences pref
  left join public.correspondences c on c.id = r.correspondence_id
  left join public.letters source on source.id = r.source_letter_id
  where pref.user_id = r.recipient_id
    and r.email_status in ('pending', 'processing')
    and (
      not pref.reminders_enabled
      or not pref.email_enabled
      or c.id is null
      or c.status <> 'active'
      or c.established_at is null
      or source.id is null
      or exists (select 1 from public.return_cards rc where rc.source_letter_id = r.source_letter_id)
      or source.id is distinct from (
        select l2.id from public.letters l2
        where l2.correspondence_id = r.correspondence_id
        order by l2.created_at desc, l2.id desc limit 1
      )
      or exists (
        select 1 from public.account_deactivations d
        where d.user_id in (r.recipient_id, r.counterpart_id) and d.reactivated_at is null
      )
      or exists (
        select 1 from public.account_closures ac
        where ac.user_id in (r.recipient_id, r.counterpart_id)
      )
      or tempa_private.is_correspondence_blocked_pair(r.recipient_id, r.counterpart_id)
    );

  return query
  with claimable as (
    select r.id
    from public.reply_reminders r
    join public.reply_reminder_preferences pref
      on pref.user_id = r.recipient_id
     and pref.reminders_enabled
     and pref.email_enabled
    join public.letters source on source.id = r.source_letter_id
    join public.correspondences c on c.id = r.correspondence_id
    where (
      (r.email_status = 'pending' and r.email_next_attempt_at <= now())
      or (r.email_status = 'processing' and r.email_claimed_at < now() - interval '15 minutes')
    )
      and r.email_attempts < r.email_max_attempts
      and source.deliver_at <= now()
      and c.status = 'active'
      and c.established_at is not null
      and source.id = (
        select l2.id from public.letters l2
        where l2.correspondence_id = r.correspondence_id
        order by l2.created_at desc, l2.id desc limit 1
      )
      and not exists (select 1 from public.return_cards rc where rc.source_letter_id = r.source_letter_id)
      and not exists (
        select 1 from public.account_deactivations d
        where d.user_id in (r.recipient_id, r.counterpart_id) and d.reactivated_at is null
      )
      and not exists (
        select 1 from public.account_closures ac
        where ac.user_id in (r.recipient_id, r.counterpart_id)
      )
      and not tempa_private.is_correspondence_blocked_pair(r.recipient_id, r.counterpart_id)
      and tempa_private.writing_rhythm_days(
        tempa_private.effective_writing_rhythm(r.correspondence_id, r.recipient_id)
      ) is not null
      and now() > source.created_at + make_interval(
        days => tempa_private.writing_rhythm_days(
          tempa_private.effective_writing_rhythm(r.correspondence_id, r.recipient_id)
        )
      )
    order by r.email_next_attempt_at, r.created_at
    limit greatest(p_limit, 0)
    for update of r skip locked
  )
  update public.reply_reminders r
  set email_status = 'processing',
      email_claimed_at = now(),
      email_claimed_by = p_worker,
      email_claim_token = gen_random_uuid(),
      email_attempts = r.email_attempts + 1
  from claimable
  where r.id = claimable.id
  returning r.*;
end;
$function$;

revoke all on function public.claim_reply_reminder_email_jobs(integer, text) from public, anon, authenticated;
grant execute on function public.claim_reply_reminder_email_jobs(integer, text) to service_role;


-- ============================================================
-- 6. SEND-TIME CONTEXT — AUTHORITATIVE REVALIDATION
-- ============================================================
create or replace function public.resolve_reply_reminder_email_context(
  p_reminder_id uuid,
  p_claim_token uuid
)
returns table (
  claim_valid boolean,
  eligible boolean,
  skip_reason text,
  recipient_email text,
  counterpart_pseudonym text,
  rhythm text
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_r public.reply_reminders;
  v_source public.letters;
  v_corr public.correspondences;
  v_pref public.reply_reminder_preferences;
  v_rhythm text;
begin
  select * into v_r from public.reply_reminders r where r.id = p_reminder_id;
  if not found or v_r.email_status <> 'processing' or v_r.email_claim_token is distinct from p_claim_token then
    return query select false, false, 'claim_lost'::text, null::text, null::text, null::text;
    return;
  end if;

  select * into v_source from public.letters l where l.id = v_r.source_letter_id;
  select * into v_corr from public.correspondences c where c.id = v_r.correspondence_id;
  select * into v_pref from public.reply_reminder_preferences p where p.user_id = v_r.recipient_id;
  v_rhythm := tempa_private.effective_writing_rhythm(v_r.correspondence_id, v_r.recipient_id);

  if v_source.id is null
     or v_corr.id is null
     or not coalesce(v_pref.reminders_enabled, false)
     or not coalesce(v_pref.email_enabled, false)
     or v_corr.status <> 'active'
     or v_corr.established_at is null
     or v_source.deliver_at > now()
     or v_source.id is distinct from (
       select l2.id from public.letters l2
       where l2.correspondence_id = v_r.correspondence_id
       order by l2.created_at desc, l2.id desc limit 1
     )
     or exists (select 1 from public.return_cards rc where rc.source_letter_id = v_r.source_letter_id)
     or exists (
       select 1 from public.account_deactivations d
       where d.user_id in (v_r.recipient_id, v_r.counterpart_id) and d.reactivated_at is null
     )
     or exists (
       select 1 from public.account_closures ac
       where ac.user_id in (v_r.recipient_id, v_r.counterpart_id)
     )
     or tempa_private.is_correspondence_blocked_pair(v_r.recipient_id, v_r.counterpart_id)
     or tempa_private.writing_rhythm_days(v_rhythm) is null
     or now() <= v_source.created_at + make_interval(days => tempa_private.writing_rhythm_days(v_rhythm)) then
    return query select true, false, 'not_eligible'::text, null::text, null::text, v_rhythm;
    return;
  end if;

  return query
  select
    true,
    true,
    null::text,
    u.email::text,
    coalesce(nullif(trim(both from p.pseudonym), ''), v_r.counterpart_pseudonym_snapshot),
    v_rhythm
  from auth.users u
  left join public.profiles p on p.id = v_r.counterpart_id
  where u.id = v_r.recipient_id;
end;
$function$;

revoke all on function public.resolve_reply_reminder_email_context(uuid, uuid) from public, anon, authenticated;
grant execute on function public.resolve_reply_reminder_email_context(uuid, uuid) to service_role;


-- ============================================================
-- 7. FREEZE/FETCH PROVIDER PAYLOAD — CLAIM-FENCED
-- ============================================================
create or replace function public.record_or_fetch_reply_reminder_email_snapshot(
  p_reminder_id uuid,
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
as $function$
declare
  v_existing public.reply_reminders;
  v_is_new boolean := false;
begin
  select * into v_existing
  from public.reply_reminders r
  where r.id = p_reminder_id
  for update;

  if not found
     or v_existing.email_status <> 'processing'
     or v_existing.email_claim_token is distinct from p_claim_token then
    return query select false, null::text, null::text, null::text, null::text,
      null::text, null::text, null::timestamptz, false, false;
    return;
  end if;

  if v_existing.email_idempotency_key is null then
    update public.reply_reminders r
    set email_idempotency_key = p_idempotency_key,
        email_from_address = p_from,
        email_to_address = p_to,
        email_subject = p_subject,
        email_html = p_html,
        email_text_body = p_text,
        email_first_provider_attempt_at = now()
    where r.id = p_reminder_id;
    v_is_new := true;

    select * into v_existing from public.reply_reminders r where r.id = p_reminder_id;
  end if;

  return query select
    true,
    v_existing.email_idempotency_key,
    v_existing.email_from_address,
    v_existing.email_to_address,
    v_existing.email_subject,
    v_existing.email_html,
    v_existing.email_text_body,
    v_existing.email_first_provider_attempt_at,
    v_is_new,
    (v_existing.email_first_provider_attempt_at is not null
      and now() > v_existing.email_first_provider_attempt_at + interval '24 hours');
end;
$function$;

revoke all on function public.record_or_fetch_reply_reminder_email_snapshot(uuid, uuid, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_or_fetch_reply_reminder_email_snapshot(uuid, uuid, text, text, text, text, text, text)
  to service_role;


-- ============================================================
-- 8. COMPLETE EMAIL JOB — CLAIM-FENCED, BOUNDED RETRY
-- ============================================================
create or replace function public.complete_reply_reminder_email_job(
  p_reminder_id uuid,
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
as $function$
declare
  v_attempts integer;
  v_max integer;
begin
  if p_result not in ('sent', 'skipped', 'failed', 'manual_review') then
    raise exception 'Invalid completion result.' using errcode = '22023';
  end if;

  select r.email_attempts, r.email_max_attempts into v_attempts, v_max
  from public.reply_reminders r
  where r.id = p_reminder_id
    and r.email_status = 'processing'
    and r.email_claim_token = p_claim_token
  for update;

  if not found then return false; end if;

  if p_result = 'sent' then
    update public.reply_reminders
    set email_status = 'sent',
        email_sent_at = now(),
        email_provider_message_id = p_provider_message_id,
        email_last_error = null,
        email_claim_token = null
    where id = p_reminder_id;
  elsif p_result = 'skipped' then
    update public.reply_reminders
    set email_status = 'skipped',
        email_skipped_reason = left(coalesce(p_error, 'not_eligible'), 500),
        email_claim_token = null
    where id = p_reminder_id;
  elsif p_result = 'manual_review' then
    update public.reply_reminders
    set email_status = 'manual_review',
        email_last_error = left(coalesce(p_error, 'manual review required'), 500),
        email_claim_token = null
    where id = p_reminder_id;
  elsif p_retryable and v_attempts < v_max then
    update public.reply_reminders
    set email_status = 'pending',
        email_last_error = left(coalesce(p_error, 'provider failure'), 500),
        email_next_attempt_at = now() + make_interval(mins => least(60, greatest(5, v_attempts * 10))),
        email_claim_token = null
    where id = p_reminder_id;
  else
    update public.reply_reminders
    set email_status = 'failed',
        email_last_error = left(coalesce(p_error, 'provider failure'), 500),
        email_claim_token = null
    where id = p_reminder_id;
  end if;

  return true;
end;
$function$;

revoke all on function public.complete_reply_reminder_email_job(uuid, uuid, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.complete_reply_reminder_email_job(uuid, uuid, text, text, text, boolean)
  to service_role;

commit;

-- ============================================================
-- READ-ONLY VERIFICATION
-- ============================================================
select
  to_regclass('public.reply_reminder_preferences') is not null as preference_table_exists,
  to_regclass('public.reply_reminders') is not null as reminders_table_exists,
  to_regprocedure('public.set_reply_reminder_preferences(boolean,boolean)') is not null as setter_exists,
  to_regprocedure('public.get_my_reply_reminders()') is not null as member_read_exists,
  to_regprocedure('public.enqueue_reply_reminders()') is not null as enqueue_exists,
  to_regprocedure('public.claim_reply_reminder_email_jobs(integer,text)') is not null as claim_exists,
  to_regprocedure('public.resolve_reply_reminder_email_context(uuid,uuid)') is not null as context_exists,
  to_regprocedure('public.record_or_fetch_reply_reminder_email_snapshot(uuid,uuid,text,text,text,text,text,text)') is not null as snapshot_exists,
  to_regprocedure('public.complete_reply_reminder_email_job(uuid,uuid,text,text,text,boolean)') is not null as complete_exists,
  not has_table_privilege('authenticated', 'public.reply_reminders', 'SELECT') as reminders_not_directly_readable,
  not has_table_privilege('authenticated', 'public.reply_reminders', 'INSERT') as reminders_not_directly_insertable,
  has_function_privilege('authenticated', 'public.get_my_reply_reminders()', 'EXECUTE') as member_can_read_via_rpc,
  has_function_privilege('service_role', 'public.enqueue_reply_reminders()', 'EXECUTE') as worker_can_enqueue;
