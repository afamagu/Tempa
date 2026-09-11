-- ============================================================
-- TEMPA — ADMIN OPERATIONS REFINEMENT
-- ============================================================
-- STATUS: APPLIED LIVE: 2026-09-11. VERIFIED LIVE: 2026-09-11 —
-- admin_create_question, admin_replace_question, admin_list_questions,
-- admin_list_members, the new paginated admin_list_reports (old
-- single-integer overload confirmed removed), the announcements table
-- + RLS + all announcement RPCs, the set_current_answer/
-- publish_question_answer canonical/slug gate removal, the
-- not-has_current promotion rule, and the inactive-Question server
-- guard all independently verified against the live database.
--
-- Builds on docs/sql/2026-09-10-admin-moderation-and-questions.sql and
-- docs/sql/2026-09-17-reporting-and-admin-moderation.sql. This
-- checkpoint makes the existing Admin Control Room operationally
-- useful: full Questions library management (create/edit/replace),
-- a server-paginated Members directory with filters, a scalable
-- Moderation report queue, and a new V1 in-app Announcements feature.
-- No existing authorization boundary is weakened — every new/changed
-- RPC follows the exact conventions already established (security
-- definer, set search_path to 'pg_catalog', is_staff() checked first,
-- admin_audit_log write in the same transaction as the mutation,
-- explicit revoke/grant).
--
-- ============================================================
-- 1. QUESTIONS — full library management, DB IS THE SOURCE OF TRUTH
-- ============================================================
-- CORRECTION (Question source-of-truth review): this section was
-- initially written as pure admin-side scaffolding, on the mistaken
-- premise that a newly created/replaced Question could never reach
-- members anyway because the member-facing runtime was hardcoded to
-- CANONICAL_QUESTION_SLUGS (lib/questions.ts) and set_current_answer/
-- publish_question_answer independently required `slug is not null` at
-- the DATABASE level. That was a real architectural gap: Admin's
-- Create/Replace/Activate controls would have been non-functional
-- theater. This section (and the member-facing RPCs below it) now make
-- the database the genuine, complete source of truth for which
-- Questions members can see, answer, and feature:
--   - `is_active = true` is the ONLY gate for "offered to answer fresh"
--     — no slug/canonical membership check anywhere anymore.
--   - `family` (added 2026-09-01, previously unused at runtime) now
--     actually drives the "up to three, family-diverse" selection the
--     column was always intended for (see docs/sql/2026-09-01-
--     question-families.sql's own design comment).
--   - set_current_answer and publish_question_answer (both amended
--     further down this file) no longer require `slug is not null` —
--     any of a member's own visible answers, to any Question, may be
--     their featured Minds answer.
--   - slug remains a legitimate, stable identifier for the 3 originally
--     seeded Questions (and any future curator wants to name similarly)
--     — it simply no longer GATES member-reachability.
--
-- Previously admin-facing Questions management (admin_list_questions,
-- admin_set_question_active, admin_update_question_prompt) was scoped
-- to the 3 canonical Questions only (`slug is not null`), with no
-- Create control at all (Decision 2, Phase 2A-1 — an admin-created row
-- would never reach a member under the CANONICAL_QUESTION_SLUGS-driven
-- runtime, so a Create button would have been a fake control). That
-- premise is now corrected — see above.
--
-- This checkpoint widens all three RPCs to operate on the FULL
-- questions table (not just canonical rows) and adds two new RPCs
-- (admin_create_question, admin_replace_question), so the owner can
-- build out and curate a larger Question library from Admin. A newly
-- created Question starts inactive and non-canonical (`slug = null`) —
-- but activating it now genuinely, immediately makes it eligible for
-- member Question selection (see section 1b below). Per the
-- checkpoint's own instruction, the current live flagship Questions are
-- NOT being replaced here — this only builds the management surface.
--
-- The LOCKED immutability rule is unchanged and still enforced here,
-- widened to any Question (not just canonical ones): a Question with
-- >= 1 answer can never have its prompt edited in place. Replacement
-- is the only path forward for an answered Question, and it can only
-- ever ADD a new question row — it never rewrites or reassigns any
-- historical question_answers row.

-- admin_list_questions gains family/created_at columns and now returns
-- every Question, not just canonical ones — a return-type column list
-- change requires the function to be dropped first (CREATE OR REPLACE
-- cannot alter a RETURNS TABLE column list).
drop function if exists public.admin_list_questions();

create or replace function public.admin_list_questions()
returns table (
  id uuid,
  slug text,
  family text,
  prompt text,
  is_active boolean,
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
      (select count(*) from public.question_answers qa where qa.question_id = q.id),
      (
        select count(*) from public.letters l
        join public.question_answers qa2 on qa2.id = l.question_answer_id
        where qa2.question_id = q.id
      ),
      q.created_at
    from public.questions q
    order by q.created_at desc nulls last, q.prompt;
end;
$function$;

revoke all on function public.admin_list_questions() from public;
grant execute on function public.admin_list_questions() to authenticated;


-- admin_set_question_active — unchanged behavior/signature, only the
-- lookup's `and slug is not null` restriction is dropped so it can
-- activate/deactivate ANY Question, not just canonical ones.
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

  select prompt, is_active into v_prompt, v_was_active
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

  update public.questions set is_active = p_active where id = p_question_id;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text),
    case when p_active then 'question_activated' else 'question_deactivated' end,
    'question', p_question_id, v_prompt,
    jsonb_build_object('is_active', p_active)
  );
