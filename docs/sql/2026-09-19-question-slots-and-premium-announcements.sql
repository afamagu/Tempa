-- ============================================================
-- TEMPA — QUESTION SLOTS + PREMIUM ANNOUNCEMENT PUBLISHING
-- ============================================================
-- STATUS: APPLIED LIVE: 2026-09-11. VERIFIED LIVE: 2026-09-11.
-- VERIFICATION: 28/28 checks passed.
--
-- Builds on the already-LIVE docs/sql/2026-09-18-admin-operations-
-- refinement.sql (NOT edited here — its executable SQL is untouched).
-- This is ONE new migration covering two independent product
-- refinements:
--   1. QUESTION SLOTS — the "unordered library" model is replaced with
--      three explicit, numbered current positions (#1 flagship, #2,
--      #3). Historical/library Questions are unaffected.
--   2. PREMIUM ANNOUNCEMENTS — hero image, subtitle, structured
--      rich-text body, and a real publish/schedule model with explicit
--      pre-publish requirements.
--
-- AMENDED (Final Correction round — applied to this same file before
-- it went live, rather than stacking a second migration):
--   A. content_json now has a genuine runtime structural validator
--      enforced at the column/RPC boundary (announcement_content_is_
--      valid), not merely a TypeScript type.
--   B. Announcement links are restricted to a narrow TEMPA-specific
--      policy (absolute https:// or an internal /relative URL) and
--      that policy is enforced at the database boundary, in the
--      editor, and defensively again in the renderer.
--   C. admin_replace_question's slot-carry-forward now correctly
--      requires the REPLACEMENT to be active, not just the old row
--      being deactivated — closing an edge case that could otherwise
--      violate questions_current_position_requires_active.
--   D. A Draft may now genuinely be incomplete (blank body/
--      content_json) — only Publish requires real content.
--   E. admin_publish_announcement verifies the hero image actually
--      exists in storage before publishing.
--
-- SQL HARDENING ROUND (amended in place again, also before this file
-- went live):
--   F. announcement_href_is_safe also rejects any href containing a
--      backslash — closes the '/\evil.example' edge case, where
--      browser URL parsing treats '\' as equivalent to '/', letting
--      such a value parse as a protocol-relative host reference
--      despite passing a plain "starts with one '/'" check.
--   G. admin_publish_announcement now requires content_json itself
--      (not merely the separate body column) to be both structurally
--      valid AND contain real text (announcement_content_is_valid AND
--      the new announcement_content_has_text) — closing the gap where
--      a direct RPC call could pair a valid-but-empty content_json
--      with an unrelated non-blank body.
--   H. The entire migration is now wrapped in one explicit
--      transaction (BEGIN/COMMIT below) — if any statement fails, the
--      whole migration rolls back rather than leaving Question Slots
--      applied while Announcement/storage statements did not.
--
-- ============================================================

begin;

-- ============================================================
-- PART A — QUESTION SLOTS
-- ============================================================
-- Product model: at most one CURRENT Question may occupy position 1
-- (the permanent flagship), 2, or 3. A Question outside the current
-- three has no position at all (`current_position is null`) and
-- remains in the library/history. Position is purely an explicit
-- Admin choice — never computed, never a popularity/ranking signal.

alter table public.questions
  add column if not exists current_position smallint;

alter table public.questions
  add constraint questions_current_position_range
  check (current_position is null or current_position in (1, 2, 3));

-- A position can only ever be held by a Question that is actually
-- being offered (is_active = true) — deactivating a positioned
-- Question always vacates its slot (enforced in admin_set_question_
-- active below, which clears current_position in the same statement
-- as the is_active flip, so this constraint is never hit by ordinary
-- admin action; it exists as the hard backstop).
alter table public.questions
  add constraint questions_current_position_requires_active
  check (current_position is null or is_active = true);

-- The actual "at most one Question per slot" guarantee — a partial
-- unique index, not application logic, so no race or bug anywhere in
-- the app can ever produce two Questions claiming the same position.
create unique index if not exists questions_current_position_unique
  on public.questions (current_position)
  where current_position is not null;

comment on column public.questions.current_position is
  'Explicit current member-facing slot: 1 (permanent flagship), 2, or 3. Null for every historical/library Question. Never derived from slug, family, or any ranking — always an explicit Admin assignment. At most one Question may hold each value (questions_current_position_unique).';


-- admin_list_questions gains current_position — a return-type column
-- list change requires the function to be dropped first (CREATE OR
-- REPLACE cannot alter a RETURNS TABLE column list).
drop function if exists public.admin_list_questions();

create or replace function public.admin_list_questions()
returns table (
  id uuid,
  slug text,
  family text,
  prompt text,
  is_active boolean,
  current_position smallint,
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
      (select count(*) from public.question_answers qa where qa.question_id = q.id),
      (
        select count(*) from public.letters l
        join public.question_answers qa2 on qa2.id = l.question_answer_id
        where qa2.question_id = q.id
      ),
      q.created_at
    -- Positioned Questions first, in slot order, then the rest of the
    -- library newest-first — matches the Admin UI's own "Current
    -- Questions" / "Question library" split (Section A5).
    from public.questions q
    order by (q.current_position is null), q.current_position, q.created_at desc nulls last, q.prompt;
end;
$function$;

revoke all on function public.admin_list_questions() from public;
grant execute on function public.admin_list_questions() to authenticated;


-- admin_set_question_active — CORRECTION (Question Slots checkpoint):
-- same signature/return type as the live 2026-09-18 definition, so a
-- plain CREATE OR REPLACE is sufficient (no DROP needed). Two changes:
--   1. Deactivating a positioned Question now ALSO clears its position
--      in the same statement — a slot can never be left claimed by an
--      inactive Question (this is what keeps
--      questions_current_position_requires_active from ever actually
--      firing in ordinary use).
--   2. FLAGSHIP PROTECTION (Section A2): Question #1 cannot be
--      deactivated through this casual, single-click control at all.
--      Activating #1 (turning it back on) is unaffected — the
--      restriction is specifically on casually turning it off.
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

  -- NEW: flagship protection — never a casual one-click deactivation.
  if v_position = 1 and not p_active then
    raise exception 'Question #1 is the permanent flagship and cannot be deactivated from here.';
  end if;

  -- NEW: deactivating vacates the slot in the same statement.
  update public.questions
  set is_active = p_active,
      current_position = case when p_active then current_position else null end
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


-- NEW — admin_set_question_position. The general-purpose way to
-- assign an existing ACTIVE library Question to slot 1, 2, or 3, or to
-- clear a Question's slot back to null (unpin it, leaving it active in
-- the general library). This is how #1/#2/#3 are populated in the
-- first place (including installing the real flagship Question after
-- this deployment) and how an admin can promote/retire a Question from
-- a slot WITHOUT going through Replace (e.g. reordering the library
-- without touching wording at all).
--
-- FLAGSHIP PROTECTION (Section A2): once a Question holds position 1,
-- this casual RPC can neither move it away from 1 nor let a different
-- Question evict it from 1. Both directions raise the same clear
-- error. This is deliberately the ONLY guard — a full "exceptional
-- flagship replacement" workflow is explicitly out of scope until
-- actually needed (per the checkpoint's own instruction not to
-- overbuild it), but the schema itself (a plain nullable smallint) any
-- future exceptional operation would need is already in place.
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

  -- Flagship protection, direction 1: #1 cannot be moved away from 1.
  if v_current_position = 1 and p_position is distinct from 1 then
    raise exception 'Question #1 is the permanent flagship and cannot be moved or unassigned from here.';
  end if;

  if p_position is not null and not v_is_active then
    raise exception 'Only an active Question may be assigned a current position.';
  end if;

  if p_position is null then
    if v_current_position is null then
      raise exception 'This Question does not currently hold a position.';
    end if;
    update public.questions set current_position = null where id = p_question_id;
  else
    if v_current_position = p_position then
      raise exception 'This Question already holds that position.';
    end if;

    select id, prompt into v_occupant_id, v_occupant_prompt
    from public.questions where current_position = p_position;

    -- Flagship protection, direction 2: a different Question already
    -- holding #1 can never be silently evicted by this call.
    if v_occupant_id is not null and p_position = 1 then
      raise exception 'Question #1 is the permanent flagship and cannot be evicted from here.';
    end if;

    -- Any other occupied slot (#2/#3) is simply vacated first — this
    -- is the ordinary, casual re-pin the checkpoint asks for. Two
    -- separate UPDATEs (vacate, then assign) rather than one combined
    -- statement so the partial unique index is never transiently
    -- violated within the same statement's row set.
    if v_occupant_id is not null then
      update public.questions set current_position = null where id = v_occupant_id;
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


-- admin_replace_question — CORRECTION (Question Slots checkpoint):
-- same signature/return type as the live 2026-09-18 definition
-- (uuid, text, boolean, boolean -> uuid), so a plain CREATE OR REPLACE
-- is sufficient. Two changes:
--   1. FLAGSHIP PROTECTION: replacing Question #1 through this control
--      is refused outright — Replace always deactivates (or would
--      evict the position of) the old Question, which is exactly the
--      casual mutation Section A2 forbids for the flagship. A future
--      exceptional flagship-replacement operation is out of scope here
--      (see admin_set_question_position's own comment).
--   2. POSITION CARRY-FORWARD (Section A1/A3): when replacing #2 or
--      #3, the NEW Question automatically inherits the OLD Question's
--      slot the moment the old one is deactivated — "replacing #2
--      must produce a new Question that occupies #2" — with no
--      separate admin_set_question_position call needed. If the admin
--      chooses NOT to deactivate the old Question (p_deactivate_old =
--      false), the old Question keeps its slot (two Questions can
--      never hold the same slot at once), and the replacement is
--      created with no position — an explicit
--      admin_set_question_position call is then needed to place it,
--      exactly as it would be for any other unpositioned library
--      Question.
--   3. ACTIVE/POSITION INVARIANT (Final Correction round, item 3): the
--      carry-forward in (2) above only ever happens when the
--      REPLACEMENT itself will be active — a Question may only occupy
--      #1/#2/#3 while active (questions_current_position_requires_
--      active). If the admin deactivates the old Question AND
--      explicitly passes p_new_active = false, the old slot is still
--      vacated (the old row is being deactivated either way) but the
--      new, inactive row is created UNPOSITIONED — the slot is simply
--      left empty, exactly as if p_deactivate_old had been false.
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
  v_new_prompt text;
  v_new_active boolean;
  v_new_position smallint;
  v_actor_pseudonym text;
  v_new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('admin') then
    raise exception 'Not authorized.';
  end if;

  select prompt, family, is_active, current_position
    into v_old_prompt, v_old_family, v_old_active, v_old_position
  from public.questions where id = p_question_id;

  if v_old_prompt is null then
    raise exception 'Question not found.';
  end if;

  -- NEW: flagship protection.
  if v_old_position = 1 then
    raise exception 'Question #1 is the permanent flagship and cannot be replaced from here.';
  end if;

  v_new_prompt := trim(both from coalesce(p_new_prompt, ''));
  if char_length(v_new_prompt) = 0 then
    raise exception 'A prompt is required.';
  end if;
  if char_length(v_new_prompt) > 2000 then
    raise exception 'Prompt is too long.';
  end if;

  v_new_active := coalesce(p_new_active, v_old_active);

  if coalesce(p_deactivate_old, true) then
    update public.questions set is_active = false, current_position = null where id = p_question_id;
    -- CORRECTION (Final Correction round, item 3): the slot is carried
    -- forward only when the replacement will itself be ACTIVE — a
    -- Question may only occupy #1/#2/#3 while active
    -- (questions_current_position_requires_active). Carrying the old
    -- position forward onto an explicitly-inactive replacement would
    -- attempt to insert is_active = false with current_position set,
    -- which that constraint correctly forbids. When the replacement is
    -- inactive, the slot is simply left empty (never bypassed or
    -- weakened here).
    if v_new_active then
      v_new_position := v_old_position;
    else
      v_new_position := null;
    end if;
  else
    -- Old Question keeps its slot; the replacement starts unpositioned
    -- (two Questions can never share a slot).
    v_new_position := null;
  end if;

  insert into public.questions (prompt, family, is_active, current_position)
  values (v_new_prompt, v_old_family, v_new_active, v_new_position)
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
      'carried_position', v_new_position
    )
  );

  return v_new_id;
end;
$function$;

revoke all on function public.admin_replace_question(uuid, text, boolean, boolean) from public;
grant execute on function public.admin_replace_question(uuid, text, boolean, boolean) to authenticated;


-- ============================================================
-- PART B — PREMIUM ANNOUNCEMENT PUBLISHING
-- ============================================================
-- Codebase-conventions audit performed before writing this section:
-- this app's established pattern (letters, dispatches) is to store
-- ordinary writing as plain `text` with a hand-rolled bold/italic
-- markup encoding, specifically to avoid ever rendering arbitrary rich
-- content (docs/sql comments in lib/letter-editor-doc.ts explain the
-- rationale at length). That pattern only supports two inline marks —
-- it has no representation for headings, bullet lists, or links, all
-- of which this checkpoint explicitly requires. Per this checkpoint's
-- own instruction ("a TipTap-style structured JSON document model is
-- acceptable if no existing solution is present"), `content_json`
-- stores a CLOSED, hand-typed JSON shape (lib/announcement-editor-doc.ts
-- mirrors lib/letter-editor-doc.ts's own LetterDocJSON pattern exactly)
-- — never arbitrary HTML, and the read-side renderer (app/announcement-
-- body.tsx) builds React elements directly from that closed type,
-- exactly like FormattedText does for letters — never
-- dangerouslySetInnerHTML, so there is no HTML-injection surface even
-- from a compromised/malformed document. The existing plain `body`
-- column is RETAINED as a derived plain-text fallback/preview,
-- computed CLIENT-SIDE from content_json before the RPC call (matching
-- how docToPlainBody already works for letters) — the server never
-- needs to parse or trust the rich structure to keep body in sync.

alter table public.announcements
  add column if not exists subtitle text,
  add column if not exists content_json jsonb,
  add column if not exists hero_image_path text,
  add column if not exists published_at timestamptz;

comment on column public.announcements.content_json is
  'Closed-schema structured document (lib/announcement-editor-doc.ts''s AnnouncementDocJSON) — paragraphs, one restrained heading level, bullet lists, bold/italic, links. Never raw HTML. body remains a derived plain-text fallback, computed client-side from this before every write.';

comment on column public.announcements.published_at is
  'Set exactly once, the moment status transitions to ''published'' (admin_publish_announcement) — NOT bumped by later edits to a live Announcement (unlike updated_at, which changes on every edit). This is what get_active_announcement now ranks by: using updated_at for "most recently published wins" was ambiguous once an admin could edit a live Announcement''s copy without re-publishing it — that edit must not reshuffle which of several live Announcements is considered "most recent."';

-- A real (published) Announcement must have a hero image and an
-- explicit end — Drafts may remain incomplete indefinitely. Checked
-- directly on the row itself (status + hero_image_path + ends_at +
-- content_json), never a trigger — simpler, and exactly the "derive
-- from existing columns" approach this checkpoint asks for throughout.
alter table public.announcements
  add constraint announcements_publish_requirements
  check (
    status <> 'published'
    or (hero_image_path is not null and ends_at is not null and content_json is not null)
  );


-- ============================================================
-- FINAL CORRECTION ROUND — server-side Announcement content/link
-- validation (item 1/2), and a genuinely permissive Draft body
-- (item 4). The question-replacement fix is in PART A above; the
-- hero-image existence check is in admin_publish_announcement below.
-- ============================================================

-- Drafts may now be genuinely incomplete: a blank body/content_json is
-- allowed while status = 'draft'. The old UNCONDITIONAL non-blank
-- check (live since 2026-09-18) is replaced with one scoped to
-- status = 'published' — the same "derive from existing columns"
-- pattern as announcements_publish_requirements above, not a trigger.
-- Title stays required at all times (announcements_title_not_blank,
-- untouched) so a Draft still has an identifiable working name.
alter table public.announcements
  drop constraint if exists announcements_body_not_blank;

alter table public.announcements
  add constraint announcements_body_not_blank_when_published
  check (status <> 'published' or char_length(trim(both from body)) > 0);


-- Narrow, TEMPA-specific link policy for Announcement content —
-- deliberately narrower than TipTap's own default protocol allowlist
-- (which also accepts ftp/mailto/tel/sms/callto/xmpp and any bare
-- host with no scheme at all). Only two shapes are ever allowed: an
-- absolute https:// URL, or an internal relative URL beginning with
-- exactly one '/' (protocol-relative '//host' is rejected — it
-- resolves to whatever scheme the page itself was loaded over, which
-- is not a guarantee TEMPA controls). No whitespace/control character
-- is permitted anywhere in the href. An internal relative URL must
-- also contain NO backslash anywhere (SQL Hardening round, item 1) —
-- browser URL parsing treats a backslash as a path separator
-- equivalent to '/', so '/\evil.example' would otherwise parse as a
-- protocol-relative '//evil.example' host reference despite passing
-- the plain "starts with one '/'" check on its own. IMMUTABLE and
-- pure — a function of its text input only — so it's safe and
-- correct to use inside a CHECK constraint.
create or replace function public.announcement_href_is_safe(p_href text)
returns boolean
language sql
immutable
set search_path to 'pg_catalog'
as $$
  select
    p_href is not null
    and char_length(p_href) between 1 and 2048
    and p_href !~ '[[:space:][:cntrl:]]'
    and (
      (p_href like 'https://%' and char_length(p_href) > char_length('https://'))
      or (
        left(p_href, 1) = '/'
        and left(p_href, 2) <> '//'
        and strpos(p_href, chr(92)) = 0
      )
    )
$$;

revoke all on function public.announcement_href_is_safe(text) from public;
grant execute on function public.announcement_href_is_safe(text) to authenticated;


-- The actual runtime structural validator for content_json — the
-- database/RPC boundary TypeScript types alone cannot provide (a
-- direct RPC call bypassing the TipTap editor is not constrained by
-- TypeScript at all). Walks the document recursively, rejecting
-- anything outside the CLOSED shape lib/announcement-editor-doc.ts's
-- AnnouncementDocJSON encodes: doc -> (paragraph | heading[level=2] |
-- bulletList) -> ... -> listItem -> paragraph -> (text | hardBreak),
-- with only bold/italic/link marks on text, and a link's href checked
-- against announcement_href_is_safe above. Any unknown node/mark
-- type, unexpected object key, wrong-typed value (e.g. non-string
-- text), or malformed link attrs makes the whole document invalid.
-- p_kind selects which part of the schema p_node is being checked
-- against at this call ('doc', 'block', 'listItem',
-- 'listItemParagraph', 'inline'); p_depth is a defensive recursion-
-- depth guard against a pathologically deep document — the real
-- schema cannot nest this deep on its own (a bulletList cannot
-- contain another bulletList directly, only via listItem -> paragraph,
-- which has no block content), so this only ever fires on adversarial
-- input, never a real editor-produced document.
create or replace function public.announcement_node_is_valid(p_node jsonb, p_kind text, p_depth int)
returns boolean
language plpgsql
immutable
set search_path to 'pg_catalog'
as $function$
declare
  v_type text;
  v_child jsonb;
  v_marks jsonb;
  v_mark jsonb;
begin
  if p_depth > 12 then
    return false;
  end if;

  if p_node is null or jsonb_typeof(p_node) <> 'object' then
    return false;
  end if;

  v_type := p_node->>'type';

  if p_kind = 'doc' then
    if v_type is distinct from 'doc' then return false; end if;
    if not (select coalesce(bool_and(k in ('type', 'content')), true) from jsonb_object_keys(p_node) k) then
      return false;
    end if;
    if p_node ? 'content' then
      if jsonb_typeof(p_node->'content') <> 'array' then return false; end if;
      for v_child in select jsonb_array_elements(p_node->'content') loop
        if not public.announcement_node_is_valid(v_child, 'block', p_depth + 1) then
          return false;
        end if;
      end loop;
    end if;
    return true;
  end if;

  if p_kind = 'block' then
    if v_type = 'paragraph' then
      if not (select coalesce(bool_and(k in ('type', 'content')), true) from jsonb_object_keys(p_node) k) then
        return false;
      end if;
      if p_node ? 'content' then
        if jsonb_typeof(p_node->'content') <> 'array' then return false; end if;
        for v_child in select jsonb_array_elements(p_node->'content') loop
          if not public.announcement_node_is_valid(v_child, 'inline', p_depth + 1) then
            return false;
          end if;
        end loop;
      end if;
      return true;
    elsif v_type = 'heading' then
      if not (select coalesce(bool_and(k in ('type', 'attrs', 'content')), true) from jsonb_object_keys(p_node) k) then
        return false;
      end if;
      if (not (p_node ? 'attrs')) or (jsonb_typeof(p_node->'attrs') <> 'object') then
        return false;
      end if;
      if not (select coalesce(bool_and(k = 'level'), true) from jsonb_object_keys(p_node->'attrs') k) then
        return false;
      end if;
      if jsonb_typeof(p_node->'attrs'->'level') <> 'number' or (p_node->'attrs'->>'level') is distinct from '2' then
        return false;
      end if;
      if p_node ? 'content' then
        if jsonb_typeof(p_node->'content') <> 'array' then return false; end if;
        for v_child in select jsonb_array_elements(p_node->'content') loop
          if not public.announcement_node_is_valid(v_child, 'inline', p_depth + 1) then
            return false;
          end if;
        end loop;
      end if;
      return true;
    elsif v_type = 'bulletList' then
      if not (select coalesce(bool_and(k in ('type', 'content')), true) from jsonb_object_keys(p_node) k) then
        return false;
      end if;
      if p_node ? 'content' then
        if jsonb_typeof(p_node->'content') <> 'array' then return false; end if;
        for v_child in select jsonb_array_elements(p_node->'content') loop
          if not public.announcement_node_is_valid(v_child, 'listItem', p_depth + 1) then
            return false;
          end if;
        end loop;
      end if;
      return true;
    else
      return false;
    end if;
  end if;

  if p_kind = 'listItem' then
    if v_type is distinct from 'listItem' then return false; end if;
    if not (select coalesce(bool_and(k in ('type', 'content')), true) from jsonb_object_keys(p_node) k) then
      return false;
    end if;
    if p_node ? 'content' then
      if jsonb_typeof(p_node->'content') <> 'array' then return false; end if;
      for v_child in select jsonb_array_elements(p_node->'content') loop
        if not public.announcement_node_is_valid(v_child, 'listItemParagraph', p_depth + 1) then
          return false;
        end if;
      end loop;
    end if;
    return true;
  end if;

  if p_kind = 'listItemParagraph' then
    if v_type is distinct from 'paragraph' then return false; end if;
    return public.announcement_node_is_valid(p_node, 'block', p_depth);
  end if;

  if p_kind = 'inline' then
    if v_type = 'text' then
      if not (select coalesce(bool_and(k in ('type', 'text', 'marks')), true) from jsonb_object_keys(p_node) k) then
        return false;
      end if;
      if jsonb_typeof(p_node->'text') <> 'string' then
        return false;
      end if;
      if p_node ? 'marks' then
        v_marks := p_node->'marks';
        if jsonb_typeof(v_marks) <> 'array' then return false; end if;
        for v_mark in select jsonb_array_elements(v_marks) loop
          if jsonb_typeof(v_mark) <> 'object' then return false; end if;
          if (v_mark->>'type') in ('bold', 'italic') then
            if not (select coalesce(bool_and(k = 'type'), true) from jsonb_object_keys(v_mark) k) then
              return false;
            end if;
          elsif (v_mark->>'type') = 'link' then
            if not (select coalesce(bool_and(k in ('type', 'attrs')), true) from jsonb_object_keys(v_mark) k) then
              return false;
            end if;
            if (not (v_mark ? 'attrs')) or (jsonb_typeof(v_mark->'attrs') <> 'object') then
              return false;
            end if;
            if not (select coalesce(bool_and(k = 'href'), true) from jsonb_object_keys(v_mark->'attrs') k) then
              return false;
            end if;
            if jsonb_typeof(v_mark->'attrs'->'href') <> 'string' then
              return false;
            end if;
            if not public.announcement_href_is_safe(v_mark->'attrs'->>'href') then
              return false;
            end if;
          else
            return false;
          end if;
        end loop;
      end if;
      return true;
    elsif v_type = 'hardBreak' then
      if not (select coalesce(bool_and(k = 'type'), true) from jsonb_object_keys(p_node) k) then
        return false;
      end if;
      return true;
    else
      return false;
    end if;
  end if;

  return false;
end;
$function$;

revoke all on function public.announcement_node_is_valid(jsonb, text, int) from public;
grant execute on function public.announcement_node_is_valid(jsonb, text, int) to authenticated;


-- Entry point — the only validator name the table CHECK constraint and
-- the admin RPCs below actually call. Also caps the total serialized
-- size of a document (a blanket guard against a wide-but-shallow
-- pathological payload, e.g. thousands of sibling text nodes, that a
-- depth-only guard would not catch) before recursing at all.
create or replace function public.announcement_content_is_valid(p_doc jsonb)
returns boolean
language plpgsql
immutable
set search_path to 'pg_catalog'
as $function$
begin
  if p_doc is null then
    return false;
  end if;
  if jsonb_typeof(p_doc) <> 'object' then
    return false;
  end if;
  if pg_column_size(p_doc) > 200000 then
    return false;
  end if;
  return public.announcement_node_is_valid(p_doc, 'doc', 0);
end;
$function$;

revoke all on function public.announcement_content_is_valid(jsonb) from public;
grant execute on function public.announcement_content_is_valid(jsonb) to authenticated;


-- SQL Hardening round, item 2 — announcement_content_is_valid proves
-- content_json is STRUCTURALLY well-formed, but a structurally valid
-- document can still be entirely empty (e.g. one blank paragraph).
-- Publish integrity previously leaned on the separate plain-text
-- `body` column to prove real content exists, but body and
-- content_json are only kept in sync by ordinary UI behavior — a
-- direct RPC call could submit a valid-but-empty content_json paired
-- with an unrelated non-blank body and slip past every existing
-- check. This walks the document looking for at least one text node
-- whose text is non-blank after trimming; hardBreak nodes, empty
-- paragraphs/headings/bullet items, and whitespace-only text all
-- correctly contribute nothing. Deliberately generic rather than
-- re-deriving the full node/mark type-checking announcement_node_is_
-- valid already does — it only cares whether 'content' arrays lead to
-- real text anywhere, and is always called alongside announcement_
-- content_is_valid (never as a standalone validity proof) in
-- admin_publish_announcement below. Same depth guard as announcement_
-- node_is_valid, for the same reason (defense against a pathologically
-- deep document, independent of any evaluation-order assumption
-- between the two AND'd checks in admin_publish_announcement).
create or replace function public.announcement_content_has_text(p_node jsonb, p_depth int default 0)
returns boolean
language plpgsql
immutable
set search_path to 'pg_catalog'
as $function$
declare
  v_type text;
  v_child jsonb;
begin
  if p_depth > 12 then
    return false;
  end if;

  if p_node is null or jsonb_typeof(p_node) <> 'object' then
    return false;
  end if;

  v_type := p_node->>'type';

  if v_type = 'text' then
    return jsonb_typeof(p_node->'text') = 'string' and length(trim(both from (p_node->>'text'))) > 0;
  end if;

  if p_node ? 'content' and jsonb_typeof(p_node->'content') = 'array' then
    for v_child in select jsonb_array_elements(p_node->'content') loop
      if public.announcement_content_has_text(v_child, p_depth + 1) then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$function$;

revoke all on function public.announcement_content_has_text(jsonb, int) from public;
grant execute on function public.announcement_content_has_text(jsonb, int) to authenticated;


-- The actual database/RPC-boundary enforcement (item 1) — a malformed
-- or adversarial content_json can no longer be written by ANY path,
-- including a direct RPC call that bypasses the TipTap editor
-- entirely. A null content_json (an incomplete Draft, item 4) is still
-- allowed; once non-null, it must pass the validator above.
alter table public.announcements
  add constraint announcements_content_json_valid
  check (content_json is null or public.announcement_content_is_valid(content_json));


-- admin_list_announcements gains the new columns — a return-type
-- column list change requires the function to be dropped first.
drop function if exists public.admin_list_announcements();

create or replace function public.admin_list_announcements()
returns table (
  id uuid,
  title text,
  subtitle text,
  body text,
  content_json jsonb,
  hero_image_path text,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  published_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
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
      a.id, a.title, a.subtitle, a.body, a.content_json, a.hero_image_path, a.status,
      a.starts_at, a.ends_at, a.published_at, a.created_at, a.updated_at
    from public.announcements a
    order by a.created_at desc;
end;
$function$;

revoke all on function public.admin_list_announcements() from public;
grant execute on function public.admin_list_announcements() to authenticated;


-- admin_create_announcement — gains subtitle/content_json/
-- hero_image_path. Adding parameters changes the function's identity
-- (Postgres distinguishes overloads by parameter type LIST) — the old
-- 4-parameter signature must be dropped explicitly so it doesn't
-- linger as a separate, stale-privileged overload.
drop function if exists public.admin_create_announcement(text, text, timestamptz, timestamptz);

create or replace function public.admin_create_announcement(
  p_title text,
  p_body text,
  p_subtitle text default null,
  p_content_json jsonb default null,
  p_hero_image_path text default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_title text;
  v_body text;
  v_subtitle text;
  v_new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('admin') then
    raise exception 'Not authorized.';
  end if;

  v_title := trim(both from coalesce(p_title, ''));
  v_body := trim(both from coalesce(p_body, ''));
  if char_length(v_title) = 0 then
    raise exception 'A title is required.';
  end if;
  -- CORRECTION (Final Correction round, item 4): a Draft may now be
  -- saved with no body/content at all — only admin_publish_announcement
  -- below requires real content. announcements_body_not_blank_when_
  -- published is the actual backstop, scoped to status = 'published'.
  if p_starts_at is not null and p_ends_at is not null and p_starts_at > p_ends_at then
    raise exception 'The start time must be before the end time.';
  end if;
  -- CORRECTION (item 1): a friendly, specific rejection for malformed
  -- content — announcements_content_json_valid remains the actual hard
  -- backstop either way, enforced on the column itself regardless of
  -- which RPC (or a direct call) performs the write.
  if p_content_json is not null and not public.announcement_content_is_valid(p_content_json) then
    raise exception 'The announcement body contains unsupported content.';
  end if;

  v_subtitle := nullif(trim(both from coalesce(p_subtitle, '')), '');

  -- A Draft may be created with no hero image, no content_json, no
  -- dates at all — announcements_publish_requirements only ever fires
  -- for status = 'published', and this RPC always inserts as 'draft'.
  insert into public.announcements (
    title, subtitle, body, content_json, hero_image_path, starts_at, ends_at, created_by, status
  ) values (
    v_title, v_subtitle, v_body, p_content_json, p_hero_image_path, p_starts_at, p_ends_at, auth.uid(), 'draft'
  )
  returning id into v_new_id;

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action, target_type, target_id, target_identifier_snapshot
  ) values (
    auth.uid(), coalesce((select pseudonym from public.profiles where id = auth.uid()), auth.uid()::text),
    'announcement_created', 'announcement', v_new_id, v_title
  );

  return v_new_id;
end;
$function$;

revoke all on function public.admin_create_announcement(text, text, text, jsonb, text, timestamptz, timestamptz) from public;
grant execute on function public.admin_create_announcement(text, text, text, jsonb, text, timestamptz, timestamptz) to authenticated;


-- admin_update_announcement — same parameter-identity concern as
-- admin_create_announcement above; the old 5-parameter signature is
-- dropped explicitly. No immutability rule (unlike Questions):
-- Announcements may be edited freely regardless of status, including
-- a currently-live one (Section B5 — "edit the end date / extend a
-- live Announcement" is an ordinary, expected operation here).
drop function if exists public.admin_update_announcement(uuid, text, text, timestamptz, timestamptz);

create or replace function public.admin_update_announcement(
  p_announcement_id uuid,
  p_title text,
  p_body text,
  p_subtitle text default null,
  p_content_json jsonb default null,
  p_hero_image_path text default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_status text;
  v_title text;
  v_body text;
  v_subtitle text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('admin') then
    raise exception 'Not authorized.';
  end if;

  select status into v_status from public.announcements where id = p_announcement_id;
  if v_status is null then
    raise exception 'Announcement not found.';
  end if;

  v_title := trim(both from coalesce(p_title, ''));
  v_body := trim(both from coalesce(p_body, ''));
  if char_length(v_title) = 0 then
    raise exception 'A title is required.';
  end if;
  -- CORRECTION (item 4): a Draft's body/content may be edited down to
  -- blank again (e.g. clearing a paragraph while rewriting) without
  -- this RPC refusing the save. A currently-PUBLISHED announcement is
  -- different — Announcements may be edited freely regardless of
  -- status (see admin_archive_announcement's own comment below), but
  -- editing a LIVE one down to a blank body would otherwise hit
  -- announcements_body_not_blank_when_published as a raw constraint
  -- error; this friendly pre-check catches it first.
  if v_status = 'published' and char_length(v_body) = 0 then
    raise exception 'A live announcement cannot be edited down to a blank body. Deactivate it first if you need to.';
  end if;
  -- CORRECTION (item 1): same friendly pre-check as
  -- admin_create_announcement — announcements_content_json_valid is
  -- the actual hard backstop either way.
  if p_content_json is not null and not public.announcement_content_is_valid(p_content_json) then
    raise exception 'The announcement body contains unsupported content.';
  end if;

  v_subtitle := nullif(trim(both from coalesce(p_subtitle, '')), '');

  update public.announcements
  set title = v_title,
      subtitle = v_subtitle,
      body = v_body,
      content_json = coalesce(p_content_json, content_json),
      hero_image_path = coalesce(p_hero_image_path, hero_image_path),
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      updated_at = now()
  where id = p_announcement_id;

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action, target_type, target_id, target_identifier_snapshot
  ) values (
    auth.uid(), coalesce((select pseudonym from public.profiles where id = auth.uid()), auth.uid()::text),
    'announcement_updated', 'announcement', p_announcement_id, v_title
  );
end;
$function$;

revoke all on function public.admin_update_announcement(uuid, text, text, text, jsonb, text, timestamptz, timestamptz) from public;
grant execute on function public.admin_update_announcement(uuid, text, text, text, jsonb, text, timestamptz, timestamptz) to authenticated;


-- admin_publish_announcement — signature/return type unchanged (plain
-- CREATE OR REPLACE, no drop needed). Changes: a friendly, specific
-- pre-check for the publish requirements (hero image + end date +
-- structured body), so a rejected publish attempt reads as clear
-- product guidance rather than a raw constraint-violation error
-- (announcements_publish_requirements/announcements_body_not_blank_
-- when_published/announcements_content_json_valid remain the actual
-- hard backstops either way); a real body non-blank check (item 4 —
-- content_json being non-null is not by itself enough, since a Draft's
-- content_json can be structurally valid but empty, e.g. one blank
-- paragraph); a hero-image EXISTENCE check against storage itself
-- (item 5), not just the path being non-null; and, as of the SQL
-- Hardening round, an explicit requirement that content_json itself
-- (not merely the separate body column) is BOTH structurally valid
-- AND contains real text (announcement_content_is_valid AND
-- announcement_content_has_text) — closing the gap where a direct RPC
-- call could pair a valid-but-empty content_json with an unrelated
-- non-blank body and slip past every previous check; body remains an
-- additional backstop, not the sole proof. Also stamps published_at —
-- see that column's own comment for why this is tracked separately
-- from updated_at.
create or replace function public.admin_publish_announcement(p_announcement_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_status text;
  v_title text;
  v_body text;
  v_hero_image_path text;
  v_ends_at timestamptz;
  v_content_json jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('admin') then
    raise exception 'Not authorized.';
  end if;

  select status, title, body, hero_image_path, ends_at, content_json
    into v_status, v_title, v_body, v_hero_image_path, v_ends_at, v_content_json
  from public.announcements where id = p_announcement_id;

  if v_status is null then
    raise exception 'Announcement not found.';
  end if;
  if v_status = 'published' then
    raise exception 'This announcement is already published.';
  end if;

  if v_hero_image_path is null then
    raise exception 'A hero image is required before publishing.';
  end if;
  -- CORRECTION (item 5): a hero_image_path pointing at nothing — the
  -- upload failed partway, or the object was since removed some other
  -- way — must not silently publish a broken image. Reusing
  -- storage.objects itself as the existence check keeps this simple
  -- (no separate bucket-listing machinery); this function is already
  -- SECURITY DEFINER, the same trust boundary every other admin write
  -- RPC in this codebase already relies on.
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'announcement-images' and name = v_hero_image_path
  ) then
    raise exception 'The hero image could not be found in storage. Please re-upload it.';
  end if;
  if v_ends_at is null then
    raise exception 'An end date and time is required before publishing.';
  end if;
  if v_content_json is null then
    raise exception 'A body is required before publishing.';
  end if;
  -- CORRECTION (SQL Hardening round, item 2): content_json being
  -- non-null is not enough on its own — nor is a non-blank body column
  -- alone sufficient proof, since a direct RPC call can submit them
  -- independently of each other. content_json itself must be both
  -- structurally valid and contain real text. announcement_content_is_
  -- valid is already guaranteed by announcements_content_json_valid on
  -- the column at all times, but is re-checked explicitly here too —
  -- this RPC-level check does not depend on that constraint continuing
  -- to exist.
  if not public.announcement_content_is_valid(v_content_json) then
    raise exception 'The announcement body contains unsupported content.';
  end if;
  if not public.announcement_content_has_text(v_content_json) then
    raise exception 'A body is required before publishing.';
  end if;
  -- CORRECTION (item 4): body is the derived plain-text fallback, kept
  -- in sync with content_json on every write
  -- (lib/announcement-editor-doc.ts's docToPlainText) — this remains
  -- an ADDITIONAL backstop (backwards compatibility), not the sole
  -- proof of real content now that the two checks above exist.
  if char_length(trim(both from coalesce(v_body, ''))) = 0 then
    raise exception 'A body is required before publishing.';
  end if;

  update public.announcements
  set status = 'published', published_at = now(), updated_at = now()
  where id = p_announcement_id;

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action, target_type, target_id, target_identifier_snapshot
  ) values (
    auth.uid(), coalesce((select pseudonym from public.profiles where id = auth.uid()), auth.uid()::text),
    'announcement_published', 'announcement', p_announcement_id, v_title
  );
end;
$function$;

revoke all on function public.admin_publish_announcement(uuid) from public;
grant execute on function public.admin_publish_announcement(uuid) to authenticated;

-- admin_archive_announcement is UNCHANGED — its existing behavior
-- (moves a published Announcement, live OR scheduled-but-not-yet-
-- started, to 'archived', with the same idempotency guard) already
-- covers both "Deactivate a currently Live Announcement immediately"
-- and "cancel/deactivate a Scheduled Announcement before it begins"
-- (Section B5) for free — a Scheduled Announcement is simply a
-- published one whose starts_at is still in the future, not a
-- separate status value (see the derived-states discussion in
-- lib/announcements.ts). Nothing here needed changing.


-- get_active_announcement — gains subtitle/content_json/
-- hero_image_path and now ranks by published_at (see that column's own
-- comment) instead of updated_at. Return-type column list changes ->
-- dropped and recreated.
drop function if exists public.get_active_announcement();

create or replace function public.get_active_announcement()
returns table (id uuid, title text, subtitle text, body text, content_json jsonb, hero_image_path text)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  return query
    select a.id, a.title, a.subtitle, a.body, a.content_json, a.hero_image_path
    from public.announcements a
    where a.status = 'published'
      and (a.starts_at is null or a.starts_at <= now())
      and (a.ends_at is null or a.ends_at >= now())
    order by a.published_at desc nulls last
    limit 1;
end;
$function$;

revoke all on function public.get_active_announcement() from public;
grant execute on function public.get_active_announcement() to authenticated;


-- ============================================================
-- ANNOUNCEMENT HERO IMAGE STORAGE — own bucket, own policies
-- ============================================================
-- Conventions matched exactly from the existing dispatch-photos bucket
-- (docs/sql/2026-09-07-dispatches-and-board.sql): private bucket,
-- path keyed by the UPLOADING admin's own user id (not the
-- Announcement id — a hero image is chosen while composing, often
-- before the Announcement row is saved at all, the same chicken-and-
-- egg reason dispatch-photos keys by author rather than dispatch),
-- explicit `to authenticated` on every policy (docs/sql/2026-09-10-
-- letter-photos-select-role-scope-fix.sql's own hard-learned lesson:
-- an implicit PUBLIC-role policy can still be evaluated for an anon
-- caller hitting an unrelated bucket and hard-error instead of
-- cleanly denying), and a SECURITY INVOKER/STABLE visibility helper
-- function rather than inlining the exists(...) check twice.
-- file_size_limit/allowed_mime_types are enforced by Supabase Storage
-- itself at the bucket level — real server-side validation beyond
-- client trust, on top of the client-side re-encode/resize
-- (lib/image-processing.ts's processImageForUpload, reused unchanged).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('announcement-images', 'announcement-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.announcement_image_is_visible(p_path text)
returns boolean
language sql
security invoker
set search_path to 'public'
stable
as $$
  select
    auth.uid()::text = (storage.foldername(p_path))[1]
    or exists (
      select 1
      from public.announcements a
      where a.hero_image_path = p_path
        and a.status = 'published'
        and (a.starts_at is null or a.starts_at <= now())
        and (a.ends_at is null or a.ends_at >= now())
    )
$$;

revoke all on function public.announcement_image_is_visible(text) from public;
grant execute on function public.announcement_image_is_visible(text) to authenticated;

create policy announcement_images_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'announcement-images'
    and public.is_staff('admin')
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy announcement_images_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'announcement-images'
    and public.announcement_image_is_visible(name)
  );

-- No UPDATE/DELETE storage policy — same immutability convention as
-- letter-photos/dispatch-photos: an uploaded-but-never-attached hero
-- image is a known, accepted orphan. Deactivating/archiving an
-- Announcement never deletes its hero_image_path or the underlying
-- object, so a historical record's image never breaks (Section B3).

commit;
