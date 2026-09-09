-- ============================================================
-- TEMPA — LIVE SEND REPAIR: "column reference "m" is ambiguous"
-- (SQLSTATE 42702) in write_letter and reply_to_letter
-- PREPARED 2026-09-13. NOT EXECUTED — review, then run in the Supabase
-- SQL editor.
-- ============================================================
--
-- LIVE ERROR (confirmed via a real Send attempt from Preview, which
-- calls write_letter): 42702, "column reference "m" is ambiguous — It
-- could refer to either a PL/pgSQL variable or a table column."
--
-- ROOT CAUSE, found by reading the CURRENT canonical function bodies
-- (docs/sql/2026-09-12-scoped-blocking-and-fixes.sql, section 6 —
-- verified as the most recent CREATE OR REPLACE of both functions; no
-- later migration touches either name), not guessed:
--
-- Both write_letter and reply_to_letter declare a PL/pgSQL variable
--
--   declare
--     ...
--     m jsonb;
--
-- which stays in scope for the whole function body, and use it as a
-- FOR-loop target earlier in each function:
--
--   for m in select * from jsonb_array_elements(p_moments)
--   loop
--     if m->>'type' not in ('photo', 'postcard') then ...
--
-- That loop is fine — its own query never introduces a second thing
-- named "m", so it cleanly reuses the outer variable with no ambiguity.
-- Further down, the actual Moments INSERT in BOTH functions introduces
-- a SEPARATE, SQL-level table alias also named "m":
--
--   insert into public.moments (...)
--   select
--     new_id,
--     (m->>'position')::integer,
--     m->>'type',
--     m->>'image_path',
--     m->>'postcard_key'
--   from jsonb_array_elements(p_moments) as m;
--
-- Inside that SELECT, every "m->>'...'" reference is ambiguous between
-- the outer PL/pgSQL variable `m` (still in scope) and the FROM-clause
-- alias `m` (this query's own jsonb_array_elements row) — both visible,
-- both plausible, and Postgres's PL/pgSQL preprocessor refuses to guess
-- which one is meant, raising exactly SQLSTATE 42702. It fires on every
-- write_letter/reply_to_letter call that includes at least one Moment
-- (moment_count > 0), after every validation in the FOR loop above it
-- has already passed — the function never reaches the INSERT itself
-- without erroring.
--
-- This EXACT bug, in this exact shape, was already found and fixed once
-- for reply_to_letter alone in docs/sql/2026-09-02-reply-to-letter-
-- moments-alias-fix.sql (alias renamed m -> elem). It was silently
-- REINTRODUCED into reply_to_letter by a later full CREATE OR REPLACE
-- (the alias reverted to `m` somewhere between then and the current
-- 2026-09-12 canonical version), and write_letter — the function this
-- app's composer actually calls (moments-composer.tsx's handleSend) —
-- carries the identical, never-previously-fixed defect. Both are
-- disambiguated here, by the same minimal fix, for the same reason:
-- leaving either one live would mean the very next Moments-carrying
-- send/reply crashes identically. This is not a guess or a second
-- function's worth of unrelated changes — it is the SAME diagnosed
-- pattern, confirmed by direct inspection of both bodies.
--
-- FIX: rename ONLY the FROM-clause alias in each function's Moments
-- INSERT, from `m` to `elem`, and update that one SELECT's four
-- `m->>'...'` references to `elem->>'...'` accordingly. The `declare m
-- jsonb;` line and the earlier validation FOR loop in both functions are
-- left completely untouched — they were never ambiguous and don't need
-- to change. No #variable_conflict pragma is used anywhere (kept out
-- deliberately, per instruction, in favor of an explicit, readable
-- rename that removes the ambiguity at its source rather than papering
-- over it with a global resolution rule).
--
-- Nothing else changes in either function: same signatures
-- (write_letter: uuid, text, uuid, jsonb — reply_to_letter: uuid, text,
-- jsonb), same SECURITY DEFINER, same `set search_path to 'pg_catalog'`,
-- same delayed-delivery computation (compute_deliver_at / the
-- previous-deliver_at + 1 minute floor), same is_correspondence_
-- blocked_pair / current_account_status blocking and account-restriction
-- checks, same correspondence-authorization and reply_to_id validation,
-- same Moments/paragraph-position/photo-consent validation logic and
-- values, same photo-consent-request side effect, same
-- moments_qualified_for_viewer gate, same Postcard compatibility (a
-- postcard Moment's image_path/postcard_key columns are populated
-- exactly as before — only how the row is READ out of the jsonb array
-- changes, never what's written), same grants below (re-issued
-- explicitly, matching each function's already-live privilege posture,
-- exactly as this repository's own prior alias-fix migration did for
-- reply_to_letter).
--
-- Every other line below is reproduced VERBATIM from the current live
-- 2026-09-12 canonical source (re-read directly from that file, not from
-- memory) — this migration changes nothing beyond the two disambiguating
-- renames.

