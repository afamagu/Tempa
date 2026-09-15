// Board Experience Phase 2C — this repository cannot execute Postgres,
// so (same approach as dispatchRepliesMigration.test.ts) the tracked
// SQL source text itself is inspected directly. Deliberately avoids
// any literal `\n` inside a toContain(...) string — Windows CRLF line
// endings mean a literal `\n` never matches the actual file text.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const MIGRATION_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-09-24-dispatch-worth-reading.sql')

const sql = readFileSync(MIGRATION_PATH, 'utf8')

/** Executable SQL only — strips every `-- ` comment line, so a negative
 * assertion ("never references X") isn't tripped up by this file's own
 * doc comments explicitly EXPLAINING that absence. */
const executableSql = sql
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('--'))
  .join('\n')

describe('worth reading migration source — transaction safety', () => {
  it('wraps the whole migration in a single explicit transaction', () => {
    const beginIndex = sql.indexOf('begin;')
    const commitIndex = sql.lastIndexOf('commit;')
    expect(beginIndex).toBeGreaterThan(-1)
    expect(commitIndex).toBeGreaterThan(beginIndex)
    expect(sql.trim().endsWith('commit;')).toBe(true)
  })
})

describe('worth reading migration source — table shape', () => {
  it('creates dispatch_worth_reading with every locked field', () => {
    expect(sql).toContain('create table public.dispatch_worth_reading (')
    expect(sql).toContain('dispatch_id uuid not null')
    expect(sql).toContain('user_id uuid not null')
    expect(sql).toContain('created_at timestamptz not null default now()')
  })

  it('both FKs cascade on delete — a deleted Dispatch or account never leaves an orphaned mark', () => {
    const start = sql.indexOf('create table public.dispatch_worth_reading')
    const end = sql.indexOf('alter table public.dispatch_worth_reading enable row level security')
    const tableBody = sql.slice(start, end)
    expect(tableBody).toContain('references public.dispatches(id)')
    expect(tableBody).toContain('references auth.users(id)')
    const cascadeCount = (tableBody.match(/on delete cascade/g) ?? []).length
    expect(cascadeCount).toBe(2)
  })

  it('has a composite primary key on (dispatch_id, user_id) — one mark per member per Dispatch', () => {
    expect(sql).toContain('primary key (dispatch_id, user_id)')
  })

  it('never adds a denormalized count/score column — Worth Reading has no public number anywhere', () => {
    // Deliberately scoped (not a bare "count"/"score" substring check) —
    // "current_account_status()" legitimately contains "count" as a
    // substring, which would otherwise falsely trip a broader check.
    expect(executableSql).not.toContain('worth_reading_count')
    expect(executableSql).not.toContain('score')
  })
})

describe('worth reading migration source — RLS and grants', () => {
  it('enables RLS and adds an own-rows-only SELECT policy', () => {
    expect(sql).toContain('alter table public.dispatch_worth_reading enable row level security')
    expect(sql).toContain('create policy dispatch_worth_reading_own')
    expect(sql).toContain('on public.dispatch_worth_reading')
    expect(sql).toContain('for select')
    expect(sql).toContain('to authenticated')
    expect(sql).toContain('using (auth.uid() = user_id)')
  })

  it('grants SELECT only — every mutation is RPC-only from day one', () => {
    const start = sql.indexOf('create policy dispatch_worth_reading_own')
    const end = sql.indexOf('SET_DISPATCH_WORTH_READING', start)
    const grantSection = sql.slice(start, end)
    expect(grantSection).toContain('revoke all on public.dispatch_worth_reading from public')
    expect(grantSection).toContain('grant select on public.dispatch_worth_reading to authenticated')
    // Comment-stripped, so the negative check below isn't tripped up by
    // this section's own doc comment explaining the absence.
    const executableGrantSection = grantSection
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('--'))
      .join('\n')
    expect(executableGrantSection).not.toContain('insert')
    expect(executableGrantSection).not.toContain('update')
    expect(executableGrantSection).not.toContain('delete')
  })

  it('FINAL SECURITY/HARDENING PATCH, correction D: the table revoke names PUBLIC, anon, AND authenticated explicitly', () => {
    expect(sql).toContain('revoke all on public.dispatch_worth_reading from public, anon, authenticated')
  })
})