end;
$function$;

revoke all on function public.admin_set_question_active(uuid, boolean) from public;
grant execute on function public.admin_set_question_active(uuid, boolean) to authenticated;


-- admin_update_question_prompt — unchanged behavior/signature, only the
-- lookup's `and slug is not null` restriction is dropped. The LOCKED
-- immutability rule (>= 1 answer rejects the edit) and the "must be
-- deactivated first" rule are both unchanged and apply to every
-- Question, canonical or not.
create or replace function public.admin_update_question_prompt(p_question_id uuid, p_prompt text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_prompt text;
  v_actor_pseudonym text;
  v_is_active boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('admin') then
    raise exception 'Not authorized.';
  end if;

  select is_active into v_is_active
  from public.questions
  where id = p_question_id;

  if v_is_active is null then
    raise exception 'Question not found.';
  end if;

  if v_is_active then
    raise exception 'This Question is currently active. Deactivate it before editing the prompt.';
  end if;

  v_prompt := trim(both from coalesce(p_prompt, ''));
  if char_length(v_prompt) = 0 then
    raise exception 'A prompt is required.';
  end if;
  if char_length(v_prompt) > 2000 then
    raise exception 'Prompt is too long.';
  end if;

  if exists (select 1 from public.question_answers where question_id = p_question_id) then
    raise exception 'This Question already has answers and its prompt cannot be changed.';
  end if;

  update public.questions set prompt = v_prompt where id = p_question_id;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'question_updated',
    'question', p_question_id, v_prompt
  );
end;
$function$;

revoke all on function public.admin_update_question_prompt(uuid, text) from public;
grant execute on function public.admin_update_question_prompt(uuid, text) to authenticated;


-- NEW — admin_create_question. Admin-only. Always creates a brand new,
-- inactive, non-canonical Question (slug is left null — see the
-- section header above for why this is deliberately never enough on
-- its own to reach a member). family is optional free text, matching
-- the existing questions.family column (added 2026-09-01, no CHECK
-- enum).
create or replace function public.admin_create_question(p_prompt text, p_family text default null)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_prompt text;
  v_family text;
  v_actor_pseudonym text;
  v_new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('admin') then
    raise exception 'Not authorized.';
  end if;

  v_prompt := trim(both from coalesce(p_prompt, ''));
  if char_length(v_prompt) = 0 then
    raise exception 'A prompt is required.';
  end if;
  if char_length(v_prompt) > 2000 then
    raise exception 'Prompt is too long.';
  end if;

  v_family := nullif(trim(both from coalesce(p_family, '')), '');

  insert into public.questions (prompt, family, is_active)
  values (v_prompt, v_family, false)
  returning id into v_new_id;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'question_created',
    'question', v_new_id, v_prompt, jsonb_build_object('family', v_family)
  );

  return v_new_id;