begin;

create or replace function public.reply_to_letter(
  p_letter_id uuid,
  p_body text,
  p_moments jsonb default '[]'::jsonb
)
returns public.letters_for_participant
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$

declare
  original public.letters;
  corr public.correspondences;
  new_id uuid;
  result public.letters_for_participant;
  moment_count integer;
  paragraph_count integer;
  has_photo boolean;
  is_first_reply boolean;
  m jsonb;
  v_previous_deliver_at timestamptz;
  v_natural_deliver_at timestamptz;
  v_deliver_at timestamptz;
  v_status text;

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
    and deliver_at <= now()
    and (
      reply_to_id is not null
      or expires_at > now()
    )

  for update;


  if not found then
    raise exception
      'Letter not found, not addressed to you, or no longer awaiting a reply.';
  end if;


  if tempa_private.is_correspondence_blocked_pair(auth.uid(), original.sender_id) then
    raise exception
      'Letter not found, not addressed to you, or no longer awaiting a reply.';
  end if;

  v_status := public.current_account_status();
  if v_status in ('suspended', 'banned') then
    raise exception
      'Letter not found, not addressed to you, or no longer awaiting a reply.';
  end if;


  is_first_reply := original.reply_to_id is null;


  select *
  into corr

  from public.correspondences

  where id = original.correspondence_id

  for update;


  moment_count := coalesce(jsonb_array_length(p_moments), 0);
  has_photo := false;

  if moment_count > 0 then

    if is_first_reply then
      raise exception
        'Moments are not available until after your first reply in this correspondence.';
    end if;

    if v_status = 'restricted' then
      raise exception
        'Moments are not available until after your first reply in this correspondence.';
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

      if m->>'type' = 'photo' then
        has_photo := true;

        if corr.photo_consent_status not in ('no_request', 'enabled') then
          raise exception
            'Photo sharing is not available in this correspondence right now.';
        end if;
      end if;

    end loop;

  end if;


  select deliver_at
  into v_previous_deliver_at
  from public.letters
  where correspondence_id = original.correspondence_id
    and sender_id = auth.uid()
    and recipient_id = original.sender_id
  order by created_at desc
  limit 1;

  new_id := pg_catalog.gen_random_uuid();
  v_natural_deliver_at := public.compute_deliver_at(auth.uid(), original.sender_id, new_id);

  v_deliver_at := greatest(v_natural_deliver_at, v_previous_deliver_at + interval '1 minute');


  insert into public.letters (
    id,
    sender_id,
    recipient_id,
    reply_to_id,
    correspondence_id,
    body,
    deliver_at
  )
  values (
    new_id,
    auth.uid(),
    original.sender_id,
    original.id,
    original.correspondence_id,
    p_body,
    v_deliver_at
  );


  if moment_count > 0 then

    -- THE FIX — was `from jsonb_array_elements(p_moments) as m`, whose
    -- alias `m` collided with the `m jsonb;` variable declared above,
    -- making every `m->>'...'` reference below ambiguous (SQLSTATE
    -- 42702). Renamed to `elem`; values/columns are otherwise unchanged.
    insert into public.moments (
      letter_id,
      position,
      type,
      image_path,
      postcard_key
    )
    select
      new_id,
      (elem->>'position')::integer,
      elem->>'type',
      elem->>'image_path',
      elem->>'postcard_key'
    from jsonb_array_elements(p_moments) as elem;

  end if;


  if has_photo and corr.photo_consent_status = 'no_request' then

    update public.correspondences

    set
      photo_consent_status = 'pending',
      photo_consent_requested_by = auth.uid(),
      photo_consent_requested_at = now()

    where id = original.correspondence_id;

  end if;


  update public.letters

  set
    status = 'replied',
    replied_at = now()

  where id = original.id;


  if is_first_reply then

    update public.correspondences

    set
      status = 'active',
      established_at = coalesce(established_at, now())

    where id = original.correspondence_id;

  end if;


  select *
  into result

  from public.letters_for_participant

  where id = new_id;


  return result;

