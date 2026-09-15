-- ============================================================
-- TEMPA — BOARD EXPERIENCE, PHASE 2C: WORTH READING
-- PREPARED — NOT EXECUTED. Review, then run in the Supabase SQL editor.
-- ============================================================
--
-- Worth Reading — a PRIVATE per-Dispatch quality signal, the same
-- shape as Keep in Mind (docs/sql/2026-09-07-dispatches-and-board.sql
-- section 8, RPC-gated by docs/sql/2026-09-11-safety-blocking-
-- foundation.sql section 8): one member may mark ONE published
-- Dispatch worth reading, may undo it, and nobody else — not the
-- Dispatch's author, not any other member — can ever see who marked
-- it or how many people did. Two pieces, in dependency order:
--
--   1. DISPATCH_WORTH_READING — the table, RLS (SELECT own rows only,
--      no direct write grant of any kind — mutation is RPC-only from
--      day one, the hardened posture kept_minds had to be retrofitted
--      to and dispatch_replies already launched with — see that
--      table's own history, docs/sql/2026-09-11-safety-blocking-
--      foundation.sql section 8, and docs/sql/2026-09-23-dispatch-
--      replies.sql piece 1).
--
--   2. SET_DISPATCH_WORTH_READING — the sole write path, both
--      directions. Marking true reproduces create_reply's own
--      eligibility shape (auth, account-status write gate, Dispatch
--      currently published + moderator-visible, full-block check,
--      author public-visibility check) plus one Worth-Reading-specific
--      rule: a member cannot mark their own Dispatch. Unmarking
--      (false) is a plain, always-available delete of the caller's own
--      row — de-escalating, so it is never gated on block/account
--      status/Dispatch state, matching unkeep_mind's own precedent.
--
-- tempa_private.is_blocked_pair (full-scope block only) is the ONLY
-- blocking helper referenced below — never is_correspondence_
-- blocked_pair. Stop letters (a 'letters'-scope block) has zero effect
-- here, the same rule already locked for Dispatches and Replies.
--
-- NO public count, NO voter list, NO author notification, NO ranking
-- change, NO likes/hearts/votes/reactions of any kind — Worth Reading
-- is a private signal only the marking member can ever see or query
-- (their own SELECT of their own row via dispatch_worth_reading_own),
-- and this migration adds nothing that exposes it any other way.
--
-- FINAL SECURITY/HARDENING PATCH (2026-09-24 follow-up): four
-- corrections, no redesign.
--   A. set_dispatch_worth_reading now explicitly rejects a NULL
--      p_worth_reading argument right after the auth check — `if null
--      = false then` never enters the false branch (NULL is neither
--      true nor false in SQL's three-valued logic), so an unguarded
--      NULL would previously have fallen all the way through to the
--      true-branch's INSERT regardless of the caller's actual intent.
--   B. The false (undo) branch's own precedence — before every
--      account-status/blocking/Dispatch-eligibility gate — is
--      unchanged; only re-verified as part of this pass.
--   C. The true branch now takes FOR SHARE on the target Dispatch row
--      at the moment it is read, for the same reason and with the same
--      lock-ordering guarantee already established for create_reply
--      (docs/sql/2026-09-23-dispatch-replies.sql piece 3): without it,
--      a concurrent unpublish/hide/delete could invalidate this
--      function's own eligibility check between validation and its
--      INSERT. FOR SHARE never conflicts with another concurrent FOR
--      SHARE (so concurrent marks on the same Dispatch never block each
--      other), but does conflict with the FOR NO KEY UPDATE a plain
--      UPDATE takes and the FOR UPDATE delete_dispatch's own ownership
--      check takes — both correctly block until this transaction ends.
--      Both functions only ever contend for this one shared resource,
--      never a second one in reversed order, so this stays deadlock-
--      free by the same reasoning already given for create_reply/
--      delete_dispatch.
--   D. Every REVOKE below now names PUBLIC, anon, AND authenticated
--      explicitly, rather than relying on authenticated's inheritance
--      from PUBLIC — independent-audit correction, the same explicit-
--      hardening posture block_user's own two-signature grant section
--      already established (docs/sql/2026-09-12-scoped-blocking-and-
--      fixes.sql).
--
--   Separately (piece 3 below): block_user's existing FULL-block-only
--   Keep-cascade branch now also clears any dispatch_worth_reading rows
--   between the two members, in BOTH directions — a full block must
--   retroactively undo a private mark exactly the way it already
--   retroactively undoes Keep. A letters-only (Stop letters) block
--   still clears neither, and must never be extended to. Reproduced via
--   CREATE OR REPLACE in this migration (this repo's established way to
--   evolve an existing function — see piece 2/3's own reproductions in
--   docs/sql/2026-09-23-dispatch-replies.sql) rather than editing the
--   historical 2026-09-12 file in place.
--
-- FINAL CONCURRENCY FIX (2026-09-24 follow-up): closes the one
-- remaining race, between set_dispatch_worth_reading(true) and a
-- concurrent block_user(..., 'full') — without a shared lock, both
-- transactions could read a "clean" state, pass their own checks, and
-- commit in either order, leaving a mark that survived a full block
-- that should have cleared it. Both functions now take a SHARE (this
-- function) or UPDATE (block_user, since it is about to WRITE) lock on
-- the SAME PAIR of public.profiles rows — the acting member and the
-- other party — in one GLOBAL, deterministic order: ascending uuid,
-- never "caller first." This is the standard total-order lock-
-- ordering technique: as long as EVERY transaction that might contend
-- for an overlapping pair of these rows always acquires the smaller-
-- uuid row before the larger one, no cycle can ever form, regardless of
-- which specific pair each transaction needs — proven independently of,
-- and layered on top of, the existing Dispatch-row FOR SHARE lock
-- (piece 2's own correction C), which neither function's profiles-pair
-- lock interacts with (block_user never touches a Dispatch row's lock
-- at all). Either interleaving now resolves correctly: if the mark
-- reaches the pair lock first, the full block waits, then cleans up the
-- now-committed mark; if the full block reaches it first, the mark
-- waits, then observes is_blocked_pair = true once it proceeds, and is
-- rejected. The pair lock itself runs for EITHER scope alike (it is
-- taken once, after scope/self/member validation, before the
-- blocked_users write, regardless of whether p_scope is 'letters' or
-- 'full') — only the Worth Reading cleanup further below it stays
-- gated to `if p_scope = 'full'`, exactly as piece 3 already
-- established; Stop-letters semantics are otherwise completely
-- unchanged.
-- ============================================================

begin;

-- ============================================================
-- 1. DISPATCH_WORTH_READING
-- ============================================================
-- user_id marks dispatch_id worth reading. RLS scopes every row to
-- auth.uid() = user_id — a Dispatch's author (or anyone else) has no
-- policy that would ever let them query who marked their Dispatch
-- worth reading, or how many did, by construction — same shape as
-- kept_minds_own.
create table public.dispatch_worth_reading (
  dispatch_id uuid not null
    references public.dispatches(id)
    on delete cascade,

  user_id uuid not null
    references auth.users(id)
    on delete cascade,

  created_at timestamptz not null default now(),

  primary key (dispatch_id, user_id)
);

alter table public.dispatch_worth_reading enable row level security;

create policy dispatch_worth_reading_own
  on public.dispatch_worth_reading
  for select
  to authenticated
  using (auth.uid() = user_id);

-- SELECT-only, and only the caller's own rows (enforced twice over —
-- the policy above, and this grant not extending to insert/update/
-- delete at all). Every mutation is RPC-only from day one
-- (set_dispatch_worth_reading below) — never retrofitted the way
-- kept_minds' original direct insert/delete grant had to be
-- (docs/sql/2026-09-11-safety-blocking-foundation.sql section 8).
-- FINAL SECURITY/HARDENING PATCH: PUBLIC, anon, AND authenticated named
-- explicitly here — do not rely on authenticated's inheritance from
-- PUBLIC (independent-audit correction D, same posture as block_user's
-- own two-signature grant section).
revoke all on public.dispatch_worth_reading from public, anon, authenticated;
grant select on public.dispatch_worth_reading to authenticated;


-- ============================================================
-- 2. SET_DISPATCH_WORTH_READING — the sole write path, both directions
-- ============================================================
-- p_worth_reading = true: mark; false: undo. One RPC for both
-- directions (rather than two separate functions, e.g. keep_mind/
-- unkeep_mind) because the true-branch's eligibility checks and the
-- false-branch's plain delete share nothing worth splitting apart, and
-- the UI's own single quiet toggle control maps naturally onto one
-- boolean argument.
create or replace function public.set_dispatch_worth_reading(
  p_dispatch_id uuid,
  p_worth_reading boolean
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_dispatch record;
begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  -- FINAL SECURITY/HARDENING PATCH, correction A: NULL is rejected
  -- explicitly and separately from the false-branch check below —
  -- `if null = false then` evaluates to NULL, not true, in SQL's
  -- three-valued logic, so it would silently NOT enter that branch and
  -- fall all the way through to the true branch's own INSERT instead,
  -- treating an ambiguous/missing client value as an implicit mark.
  -- Same pattern already established by block_user's own p_scope NULL
  -- check (docs/sql/2026-09-12-scoped-blocking-and-fixes.sql).
  if p_worth_reading is null then
    raise exception 'Worth Reading state is required.';
  end if;

  if p_worth_reading = false then
    -- De-escalating — always available regardless of block state,
    -- account status, or the Dispatch's current state, the same
    -- reasoning unkeep_mind's own comment gives: undoing your own
    -- private mark must never be blocked by anything that has happened
    -- since you made it. Idempotent: deleting an already-absent row is
    -- a silent no-op, never an error.
    delete from public.dispatch_worth_reading
    where dispatch_id = p_dispatch_id
      and user_id = auth.uid();
    return;
  end if;

  -- Matches every other write RPC's own account-status gate exactly
  -- (create_reply, keep_mind, publish_dispatch) — restricted/
  -- suspended/banned may not create this new private mark.
  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'This action is not available right now.';
  end if;

  -- FINAL SECURITY/HARDENING PATCH, correction C: FOR SHARE locks this
  -- Dispatch row for the remainder of the transaction — the same lock
  -- mode, and the same lock-ordering/deadlock reasoning, already
  -- established for create_reply's own Dispatch read (docs/sql/2026-09-
  -- 23-dispatch-replies.sql piece 3). Without it, a concurrent
  -- unpublish/hide (or delete_dispatch, once eligible) could invalidate
  -- the eligibility checks below between this read and this function's
  -- own INSERT. Both this function and delete_dispatch only ever lock
  -- this one shared Dispatch-row resource, never a second one in
  -- reversed order, so this stays deadlock-free.
  select id, author_id, status, moderation_status
  into v_dispatch
  from public.dispatches
  where id = p_dispatch_id
  for share;

  if v_dispatch.id is null then
    raise exception 'Dispatch not found.';
  end if;

  -- LOCKED RULE, no exception for anyone: a Dispatch may only be
  -- marked worth reading while it is CURRENTLY status = 'published'
  -- AND moderation_status = 'visible' — the same create-eligibility
  -- shape create_reply enforces for new Replies.
  if v_dispatch.status <> 'published' or v_dispatch.moderation_status <> 'visible' then
    raise exception 'This Dispatch is not available right now.';
  end if;

  -- Product rule: a member cannot mark their own Dispatch worth
  -- reading.
  if v_dispatch.author_id = auth.uid() then
    raise exception 'You cannot mark your own Dispatch worth reading.';
  end if;

  -- FINAL CONCURRENCY FIX: pair-lock the caller's and the Dispatch
  -- author's public.profiles rows, SHARE mode, in ascending-uuid order
  -- — see this migration's own header comment for the full deadlock-
  -- freedom reasoning this shares with block_user's matching lock
  -- below. auth.uid() <> v_dispatch.author_id is already guaranteed by
  -- the own-Dispatch rejection immediately above, so this never
  -- attempts to lock the same row twice. Placed AFTER v_dispatch is
  -- loaded and its author is known, and BEFORE the block/public-
  -- visibility eligibility checks that follow, so a concurrent full
  -- block can never slip between this function's own read of
  -- is_blocked_pair and its INSERT.
  if auth.uid() < v_dispatch.author_id then
    perform 1 from public.profiles where id = auth.uid() for share;
    perform 1 from public.profiles where id = v_dispatch.author_id for share;
  else
    perform 1 from public.profiles where id = v_dispatch.author_id for share;
    perform 1 from public.profiles where id = auth.uid() for share;
  end if;

  -- Full-scope block, either direction — the same helper create_reply
  -- and dispatches_select_published themselves use. NEVER is_
  -- correspondence_blocked_pair: Stop letters must have zero effect
  -- here, the same rule already locked for Dispatches and Replies.
  if tempa_private.is_blocked_pair(auth.uid(), v_dispatch.author_id) then
    raise exception 'This action is not available right now.';
  end if;

  -- Being SECURITY DEFINER (RLS does not apply to its own body), this
  -- explicitly reproduces the author public-visibility check ordinary
  -- read-time RLS would otherwise supply — a suspended/banned author's
  -- Dispatch is not a legitimate target regardless of that row's own
  -- moderation_status.
  if not tempa_private.author_content_publicly_visible(v_dispatch.author_id) then
    raise exception 'This action is not available right now.';
  end if;

  insert into public.dispatch_worth_reading (dispatch_id, user_id)
  values (p_dispatch_id, auth.uid())
  on conflict (dispatch_id, user_id) do nothing;

end;
$function$;

-- FINAL SECURITY/HARDENING PATCH, correction D: PUBLIC, anon, AND
-- authenticated named explicitly — same reasoning as the table grant
-- above.
revoke all on function public.set_dispatch_worth_reading(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_dispatch_worth_reading(uuid, boolean) to authenticated;


-- ============================================================
-- 3. BLOCK_USER — FULL-block cleanup extended to Worth Reading
-- ============================================================
-- FINAL SECURITY/HARDENING PATCH: a full block must retroactively
-- clear Worth Reading between the two members, in BOTH directions,
-- exactly like it already clears Keep in Mind — leaving a mark in
-- place after a full block would let a private signal outlive the
-- relationship the block just severed. A letters-only (Stop letters)
-- block must NOT clear it, the same product rule already locked for
-- every other Worth Reading behavior in this migration.
--
-- Reproduced in full via CREATE OR REPLACE from its current
-- authoritative definition (docs/sql/2026-09-12-scoped-blocking-and-
-- fixes.sql:188-248 — verified as the live definition: it is the
-- LATER of the two files that redefine block_user, per that file's own
-- checkpoint number and its "Legacy compatibility wrapper" comment
-- describing the two-argument version as the new canonical
-- implementation the one-argument overload now delegates to; no later
-- migration redefines it, confirmed by a repo-wide search for `create
-- or replace function public.block_user`) with exactly ONE addition:
-- the new dispatch_worth_reading DELETE, placed immediately alongside
-- the existing kept_minds DELETE inside the same `if p_scope = 'full'
-- then` branch, using the identical both-directions predicate shape.
-- Every other line — auth, NULL/allow-list scope validation, self-
-- block rejection, member-existence check, the upsert itself — is
-- byte-for-byte unchanged. The one-argument legacy wrapper
-- (block_user(uuid), which merely calls this two-argument version with
-- 'full') is NOT reproduced here — it needs no change, and delegates to
-- this updated definition automatically once this CREATE OR REPLACE
-- runs, since Postgres resolves that call by signature, not by a frozen
-- copy of this function's old body. Reproducing it anyway would only
-- add unrelated risk for no behavioral benefit.
create or replace function public.block_user(p_blocked_id uuid, p_scope text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  -- NULL is rejected explicitly and separately from the allow-list
  -- check below — `null not in ('letters', 'full')` evaluates to NULL,
  -- not true, which would silently fall through the IF without raising
  -- anything. A caller must pass one of the two real scopes.
  if p_scope is null then
    raise exception 'Unknown block scope.';
  end if;

  if p_scope not in ('letters', 'full') then
    raise exception 'Unknown block scope.';
  end if;

  if auth.uid() = p_blocked_id then
    raise exception 'You cannot block yourself.';
  end if;

  if not exists (select 1 from public.profiles where id = p_blocked_id) then
    raise exception 'Member not found.';
  end if;

  -- FINAL CONCURRENCY FIX: pair-lock the caller's and p_blocked_id's
  -- public.profiles rows, UPDATE mode (this function is about to WRITE
  -- blocked_users — the same "lock mode matches what you are about to
  -- do" reasoning already established for delete_dispatch's own FOR
  -- UPDATE, docs/sql/2026-09-23-dispatch-replies.sql), in the SAME
  -- ascending-uuid order as set_dispatch_worth_reading's matching SHARE
  -- lock above — see this migration's own header comment for the full
  -- deadlock-freedom reasoning. auth.uid() <> p_blocked_id is already
  -- guaranteed by the self-block rejection above. Taken for EITHER
  -- scope, before the blocked_users write, so a concurrent Worth
  -- Reading mark can never land between this function's own upsert and
  -- its Worth Reading cleanup further below.
  if auth.uid() < p_blocked_id then
    perform 1 from public.profiles where id = auth.uid() for update;
    perform 1 from public.profiles where id = p_blocked_id for update;
  else
    perform 1 from public.profiles where id = p_blocked_id for update;
    perform 1 from public.profiles where id = auth.uid() for update;
  end if;

  -- Directional storage, idempotent via ON CONFLICT ... DO UPDATE SET
  -- scope = excluded.scope — calling this again for an already-blocked
  -- pair simply sets scope to whatever was just requested (upgrade
  -- letters -> full, or downgrade full -> letters, both explicitly
  -- supported per the product decision: "A caller should be able to
  -- upgrade a letters-only block to full. If full is later changed back
  -- to letters-only, removed Keep rows are NOT silently restored.").
  insert into public.blocked_users (blocker_id, blocked_id, scope)
  values (auth.uid(), p_blocked_id, p_scope)
  on conflict (blocker_id, blocked_id) do update
    set scope = excluded.scope;

  if p_scope = 'full' then
    -- Keep cascade — approved: a FULL block removes Keep in BOTH
    -- directions, atomically, in the same transaction, whether this is
    -- a fresh full block or an upgrade from letters. Direct table
    -- access (not through keep_mind/unkeep_mind) is correct and
    -- necessary here: SECURITY DEFINER lets this reach the row where
    -- the caller is merely kept_user_id (the other side's Keep of
    -- them), which their own RLS would never permit them to touch
    -- directly. A fresh or resulting 'letters' scope (including a
    -- downgrade from 'full') never enters this branch, so it never
    -- touches kept_minds and never restores a row a prior full block
    -- already deleted.
    delete from public.kept_minds
    where (viewer_user_id = auth.uid() and kept_user_id = p_blocked_id)
       or (viewer_user_id = p_blocked_id and kept_user_id = auth.uid());

    -- FINAL SECURITY/HARDENING PATCH (Board Phase 2C, 2026-09-24
    -- follow-up): Worth Reading cascade, same shape and same reasoning
    -- as the Keep cascade immediately above — a full block clears any
    -- private mark between the two members in BOTH directions (the
    -- blocker's mark on the blocked member's Dispatch, and the blocked
    -- member's mark on the blocker's Dispatch), atomically, in the same
    -- transaction, whether this is a fresh full block or an upgrade
    -- from letters. Direct table access is likewise necessary here:
    -- SECURITY DEFINER lets this reach a row where the caller is only
    -- dispatch_worth_reading.user_id via the OTHER member's Dispatch,
    -- which dispatch_worth_reading_own's RLS would never let them touch
    -- directly by dispatch_id alone. A fresh or resulting 'letters'
    -- scope never enters this branch, so it never touches Worth Reading
    -- and never restores a mark a prior full block already deleted.
    delete from public.dispatch_worth_reading
    where (
      user_id = auth.uid()
      and dispatch_id in (select id from public.dispatches where author_id = p_blocked_id)
    ) or (
      user_id = p_blocked_id
      and dispatch_id in (select id from public.dispatches where author_id = auth.uid())
    );
  end if;
end;
$function$;

-- CREATE OR REPLACE preserves this function's existing ACL — Postgres
-- does not reset permissions when a function's body is replaced in
-- place, only when it is dropped and recreated (same note already
-- established elsewhere in this codebase, e.g. docs/sql/2026-09-11-
-- safety-blocking-foundation.sql's own comment on this exact point).
-- Reissued explicitly anyway, matching correction D's posture and
-- block_user's own existing explicit-hardening precedent
-- (docs/sql/2026-09-12-scoped-blocking-and-fixes.sql) — never left to
-- rely on an inherited/prior grant.
revoke all on function public.block_user(uuid, text) from public, anon, authenticated;
grant execute on function public.block_user(uuid, text) to authenticated;

commit;