end;
$function$;

revoke all on function public.admin_create_question(text, text) from public;
grant execute on function public.admin_create_question(text, text) to authenticated;


-- admin_replace_question. The safe workflow for an ANSWERED Question
-- that needs different wording. Never rewrites or reassigns any
-- question_answers row — it only ever inserts a brand new Question row
-- and optionally deactivates the OLD Question, in the SAME function
-- invocation (Postgres runs one plpgsql function body as a single
-- transaction — there is no intermediate state a concurrent reader can
-- observe between the two writes). The old Question and every one of
-- its historical answers are completely untouched in wording.
--
-- CORRECTION (Question source-of-truth review, item 3): the first draft
-- of this function always created the replacement INACTIVE, which made
-- Replace operationally counter-intuitive for the common case — an
-- admin replacing a live, answered, ACTIVE Question expects the
-- revised version to take over immediately, not to silently vanish
-- from what members are offered. New parameter `p_new_active` (default
-- null): null means "mirror the OLD Question's is_active value at the
-- time of this call" (old active -> new active; old inactive -> new
-- inactive) — the operationally intuitive default the review asked
-- for. An admin may still pass an explicit true/false to override that
-- default (e.g. deliberately create the replacement inactive even
-- though the old Question was active, to stage it before going live).
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
  v_new_prompt text;
  v_new_active boolean;
  v_actor_pseudonym text;
  v_new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('admin') then
    raise exception 'Not authorized.';
  end if;

  select prompt, family, is_active into v_old_prompt, v_old_family, v_old_active
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

  -- Mirrors the OLD Question's active state at call time unless the
  -- admin explicitly overrides it — computed BEFORE the old row is
  -- touched below, so "mirror" always means "what it was", never
  -- "what it becomes".
  v_new_active := coalesce(p_new_active, v_old_active);

  -- The one and only write to any pre-existing row: an optional
  -- deactivation of the OLD Question. Its prompt, family, slug and
  -- every one of its question_answers rows are never touched.
  if coalesce(p_deactivate_old, true) then
    update public.questions set is_active = false where id = p_question_id;
  end if;

  insert into public.questions (prompt, family, is_active)
  values (v_new_prompt, v_old_family, v_new_active)
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
      'new_active', v_new_active
    )
  );

  return v_new_id;
end;
$function$;

revoke all on function public.admin_replace_question(uuid, text, boolean, boolean) from public;
grant execute on function public.admin_replace_question(uuid, text, boolean, boolean) to authenticated;


