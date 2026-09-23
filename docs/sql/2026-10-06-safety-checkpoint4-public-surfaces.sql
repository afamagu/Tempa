-- ============================================================
-- TEMPA — SAFETY 2, CHECKPOINT 4: PUBLIC TEXT SURFACES
-- STATUS: NOT EXECUTED — review, then run in the Supabase SQL editor,
-- AFTER docs/sql/2026-10-03-safety-persistence.sql (this migration
-- calls tempa_private.consume_safety_evaluation and the widened
-- surface/fingerprint contract that migration prepares) and AFTER
-- docs/sql/2026-10-05-safety-checkpoint3-letter-wiring.sql. Does NOT
-- merge to main, deploy, or enable enforcement for real members until
-- all three have actually been run and verified.
-- ============================================================
--
-- Wires public.publish_dispatch/update_dispatch/publish_question_answer/
-- create_reply — real, LIVE, already-shipped production functions — to
-- REQUIRE a Safety clearance before any Dispatch/Question-answer/Reply
-- can be created or edited, exactly the same transactional pattern
-- Checkpoint 3 established for Letters. Each is reproduced in FULL from
-- its current live definition (re-read directly immediately before
-- writing this migration, not from memory — publish_dispatch/
-- update_dispatch from docs/sql/2026-09-28-title-postcard-and-edit-
-- window.sql, publish_question_answer from docs/sql/2026-09-29-your-
-- mark-production.sql, create_reply from docs/sql/2026-09-23-dispatch-
-- replies.sql), with ONLY the specific lines below actually changed —
-- see each function's own section header for exactly which.
--
-- ============================================================
-- MUTATION-BOUNDARY AUDIT (Part 0 — closes the raw-table bypasses
-- before wiring the RPCs, so the RPCs are genuinely the only path once
-- this migration lands)
-- ============================================================
-- Re-read directly (not assumed) before writing this migration:
--
--   public.dispatches — `grant select, insert on public.open_letters to
--   authenticated` (docs/sql/2026-09-06-open-letters.sql:107, the table
--   BEFORE its rename to `dispatches`) is STILL LIVE and has NEVER been
--   revoked: docs/sql/2026-09-10-admin-moderation-and-questions.sql:166
--   only ever revoked UPDATE/DELETE from `authenticated` on this table
--   ("dispatches never held INSERT/DELETE grants either" — that
--   comment is about DELETE; INSERT was explicitly kept, with its own
--   header at that migration's line 314-334 explaining exactly why:
--   "unlike question_answers, this remains a genuinely legitimate
--   direct-table path and must keep working" — because at THAT time,
--   publish_dispatch was still SECURITY INVOKER (confirmed: that same
--   header cites docs/sql/2026-09-12-scoped-blocking-and-fixes.sql's
--   own SECURITY INVOKER definition), so the RLS policy
--   dispatches_insert_own genuinely WAS the enforcement mechanism a
--   member's own publish depended on.
--
--   That is no longer true. publish_dispatch became SECURITY DEFINER at
--   docs/sql/2026-09-25-dispatch-postcards.sql (confirmed by re-reading
--   its current live definition directly — search_path 'pg_catalog',
--   `security definer`) and has stayed SECURITY DEFINER ever since
--   (docs/sql/2026-09-28-title-postcard-and-edit-window.sql, the
--   version this migration itself reproduces below). A SECURITY
--   DEFINER function's own INSERT runs as the function's OWNER, never
--   depending on the calling role's own table-level grants at all — so
--   the raw `INSERT` grant to `authenticated`, and the
--   `dispatches_insert_own` RLS policy it depends on, are now dead
--   weight for publish_dispatch's own legitimate use, AND a live,
--   currently-exploitable bypass: dispatches_insert_own's own WITH
--   CHECK (docs/sql/2026-09-10-admin-moderation-and-questions.sql:
--   337-345) is only `author_id = auth.uid() and moderation_status =
--   'visible' and moderated_at is null` — no account-status gate, no
--   title/body length check, no Postcard validation, and (once this
--   migration lands) no Safety evaluation requirement at all. A direct
--   authenticated PostgREST client could insert a fully "published"
--   Dispatch this way today, completely bypassing publish_dispatch. No
--   legitimate application code path uses this raw insert (confirmed:
--   no `.from('dispatches').insert(` anywhere in this codebase) — it is
--   revoked below, per this checkpoint's own explicit instruction.
--
--   public.dispatch_topics — same shape, same history:
--   `grant select, insert on public.dispatch_topics to authenticated`
--   (docs/sql/2026-09-07-dispatches-and-board.sql:162) has also never
--   been revoked. Its own WITH CHECK (`exists (select 1 from
--   dispatches d where d.id = dispatch_topics.dispatch_id and
--   d.author_id = auth.uid())`) lets the author of ANY of their own
--   Dispatches — published or not, regardless of the 30-minute edit
--   window or the Reply lock — directly insert new topic rows, entirely
--   bypassing both publish_dispatch and update_dispatch (and, once this
--   migration lands, Safety) even if the parent `dispatches` table were
--   otherwise fully locked down. The per-Dispatch 3-topic cap trigger
--   (dispatch_topics_enforce_max) still fires regardless of INSERT
--   path, but nothing else does. No legitimate application code path
--   uses this raw insert either (same confirmation as above) — revoked
--   below.
--
--   public.dispatch_postcards — already fully locked (docs/sql/2026-09-
--   25-dispatch-postcards.sql: `revoke all ... from public, anon,
--   authenticated; grant select ... to authenticated;` — no write grant
--   of any kind). No action needed; confirmed, not assumed.
--
--   public.question_answers — already fully locked (docs/sql/2026-09-
--   10-admin-moderation-and-questions.sql:167: `revoke insert, update,
--   delete on public.question_answers from authenticated;`, the same
--   migration that made publish_question_answer SECURITY DEFINER). No
--   action needed; confirmed, not assumed.
--
--   public.dispatch_replies — already SELECT-only from creation (docs/
--   sql/2026-09-23-dispatch-replies.sql:359-360: `revoke all ... from
--   public; grant select ... to authenticated;` — every mutation is
--   RPC-only from day one, learning directly from kept_minds' own
--   history). No action needed; confirmed, not assumed.
--
-- Revoking INSERT below does not affect publish_dispatch/update_dispatch
-- themselves in any way (SECURITY DEFINER, runs as owner) — only a
-- direct, un-mediated client call is closed. Read access
-- (dispatches_select_published, dispatch_topics_select_published) is
-- completely untouched.
--
-- Checkpoint 10 preflight correction: these four statements originally
-- ran before BEGIN, on the theory that plain DDL needed no transactional
-- envelope of its own. That reasoning does not hold for THIS file: every
-- other Safety migration's own header calls itself "one coherent,
-- all-or-nothing checkpoint," and DROP POLICY/REVOKE are ordinary
-- transactional DDL in Postgres — there is no technical reason to run
-- them in autocommit mode. Leaving them outside BEGIN meant a failure
-- later in this same file (e.g. one of the four DROP FUNCTION statements
-- below not matching production's actual live signature) would leave the
-- raw-insert bypass already closed while none of the four RPCs had
-- actually been updated to require Safety — a partially-applied,
-- silently-drifted state this migration's own "all-or-nothing" claim
-- promises can't happen. Moved inside the transaction; no behavioral
-- change to what is closed or how.

begin;

drop policy dispatches_insert_own on public.dispatches;
revoke insert on public.dispatches from authenticated;

drop policy dispatch_topics_insert_own on public.dispatch_topics;
revoke insert on public.dispatch_topics from authenticated;

-- ============================================================
-- 1. PUBLISH_DISPATCH
-- ============================================================
-- Changed from its current live definition: new_id is now generated
-- EARLY (gen_random_uuid(), explicitly inserted as the id column —
-- dispatches.id already defaults to gen_random_uuid(), so this changes
-- nothing about the VALUE, only WHEN it becomes known) so tempa_private.
-- consume_safety_evaluation can link this evaluation's own signal (if
-- any) to the exact resulting Dispatch; a new required
-- p_safety_evaluation_id and a new p_warning_acknowledged (default
-- false); one call to consume_safety_evaluation, placed after every
-- other validation (title/topics/Postcard shape) and before the actual
-- insert — a denied/invalid/already-used evaluation blocks the
-- Dispatch from ever being created.

drop function public.publish_dispatch(text, text, text[], jsonb, jsonb);

create or replace function public.publish_dispatch(
  p_title text,
  p_body text,
  p_safety_evaluation_id uuid,
  p_topics text[] default '{}',
  p_moments jsonb default '[]'::jsonb,
  p_postcard jsonb default null,
  p_warning_acknowledged boolean default false
)
returns public.dispatches
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$

declare
  new_id uuid;
  result public.dispatches;
  topic text;
  normalized_topics text[] := '{}';
  paragraph_count integer;
  m jsonb;
  has_postcard boolean;
  v_postcard_key text;
  v_postcard_version_id uuid;
  v_reveal_line text;
  v_back_message text;
  v_sender_pseudonym text;

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'This action is not available right now.';
  end if;

  if char_length(trim(p_title)) = 0 then
    raise exception 'A Dispatch needs a title.';
  end if;

  if char_length(p_title) > 140 then
    raise exception 'Title is too long.';
  end if;

  if array_length(p_topics, 1) is not null and array_length(p_topics, 1) > 3 then
    raise exception 'A Dispatch may carry at most 3 topics.';
  end if;

  foreach topic in array coalesce(p_topics, '{}') loop
    topic := trim(topic);
    if char_length(topic) = 0 then
      continue;
    end if;
    if char_length(topic) > 40 then
      raise exception 'A topic is too long.';
    end if;
    if not exists (
      select 1 from unnest(normalized_topics) t where lower(t) = lower(topic)
    ) then
      normalized_topics := array_append(normalized_topics, topic);
    end if;
  end loop;

  if array_length(normalized_topics, 1) is not null and array_length(normalized_topics, 1) > 3 then
    raise exception 'A Dispatch may carry at most 3 topics.';
  end if;


  has_postcard := p_postcard is not null;

  if has_postcard then

    v_postcard_key := p_postcard->>'postcard_key';
    v_reveal_line := p_postcard->>'reveal_line';
    v_back_message := p_postcard->>'back_message';

    if v_postcard_key is null or char_length(trim(v_postcard_key)) = 0 then
      raise exception 'A Postcard requires a postcard key.';
    end if;

    if not exists (
      select 1 from public.postcard_catalog
      where key = v_postcard_key and is_active
    ) then
      raise exception 'Unknown postcard.';
    end if;

    select id
    into v_postcard_version_id
    from public.postcard_versions
    where postcard_key = v_postcard_key and is_current;

    if v_postcard_version_id is null then
      raise exception 'This postcard has no current version available.';
    end if;

    if v_reveal_line is not null and char_length(v_reveal_line) > 32 then
      raise exception 'A Postcard''s Reveal Line is too long.';
    end if;

    if v_back_message is null or char_length(trim(both from v_back_message)) = 0 then
      raise exception 'A Postcard needs its own written message before it can be published.';
    end if;

    if char_length(trim(both from v_back_message)) > 300 then
      raise exception 'A Postcard''s back message is too long.';
    end if;

    select pseudonym
    into v_sender_pseudonym
    from public.profiles
    where id = auth.uid();

    if v_sender_pseudonym is null then
      raise exception 'Could not resolve your pseudonym for this Postcard.';
    end if;

  end if;


  new_id := pg_catalog.gen_random_uuid();

  -- Checkpoint 4 — the one trusted consumption path. context_id is the
  -- acting member's own auth.uid() (no pre-existing Dispatch id at
  -- evaluation time — see can_evaluate_safety_context's own header).
  -- Placed after every other validation above, strictly before the
  -- actual insert below.
  perform tempa_private.consume_safety_evaluation(
    p_safety_evaluation_id,
    auth.uid(),
    'dispatch_publish',
    auth.uid(),
    null,
    null,
    p_title,
    normalized_topics,
    p_postcard,
    p_body,
    p_warning_acknowledged,
    new_id
  );

  insert into public.dispatches (id, author_id, title, body, status, published_at)
  values (new_id, auth.uid(), p_title, p_body, 'published', now());


  if array_length(normalized_topics, 1) is not null then
    insert into public.dispatch_topics (dispatch_id, topic)
    select new_id, t from unnest(normalized_topics) as t;
  end if;


  if coalesce(jsonb_array_length(p_moments), 0) > 0 then

    paragraph_count := coalesce(
      array_length(
        regexp_split_to_array(trim(both from p_body), '\n\s*\n'),
        1
      ),
      1
    );

    for m in select * from jsonb_array_elements(p_moments)
    loop

      if m->>'type' is distinct from 'photo' then
        raise exception 'Only still-image Moments are supported in a Dispatch.';
      end if;

      if
        (m->>'position')::integer < 0
        or (m->>'position')::integer >= paragraph_count
      then
        raise exception 'Moment position is out of range for this Dispatch.';
      end if;

      if auth.uid()::text is distinct from (storage.foldername(m->>'image_path'))[1] then
        raise exception 'A Moment photo must belong to the author.';
      end if;

    end loop;

    insert into public.dispatch_moments (dispatch_id, position, image_path)
    select
      new_id,
      (elem->>'position')::integer,
      elem->>'image_path'
    from jsonb_array_elements(p_moments) as elem;

  end if;


  if has_postcard then

    insert into public.dispatch_postcards (
      dispatch_id,
      postcard_version_id,
      reveal_line,
      back_message,
      sender_pseudonym_snapshot
    )
    values (
      new_id,
      v_postcard_version_id,
      v_reveal_line,
      trim(both from v_back_message),
      v_sender_pseudonym
    );

  end if;


  select * into result from public.dispatches where id = new_id;

  return result;

end;
$function$;

revoke all on function public.publish_dispatch(text, text, uuid, text[], jsonb, jsonb, boolean) from public, anon;
grant execute on function public.publish_dispatch(text, text, uuid, text[], jsonb, jsonb, boolean) to authenticated;


-- ============================================================
-- 2. UPDATE_DISPATCH
-- ============================================================
-- Changed from its current live definition: a new required
-- p_safety_evaluation_id and a new p_warning_acknowledged (default
-- false); one call to consume_safety_evaluation, placed after every
-- other validation, before the actual update — the resulting content id
-- is p_dispatch_id itself, since this edits an existing row. No
-- p_postcard parameter — update_dispatch has never accepted one, and
-- this migration does not invent one (see this file's own header).

drop function public.update_dispatch(uuid, text, text, text[], jsonb);

create or replace function public.update_dispatch(
  p_dispatch_id uuid,
  p_title text,
  p_body text,
  p_safety_evaluation_id uuid,
  p_topics text[] default '{}',
  p_moments jsonb default '[]'::jsonb,
  p_warning_acknowledged boolean default false
)
returns public.dispatches
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  result public.dispatches;
  v_dispatch record;
  topic text;
  normalized_topics text[] := '{}';
  paragraph_count integer;
  m jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'This action is not available right now.';
  end if;

  select d.id, d.published_at
  into v_dispatch
  from public.dispatches d
  where d.id = p_dispatch_id
    and d.author_id = auth.uid()
    and d.status = 'published'
  for update;

  if v_dispatch.id is null then
    raise exception 'Only the author of a published Dispatch may edit it.';
  end if;

  if now() > v_dispatch.published_at + interval '30 minutes' then
    raise exception 'This Dispatch can no longer be edited.';
  end if;

  if exists (
    select 1 from public.dispatch_replies where dispatch_id = p_dispatch_id
  ) then
    raise exception 'This Dispatch can no longer be edited.';
  end if;

  if char_length(trim(p_title)) = 0 then
    raise exception 'A Dispatch needs a title.';
  end if;

  if char_length(p_title) > 140 then
    raise exception 'Title is too long.';
  end if;

  if array_length(p_topics, 1) is not null and array_length(p_topics, 1) > 3 then
    raise exception 'A Dispatch may carry at most 3 topics.';
  end if;

  foreach topic in array coalesce(p_topics, '{}') loop
    topic := trim(topic);
    if char_length(topic) = 0 then
      continue;
    end if;
    if char_length(topic) > 40 then
      raise exception 'A topic is too long.';
    end if;
    if not exists (
      select 1 from unnest(normalized_topics) t where lower(t) = lower(topic)
    ) then
      normalized_topics := array_append(normalized_topics, topic);
    end if;
  end loop;

  if array_length(normalized_topics, 1) is not null and array_length(normalized_topics, 1) > 3 then
    raise exception 'A Dispatch may carry at most 3 topics.';
  end if;

  if coalesce(jsonb_array_length(p_moments), 0) > 0 then
    paragraph_count := coalesce(
      array_length(regexp_split_to_array(trim(both from p_body), '\n\s*\n'), 1),
      1
    );

    for m in select * from jsonb_array_elements(p_moments)
    loop
      if m->>'type' is distinct from 'photo' then
        raise exception 'Only still-image Moments are supported in a Dispatch.';
      end if;

      if
        (m->>'position')::integer < 0
        or (m->>'position')::integer >= paragraph_count
      then
        raise exception 'Moment position is out of range for this Dispatch.';
      end if;

      if auth.uid()::text is distinct from (storage.foldername(m->>'image_path'))[1] then
        raise exception 'A Moment photo must belong to the author.';
      end if;
    end loop;
  end if;

  -- Checkpoint 4 — the one trusted consumption path. context_id is the
  -- Dispatch being edited; the resulting content id is that same row.
  -- No Postcard for this surface (update_dispatch has no such
  -- parameter).
  perform tempa_private.consume_safety_evaluation(
    p_safety_evaluation_id,
    auth.uid(),
    'dispatch_update',
    p_dispatch_id,
    null,
    null,
    p_title,
    normalized_topics,
    null,
    p_body,
    p_warning_acknowledged,
    p_dispatch_id
  );

  update public.dispatches
  set title = p_title,
      body = p_body
  where id = p_dispatch_id;

  delete from public.dispatch_topics where dispatch_id = p_dispatch_id;
  if array_length(normalized_topics, 1) is not null then
    insert into public.dispatch_topics (dispatch_id, topic)
    select p_dispatch_id, t from unnest(normalized_topics) as t;
  end if;

  delete from public.dispatch_moments where dispatch_id = p_dispatch_id;
  if coalesce(jsonb_array_length(p_moments), 0) > 0 then
    insert into public.dispatch_moments (dispatch_id, position, image_path)
    select
      p_dispatch_id,
      (elem->>'position')::integer,
      elem->>'image_path'
    from jsonb_array_elements(p_moments) as elem;
  end if;

  select * into result from public.dispatches where id = p_dispatch_id;
  return result;
end;
$function$;

revoke all on function public.update_dispatch(uuid, text, text, uuid, text[], jsonb, boolean) from public, anon, authenticated;
grant execute on function public.update_dispatch(uuid, text, text, uuid, text[], jsonb, boolean) to authenticated;


-- ============================================================
-- 3. PUBLISH_QUESTION_ANSWER
-- ============================================================
-- Changed from its current live definition: the target answer row's id
-- is now resolved (existing row, locked FOR UPDATE) or freshly generated
-- BEFORE consume_safety_evaluation runs and BEFORE the upsert — solved
-- transactionally, per this checkpoint's own explicit instruction, never
-- "mutate first, discover Safety denied it after." A new required
-- p_safety_evaluation_id and a new p_warning_acknowledged (default
-- false); the upsert's own INSERT branch now explicitly supplies that
-- pre-resolved id (harmless on the UPDATE branch too — a real conflict
-- discards the INSERT's own column values except via `excluded`, so the
-- existing row's real id is never at risk of being overwritten).

drop function public.publish_question_answer(uuid, text);

create or replace function public.publish_question_answer(
  p_question_id uuid,
  p_body text,
  p_safety_evaluation_id uuid,
  p_warning_acknowledged boolean default false
)
returns public.question_answers
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  result public.question_answers;
  question_is_active boolean;
  existing_moderation_status text;
  has_current boolean;
  should_promote boolean;
  v_answer_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'This action is not available right now.';
  end if;

  select is_active into question_is_active
  from public.questions where id = p_question_id;
  if question_is_active is not null and not question_is_active then
    raise exception 'This Question is no longer accepting answers.';
  end if;

  -- Resolve the target row's id BEFORE consuming Safety, locking it if
  -- it already exists — this is what makes the upsert below transactionally
  -- safe to run only AFTER a successful consumption, rather than
  -- discovering a denial after the answer was already written.
  select id, moderation_status into v_answer_id, existing_moderation_status
  from public.question_answers
  where user_id = auth.uid() and question_id = p_question_id
  for update;

  if existing_moderation_status = 'hidden' then
    raise exception 'This answer has been hidden and cannot be edited.';
  end if;

  if v_answer_id is null then
    v_answer_id := pg_catalog.gen_random_uuid();
  end if;

  select exists (
    select 1 from public.question_answers
    where user_id = auth.uid() and is_current = true
  ) into has_current;
  should_promote := not has_current;

  -- Checkpoint 4 — the one trusted consumption path. context_id is the
  -- Question being answered; the resulting content id is the pre-
  -- resolved answer row's own id, whether this call turns out to be a
  -- fresh insert or an edit of the existing row.
  perform tempa_private.consume_safety_evaluation(
    p_safety_evaluation_id,
    auth.uid(),
    'question_answer',
    p_question_id,
    null,
    null,
    null,
    null,
    null,
    p_body,
    p_warning_acknowledged,
    v_answer_id
  );

  if should_promote then
    update public.question_answers set is_current = false
    where user_id = auth.uid() and question_id <> p_question_id;
  end if;

  insert into public.question_answers(id, user_id, question_id, body, is_current, updated_at)
  values (v_answer_id, auth.uid(), p_question_id, p_body, should_promote, now())
  on conflict (user_id, question_id)
  do update set
    body = excluded.body,
    updated_at = now(),
    is_current = case
      when should_promote then true
      else public.question_answers.is_current
    end
  returning * into result;

  if exists (
    select 1 from public.questions q
    where q.id = p_question_id and q.is_flagship = true
  ) then
    update public.profiles set onboarding_stage = 'complete'
    where id = auth.uid() and onboarding_stage = 'question';
  end if;

  return result;
end;
$function$;

revoke all on function public.publish_question_answer(uuid, text, uuid, boolean) from public, anon;
grant execute on function public.publish_question_answer(uuid, text, uuid, boolean) to authenticated;


-- ============================================================
-- 4. CREATE_REPLY
-- ============================================================
-- Changed from its current live definition: the new Reply's id is now
-- pre-generated (gen_random_uuid(), explicitly inserted — same reasoning
-- as publish_dispatch's own new_id above) so consume_safety_evaluation
-- can link the signal to it; a new required p_safety_evaluation_id and a
-- new p_warning_acknowledged (default false); one call to
-- consume_safety_evaluation, placed after every eligibility check
-- (including the parent-Reply checks when nested), before the actual
-- insert.

drop function public.create_reply(uuid, text, uuid);

create or replace function public.create_reply(
  p_dispatch_id uuid,
  p_body text,
  p_safety_evaluation_id uuid,
  p_parent_reply_id uuid default null,
  p_warning_acknowledged boolean default false
)
returns public.dispatch_replies
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$

declare
  v_body text;
  v_dispatch record;
  v_parent record;
  v_root_reply_id uuid;
  v_reply_to_user_id uuid;
  v_new_id uuid;
  v_result public.dispatch_replies%rowtype;

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'This action is not available right now.';
  end if;

  v_body := trim(both from coalesce(p_body, ''));
  if char_length(v_body) = 0 then
    raise exception 'A Reply needs some writing.';
  end if;
  if char_length(v_body) > 500 then
    raise exception 'Reply is too long.';
  end if;

  select id, author_id, status, moderation_status
  into v_dispatch
  from public.dispatches
  where id = p_dispatch_id
  for share;

  if v_dispatch.id is null then
    raise exception 'Dispatch not found.';
  end if;

  if v_dispatch.status <> 'published' or v_dispatch.moderation_status <> 'visible' then
    raise exception 'This Dispatch is not open to Replies right now.';
  end if;

  if tempa_private.is_blocked_pair(auth.uid(), v_dispatch.author_id)
     or not tempa_private.author_content_publicly_visible(v_dispatch.author_id) then
    raise exception 'This action is not available right now.';
  end if;

  if p_parent_reply_id is null then
    v_root_reply_id := null;
    v_reply_to_user_id := null;
  else

    select id, dispatch_id, author_id, root_reply_id, moderation_status, deleted_at
    into v_parent
    from public.dispatch_replies
    where id = p_parent_reply_id
    for share;

    if v_parent.id is null then
      raise exception 'The Reply you are answering no longer exists.';
    end if;

    if v_parent.dispatch_id <> p_dispatch_id then
      raise exception 'That Reply does not belong to this Dispatch.';
    end if;

    if v_parent.moderation_status <> 'visible' or v_parent.deleted_at is not null then
      raise exception 'That Reply is no longer available to answer.';
    end if;

    if tempa_private.is_blocked_pair(auth.uid(), v_parent.author_id)
       or not tempa_private.author_content_publicly_visible(v_parent.author_id) then
      raise exception 'This action is not available right now.';
    end if;

    v_reply_to_user_id := v_parent.author_id;
    v_root_reply_id := coalesce(v_parent.root_reply_id, v_parent.id);

  end if;

  v_new_id := pg_catalog.gen_random_uuid();

  -- Checkpoint 4 — the one trusted consumption path. context_id is the
  -- Dispatch; secondary_context_id is the optional parent Reply. Placed
  -- after every eligibility check above, strictly before the actual
  -- insert below.
  perform tempa_private.consume_safety_evaluation(
    p_safety_evaluation_id,
    auth.uid(),
    'dispatch_reply',
    p_dispatch_id,
    null,
    p_parent_reply_id,
    null,
    null,
    null,
    v_body,
    p_warning_acknowledged,
    v_new_id
  );

  insert into public.dispatch_replies (
    id, dispatch_id, author_id, body, parent_reply_id, root_reply_id, reply_to_user_id
  ) values (
    v_new_id, p_dispatch_id, auth.uid(), v_body, p_parent_reply_id, v_root_reply_id, v_reply_to_user_id
  )
  returning * into v_result;

  return v_result;

end;
$function$;

revoke all on function public.create_reply(uuid, text, uuid, uuid, boolean) from public;
grant execute on function public.create_reply(uuid, text, uuid, uuid, boolean) to authenticated;

commit;
