// Board Experience Phase 2B — this repository cannot execute Postgres,
// so (same approach as boardFeedMigration.test.ts, blockUserOverloadMigration.test.ts)
// the tracked SQL source text itself is inspected directly. Deliberately
// avoids any literal `\n` inside a toContain(...) string — Windows CRLF
// line endings mean a literal `\n` never matches the actual file text.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const MIGRATION_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-09-23-dispatch-replies.sql')

const sql = readFileSync(MIGRATION_PATH, 'utf8')

/** Executable SQL only — strips every `-- ` comment line, so a negative
 * assertion ("never references X") isn't tripped up by this file's own
 * doc comments explicitly EXPLAINING that absence (e.g. "NEVER
 * is_correspondence_blocked_pair: Stop letters ..."), which legitimately
 * contain the forbidden term as prose, not as code. */
const executableSql = sql
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('--'))
  .join('\n')

describe('dispatch replies migration source — transaction safety', () => {
  it('wraps the whole migration in a single explicit transaction', () => {
    const beginIndex = sql.indexOf('begin;')
    const commitIndex = sql.lastIndexOf('commit;')
    expect(beginIndex).toBeGreaterThan(-1)
    expect(commitIndex).toBeGreaterThan(beginIndex)
    expect(sql.trim().endsWith('commit;')).toBe(true)
  })
})

describe('dispatch replies migration source — table shape', () => {
  it('creates dispatch_replies with every locked field', () => {
    expect(sql).toContain('create table public.dispatch_replies (')
    expect(sql).toContain('id uuid primary key default gen_random_uuid()')
    expect(sql).toContain('dispatch_id uuid not null')
    expect(sql).toContain('author_id uuid not null')
    expect(sql).toContain('body text not null')
    expect(sql).toContain('parent_reply_id uuid')
    expect(sql).toContain('root_reply_id uuid')
    expect(sql).toContain('reply_to_user_id uuid')
    expect(sql).toContain("moderation_status text not null default 'visible'")
    expect(sql).toContain('moderated_at timestamptz')
    expect(sql).toContain('deleted_at timestamptz')
    expect(sql).toContain('created_at timestamptz not null default now()')
  })

  it('never adds an updated_at column — no editing in Phase 2B', () => {
    expect(executableSql).not.toContain('updated_at')
  })

  it('author_id cascades on delete; dispatch_id does NOT (pre-SQL correction — Replies must never cascade-delete with their Dispatch)', () => {
    const start = sql.indexOf('create table public.dispatch_replies')
    const end = sql.indexOf('constraint dispatch_replies_no_self_parent')
    const tableBody = sql.slice(start, end)
    expect(tableBody).toContain('references public.dispatches(id)')
    expect(tableBody).toContain('references auth.users(id)')
    // Comment-stripped, so this doesn't get tripped up by the column's
    // own doc comment explaining the absence ("deliberately NOT on
    // delete cascade") — same convention as the top-level executableSql.
    const executableTableBody = tableBody
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('--'))
      .join('\n')
    // Only author_id (auth.users) cascades now — dispatch_id no longer
    // does, so exactly ONE "on delete cascade" remains in the table body.
    const cascadeCount = (executableTableBody.match(/on delete cascade/g) ?? []).length
    expect(cascadeCount).toBe(1)
    // parent_reply_id / root_reply_id / reply_to_user_id: set null, never cascade.
    const setNullCount = (executableTableBody.match(/on delete set null/g) ?? []).length
    expect(setNullCount).toBe(3)
  })

  it('dispatch_id has no ON DELETE clause at all (defaults to NO ACTION) — the database itself refuses to delete a Dispatch with existing Replies', () => {
    const start = sql.indexOf('dispatch_id uuid not null')
    const end = sql.indexOf('author_id uuid not null')
    const dispatchIdClause = sql.slice(start, end)
    expect(dispatchIdClause).toContain('references public.dispatches(id)')
    expect(dispatchIdClause).not.toContain('on delete cascade')
    expect(dispatchIdClause).not.toContain('on delete set null')
  })

  it('has the self-parent guard and the deletion-compatible body-length CHECK', () => {
    expect(sql).toContain('constraint dispatch_replies_no_self_parent')
    expect(sql).toContain('check (parent_reply_id is distinct from id)')
    expect(sql).toContain('constraint dispatch_replies_body_length')
    expect(sql).toContain('char_length(trim(body)) between 1 and 500')
    expect(sql).toContain("deleted_at is not null and body = ''")
  })

  it('creates the expected indexes', () => {
    expect(sql).toContain('create index dispatch_replies_dispatch_id_created_at_idx')
    expect(sql).toContain('on public.dispatch_replies (dispatch_id, created_at)')
    expect(sql).toContain('create index dispatch_replies_parent_reply_id_idx')
    expect(sql).toContain('create index dispatch_replies_root_reply_id_idx')
    expect(sql).toContain('create index dispatch_replies_author_id_idx')
    expect(sql).toContain('create index dispatch_replies_reply_to_user_id_idx')
  })
})