-- ============================================================
-- 1b. MEMBER-FACING QUESTION RPCs — the DB-level canonical-only gates
--     removed (Question source-of-truth correction)
-- ============================================================
-- These two functions are reproduced in FULL from their current live
-- definition (docs/sql/2026-09-10-admin-moderation-and-questions.sql)
-- and amended here, matching this codebase's own established migration
-- convention of always re-pasting a complete function body rather than
-- a partial ALTER, even for a targeted change. Both keep their exact
-- existing signature (set_current_answer(uuid), publish_question_answer
-- (uuid, text)) and return type, so a plain CREATE OR REPLACE is
-- sufficient — no DROP needed, since nothing about what a caller passes
-- in or gets back has changed, only the internal `slug is not null`
-- gate has been removed.
--
-- set_current_answer — the ONLY change from its 2026-09-10 definition:
-- the existence check no longer requires `q.slug is not null`. A
-- member may now feature ANY of their own visible answers, to any
-- Question in the library, as their one Minds-shown answer — exactly
-- the same "exactly one current answer" invariant as before (the
-- partial unique index question_answers_one_current_per_user is
-- untouched and still enforces it), just no longer artificially scoped
-- to the 3 original slugs. Error message updated to match (no more
-- "one of the three canonical Questions" — that phrase is no longer
-- true).
create or replace function public.set_current_answer(p_answer_id uuid)
returns public.question_answers
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  result public.question_answers;
begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'This action is not available right now.';
  end if;

  if not exists (
    select 1
    from public.question_answers qa
    where qa.id = p_answer_id
      and qa.user_id = auth.uid()
      and qa.moderation_status = 'visible'
  ) then
    raise exception 'Only one of your own, visible answers can be shown in Minds.';
  end if;

  -- Never touch a hidden row while demoting the member's other answers
  -- — a hidden row is frozen, is_current included.
  update public.question_answers
  set is_current = false
  where user_id = auth.uid()
    and id <> p_answer_id
    and moderation_status = 'visible';

  update public.question_answers
  set is_current = true
  where id = p_answer_id
  returning *
  into result;

  return result;

end;
$function$;

revoke all on function public.set_current_answer(uuid) from public;
grant execute on function public.set_current_answer(uuid) to authenticated;


-- publish_question_answer — the ONLY change from its 2026-09-10
-- definition: `should_promote` no longer requires the Question to be
-- canonical (`is_canonical`) — a member's first-ever answer to ANY
-- active Question now auto-features it, exactly like the original
-- (pre-canonical) behavior. `is_canonical`/the `slug is not null`
-- lookup is removed entirely; `question_is_active` is still read and
-- still enforced (a Question that exists but isn't active accepts no
-- write at all, insert or edit alike — unchanged).
create or replace function public.publish_question_answer(p_question_id uuid, p_body text)
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
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  -- restricted/suspended/banned may not publish/set a new public
  -- answer. This is an account-status check only — publishing your own
  -- answer is never a pairwise action, so no block check applies here.
  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'This action is not available right now.';
  end if;

  select is_active into question_is_active
  from public.questions
  where id = p_question_id;

  -- A Question that exists but is not active accepts no write at all,
  -- insert or edit alike. A nonexistent p_question_id leaves
  -- question_is_active null and falls through to the pre-existing
  -- foreign-key-violation behavior on insert, unchanged.
  if question_is_active is not null and not question_is_active then
    raise exception 'This Question is no longer accepting answers.';
  end if;

  -- The member's own existing row for this Question, if any, must not
  -- currently be hidden — a member cannot edit their way out from
  -- under an active moderation action.
  select moderation_status into existing_moderation_status
  from public.question_answers
  where user_id = auth.uid() and question_id = p_question_id;

  if existing_moderation_status = 'hidden' then
    raise exception 'This answer has been hidden and cannot be edited.';
  end if;

  select exists (
    select 1 from public.question_answers
    where user_id = auth.uid() and is_current = true
  ) into has_current;

  -- CORRECTION: previously `coalesce(is_canonical, false) and not
  -- has_current` — canonical membership is no longer a precondition. A
  -- member's first-ever answer to ANY active Question becomes their
  -- featured one, exactly like the pre-canonical original rule.
  should_promote := not has_current;

  if should_promote then
    update public.question_answers
    set is_current = false
    where user_id = auth.uid()
      and question_id <> p_question_id;
  end if;

  insert into public.question_answers (user_id, question_id, body, is_current, updated_at)
  values (auth.uid(), p_question_id, p_body, should_promote, now())
  on conflict (user_id, question_id)
  do update set
    body = excluded.body,
    updated_at = now(),
    is_current = case when should_promote then true else public.question_answers.is_current end
  returning * into result;

  return result;
