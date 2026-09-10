-- ============================================================
-- TEMPA — ADMIN COMMAND CENTER PHASE 2A-1: MODERATION + QUESTIONS
-- PREPARED 2026-09-10. Revised 2026-09-10 (independent review
-- corrections, see section markers below).
-- APPLIED LIVE 2026-09-10 — verified successfully. Post-apply
-- verification query confirmed every check TRUE: admin_questions_exists,
-- admin_get_report_exists, admin_hide_dispatch_exists,
-- admin_public_content_exists, dispatch_moderation_columns,
-- publish_answer_rpc_available, set_current_answer_rpc_available,
-- admin_hide_question_answer_exists, question_answer_reporting_enabled,
-- question_answer_moderation_columns, raw_question_answer_delete_revoked,
-- raw_question_answer_insert_revoked, raw_question_answer_update_revoked.
-- ============================================================
--
-- Adds: moderation_status/moderated_at on public.dispatches and
-- public.question_answers; the hide/restore visibility this requires on
-- every Dispatch/answer READ path (RLS + every SECURITY DEFINER
-- function that bypasses RLS); question_answer as a reportable target;
-- staff RPCs for hide/restore, proactive public-content review,
-- Questions management, and content-audit reads; a fix to
-- delete_dispatch's missing account-enforcement gate. Nothing here
-- touches public.letters, public.correspondences, Postcards, Storage,
-- Realtime, or feature flags.
--
-- Same convention as every prior migration: SECURITY DEFINER functions
-- use `set search_path to 'pg_catalog'`, every application object is
-- fully `public.`-qualified, every function gets an explicit `revoke
-- all ... from public` then a targeted `grant execute ... to
-- authenticated`, is_staff() is checked as the first statement inside
-- the function body, and every RPC that changes a moderation-relevant
-- column is reproduced here in FULL (never a partial ALTER FUNCTION),
-- copied from its own latest live definition before this migration's
-- one addition.
--
-- MODERATION STATE MODEL (locked): directly on the two affected
-- tables, never a shared polymorphic (content_type, content_id) side
-- table — see the design discussion this migration implements. No
-- `moderation_reason`/`moderated_by` column on either content table:
-- those details live exclusively in admin_audit_log, so there is
-- structurally nothing on a member-facing row that could leak an
-- internal reason or a moderator's identity.
--
-- COLUMN-LEVEL PROTECTION (locked, Decision 7): confirmed by reading
-- this table's own tracked grant history — public.dispatches
-- (originally open_letters) has only ever been granted `select, insert`
-- to authenticated (docs/sql/2026-09-06-open-letters.sql:106-107); it
-- has NEVER had a direct UPDATE grant, so an ordinary member already
-- cannot issue a raw PostgREST UPDATE against it at all, moderation
-- columns included — update_dispatch/delete_dispatch work only because
-- they are SECURITY DEFINER. public.question_answers is different: its
-- 2026-09-11 grant history only revokes truncate/trigger/references
-- from authenticated, never UPDATE — meaning a direct UPDATE grant
-- likely still exists from this table's untracked origin. Confirmed by
-- a full repo search that NO application code anywhere issues a direct
-- `.from('question_answers').update(...)`/`.upsert(...)` — every real
-- mutation already goes through publish_question_answer/
-- set_current_answer. Revoking UPDATE outright therefore closes the
-- exact hole Decision 7 describes (a handcrafted request setting
-- moderation_status back to 'visible' on the member's own row, which
-- RLS's own-row policy would otherwise permit).
--
-- *** INDEPENDENT REVIEW CORRECTION, 2026-09-10 follow-up *** — the
-- revoke above would have silently BROKEN publish_question_answer and
-- set_current_answer: both are (were) SECURITY INVOKER, meaning their
-- own UPDATE statements run as the calling `authenticated` role, which
-- depends on exactly the UPDATE grant this migration revokes. This was
-- missed in the first pass (the "no direct .update() call in
-- application code" audit checked the JS/TS client, not these two
-- PL/pgSQL functions' own internal statements). Section 3b below
-- converts both to SECURITY DEFINER — matching every other content-
-- mutating RPC in this file — so they no longer depend on that grant;
-- their own bodies already scope every write to `auth.uid()` manually,
-- so this conversion changes no access-control behavior, only removes
-- the now-invalid dependency.
--
-- *** FINAL DATABASE MUTATION-BOUNDARY AUDIT, 2026-09-10 follow-up ***
-- — exhaustive grant history for question_answers confirms
-- `authenticated` has held SELECT/INSERT/UPDATE on this table since its
-- untracked origin (only TRUNCATE/TRIGGER/REFERENCES, and everything
-- for `anon`, were ever revoked — docs/sql/2026-09-11-safety-blocking-
-- foundation.sql:91-92). The table carries exactly two RLS policies,
-- BOTH select-only (the self-row policy and the cross-user policy
-- rewritten in section 3 below) — no insert/update/delete/all policy
-- exists anywhere in tracked history. Now that publish_question_answer/
-- set_current_answer are converted to SECURITY DEFINER (section 3b),
-- NOTHING legitimate depends on the raw table grant any longer — a
-- full-repo search confirms zero application code anywhere issues a
-- direct `.from('question_answers').insert(...)`/`.update(...)`/
-- `.upsert(...)`/`.delete(...)`, and no SQL function other than those
-- two (plus the new admin_hide/restore_question_answer, also DEFINER)
-- writes to this table. The revoke below is widened from UPDATE-only to
-- INSERT, UPDATE, AND DELETE — closing a raw-PostgREST-insert bypass
-- that would otherwise let a crafted client skip is_active validation,
-- account-enforcement, and hidden-content protection entirely by
-- inserting directly. DELETE was never granted in tracked history
-- either, but is included explicitly for the same reason UPDATE is
-- revoked on dispatches below (defensive, self-documenting) — there is
-- no member-facing hard-delete-an-answer feature in this phase.
--
-- QUESTION_ANSWER REPORTABILITY (Decision 1): widens reports.target_type,
-- report_content, and evidence_snapshot for this one new type. Evidence
-- captures prompt + body + author pseudonym, frozen at report time,
-- exactly like every other branch. Only a currently-visible answer
-- (same predicate as its own read policy) can be reported — never a
-- stale/guessed id fished up after the fact.
--
-- QUESTION RUNTIME FIX (Decision 3): getCanonicalQuestions
-- (lib/questions.ts) gains a plain `.eq('is_active', true)` — a pure
-- client-side query change, no RLS/grant implication, since is_active
-- is a display/offering rule, not a privacy boundary. Section 3b below
-- ALSO adds the server-side backstop (publish_question_answer rejects
-- any write against an inactive Question) so Deactivate is a real
-- operational control, not merely a client-side filter a direct RPC
-- call could bypass.
--
-- IS_CURRENT — confirmed meaning before touching anything (independent
-- review item 6): `is_current` marks the ONE answer, per member, that
-- is eligible for the Minds Discovery pool and for
-- get_post_closure_recommendations' "write to this mind" suggestions.
-- It is NOT a general publication/visibility gate — a member's public
-- profile (app/minds/[userId]/page.tsx) deliberately renders EVERY
-- completed canonical answer, current or not ("never just the current
-- one plus a 'more' list", per that file's own comment), and the
-- cross-user RLS policy below has never filtered on is_current either.
-- An is_current = false row is exactly as readable, under the same
-- is_active/moderation_status/blocking predicate, as an is_current =
-- true one. Conclusion: NO change to the cross-user SELECT policy, and
-- NO change to report_content's question_answer branch — both already
-- had the correct, complete predicate (is_active, moderation_status,
-- blocking) with no is_current involvement needed or appropriate.
-- get_post_closure_recommendations' existing `qa.is_current = true`
-- filter is unrelated to this and stays exactly as it is — it is
-- correctly scoped to "the one answer this member is currently
-- offering for discovery," which is is_current's actual purpose.
--
-- One BEGIN/COMMIT.

begin;

-- ============================================================
-- 1. MODERATION STATE COLUMNS
-- ============================================================
alter table public.dispatches
  add column moderation_status text not null default 'visible'
    check (moderation_status in ('visible', 'hidden')),
  add column moderated_at timestamptz;

alter table public.question_answers
  add column moderation_status text not null default 'visible'
    check (moderation_status in ('visible', 'hidden')),
  add column moderated_at timestamptz;

-- Column-level protection (Decision 7) — see header note. dispatches
-- already has no UPDATE grant at all; this line is a defensive no-op
-- there, stated explicitly so the guarantee is self-documenting rather
-- than merely inherited. question_answers is where this line does real
-- work — safe only because section 3b below converts
-- publish_question_answer/set_current_answer to SECURITY DEFINER first
-- (see the independent-review-correction header note above). Widened to
-- INSERT, UPDATE, DELETE (final mutation-boundary audit) — dispatches
-- never held INSERT/DELETE grants either (dispatches_insert_own's own
-- WITH CHECK is tightened separately in section 2b below, since INSERT
-- there is a genuinely legitimate direct path via publish_dispatch,
-- unlike question_answers where no direct path remains legitimate at
-- all once section 3b lands).
revoke update, delete on public.dispatches from authenticated;
revoke insert, update, delete on public.question_answers from authenticated;


-- ============================================================
-- 2. DISPATCH VISIBILITY — RLS + every RLS-bypassing read path
-- ============================================================
-- dispatches_select_published's live shape (confirmed by reading
-- docs/sql/2026-09-11-safety-blocking-foundation.sql:462-474 directly):
-- the author's own `or author_id = auth.uid()` branch is untouched —
-- that is exactly the "author may reach an appropriate own/direct
-- view" allowance Decision 2 asks for. The one addition is
-- `moderation_status = 'visible'` inside the OTHER branch, so nobody
-- but the author can select a hidden Dispatch under any circumstance.
drop policy dispatches_select_published on public.dispatches;

create policy dispatches_select_published
  on public.dispatches
  for select
  to authenticated
  using (
    (
      status = 'published'
      and moderation_status = 'visible'
      and not tempa_private.is_blocked_pair(auth.uid(), author_id)
    )
    or author_id = auth.uid()
  );

-- search_dispatches is SECURITY INVOKER (confirmed live body,
-- docs/sql/2026-09-07-dispatches-and-board.sql:580-599) — it runs under
-- the CALLER's own RLS, so the policy change above already protects it
-- from anyone but the author ever matching a hidden row. But unlike the
-- blocking feature (which never has an author-exception concern — a
-- member is never blocked from their own content), the RLS policy's own
-- `or author_id = auth.uid()` branch would otherwise let a hidden
-- Dispatch resurface in ITS OWN AUTHOR'S search results — a feed/browse
-- context, not the "appropriate own/direct view" Decision 2 means.
-- Reproduced in full with one added predicate so search never returns
-- a hidden Dispatch to anyone, author included.
create or replace function public.search_dispatches(p_query text)
returns setof public.dispatches
language sql
security invoker
stable
set search_path to 'public'
as $$
  select d.*
  from public.dispatches d
  where d.status = 'published'
    and d.moderation_status = 'visible'
    and (
      d.title ilike '%' || p_query || '%'
      or d.body ilike '%' || p_query || '%'
      or exists (
        select 1 from public.dispatch_topics t
        where t.dispatch_id = d.id and t.topic ilike '%' || p_query || '%'
      )
    )
  order by d.published_at desc
$$;

revoke all on function public.search_dispatches(text) from public;
grant execute on function public.search_dispatches(text) to authenticated;

-- get_shared_dispatch (/d/[shareToken], the UNAUTHENTICATED external
-- reader) is SECURITY DEFINER and bypasses dispatches_select_published
-- entirely — it is its OWN complete trust boundary, so the moderation
-- check must live inside its body, not rely on the RLS change above at
-- all. Reproduced in full from its latest live definition
-- (docs/sql/2026-09-10-shared-dispatch-country.sql:29-84, the version
-- that added author_country) with exactly one added predicate: a
-- revoked/invalid/unpublished/now-hidden token all collapse to the
-- same "not found" outcome, matching this function's own existing
-- contract of never distinguishing those cases from each other.
create or replace function public.get_shared_dispatch(p_token uuid)
returns table (
  dispatch_id uuid,
  title text,
  body text,
  published_at timestamptz,
  author_pseudonym text,
  author_country text,
  topics text[],
  moments jsonb
)
language plpgsql
security definer
set search_path to 'pg_catalog'
stable
as $function$
declare
  found_id uuid;
begin
  select d.id
  into found_id
  from public.dispatch_shares ds
  join public.dispatches d on d.id = ds.dispatch_id
  where ds.id = p_token
    and ds.revoked_at is null
    and d.status = 'published'
    -- NEW: the one addition — a hidden Dispatch's external share link
    -- must stop working the instant it's hidden, not merely stop
    -- being creatable/discoverable going forward.
    and d.moderation_status = 'visible';

  if found_id is null then
    return;
  end if;

  return query
  select
    d.id,
    d.title,
    d.body,
    d.published_at,
    coalesce(pp.pseudonym, 'A TEMPA member'),
    pp.country,
    coalesce(
      (select array_agg(t.topic order by t.topic) from public.dispatch_topics t where t.dispatch_id = d.id),
      '{}'::text[]
    ),
    coalesce(
      (
        select jsonb_agg(jsonb_build_object('id', dm.id, 'position', dm.position, 'image_path', dm.image_path) order by dm.position)
        from public.dispatch_moments dm
        where dm.dispatch_id = d.id
      ),
      '[]'::jsonb
    )
  from public.dispatches d
  left join public.public_profiles pp on pp.id = d.author_id
  where d.id = found_id;
end;
$function$;

revoke all on function public.get_shared_dispatch(uuid) from public;
grant execute on function public.get_shared_dispatch(uuid) to anon, authenticated;

-- get_post_closure_recommendations also bypasses question_answers RLS
-- (SECURITY DEFINER) but is unrelated to Dispatches — its own fix is in
-- section 3 below, grouped with the rest of the question_answers work.


-- ============================================================
-- 2b. DISPATCH INSERT — moderation-state integrity (final mutation-
-- boundary audit)
-- ============================================================
-- dispatches_insert_own (docs/sql/2026-09-06-open-letters.sql:95-99,
-- renamed at docs/sql/2026-09-07-dispatches-and-board.sql:31, otherwise
-- UNCHANGED since creation) is the live INSERT policy publish_dispatch
-- (SECURITY INVOKER — docs/sql/2026-09-12-scoped-blocking-and-
-- fixes.sql:1179-1299) depends on for every ordinary member's own
-- Dispatch creation; unlike question_answers, this remains a genuinely
-- legitimate direct-table path and must keep working, so INSERT is NOT
-- revoked from authenticated here. Its WITH CHECK has only ever been
-- `author_id = auth.uid()` — it says nothing about the two new
-- moderation columns, so a crafted client could otherwise set
-- moderation_status = 'hidden' or a forged non-null moderated_at on
-- their OWN new row at creation time, fabricating a "TEMPA already
-- moderated this" state with no corresponding admin_audit_log entry —
-- undermining the audit trail's completeness even though the row is
-- technically the author's own. Reproduced in full with two added
-- predicates: a raw insert must land as moderation_status = 'visible'
-- and moderated_at is null, exactly the column defaults, so an ordinary
-- publish_dispatch call (which never references either column — see
-- its own INSERT column list) is completely unaffected; only an insert
-- that explicitly tries to set a non-default value for either column is
-- newly rejected.
drop policy dispatches_insert_own on public.dispatches;

create policy dispatches_insert_own
  on public.dispatches
  for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and moderation_status = 'visible'
    and moderated_at is null
  );


-- ============================================================
-- 3. QUESTION-ANSWER VISIBILITY — RLS + every RLS-bypassing read path
-- ============================================================
-- "Answers to active questions are readable by authenticated users"'s
-- live shape (confirmed, docs/sql/2026-09-11-safety-blocking-
-- foundation.sql:493-507) already excludes blocked pairs; the
-- SEPARATE, pre-existing self-select policy (confirmed distinct by
-- that same migration's own diagnostic note) already lets a member
-- read their OWN answers regardless of question/is_active state, and
-- is NOT touched here — it needs no change at all, since it filters on
-- no column this migration adds, and that is exactly Decision 4's
-- "author may reach an appropriate own/history view even if the
-- Question is inactive or the answer is hidden" requirement, already
-- structurally satisfied. This policy (the CROSS-USER one) gains one
-- addition: moderation_status = 'visible'. (Independent review item 6:
-- confirmed no is_current predicate belongs here — see the header
-- note's IS_CURRENT explanation.)
drop policy "Answers to active questions are readable by authenticated users"
  on public.question_answers;

create policy "Answers to active questions are readable by authenticated users"
  on public.question_answers
  for select
  to authenticated
  using (
    exists (
      select 1 from public.questions q
      where q.id = question_answers.question_id
        and q.is_active = true
    )
    and question_answers.moderation_status = 'visible'
    and not tempa_private.is_blocked_pair(auth.uid(), question_answers.user_id)
  );

-- Minds/Discovery's own listing query (app/minds/page.tsx) already
-- excludes the viewer's own rows (`.neq('user_id', user.id)`) before
-- this policy ever runs, so — unlike Dispatches' Board/Home feeds —
-- there is no author-exception leak to guard against here: every row
-- Discovery could possibly return already goes through the non-author
-- branch above. No application-level filter is needed there.
--
-- get_post_closure_recommendations is SECURITY DEFINER and bypasses
-- this policy entirely. Reproduced in full from its latest live
-- definition (docs/sql/2026-09-11-safety-blocking-foundation.sql:525-
-- 668, the version with the block exclusion already added) with two
-- changes: the pre-existing moderation_status addition from this
-- migration's first pass, PLUS (independent review item 10) hardening
-- `set search_path to 'public'` -> `'pg_catalog'`, now that this
-- migration is already replacing the function's complete body wholesale
-- — every object referenced inside (public.letters, public.
-- question_answers, public.questions, public.profiles, tempa_private.
-- is_blocked_pair, and the builtins hashtext/power/extract/now) is
-- already fully schema-qualified or resolves from pg_catalog, so this
-- is a safe, complete hardening rather than a partial one.
create or replace function public.get_post_closure_recommendations(
  p_letter_id uuid
)
returns table (
  answer_id uuid,
  user_id uuid,
  question_id uuid,
  body text,
  pseudonym text,
  country text,
  gender text,
  gender_custom text,
  age_range text,
  prompt text
)
language plpgsql
security definer
set search_path to 'pg_catalog'
stable
as $function$

declare
  target public.letters;

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;


  select *
  into target

  from public.letters

  where
    id = p_letter_id
    and sender_id = auth.uid()
    and reply_to_id is null;


  if not found then
    raise exception
      'Letter not found or not a first-contact letter you sent.';
  end if;


  if
    target.status <> 'closed'
    and not (
      target.status = 'sent'
      and target.expires_at <= now()
    )
  then
    raise exception
      'Recommendations are only available once this letter has closed.';
  end if;


  return query

    select
      qa.id as answer_id,
      qa.user_id,
      qa.question_id,
      qa.body,
      p.pseudonym,
      p.country,
      p.gender,
      p.gender_custom,
      p.age_range,
      q.prompt

    from public.question_answers qa

    join public.questions q
      on q.id = qa.question_id
      and q.is_active = true

    join public.profiles p
      on p.id = qa.user_id

    where
      qa.is_current = true
      and qa.user_id <> auth.uid()
      and qa.user_id <> target.recipient_id
      and not tempa_private.is_blocked_pair(auth.uid(), qa.user_id)
      -- the one addition from this migration's first pass — never
      -- recommend a hidden answer.
      and qa.moderation_status = 'visible'

    order by

      power(

        -- Deterministic u in (0, 1].
        (
          (
            (
              hashtext(
                p_letter_id::text
                || ':'
                || qa.id::text
              )
              & 2147483647
            )::bigint
            + 1
          )::double precision

          / 2147483648.0
        ),

        1.0 / (

          case

            when
              extract(
                epoch from (
                  now() - p.created_at
                )
              ) / 86400.0 <= 30
            then 1.5

            when
              extract(
                epoch from (
                  now() - p.created_at
                )
              ) / 86400.0 <= 90
            then 1.25

            else 1.0

          end

        )

      ) desc

    limit 3;

end;
$function$;


-- ============================================================
-- 3b. QUESTION_ANSWERS WRITE PROTECTION — independent review
-- correction (item 5): hidden evidence must not be mutable underneath
-- moderation, and (item 8) a deactivated Question must be a REAL
-- operational control, not merely a client-side filter a stale or
-- malicious caller can bypass by invoking the RPC directly.
-- ============================================================
-- publish_question_answer reproduced in full from its live definition
-- (docs/sql/2026-09-11-safety-blocking-foundation.sql:2029-2080), which
-- is (was) SECURITY INVOKER, relying on question_answers' own UPDATE
-- grant to `authenticated` for its internal demotion UPDATE and its
-- upsert's UPDATE-on-conflict path. Section 1 above revokes that grant,
-- so this reproduction ALSO adds `security definer` (matching every
-- other content-mutating RPC in this file) — its body already scopes
-- every write to `auth.uid()` manually (see the values/where clauses
-- below), so this conversion changes no access-control behavior, only
-- removes the now-invalid dependency on the revoked grant. Two further
-- additions:
--   1. A Question that exists but is not currently active rejects ANY
--      write against it — a brand-new answer or an edit of an existing
--      one alike. Deactivating a Question is meant to freeze it
--      entirely: the client-side getCanonicalQuestions() filter already
--      stops it from being OFFERED in the UI; this is the server-side
--      backstop that makes Deactivate real rather than cosmetic against
--      a direct RPC call. A deliberate judgment call: blocking EDITS of
--      an already-answered, now-inactive Question too (not just new
--      answers) closes the narrower race where an admin deactivates a
--      Question mid-session and a member's in-flight edit would
--      otherwise still land.
--   2. If the member's own existing row for this Question is currently
--      moderation_status = 'hidden', the write is rejected outright —
--      hidden content is frozen evidence; only an approved
--      admin_restore_question_answer call may change it back. New,
--      calm error text (no existing precedent to reuse for this exact
--      case).
create or replace function public.publish_question_answer(p_question_id uuid, p_body text)
returns public.question_answers
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  result public.question_answers;
  is_canonical boolean;
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

  select (slug is not null), is_active into is_canonical, question_is_active
  from public.questions
  where id = p_question_id;

  -- NEW: a Question that exists but is not active accepts no write at
  -- all, insert or edit alike. A nonexistent p_question_id leaves
  -- question_is_active null and falls through to the pre-existing
  -- foreign-key-violation behavior on insert, unchanged.
  if question_is_active is not null and not question_is_active then
    raise exception 'This Question is no longer accepting answers.';
  end if;

  -- NEW: the member's own existing row for this Question, if any, must
  -- not currently be hidden — a member cannot edit their way out from
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

  should_promote := coalesce(is_canonical, false) and not has_current;

  -- Final pre-apply correction, item 5: re-checked for the same hidden-
  -- row-mutation concern as set_current_answer's demotion UPDATE above.
  -- No additional filter is needed here, because this statement only
  -- ever WRITES is_current = false — never true — to rows it touches,
  -- so it can never violate "a hidden row's is_current stays frozen" in
  -- either direction: if a hidden row's is_current is already false
  -- (the only value it can ever be, per the invariant every hide/
  -- restore/set_current_answer/this-function path now jointly
  -- maintains — see admin_hide_question_answer's own is_current=false
  -- write below), this is a no-op read-then-write-same-value on it.
  -- Separately, this function can never reach an UPDATE/INSERT
  -- targeting a hidden row's OWN identity at all — the
  -- existing_moderation_status check above already raises before this
  -- point whenever the row for (auth.uid(), p_question_id) is hidden.
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

-- set_current_answer reproduced in full from its live definition
-- (docs/sql/2026-09-11-safety-blocking-foundation.sql:2087-2129), also
-- (was) SECURITY INVOKER for the same reason — converted to SECURITY
-- DEFINER here for the same reason as publish_question_answer above.
-- Two additions: the existence check now also requires
-- moderation_status = 'visible' — a hidden answer cannot be set as the
-- member's featured/current one, reusing this function's own existing
-- error message rather than inventing new vocabulary. PLUS (final pre-
-- apply correction, item 1/4): the demotion UPDATE now also requires
-- moderation_status = 'visible' — without this, calling
-- set_current_answer with a DIFFERENT (visible) answer would still
-- reach into and flip is_current on the member's own HIDDEN answer,
-- mutating a frozen moderated row via a path that never even names it.
-- Frozen means frozen — no member RPC may change ANY column on a
-- hidden row, is_current included, not just body/moderation_status.
-- Confirmed compatible with question_answers_one_current_per_user (the
-- partial unique index `on (user_id) where is_current`, docs/sql/2026-
-- 08-30-questions-and-pseudonym.sql:130-131): this predicate only ever
-- narrows which rows the demotion touches, never changes which rows
-- CAN be is_current = true, so the index's own invariant (at most one
-- true row per user) is unaffected either way.
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
    join public.questions q on q.id = qa.question_id
    where qa.id = p_answer_id
      and qa.user_id = auth.uid()
      and q.slug is not null
      and qa.moderation_status = 'visible'
  ) then
    raise exception 'Only a completed answer to one of the three canonical Questions can be shown in Minds.';
  end if;

  -- NEW: never touch a hidden row while demoting the member's other
  -- answers — a hidden row is frozen, is_current included.
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


-- ============================================================
-- 4. QUESTION_ANSWER BECOMES A REPORTABLE TARGET (Decision 1)
-- ============================================================
alter table public.reports drop constraint reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('profile', 'letter', 'dispatch', 'photo_moment', 'question_answer'));