describe('dispatch replies migration source — RLS and grants', () => {
  it('enables RLS and defines dispatch_replies_select_published', () => {
    expect(sql).toContain('alter table public.dispatch_replies enable row level security')
    expect(sql).toContain('create policy dispatch_replies_select_published')
  })

  function policyBody(): string {
    const start = sql.indexOf('create policy dispatch_replies_select_published')
    const end = sql.indexOf(';', start)
    return sql.slice(start, end)
  }

  it('joins through dispatches for the parent-visibility gate, and — final security review correction — that gate requires published + visible + not-blocked + publicly-visible, with NO own-author bypass', () => {
    const body = policyBody()
    expect(body).toContain('from public.dispatches d')
    expect(body).toContain("d.status = 'published'")
    expect(body).toContain("d.moderation_status = 'visible'")
    expect(body).toContain('tempa_private.is_blocked_pair(auth.uid(), d.author_id)')
    expect(body).toContain('tempa_private.author_content_publicly_visible(d.author_id)')
    expect(body).not.toContain('d.author_id = auth.uid()')
  })

  it('checks the Reply\'s own moderation_status, blocking, and account-visibility, plus the own-author exception', () => {
    const body = policyBody()
    expect(body).toContain("moderation_status = 'visible'")
    expect(body).toContain('tempa_private.is_blocked_pair(auth.uid(), author_id)')
    expect(body).toContain('tempa_private.author_content_publicly_visible(author_id)')
    expect(body).toContain('or author_id = auth.uid()')
  })

  it('never references is_correspondence_blocked_pair in any executable statement — Stop letters must have zero effect on Replies', () => {
    expect(executableSql).not.toContain('is_correspondence_blocked_pair')
  })

  it('grants SELECT only to authenticated — every mutation must be RPC-only', () => {
    expect(sql).toContain('revoke all on public.dispatch_replies from public')
    expect(sql).toContain('grant select on public.dispatch_replies to authenticated')
    expect(sql).not.toContain('grant insert on public.dispatch_replies')
    expect(sql).not.toContain('grant update on public.dispatch_replies')
    expect(sql).not.toContain('grant delete on public.dispatch_replies')
  })
})

