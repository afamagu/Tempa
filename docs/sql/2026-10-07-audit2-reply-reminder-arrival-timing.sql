-- ============================================================
-- TEMPA — AUDIT 2: ARRIVAL-BASED REPLY RHYTHM + EMAIL AVAILABILITY
-- PREPARED 2026-10-07. FORWARD-ONLY.
--
-- HOSTILE-AUDIT FINDINGS
-- ----------------------
-- 1. A recipient's chosen writing rhythm was measured from created_at even
--    though Letter 2+ may spend hours in Mail Call before deliver_at.
--    Time before arrival must never count as "late replying."
-- 2. The member settings UI exposed "Email the reminder too" while the
--    operational provider kill switch intentionally remained OFF.
--
-- This migration:
-- * changes every authoritative reminder eligibility/revalidation clock from
--   source.created_at to source.deliver_at;
-- * exposes only the coarse operational availability boolean to the signed-in
--   member so settings can tell the truth;
-- * DOES NOT turn the email kill switch on.
-- ============================================================

begin;

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
      tempa_private.effective_writing_rhythm(l.correspondence_id, l.recipient_id) as rhythm,
      l.deliver_at
    from latest l
    join public.correspondences c on c.id = l.correspondence_id
    left join public.reply_reminder_preferences pref
      on pref.user_id = l.recipient_id
    left join public.profiles p on p.id = l.sender_id
    where coalesce(pref.reminders_enabled, true)
      and l.deliver_at <= now()
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
    and now() > e.deliver_at + make_interval(
      days => tempa_private.writing_rhythm_days(e.rhythm)
    )
  on conflict (source_letter_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.enqueue_reply_reminders() from public, anon, authenticated;
grant execute on function public.enqueue_reply_reminders() to service_role;

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
  left join public.reply_reminder_preferences pref
    on pref.user_id = v_uid
  where coalesce(pref.reminders_enabled, true)
    and r.recipient_id = v_uid
    and source.recipient_id = v_uid
    and source.deliver_at <= now()
    and c.status = 'active'
    and c.established_at is not null
    and not exists (
      select 1 from public.return_cards rc where rc.source_letter_id = source.id
    )
    and not exists (
      select 1 from public.account_deactivations d
      where d.user_id in (v_uid, r.counterpart_id) and d.reactivated_at is null
    )
    and not exists (
      select 1 from public.account_closures ac
      where ac.user_id in (v_uid, r.counterpart_id)
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
    and now() > source.deliver_at + make_interval(
      days => tempa_private.writing_rhythm_days(
        tempa_private.effective_writing_rhythm(r.correspondence_id, v_uid)
      )
    )
  order by r.created_at asc;
end;
$function$;

revoke all on function public.get_my_reply_reminders() from public, anon;
grant execute on function public.get_my_reply_reminders() to authenticated;

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
  update public.reply_reminders r
  set email_status = 'skipped',
      email_skipped_reason = case
        when exists (
          select 1 from public.reply_reminder_preferences pref
          where pref.user_id = r.recipient_id and not pref.reminders_enabled
        ) then 'reminders_disabled'
        when exists (
          select 1 from public.reply_reminder_preferences pref
          where pref.user_id = r.recipient_id and not pref.email_enabled
        ) then 'email_disabled'
        when not exists (
          select 1 from public.correspondences c
          where c.id = r.correspondence_id
            and c.status = 'active'
            and c.established_at is not null
        ) then 'correspondence_inactive'
        when not exists (
          select 1 from public.letters source where source.id = r.source_letter_id
        ) then 'source_missing'
        when exists (
          select 1 from public.return_cards rc where rc.source_letter_id = r.source_letter_id
        ) then 'return_card_sent'
        when r.source_letter_id is distinct from (
          select l2.id from public.letters l2
          where l2.correspondence_id = r.correspondence_id
          order by l2.created_at desc, l2.id desc limit 1
        ) then 'substantive_activity_changed'
        when exists (
          select 1 from public.account_deactivations d
          where d.user_id in (r.recipient_id, r.counterpart_id)
            and d.reactivated_at is null
        ) then 'account_on_break'
        when exists (
          select 1 from public.account_closures ac
          where ac.user_id in (r.recipient_id, r.counterpart_id)
        ) then 'account_closed'
        when tempa_private.is_correspondence_blocked_pair(r.recipient_id, r.counterpart_id)
          then 'blocked'
        else 'not_eligible'
      end,
      email_claim_token = null
  where r.email_status in ('pending', 'processing')
    and (
      exists (
        select 1 from public.reply_reminder_preferences pref
        where pref.user_id = r.recipient_id
          and (not pref.reminders_enabled or not pref.email_enabled)
      )
      or not exists (
        select 1 from public.correspondences c
        where c.id = r.correspondence_id
          and c.status = 'active'
          and c.established_at is not null
      )
      or not exists (
        select 1 from public.letters source where source.id = r.source_letter_id
      )
      or exists (
        select 1 from public.return_cards rc where rc.source_letter_id = r.source_letter_id
      )
      or r.source_letter_id is distinct from (
        select l2.id from public.letters l2
        where l2.correspondence_id = r.correspondence_id
        order by l2.created_at desc, l2.id desc limit 1
      )
      or exists (
        select 1 from public.account_deactivations d
        where d.user_id in (r.recipient_id, r.counterpart_id)
          and d.reactivated_at is null
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
    left join public.reply_reminder_preferences pref
      on pref.user_id = r.recipient_id
    join public.letters source on source.id = r.source_letter_id
    join public.correspondences c on c.id = r.correspondence_id
    where coalesce(pref.reminders_enabled, true)
      and coalesce(pref.email_enabled, true)
      and (
        (r.email_status = 'pending' and r.email_next_attempt_at <= now())
        or (r.email_status = 'processing' and r.email_claimed_at < now() - interval '15 minutes')
      )
      and r.email_attempts < r.email_max_attempts
      and source.deliver_at <= now()
      and c.status = 'active'
      and c.established_at is not null
      and source.recipient_id = r.recipient_id
      and source.id = (
        select l2.id from public.letters l2
        where l2.correspondence_id = r.correspondence_id
        order by l2.created_at desc, l2.id desc limit 1
      )
      and not exists (
        select 1 from public.return_cards rc where rc.source_letter_id = r.source_letter_id
      )
      and not exists (
        select 1 from public.account_deactivations d
        where d.user_id in (r.recipient_id, r.counterpart_id)
          and d.reactivated_at is null
      )
      and not exists (
        select 1 from public.account_closures ac
        where ac.user_id in (r.recipient_id, r.counterpart_id)
      )
      and not tempa_private.is_correspondence_blocked_pair(r.recipient_id, r.counterpart_id)
      and tempa_private.writing_rhythm_days(
        tempa_private.effective_writing_rhythm(r.correspondence_id, r.recipient_id)
      ) is not null
      and now() > source.deliver_at + make_interval(
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
      email_claimed_by = left(coalesce(p_worker, 'worker'), 120),
      email_claim_token = gen_random_uuid(),
      email_attempts = r.email_attempts + 1
  from claimable
  where r.id = claimable.id
  returning r.*;
end;
$function$;

revoke all on function public.claim_reply_reminder_email_jobs(integer, text)
  from public, anon, authenticated;
grant execute on function public.claim_reply_reminder_email_jobs(integer, text)
  to service_role;

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
  select * into v_r
  from public.reply_reminders r
  where r.id = p_reminder_id;

  if not found
     or v_r.email_status <> 'processing'
     or v_r.email_claim_token is distinct from p_claim_token then
    return query
      select false, false, 'claim_lost'::text, null::text, null::text, null::text;
    return;
  end if;

  select * into v_source from public.letters l where l.id = v_r.source_letter_id;
  select * into v_corr from public.correspondences c where c.id = v_r.correspondence_id;
  select * into v_pref from public.reply_reminder_preferences p where p.user_id = v_r.recipient_id;
  v_rhythm := tempa_private.effective_writing_rhythm(v_r.correspondence_id, v_r.recipient_id);

  if v_source.id is null
     or v_corr.id is null
     or (v_pref.user_id is not null and not v_pref.reminders_enabled)
     or (v_pref.user_id is not null and not v_pref.email_enabled)
     or v_corr.status <> 'active'
     or v_corr.established_at is null
     or v_source.recipient_id <> v_r.recipient_id
     or v_source.deliver_at > now()
     or v_source.id is distinct from (
       select l2.id from public.letters l2
       where l2.correspondence_id = v_r.correspondence_id
       order by l2.created_at desc, l2.id desc limit 1
     )
     or exists (
       select 1 from public.return_cards rc where rc.source_letter_id = v_r.source_letter_id
     )
     or exists (
       select 1 from public.account_deactivations d
       where d.user_id in (v_r.recipient_id, v_r.counterpart_id)
         and d.reactivated_at is null
     )
     or exists (
       select 1 from public.account_closures ac
       where ac.user_id in (v_r.recipient_id, v_r.counterpart_id)
     )
     or tempa_private.is_correspondence_blocked_pair(v_r.recipient_id, v_r.counterpart_id)
     or tempa_private.writing_rhythm_days(v_rhythm) is null
     or now() <= v_source.deliver_at + make_interval(
       days => tempa_private.writing_rhythm_days(v_rhythm)
     ) then
    return query
      select true, false, 'not_eligible'::text, null::text, null::text, v_rhythm;
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

revoke all on function public.resolve_reply_reminder_email_context(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_reply_reminder_email_context(uuid, uuid)
  to service_role;

create or replace function public.reply_reminder_email_delivery_available()
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_uid uuid := auth.uid();
  v_enabled boolean;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select c.sending_enabled
  into v_enabled
  from public.reply_reminder_system_config c
  where c.id = true;

  return coalesce(v_enabled, false);
end;
$function$;

revoke all on function public.reply_reminder_email_delivery_available()
  from public, anon;
grant execute on function public.reply_reminder_email_delivery_available()
  to authenticated;

comment on function public.reply_reminder_email_delivery_available() is
  'Authenticated coarse availability only: whether the reply-reminder email provider channel is operationally enabled. Exposes no provider/config details.';

commit;


-- ============================================================
-- READ-ONLY VERIFICATION — EVERY BOOLEAN SHOULD BE TRUE
-- ============================================================

select
  position(
    'e.deliver_at + make_interval'
    in lower(pg_get_functiondef('public.enqueue_reply_reminders()'::regprocedure))
  ) > 0
  and position(
    'e.created_at + make_interval'
    in lower(pg_get_functiondef('public.enqueue_reply_reminders()'::regprocedure))
  ) = 0
    as enqueue_rhythm_starts_at_arrival,

  position(
    'source.deliver_at + make_interval'
    in lower(pg_get_functiondef('public.get_my_reply_reminders()'::regprocedure))
  ) > 0
  and position(
    'source.created_at + make_interval'
    in lower(pg_get_functiondef('public.get_my_reply_reminders()'::regprocedure))
  ) = 0
    as member_read_rhythm_starts_at_arrival,

  position(
    'source.deliver_at + make_interval'
    in lower(pg_get_functiondef('public.claim_reply_reminder_email_jobs(integer,text)'::regprocedure))
  ) > 0
  and position(
    'source.created_at + make_interval'
    in lower(pg_get_functiondef('public.claim_reply_reminder_email_jobs(integer,text)'::regprocedure))
  ) = 0
    as email_claim_rhythm_starts_at_arrival,

  position(
    'v_source.deliver_at + make_interval'
    in lower(pg_get_functiondef('public.resolve_reply_reminder_email_context(uuid,uuid)'::regprocedure))
  ) > 0
  and position(
    'v_source.created_at + make_interval'
    in lower(pg_get_functiondef('public.resolve_reply_reminder_email_context(uuid,uuid)'::regprocedure))
  ) = 0
    as send_time_rhythm_starts_at_arrival,

  to_regprocedure('public.reply_reminder_email_delivery_available()') is not null
    as email_availability_rpc_ready,

  has_function_privilege(
    'authenticated',
    'public.reply_reminder_email_delivery_available()',
    'EXECUTE'
  )
    as authenticated_can_read_email_availability,

  not has_function_privilege(
    'anon',
    'public.reply_reminder_email_delivery_available()',
    'EXECUTE'
  )
    as anon_cannot_read_email_availability,

  position(
    'reply_reminder_system_config'
    in lower(pg_get_functiondef('public.reply_reminder_email_delivery_available()'::regprocedure))
  ) > 0
    as availability_reuses_operational_kill_switch;
