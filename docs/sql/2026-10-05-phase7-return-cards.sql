-- ============================================================
-- TEMPA — PHASE 7: RETURN CARDS
-- PREPARED 2026-10-05. FORWARD-ONLY; REVIEW/APPLY BEFORE APP DEPLOY.
--
-- PURPOSE
-- -------
-- A Return Card is a lightweight sign from the person who currently owes
-- the next substantive letter: "I'm still here." It is available only
-- after an established correspondence's latest incoming letter has moved
-- beyond that member's own declared writing rhythm.
--
-- NON-NEGOTIABLE INVARIANT
-- ------------------------
-- A Return Card is NOT a reply and cannot establish, restore, reactivate,
-- or advance a correspondence. Sending one:
--   * inserts NO public.letters row;
--   * updates NO public.letters status/replied_at field;
--   * updates NO public.correspondences field (including established_at);
--   * does not change whose substantive turn it is;
--   * does not reset the writing-rhythm clock.
-- A later substantive Letter remains the reciprocity event.
--
-- ELIGIBILITY
-- -----------
-- The source letter must still be the newest substantive letter in the
-- active, already-established correspondence; it must be addressed to the
-- caller and already delivered; the caller must have a non-null effective
-- writing rhythm and now() must be STRICTLY beyond source.created_at plus
-- that rhythm's 4/7/14/30-day horizon. One Return Card maximum per source
-- letter. The send RPC additionally enforces correspondence blocking and
-- account/break state server-side.
--
-- POSTCARDS / COMMERCE
-- --------------------
-- Return Cards reuse the canonical postcard_catalog/postcard_versions
-- artwork and freeze the exact CURRENT immutable version at Send. This
-- relationship bridge is never a Credit-spend path: only a currently
-- published Complimentary Postcard product may be selected.
-- ============================================================

begin;