describe('dispatch replies migration source — delete_dispatch (pre-SQL correction: Reply-existence guard)', () => {
  function fnBody(): string {
    const start = sql.indexOf('create or replace function public.delete_dispatch')
    const end = sql.indexOf('revoke all on function public.delete_dispatch', start)
    return sql.slice(start, end)
  }

  it('is reproduced in full — auth, account status, and the existing author-owns-a-visible-Dispatch check are all still present', () => {
    const body = fnBody()
    expect(body).toContain('if auth.uid() is null then')
    expect(body).toContain("current_account_status() in ('restricted', 'suspended', 'banned')")
    expect(body).toContain('and d.author_id = auth.uid()')
    expect(body).toContain("and d.moderation_status = 'visible'")
    expect(body).toContain('Only the author of a Dispatch may delete it.')
  })

  it('checks for any existing dispatch_replies row and raises the exact new exception before the DELETE runs', () => {
    const body = fnBody()
    const guardIndex = body.indexOf('from public.dispatch_replies where dispatch_id = p_dispatch_id')
    const messageIndex = body.indexOf('This Dispatch cannot be deleted while it still has Replies.')
    const deleteIndex = body.indexOf('delete from public.dispatches where id = p_dispatch_id')
    expect(guardIndex).toBeGreaterThan(-1)
    expect(messageIndex).toBeGreaterThan(-1)
    expect(deleteIndex).toBeGreaterThan(-1)
    expect(guardIndex).toBeLessThan(deleteIndex)
    expect(messageIndex).toBeLessThan(deleteIndex)
  })

  it('the Reply-existence check is NOT scoped to a particular author — it blocks on any Reply at all, own or another member\'s', () => {
    const body = fnBody()
    const guardStart = body.indexOf('if exists (')
    const guardEnd = body.indexOf('end if;', guardStart)
    const guardClause = body.slice(guardStart, guardEnd)
    expect(guardClause).toContain('select 1 from public.dispatch_replies where dispatch_id = p_dispatch_id')
    expect(guardClause).not.toContain('author_id')
  })

  it('is still SECURITY DEFINER and granted to authenticated only', () => {
    expect(fnBody()).toContain('security definer')
    expect(sql).toContain('grant execute on function public.delete_dispatch(uuid) to authenticated')
    expect(sql).not.toContain('grant execute on function public.delete_dispatch(uuid) to anon')
  })

  // ============================================================
  // Final concurrency correction — locks the Dispatch row BEFORE
  // checking dispatch_replies, so a concurrent create_reply cannot
  // insert a Reply between "zero Replies" and the DELETE.
  // ============================================================
  it('locks the Dispatch row FOR UPDATE as part of the ownership-existence check, BEFORE the Reply-existence check and the DELETE', () => {
    const body = fnBody()
    const lockIndex = body.indexOf('for update')
    const ownershipCheckStart = body.indexOf('if not exists (')
    const ownershipCheckEnd = body.indexOf('end if;', ownershipCheckStart)
    const replyGuardIndex = body.indexOf('from public.dispatch_replies where dispatch_id = p_dispatch_id')
    const deleteIndex = body.indexOf('delete from public.dispatches where id = p_dispatch_id')
    expect(lockIndex).toBeGreaterThan(-1)
    // FOR UPDATE sits inside the ownership-check's own exists() clause.
    expect(lockIndex).toBeGreaterThan(ownershipCheckStart)
    expect(lockIndex).toBeLessThan(ownershipCheckEnd)
    expect(lockIndex).toBeLessThan(replyGuardIndex)
    expect(replyGuardIndex).toBeLessThan(deleteIndex)
  })

  it('uses FOR UPDATE specifically (the strongest row lock), not merely FOR SHARE — this function ends by deleting the same row', () => {
    const body = fnBody()
    expect(body).toContain('for update')
    expect(body).not.toContain('for share')
  })
})