describe('worth reading migration source — set_dispatch_worth_reading', () => {
  const fnStart = sql.indexOf('create or replace function public.set_dispatch_worth_reading')
  // Tightened to end right before the unrelated block_user reproduction
  // section (piece 3), rather than at the file's single trailing
  // `commit;` — otherwise fnSource would also contain block_user's own
  // body, which every check below assumes it does not.
  const fnEnd = sql.indexOf('3. BLOCK_USER', fnStart)
  const fnSource = sql.slice(fnStart, fnEnd)

  it('is SECURITY DEFINER with a safe search_path', () => {
    expect(fnSource).toContain('security definer')
    expect(fnSource).toContain("set search_path to 'pg_catalog'")
  })

  it('requires authentication before anything else', () => {
    const authIndex = fnSource.indexOf('auth.uid() is null')
    const falseBranchIndex = fnSource.indexOf('p_worth_reading = false')
    expect(authIndex).toBeGreaterThan(-1)
    expect(falseBranchIndex).toBeGreaterThan(authIndex)
  })

  it('the false (undo) branch runs BEFORE the account-status gate — de-escalating, always available', () => {
    const falseBranchIndex = fnSource.indexOf('p_worth_reading = false')
    const accountStatusIndex = fnSource.indexOf('current_account_status()')
    expect(falseBranchIndex).toBeGreaterThan(-1)
    expect(accountStatusIndex).toBeGreaterThan(falseBranchIndex)
  })

  it('the false branch deletes only the caller\'s own row and returns early', () => {
    const falseBranchStart = fnSource.indexOf('p_worth_reading = false')
    const falseBranchEnd = fnSource.indexOf('end if;', falseBranchStart)
    const falseBranch = fnSource.slice(falseBranchStart, falseBranchEnd)
    expect(falseBranch).toContain('delete from public.dispatch_worth_reading')
    expect(falseBranch).toContain('where dispatch_id = p_dispatch_id')
    expect(falseBranch).toContain('and user_id = auth.uid()')
    expect(falseBranch).toContain('return;')
  })

  it('the true branch checks account status, restricted/suspended/banned rejected', () => {
    expect(fnSource).toContain('public.current_account_status() in')
    expect(fnSource).toContain("'restricted', 'suspended', 'banned'")
  })

  it('requires the Dispatch to be currently published and moderator-visible', () => {
    expect(fnSource).toContain("v_dispatch.status <> 'published' or v_dispatch.moderation_status <> 'visible'")
  })

  it('rejects marking one\'s own Dispatch', () => {
    expect(fnSource).toContain('v_dispatch.author_id = auth.uid()')
    expect(fnSource).toContain('cannot mark your own Dispatch worth reading')
  })

  it('uses is_blocked_pair (full-scope only) — never is_correspondence_blocked_pair', () => {
    expect(fnSource).toContain('tempa_private.is_blocked_pair(auth.uid(), v_dispatch.author_id)')
    expect(fnSource).not.toContain('is_correspondence_blocked_pair')
  })

  it('checks the Dispatch author\'s own public visibility (suspended/banned excluded)', () => {
    expect(fnSource).toContain('tempa_private.author_content_publicly_visible(v_dispatch.author_id)')
  })

  it('inserts idempotently via ON CONFLICT DO NOTHING on the primary key', () => {
    expect(fnSource).toContain('insert into public.dispatch_worth_reading (dispatch_id, user_id)')
    expect(fnSource).toContain('on conflict (dispatch_id, user_id) do nothing')
  })

  it('revokes all then grants execute to authenticated only', () => {
    const start = fnSource.indexOf('$function$;')
    const grantSection = fnSource.slice(start)
    expect(grantSection).toContain('revoke all on function public.set_dispatch_worth_reading(uuid, boolean) from public')
    expect(grantSection).toContain('grant execute on function public.set_dispatch_worth_reading(uuid, boolean) to authenticated')
  })

  it('FINAL SECURITY/HARDENING PATCH, correction D: the function revoke names PUBLIC, anon, AND authenticated explicitly', () => {
    expect(fnSource).toContain(
      'revoke all on function public.set_dispatch_worth_reading(uuid, boolean) from public, anon, authenticated'
    )
  })

  it('FINAL SECURITY/HARDENING PATCH, correction A: NULL p_worth_reading is explicitly rejected', () => {
    expect(fnSource).toContain('if p_worth_reading is null then')
    expect(fnSource).toContain('Worth Reading state is required.')
  })

  it('correction A: the NULL check runs BEFORE the false-branch check, so NULL can never fall through to either branch unrejected', () => {
    const nullCheckIndex = fnSource.indexOf('p_worth_reading is null')
    const falseBranchIndex = fnSource.indexOf('p_worth_reading = false')
    expect(nullCheckIndex).toBeGreaterThan(-1)
    expect(falseBranchIndex).toBeGreaterThan(nullCheckIndex)
  })

  it('correction A: the NULL check runs BEFORE the auth check\'s own end and BEFORE the true-branch INSERT', () => {
    const authCheckIndex = fnSource.indexOf('auth.uid() is null')
    const nullCheckIndex = fnSource.indexOf('p_worth_reading is null')
    const insertIndex = fnSource.indexOf('insert into public.dispatch_worth_reading')
    expect(authCheckIndex).toBeGreaterThan(-1)
    expect(nullCheckIndex).toBeGreaterThan(authCheckIndex)
    expect(insertIndex).toBeGreaterThan(nullCheckIndex)
  })

  it('FINAL SECURITY/HARDENING PATCH, correction C: the true branch\'s Dispatch SELECT takes FOR SHARE', () => {
    const start = fnSource.indexOf('select id, author_id, status, moderation_status')
    const end = fnSource.indexOf('if v_dispatch.id is null', start)
    const dispatchSelect = fnSource.slice(start, end)
    expect(dispatchSelect).toContain('from public.dispatches')
    expect(dispatchSelect).toContain('where id = p_dispatch_id')
    expect(dispatchSelect).toContain('for share')
  })

  it('correction C: the FOR SHARE lock is taken AFTER the account-status gate and BEFORE the eligibility checks that depend on it', () => {
    const accountStatusIndex = fnSource.indexOf('current_account_status()')
    const forShareIndex = fnSource.indexOf('for share')
    const publishedCheckIndex = fnSource.indexOf("v_dispatch.status <> 'published'")
    expect(accountStatusIndex).toBeGreaterThan(-1)
    expect(forShareIndex).toBeGreaterThan(accountStatusIndex)
    expect(publishedCheckIndex).toBeGreaterThan(forShareIndex)
  })

  it('FINAL CONCURRENCY FIX: pair-locks the caller\'s and Dispatch author\'s profiles rows, SHARE mode, in deterministic ascending-uuid order (both if/else orderings present)', () => {
    expect(fnSource).toContain('if auth.uid() < v_dispatch.author_id then')
    const ifBranchStart = fnSource.indexOf('if auth.uid() < v_dispatch.author_id then')
    const elseIndex = fnSource.indexOf('else', ifBranchStart)
    const ifBranch = fnSource.slice(ifBranchStart, elseIndex)
    expect(ifBranch).toContain('from public.profiles where id = auth.uid() for share')
    expect(ifBranch).toContain('from public.profiles where id = v_dispatch.author_id for share')
    const endIfIndex = fnSource.indexOf('end if;', elseIndex)
    const elseBranch = fnSource.slice(elseIndex, endIfIndex)
    // Reversed order in the else branch — proves the ordering is by
    // absolute uuid comparison, not "caller always first."
    expect(elseBranch).toContain('from public.profiles where id = v_dispatch.author_id for share')
    expect(elseBranch).toContain('from public.profiles where id = auth.uid() for share')
    const authFirstIndexInElse = elseBranch.indexOf('id = auth.uid() for share')
    const authorFirstIndexInElse = elseBranch.indexOf('id = v_dispatch.author_id for share')
    expect(authorFirstIndexInElse).toBeGreaterThan(-1)
    expect(authFirstIndexInElse).toBeGreaterThan(authorFirstIndexInElse)
  })

  it('the pair lock is taken AFTER the own-Dispatch rejection and BEFORE is_blocked_pair — closing the race against a concurrent full block', () => {
    const ownDispatchIndex = fnSource.indexOf('v_dispatch.author_id = auth.uid()')
    const pairLockIndex = fnSource.indexOf('if auth.uid() < v_dispatch.author_id then')
    const blockCheckIndex = fnSource.indexOf('tempa_private.is_blocked_pair(auth.uid(), v_dispatch.author_id)')
    expect(ownDispatchIndex).toBeGreaterThan(-1)
    expect(pairLockIndex).toBeGreaterThan(ownDispatchIndex)
    expect(blockCheckIndex).toBeGreaterThan(pairLockIndex)
  })

  it('never locks the same profiles row twice — the pair lock relies on auth.uid() <> v_dispatch.author_id, already guaranteed by the own-Dispatch rejection above it', () => {
    // Structural proof: the own-Dispatch rejection (which raises before
    // any lock is taken) is the ONLY guard between the Dispatch load and
    // the pair lock — re-verified by the ordering test above; this test
    // additionally proves no OTHER path can reach the pair lock with
    // auth.uid() = v_dispatch.author_id.
    const ownDispatchStart = fnSource.indexOf('if v_dispatch.author_id = auth.uid() then')
    const ownDispatchEnd = fnSource.indexOf('end if;', ownDispatchStart)
    const pairLockStart = fnSource.indexOf('if auth.uid() < v_dispatch.author_id then')
    expect(ownDispatchStart).toBeGreaterThan(-1)
    expect(pairLockStart).toBeGreaterThan(ownDispatchEnd)
  })
})