create table public.return_cards (
  id uuid primary key default gen_random_uuid(),
  correspondence_id uuid not null references public.correspondences(id) on delete cascade,
  source_letter_id uuid not null unique references public.letters(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  postcard_version_id uuid not null references public.postcard_versions(id),
  message text,
  sender_pseudonym_snapshot text not null,
  sent_at timestamptz not null default now(),
  constraint return_cards_no_self_send check (sender_id <> recipient_id),
  constraint return_cards_message_length check (
    message is null or char_length(trim(both from message)) between 1 and 200
  )
);

create index return_cards_correspondence_sent_idx
  on public.return_cards (correspondence_id, sent_at desc);

alter table public.return_cards enable row level security;

create policy return_cards_select_participant
  on public.return_cards
  for select
  to authenticated
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

revoke all on table public.return_cards from public, anon, authenticated;
grant select on table public.return_cards to authenticated;

-- Quiet UI offer check. Deliberately does not call the private block helper,
-- so it cannot become a "did they block me?" oracle. The send RPC below
-- remains the authoritative Safety boundary.
create or replace function public.return_card_available(
  p_source_letter_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_uid uuid := auth.uid();
  v_source public.letters;
  v_corr public.correspondences;
  v_latest_id uuid;
  v_rhythm text;
  v_days integer;
  v_other uuid;
begin
  if v_uid is null then return false; end if;

  select l.* into v_source
  from public.letters l
  where l.id = p_source_letter_id
    and l.recipient_id = v_uid
    and l.deliver_at <= now();
  if not found then return false; end if;

  select c.* into v_corr
  from public.correspondences c
  where c.id = v_source.correspondence_id
    and c.status = 'active'
    and c.established_at is not null
    and (c.participant_low = v_uid or c.participant_high = v_uid);
  if not found then return false; end if;

  if public.current_account_status() is distinct from 'active' then return false; end if;

  v_other := case
    when v_corr.participant_low = v_uid then v_corr.participant_high
    else v_corr.participant_low
  end;

  if exists (
    select 1 from public.account_deactivations d
    where d.user_id = v_other and d.reactivated_at is null
  ) or exists (
    select 1 from public.account_closures c where c.user_id = v_other
  ) then
    return false;
  end if;

  -- Newest substantive activity wins, including a newer outgoing Letter
  -- that may still be in transit. A Return Card never rewinds the turn.
  select l.id into v_latest_id
  from public.letters l
  where l.correspondence_id = v_corr.id
  order by l.created_at desc, l.id desc
  limit 1;

  if v_latest_id is distinct from v_source.id then return false; end if;

  if exists (
    select 1 from public.return_cards rc
    where rc.source_letter_id = v_source.id
  ) then
    return false;
  end if;

  v_rhythm := tempa_private.effective_writing_rhythm(v_corr.id, v_uid);
  v_days := tempa_private.writing_rhythm_days(v_rhythm);
  if v_days is null then return false; end if;

  -- Equality remains "within" exactly like lib/writing-rhythm.ts.
  return now() > v_source.created_at + make_interval(days => v_days);
end;
$function$;

revoke all on function public.return_card_available(uuid) from public, anon;
grant execute on function public.return_card_available(uuid) to authenticated;

create or replace function public.send_return_card(
  p_source_letter_id uuid,
  p_postcard_key text,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_uid uuid := auth.uid();
  v_source public.letters;
  v_corr public.correspondences;
  v_other uuid;
  v_latest_id uuid;
  v_rhythm text;
  v_days integer;
  v_postcard_key text;
  v_postcard_version_id uuid;
  v_message text;
  v_sender_pseudonym text;
  v_return_card_id uuid;
begin
  if v_uid is null then
    raise exception 'Return Card is not available.' using errcode = '42501';
  end if;

  -- Same source->correspondence lock order as reply_to_letter.
  select l.* into v_source
  from public.letters l
  where l.id = p_source_letter_id
    and l.recipient_id = v_uid
    and l.deliver_at <= now()
  for update;
  if not found then
    raise exception 'Return Card is not available.' using errcode = 'P0002';
  end if;

  select c.* into v_corr
  from public.correspondences c
  where c.id = v_source.correspondence_id
  for update;

  if not found
     or v_corr.status <> 'active'
     or v_corr.established_at is null
     or (v_corr.participant_low <> v_uid and v_corr.participant_high <> v_uid) then
    raise exception 'Return Card is not available.' using errcode = 'P0002';
  end if;

  v_other := case
    when v_corr.participant_low = v_uid then v_corr.participant_high
    else v_corr.participant_low
  end;

  if public.current_account_status() is distinct from 'active' then
    raise exception 'Return Card is not available.' using errcode = '42501';
  end if;

  if tempa_private.is_correspondence_blocked_pair(v_uid, v_other) then
    raise exception 'Return Card is not available.' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.account_deactivations d
    where d.user_id = v_other and d.reactivated_at is null
  ) or exists (
    select 1 from public.account_closures c where c.user_id = v_other
  ) then
    raise exception 'Return Card is not available.' using errcode = 'P0002';
  end if;

  select l.id into v_latest_id
  from public.letters l
  where l.correspondence_id = v_corr.id
  order by l.created_at desc, l.id desc
  limit 1;

  if v_latest_id is distinct from v_source.id then
    raise exception 'Return Card is not available.' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.return_cards rc
    where rc.source_letter_id = v_source.id
  ) then
    raise exception 'A Return Card has already been sent for this letter.' using errcode = '23505';
  end if;

  v_rhythm := tempa_private.effective_writing_rhythm(v_corr.id, v_uid);
  v_days := tempa_private.writing_rhythm_days(v_rhythm);
  if v_days is null
     or now() <= v_source.created_at + make_interval(days => v_days) then
    raise exception 'Return Card is not available.' using errcode = 'P0002';
  end if;

  v_postcard_key := trim(both from coalesce(p_postcard_key, ''));
  if v_postcard_key = '' then
    raise exception 'Choose a Postcard.' using errcode = '22023';
  end if;

  -- Relationship bridge, not commerce: only a live Complimentary product.
  if not exists (
    select 1
    from public.postcard_catalog pc
    join public.commerce_products cp
      on cp.postcard_key = pc.key
     and cp.product_type = 'postcard'
    where pc.key = v_postcard_key
      and pc.is_active
      and cp.is_complimentary
      and cp.lifecycle_state = 'published'
      and (cp.publish_at is null or cp.publish_at <= now())
      and (cp.unpublish_at is null or cp.unpublish_at > now())
  ) then
    raise exception 'This Postcard is not available for a Return Card.' using errcode = '22023';
  end if;

  select pv.id into v_postcard_version_id
  from public.postcard_versions pv
  where pv.postcard_key = v_postcard_key and pv.is_current;
  if v_postcard_version_id is null then
    raise exception 'This Postcard is not available for a Return Card.' using errcode = '22023';
  end if;

  v_message := nullif(trim(both from coalesce(p_message, '')), '');
  if v_message is not null and char_length(v_message) > 200 then
    raise exception 'A Return Card note is too long.' using errcode = '22023';
  end if;

  select p.pseudonym into v_sender_pseudonym
  from public.profiles p
  where p.id = v_uid;
  if v_sender_pseudonym is null then
    raise exception 'Return Card is not available.' using errcode = 'P0002';
  end if;

  insert into public.return_cards (
    correspondence_id,
    source_letter_id,
    sender_id,
    recipient_id,
    postcard_version_id,
    message,
    sender_pseudonym_snapshot
  ) values (
    v_corr.id,
    v_source.id,
    v_uid,
    v_other,
    v_postcard_version_id,
    v_message,
    v_sender_pseudonym
  ) returning id into v_return_card_id;

  -- Intentionally no UPDATE of public.letters or public.correspondences.
  return v_return_card_id;
end;
$function$;

revoke all on function public.send_return_card(uuid, text, text) from public, anon;
grant execute on function public.send_return_card(uuid, text, text) to authenticated;

commit;

-- READ-ONLY VERIFICATION
select c.column_name, c.data_type, c.is_nullable
from information_schema.columns c
where c.table_schema = 'public' and c.table_name = 'return_cards'
order by c.ordinal_position;

select conname, contype, pg_catalog.pg_get_constraintdef(oid) as definition
from pg_catalog.pg_constraint
where conrelid = 'public.return_cards'::regclass
order by conname;

select policyname, cmd, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'public' and tablename = 'return_cards';

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'return_cards'
order by grantee, privilege_type;

select p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('return_card_available', 'send_return_card')
order by p.proname;

select pg_catalog.pg_get_functiondef(
  'public.send_return_card(uuid,text,text)'::regprocedure
) as send_return_card_definition;