describe('dispatch replies migration source — create_reply', () => {
  function fnBody(): string {
    const start = sql.indexOf('create or replace function public.create_reply')
    const end = sql.indexOf('revoke all on function public.create_reply', start)
    return sql.slice(start, end)
  }

  it('is SECURITY DEFINER, returning the full inserted row', () => {
    const body = fnBody()
    expect(body).toContain('security definer')
    expect(body).toContain('returns public.dispatch_replies')
  })

  it('accepts only dispatch id, body, and an optional parent id — never author/root/reply_to as parameters', () => {
    const body = fnBody()
    expect(body).toContain('p_dispatch_id uuid')
    expect(body).toContain('p_body text')
    expect(body).toContain('p_parent_reply_id uuid default null')
    expect(body).not.toContain('p_author_id')
    expect(body).not.toContain('p_reply_to_user_id')
    expect(body).not.toContain('p_root_reply_id')
  })

  it('checks account status before allowing a write', () => {
    expect(fnBody()).toContain("current_account_status() in ('restricted', 'suspended', 'banned')")
  })

  it('enforces the 1..500 character body limit', () => {
    const body = fnBody()
    expect(body).toContain('char_length(v_body) = 0')
    expect(body).toContain('char_length(v_body) > 500')
  })

  it('checks the Dispatch is published and visible, and that the caller is not full-blocked with its author', () => {
    const body = fnBody()
    expect(body).toContain("v_dispatch.status <> 'published' or v_dispatch.moderation_status <> 'visible'")
    expect(body).toContain('tempa_private.is_blocked_pair(auth.uid(), v_dispatch.author_id)')
  })

  it('pre-SQL correction regression guard: the published/visible check has NO own-author bypass — an author cannot reply to their own draft or hidden Dispatch', () => {
    const body = fnBody()
    const checkStart = body.indexOf("if v_dispatch.status <> 'published'")
    const checkEnd = body.indexOf('end if;', checkStart)
    const checkClause = body.slice(checkStart, checkEnd)
    expect(checkClause).not.toContain('author_id')
    expect(checkClause).not.toContain('auth.uid()')
  })

  it('final security review correction (Defect 2): also checks the Dispatch author\'s own public-visibility, in the SAME block-check as the blocking check', () => {
    const body = fnBody()
    const blockCheckStart = body.indexOf('if tempa_private.is_blocked_pair(auth.uid(), v_dispatch.author_id)')
    const blockCheckEnd = body.indexOf('end if;', blockCheckStart)
    const blockCheckClause = body.slice(blockCheckStart, blockCheckEnd)
    expect(blockCheckClause).toContain('tempa_private.author_content_publicly_visible(v_dispatch.author_id)')
  })

  it('for a nested Reply, validates the parent exists, belongs to the SAME dispatch, is a legitimate target, and is not full-blocked', () => {
    const body = fnBody()
    expect(body).toContain('v_parent.dispatch_id <> p_dispatch_id')
    expect(body).toContain("v_parent.moderation_status <> 'visible' or v_parent.deleted_at is not null")
    expect(body).toContain('tempa_private.is_blocked_pair(auth.uid(), v_parent.author_id)')
  })

  it('final security review correction (Defect 2): also checks the parent Reply author\'s own public-visibility, in the SAME block-check as its blocking check', () => {
    const body = fnBody()
    const blockCheckStart = body.indexOf('if tempa_private.is_blocked_pair(auth.uid(), v_parent.author_id)')
    const blockCheckEnd = body.indexOf('end if;', blockCheckStart)
    const blockCheckClause = body.slice(blockCheckStart, blockCheckEnd)
    expect(blockCheckClause).toContain('tempa_private.author_content_publicly_visible(v_parent.author_id)')
  })

  it('derives reply_to_user_id from the parent\'s own author, and root_reply_id via a single-hop coalesce — never a recursive walk', () => {
    const body = fnBody()
    expect(body).toContain('v_reply_to_user_id := v_parent.author_id')
    expect(body).toContain('v_root_reply_id := coalesce(v_parent.root_reply_id, v_parent.id)')
  })

  it('inserts with author_id = auth.uid() — never a client-supplied author', () => {
    expect(fnBody()).toContain('p_dispatch_id, auth.uid(), v_body, p_parent_reply_id, v_root_reply_id, v_reply_to_user_id')
  })

  it('is granted to authenticated only, never anon', () => {
    expect(sql).toContain('grant execute on function public.create_reply(uuid, text, uuid) to authenticated')
    expect(sql).not.toContain('grant execute on function public.create_reply(uuid, text, uuid) to anon')
  })

  // ============================================================
  // Final concurrency correction — the Dispatch row (and, when nested,
  // the parent Reply row) must be locked for the remainder of the
  // transaction at the moment they are read, so a concurrent transaction
  // cannot invalidate the eligibility decision before this function's
  // own INSERT.
  // ============================================================
  it('locks the Dispatch row FOR SHARE as part of the SAME select that reads it for eligibility validation', () => {
    const body = fnBody()
    const readStart = body.indexOf('select id, author_id, status, moderation_status')
    const readEnd = body.indexOf(';', readStart)
    const readClause = body.slice(readStart, readEnd)
    expect(readClause).toContain('from public.dispatches')
    expect(readClause).toContain('where id = p_dispatch_id')
    expect(readClause).toContain('for share')
  })

  it('the Dispatch lock is acquired BEFORE the eligibility checks run and BEFORE the final INSERT', () => {
    const body = fnBody()
    const lockIndex = body.indexOf('for share')
    const eligibilityCheckIndex = body.indexOf("if v_dispatch.status <> 'published'")
    const insertIndex = body.indexOf('insert into public.dispatch_replies')
    expect(lockIndex).toBeGreaterThan(-1)
    expect(lockIndex).toBeLessThan(eligibilityCheckIndex)
    expect(eligibilityCheckIndex).toBeLessThan(insertIndex)
  })

  it('locks the parent Reply row FOR SHARE as part of the SAME select that reads it, only when replying to a Reply', () => {
    const body = fnBody()
    const readStart = body.indexOf('select id, dispatch_id, author_id, root_reply_id, moderation_status, deleted_at')
    const readEnd = body.indexOf(';', readStart)
    const readClause = body.slice(readStart, readEnd)
    expect(readClause).toContain('from public.dispatch_replies')
    expect(readClause).toContain('where id = p_parent_reply_id')
    expect(readClause).toContain('for share')
  })

  it('locks exactly two rows at most (the Dispatch, and — only if nested — the true immediate parent Reply), never a recursive walk up the parent/root chain', () => {
    const body = fnBody()
    const lockCount = (body.match(/for share/g) ?? []).length
    expect(lockCount).toBe(2)
    // No second SELECT against dispatch_replies for anything other than
    // the true immediate parent (v_parent) — e.g. never also locking
    // whatever v_parent.root_reply_id resolves to.
    expect(body).not.toContain('where id = v_parent.root_reply_id')
  })

  it('both locks use FOR SHARE (the weakest lock that still blocks a concurrent UPDATE/DELETE), matching delete_dispatch\'s FOR UPDATE on the SAME Dispatch resource — a consistent lock strategy with no second, differently-ordered resource, so no deadlock cycle can form', () => {
    const body = fnBody()
    expect(body).not.toContain('for update')
    expect(body).not.toContain('for no key update')
    expect(body).not.toContain('for key share')
  })
})

