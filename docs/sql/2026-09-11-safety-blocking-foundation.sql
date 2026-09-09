-- ============================================================
-- TEMPA — SAFETY & TRUST, CHECKPOINT 1B: BLOCKING + ENFORCEMENT
-- FOUNDATION
-- PREPARED 2026-09-11. NOT EXECUTED — review, then run in the Supabase
-- SQL editor.
-- ============================================================
--
-- Incremental against the CURRENT LIVE schema — no table recreated, no
-- Dispatches/letters/profiles/question_answers rebuilt. Every existing
-- function below is modified via a minimal, precise diff against its
-- actual current live body (traced from docs/sql/*.sql immediately
-- before writing this file, not assumed) — the added lines are called
-- out in each function's own comment.
--
-- Convention followed throughout (the "locked-down" pattern already
-- established in search_letterbox/delete_dispatch, per the Checkpoint
-- 1A audit): SECURITY DEFINER functions use `set search_path to
-- 'pg_catalog'`, every application object is fully `public.`-qualified,
-- every function gets an explicit `revoke all ... from public` then a
-- targeted `grant execute ... to <role>`, and every new RLS policy
-- carries an explicit `to <role>` clause — never left to default to
-- PUBLIC (the exact bug class found and fixed twice already this
-- engagement: dispatch_photos_insert/select, then letter_photos_select).
--
-- One BEGIN/COMMIT — this is one coherent, all-or-nothing safety
-- foundation; a partial application would leave enforcement gaps.

begin;

-- ============================================================
-- 0. PRIVILEGE HARDENING — profiles, question_answers, public_profiles
-- ============================================================
-- Live diagnostic finding (Checkpoint 1B): anon and authenticated both
-- hold effective TRUNCATE privilege on public.profiles and
-- public.question_answers, plus unnecessary REFERENCES/TRIGGER grants.
-- RLS does not make TRUNCATE safe — RLS governs which ROWS a role can
-- touch via SELECT/INSERT/UPDATE/DELETE; TRUNCATE is a table-level
-- operation RLS has no jurisdiction over at all, and would empty the
-- table for every user in one statement regardless of any policy.
--
-- Traced before touching anything, per the checkpoint's own
-- instruction:
--   - profiles: authenticated genuinely needs SELECT (own row, via
--     profiles_select_own-equivalent RLS), INSERT (onboarding —
--     app/profile/profile-form.tsx's direct `.insert()`), and UPDATE
--     (editing — same form's `.update()`). None of these are touched
--     here. TRUNCATE/TRIGGER/REFERENCES have no caller anywhere in this
--     codebase — a plain grep for `truncate` on this table, and for any
--     migration creating a new table with `references profiles`, both
--     find no application-level use of these three privileges by
--     anon/authenticated. anon has no legitimate reason to hold ANY
--     privilege on this table at all — no anonymous code path
--     (including /d/[shareToken], which never queries profiles
--     directly) ever needs it.
--   - question_answers: authenticated genuinely needs SELECT/INSERT/
--     UPDATE because publish_question_answer/set_current_answer are
--     both SECURITY INVOKER (confirmed by re-reading their live
--     bodies) — an invoker function runs with the CALLER's own
--     privileges, so the client's direct table grant is what actually
--     makes those RPCs work, gated by question_answers' own
--     self-scoped RLS policies. Same TRUNCATE/TRIGGER/REFERENCES/anon
--     reasoning as profiles applies identically here.
--   - public_profiles: a read-only view. TRUNCATE/REFERENCES do not
--     even apply to views in Postgres; INSERT/UPDATE/DELETE are
--     revoked defensively in case a prior broad grant included them —
--     a view should never carry mutation privileges for a role that
--     only ever needs to read it.
--
-- These three unnecessary privileges almost certainly trace back to
-- Supabase's own project-level `ALTER DEFAULT PRIVILEGES ... GRANT ALL
-- ON TABLES ...` bootstrapping (every new Supabase project grants broad
-- default table privileges to anon/authenticated/service_role on
-- schema creation, on the philosophy that RLS is the intended
-- boundary) — NOT something introduced by this codebase's own
-- migrations. That means any FUTURE `create table public.X (...)`
-- (including every table added later in this very file) will inherit
-- the same broad default grant unless the project's own default
-- privileges are changed. That is a project-wide, cross-cutting
-- decision affecting every future table, not a Checkpoint 1B decision
-- — deliberately NOT touched here per the instruction not to modify
-- default privileges blindly. Flagged as a separate, explicit future
-- decision (see the report's "remaining issues" section) — for now,
-- every new table created below gets its own explicit revoke/grant
-- pass, exactly like every other table in this codebase already does,
-- so this migration is correct regardless of what the default-
-- privilege decision eventually becomes.

revoke truncate, trigger, references on public.profiles from anon, authenticated;
revoke all on public.profiles from anon;

revoke truncate, trigger, references on public.question_answers from anon, authenticated;
revoke all on public.question_answers from anon;

revoke insert, update, delete, truncate, trigger, references
  on public.public_profiles from anon, authenticated;
-- select on public.public_profiles is preserved for authenticated below,
-- once the view itself is rewritten (section 5) — not re-granted here
-- to avoid a moment where the OLD, non-block-aware view is newly
-- select-granted twice in one migration.


-- ============================================================
-- 1. PRIVATE, NON-API-EXPOSED SCHEMA — no public block-check oracle
-- ============================================================
-- tempa_private is never added to Supabase's PostgREST "exposed
-- schemas" list (a project-config setting, not something SQL can set)
-- — by default, only newly-listed schemas are exposed, so simply never
-- listing this one is sufficient, structural non-exposure, not a
-- promise. tempa_private.is_blocked_pair (defined below, in section 2,
-- AFTER blocked_users exists — see that section's own note on why the
-- ordering was corrected) lives here specifically so it CANNOT become a
-- callable `rpc/is_blocked_pair` endpoint under any circumstance,
-- unlike every other function in this file (which live in `public`
-- because they're either genuinely meant to be called directly, or —
-- for the storage visibility functions — must live in `public` for the
-- existing storage policies that already reference them unqualified).
create schema if not exists tempa_private;
revoke all on schema tempa_private from public, anon, authenticated;


-- ============================================================
-- 2. BLOCKED_USERS — the directional block record
-- ============================================================
-- Same proven shape as kept_minds (docs/sql/2026-09-07-dispatches-and-
-- board.sql): one row per directional relationship, RLS scoped so the
-- BLOCKED party has zero visibility into rows naming them as
-- blocked_id — not by convention, by construction. No UPDATE policy at
-- all (a block is created or removed, never edited in place).
create table public.blocked_users (
  blocker_id uuid not null
    references auth.users(id)
    on delete cascade,

  blocked_id uuid not null
    references auth.users(id)
    on delete cascade,

  created_at timestamptz not null default now(),

  -- Private to the blocker only — never surfaced to the blocked party,
  -- never used in any product-facing count or list beyond the
  -- blocker's own "Blocked minds" screen.
  reason text,

  constraint blocked_users_no_self_block
    check (blocker_id <> blocked_id),

  primary key (blocker_id, blocked_id)
);

create index blocked_users_blocked_id_idx on public.blocked_users (blocked_id);

alter table public.blocked_users enable row level security;

create policy blocked_users_select_own
  on public.blocked_users
  for select
  to authenticated
  using (auth.uid() = blocker_id);

-- No insert/update/delete policy of any kind — every write goes
-- through block_user/unblock_user below. A direct client INSERT would
-- be RLS-permitted for a self-scoped row in principle, but there is no
-- INSERT policy at all, so it is refused outright regardless — writes
-- exist ONLY as a side effect of the two RPCs, which is what lets
-- block_user atomically cascade the kept_minds cleanup in the same
-- transaction as the block itself.
revoke all on public.blocked_users from public, anon, authenticated;
grant select on public.blocked_users to authenticated;

-- Pre-execution audit correction (2026-09-11): this function previously
-- appeared BEFORE public.blocked_users in section 1, on the reasoning
-- that a `language sql` function body is not resolved against the
-- catalog until first execution. That reasoning is very likely correct
-- for plain CREATE FUNCTION, but the audit's own standard was "zero
-- avoidable risk" — reordering costs nothing and removes the question
-- entirely, so it is defined here, strictly AFTER blocked_users exists,
-- with no forward reference of any kind anywhere in this file.
--
-- SECURITY DEFINER is required, not a convenience: checking BOTH
-- directions of a potential block means reading a row where the caller
-- is `blocked_id` — exactly the row blocked_users_select_own above
-- never lets them see directly. This function's body is the ONLY place
-- that boundary is deliberately crossed, and only ever to answer a
-- boolean, never to return row contents.
create or replace function tempa_private.is_blocked_pair(a uuid, b uuid)
returns boolean
language sql
security definer
set search_path to 'pg_catalog'
stable
as $$
  select exists (
    select 1 from public.blocked_users
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  )
$$;

-- No grant to public/anon/authenticated at all — this function is only
-- ever called from WITHIN another SECURITY DEFINER function owned by
-- the same role, which needs no separate EXECUTE grant on it. There is
-- no way to reach it directly as a client under any role this project
-- uses.

-- Caught during app-layer wiring, recorded here rather than silently
-- worked around: section 5's block-aware public_profiles view means a
-- caller can no longer resolve a pseudonym for someone THEY THEMSELVES
-- blocked — the view's own WHERE clause excludes exactly that pair, on
-- both sides. That is correct everywhere else, but it would break the
-- one legitimate place a member needs to see a blocked pseudonym: their
-- own Settings → Safety → Blocked minds screen. This narrow RPC exists
-- solely for that screen — it returns pseudonym/country ONLY for rows
-- in the CALLER's own blocked_users (blocker_id = auth.uid()), which
-- they already created themselves; it exposes nothing they don't
-- already know, and nothing about anyone else's blocks.
create or replace function public.get_blocked_profiles()
returns table (
  id uuid,
  pseudonym text,
  country text,
  created_at timestamptz
)
language sql
security definer
set search_path to 'pg_catalog'
stable
as $$
  select p.id, p.pseudonym, p.country, b.created_at
  from public.blocked_users b
  join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid()
  order by b.created_at desc
$$;

revoke all on function public.get_blocked_profiles() from public;
grant execute on function public.get_blocked_profiles() to authenticated;


-- ============================================================
-- 3. BLOCK_USER / UNBLOCK_USER
-- ============================================================
create or replace function public.block_user(p_blocked_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if auth.uid() = p_blocked_id then
    raise exception 'You cannot block yourself.';
  end if;

  if not exists (select 1 from public.profiles where id = p_blocked_id) then
    raise exception 'Member not found.';
  end if;

  insert into public.blocked_users (blocker_id, blocked_id)
  values (auth.uid(), p_blocked_id)
  on conflict (blocker_id, blocked_id) do nothing;

  -- Keep cascade — approved: blocking removes Keep in BOTH directions,
  -- atomically, in the same transaction as the block itself. Direct
  -- table access (not through keep_mind/unkeep_mind) is correct and
  -- necessary here: SECURITY DEFINER lets this reach the row where the
  -- caller is merely kept_user_id (the other side's Keep of them),
  -- which their own RLS would never permit them to touch directly.
  delete from public.kept_minds
  where (viewer_user_id = auth.uid() and kept_user_id = p_blocked_id)
     or (viewer_user_id = p_blocked_id and kept_user_id = auth.uid());
end;
$function$;

revoke all on function public.block_user(uuid) from public;
grant execute on function public.block_user(uuid) to authenticated;

create or replace function public.unblock_user(p_blocked_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  -- Only the original blocker may remove their own block row — RLS on
  -- blocked_users would already prevent a caller from deleting a row
  -- naming someone else as blocker_id even without this check, since
  -- there is no delete policy at all; this WHERE clause is the actual
  -- authorization inside the definer context, not a redundant gesture.
  delete from public.blocked_users
  where blocker_id = auth.uid()
    and blocked_id = p_blocked_id;

  -- Deliberately does NOT restore kept_minds — approved: unblock does
  -- not resurrect a Keep relationship that existed before the block.
end;
$function$;

revoke all on function public.unblock_user(uuid) from public;
grant execute on function public.unblock_user(uuid) to authenticated;


-- ============================================================
-- 4. ACCOUNT_ENFORCEMENT_STATE
-- ============================================================
-- Deliberately a separate table from profiles/public_profiles, never
-- columns bolted onto either — those are both broadly read today
-- (Discovery, Board, Home); a dedicated table with its own RLS is a
-- structural boundary a future `select *`/view change cannot
-- accidentally widen. No row exists for an ordinary member until a
-- moderator ever touches their account — absence of a row means
-- 'active', read by current_account_status() below, so this migration
-- never needs to backfill every existing user with an explicit row.
create table public.account_enforcement_state (
  user_id uuid primary key
    references auth.users(id)
    on delete cascade,

  status text not null default 'active'
    check (status in ('active', 'restricted', 'suspended', 'banned')),

  status_reason text,

  changed_by uuid references auth.users(id) on delete set null,

  changed_at timestamptz not null default now()
);

alter table public.account_enforcement_state enable row level security;

create policy account_enforcement_state_select_own
  on public.account_enforcement_state
  for select
  to authenticated
  using (auth.uid() = user_id);

-- No insert/update/delete policy for anyone — this checkpoint builds
-- no moderator-facing write path yet (explicitly deferred to the
-- future admin enforcement checkpoint); the table exists now so the
-- write RPCs below have something authoritative to check, and so a
-- member's own client can read their own status if ever needed,
-- without granting any member the ability to alter it.
revoke all on public.account_enforcement_state from public, anon, authenticated;
grant select on public.account_enforcement_state to authenticated;

-- Client-safe: only ever returns the CALLER's own status (auth.uid()),
-- never anyone else's — SECURITY DEFINER purely so it works
-- identically whether called directly by a client or from inside
-- another SECURITY DEFINER RPC, with zero privilege ambiguity either
-- way; the explicit `where user_id = auth.uid()` is the actual
-- filtering regardless of which role ends up evaluating it.
create or replace function public.current_account_status()
returns text
language sql
security definer
set search_path to 'pg_catalog'
stable
as $$
  select coalesce(
    (select status from public.account_enforcement_state where user_id = auth.uid()),
    'active'
  )
$$;

revoke all on function public.current_account_status() from public;
grant execute on function public.current_account_status() to authenticated;


-- ============================================================
-- 5. PUBLIC_PROFILES — rewritten block-aware
-- ============================================================
-- Correction from the Checkpoint 1A draft: does NOT touch profiles'
-- own RLS (which correctly stays self-only) and does NOT convert this
-- view to security_invoker (which would break it — profiles' own RLS
-- would then reject any cross-user row entirely, before block logic
-- ever runs, since an ordinary member has no SELECT policy granting
-- them another member's raw profiles row at all). The view keeps its
-- existing definer-style (default, non-invoker) access to the
-- underlying table, and the block exclusion is embedded directly in
-- the view's own WHERE clause — the view IS the curated, intentionally
-- broader cross-user surface; that has not changed, only who a viewer
-- vs one specific other row's visibility now depends on.
--
-- security_barrier=true is added: it prevents the query planner from
-- pushing a caller-supplied filter (e.g. `?id=eq.X`) evaluation ahead
-- of this view's own security-relevant WHERE clause in a way that
-- could otherwise leak information through a maliciously-crafted
-- volatile function in a pushed-down predicate — the standard
-- protection for any view whose WHERE clause is doing real access
-- control, not just convenience filtering. It changes nothing about
-- normal query results.
--
-- auth.uid() = p.id: a member can always see their own row through
-- this view regardless of the (impossible, blocked_users_no_self_block-
-- prevented) self-block edge case — defensive, not load-bearing.
create or replace view public.public_profiles
with (security_barrier = true)
as
select
  p.id,
  p.pseudonym,
  p.country,
  p.gender,
  p.gender_custom,
  p.age_range,
  p.languages,
  p.intent,
  p.pinned_dispatch_id
from public.profiles p
where
  auth.uid() = p.id
  or not tempa_private.is_blocked_pair(auth.uid(), p.id);

grant select on public.public_profiles to authenticated;

-- Verification target: `GET public_profiles?id=eq.<blocked-user>` must
-- return zero rows for the other side of a block, through this view,
-- regardless of caller (app code or raw PostgREST) — see the
-- verification script.


-- ============================================================
-- 6. DISPATCHES — block-aware published-Dispatch visibility
-- ============================================================
-- The only change from the live policy (docs/sql/2026-09-06-open-
-- letters.sql:87-91, renamed in 2026-09-07-dispatches-and-board.sql)
-- is the added `and not tempa_private.is_blocked_pair(...)` — the
-- author-escape-hatch (`or author_id = auth.uid()`) is completely
-- unchanged, so an author never loses access to their own Dispatch.
--
-- dispatch_topics_select/dispatch_moments_select_published both gate
-- via a genuine `exists (select 1 from public.dispatches d where ...)`
-- subquery against this exact table — Postgres RLS applies recursively
-- to a protected table referenced anywhere in a query plan, including
-- inside another policy's own USING clause, so both inherit this fix
-- automatically with NO separate change needed. Confirmed structurally
-- correct, not assumed: neither table's own policy literally
-- re-implements "published or own" as a private condition — both
-- delegate via a real subquery against dispatches itself.
--
-- getPublishedDispatches/getHomeBoardDispatches (lib/dispatches.ts) are
-- plain `.from('dispatches').select()` calls — ordinary PostgREST
-- reads under the CALLER's own RLS, not RPC calls — so this single
-- policy change also protects them with NO application code change.
--
-- search_dispatches is SECURITY INVOKER (confirmed by re-reading its
-- live body — corrects the Checkpoint 1A architecture note, which
-- assumed DEFINER by pattern-matching to other RPCs without verifying
-- this one directly): being invoker, it runs under the caller's own
-- RLS too, and its own query is a plain `select d.* from public.
-- dispatches d where d.status = 'published' and ...` — no separate
-- code change needed there either. get_shared_dispatch is untouched
-- (SECURITY DEFINER, anon-facing, deliberately outside blocking's
-- reach per the external-share limitation).
drop policy dispatches_select_published on public.dispatches;

create policy dispatches_select_published
  on public.dispatches
  for select
  to authenticated
  using (
    (
      status = 'published'
      and not tempa_private.is_blocked_pair(auth.uid(), author_id)
    )
    or author_id = auth.uid()
  );


-- ============================================================
-- 7. QUESTION_ANSWERS — block-aware cross-user SELECT
-- ============================================================
-- Live policy captured by the Checkpoint 1B diagnostic:
--   "Answers to active questions are readable by authenticated users"
--   to authenticated, for select, using (
--     exists (select 1 from questions q
--             where q.id = question_answers.question_id
--               and q.is_active = true)
--   )
-- Rewritten to add the block exclusion; the self-SELECT policy (a
-- separate, pre-existing policy letting a member read their OWN
-- answers regardless of question/is_active state) is NOT touched —
-- confirmed by the diagnostic to be a distinct policy object, so a
-- member always retains full access to their own answers regardless of
-- this change.
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
    and not tempa_private.is_blocked_pair(auth.uid(), question_answers.user_id)
  );

-- get_post_closure_recommendations reads question_answers cross-user —
-- traced directly (docs/sql/2026-08-30-letters.sql:680-820) as part of
-- the pre-execution audit: it is SECURITY DEFINER, `set search_path to
-- 'public'`, and joins `public.profiles`/`public.question_answers`
-- DIRECTLY (not through public_profiles or the now-block-aware RLS
-- policy) — meaning it runs as the function owner and BYPASSES both
-- the question_answers RLS fix above AND public_profiles entirely. A
-- blocked pair would otherwise still be recommended to each other after
-- a closed first-contact letter. Reproduced verbatim below (re-read
-- directly, not from memory) with exactly one addition: the block
-- exclusion in the WHERE clause. RETURNS TABLE shape, parameter list,
-- and every other property are byte-for-byte unchanged from the live
-- version — the class of CREATE OR REPLACE failure that broke
-- get_shared_dispatch earlier this engagement (changing an OUT/table
-- shape) does not apply here, since no column was added, removed, or
-- reordered.
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
set search_path to 'public'
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
      -- NEW: the one addition — a blocked pair must never be
      -- recommended to each other, in either direction.
      and not tempa_private.is_blocked_pair(auth.uid(), qa.user_id)

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

-- CREATE OR REPLACE preserves the function's existing ACL (grant
-- execute to authenticated, already live from 2026-08-30-letters.sql)
-- — Postgres does not reset permissions when a function's body is
-- replaced in place, only when it is dropped and recreated. No new
-- grant statement is needed or added here; verified explicitly in the
-- verification script rather than assumed.


-- ============================================================
-- 8. KEPT_MINDS — RPC-only mutation
-- ============================================================
-- Live grant today: `grant select, insert, delete on public.kept_minds
-- to authenticated` (docs/sql/2026-09-07-dispatches-and-board.sql) —
-- direct client insert/delete, gated only by kept_minds_own's RLS, no
-- RPC at all. This is the one write surface in the whole schema that
-- was never RPC-gated, and it is exactly what would let a hostile
-- client bypass any block check placed only inside a new keep_mind RPC
-- while this direct grant remained. Revoking insert/delete and
-- introducing keep_mind/unkeep_mind as the only write path closes this.
revoke insert, delete on public.kept_minds from authenticated;
-- select is preserved — a member still needs to read their own Keep
-- list, correctly scoped by the existing kept_minds_own policy.

create or replace function public.keep_mind(p_kept_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if auth.uid() = p_kept_user_id then
    raise exception 'You cannot Keep yourself in mind.';
  end if;

  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'This action is not available right now.';
  end if;

  if tempa_private.is_blocked_pair(auth.uid(), p_kept_user_id) then
    raise exception 'This action is not available right now.';
  end if;

  insert into public.kept_minds (viewer_user_id, kept_user_id)
  values (auth.uid(), p_kept_user_id)
  on conflict (viewer_user_id, kept_user_id) do nothing;
end;
$function$;

revoke all on function public.keep_mind(uuid) from public;
grant execute on function public.keep_mind(uuid) to authenticated;

-- De-escalating — approved to remain available regardless of account
-- status or block state; removing your own Keep never imposes
-- anything on anyone else.
create or replace function public.unkeep_mind(p_kept_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  delete from public.kept_minds
  where viewer_user_id = auth.uid()
    and kept_user_id = p_kept_user_id;
end;
$function$;

revoke all on function public.unkeep_mind(uuid) from public;
grant execute on function public.unkeep_mind(uuid) to authenticated;

-- Note: the OLD keepMind/unkeepMind error-code convention in
-- lib/dispatches.ts (23505 = "already kept, treat as success") is
-- superseded here — keep_mind's own ON CONFLICT DO NOTHING already
-- makes a duplicate Keep a silent success without ever raising 23505 in
-- the first place, so the application-layer duplicate-key handling
-- becomes dead code once this RPC is wired in (removed in the app-layer
-- change, not here).


-- ============================================================
-- 9. LETTER RPCs — block + account-status enforcement
-- ============================================================
-- Neutral failure wording throughout: every rejection below reuses
-- exact phrasing already used elsewhere in this file for an unrelated
-- legitimate failure ("This action is not available right now.") or
-- the exact pre-existing wording for a genuinely unrelated case
-- (e.g. "Recipient does not exist.") — never a new string that would
-- let a blocked/restricted caller distinguish "you're blocked" from
-- "you're restricted" from "this account doesn't exist" by trying
-- variations. All three conditions below produce the IDENTICAL message
-- and the identical exception shape.

create or replace function public.send_first_letter(
  p_recipient_id uuid,
  p_question_answer_id uuid,
  p_body text
)
returns public.letters_for_participant
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$

declare
  v_new_id uuid;
  v_correspondence_id uuid;
  v_participant_low uuid;
  v_participant_high uuid;
  v_established_at timestamptz;
  v_deliver_at timestamptz;
  v_expires_at timestamptz;
  result public.letters_for_participant;

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;


  if auth.uid() = p_recipient_id then
    raise exception
      'You cannot write a first-contact letter to yourself.';
  end if;


  -- NEW: restricted/suspended/banned may never initiate a first
  -- contact; a blocked pair may never write to each other at all,
  -- regardless of status. Both checks produce the SAME neutral wording
  -- as the pre-existing "recipient does not exist" case just below, so
  -- none of the three is distinguishable from the others.
  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'Recipient does not exist.';
  end if;

  if tempa_private.is_blocked_pair(auth.uid(), p_recipient_id) then
    raise exception 'Recipient does not exist.';
  end if;


  if not exists (
    select 1
    from public.profiles
    where id = p_recipient_id
  ) then
    raise exception 'Recipient does not exist.';
  end if;


  if not exists (
    select 1

    from public.question_answers qa

    join public.questions q
      on q.id = qa.question_id

    where
      qa.id = p_question_answer_id
      and qa.user_id = p_recipient_id
      and qa.is_current = true
      and q.is_active = true
  ) then
    raise exception
      'That Question answer is not currently a live Discovery entry for the intended recipient.';
  end if;


  v_participant_low := least(auth.uid(), p_recipient_id);
  v_participant_high := greatest(auth.uid(), p_recipient_id);


  insert into public.correspondences (participant_low, participant_high)
  values (v_participant_low, v_participant_high)
  on conflict (participant_low, participant_high) where status = 'active'
  do nothing
  returning id into v_correspondence_id;

  if v_correspondence_id is null then
    select id
    into v_correspondence_id
    from public.correspondences
    where participant_low = v_participant_low
      and participant_high = v_participant_high
      and status = 'active';
  end if;

  select established_at
  into v_established_at
  from public.correspondences
  where id = v_correspondence_id
  for update;


  if v_established_at is not null then
    raise exception
      'This correspondence is already established. Use write_letter instead.';
  end if;


  if exists (
    select 1
    from public.letters
    where correspondence_id = v_correspondence_id
      and reply_to_id is null
      and sender_id = auth.uid()
  ) then
    raise exception
      'You have already sent a first-contact letter to this recipient.'
      using errcode = '23505';
  end if;


  v_new_id := pg_catalog.gen_random_uuid();
  v_deliver_at := now();
  v_expires_at := v_deliver_at + interval '72 hours';


  insert into public.letters (
    id,
    sender_id,
    recipient_id,
    question_answer_id,
    correspondence_id,
    body,
    deliver_at,
    expires_at
  )
  values (
    v_new_id,
    auth.uid(),
    p_recipient_id,
    p_question_answer_id,
    v_correspondence_id,
    p_body,
    v_deliver_at,
    v_expires_at
  );


  select *
  into result

  from public.letters_for_participant

  where id = v_new_id;


  return result;

end;
$function$;


-- reply_to_letter — NEW: suspended/banned may never reply; restricted
-- may reply with TEXT ONLY (moment_count = 0) — a restricted attempt
-- WITH Moments fails with the pre-existing Moments-gating message
-- style, not a new one. A blocked pair may never reply at all,
-- regardless of status — checked first, before any status branching,
-- with the SAME neutral wording as the existing "not found" case.
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


  -- NEW: block check — neither side may reply at all while blocked,
  -- regardless of status. Same neutral wording as the row-not-found
  -- case immediately above.
  if tempa_private.is_blocked_pair(auth.uid(), original.sender_id) then
    raise exception
      'Letter not found, not addressed to you, or no longer awaiting a reply.';
  end if;

  -- NEW: account-status gating. suspended/banned: no reply at all.
  -- restricted: text-only — a Moments attachment is rejected with the
  -- same message the existing "Moments not available yet" branch below
  -- already uses, so a restricted member sees identical wording to a
  -- member who simply hasn't unlocked Moments yet.
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

    insert into public.moments (
      letter_id,
      position,
      type,
      image_path,
      postcard_key
    )
    select
      new_id,
      (m->>'position')::integer,
      m->>'type',
      m->>'image_path',
      m->>'postcard_key'
    from jsonb_array_elements(p_moments) as m;

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


-- write_letter — identical treatment to reply_to_letter: block check
-- first (neutral "correspondence not found" wording, matching the
-- pre-existing not-found case), then suspended/banned full block,
-- then restricted text-only.
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

  -- NEW: block check first, same neutral wording as the pre-existing
  -- not-found case above.
  if tempa_private.is_blocked_pair(auth.uid(), recipient) then
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

    insert into public.moments (
      letter_id,
      position,
      type,
      image_path,
      postcard_key
    )
    select
      new_id,
      (m->>'position')::integer,
      m->>'type',
      m->>'image_path',
      m->>'postcard_key'
    from jsonb_array_elements(p_moments) as m;

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


-- ============================================================
-- 10. PHOTO-CONSENT RPCs — block + account-status enforcement
-- ============================================================
-- request_photo_sharing initiates a NEW media-sharing arrangement —
-- gated the same as "upload/attach new Moments/media" for restricted/
-- suspended/banned, and blocked pairs may never initiate it. Response
-- to an existing request is more nuanced: 'defer'/'photo_free' are
-- de-escalating (declining or postponing new photo sharing) and remain
-- available regardless of status/block; only 'enable' — which actually
-- turns ON new photo capability — is gated the same way as initiating
-- a request.
create or replace function public.request_photo_sharing(
  p_correspondence_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$

declare
  corr public.correspondences;
  other_participant uuid;

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;


  select *
  into corr

  from public.correspondences

  where
    id = p_correspondence_id
    and (participant_low = auth.uid() or participant_high = auth.uid())

  for update;


  if not found then
    raise exception 'Correspondence not found.';
  end if;

  other_participant := case
    when auth.uid() = corr.participant_low then corr.participant_high
    else corr.participant_low
  end;

  -- NEW: block + status gates, same neutral wording as the pre-existing
  -- "cannot be requested right now" branch below.
  if tempa_private.is_blocked_pair(auth.uid(), other_participant) then
    raise exception 'Photo sharing cannot be requested right now.';
  end if;

  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'Photo sharing cannot be requested right now.';
  end if;

  if corr.status <> 'active' then
    raise exception 'This correspondence is not active.';
  end if;


  if corr.photo_consent_status = 'no_request' then

    update public.correspondences

    set
      photo_consent_status = 'pending',
      photo_consent_requested_by = auth.uid(),
      photo_consent_requested_at = now(),
      photo_consent_resolved_by = null,
      photo_consent_resolved_at = null

    where id = p_correspondence_id;

  elsif
    corr.photo_consent_status = 'photo_free'
    and corr.photo_consent_resolved_by = auth.uid()
  then

    update public.correspondences

    set
      photo_consent_status = 'pending',
      photo_consent_requested_by = auth.uid(),
      photo_consent_requested_at = now(),
      photo_consent_resolved_by = null,
      photo_consent_resolved_at = null

    where id = p_correspondence_id;

  else

    raise exception 'Photo sharing cannot be requested right now.';

  end if;

end;
$function$;


create or replace function public.respond_photo_sharing(
  p_correspondence_id uuid,
  p_decision text
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$

declare
  corr public.correspondences;

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if p_decision not in ('enable', 'defer', 'photo_free') then
    raise exception 'Unknown decision.';
  end if;


  select *
  into corr

  from public.correspondences

  where
    id = p_correspondence_id
    and (participant_low = auth.uid() or participant_high = auth.uid())

  for update;


  if not found then
    raise exception 'Correspondence not found.';
  end if;

  -- NEW: only the 'enable' decision (new photo capability turning on)
  -- is gated — declining/deferring remains available regardless of
  -- block or status, since it never creates new shared media.
  if p_decision = 'enable' then
    if tempa_private.is_blocked_pair(
      auth.uid(),
      case when auth.uid() = corr.participant_low then corr.participant_high else corr.participant_low end
    ) then
      raise exception 'There is no photo-sharing request awaiting a response.';
    end if;

    if public.current_account_status() in ('restricted', 'suspended', 'banned') then
      raise exception 'There is no photo-sharing request awaiting a response.';
    end if;
  end if;

  if corr.photo_consent_status not in ('pending', 'deferred') then
    raise exception 'There is no photo-sharing request awaiting a response.';
  end if;

  if corr.photo_consent_requested_by = auth.uid() then
    raise exception 'You cannot respond to your own request.';
  end if;

  if p_decision = 'defer' and corr.photo_consent_status <> 'pending' then
    raise exception 'This request has already been deferred.';
  end if;


  update public.correspondences

  set
    photo_consent_status = case p_decision
      when 'enable' then 'enabled'
      when 'defer' then 'deferred'
      when 'photo_free' then 'photo_free'
    end,
    photo_consent_resolved_by = auth.uid(),
    photo_consent_resolved_at = now()

  where id = p_correspondence_id;

end;
$function$;


-- ============================================================
-- 11. STORAGE VISIBILITY FUNCTIONS — block-aware
-- ============================================================
-- No new signed URL may be issued for a blocked pair's private photo
-- Moments — enforced here, at the exact point every signed-URL request
-- (authenticated path only; the external anon path uses a completely
-- separate, deliberately untouched function) is authorized. An
-- ALREADY-issued signed URL remains valid until its own TTL (10
-- minutes everywhere in this codebase) — this function is not
-- consulted again once a URL has been handed out, so this is a
-- necessary, documented, time-bounded limitation, not something this
-- migration can close further.
create or replace function public.can_view_letter_photo(
  p_path text
)
returns boolean
language sql
security definer
set search_path to 'pg_catalog'
stable
as $$
  select exists (
    select 1
    from public.moments m
    join public.letters l on l.id = m.letter_id
    join public.correspondences c on c.id = l.correspondence_id
    where m.image_path = p_path
      and (c.participant_low = auth.uid() or c.participant_high = auth.uid())
      and (
        l.sender_id = auth.uid()
        or (c.photo_consent_status = 'enabled' and l.deliver_at <= now())
      )
      and not tempa_private.is_blocked_pair(
        auth.uid(),
        case when auth.uid() = c.participant_low then c.participant_high else c.participant_low end
      )
  );
$$;

-- dispatch_photo_is_visible stays SECURITY INVOKER (unchanged from its
-- live definition) — the own-folder branch is completely untouched (an
-- author can always view their own uploaded photo, regardless of any
-- block involving that Dispatch), and the block check is added only to
-- the cross-user "published Dispatch" branch.
create or replace function public.dispatch_photo_is_visible(p_path text)
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
      from public.dispatch_moments dm
      join public.dispatches d on d.id = dm.dispatch_id
      where dm.image_path = p_path
        and d.status = 'published'
        and not tempa_private.is_blocked_pair(auth.uid(), d.author_id)
    )
$$;


-- ============================================================
-- 12. DISPATCH RPCs — account-status enforcement
-- ============================================================
-- Restricted/suspended/banned: no new Dispatch, no editing an existing
-- one's content, no external sharing, no pinning. Confirmed by
-- pre-execution audit against the exact locked product decision: "MAY
-- unpin an existing Dispatch; MAY NOT newly pin a Dispatch; MAY NOT
-- replace the existing pin with another Dispatch." pin_dispatch is the
-- SAME single RPC for both a first-ever pin and replacing an existing
-- one (it unconditionally does `update profiles set
-- pinned_dispatch_id = p_dispatch_id`, with no separate "first pin" vs
-- "re-pin" code path) — gating this one RPC for restricted/suspended/
-- banned therefore correctly blocks BOTH forbidden cases at once, with
-- nothing further needed. unpin_dispatch (a separate function, section
-- 12 below is silent on it — it is simply never touched) correctly
-- remains available in every state, matching "MAY unpin." delete_
-- dispatch and revoke_dispatch_share are likewise explicitly approved
-- to remain available and are NOT modified here.
-- All four bodies below are reproduced verbatim from their live
-- source (docs/sql/2026-09-07-dispatches-and-board.sql for
-- publish_dispatch; docs/sql/2026-09-09-board-usability.sql for
-- update_dispatch, the final share_dispatch, and pin_dispatch — each
-- re-read directly before writing this section, not reconstructed from
-- memory) with exactly one addition each: the account-status check,
-- inserted immediately after the existing `auth.uid() is null` check
-- and before any other validation. publish_dispatch is SECURITY
-- INVOKER in its live form (not DEFINER — corrects an earlier draft of
-- this migration that assumed DEFINER by pattern-matching without
-- checking); current_account_status() is itself SECURITY DEFINER
-- regardless, so it resolves identically either way.
create or replace function public.publish_dispatch(
  p_title text,
  p_body text,
  p_topics text[] default '{}',
  p_moments jsonb default '[]'::jsonb
)
returns public.dispatches
language plpgsql
security invoker
set search_path to 'public'
as $function$

declare
  new_id uuid;
  result public.dispatches;
  topic text;
  normalized_topics text[] := '{}';
  paragraph_count integer;
  m jsonb;

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  -- NEW: the one addition to this function.
  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'This action is not available right now.';
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


  insert into public.dispatches (author_id, title, body)
  values (auth.uid(), p_title, p_body)
  returning id into new_id;


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


  select * into result from public.dispatches where id = new_id;

  return result;

end;
$function$;

revoke all on function public.publish_dispatch(text, text, text[], jsonb) from public;
grant execute on function public.publish_dispatch(text, text, text[], jsonb) to authenticated;


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

  -- NEW: the one addition to this function.
  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'This action is not available right now.';
  end if;

  if not exists (
    select 1 from public.dispatches d
    where d.id = p_dispatch_id
      and d.author_id = auth.uid()
      and d.status = 'published'
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


create or replace function public.share_dispatch(p_dispatch_id uuid)
returns public.dispatch_shares
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  result public.dispatch_shares;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  -- NEW: the one addition to this function.
  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'This action is not available right now.';
  end if;

  if not exists (
    select 1 from public.dispatches d
    where d.id = p_dispatch_id
      and d.status = 'published'
  ) then
    raise exception 'Only a published Dispatch may be shared.';
  end if;

  insert into public.dispatch_shares (dispatch_id)
  values (p_dispatch_id)
  on conflict (dispatch_id) where revoked_at is null do nothing;

  select *
  into result
  from public.dispatch_shares
  where dispatch_id = p_dispatch_id
    and revoked_at is null;

  return result;
end;
$function$;

revoke all on function public.share_dispatch(uuid) from public;
grant execute on function public.share_dispatch(uuid) to authenticated;


create or replace function public.pin_dispatch(p_dispatch_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  -- NEW: the one addition to this function — pinning promotes
  -- visibility the same way publishing does; treated the same as
  -- "publish new" for this checkpoint. Not explicitly enumerated in
  -- the locked CAN/CANNOT list — a judgment call, flagged in the
  -- report's remaining-issues section for confirmation.
  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'This action is not available right now.';
  end if;

  if not exists (
    select 1 from public.dispatches d
    where d.id = p_dispatch_id
      and d.author_id = auth.uid()
      and d.status = 'published'
  ) then
    raise exception 'Only the author of a published Dispatch may pin it.';
  end if;

  update public.profiles set pinned_dispatch_id = p_dispatch_id where id = auth.uid();
end;
$function$;

revoke all on function public.pin_dispatch(uuid) from public;
grant execute on function public.pin_dispatch(uuid) to authenticated;

create or replace function public.publish_question_answer(p_question_id uuid, p_body text)
returns public.question_answers
language plpgsql
set search_path to 'pg_catalog'
as $function$
declare
  result public.question_answers;
  is_canonical boolean;
  has_current boolean;
  should_promote boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  -- NEW: restricted/suspended/banned may not publish/set a new public
  -- answer. This is an account-status check only — publishing your own
  -- answer is never a pairwise action, so no block check applies here.
  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'This action is not available right now.';
  end if;

  select (slug is not null) into is_canonical
  from public.questions
  where id = p_question_id;

  select exists (
    select 1 from public.question_answers
    where user_id = auth.uid() and is_current = true
  ) into has_current;

  should_promote := coalesce(is_canonical, false) and not has_current;

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
-- Adds an explicit search_path (previously unset — a pre-existing,
-- separate hygiene gap, harmless here since every reference in the
-- body is already schema-qualified, but corrected in passing to match
-- this file's own locked-down convention rather than left inconsistent
-- now that the function is being touched anyway).

create or replace function public.set_current_answer(p_answer_id uuid)
returns public.question_answers
language plpgsql
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
  ) then
    raise exception 'Only a completed answer to one of the three canonical Questions can be shown in Minds.';
  end if;

  update public.question_answers
  set is_current = false
  where user_id = auth.uid()
    and id <> p_answer_id;

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
-- 13. STAFF_ROLES — foundation for future moderation, not moderation
-- itself
-- ============================================================
-- No moderation action of any kind is built in this checkpoint —
-- reports/moderation_cases/moderator RPCs are explicitly out of scope
-- (Checkpoint 1C+). This table exists now purely so that work has a
-- non-hard-coded, non-client-controlled authorization foundation to
-- build on, per the checkpoint's own instruction ("later moderation
-- RPCs must not rely on hard-coded emails or client flags"). Two roles
-- only — moderator, admin — no larger RBAC. Nobody currently holds
-- either role; granting the first one is a manual, direct database
-- action outside this migration (matching the Build Guide's own §32
-- sequencing note that direct Supabase table access is a legitimate
-- stand-in at current scale), never a client-reachable self-grant.
create table public.staff_roles (
  user_id uuid primary key
    references auth.users(id)
    on delete cascade,

  role text not null
    check (role in ('moderator', 'admin')),

  granted_by uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now()
);

alter table public.staff_roles enable row level security;

-- A member may confirm their OWN staff status (e.g. to conditionally
-- show a future admin nav item) — never anyone else's.
create policy staff_roles_select_own
  on public.staff_roles
  for select
  to authenticated
  using (auth.uid() = user_id);

-- No insert/update/delete policy for anyone — no ordinary member, and
-- no moderator, can grant or alter a staff role through PostgREST under
-- any circumstance. The only way a row is created is a direct,
-- deliberate database action by whoever operates the project today;
-- a future `grant_staff_role` RPC (admin-only, itself audit-logged) is
-- explicitly deferred to the moderation checkpoint, not built here.
revoke all on public.staff_roles from public, anon, authenticated;
grant select on public.staff_roles to authenticated;

-- Authoritative "is this caller staff" check for any future privileged
-- RPC to call first — SECURITY DEFINER so it resolves identically
-- whether called by a client directly or from inside another definer
-- function; `p_min_role` lets a future admin-only action require the
-- stronger tier without duplicating the role hierarchy at every call
-- site. Lives in `public` (not `tempa_private`) because, unlike
-- is_blocked_pair, this is meant to be directly callable by a client —
-- a future admin UI needs to ask "am I staff" for itself.
create or replace function public.is_staff(p_min_role text default 'moderator')
returns boolean
language sql
security definer
set search_path to 'pg_catalog'
stable
as $$
  select exists (
    select 1 from public.staff_roles sr
    where sr.user_id = auth.uid()
      and (
        p_min_role = 'moderator'
        or (p_min_role = 'admin' and sr.role = 'admin')
      )
  )
$$;

revoke all on function public.is_staff(text) from public;
grant execute on function public.is_staff(text) to authenticated;


-- ============================================================
-- 14. ADMIN_AUDIT_LOG — append-only foundation
-- ============================================================
-- No row is ever written by this checkpoint — there is no privileged
-- action yet to log. The table exists now so it is available, already
-- reviewed and correct, the moment the first real moderation RPC is
-- built; that RPC will INSERT into this table itself, inside its own
-- transaction, as the defining property of "an action and its audit
-- record can never be split into two separate client-controllable
-- calls." Nullable actor_id + a captured text snapshot means a staff
-- account being deleted later never breaks historical legibility and
-- is never blocked by its own audit trail.
create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),

  actor_id uuid references auth.users(id) on delete set null,
  actor_identifier_snapshot text not null,

  action text not null,

  target_type text not null,
  target_id uuid,
  target_identifier_snapshot text,

  reason text,
  metadata jsonb,

  created_at timestamptz not null default now()
);

alter table public.admin_audit_log enable row level security;

-- No policy of any kind, for any role — not even staff can SELECT this
-- through PostgREST. Reading it back is a future, separate, staff-only
-- RPC (deferred to the moderation checkpoint); writing it happens only
-- as a side effect inside a future privileged RPC's own body, which
-- runs as the function owner and therefore needs no SELECT/INSERT
-- policy of its own to succeed.
revoke all on public.admin_audit_log from public, anon, authenticated;
-- No grant of any kind, to any client-facing role — deliberate, not an
-- oversight. A future privileged RPC's own SECURITY DEFINER context
-- bypasses this table's RLS as the function owner, so it needs no
-- table-level grant at all to insert into it.

commit;