end;
$function$;

revoke all on function public.publish_question_answer(uuid, text) from public;
grant execute on function public.publish_question_answer(uuid, text) to authenticated;


-- ============================================================
-- 2. MEMBERS — server-paginated default directory + filters
-- ============================================================
-- Previously the only member-listing RPC was admin_search_members(p_
-- query) — hard-coded limit 25, no offset, and it returns nothing at
-- all for a blank query (app/admin/members/page.tsx showed nothing
-- until a search was typed). admin_search_members is left completely
-- unchanged (existing tests depend on its exact shape). This adds a
-- new, separate RPC used for the default listing + filters + paging;
-- the Admin Members page now calls this one for everything (blank
-- query = default listing, non-blank query = narrowed listing), never
-- fetching more than one page's worth of rows into the browser.
create or replace function public.admin_list_members(
  p_query text default null,
  p_status text default null,
  p_country text default null,
  p_joined_after timestamptz default null,
  p_joined_before timestamptz default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  pseudonym text,
  country text,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_query text;
  v_limit integer;
  v_offset integer;
begin
  if not public.is_staff() then
    raise exception 'Not authorized.';
  end if;

  if p_status is not null and p_status not in ('active', 'restricted', 'suspended', 'banned') then
    raise exception 'Invalid account status filter.';
  end if;

  v_query := nullif(trim(both from coalesce(p_query, '')), '');
  -- Same clamp pattern as admin_list_public_content — never trust
  -- client-supplied bounds, and never allow an unbounded fetch.
  v_limit := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  return query
    select
      p.id,
      p.pseudonym,
      p.country,
      coalesce(aes.status, 'active'),
      p.created_at
    from public.profiles p
    left join public.account_enforcement_state aes on aes.user_id = p.id
    where (v_query is null or p.pseudonym ilike '%' || v_query || '%')
      and (p_status is null or coalesce(aes.status, 'active') = p_status)
      and (p_country is null or p.country = p_country)
      and (p_joined_after is null or p.created_at >= p_joined_after)
      and (p_joined_before is null or p.created_at <= p_joined_before)
    order by p.created_at desc
    limit v_limit offset v_offset;
end;
$function$;

revoke all on function public.admin_list_members(text, text, text, timestamptz, timestamptz, integer, integer) from public;
grant execute on function public.admin_list_members(text, text, text, timestamptz, timestamptz, integer, integer) to authenticated;


-- ============================================================
-- 3. MODERATION — report queue pagination + status/target-type filters
-- ============================================================
-- Audit finding: admin_list_reports(p_limit integer default 50) had no
-- offset/cursor at all (hard limit, capped at 200) and the app never
-- even passed p_limit — reports beyond the 50th (by created_at desc)
-- were permanently unreachable, with no status or target-type filter
-- wired anywhere. Replaced with a paginated, filterable version. The
-- old single-integer-argument signature is dropped explicitly (a
-- parameter-list change creates a new overload rather than replacing
-- the old one — the old overload must be dropped so it doesn't linger
-- with its own stale grants).
drop function if exists public.admin_list_reports(integer);

create or replace function public.admin_list_reports(
  p_status text default null,
  p_target_type text default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  id uuid,
  target_type text,
  target_id uuid,
  reason text,
  status text,
  created_at timestamptz,
  reporter_user_id uuid,
  reporter_pseudonym text,
  reported_user_id uuid,
  reported_pseudonym text
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_limit integer;
  v_offset integer;
begin
  if not public.is_staff() then
    raise exception 'Not authorized.';
  end if;

  if p_status is not null and p_status not in ('open', 'reviewed') then
    raise exception 'Invalid status filter.';
  end if;
  if p_target_type is not null
     and p_target_type not in ('profile', 'letter', 'dispatch', 'photo_moment', 'question_answer') then
    raise exception 'Invalid target type filter.';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  return query
    select
      r.id, r.target_type, r.target_id, r.reason, r.status, r.created_at,
      r.reporter_user_id, rp.pseudonym, r.reported_user_id, tp.pseudonym
    from public.reports r
    join public.profiles rp on rp.id = r.reporter_user_id
    join public.profiles tp on tp.id = r.reported_user_id
    where (p_status is null or r.status = p_status)
      and (p_target_type is null or r.target_type = p_target_type)
    order by r.created_at desc
    limit v_limit offset v_offset;
end;
$function$;

revoke all on function public.admin_list_reports(text, text, integer, integer) from public;
grant execute on function public.admin_list_reports(text, text, integer, integer) to authenticated;

-- Private-letter evidence architecture was independently audited this
-- checkpoint (no schema change needed): docs/sql/2026-09-17-reporting-
-- and-admin-moderation.sql's report_content already freezes a Letter
-- report's evidence into reports.evidence_snapshot (body,
-- sender_pseudonym, letter_created_at) at report time — admin_get_report
-- only ever reads that frozen jsonb column, never re-joins public.
-- letters. This is sound and is NOT changed here. The only gap found
-- was in the UI (app/admin/moderation/reports/[id]/page.tsx silently
-- dropped sender_pseudonym/letter_created_at from its render) — fixed
-- in application code, no RPC change required. See the checkpoint
-- report for the full confirmed flow.


-- ============================================================
-- 4. ANNOUNCEMENTS — V1, in-app only, Home placement, ALL MEMBERS
-- ============================================================
-- Smallest safe DB-backed structure for Admin-managed in-app
-- announcements. No mass-email, no audience segmentation, no multiple
-- delivery channels — deferred per the checkpoint's own scope.
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_title_not_blank check (char_length(trim(both from title)) > 0),
  constraint announcements_body_not_blank check (char_length(trim(both from body)) > 0),
  constraint announcements_window_order check (starts_at is null or ends_at is null or starts_at <= ends_at)
);

