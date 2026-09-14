-- ============================================================
-- TEMPA — QUESTION FLAGSHIP SIMPLIFICATION (CORRECTION)
-- ============================================================
-- STATUS: LIVE. APPLIED AND INDEPENDENTLY VERIFIED. Applied against
-- production Supabase (result: "Success. No rows returned"); a
-- subsequent read-only verification pass confirmed the migration
-- landed as documented. The current live Flagship is the Question
-- beginning "Imagine a room full of people you have never met…" —
-- unchanged by this migration, since it already held current_position
-- = 1 and PART A's backfill (`update ... set is_flagship = true where
-- current_position = 1`) simply carried that forward with no admin
-- action, no hardcoded id/text, and nothing destroyed or duplicated.
-- The Questions Flagship checkpoint is CLOSED. Do not reapply this
-- file, recreate its constraints/indexes, or duplicate its functions.
--
-- Builds on the already-LIVE docs/sql/2026-09-19-question-slots-and-
-- premium-announcements.sql (NOT edited here — its executable SQL is
-- untouched). This is a NEW, separate migration correcting one thing:
-- that prior checkpoint's Question Slots model wrongly hardcoded
-- "position #1 is the permanent flagship" — position and Flagship were
-- the same bit of state, and #1 was given special protection nothing
-- in the actual product ever asked for.
--
-- ACTUAL PRODUCT MODEL (this correction):
--   - TEMPA has exactly THREE current Questions (positions 1/2/3,
--     unchanged from 2026-09-19 — still explicit Admin assignment,
--     still at most one Question per slot).
--   - Exactly ONE of the three current Questions is Flagship — a
--     SEPARATE boolean (questions.is_flagship, new), not tied to any
--     particular slot number. Choosing a new Flagship is a plain
--     radio-button swap: whichever Question was Flagship before
--     automatically stops being Flagship the instant a different one
--     is chosen (admin_set_question_flagship, new).
--   - Only a CURRENT (positioned) Question may be Flagship
--     (questions_flagship_requires_position, new).
--   - "Edit Question" is now ONE admin action per slot
--     (admin_edit_current_question, new): a zero-answer current
--     Question is edited in place; an answered one is preserved
--     untouched and a new row with the revised wording immediately
--     takes over the same slot (and Flagship status, if the old row
--     held it) — the admin never manually activates/deactivates/
--     re-pins/replaces anything themselves.
--   - "Add Question" for an empty slot is likewise ONE admin action
--     (admin_add_current_question, new) — no separate create-then-
--     activate-then-position sequence.
--   - The old "Question #1 is the permanent flagship, cannot be
--     deactivated/replaced/moved/evicted from here" protections are
--     REMOVED from admin_set_question_active, admin_set_question_
--     position, and admin_replace_question — those RPCs remain as
--     lower-level primitives (harmless DB-level compatibility with
--     2026-09-19), but no longer encode any "#1 is special" rule; they
--     just correctly cascade-clear is_flagship whenever a Question
--     leaves current_position, since is_flagship cannot outlive a
--     Question's slot.
--
-- Nothing about historical-answer integrity changes: a Question row
-- with existing answers is still NEVER rewritten or reassigned, and
-- still remains in the database once it stops being current — exactly
-- as before.
-- ============================================================

begin;

-- ============================================================
-- PART A — is_flagship: a separate bit of state from current_position
-- ============================================================

alter table public.questions
  add column if not exists is_flagship boolean not null default false;

comment on column public.questions.is_flagship is
  'Whether this Question is the current Flagship — the sole determinant of a member''s primary Minds/Profile answer (lib/questions.ts''s getFlagshipQuestion/getPrimaryAnswer). Independent of current_position (slot number never implies Flagship): exactly one CURRENT (positioned) Question is normally Flagship, changed only via admin_set_question_flagship, a single atomic swap. A Question can never be Flagship while unpositioned (questions_flagship_requires_position).';

-- A Question can only ever be Flagship while it is actually one of the
-- three current, positioned Questions — the same "derive from existing
-- columns, backstop with a CHECK" pattern used throughout this app's
-- migrations. This is what makes clearing current_position (deactivate,
-- unpin, eviction by another Question taking the slot) also REQUIRE
-- clearing is_flagship in the same statement wherever it happens below
-- — the constraint is the hard backstop; the RPCs are written to never
-- actually hit it in ordinary use.
alter table public.questions
  add constraint questions_flagship_requires_position
  check (not is_flagship or current_position is not null);

-- The actual "at most one Flagship" guarantee — a partial unique index
-- over a single boolean column, same technique as questions_current_
-- position_unique: every row admitted by the WHERE clause has the same
-- indexed value (true), so a second such row is a straightforward
-- uniqueness violation. No race or bug anywhere in the app can ever
-- produce two simultaneous Flagships.
create unique index if not exists questions_is_flagship_unique
  on public.questions (is_flagship)
  where is_flagship = true;

-- Preserve the currently-live Flagship exactly as it stands today
-- (CURRENT LIVE FLAGSHIP — the "room full of people you have never
-- met" prompt) — it already holds current_position = 1, so backfilling
-- is_flagship for whatever Question holds position 1 right now
-- requires no admin action and no hardcoded id/text, and destroys or
-- duplicates nothing.
update public.questions set is_flagship = true where current_position = 1;


-- ============================================================
-- PART B — admin_list_questions gains is_flagship
-- ============================================================
-- Return-type column list change requires the function to be dropped
-- first (CREATE OR REPLACE cannot alter a RETURNS TABLE column list).
drop function if exists public.admin_list_questions();

create or replace function public.admin_list_questions()
returns table (
  id uuid,
  slug text,
  family text,
  prompt text,
  is_active boolean,
  current_position smallint,
  is_flagship boolean,
  answer_count bigint,
  first_letter_count bigint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if not public.is_staff('admin') then
    raise exception 'Not authorized.';
  end if;

  return query
    select
      q.id,
      q.slug,
      q.family,
      q.prompt,
      q.is_active,
      q.current_position,
      q.is_flagship,
      (select count(*) from public.question_answers qa where qa.question_id = q.id),
      (
        select count(*) from public.letters l
        join public.question_answers qa2 on qa2.id = l.question_answer_id
        where qa2.question_id = q.id
      ),
      q.created_at
    from public.questions q
    order by (q.current_position is null), q.current_position, q.created_at desc nulls last, q.prompt;
end;
$function$;

revoke all on function public.admin_list_questions() from public;
grant execute on function public.admin_list_questions() to authenticated;


-- ============================================================
-- PART C — remove the wrong "#1 is the permanent flagship" protections
-- ============================================================

-- admin_set_question_active — CORRECTION: the old "Question #1 cannot
-- be deactivated from here" block is removed entirely (nothing is
-- special about slot #1 anymore). Deactivating a Question now
-- correctly cascades to clear is_flagship in the SAME statement as
-- vacating current_position, whenever the Question being deactivated
-- happened to be Flagship — required by questions_flagship_requires_
-- position, never left to the constraint to catch as a hard error.
create or replace function public.admin_set_question_active(p_question_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_actor_pseudonym text;
  v_prompt text;
  v_was_active boolean;
  v_position smallint;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('admin') then
    raise exception 'Not authorized.';
  end if;

  if p_active is null then
    raise exception 'An active state is required.';
  end if;

  select prompt, is_active, current_position into v_prompt, v_was_active, v_position
  from public.questions where id = p_question_id;

  if v_prompt is null then
    raise exception 'Question not found.';
  end if;

  if v_was_active = p_active and p_active then
    raise exception 'This Question is already active.';
  end if;
  if v_was_active = p_active and not p_active then
    raise exception 'This Question is already inactive.';
  end if;

  -- Deactivating vacates the slot AND clears Flagship (if held) in the
  -- same statement — a Question can never be inactive-but-positioned,
  -- or unpositioned-but-Flagship.
  update public.questions
  set is_active = p_active,
      current_position = case when p_active then current_position else null end,
      is_flagship = case when p_active then is_flagship else false end
  where id = p_question_id;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text),
    case when p_active then 'question_activated' else 'question_deactivated' end,
    'question', p_question_id, v_prompt,
    jsonb_build_object('is_active', p_active, 'vacated_position', case when p_active then null else v_position end)
  );
end;
$function$;

revoke all on function public.admin_set_question_active(uuid, boolean) from public;
grant execute on function public.admin_set_question_active(uuid, boolean) to authenticated;


-- admin_set_question_position — CORRECTION: both flagship-protection
-- blocks ("#1 cannot be moved away", "#1 cannot be evicted") are
-- removed entirely. Unpinning a Question, or evicting whichever
-- Question currently occupies a target slot, now correctly clears
-- is_flagship in the same statement whenever that Question happened to
-- be Flagship.
create or replace function public.admin_set_question_position(p_question_id uuid, p_position smallint)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_prompt text;
  v_is_active boolean;
  v_current_position smallint;
  v_actor_pseudonym text;
  v_occupant_id uuid;
  v_occupant_prompt text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('admin') then
    raise exception 'Not authorized.';
  end if;

  if p_position is not null and p_position not in (1, 2, 3) then
    raise exception 'Position must be 1, 2, 3, or null.';
  end if;

  select prompt, is_active, current_position into v_prompt, v_is_active, v_current_position
  from public.questions where id = p_question_id;

  if v_prompt is null then
    raise exception 'Question not found.';
  end if;

  if p_position is not null and not v_is_active then
    raise exception 'Only an active Question may be assigned a current position.';
  end if;

  if p_position is null then
    if v_current_position is null then
      raise exception 'This Question does not currently hold a position.';
    end if;
    update public.questions set current_position = null, is_flagship = false where id = p_question_id;
  else
    if v_current_position = p_position then
      raise exception 'This Question already holds that position.';
    end if;

    select id, prompt into v_occupant_id, v_occupant_prompt
    from public.questions where current_position = p_position;

    -- Any occupied slot is simply vacated first (clearing Flagship too,
    -- if the occupant held it) — two separate UPDATEs (vacate, then
    -- assign) rather than one combined statement so the partial unique
    -- index on current_position is never transiently violated within
    -- the same statement's row set.
    if v_occupant_id is not null then
      update public.questions set current_position = null, is_flagship = false where id = v_occupant_id;
    end if;

    update public.questions set current_position = p_position where id = p_question_id;
  end if;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'question_position_set',
    'question', p_question_id, v_prompt,
    jsonb_build_object('previous_position', v_current_position, 'new_position', p_position)
  );
end;
$function$;

revoke all on function public.admin_set_question_position(uuid, smallint) from public;
grant execute on function public.admin_set_question_position(uuid, smallint) to authenticated;


-- admin_replace_question — CORRECTION: the "#1 cannot be replaced from
-- here" block is removed entirely. Flagship status now carries forward
-- to the replacement under exactly the same condition current_position
-- already does (the replacement must itself end up ACTIVE — a Question
-- may only be Flagship while positioned, and may only be positioned
-- while active), and the old row's is_flagship is cleared in the same
-- statement that clears its current_position.
create or replace function public.admin_replace_question(
  p_question_id uuid,
  p_new_prompt text,
  p_new_active boolean default null,
  p_deactivate_old boolean default true
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_old_prompt text;
  v_old_family text;
  v_old_active boolean;
  v_old_position smallint;
  v_old_flagship boolean;
  v_new_prompt text;
  v_new_active boolean;
  v_new_position smallint;
  v_new_flagship boolean;
  v_actor_pseudonym text;
  v_new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('admin') then
    raise exception 'Not authorized.';
  end if;

  select prompt, family, is_active, current_position, is_flagship
    into v_old_prompt, v_old_family, v_old_active, v_old_position, v_old_flagship
  from public.questions where id = p_question_id;

  if v_old_prompt is null then
    raise exception 'Question not found.';
  end if;

  v_new_prompt := trim(both from coalesce(p_new_prompt, ''));
  if char_length(v_new_prompt) = 0 then
    raise exception 'A prompt is required.';
  end if;
  if char_length(v_new_prompt) > 2000 then
    raise exception 'Prompt is too long.';
  end if;

  v_new_active := coalesce(p_new_active, v_old_active);
  v_new_flagship := false;

  if coalesce(p_deactivate_old, true) then
    update public.questions
    set is_active = false, current_position = null, is_flagship = false
    where id = p_question_id;

    -- The slot (and Flagship status, if held) is carried forward only
    -- when the replacement will itself be ACTIVE — a Question may only
    -- occupy a slot (or be Flagship) while active.
    if v_new_active then
      v_new_position := v_old_position;
      v_new_flagship := v_old_flagship;
    else
      v_new_position := null;
    end if;
  else
    -- Old Question keeps its slot (and Flagship status, unchanged); the
    -- replacement starts unpositioned, un-Flagship (two Questions can
    -- never share a slot or Flagship at once).
    v_new_position := null;
  end if;

  insert into public.questions (prompt, family, is_active, current_position, is_flagship)
  values (v_new_prompt, v_old_family, v_new_active, v_new_position, v_new_flagship)
  returning id into v_new_id;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'question_replaced',
    'question', v_new_id, v_new_prompt,
    jsonb_build_object(
      'replaced_question_id', p_question_id,
      'replaced_prompt', v_old_prompt,
      'old_deactivated', coalesce(p_deactivate_old, true),
      'new_active', v_new_active,
      'carried_position', v_new_position,
      'carried_flagship', v_new_flagship
    )
  );

  return v_new_id;
end;
$function$;

revoke all on function public.admin_replace_question(uuid, text, boolean, boolean) from public;
grant execute on function public.admin_replace_question(uuid, text, boolean, boolean) to authenticated;


-- ============================================================
-- PART D — the three new, simple Admin primitives
-- ============================================================

-- NEW — admin_set_question_flagship. The single atomic action behind
-- the Flagship radio-button selector on the three current slots: sets
-- Flagship on the target Question and clears it from whichever OTHER
-- Question currently holds it, if any, in ONE call — this is the ONLY
-- place in the whole system that ever sets is_flagship = true.
create or replace function public.admin_set_question_flagship(p_question_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_prompt text;
  v_current_position smallint;
  v_was_flagship boolean;
  v_previous_flagship_id uuid;
  v_actor_pseudonym text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('admin') then
    raise exception 'Not authorized.';
  end if;

  select prompt, current_position, is_flagship into v_prompt, v_current_position, v_was_flagship
  from public.questions where id = p_question_id;

  if v_prompt is null then
    raise exception 'Question not found.';
  end if;

  -- Only a current (positioned) Question may ever be Flagship —
  -- questions_flagship_requires_position is the hard backstop; this is
  -- the friendly, specific rejection.
  if v_current_position is null then
    raise exception 'Only a current Question may be made Flagship.';
  end if;

  if v_was_flagship then
    raise exception 'This Question is already Flagship.';
  end if;

  select id into v_previous_flagship_id from public.questions where is_flagship = true;

  -- Two separate UPDATEs (clear, then set) rather than one combined
  -- statement, so the partial unique index on is_flagship is never
  -- transiently asked to hold two true rows within the same
  -- statement's row set.
  update public.questions set is_flagship = false where is_flagship = true;
  update public.questions set is_flagship = true where id = p_question_id;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'question_flagship_changed',
    'question', p_question_id, v_prompt,
    jsonb_build_object('previous_flagship_id', v_previous_flagship_id, 'new_flagship_id', p_question_id)
  );
end;
$function$;

revoke all on function public.admin_set_question_flagship(uuid) from public;
grant execute on function public.admin_set_question_flagship(uuid) to authenticated;


-- NEW — admin_edit_current_question. The single "Edit Question" action
-- behind each of the three current slots — the admin never manually
-- decides between editing in place vs. replacing; this RPC decides for
-- them, from the ONE fact that actually matters: whether the Question
-- has any answers yet.
--   - ZERO answers: the prompt is updated IN PLACE (same row, same
--     slot, same Flagship status if any) — safe, since no historical
--     answer depends on this exact wording yet.
--   - ONE OR MORE answers: the old row (and every answer attached to
--     it) is preserved completely untouched; a NEW row with the
--     revised wording is created and immediately takes over the SAME
--     slot (and Flagship status, if the old row held it); the old row
--     becomes historical — unpositioned, inactive, no longer Flagship,
--     but still in the database, still resolvable for any historical
--     answer that points to it.
-- Only ever callable on a CURRENT (positioned) Question — this is
-- specifically the "Edit Question" button on one of the three visible
-- slots, not a general-purpose library-editing tool.
create or replace function public.admin_edit_current_question(p_question_id uuid, p_new_prompt text)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_new_prompt text;
  v_old_prompt text;
  v_old_family text;
  v_old_position smallint;
  v_old_flagship boolean;
  v_answer_count bigint;
  v_new_id uuid;
  v_actor_pseudonym text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('admin') then
    raise exception 'Not authorized.';
  end if;

  select prompt, family, current_position, is_flagship
    into v_old_prompt, v_old_family, v_old_position, v_old_flagship
  from public.questions where id = p_question_id;

  if v_old_prompt is null then
    raise exception 'Question not found.';
  end if;

  if v_old_position is null then
    raise exception 'Only a current Question can be edited from here.';
  end if;

  v_new_prompt := trim(both from coalesce(p_new_prompt, ''));
  if char_length(v_new_prompt) = 0 then
    raise exception 'A prompt is required.';
  end if;
  if char_length(v_new_prompt) > 2000 then
    raise exception 'Prompt is too long.';
  end if;

  select count(*) into v_answer_count from public.question_answers where question_id = p_question_id;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();

  if v_answer_count = 0 then
    update public.questions set prompt = v_new_prompt where id = p_question_id;

    insert into public.admin_audit_log (
      actor_id, actor_identifier_snapshot, action,
      target_type, target_id, target_identifier_snapshot, metadata
    ) values (
      auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'question_edited',
      'question', p_question_id, v_new_prompt, jsonb_build_object('position', v_old_position)
    );

    return p_question_id;
  end if;

  -- Has answers — preserve the old row untouched; the new row inherits
  -- the same slot and Flagship status and takes over immediately.
  update public.questions
  set is_active = false, current_position = null, is_flagship = false
  where id = p_question_id;

  insert into public.questions (prompt, family, is_active, current_position, is_flagship)
  values (v_new_prompt, v_old_family, true, v_old_position, v_old_flagship)
  returning id into v_new_id;

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'question_replaced',
    'question', v_new_id, v_new_prompt,
    jsonb_build_object(
      'replaced_question_id', p_question_id,
      'replaced_prompt', v_old_prompt,
      'position', v_old_position,
      'carried_flagship', v_old_flagship
    )
  );

  return v_new_id;
end;
$function$;

revoke all on function public.admin_edit_current_question(uuid, text) from public;
grant execute on function public.admin_edit_current_question(uuid, text) to authenticated;


-- NEW — admin_add_current_question. The single "Add Question" action
-- for an EMPTY slot — creates a brand new Question AND makes it
-- current in one call, rather than the old create-then-activate-then-
-- position sequence (admin_create_question always creates inactive/
-- unpositioned, so that sequence could never be one step). Refuses
-- outright if the target slot is already occupied — this is
-- specifically for populating an empty slot, never for evicting
-- anything (admin_set_question_position remains available at the DB
-- level for that, but is deliberately not exposed on the simplified
-- Admin surface).
create or replace function public.admin_add_current_question(p_position smallint, p_prompt text)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_prompt text;
  v_new_id uuid;
  v_actor_pseudonym text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('admin') then
    raise exception 'Not authorized.';
  end if;

  if p_position is null or p_position not in (1, 2, 3) then
    raise exception 'Position must be 1, 2, or 3.';
  end if;

  if exists (select 1 from public.questions where current_position = p_position) then
    raise exception 'That slot is already occupied.';
  end if;

  v_prompt := trim(both from coalesce(p_prompt, ''));
  if char_length(v_prompt) = 0 then
    raise exception 'A prompt is required.';
  end if;
  if char_length(v_prompt) > 2000 then
    raise exception 'Prompt is too long.';
  end if;

  insert into public.questions (prompt, is_active, current_position)
  values (v_prompt, true, p_position)
  returning id into v_new_id;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'question_added',
    'question', v_new_id, v_prompt, jsonb_build_object('position', p_position)
  );

  return v_new_id;
end;
$function$;

revoke all on function public.admin_add_current_question(smallint, text) from public;
grant execute on function public.admin_add_current_question(smallint, text) to authenticated;

commit;