-- report_content reproduced in full from its live definition
-- (docs/sql/2026-09-17-reporting-and-admin-moderation.sql:130-320) with
-- the new question_answer branch, PLUS (independent review item 3) two
-- corrections to the pre-existing dispatch-related branches: the
-- 'dispatch' branch's own comment already claimed "the same visibility
-- a reader already has via dispatches_select_published," but its WHERE
-- clause only ever checked `status = 'published'` — never
-- moderation_status, and never the blocked-pair predicate
-- dispatches_select_published actually enforces. Both branches (plain
-- 'dispatch', and the dispatch-sourced half of 'photo_moment') now
-- require `moderation_status = 'visible'` AND
-- `not tempa_private.is_blocked_pair(auth.uid(), d.author_id)`, so a
-- stale/guessed UUID for a hidden (or now cross-blocked) Dispatch
-- resolves to the same "not found" outcome as a nonexistent one, never
-- reportable by id alone. The private-letter half of 'photo_moment'
-- (participant-gated) is UNCHANGED — private correspondence access is
-- out of scope here. Preserves every other existing property: self-
-- report prevention and duplicate protection are the same shared checks
-- AFTER the branch (untouched, apply identically to every target type);
-- reported_user_id/evidence are derived server-side, never client-
-- supplied; the reporter's own identity is never exposed in evidence
-- (unchanged from every other branch).
create or replace function public.report_content(
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_context text default null
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$

declare
  v_reported_user_id uuid;
  v_evidence jsonb;
  v_context text;

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if p_target_type not in ('profile', 'letter', 'dispatch', 'photo_moment', 'question_answer') then
    raise exception 'Unknown report target.';
  end if;

  if p_reason not in (
    'scam_fraud', 'harassment', 'inappropriate_content',
    'impersonation', 'spam', 'other'
  ) then
    raise exception 'Unknown report reason.';
  end if;

  v_context := nullif(trim(both from coalesce(p_context, '')), '');
  if v_context is not null and char_length(v_context) > 500 then
    raise exception 'Explanation is too long.';
  end if;

  v_reported_user_id := null;
  v_evidence := null;


  if p_target_type = 'profile' then

    select
      p.id,
      jsonb_build_object(
        'pseudonym', p.pseudonym,
        'country', p.country,
        'gender', p.gender,
        'gender_custom', p.gender_custom,
        'age_range', p.age_range
      )
    into v_reported_user_id, v_evidence
    from public.profiles p
    where p.id = p_target_id;

    if v_reported_user_id is null then
      raise exception 'Member not found.';
    end if;


  elsif p_target_type = 'letter' then

    select
      l.sender_id,
      jsonb_build_object(
        'body', l.body,
        'sender_pseudonym', p.pseudonym,
        'letter_created_at', l.created_at
      )
    into v_reported_user_id, v_evidence
    from public.letters l
    join public.profiles p on p.id = l.sender_id
    where l.id = p_target_id
      and (l.sender_id = auth.uid() or l.recipient_id = auth.uid());

    if v_reported_user_id is null then
      raise exception 'Letter not found.';
    end if;


  elsif p_target_type = 'dispatch' then

    -- Independent review item 3: now requires moderation_status =
    -- 'visible' AND not a blocked pair — the FULL predicate
    -- dispatches_select_published enforces for a non-author reader,
    -- not just `status = 'published'`.
    select
      d.author_id,
      jsonb_build_object(
        'title', d.title,
        'body', d.body,
        'author_pseudonym', p.pseudonym,
        'published_at', d.published_at
      )
    into v_reported_user_id, v_evidence
    from public.dispatches d
    join public.profiles p on p.id = d.author_id
    where d.id = p_target_id
      and d.status = 'published'
      and d.moderation_status = 'visible'
      and not tempa_private.is_blocked_pair(auth.uid(), d.author_id);

    if v_reported_user_id is null then
      raise exception 'Dispatch not found.';
    end if;


  elsif p_target_type = 'photo_moment' then

    select
      l.sender_id,
      jsonb_build_object(
        'image_path', m.image_path,
        'sender_pseudonym', p.pseudonym,
        'source', 'letter',
        'moment_created_at', m.created_at
      )
    into v_reported_user_id, v_evidence
    from public.moments m
    join public.letters l on l.id = m.letter_id
    join public.correspondences c on c.id = l.correspondence_id
    join public.profiles p on p.id = l.sender_id
    where m.id = p_target_id
      and m.type = 'photo'
      and (c.participant_low = auth.uid() or c.participant_high = auth.uid());

    if v_reported_user_id is null then
      -- Independent review item 3: same correction as the plain
      -- 'dispatch' branch above — the parent Dispatch must be
      -- published, visible, and not a blocked pair.
      select
        d.author_id,
        jsonb_build_object(
          'image_path', dm.image_path,
          'sender_pseudonym', p.pseudonym,
          'source', 'dispatch',
          'moment_created_at', dm.created_at
        )
      into v_reported_user_id, v_evidence
      from public.dispatch_moments dm
      join public.dispatches d on d.id = dm.dispatch_id
      join public.profiles p on p.id = d.author_id
      where dm.id = p_target_id
        and d.status = 'published'
        and d.moderation_status = 'visible'
        and not tempa_private.is_blocked_pair(auth.uid(), d.author_id);
    end if;

    if v_reported_user_id is null then
      raise exception 'Photo not found.';
    end if;


  elsif p_target_type = 'question_answer' then

    -- Reportable only when the caller could legitimately see it —
    -- exactly the same predicate this table's own cross-user RLS
    -- policy enforces (active Question, moderation_status='visible',
    -- not a blocked pair) — never a hidden/inactive answer fished up
    -- by a stale or guessed id, and never bypassing the pair-blocking
    -- rule every other branch already respects. Independent review item
    -- 6 confirmed no is_current predicate belongs here — see the
    -- migration header's IS_CURRENT explanation.
    select
      qa.user_id,
      jsonb_build_object(
        'prompt', q.prompt,
        'body', qa.body,
        'author_pseudonym', p.pseudonym
      )
    into v_reported_user_id, v_evidence
    from public.question_answers qa
    join public.questions q on q.id = qa.question_id
    join public.profiles p on p.id = qa.user_id
    where qa.id = p_target_id
      and q.is_active = true
      and qa.moderation_status = 'visible'
      and not tempa_private.is_blocked_pair(auth.uid(), qa.user_id);

    if v_reported_user_id is null then
      raise exception 'Answer not found.';
    end if;

  end if;


  if v_reported_user_id = auth.uid() then
    raise exception 'You cannot report your own content.';
  end if;

  if exists (
    select 1 from public.reports
    where reporter_user_id = auth.uid()
      and target_type = p_target_type
      and target_id = p_target_id
  ) then
    raise exception 'You have already reported this.';
  end if;


  insert into public.reports (
    reporter_user_id, reported_user_id, target_type, target_id,
    reason, context, evidence_snapshot
  ) values (
    auth.uid(), v_reported_user_id, p_target_type, p_target_id,
    p_reason, v_context, v_evidence
  );

end;
$function$;

revoke all on function public.report_content(text, uuid, text, text) from public;
grant execute on function public.report_content(text, uuid, text, text) to authenticated;


-- ============================================================
-- 5. DELETE_DISPATCH — the missing enforcement gate (§16), plus
-- independent review item 4 (hidden content must not be author-
-- deletable)
-- ============================================================
-- Reproduced in full from its live definition (docs/sql/2026-09-09-
-- board-usability.sql:232-253) with two additions: the account-status
-- gate update_dispatch already has (docs/sql/2026-09-11-safety-
-- blocking-foundation.sql:1850-1852), same message, no new error
-- vocabulary; AND (independent review item 4) the author's own
-- existence check now also requires moderation_status = 'visible' —
-- folded into the SAME check, so the EXISTING "Only the author of a
-- Dispatch may delete it." message already covers a hidden Dispatch too
-- with no new vocabulary needed. Closes two loopholes: a
-- restricted/suspended/banned member could otherwise permanently
-- destroy their own violating Dispatch (and any reported evidence
-- pointer to it) by deleting it directly; an ACTIVE author could
-- likewise destroy moderated evidence the instant TEMPA hides it, since
-- account-status enforcement alone says nothing about a still-active
-- author acting on their own already-hidden content.
create or replace function public.delete_dispatch(p_dispatch_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'This action is not available right now.';
  end if;

  -- NEW: moderation_status = 'visible' folded into the existing
  -- existence check — a hidden Dispatch is treated the same as one that
  -- isn't the caller's own, reusing the existing message.
  if not exists (
    select 1 from public.dispatches d
    where d.id = p_dispatch_id
      and d.author_id = auth.uid()
      and d.moderation_status = 'visible'
  ) then
    raise exception 'Only the author of a Dispatch may delete it.';
  end if;

  delete from public.dispatches where id = p_dispatch_id;
end;
$function$;

revoke all on function public.delete_dispatch(uuid) from public;
grant execute on function public.delete_dispatch(uuid) to authenticated;


-- ============================================================
-- 5b. UPDATE_DISPATCH — independent review item 4 (hidden content must
-- not be author-editable either)
-- ============================================================
-- Reproduced in full from its live definition (docs/sql/2026-09-11-
-- safety-blocking-foundation.sql:1826-1946) with one addition, folded
-- into the SAME existence check as delete_dispatch above: `and
-- moderation_status = 'visible'`, reusing the EXISTING "Only the author
-- of a published Dispatch may edit it." message — a hidden Dispatch's
-- title/body can no longer be silently rewritten by its own still-
-- active author while TEMPA has it hidden. Topics and Moments
-- (wholesale replaced by this function) are protected the same way,
-- since they're gated by the same existence check. Nothing else in this
-- function changes.
create or replace function public.update_dispatch(
  p_dispatch_id uuid,
  p_title text,
  p_body text,
  p_topics text[] default '{}',
  p_moments jsonb default '[]'::jsonb
)
returns public.dispatches
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  result public.dispatches;
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

  -- NEW: moderation_status = 'visible' folded into the existing
  -- existence check.
  if not exists (
    select 1 from public.dispatches d
    where d.id = p_dispatch_id
      and d.author_id = auth.uid()
      and d.status = 'published'
      and d.moderation_status = 'visible'
  ) then
    raise exception 'Only the author of a published Dispatch may edit it.';
  end if;

  if char_length(trim(p_title)) = 0 then
    raise exception 'A Dispatch needs a title.';
  end if;

  if char_length(p_title) > 70 then
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

revoke all on function public.update_dispatch(uuid, text, text, text[], jsonb) from public;
grant execute on function public.update_dispatch(uuid, text, text, text[], jsonb) to authenticated;


-- ============================================================
-- 6. ADMIN HIDE / RESTORE — Dispatches and Question answers (§10),
-- corrected per independent review items 1 and 9
-- ============================================================
-- Moderator floor (not admin) — moderators need these while handling
-- reports, per the locked permission split. Reason required for BOTH
-- hide and restore (Restore follows the same convention
-- admin_set_account_status already established: a reason is required
-- even when restoring to 'active'). Never touches title/body/prompt —
-- structurally cannot, since these functions have no column reference
-- to either. No moderation_reason/moderated_by column on the content
-- row itself — the reason lives only in admin_audit_log.
--
-- INDEPENDENT REVIEW ITEM 1 (moderator must stay report-driven):
-- signatures are UNCHANGED (p_dispatch_id/p_answer_id, p_reason) — the
-- report-boundary check reads public.reports directly instead, keyed on
-- the exact (target_type, target_id) pair. An admin caller (is_staff
-- ('admin')) may act on any eligible target, proactively, as Public
-- Content Review requires. A moderator-only caller (is_staff
-- ('moderator') but not 'admin') may act ONLY when at least one report
-- already exists for that exact target — otherwise this raises the
-- SAME generic 'Not authorized.' used for a non-staff caller, so a
-- moderator cannot distinguish "you're not staff" from "this exact
-- target has no report" from the error message alone, and report
-- existence is never observable by anyone who isn't already staff.
--
-- INDEPENDENT REVIEW ITEM 9 (idempotency): a Hide on already-hidden
-- content, or a Restore on already-visible content, now raises a clear
-- staff-facing error instead of silently logging a fabricated
-- transition — `admin_audit_log` metadata's `previous_status`/
-- `new_status` pair remains a trustworthy record of a REAL transition
-- whenever a row does appear there.

create or replace function public.admin_hide_dispatch(p_dispatch_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_reason text;
  v_old_status text;
  v_actor_pseudonym text;
  v_target_title text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('moderator') then
    raise exception 'Not authorized.';
  end if;

  -- NEW: report-driven boundary for a moderator-only caller.
  if not public.is_staff('admin') then
    if not exists (
      select 1 from public.reports
      where target_type = 'dispatch' and target_id = p_dispatch_id
    ) then
      raise exception 'Not authorized.';
    end if;
  end if;

  v_reason := trim(both from coalesce(p_reason, ''));
  if char_length(v_reason) = 0 then
    raise exception 'A reason is required.';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'Reason is too long.';
  end if;

  select moderation_status, title into v_old_status, v_target_title
  from public.dispatches where id = p_dispatch_id;

  if v_old_status is null then
    raise exception 'Dispatch not found.';
  end if;

  -- NEW: idempotency guard.
  if v_old_status = 'hidden' then
    raise exception 'This content is already hidden.';
  end if;

  update public.dispatches
  set moderation_status = 'hidden',
      moderated_at = now()
  where id = p_dispatch_id;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot, reason, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'content_hidden',
    'dispatch', p_dispatch_id, v_target_title, v_reason,
    jsonb_build_object('previous_status', v_old_status, 'new_status', 'hidden')
  );
end;
$function$;

revoke all on function public.admin_hide_dispatch(uuid, text) from public;
grant execute on function public.admin_hide_dispatch(uuid, text) to authenticated;


create or replace function public.admin_restore_dispatch(p_dispatch_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_reason text;
  v_old_status text;
  v_actor_pseudonym text;
  v_target_title text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('moderator') then
    raise exception 'Not authorized.';
  end if;

  -- NEW: report-driven boundary for a moderator-only caller.
  if not public.is_staff('admin') then
    if not exists (
      select 1 from public.reports
      where target_type = 'dispatch' and target_id = p_dispatch_id
    ) then
      raise exception 'Not authorized.';
    end if;
  end if;

  v_reason := trim(both from coalesce(p_reason, ''));
  if char_length(v_reason) = 0 then
    raise exception 'A reason is required.';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'Reason is too long.';
  end if;

  select moderation_status, title into v_old_status, v_target_title
  from public.dispatches where id = p_dispatch_id;

  if v_old_status is null then
    raise exception 'Dispatch not found.';
  end if;

  -- NEW: idempotency guard.
  if v_old_status = 'visible' then
    raise exception 'This content is already visible.';
  end if;

  update public.dispatches
  set moderation_status = 'visible',
      moderated_at = now()
  where id = p_dispatch_id;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot, reason, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'content_restored',
    'dispatch', p_dispatch_id, v_target_title, v_reason,
    jsonb_build_object('previous_status', v_old_status, 'new_status', 'visible')
  );
end;
$function$;

revoke all on function public.admin_restore_dispatch(uuid, text) from public;
grant execute on function public.admin_restore_dispatch(uuid, text) to authenticated;


-- Final pre-apply correction, item 2: hiding an answer now ALSO clears
-- is_current — a hidden answer cannot remain the member's active
-- Discovery selection. This is part of the moderation transition
-- itself, not a separate member action: harmless when the answer
-- wasn't current (false -> false), and required when it was, to keep
-- the "hidden implies not current" invariant true from the instant a
-- row is hidden, rather than relying on some later member action (e.g.
-- set_current_answer's own defense, item 1/4) to eventually clean it
-- up. Deliberately does NOT promote another answer — see
-- admin_restore_question_answer's own comment for the matching
-- decision on restore; the member chooses their own Discovery answer,
-- always. The previous is_current value is captured in audit metadata
-- as `was_current`, to reconstruct exactly what this transition did.
create or replace function public.admin_hide_question_answer(p_answer_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_reason text;
  v_old_status text;
  v_old_is_current boolean;
  v_actor_pseudonym text;
  v_target_label text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('moderator') then
    raise exception 'Not authorized.';
  end if;

  -- NEW: report-driven boundary for a moderator-only caller.
  if not public.is_staff('admin') then
    if not exists (
      select 1 from public.reports
      where target_type = 'question_answer' and target_id = p_answer_id
    ) then
      raise exception 'Not authorized.';
    end if;
  end if;

  v_reason := trim(both from coalesce(p_reason, ''));
  if char_length(v_reason) = 0 then
    raise exception 'A reason is required.';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'Reason is too long.';
  end if;

  select qa.moderation_status, qa.is_current, q.prompt
  into v_old_status, v_old_is_current, v_target_label
  from public.question_answers qa
  join public.questions q on q.id = qa.question_id
  where qa.id = p_answer_id;

  if v_old_status is null then
    raise exception 'Answer not found.';
  end if;

  -- NEW: idempotency guard.
  if v_old_status = 'hidden' then
    raise exception 'This content is already hidden.';
  end if;

  -- NEW: is_current = false folded into the same moderation-transition
  -- UPDATE — see the header comment above.
  update public.question_answers
  set moderation_status = 'hidden',
      moderated_at = now(),
      is_current = false
  where id = p_answer_id;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot, reason, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'content_hidden',
    'question_answer', p_answer_id, v_target_label, v_reason,
    -- NEW: was_current — reconstructs whether this hide also demoted
    -- the member's Discovery selection.
    jsonb_build_object('previous_status', v_old_status, 'new_status', 'hidden', 'was_current', v_old_is_current)
  );
end;
$function$;

revoke all on function public.admin_hide_question_answer(uuid, text) from public;
grant execute on function public.admin_hide_question_answer(uuid, text) to authenticated;


-- Final pre-apply correction, item 3: restore deliberately does NOT set
-- is_current = true. Restoring removes TEMPA's moderation suppression
-- (moderation_status back to 'visible') — it is not TEMPA choosing the
-- member's Discovery selection for them. The member can call
-- set_current_answer themselves afterward if they want this answer
-- featured again; nothing here auto-promotes it.
create or replace function public.admin_restore_question_answer(p_answer_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_reason text;
  v_old_status text;
  v_actor_pseudonym text;
  v_target_label text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('moderator') then
    raise exception 'Not authorized.';
  end if;

  -- NEW: report-driven boundary for a moderator-only caller.
  if not public.is_staff('admin') then
    if not exists (
      select 1 from public.reports
      where target_type = 'question_answer' and target_id = p_answer_id
    ) then
      raise exception 'Not authorized.';
    end if;
  end if;

  v_reason := trim(both from coalesce(p_reason, ''));
  if char_length(v_reason) = 0 then
    raise exception 'A reason is required.';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'Reason is too long.';
  end if;

  select qa.moderation_status, q.prompt
  into v_old_status, v_target_label
  from public.question_answers qa
  join public.questions q on q.id = qa.question_id
  where qa.id = p_answer_id;

  if v_old_status is null then
    raise exception 'Answer not found.';
  end if;

  -- NEW: idempotency guard.
  if v_old_status = 'visible' then
    raise exception 'This content is already visible.';
  end if;

  update public.question_answers
  set moderation_status = 'visible',
      moderated_at = now()
  where id = p_answer_id;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot, reason, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'content_restored',
    'question_answer', p_answer_id, v_target_label, v_reason,
    jsonb_build_object('previous_status', v_old_status, 'new_status', 'visible')
  );
end;
$function$;

revoke all on function public.admin_restore_question_answer(uuid, text) from public;
grant execute on function public.admin_restore_question_answer(uuid, text) to authenticated;


-- ============================================================
-- 6b. ADMIN_GET_REPORT — exposes the target's current moderation status
-- ============================================================
-- Report detail needs to know whether a reported Dispatch/answer is
-- currently visible or already hidden, to render Hide vs Restore
-- correctly — and staff cannot simply query dispatches/question_answers
-- directly for this, since an already-hidden row is invisible to a
-- non-author under the ordinary RLS policy (section 2/3 above) even
-- for a staff member. Reproduced in full from its live definition
-- (docs/sql/2026-09-17-reporting-and-admin-moderation.sql:554-594) with
-- exactly one added trailing column: null for every target_type except
-- dispatch/question_answer, the two types this phase adds moderation
-- state to.
--
-- Requires an explicit DROP first (caught on a post-delivery re-check):
-- Postgres's CREATE OR REPLACE FUNCTION cannot change a RETURNS TABLE
-- column list — adding target_moderation_status here, which the live
-- definition doesn't have, makes plain CREATE OR REPLACE fail with
-- "cannot change return type of existing function" at apply time. Every
-- other function this migration replaces keeps its existing column list
-- (or returns a whole-row composite type, which absorbs section 1's new
-- columns automatically) or is brand new, so this is the only one that
-- needs it.
drop function if exists public.admin_get_report(uuid);

create or replace function public.admin_get_report(p_report_id uuid)
returns table (
  id uuid,
  target_type text,
  target_id uuid,
  reason text,
  context text,
  status text,
  evidence_snapshot jsonb,
  created_at timestamptz,
  reporter_user_id uuid,
  reporter_pseudonym text,
  reported_user_id uuid,
  reported_pseudonym text,
  reported_current_status text,
  target_moderation_status text
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if not public.is_staff() then
    raise exception 'Not authorized.';
  end if;

  return query
    select
      r.id, r.target_type, r.target_id, r.reason, r.context, r.status,
      r.evidence_snapshot, r.created_at,
      r.reporter_user_id, rp.pseudonym, r.reported_user_id, tp.pseudonym,
      coalesce(aes.status, 'active'),
      case r.target_type
        when 'dispatch' then (select d.moderation_status from public.dispatches d where d.id = r.target_id)
        when 'question_answer' then (select qa.moderation_status from public.question_answers qa where qa.id = r.target_id)
        else null
      end
    from public.reports r
    join public.profiles rp on rp.id = r.reporter_user_id
    join public.profiles tp on tp.id = r.reported_user_id
    left join public.account_enforcement_state aes on aes.user_id = r.reported_user_id
    where r.id = p_report_id;
end;
$function$;

revoke all on function public.admin_get_report(uuid) from public;
grant execute on function public.admin_get_report(uuid) to authenticated;


-- ============================================================
-- 7. PROACTIVE PUBLIC CONTENT REVIEW — admin-only (§12), corrected per
-- independent review item 7
-- ============================================================
-- is_staff('admin'), not 'moderator': a moderator's content access
-- stays strictly report-driven, per the locked permission split — this
-- is the one RPC that grants proactive, unreported-content visibility,
-- so it alone carries the higher floor. Bounded (clamped limit/offset),
-- newest-first across both content types via one UNION ALL, never an
-- unbounded query. No private correspondence of any kind is reachable
-- here — only public.dispatches (already-published) and
-- public.question_answers (already-live-to-Minds), never letters,
-- moments, or letter_postcards.
--
-- INDEPENDENT REVIEW ITEM 7 (revised in the final mutation-boundary
-- audit round): the question_answer branch previously returned an
-- answer regardless of its Question's is_active state, mislabeling
-- historical/frozen material as current "Public Content." A VISIBLE
-- answer now requires q.is_active = true — a visible answer to a
-- deactivated Question is historical, not current public content, and
-- never appears here. A HIDDEN answer, however, is now shown
-- REGARDLESS of its Question's is_active state: once hidden, the row is
-- a moderation record Admin may need to inspect/restore at any later
-- point, and an intervening Question deactivation must not cause a
-- hidden-and-still-under-management row to silently vanish from this
-- surface (an earlier version of this fix required q.is_active = true
-- unconditionally, including for hidden rows — that was too strict:
-- Admin could hide an answer, the Question could later be deactivated
-- for unrelated reasons, and the hidden row would then become
-- unreachable from Public Content Review even though it still needs
-- lifecycle management). Ordinary visible answers to an inactive
-- Question still never appear, status filter or not.
create or replace function public.admin_list_public_content(
  p_type text default null,
  p_status text default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  content_type text,
  id uuid,
  title text,
  excerpt text,
  author_id uuid,
  author_pseudonym text,
  moderation_status text,
  moderated_at timestamptz,
  content_created_at timestamptz
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_limit integer;
  v_offset integer;
begin
  if not public.is_staff('admin') then
    raise exception 'Not authorized.';
  end if;

  if p_type is not null and p_type not in ('dispatch', 'question_answer') then
    raise exception 'Unknown content type.';
  end if;
  if p_status is not null and p_status not in ('visible', 'hidden') then
    raise exception 'Unknown status.';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  return query
    select combined.* from (
      select
        'dispatch'::text as content_type,
        d.id,
        d.title,
        left(d.body, 280) as excerpt,
        d.author_id,
        p.pseudonym as author_pseudonym,
        d.moderation_status,
        d.moderated_at,
        d.published_at as content_created_at
      from public.dispatches d
      join public.profiles p on p.id = d.author_id
      where d.status = 'published'
        and (p_type is null or p_type = 'dispatch')
        and (p_status is null or d.moderation_status = p_status)

      union all

      select
        'question_answer'::text as content_type,
        qa.id,
        q.prompt as title,
        left(qa.body, 280) as excerpt,
        qa.user_id as author_id,
        p.pseudonym as author_pseudonym,
        qa.moderation_status,
        qa.moderated_at,
        qa.updated_at as content_created_at
      from public.question_answers qa
      join public.questions q on q.id = qa.question_id
      join public.profiles p on p.id = qa.user_id
      where (
        (qa.moderation_status = 'visible' and q.is_active = true)
        or qa.moderation_status = 'hidden'
      )
        and (p_type is null or p_type = 'question_answer')
        and (p_status is null or qa.moderation_status = p_status)
    ) combined
    order by combined.content_created_at desc
    limit v_limit
    offset v_offset;
end;
$function$;

revoke all on function public.admin_list_public_content(text, text, integer, integer) from public;
grant execute on function public.admin_list_public_content(text, text, integer, integer) to authenticated;


-- ============================================================
-- 8. QUESTIONS ADMIN — admin-only (§17), corrected per independent
-- review item 8
-- ============================================================
-- All three functions require is_staff('admin'), per the locked
-- permission split. Scoped to canonical Questions only (slug is not
-- null) — no Create control anywhere here, matching Decision 2 exactly
-- (an admin-created row would never actually be offered to a member
-- under the current CANONICAL_QUESTION_SLUGS-driven runtime, so no
-- Create RPC is built to avoid a fake control).

create or replace function public.admin_list_questions()
returns table (
  id uuid,
  slug text,
  prompt text,
  is_active boolean,
  answer_count bigint,
  first_letter_count bigint
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
      q.prompt,
      q.is_active,
      (select count(*) from public.question_answers qa where qa.question_id = q.id),
      (
        select count(*) from public.letters l
        join public.question_answers qa2 on qa2.id = l.question_answer_id
        where qa2.question_id = q.id
      )
    from public.questions q
    where q.slug is not null
    order by q.slug;
end;
$function$;

revoke all on function public.admin_list_questions() from public;
grant execute on function public.admin_list_questions() to authenticated;


-- INDEPENDENT REVIEW ITEM 6 (activation idempotency, final audit
-- round): a call that would leave is_active unchanged (active -> active
-- or inactive -> inactive) now raises a clear staff-facing error rather
-- than logging a fabricated transition — same convention as the Hide/
-- Restore idempotency guards in section 6 above.
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

  -- Final pre-apply correction, item 7: reject malformed input
  -- explicitly, before any lookup or state change — never rely on the
  -- underlying boolean column's NOT NULL constraint to catch this.
  if p_active is null then
    raise exception 'An active state is required.';
  end if;

  select prompt, is_active into v_prompt, v_was_active
  from public.questions where id = p_question_id and slug is not null;

  if v_prompt is null then
    raise exception 'Question not found.';
  end if;

  -- NEW: idempotency guard.
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


-- LOCKED immutability rule (Decision 5), enforced HERE server-side —
-- never only by the admin UI disabling the field. A Question with >= 1
-- question_answers row rejects any prompt change outright.
--
-- INDEPENDENT REVIEW ITEM 8: ALSO now requires the Question to be
-- currently INACTIVE — not just answer_count = 0. Rationale: an active,
-- zero-answer Question is still being actively OFFERED to members right
-- now (getCanonicalQuestions() requires is_active = true); editing its
-- prompt while it's live risks a member composing against one prompt
-- and having it silently read differently by the time their answer
-- lands, or by anyone reading it afterward. Requiring Deactivate first
-- makes "no member is currently being offered this exact wording" an
-- explicit precondition, not an accident of timing, and pairs directly
-- with section 3b's new server-side rejection of writes to inactive
-- Questions (an admin editing a deactivated Question's prompt can never
-- collide with an in-flight member submission, since none can land
-- while it's inactive).
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
  where id = p_question_id and slug is not null;

  if v_is_active is null then
    raise exception 'Question not found.';
  end if;

  -- NEW: the one addition — must be deactivated first.
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


-- ============================================================
-- 9. CONTENT AUDIT READ — corrected per independent review item 2
-- (§18)
-- ============================================================
-- Signature UNCHANGED (p_target_type, p_target_id, p_limit — all still
-- optional/default null). Permission model corrected:
--
-- ADMIN (is_staff('admin')): may call with any combination, including
-- null/null for a broader/global content-audit query, matching Public
-- Content Review's own admin-only proactive floor.
--
-- MODERATOR (is_staff('moderator') but not 'admin'): MUST supply both
-- p_target_type AND p_target_id, AND that exact target must correspond
-- to content that has been reported (same report-existence check as
-- section 6's hide/restore RPCs) — otherwise this raises the same
-- generic 'Not authorized.' a non-staff caller gets. This keeps a
-- moderator's audit access exactly as report-driven as their hide/
-- restore access, never a general proactive browsing capability.
--
-- Also clamps p_limit to a safe, POSITIVE bounded range (the prior
-- `least(coalesce(p_limit, 100), 200)` had no floor, so a caller
-- passing 0 or a negative p_limit got zero/undefined rows instead of a
-- sane default — now `least(greatest(coalesce(p_limit, 100), 1), 200)`).
create or replace function public.admin_list_content_audit(
  p_target_type text default null,
  p_target_id uuid default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  actor_identifier_snapshot text,
  action text,
  target_type text,
  target_id uuid,
  target_identifier_snapshot text,
  reason text,
  metadata jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if not public.is_staff() then
    raise exception 'Not authorized.';
  end if;

  -- NEW: moderator-floor callers must supply a specific, reported
  -- target — never a global/broad query.
  if not public.is_staff('admin') then
    if p_target_type is null or p_target_id is null then
      raise exception 'Not authorized.';
    end if;

    if not exists (
      select 1 from public.reports
      where target_type = p_target_type and target_id = p_target_id
    ) then
      raise exception 'Not authorized.';
    end if;
  end if;

  return query
    select
      a.id, a.actor_identifier_snapshot, a.action, a.target_type, a.target_id,
      a.target_identifier_snapshot, a.reason, a.metadata, a.created_at
    from public.admin_audit_log a
    where (p_target_type is null or a.target_type = p_target_type)
      and (p_target_id is null or a.target_id = p_target_id)
    order by a.created_at desc
    -- NEW: floor of 1, not just a ceiling of 200.
    limit least(greatest(coalesce(p_limit, 100), 1), 200);
end;
$function$;

revoke all on function public.admin_list_content_audit(text, uuid, integer) from public;
grant execute on function public.admin_list_content_audit(text, uuid, integer) to authenticated;

commit;