describe('dispatch replies migration source — delete_reply (member tombstone)', () => {
  function fnBody(): string {
    const start = sql.indexOf('create or replace function public.delete_reply')
    const end = sql.indexOf('revoke all on function public.delete_reply', start)
    return sql.slice(start, end)
  }

  it('is author-only and clears the body while setting deleted_at, in the same UPDATE', () => {
    const body = fnBody()
    expect(body).toContain('set deleted_at = now(),')
    expect(body).toContain("body = ''")
    expect(body).toContain('and author_id = auth.uid()')
  })

  it('is never gated on account status or blocking — a de-escalating action, like unkeep_mind', () => {
    const body = fnBody()
    expect(body).not.toContain('current_account_status()')
    expect(body).not.toContain('is_blocked_pair')
  })

  it('never touches parent_reply_id, root_reply_id, reply_to_user_id, or created_at', () => {
    const body = fnBody()
    expect(body).not.toContain('parent_reply_id =')
    expect(body).not.toContain('root_reply_id =')
    expect(body).not.toContain('reply_to_user_id =')
    expect(body).not.toContain('created_at =')
  })
})

describe('dispatch replies migration source — admin_hide_reply / admin_restore_reply', () => {
  it('both exist, mirroring the Dispatch moderation pattern', () => {
    expect(sql).toContain('create or replace function public.admin_hide_reply(p_reply_id uuid, p_reason text)')
    expect(sql).toContain('create or replace function public.admin_restore_reply(p_reply_id uuid, p_reason text)')
  })

  it('both require is_staff and a report-driven boundary for a moderator-only caller, targeting reports.target_type = \'reply\'', () => {
    const hideStart = sql.indexOf('create or replace function public.admin_hide_reply')
    const hideEnd = sql.indexOf('revoke all on function public.admin_hide_reply', hideStart)
    const hideBody = sql.slice(hideStart, hideEnd)
    expect(hideBody).toContain("is_staff('moderator')")
    expect(hideBody).toContain("is_staff('admin')")
    expect(hideBody).toContain("target_type = 'reply' and target_id = p_reply_id")
  })

  it('never clears/touches body — moderation hiding is reversible and content-preserving, unlike member deletion', () => {
    const hideStart = sql.indexOf('create or replace function public.admin_hide_reply')
    const hideEnd = sql.indexOf('revoke all on function public.admin_hide_reply', hideStart)
    const hideBody = sql.slice(hideStart, hideEnd)
    expect(hideBody).not.toContain("body = ''")
  })

  it('writes admin_audit_log rows with target_type \'reply\'', () => {
    expect(sql).toContain("'reply', p_reply_id, v_target_excerpt, v_reason")
  })
})