end;
$function$;

revoke all on function public.reply_to_letter(uuid, text, jsonb) from public;
grant execute on function public.reply_to_letter(uuid, text, jsonb) to authenticated;


create or replace function public.write_letter(
  p_correspondence_id uuid,
  p_body text,
  p_reply_to_id uuid default null,
  p_moments jsonb default '[]'::jsonb
)
returns public.letters_for_participant
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$

declare
  corr public.correspondences;
  recipient uuid;
  reply_to_correspondence uuid;
  new_id uuid;
  result public.letters_for_participant;
  moment_count integer;
  paragraph_count integer;
  has_photo boolean;
  m jsonb;
  v_previous_deliver_at timestamptz;
  v_natural_deliver_at timestamptz;
  v_deliver_at timestamptz;
  v_status text;

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;


  select *
  into corr

  from public.correspondences

  where id = p_correspondence_id

  for update;


  if not found then
    raise exception 'Correspondence not found.';
  end if;


  if auth.uid() <> corr.participant_low and auth.uid() <> corr.participant_high then
    raise exception 'You are not a participant in this correspondence.';
  end if;


  recipient := case
    when auth.uid() = corr.participant_low then corr.participant_high
    else corr.participant_low
  end;

  if tempa_private.is_correspondence_blocked_pair(auth.uid(), recipient) then
    raise exception 'Correspondence not found.';
  end if;

  v_status := public.current_account_status();
  if v_status in ('suspended', 'banned') then
    raise exception 'Correspondence not found.';
  end if;


  if corr.status <> 'active' or corr.established_at is null then
    raise exception
      'This correspondence is not yet established for ongoing letters.';
  end if;


  if p_reply_to_id is not null then

    select correspondence_id
    into reply_to_correspondence

    from public.letters

    where id = p_reply_to_id;

    if reply_to_correspondence is null or reply_to_correspondence <> p_correspondence_id then
      raise exception 'reply_to_id must reference a letter in this same correspondence.';
    end if;

  end if;


  moment_count := coalesce(jsonb_array_length(p_moments), 0);
  has_photo := false;

  if moment_count > 0 and v_status = 'restricted' then
    raise exception
      'Moments are not available in this correspondence yet.';
  end if;

  if moment_count > 0 and not public.moments_qualified_for_viewer(p_correspondence_id) then
    raise exception
      'Moments are not available in this correspondence yet.';
  end if;

  if moment_count > 0 then

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

      if m->>'type' = 'photo' then
        has_photo := true;

        if corr.photo_consent_status not in ('no_request', 'enabled') then
          raise exception
            'Photo sharing is not available in this correspondence right now.';
        end if;
      end if;

    end loop;

  end if;


  select deliver_at
  into v_previous_deliver_at
  from public.letters
  where correspondence_id = p_correspondence_id
    and sender_id = auth.uid()
    and recipient_id = recipient
  order by created_at desc
  limit 1;

  new_id := pg_catalog.gen_random_uuid();
  v_natural_deliver_at := public.compute_deliver_at(auth.uid(), recipient, new_id);

  v_deliver_at := greatest(v_natural_deliver_at, v_previous_deliver_at + interval '1 minute');


  insert into public.letters (
    id,
    sender_id,
    recipient_id,
    reply_to_id,
    correspondence_id,
    body,
    deliver_at
  )
  values (
    new_id,
    auth.uid(),
    recipient,
    p_reply_to_id,
    p_correspondence_id,
    p_body,
    v_deliver_at
  );


  if moment_count > 0 then

    -- THE FIX — was `from jsonb_array_elements(p_moments) as m`, whose
    -- alias `m` collided with the `m jsonb;` variable declared above,
    -- making every `m->>'...'` reference below ambiguous (SQLSTATE
    -- 42702). Renamed to `elem`; values/columns are otherwise unchanged.
    -- This is the exact function moments-composer.tsx's handleSend
    -- calls, and the exact function that raised 42702 in the live test.
    insert into public.moments (
      letter_id,
      position,
      type,
      image_path,
      postcard_key
    )
    select
      new_id,
      (elem->>'position')::integer,
      elem->>'type',
      elem->>'image_path',
      elem->>'postcard_key'
    from jsonb_array_elements(p_moments) as elem;

  end if;


  if has_photo and corr.photo_consent_status = 'no_request' then

    update public.correspondences

    set
      photo_consent_status = 'pending',
      photo_consent_requested_by = auth.uid(),
      photo_consent_requested_at = now()

    where id = p_correspondence_id;

  end if;


  select *
  into result

  from public.letters_for_participant

  where id = new_id;


  return result;