alter table public.announcements enable row level security;

-- A member may read an announcement only once it's actually published
-- and inside its own optional start/end window — never a draft, never
-- an archived one, and never one that hasn't started or has already
-- ended. Admin sees everything (including drafts) only through the
-- admin_list_announcements RPC below, which bypasses RLS as DEFINER.
create policy announcements_select_active_published
  on public.announcements
  for select
  to authenticated
  using (
    status = 'published'
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at >= now())
  );

revoke all on public.announcements from public, anon, authenticated;
grant select on public.announcements to authenticated;


create or replace function public.admin_list_announcements()
returns table (
  id uuid,
  title text,
  body text,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
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
    select a.id, a.title, a.body, a.status, a.starts_at, a.ends_at, a.created_at, a.updated_at
    from public.announcements a
    order by a.created_at desc;
end;
$function$;

revoke all on function public.admin_list_announcements() from public;
grant execute on function public.admin_list_announcements() to authenticated;


create or replace function public.admin_create_announcement(
  p_title text,
  p_body text,
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
  if char_length(v_body) = 0 then
    raise exception 'A body is required.';
  end if;
  if p_starts_at is not null and p_ends_at is not null and p_starts_at > p_ends_at then
    raise exception 'The start time must be before the end time.';
  end if;

  insert into public.announcements (title, body, starts_at, ends_at, created_by, status)
  values (v_title, v_body, p_starts_at, p_ends_at, auth.uid(), 'draft')
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

revoke all on function public.admin_create_announcement(text, text, timestamptz, timestamptz) from public;
grant execute on function public.admin_create_announcement(text, text, timestamptz, timestamptz) to authenticated;


create or replace function public.admin_update_announcement(
  p_announcement_id uuid,
  p_title text,
  p_body text,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_title text;
  v_body text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('admin') then
    raise exception 'Not authorized.';
  end if;

  if not exists (select 1 from public.announcements where id = p_announcement_id) then
    raise exception 'Announcement not found.';
  end if;

  v_title := trim(both from coalesce(p_title, ''));
  v_body := trim(both from coalesce(p_body, ''));
  if char_length(v_title) = 0 then
    raise exception 'A title is required.';
  end if;
  if char_length(v_body) = 0 then
    raise exception 'A body is required.';
  end if;
  if p_starts_at is not null and p_ends_at is not null and p_starts_at > p_ends_at then
    raise exception 'The start time must be before the end time.';
  end if;

  update public.announcements
  set title = v_title, body = v_body, starts_at = p_starts_at, ends_at = p_ends_at, updated_at = now()
  where id = p_announcement_id;

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action, target_type, target_id, target_identifier_snapshot
  ) values (
    auth.uid(), coalesce((select pseudonym from public.profiles where id = auth.uid()), auth.uid()::text),
    'announcement_updated', 'announcement', p_announcement_id, v_title
  );
end;
$function$;

revoke all on function public.admin_update_announcement(uuid, text, text, timestamptz, timestamptz) from public;
grant execute on function public.admin_update_announcement(uuid, text, text, timestamptz, timestamptz) to authenticated;


create or replace function public.admin_publish_announcement(p_announcement_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_status text;
  v_title text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('admin') then
    raise exception 'Not authorized.';
  end if;

  select status, title into v_status, v_title from public.announcements where id = p_announcement_id;
  if v_status is null then
    raise exception 'Announcement not found.';
  end if;
  if v_status = 'published' then
    raise exception 'This announcement is already published.';
  end if;

  update public.announcements set status = 'published', updated_at = now() where id = p_announcement_id;

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


-- "Unpublish/deactivate" — moves a published announcement to
-- 'archived', never deletes it, matching the checkpoint's own
-- preference for archive semantics over hard-delete of historical
-- published announcements.
create or replace function public.admin_archive_announcement(p_announcement_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_status text;
  v_title text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('admin') then
    raise exception 'Not authorized.';
  end if;

  select status, title into v_status, v_title from public.announcements where id = p_announcement_id;
  if v_status is null then
    raise exception 'Announcement not found.';
  end if;
  if v_status != 'published' then
    raise exception 'This announcement is not currently published.';
  end if;

  update public.announcements set status = 'archived', updated_at = now() where id = p_announcement_id;

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action, target_type, target_id, target_identifier_snapshot
  ) values (
    auth.uid(), coalesce((select pseudonym from public.profiles where id = auth.uid()), auth.uid()::text),
    'announcement_archived', 'announcement', p_announcement_id, v_title
  );
end;
$function$;

revoke all on function public.admin_archive_announcement(uuid) from public;
grant execute on function public.admin_archive_announcement(uuid) to authenticated;


-- Member-facing: the ONE currently active announcement, deterministic
-- ranking (most recently published, i.e. most recently updated into
-- 'published' status, wins). SECURITY DEFINER for symmetry with the
-- rest of this file and to keep the "must be signed in" check explicit
-- and centralized, even though the RLS policy above already independently
-- enforces the same published+window predicate for any direct select.
create or replace function public.get_active_announcement()
returns table (id uuid, title text, body text)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  return query
    select a.id, a.title, a.body
    from public.announcements a
    where a.status = 'published'
      and (a.starts_at is null or a.starts_at <= now())
      and (a.ends_at is null or a.ends_at >= now())
    order by a.updated_at desc
    limit 1;
end;
$function$;

revoke all on function public.get_active_announcement() from public;
grant execute on function public.get_active_announcement() to authenticated;


-- ============================================================
-- 5. DEFERRED (recorded, not built this checkpoint)
-- ============================================================
-- Mass-email/broadcast announcements: requires preference management,
-- unsubscribe handling, a clear distinction from transactional mail,
-- and deliverability safeguards — none of which exist yet. No "Email
-- everyone" control is built in this checkpoint.
