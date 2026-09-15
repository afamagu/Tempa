-- ============================================================
-- TEMPA — BOARD EXPERIENCE, PHASE 2B: DISPATCH REPLIES
-- PREPARED — NOT EXECUTED. Review, then run in the Supabase SQL editor.
-- ============================================================
--
-- Adds "Replies" — a member can respond to a Dispatch, or to another
-- Reply — with exactly one visual nesting level, no likes/reactions/
-- votes/public score, and the exact same safety model already proven
-- for Dispatches. Seven pieces, in dependency order:
--
--   1. DISPATCH_REPLIES — the table, its CHECK constraints, indexes,
--      RLS, and grants (SELECT-only; every mutation is RPC-only, the
--      same hardened posture kept_minds was retrofitted to — see that
--      table's own history, docs/sql/2026-09-11-safety-blocking-
--      foundation.sql section 8). The RLS policy's parent-Dispatch gate
--      requires the Dispatch to be CURRENTLY published, moderator-
--      visible, not full-blocked, and its author publicly visible — with
--      NO own-author bypass on that gate (see the policy's own comment).
--
--   2. DELETE_DISPATCH — reproduced in full (docs/sql/2026-09-10-admin-
--      moderation-and-questions.sql:1017-1046) with ONE new guard added
--      by this migration's own PRE-SQL CORRECTION PASS: a Dispatch with
--      one or more Reply rows — its own author's or another member's —
--      can no longer be hard-deleted. Existing behavior for a Dispatch
--      with zero Replies is completely unchanged. See piece 1's own
--      dispatch_id column comment and piece 2's own comment for the
--      full reasoning. FINAL CONCURRENCY CORRECTION: the ownership check
--      now takes FOR UPDATE on the Dispatch row before the Reply-
--      existence check runs, closing a race against concurrent
--      create_reply calls (see both functions' own comments for the
--      lock-ordering/deadlock reasoning).
--
--   3. CREATE_REPLY — the sole write path for new Replies. Derives
--      auth.uid(), reply_to_user_id, and root_reply_id entirely
--      server-side; never trusts a client-supplied value for any of
--      them. A Reply may only ever target a Dispatch that is CURRENTLY
--      status = 'published' AND moderation_status = 'visible' — there
--      is NO exception for the Dispatch's own author (an author cannot
--      reply to their own draft or moderator-hidden Dispatch either;
--      see the check's own comment below). Being SECURITY DEFINER (RLS
--      does not apply to its own body), it also explicitly checks
--      author_content_publicly_visible for BOTH the Dispatch's author
--      and, when replying to a Reply, that Reply's own author — a
--      suspended/banned author's content is not a legitimate target
--      regardless of that row's own moderation_status. FINAL CONCURRENCY
--      CORRECTION: both the Dispatch row and (when nested) the parent
--      Reply row are locked FOR SHARE for the remainder of the
--      transaction at the moment they are read, so neither can be
--      unpublished/hidden/tombstoned/deleted by a concurrent transaction
--      between this function's eligibility validation and its own
--      INSERT.
--
--   4. DELETE_REPLY — a member's own tombstone/soft-removal of their
--      own Reply. Never a hard DELETE (would either destroy or orphan
--      other members' replies-to-replies) — clears the stored body and
--      marks deleted_at, leaving the row itself, its id, its
--      parent_reply_id/root_reply_id/reply_to_user_id, and its
--      created_at fully intact so descendants keep resolving correctly.
--
--   5. ADMIN_HIDE_REPLY / ADMIN_RESTORE_REPLY — a direct copy of
--      admin_hide_dispatch/admin_restore_dispatch's own authorization,
--      idempotency, and audit-log pattern (docs/sql/2026-09-10-admin-
--      moderation-and-questions.sql:1224-1365). Moderator hiding is
--      kept completely separate from member deletion (piece 4) — a
--      hidden Reply's body is never cleared, so restoring it is a
--      plain flip back, exactly like restoring a hidden Dispatch.
--
--   6. REPORTS EXTENSION — widens reports.target_type to add 'reply'
--      and adds one new elsif branch to report_content, the same
--      three-part change 'question_answer' was added by by
--      (docs/sql/2026-09-10-admin-moderation-and-questions.sql). Also
--      SECURITY DEFINER, so its reply branch's own WHERE clause
--      reproduces the FULL dispatch_replies_select_published boundary —
--      the Reply's own visibility AND its parent Dispatch's own public-
--      visibility gate — never merely the Reply's own moderation_status.
--      Deliberately not filtered on deleted_at: a member-deleted Reply
--      stays reportable.
--
--   7. tempa_private.is_blocked_pair (full-scope block only) is the
--      ONLY blocking helper referenced anywhere below. tempa_private.
--      is_correspondence_blocked_pair is never referenced — Stop
--      letters stays correspondence-only and has no effect on Board/
--      Reply interaction, exactly as already established for
--      Dispatches themselves.
--
-- NO likes/hearts/reactions/votes/public score of any kind. NO Reply
-- count exposed on Board feed cards or anywhere else. NO notification
-- table, event table, or push/email trigger — Phase 2B plugs into
-- nothing, because nothing reusable exists yet (Phase 2B's own
-- read-only audit confirmed this exhaustively); a future Notification
-- Architecture checkpoint is the right place for "someone replied."
-- NO edit capability, NO updated_at column — a member removes and
-- reposts instead. NO change to Phase 2A's Board feed/ranking
-- (board_feed_page, the session model, tiering) — Replies are scoped
-- entirely to the single-Dispatch reader. NO Dispatch soft-deletion/
-- tombstone architecture — piece 2 below is a narrow guard on the
-- EXISTING hard-delete RPC, not a new deletion model.
-- ============================================================

begin;

-- ============================================================
-- 1. DISPATCH_REPLIES
-- ============================================================
-- Column-by-column reasoning:
--
--   id, dispatch_id, author_id, body, created_at — the obvious
--   minimum, shaped exactly like every other TEMPA content table.
--
--   parent_reply_id — the TRUE immediate Reply being answered (not a
--   flattened root reference) — this is what lets @Pseudonym display
--   the actual person being addressed, not merely "somewhere in this
--   thread."
--
--   root_reply_id — the top-level Reply this one is visually grouped
--   under. NOT in the checkpoint's own bare minimum list, but genuinely
--   required, not speculative: without it, rendering "one visual
--   indentation level, no Reddit staircase" would need a recursive walk
--   up parent_reply_id on every single page view. Computed ONCE at
--   INSERT time with zero recursion (create_reply below: a top-level
--   reply's root is null; a nested reply's root is its own parent's
--   root if the parent already has one, else the parent's own id — a
--   single-hop lookup, since the parent's root was already resolved the
--   same way when the parent itself was created).
--
--   reply_to_user_id — the author_id of the TRUE parent Reply, derived
--   server-side by create_reply, NEVER trusted from the client. This is
--   the field the product decision specifically added beyond the
--   checkpoint's own audit: without it, a later-tombstoned or
--   moderator-hidden parent Reply would leave a surviving child with no
--   way to say who it was answering (parent_reply_id still resolves the
--   ROW, but that row's body/author display may no longer be
--   presentable). reply_to_user_id survives independently of whatever
--   later happens to the parent Reply's own content.
--
--   moderation_status, moderated_at — byte-for-byte the same pattern as
--   dispatches' own moderation_status/moderated_at (docs/sql/2026-09-
--   10-admin-moderation-and-questions.sql) — staff-only, reversible,
--   never touches body.
--
--   deleted_at — member-initiated soft-removal (piece 4). Deliberately
--   NOT overloaded onto moderation_status — a member deleting their own
--   Reply and a moderator hiding someone else's Reply are different
--   actions with different reversibility (member deletion clears body
--   and is permanent; moderator hiding preserves body and is
--   reversible), so they need to stay two separate, independently
--   truthful columns.
--
--   Deliberately NOT added: updated_at (no precedent anywhere in this
--   schema for ANY table, including dispatches, which supports editing
--   without one; Phase 2B has no Reply editing at all). A separate
--   `status` column (dispatches don't need one beyond moderation_status
--   since content is always instantly "published" at creation — Replies
--   are the same). A denormalized pseudonym snapshot on this table (no
--   precedent anywhere — every surface in this codebase resolves
--   identity via a live join to public_profiles; the *report* system
--   already owns the separate "freeze evidence at report time" concern
--   via reports.evidence_snapshot, which is the correct place for it).
create table public.dispatch_replies (
  id uuid primary key default gen_random_uuid(),

  -- PRE-SQL CORRECTION (independent review, 2026-09-23 follow-up):
  -- deliberately NOT on delete cascade. A Dispatch's other existing
  -- child tables (dispatch_topics, dispatch_moments, dispatch_views,
  -- dispatch_shares) are all safe to cascade-delete because every row
  -- in them is owned by the Dispatch's OWN author. A Reply breaks that
  -- assumption — it is authored by WHOEVER wrote it, routinely someone
  -- other than the Dispatch's author. An on-delete-cascade FK here would
  -- let a Dispatch's author silently destroy other members' writing
  -- merely by deleting their own Dispatch, which is exactly what this
  -- checkpoint's own product rule forbids ("never destroy or detach
  -- somebody else's Reply"). No ON DELETE clause at all means Postgres
  -- defaults to NO ACTION: a raw DELETE against a Dispatch that still
  -- has Reply rows is refused by the database itself. This is a
  -- defense-in-depth backstop only — delete_dispatch (piece 2 below) is
  -- the actual, friendlier interface: it checks for this condition
  -- first and raises one clear, deliberate exception rather than ever
  -- letting a raw FK-violation error reach this constraint at all.
  dispatch_id uuid not null
    references public.dispatches(id),

  author_id uuid not null
    references auth.users(id)
    on delete cascade,

  body text not null,

  -- ON DELETE SET NULL, not the bare no-action/restrict default and
  -- NEVER cascade, on all three of the following. Reasoning worked out
  -- explicitly rather than guessed: this table has no member-facing
  -- hard-delete path today (piece 4 is a soft tombstone, never a real
  -- DELETE), so in ordinary operation none of these three ON DELETE
  -- clauses ever fires. They matter for a hypothetical FUTURE account-
  -- deletion feature (none exists in this codebase yet, confirmed by
  -- the Phase 1 architecture audit) cascading through author_id ON
  -- DELETE CASCADE above: deleting a member's account would hard-DELETE
  -- their own Reply rows, and if some OTHER member's Reply pointed at
  -- one of those rows via parent_reply_id/root_reply_id with the bare
  -- NO ACTION default, that would BLOCK the entire account deletion
  -- outright — clearly wrong, since a member must always be able to
  -- delete their own account regardless of who replied to them. CASCADE
  -- is equally wrong the other direction (would destroy a SURVIVING
  -- member's own Reply merely because the person they answered deleted
  -- their account — destroying other people's writing is exactly what
  -- this checkpoint's product decisions forbid). SET NULL is the
  -- correct third option: the surviving Reply's OWN content is
  -- untouched, only the now-dangling reference is cleared. A
  -- consequence, disclosed here rather than hidden: in that specific,
  -- currently-unreachable scenario, a surviving child Reply could end
  -- up with parent_reply_id/root_reply_id null while still being a
  -- "nested-looking" Reply in spirit — an acceptable, honestly-disclosed
  -- edge case of a feature (account deletion) that does not exist yet,
  -- not a defect being papered over.
  parent_reply_id uuid
    references public.dispatch_replies(id)
    on delete set null,

  root_reply_id uuid
    references public.dispatch_replies(id)
    on delete set null,

  reply_to_user_id uuid
    references auth.users(id)
    on delete set null,

  moderation_status text not null default 'visible'
    check (moderation_status in ('visible', 'hidden')),
  moderated_at timestamptz,

  deleted_at timestamptz,

  created_at timestamptz not null default now(),

  -- Self-reference guard. Cycles longer than one hop (A -> B -> A) are
  -- prevented STRUCTURALLY, not by a recursive CHECK (PostgreSQL CHECK
  -- constraints cannot reference other rows, and the checkpoint's own
  -- instruction is explicit: do not attempt an impossible cross-row
  -- CHECK here): parent_reply_id is set exactly once, at INSERT, by
  -- create_reply below, and no RPC in this migration ever updates it
  -- afterward — a row can only ever reference an ALREADY-existing
  -- parent, and nothing ever rewrites an existing row's own parent
  -- later, so a cycle can never be constructed regardless of insertion
  -- order.
  constraint dispatch_replies_no_self_parent
    check (parent_reply_id is distinct from id),

  -- Deletion-compatible body semantics: while active (deleted_at is
  -- null), body must be real writing, 1..500 characters after
  -- trimming — the 500 figure matches this codebase's own existing
  -- precedent for exactly this size/shape of short free-text field
  -- (lib/reports.ts's REPORT_CONTEXT_MAX_LENGTH). Once member-deleted
  -- (deleted_at is not null), delete_reply (piece 4) clears body to the
  -- empty string as part of the same update — this constraint is what
  -- makes that the ONLY value a deleted row's body may ever hold,
  -- rather than merely a convention delete_reply could later drift
  -- from.
  constraint dispatch_replies_body_length
    check (
      (deleted_at is null and char_length(trim(body)) between 1 and 500)
      or (deleted_at is not null and body = '')
    )
);

-- Deliberately NOT a single combined "all three null together, or all
-- three non-null together" coherence CHECK across parent_reply_id/
-- root_reply_id/reply_to_user_id, even though create_reply below always
-- sets them coherently at INSERT time. The ON DELETE SET NULL clauses
-- above can, in the same currently-unreachable account-deletion
-- scenario described there, null out parent_reply_id/root_reply_id
-- without also nulling reply_to_user_id (each FK's SET NULL fires
-- independently, keyed to its OWN referenced row being deleted, not
-- synchronized with the other two) — a real, honest case the checkpoint
-- itself anticipated: "do not create impossible cross-row CHECK
-- constraints; enforce those inside the RPC where PostgreSQL CHECK
-- cannot safely verify them." create_reply is where that coherence is
-- actually guaranteed for every row this migration's own RPCs ever
-- produce.

-- Indexes — Postgres does not auto-index foreign-key columns, only the
-- referenced primary-key side, so each FK here gets an explicit index:
-- (dispatch_id, created_at) for the one real read pattern (fetch a
-- Dispatch's Replies, chronological), and single-column indexes for FK
-- lookup/join hygiene and the root_reply_id grouping the read query
-- relies on.
create index dispatch_replies_dispatch_id_created_at_idx
  on public.dispatch_replies (dispatch_id, created_at);
create index dispatch_replies_parent_reply_id_idx
  on public.dispatch_replies (parent_reply_id);
create index dispatch_replies_root_reply_id_idx
  on public.dispatch_replies (root_reply_id);
create index dispatch_replies_author_id_idx
  on public.dispatch_replies (author_id);
create index dispatch_replies_reply_to_user_id_idx
  on public.dispatch_replies (reply_to_user_id);

alter table public.dispatch_replies enable row level security;

-- PRE-SQL CORRECTION (final security review, 2026-09-23 follow-up):
-- does NOT reuse dispatches_select_published's own predicate or rely on
-- inheriting it — that policy's "or author_id = auth.uid()" is
-- deliberately broader than what a Reply's PARENT gate is allowed to
-- be: it lets a Dispatch's author see their OWN draft/hidden Dispatch,
-- which is correct for the Dispatch row itself, but must NOT also mean
-- Replies attached to that Dispatch stay part of the public Reply
-- surface. A Reply's parent Dispatch must be CURRENTLY, genuinely
-- public — published, moderator-visible, not full-blocked between the
-- viewer and the Dispatch's author, and that author's content publicly
-- visible (not suspended/banned) — with NO own-author bypass of any
-- kind on this parent gate, including for the Dispatch's own author.
-- (In ordinary operation a Dispatch can only ever HAVE Replies while it
-- was published+visible, since create_reply itself refuses to attach a
-- Reply to a non-public Dispatch — this gate matters once a Dispatch is
-- later unpublished or moderator-hidden: its existing Replies become
-- unavailable to everyone, including its own author, exactly like the
-- Dispatch's own body would be to a non-author.)
--
-- On top of that unconditional parent-visibility gate, a Reply also
-- needs its OWN visibility gate: its own moderation_status, its own
-- author's blocking/account-status, OR the reply's own author viewing
-- their own Reply regardless of any of that — this own-author exception
-- is scoped to the REPLY's own state only, and does NOT and cannot
-- bypass the parent-Dispatch gate above (the `and` between the two
-- exists-clauses is unconditional).
--
-- Deliberately no deleted_at check here at all: a member-deleted Reply
-- stays fully selectable (its row, id, author_id, parent_reply_id,
-- root_reply_id, created_at all remain queryable so descendants keep
-- resolving correctly) — only its body content is gone, cleared at
-- delete_reply time by piece 4, not filtered at read time by RLS.
create policy dispatch_replies_select_published
  on public.dispatch_replies
  for select
  to authenticated
  using (
    exists (
      select 1 from public.dispatches d
      where d.id = dispatch_replies.dispatch_id
        and d.status = 'published'
        and d.moderation_status = 'visible'
        and not tempa_private.is_blocked_pair(auth.uid(), d.author_id)
        and tempa_private.author_content_publicly_visible(d.author_id)
    )
    and (
      (
        moderation_status = 'visible'
        and not tempa_private.is_blocked_pair(auth.uid(), author_id)
        and tempa_private.author_content_publicly_visible(author_id)
      )
      or author_id = auth.uid()
    )
  );

-- SELECT only. Every mutation (create_reply, delete_reply,
-- admin_hide_reply, admin_restore_reply) is RPC-only from day one —
-- learning directly from kept_minds' own history (docs/sql/2026-09-11-
-- safety-blocking-foundation.sql section 8: its original direct
-- INSERT/DELETE grant had to be retrofitted away once cross-cutting
-- validation was needed) rather than repeating that mistake here.
revoke all on public.dispatch_replies from public;
grant select on public.dispatch_replies to authenticated;


-- ============================================================
-- 2. DELETE_DISPATCH — reproduced with a Reply-existence guard
-- ============================================================
-- PRE-SQL CORRECTION (independent review, 2026-09-23 follow-up):
-- reproduced in full from its current live definition (docs/sql/2026-
-- 09-10-admin-moderation-and-questions.sql:1017-1046 — auth check,
-- account-status gate, then the existing author-owns-a-visible-Dispatch
-- existence check) with exactly ONE addition: a check that the Dispatch
-- has no Reply rows at all, BEFORE the DELETE runs. Smallest safe fix,
-- per instruction — no Dispatch soft-deletion/tombstone architecture is
-- introduced; a Dispatch that has accumulated any Replies simply cannot
-- be hard-deleted while they exist. The check is unconditional on WHO
-- authored the Replies (not narrowed to "other members' Replies only"):
-- distinguishing "only my own Replies exist" from "someone else's"
-- would add complexity for no real safety benefit, since the actual
-- goal is that a Dispatch delete never has to reason about destroying
-- ANY Reply row. This is deliberately checked in the application layer
-- (a clear, friendly exception) rather than relying solely on the NO
-- ACTION FK backstop on dispatch_replies.dispatch_id (piece 1 above) —
-- that backstop exists so the database itself refuses the raw DELETE
-- even if this RPC's own check were ever bypassed, but a raw Postgres
-- FK-violation error is not a message this app should ever let reach a
-- member directly.
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

  -- FINAL CONCURRENCY CORRECTION (2026-09-23 follow-up): FOR UPDATE
  -- locks the Dispatch row as part of this SAME ownership-existence
  -- check, BEFORE the Reply-existence check below — closing the race
  -- where a concurrent create_reply could insert a Reply after this
  -- function decided "zero Replies" but before its own DELETE runs,
  -- leaving either an orphaned Reply or a raw FK-violation error. FOR
  -- UPDATE (the strongest row lock) is the correct choice here, not
  -- merely the weakest sufficient one: this function ends by DELETING
  -- this exact row, and a DELETE always requires a FOR UPDATE-equivalent
  -- lock anyway, so acquiring it explicitly and early is consistent, not
  -- an escalation. Lock ordering is deliberately consistent with create_
  -- reply's own FOR SHARE on this same row (see create_reply's matching
  -- comment): both functions only ever lock the Dispatch row (never a
  -- second resource in a conflicting order), so no deadlock cycle can
  -- form — whichever transaction reaches this row first simply makes
  -- the other wait, then the second transaction resumes and observes
  -- the FIRST transaction's completed outcome (either the new Reply now
  -- exists, or the Dispatch itself is already gone).
  if not exists (
    select 1 from public.dispatches d
    where d.id = p_dispatch_id
      and d.author_id = auth.uid()
      and d.moderation_status = 'visible'
    for update
  ) then
    raise exception 'Only the author of a Dispatch may delete it.';
  end if;

  -- A Dispatch with any Reply — its own author's or another member's —
  -- cannot be hard-deleted. Checked BEFORE the DELETE so the caller
  -- always gets this one clear, deliberate message instead of a raw
  -- FK-violation error surfacing from the NO ACTION backstop. Safe
  -- against the concurrency race described above: the FOR UPDATE lock
  -- just taken above guarantees no OTHER transaction can insert a Reply
  -- against this Dispatch between this check and the DELETE below.
  if exists (
    select 1 from public.dispatch_replies where dispatch_id = p_dispatch_id
  ) then
    raise exception 'This Dispatch cannot be deleted while it still has Replies.';
  end if;

  delete from public.dispatches where id = p_dispatch_id;
end;
$function$;

revoke all on function public.delete_dispatch(uuid) from public;
grant execute on function public.delete_dispatch(uuid) to authenticated;


-- ============================================================
-- 3. CREATE_REPLY — the sole write path for new Replies
-- ============================================================
-- p_parent_reply_id is the ONLY optional input — the caller never
-- supplies author_id, reply_to_user_id, or root_reply_id; all three are
-- derived here, server-side, from auth.uid() and (when replying to a
-- Reply) the parent row's own already-stored values. Validation order
-- mirrors publish_dispatch's own established shape (docs/sql/2026-09-
-- 07-dispatches-and-board.sql): authentication, then account status,
-- then content validity, then target-existence/eligibility checks, then
-- the actual write.
create or replace function public.create_reply(
  p_dispatch_id uuid,
  p_body text,
  p_parent_reply_id uuid default null
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
  v_result public.dispatch_replies%rowtype;

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  -- Matches every other write RPC's own account-status gate exactly
  -- (e.g. publish_dispatch, keep_mind) — restricted/suspended/banned
  -- may not create new content, though their EXISTING content (and, for
  -- restricted specifically, their ability to be replied TO) is
  -- unaffected by this check, which only ever gates the ACTING member's
  -- own new write.
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

  -- FINAL CONCURRENCY CORRECTION (2026-09-23 follow-up): FOR SHARE locks
  -- this Dispatch row for the remainder of the transaction. Without it,
  -- another transaction could unpublish/hide the Dispatch (or delete_
  -- dispatch could delete it, once it has no Replies) AFTER the
  -- eligibility check below passes but BEFORE the INSERT at the bottom
  -- of this function, letting a Reply attach to a Dispatch that is no
  -- longer actually eligible by the time it lands. FOR SHARE is the
  -- weakest lock that achieves this: it does not conflict with another
  -- concurrent FOR SHARE/FOR KEY SHARE (so concurrent create_reply calls
  -- on the same Dispatch never block each other), but it DOES conflict
  -- with the FOR NO KEY UPDATE a plain UPDATE takes (e.g. admin_hide_
  -- dispatch's `moderation_status` change) and with the FOR UPDATE a
  -- DELETE takes (delete_dispatch, piece 2 above) — both are correctly
  -- blocked until this transaction commits or rolls back. See delete_
  -- dispatch's own matching comment for the consistent lock ordering
  -- (Dispatch row always locked first, only ever this one resource) that
  -- keeps this deadlock-free.
  select id, author_id, status, moderation_status
  into v_dispatch
  from public.dispatches
  where id = p_dispatch_id
  for share;

  if v_dispatch.id is null then
    raise exception 'Dispatch not found.';
  end if;

  -- LOCKED RULE, no exception for the Dispatch's own author: a Reply
  -- may be created only when the Dispatch is CURRENTLY status =
  -- 'published' AND moderation_status = 'visible'. This is a CREATE-
  -- eligibility check, deliberately independent of dispatches_select_
  -- published's own read-time allowance that lets an author see their
  -- own draft/hidden Dispatch — that read-time allowance does not, and
  -- must not, make that same Dispatch repliable. An author replying to
  -- their own Dispatch is only ever reachable through the SAME
  -- published-and-visible path every other member uses; this condition
  -- below has no identity-based carve-out of any kind for the acting
  -- member — see lib/__tests__/dispatchRepliesMigration.test.ts and the
  -- verifier's own create_reply_check for the standing regression guard
  -- on this exact point.
  if v_dispatch.status <> 'published' or v_dispatch.moderation_status <> 'visible' then
    raise exception 'This Dispatch is not open to Replies right now.';
  end if;

  -- Full-scope block, either direction, between the caller and the
  -- Dispatch's author — the exact same helper dispatches_select_
  -- published itself uses. NEVER is_correspondence_blocked_pair: Stop
  -- letters (a 'letters'-scope block) must have zero effect here,
  -- preserving the checkpoint's own explicit instruction. Replying to
  -- your OWN Dispatch is explicitly allowed (the block check is a no-op
  -- when auth.uid() = v_dispatch.author_id, since blocked_users forbids
  -- blocking yourself). PRE-SQL CORRECTION (final security review):
  -- this SECURITY DEFINER function bypasses RLS entirely, so it must
  -- explicitly reproduce every eligibility condition ordinary RLS would
  -- otherwise supply — added the Dispatch author's own public-visibility
  -- check (author_content_publicly_visible, the same helper dispatch_
  -- replies_select_published's own parent gate now uses), reusing the
  -- existing generic "not available right now" message rather than
  -- hand-rolling a separate account-status comparison. A caller who IS
  -- the Dispatch's own suspended/banned author is already rejected
  -- earlier by the current_account_status() gate above, so this adds no
  -- new way to block a legitimate self-reply.
  if tempa_private.is_blocked_pair(auth.uid(), v_dispatch.author_id)
     or not tempa_private.author_content_publicly_visible(v_dispatch.author_id) then
    raise exception 'This action is not available right now.';
  end if;

  if p_parent_reply_id is null then
    v_root_reply_id := null;
    v_reply_to_user_id := null;
  else

    -- FINAL CONCURRENCY CORRECTION: same reasoning and lock mode as the
    -- Dispatch FOR SHARE above, applied to the parent Reply row — a
    -- concurrent delete_reply (tombstone UPDATE) or admin_hide_reply
    -- (moderation UPDATE) against THIS SPECIFIC row must not be able to
    -- invalidate the eligibility check below between validation and this
    -- function's own INSERT. Only the actual parent row is locked — no
    -- recursive locking up its own parent/root chain, since only the
    -- true immediate parent's current state is being validated here.
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

    -- A moderator-hidden OR member-deleted parent is not a legitimate
    -- new-Reply target — judgment call, documented here rather than
    -- silently made: EXISTING descendants of a since-removed Reply stay
    -- fully valid and visible (root_reply_id/parent_reply_id keep
    -- resolving), but starting a NEW branch off a Reply that no longer
    -- has presentable content of its own is refused, the same way you
    -- cannot reply to a moderator-hidden Dispatch.
    if v_parent.moderation_status <> 'visible' or v_parent.deleted_at is not null then
      raise exception 'That Reply is no longer available to answer.';
    end if;

    -- Same PRE-SQL CORRECTION reasoning as the Dispatch-author check
    -- above, applied to the parent Reply's own author: a suspended/
    -- banned parent author's content must not stay reachable as a
    -- reply target merely because the parent row itself is still
    -- moderation_status = 'visible'.
    if tempa_private.is_blocked_pair(auth.uid(), v_parent.author_id)
       or not tempa_private.author_content_publicly_visible(v_parent.author_id) then
      raise exception 'This action is not available right now.';
    end if;

    v_reply_to_user_id := v_parent.author_id;
    -- Single-hop, never recursive: inherit the parent's own already-
    -- resolved root, or (the parent IS itself top-level) the parent's
    -- own id.
    v_root_reply_id := coalesce(v_parent.root_reply_id, v_parent.id);

  end if;

  insert into public.dispatch_replies (
    dispatch_id, author_id, body, parent_reply_id, root_reply_id, reply_to_user_id
  ) values (
    p_dispatch_id, auth.uid(), v_body, p_parent_reply_id, v_root_reply_id, v_reply_to_user_id
  )
  returning * into v_result;

  return v_result;

end;
$function$;

revoke all on function public.create_reply(uuid, text, uuid) from public;
grant execute on function public.create_reply(uuid, text, uuid) to authenticated;


-- ============================================================
-- 4. DELETE_REPLY — member's own tombstone/soft-removal
-- ============================================================
-- Author-only. Never gated on current_account_status() or blocking —
-- this is a de-escalating action, the same reasoning unkeep_mind's own
-- comment gives for skipping that check (docs/sql/2026-09-11-safety-
-- blocking-foundation.sql): removing your own writing must remain
-- available regardless of account/block state. Clears body to the
-- empty string AND sets deleted_at in the same UPDATE — per the
-- checkpoint's own explicit preference, this actually removes the
-- stored text rather than merely flagging it hidden while leaving the
-- original body sitting in the row for ordinary application code to
-- misuse. The row itself, its id, author_id, parent_reply_id,
-- root_reply_id, reply_to_user_id, and created_at are all left
-- completely untouched, so any existing descendant keeps resolving its
-- own parent/root/reply_to exactly as before. Never touches reports.
-- evidence_snapshot — that is a separate table with no FK to this one;
-- previously-recorded report evidence is physically incapable of being
-- affected by this UPDATE.
create or replace function public.delete_reply(p_reply_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  update public.dispatch_replies
  set deleted_at = now(),
      body = ''
  where id = p_reply_id
    and author_id = auth.uid()
    and deleted_at is null;

  if not found then
    raise exception 'Reply not found.';
  end if;

end;
$function$;

revoke all on function public.delete_reply(uuid) from public;
grant execute on function public.delete_reply(uuid) to authenticated;


-- ============================================================
-- 5. ADMIN_HIDE_REPLY / ADMIN_RESTORE_REPLY
-- ============================================================
-- Direct copies of admin_hide_dispatch/admin_restore_dispatch's own
-- authorization, idempotency, and audit-log shape (docs/sql/2026-09-10-
-- admin-moderation-and-questions.sql:1224-1365), substituted onto
-- dispatch_replies — no new moderator paradigm invented. The
-- target_identifier_snapshot uses a short body excerpt (Replies have no
-- title) — this may legitimately be empty if the Reply was already
-- member-deleted before a moderator ever hid it, which is an accurate,
-- harmless reflection of that state, not a bug.
create or replace function public.admin_hide_reply(p_reply_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_reason text;
  v_old_status text;
  v_actor_pseudonym text;
  v_target_excerpt text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('moderator') then
    raise exception 'Not authorized.';
  end if;

  if not public.is_staff('admin') then
    if not exists (
      select 1 from public.reports
      where target_type = 'reply' and target_id = p_reply_id
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

  select moderation_status, left(body, 60) into v_old_status, v_target_excerpt
  from public.dispatch_replies where id = p_reply_id;

  if v_old_status is null then
    raise exception 'Reply not found.';
  end if;

  if v_old_status = 'hidden' then
    raise exception 'This content is already hidden.';
  end if;

  update public.dispatch_replies
  set moderation_status = 'hidden',
      moderated_at = now()
  where id = p_reply_id;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot, reason, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'content_hidden',
    'reply', p_reply_id, v_target_excerpt, v_reason,
    jsonb_build_object('previous_status', v_old_status, 'new_status', 'hidden')
  );
end;
$function$;

revoke all on function public.admin_hide_reply(uuid, text) from public;
grant execute on function public.admin_hide_reply(uuid, text) to authenticated;


create or replace function public.admin_restore_reply(p_reply_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_reason text;
  v_old_status text;
  v_actor_pseudonym text;
  v_target_excerpt text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_staff('moderator') then
    raise exception 'Not authorized.';
  end if;

  if not public.is_staff('admin') then
    if not exists (
      select 1 from public.reports
      where target_type = 'reply' and target_id = p_reply_id
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

  select moderation_status, left(body, 60) into v_old_status, v_target_excerpt
  from public.dispatch_replies where id = p_reply_id;

  if v_old_status is null then
    raise exception 'Reply not found.';
  end if;

  if v_old_status = 'visible' then
    raise exception 'This content is already visible.';
  end if;

  update public.dispatch_replies
  set moderation_status = 'visible',
      moderated_at = now()
  where id = p_reply_id;

  select pseudonym into v_actor_pseudonym from public.profiles where id = auth.uid();

  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action,
    target_type, target_id, target_identifier_snapshot, reason, metadata
  ) values (
    auth.uid(), coalesce(v_actor_pseudonym, auth.uid()::text), 'content_restored',
    'reply', p_reply_id, v_target_excerpt, v_reason,
    jsonb_build_object('previous_status', v_old_status, 'new_status', 'visible')
  );
end;
$function$;

revoke all on function public.admin_restore_reply(uuid, text) from public;
grant execute on function public.admin_restore_reply(uuid, text) to authenticated;


-- ============================================================
-- 6. REPORTS EXTENSION — target_type 'reply'
-- ============================================================
-- Widens the existing CHECK constraint exactly the way 'question_
-- answer' was added (docs/sql/2026-09-10-admin-moderation-and-
-- questions.sql:753-755) — drop, then re-add with the new value
-- appended.
alter table public.reports drop constraint reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('profile', 'letter', 'dispatch', 'photo_moment', 'question_answer', 'reply'));

-- report_content reproduced in full from its current live shape
-- (docs/sql/2026-09-10-admin-moderation-and-questions.sql:779-994) with
-- exactly one new elsif branch added, mirroring the dispatch/question_
-- answer branches' own shape: derive reported_user_id from the target's
-- own author column, snapshot evidence under the SAME visibility
-- predicate the read policy itself uses (moderation_status = 'visible'
-- and not blocked) — deliberately NOT filtering on deleted_at, so a
-- member cannot evade a report by deleting their own Reply the instant
-- someone starts to report it; whatever remains (author identity,
-- Dispatch/parent context, and a body that may by then be empty) is
-- still captured, exactly as much evidence as genuinely exists to
-- capture — not over-collected, not a new archive system.
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

  if p_target_type not in ('profile', 'letter', 'dispatch', 'photo_moment', 'question_answer', 'reply') then
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


  elsif p_target_type = 'reply' then

    -- PRE-SQL CORRECTION (final security review, 2026-09-23 follow-up):
    -- this SECURITY DEFINER function bypasses RLS entirely, so its own
    -- WHERE clause must reproduce the FULL boundary dispatch_replies_
    -- select_published enforces — both the Reply's own visibility AND
    -- its parent Dispatch's own public-visibility gate (published,
    -- moderator-visible, not full-blocked, publicly-visible author) —
    -- not merely the Reply's own moderation_status/blocking, which
    -- would let a member report (and thereby have evidence-snapshotted)
    -- a Reply whose parent Dispatch is unpublished/hidden, or whose
    -- author is suspended/banned. Deliberately NOT filtering on
    -- deleted_at: a member-deleted Reply must remain reportable (its
    -- body may already be empty; existing evidence_snapshot rows
    -- created BEFORE deletion are untouched by this SELECT either way).
    select
      r.author_id,
      jsonb_build_object(
        'body', r.body,
        'author_pseudonym', p.pseudonym,
        'dispatch_id', r.dispatch_id,
        'dispatch_title', d.title,
        'parent_reply_id', r.parent_reply_id,
        'reply_created_at', r.created_at
      )
    into v_reported_user_id, v_evidence
    from public.dispatch_replies r
    join public.dispatches d on d.id = r.dispatch_id
    join public.profiles p on p.id = r.author_id
    where r.id = p_target_id
      and d.status = 'published'
      and d.moderation_status = 'visible'
      and not tempa_private.is_blocked_pair(auth.uid(), d.author_id)
      and tempa_private.author_content_publicly_visible(d.author_id)
      and r.moderation_status = 'visible'
      and not tempa_private.is_blocked_pair(auth.uid(), r.author_id)
      and tempa_private.author_content_publicly_visible(r.author_id);

    if v_reported_user_id is null then
      raise exception 'Reply not found.';
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

commit;