end;
$function$;

revoke all on function public.write_letter(uuid, text, uuid, jsonb) from public;
grant execute on function public.write_letter(uuid, text, uuid, jsonb) to authenticated;

commit;


-- ============================================================
-- VERIFY — run these AFTER the migration above, in the same SQL editor
-- session. All are read-only.
-- ============================================================

-- 1. Both functions exist with their expected signatures.
select
  p.proname,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as args,
  p.prosecdef as security_definer,
  p.proconfig as config
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('write_letter', 'reply_to_letter')
order by p.proname;
-- Expect: two rows.
--   reply_to_letter | uuid, text, jsonb       | t | {search_path=pg_catalog}
--   write_letter    | uuid, text, uuid, jsonb | t | {search_path=pg_catalog}
-- security_definer must read `t` (true) for both — SECURITY DEFINER is
-- unchanged by this migration. config must show search_path=pg_catalog
-- for both — the existing hardened search_path is unchanged.

-- 2. The ambiguous alias is gone from the stored function definition,
-- and the disambiguated one is present, for both functions.
select
  p.proname,
  pg_catalog.pg_get_functiondef(p.oid) ilike '%jsonb_array_elements(p_moments) as m;%' as still_has_ambiguous_alias,
  pg_catalog.pg_get_functiondef(p.oid) ilike '%jsonb_array_elements(p_moments) as elem;%' as has_fixed_alias
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('write_letter', 'reply_to_letter')
order by p.proname;
-- Expect: still_has_ambiguous_alias = false and has_fixed_alias = true,
-- for BOTH rows.

-- 3. The `m jsonb;` declaration and its FOR-loop validation usage are
-- still present and untouched (proves this migration only renamed the
-- one INSERT's alias, not the whole function's Moments-handling logic).
select
  p.proname,
  pg_catalog.pg_get_functiondef(p.oid) ilike '%m jsonb;%' as still_declares_m,
  pg_catalog.pg_get_functiondef(p.oid) ilike '%for m in select * from jsonb_array_elements(p_moments)%' as still_has_validation_loop
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('write_letter', 'reply_to_letter')
order by p.proname;
-- Expect: both true, for both rows.

-- 4. Existing safety-helper calls remain present in both functions'
-- bodies (blocking + account-restriction gates were NOT removed by this
-- migration).
select
  p.proname,
  pg_catalog.pg_get_functiondef(p.oid) ilike '%tempa_private.is_correspondence_blocked_pair%' as has_block_check,
  pg_catalog.pg_get_functiondef(p.oid) ilike '%public.current_account_status()%' as has_account_status_check
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('write_letter', 'reply_to_letter')
order by p.proname;
-- Expect: both true, for both rows.

-- 5. Grants/execute permissions remain exactly as intended: anon has no
-- EXECUTE, authenticated does, for both functions.
select
  p.proname,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('write_letter', 'reply_to_letter')
order by p.proname;
-- Expect: anon_can_execute = false, authenticated_can_execute = true,
-- for both rows.

-- 6. Smoke-test the actual fix, without needing a real correspondence:
-- confirm jsonb_array_elements aliased as `elem` alongside a same-named
-- PL/pgSQL-style variable no longer raises 42702 in an ad hoc block
-- shaped the same way as the fixed functions.
do $$
declare
  m jsonb;
  elem jsonb;
  out_position integer;
begin
  for m in select * from jsonb_array_elements('[{"position":0,"type":"photo"}]'::jsonb)
  loop
    if m->>'type' not in ('photo', 'postcard') then
      raise exception 'unexpected type in smoke test';
    end if;
  end loop;

  select (elem->>'position')::integer
  into out_position
  from jsonb_array_elements('[{"position":0,"type":"photo"}]'::jsonb) as elem;

  if out_position is distinct from 0 then
    raise exception 'smoke test produced unexpected position %', out_position;
  end if;

  raise notice 'Smoke test passed: no ambiguous-column error, position resolved to %', out_position;
end;
$$;