describe('worth reading migration source — block_user reproduction (piece 3)', () => {
  const fnStart = sql.indexOf('create or replace function public.block_user(p_blocked_id uuid, p_scope text)')
  const fnEnd = sql.indexOf('commit;', fnStart)
  const fnSource = sql.slice(fnStart, fnEnd)

  it('reproduces the exact two-argument signature, SECURITY DEFINER, safe search_path', () => {
    expect(fnStart).toBeGreaterThan(-1)
    expect(fnSource).toContain('security definer')
    expect(fnSource).toContain("set search_path to 'pg_catalog'")
  })

  it('the one-argument legacy wrapper block_user(uuid) is NOT reproduced in this migration', () => {
    expect(sql).not.toContain('create or replace function public.block_user(p_blocked_id uuid)')
  })

  it('preserves every pre-existing validation line unchanged (auth, NULL/allow-list scope, self-block, member existence, upsert)', () => {
    expect(fnSource).toContain("if p_scope is null then")
    expect(fnSource).toContain("raise exception 'Unknown block scope.';")
    expect(fnSource).toContain("if p_scope not in ('letters', 'full') then")
    expect(fnSource).toContain("raise exception 'You cannot block yourself.';")
    expect(fnSource).toContain('if not exists (select 1 from public.profiles where id = p_blocked_id) then')
    expect(fnSource).toContain('insert into public.blocked_users (blocker_id, blocked_id, scope)')
    expect(fnSource).toContain('on conflict (blocker_id, blocked_id) do update')
  })

  it('preserves the existing Keep (kept_minds) full-block cascade unchanged', () => {
    expect(fnSource).toContain('delete from public.kept_minds')
    expect(fnSource).toContain('where (viewer_user_id = auth.uid() and kept_user_id = p_blocked_id)')
    expect(fnSource).toContain('or (viewer_user_id = p_blocked_id and kept_user_id = auth.uid())')
  })

  it('adds the new dispatch_worth_reading cleanup, both directions, inside the SAME `if p_scope = \'full\' then` branch as the Keep cascade', () => {
    const fullBranchStart = fnSource.indexOf("if p_scope = 'full' then")
    const fullBranchEnd = fnSource.indexOf('end if;', fullBranchStart)
    const fullBranch = fnSource.slice(fullBranchStart, fullBranchEnd)
    expect(fullBranch).toContain('delete from public.kept_minds')
    expect(fullBranch).toContain('delete from public.dispatch_worth_reading')
    expect(fullBranch).toContain('user_id = auth.uid()')
    expect(fullBranch).toContain('dispatch_id in (select id from public.dispatches where author_id = p_blocked_id)')
    expect(fullBranch).toContain('user_id = p_blocked_id')
    expect(fullBranch).toContain('dispatch_id in (select id from public.dispatches where author_id = auth.uid())')
  })

  it('the dispatch_worth_reading DELETE occurs exactly once in this function — no second, letters-reachable copy', () => {
    const occurrences = (fnSource.match(/delete from public\.dispatch_worth_reading/g) ?? []).length
    expect(occurrences).toBe(1)
  })

  it('the dispatch_worth_reading DELETE occurs strictly AFTER the full-branch guard opens', () => {
    const guardIndex = fnSource.indexOf("if p_scope = 'full' then")
    const deleteIndex = fnSource.indexOf('delete from public.dispatch_worth_reading')
    expect(guardIndex).toBeGreaterThan(-1)
    expect(deleteIndex).toBeGreaterThan(guardIndex)
  })

  it('never touches dispatch_worth_reading for a letters-only scope — the delete is unreachable outside the full branch', () => {
    // The ENTIRE function body's EXECUTABLE code (comments stripped —
    // the FINAL CONCURRENCY FIX pair-lock comment legitimately names the
    // sibling function "set_dispatch_worth_reading" as prose, which
    // contains the table name "dispatch_worth_reading" as a substring;
    // same comment-vs-code pitfall this codebase has hit repeatedly,
    // same fix as elsewhere: strip comment lines first) outside the
    // full-branch's own if/end-if window must not mention
    // dispatch_worth_reading at all.
    const fullBranchStart = fnSource.indexOf("if p_scope = 'full' then")
    const fullBranchEnd = fnSource.indexOf('end if;', fullBranchStart) + 'end if;'.length
    const outsideFullBranch = fnSource.slice(0, fullBranchStart) + fnSource.slice(fullBranchEnd)
    const executableOutsideFullBranch = outsideFullBranch
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('--'))
      .join('\n')
    expect(executableOutsideFullBranch).not.toContain('dispatch_worth_reading')
  })

  it('reissues explicit grants naming PUBLIC, anon, AND authenticated for the two-argument signature', () => {
    const start = fnSource.indexOf('$function$;')
    const grantSection = fnSource.slice(start)
    expect(grantSection).toContain('revoke all on function public.block_user(uuid, text) from public, anon, authenticated')
    expect(grantSection).toContain('grant execute on function public.block_user(uuid, text) to authenticated')
  })

  it('FINAL CONCURRENCY FIX: pair-locks the caller\'s and p_blocked_id\'s profiles rows, UPDATE mode, in the SAME deterministic ascending-uuid order (both if/else orderings present)', () => {
    expect(fnSource).toContain('if auth.uid() < p_blocked_id then')
    const ifBranchStart = fnSource.indexOf('if auth.uid() < p_blocked_id then')
    const elseIndex = fnSource.indexOf('else', ifBranchStart)
    const ifBranch = fnSource.slice(ifBranchStart, elseIndex)
    expect(ifBranch).toContain('from public.profiles where id = auth.uid() for update')
    expect(ifBranch).toContain('from public.profiles where id = p_blocked_id for update')
    const endIfIndex = fnSource.indexOf('end if;', elseIndex)
    const elseBranch = fnSource.slice(elseIndex, endIfIndex)
    expect(elseBranch).toContain('from public.profiles where id = p_blocked_id for update')
    expect(elseBranch).toContain('from public.profiles where id = auth.uid() for update')
    const authIndexInElse = elseBranch.indexOf('id = auth.uid() for update')
    const blockedIndexInElse = elseBranch.indexOf('id = p_blocked_id for update')
    expect(blockedIndexInElse).toBeGreaterThan(-1)
    expect(authIndexInElse).toBeGreaterThan(blockedIndexInElse)
  })

  it('uses UPDATE mode, never SHARE, since this function is about to WRITE blocked_users', () => {
    const ifBranchStart = fnSource.indexOf('if auth.uid() < p_blocked_id then')
    const endIfIndex = fnSource.indexOf('end if;', ifBranchStart)
    const pairLockBlock = fnSource.slice(ifBranchStart, endIfIndex)
    expect(pairLockBlock).not.toContain('for share')
    expect((pairLockBlock.match(/for update/g) ?? []).length).toBe(4)
  })

  it('the pair lock is taken AFTER member-existence validation and BEFORE the blocked_users upsert', () => {
    const memberExistsIndex = fnSource.indexOf(
      'if not exists (select 1 from public.profiles where id = p_blocked_id) then'
    )
    const pairLockIndex = fnSource.indexOf('if auth.uid() < p_blocked_id then')
    const upsertIndex = fnSource.indexOf('insert into public.blocked_users (blocker_id, blocked_id, scope)')
    expect(memberExistsIndex).toBeGreaterThan(-1)
    expect(pairLockIndex).toBeGreaterThan(memberExistsIndex)
    expect(upsertIndex).toBeGreaterThan(pairLockIndex)
  })

  it('the pair lock runs for BOTH scopes — it is not itself gated on p_scope', () => {
    const pairLockIndex = fnSource.indexOf('if auth.uid() < p_blocked_id then')
    const fullGuardIndex = fnSource.indexOf("if p_scope = 'full' then")
    expect(pairLockIndex).toBeGreaterThan(-1)
    expect(fullGuardIndex).toBeGreaterThan(pairLockIndex)
  })
})