describe('dispatch replies migration source — reports extension', () => {
  it('widens reports.target_type to include \'reply\'', () => {
    expect(sql).toContain('alter table public.reports drop constraint reports_target_type_check')
    expect(sql).toContain("check (target_type in ('profile', 'letter', 'dispatch', 'photo_moment', 'question_answer', 'reply'))")
  })

  it('report_content gains exactly one new elsif branch for \'reply\', reading from dispatch_replies', () => {
    const start = sql.indexOf('create or replace function public.report_content')
    const end = sql.indexOf('revoke all on function public.report_content', start)
    const body = sql.slice(start, end)
    expect(body).toContain("elsif p_target_type = 'reply' then")
    expect(body).toContain('from public.dispatch_replies r')
    expect(body).toContain('join public.dispatches d on d.id = r.dispatch_id')
    expect(body).toContain("r.moderation_status = 'visible'")
    expect(body).toContain('not tempa_private.is_blocked_pair(auth.uid(), r.author_id)')
  })

  it('does NOT filter the reply branch on deleted_at in any executable statement — a member-deleted Reply remains reportable (the branch\'s own comment explains this absence using the term "deleted_at" as prose)', () => {
    const start = sql.indexOf("elsif p_target_type = 'reply' then")
    const end = sql.indexOf('elsif p_target_type', start + 1) === -1 ? sql.indexOf('end if;', start) : sql.indexOf('elsif p_target_type', start + 1)
    const branch = sql.slice(start, end)
    const executableBranch = branch
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('--'))
      .join('\n')
    expect(executableBranch).not.toContain('deleted_at')
  })

  it('final security review correction: the reply branch\'s WHERE clause also requires the parent Dispatch published+visible+not-blocked+publicly-visible, and the Reply author publicly visible', () => {
    const start = sql.indexOf("elsif p_target_type = 'reply' then")
    const end = sql.indexOf('end if;', start)
    const branch = sql.slice(start, end)
    expect(branch).toContain("d.status = 'published'")
    expect(branch).toContain("d.moderation_status = 'visible'")
    expect(branch).toContain('tempa_private.is_blocked_pair(auth.uid(), d.author_id)')
    expect(branch).toContain('tempa_private.author_content_publicly_visible(d.author_id)')
    expect(branch).toContain('tempa_private.author_content_publicly_visible(r.author_id)')
  })

  it('the evidence snapshot captures body, author pseudonym, dispatch context, and parent relationship — not over-collected', () => {
    const start = sql.indexOf("elsif p_target_type = 'reply' then")
    const end = sql.indexOf('end if;', start)
    const branch = sql.slice(start, end)
    expect(branch).toContain("'body', r.body")
    expect(branch).toContain("'author_pseudonym', p.pseudonym")
    expect(branch).toContain("'dispatch_id', r.dispatch_id")
    expect(branch).toContain("'dispatch_title', d.title")
    expect(branch).toContain("'parent_reply_id', r.parent_reply_id")
  })

  it('preserves the shared self-report and duplicate-report guards unchanged', () => {
    expect(sql).toContain('if v_reported_user_id = auth.uid() then')
    expect(sql).toContain('You cannot report your own content.')
    expect(sql).toContain('You have already reported this.')
  })
})

describe('dispatch replies migration source — no scope creep', () => {
  it('introduces no likes/votes/reactions table, and only the one intended new table', () => {
    const createTableCount = (sql.match(/create table/g) ?? []).length
    expect(createTableCount).toBe(1)
    expect(sql.toLowerCase()).not.toContain('create table public.reply_likes')
    expect(sql.toLowerCase()).not.toContain('create table public.reply_reactions')
    expect(sql.toLowerCase()).not.toContain('create table public.reply_votes')
  })

  it('introduces no notification/event table', () => {
    expect(sql.toLowerCase()).not.toContain('create table public.notifications')
    expect(sql.toLowerCase()).not.toContain('create table public.events')
  })

  it('never touches board_feed_page or Phase 2A\'s session/ranking objects in any executable statement', () => {
    expect(executableSql).not.toContain('board_feed_page')
    expect(executableSql).not.toContain('session_started_at')
  })
})
