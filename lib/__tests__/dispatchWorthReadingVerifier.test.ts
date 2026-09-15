// Board Experience Phase 2C — same source-text-inspection approach as
// dispatchRepliesVerifier.test.ts, since there is no live Postgres to
// run the verifier against here.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const VERIFIER_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-09-24-dispatch-worth-reading-verify.sql')

const sql = readFileSync(VERIFIER_PATH, 'utf8')

describe('worth reading verifier source — read-only', () => {
  it('contains no INSERT, UPDATE, DELETE, or DDL statement anywhere (outside of a read-only ilike/like/position/replace call inspecting the checked function\'s own source text)', () => {
    // "delete from public.dispatch_worth_reading"/"insert into public.
    // dispatch_worth_reading" legitimately appear as STRING ARGUMENTS to
    // ilike/like/position/replace — read-only introspection of
    // set_dispatch_worth_reading's and block_user's own source — never
    // as an executable mutation. Every such line also contains one of
    // those read-only function/operator names, which a genuine
    // executable INSERT/UPDATE/DELETE statement never would. Plain
    // `like` (not `ilike`) is used by the VERIFIER FIX predicates, which
    // compare against an already-lower()-cased, whitespace-normalized
    // expression rather than the raw pretty-printed source.
    const lower = sql.toLowerCase()
    const linesWithMutationText = lower
      .split('\n')
      .filter((line) => /insert into|delete from|update public\./.test(line))
    for (const line of linesWithMutationText) {
      const isReadOnlyIntrospection = /\bi?like\b|\bposition\s*\(|\breplace\s*\(|\blength\s*\(/.test(line)
      expect(isReadOnlyIntrospection).toBe(true)
    }
    expect(lower).not.toContain('create table')
    expect(lower).not.toContain('alter table')
    expect(lower).not.toContain('drop table')
    expect(lower).not.toContain('create policy')
    expect(lower).not.toContain('drop policy')
  })

  it('every non-comment, non-blank line is a read-only construct, never a mutation keyword', () => {
    const codeLines = sql
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('--'))
    const mutationKeywords = /^(insert|update|delete|drop|alter|create(?!\s+or\s+replace\s+function)|truncate|grant|revoke)\b/i
    const offending = codeLines.filter((line) => mutationKeywords.test(line))
    expect(offending).toEqual([])
  })
})

describe('worth reading verifier source — one-row guarantee', () => {
  it('every CTE is driven off a fixed anchor/VALUES list, not a bare catalog scan that could return zero rows', () => {
    // Same convention as the Reply verifier: `from (select 1 as anchor)
    // _anchor left join ...` or a fixed `from (values (...)) as x` — never
    // a plain `from pg_class`/`from pg_proc` FROM clause that could
    // silently return zero rows when the checked object is missing.
    expect(sql).toContain('from (select 1 as anchor) _anchor')
    const anchorCount = (sql.match(/from \(select 1 as anchor\) _anchor/g) ?? []).length
    // pk_check, policy_check, function_check, block_user_check — the
    // anchor pattern is used by every left-join-based CTE: four of them.
    expect(anchorCount).toBeGreaterThanOrEqual(4)
  })

  it('every ~*/ilike predicate that could evaluate to NULL (a missing row) is wrapped in coalesce(..., false)', () => {
    const start = sql.indexOf('pk_check as (')
    const end = sql.indexOf('select\n  t.table_exists')
    const body = sql.slice(start, end)
    const coalesceCount = (body.match(/coalesce\(/g) ?? []).length
    const tildeCount = (body.match(/~\*/g) ?? []).length
    const ilikeCount = (body.match(/\bilike\b/g) ?? []).length
    // Not a strict 1:1 (a couple of coalesced predicates use
    // has_function_privilege/position() rather than ~*/ilike), but every
    // ~*/ilike predicate specifically must be inside SOME coalesce(...) —
    // so coalesce( can never be outnumbered by ~*/ilike combined.
    expect(coalesceCount).toBeGreaterThanOrEqual(tildeCount + ilikeCount)
    expect(tildeCount + ilikeCount).toBeGreaterThan(0)
  })

  it('fk_check is driven off a fixed 2-row expected-values relation, not a bare pg_constraint scan', () => {
    const start = sql.indexOf('fk_check as (')
    const end = sql.indexOf('pk_check as (', start)
    const body = sql.slice(start, end)
    expect(body).toContain("('dispatch_worth_reading_dispatch_id_fkey', 'c', 'public.dispatches')")
    expect(body).toContain("('dispatch_worth_reading_user_id_fkey', 'c', 'auth.users')")
    expect(body).toContain('left join pg_constraint actual')
    expect(body).toContain('actual.oid is not null')
    expect(body).not.toContain('::regclass')
  })
})

describe('worth reading verifier source — grant_check', () => {
  const start = sql.indexOf('grant_check as (')
  const end = sql.indexOf('function_check as (', start)
  const body = sql.slice(start, end)

  it('checks authenticated SELECT-only and no INSERT/UPDATE/DELETE', () => {
    expect(body).toContain("has_table_privilege('authenticated', 'public.dispatch_worth_reading', 'SELECT')")
    expect(body).toContain("has_table_privilege('authenticated', 'public.dispatch_worth_reading', 'INSERT')")
    expect(body).toContain("has_table_privilege('authenticated', 'public.dispatch_worth_reading', 'UPDATE')")
    expect(body).toContain("has_table_privilege('authenticated', 'public.dispatch_worth_reading', 'DELETE')")
  })

  it('FINAL SECURITY/HARDENING PATCH: checks anon has none of SELECT/INSERT/UPDATE/DELETE, not merely SELECT', () => {
    expect(body).toContain("has_table_privilege('anon', 'public.dispatch_worth_reading', 'SELECT')")
    expect(body).toContain("has_table_privilege('anon', 'public.dispatch_worth_reading', 'INSERT')")
    expect(body).toContain("has_table_privilege('anon', 'public.dispatch_worth_reading', 'UPDATE')")
    expect(body).toContain("has_table_privilege('anon', 'public.dispatch_worth_reading', 'DELETE')")
    expect(body).toContain('as anon_no_insert')
    expect(body).toContain('as anon_no_update')
    expect(body).toContain('as anon_no_delete')
  })
})

describe('worth reading verifier source — policy_check', () => {
  it('proves the RLS policy exists and is scoped to auth.uid() = user_id', () => {
    const start = sql.indexOf('policy_check as (')
    const end = sql.indexOf('grant_check as (', start)
    const body = sql.slice(start, end)
    expect(body).toContain("pol.polname = 'dispatch_worth_reading_own'")
    expect(body).toContain(String.raw`auth\.uid\(\)\s*=\s*user_id`)
  })

  it('tolerates pg_get_expr formatting variance via a regex, not an exact ilike', () => {
    const start = sql.indexOf('policy_check as (')
    const end = sql.indexOf('grant_check as (', start)
    const body = sql.slice(start, end)
    expect(body).toContain('~*')
  })
})

describe('worth reading verifier source — function_check', () => {
  const start = sql.indexOf('function_check as (')
  const end = sql.indexOf('block_user_check as (', start)
  const body = sql.slice(start, end)

  it('joins pg_proc by the exact oid to_regprocedure resolves for the fixed signature, not merely by proname', () => {
    expect(body).toContain("to_regprocedure('public.set_dispatch_worth_reading(uuid, boolean)')")
    expect(body).toContain('left join pg_proc p')
    expect(body).not.toMatch(/where\s+p\.proname\s*=/i)
  })

  it('checks SECURITY DEFINER, account-status gate, blocking, never the letters-only helper', () => {
    expect(body).toContain('p.prosecdef')
    expect(body).toContain("ilike '%current_account_status()%'")
    expect(body).toContain("ilike '%is_blocked_pair%'")
    expect(body).toContain('is_correspondence_blocked_pair')
  })

  it('FINAL SECURITY/HARDENING PATCH: search_path is introspected from pg_proc.proconfig directly, not text-matched against pretty-printed SQL', () => {
    expect(body).toContain("unnest(p.proconfig)")
    expect(body).toContain("cfg = 'search_path=pg_catalog'")
    expect(body).toContain('as search_path_fixed')
  })

  it('FINAL SECURITY/HARDENING PATCH, correction A: proves NULL p_worth_reading is rejected', () => {
    expect(body).toContain('p_worth_reading is null')
    expect(body).toContain('Worth Reading state is required')
    expect(body).toContain('as rejects_null_worth_reading')
  })

  it('FINAL SECURITY/HARDENING PATCH, correction C: proves the true branch\'s Dispatch SELECT uses FOR SHARE, scoped to that exact SELECT', () => {
    expect(body).toContain('from public.dispatches')
    expect(body).toContain('where id = p_dispatch_id')
    expect(body).toContain('for share')
    expect(body).toContain('as dispatch_select_uses_for_share')
  })

  it('IMPORTANT correction: the false-branch/account-status ordering check requires BOTH positions to be > 0 before comparing them', () => {
    const checkStart = body.indexOf('false_branch_precedes_account_status_gate')
    // Search backward from the "as ..." alias to the coalesce( that
    // wraps this specific predicate, matching how the predicate is
    // actually written (coalesce(<predicate>, false) as <alias>).
    const coalesceStart = body.lastIndexOf('coalesce(', checkStart)
    const predicate = body.slice(coalesceStart, checkStart)
    expect(predicate).toContain("position('p_worth_reading = false' in pg_get_functiondef(p.oid)) > 0")
    expect(predicate).toContain("position('current_account_status()' in pg_get_functiondef(p.oid)) > 0")
    expect(predicate).toContain(
      "position('p_worth_reading = false' in pg_get_functiondef(p.oid))\n        < position('current_account_status()' in pg_get_functiondef(p.oid))"
    )
  })

  it('FINAL CONCURRENCY FIX: proves the shared member-pair lock, SHARE mode, deterministic ascending-uuid order (both if/else orderings)', () => {
    expect(body).toContain('if auth.uid() < v_dispatch.author_id then')
    expect(body).toContain('from public.profiles where id = auth.uid() for share')
    expect(body).toContain('from public.profiles where id = v_dispatch.author_id for share')
    expect(body).toContain('as pair_lock_uses_deterministic_order')
  })

  it('FINAL CONCURRENCY FIX: both positions must be > 0 before comparing, proving the pair lock precedes is_blocked_pair', () => {
    const checkStart = body.indexOf('pair_lock_precedes_is_blocked_pair')
    const coalesceStart = body.lastIndexOf('coalesce(', checkStart)
    const predicate = body.slice(coalesceStart, checkStart)
    // VERIFIER FIX: this predicate is one of the six now evaluated
    // against the whitespace-normalized text (see below), so both
    // position() calls search that normalized expression, not the raw
    // pg_get_functiondef(p.oid) text directly. VERIFIER ROBUSTNESS
    // PATCH: the block-helper search term is now the robust bare token
    // `tempa_private.is_blocked_pair`, not the full exact call with
    // parentheses/arguments.
    expect(predicate).toContain(
      "position('if auth.uid() < v_dispatch.author_id then' in regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', ' ', 'g')) > 0"
    )
    expect(predicate).toContain(
      "position('tempa_private.is_blocked_pair' in regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', ' ', 'g')) > 0"
    )
    expect(predicate).not.toContain("tempa_private.is_blocked_pair(auth.uid(), v_dispatch.author_id)")
  })

  it('checks both authenticated EXECUTE and anon NO EXECUTE', () => {
    expect(body).toContain("has_function_privilege('authenticated', p.oid, 'EXECUTE')")
    expect(body).toContain("not has_function_privilege('anon', p.oid, 'EXECUTE')")
  })
})

describe('worth reading verifier source — block_user_check (new CTE)', () => {
  const start = sql.indexOf('block_user_check as (')
  const end = sql.indexOf('no_scope_creep_check as (', start)
  const body = sql.slice(start, end)

  it('joins pg_proc by the exact oid to_regprocedure resolves for the two-argument signature', () => {
    expect(body).toContain("to_regprocedure('public.block_user(uuid, text)')")
    expect(body).toContain('left join pg_proc p')
    expect(body).not.toMatch(/where\s+p\.proname\s*=/i)
  })

  it('checks SECURITY DEFINER and search_path via proconfig introspection', () => {
    expect(body).toContain('p.prosecdef')
    expect(body).toContain('unnest(p.proconfig)')
    expect(body).toContain("cfg = 'search_path=pg_catalog'")
  })

  it('proof 1: the Worth Reading cleanup is scoped inside the SAME full-branch that already holds the Keep cascade (adjacent-fragment ilike)', () => {
    expect(body).toContain("ilike")
    expect(body).toContain("if p_scope = ''full'' then")
    expect(body).toContain('delete from public.kept_minds')
    expect(body).toContain('delete from public.dispatch_worth_reading')
    expect(body).toContain('as worth_reading_cleanup_inside_full_branch')
  })

  it('proves the both-directions predicate shape', () => {
    // VERIFIER ROBUSTNESS PATCH: no longer requires the exact
    // `dispatch_id in (select id from public.dispatches where author_id
    // = ...)` subquery-wrapper adjacency — just the bare author_id
    // token each direction depends on, in order.
    expect(body).toContain('user_id = auth.uid()')
    expect(body).toContain('author_id = p_blocked_id')
    expect(body).toContain('user_id = p_blocked_id')
    expect(body).toContain('author_id = auth.uid()')
    expect(body).not.toContain('dispatch_id in (select id from public.dispatches where author_id = p_blocked_id)')
    expect(body).toContain('as worth_reading_cleanup_both_directions')
  })

  it('proof 2 (IMPORTANT correction applied here too): both positions must be > 0 before the ordering comparison', () => {
    const checkStart = body.indexOf('worth_reading_cleanup_after_full_guard')
    const coalesceStart = body.lastIndexOf('coalesce(', checkStart)
    const predicate = body.slice(coalesceStart, checkStart)
    expect(predicate).toContain("position('if p_scope = ''full'' then' in pg_get_functiondef(p.oid)) > 0")
    expect(predicate).toContain("position('delete from public.dispatch_worth_reading' in pg_get_functiondef(p.oid)) > 0")
  })

  it('proof 3: proves the dispatch_worth_reading DELETE occurs exactly once (no unconditional/letters-reachable second copy)', () => {
    expect(body).toContain("replace(pg_get_functiondef(p.oid), 'delete from public.dispatch_worth_reading', '')")
    expect(body).toContain('as worth_reading_cleanup_exactly_once')
  })

  it('FINAL CONCURRENCY FIX: proves the SAME shared member-pair lock, UPDATE mode, same deterministic ascending-uuid order', () => {
    expect(body).toContain('if auth.uid() < p_blocked_id then')
    expect(body).toContain('from public.profiles where id = auth.uid() for update')
    expect(body).toContain('from public.profiles where id = p_blocked_id for update')
    expect(body).toContain('as pair_lock_uses_deterministic_order')
  })

  it('FINAL CONCURRENCY FIX: both positions must be > 0 before comparing, proving the pair lock precedes the blocked_users upsert', () => {
    const checkStart = body.indexOf('pair_lock_precedes_blocked_users_upsert')
    const coalesceStart = body.lastIndexOf('coalesce(', checkStart)
    const predicate = body.slice(coalesceStart, checkStart)
    expect(predicate).toContain("position('if auth.uid() < p_blocked_id then' in pg_get_functiondef(p.oid)) > 0")
    expect(predicate).toContain("position('insert into public.blocked_users' in pg_get_functiondef(p.oid)) > 0")
  })

  it('checks both authenticated EXECUTE and anon NO EXECUTE', () => {
    expect(body).toContain("has_function_privilege('authenticated', p.oid, 'EXECUTE')")
    expect(body).toContain("not has_function_privilege('anon', p.oid, 'EXECUTE')")
  })
})

describe('worth reading verifier source — VERIFIER FIX: whitespace-normalized checks', () => {
  const normalizeCall = "regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', ' ', 'g')"

  it('is applied to requires_published_and_visible (function_check)', () => {
    const start = sql.indexOf('function_check as (')
    const end = sql.indexOf('block_user_check as (', start)
    const body = sql.slice(start, end)
    const checkStart = body.indexOf('as requires_published_and_visible')
    const coalesceStart = body.lastIndexOf('coalesce(', checkStart)
    const predicate = body.slice(coalesceStart, checkStart)
    expect(predicate).toContain(normalizeCall)
    expect(predicate).toContain(
      "%v_dispatch.status <> ''published'' or v_dispatch.moderation_status <> ''visible''%"
    )
  })

  it('is applied to checks_author_public_visibility (function_check)', () => {
    const start = sql.indexOf('function_check as (')
    const end = sql.indexOf('block_user_check as (', start)
    const body = sql.slice(start, end)
    const checkStart = body.indexOf('as checks_author_public_visibility')
    const coalesceStart = body.lastIndexOf('coalesce(', checkStart)
    const predicate = body.slice(coalesceStart, checkStart)
    expect(predicate).toContain(normalizeCall)
    // VERIFIER ROBUSTNESS PATCH: no longer requires exact call adjacency
    // (`author_content_publicly_visible(v_dispatch.author_id)`) — just
    // both tokens present, in order, joined by a wildcard.
    expect(predicate).toContain('%author_content_publicly_visible%v_dispatch.author_id%')
    expect(predicate).not.toContain('author_content_publicly_visible(v_dispatch.author_id)')
  })

  it('is applied to function_check.pair_lock_uses_deterministic_order (the diagnostic\'s "set_pair_lock_deterministic")', () => {
    const start = sql.indexOf('function_check as (')
    const end = sql.indexOf('block_user_check as (', start)
    const body = sql.slice(start, end)
    const checkStart = body.indexOf('as pair_lock_uses_deterministic_order')
    const coalesceStart = body.lastIndexOf('coalesce(', checkStart)
    const predicate = body.slice(coalesceStart, checkStart)
    expect(predicate).toContain(normalizeCall)
    expect(predicate).toContain('if auth.uid() < v_dispatch.author_id then')
  })

  it('is applied to function_check.pair_lock_precedes_is_blocked_pair (the diagnostic\'s "set_pair_lock_precedes_block_check")', () => {
    const start = sql.indexOf('function_check as (')
    const end = sql.indexOf('block_user_check as (', start)
    const body = sql.slice(start, end)
    const checkStart = body.indexOf('as pair_lock_precedes_is_blocked_pair')
    const coalesceStart = body.lastIndexOf('coalesce(', checkStart)
    const predicate = body.slice(coalesceStart, checkStart)
    // Every position() call inside this predicate must search the
    // normalized expression — count matches the number of position(
    // calls (4: two "> 0" existence checks plus two operands of the
    // ordering comparison), never a mix of normalized and raw.
    const positionCount = (predicate.match(/position\(/g) ?? []).length
    const normalizeCount = (predicate.match(/regexp_replace\(lower\(pg_get_functiondef\(p\.oid\)\), '\[\[:space:\]\]\+', ' ', 'g'\)/g) ?? [])
      .length
    expect(positionCount).toBe(4)
    expect(normalizeCount).toBe(positionCount)
  })

  it('is applied to block_user_check.worth_reading_cleanup_both_directions', () => {
    const start = sql.indexOf('block_user_check as (')
    const end = sql.indexOf('no_scope_creep_check as (', start)
    const body = sql.slice(start, end)
    const checkStart = body.indexOf('as worth_reading_cleanup_both_directions')
    const coalesceStart = body.lastIndexOf('coalesce(', checkStart)
    const predicate = body.slice(coalesceStart, checkStart)
    expect(predicate).toContain(normalizeCall)
    expect(predicate).toContain('author_id = p_blocked_id')
    expect(predicate).not.toContain('dispatch_id in (select id from public.dispatches where author_id = p_blocked_id)')
  })

  it('is applied to block_user_check.pair_lock_uses_deterministic_order (the diagnostic\'s "block_pair_lock_deterministic")', () => {
    const start = sql.indexOf('block_user_check as (')
    const end = sql.indexOf('no_scope_creep_check as (', start)
    const body = sql.slice(start, end)
    const checkStart = body.indexOf('as pair_lock_uses_deterministic_order')
    const coalesceStart = body.lastIndexOf('coalesce(', checkStart)
    const predicate = body.slice(coalesceStart, checkStart)
    expect(predicate).toContain(normalizeCall)
    expect(predicate).toContain('if auth.uid() < p_blocked_id then')
  })

  it('every other text-based check is UNCHANGED — still evaluated against the raw pg_get_functiondef(p.oid), never normalized', () => {
    // The diagnostic confirmed these already pass live; touching them
    // would be scope creep beyond the six named failures.
    const start = sql.indexOf('function_check as (')
    const blockUserStart = sql.indexOf('block_user_check as (', start)
    const noScopeCreepStart = sql.indexOf('no_scope_creep_check as (', blockUserStart)
    const combined = sql.slice(start, noScopeCreepStart)
    for (const untouchedAlias of [
      'as checks_account_status',
      'as checks_blocking',
      'as never_uses_letters_only_helper',
      'as rejects_own_dispatch',
      'as inserts_idempotently',
      'as false_branch_deletes_only_own_row',
      'as rejects_null_worth_reading',
      'as dispatch_select_uses_for_share',
      'as false_branch_precedes_account_status_gate',
      'as worth_reading_cleanup_inside_full_branch',
      'as worth_reading_cleanup_after_full_guard',
      'as worth_reading_cleanup_exactly_once',
      'as pair_lock_precedes_blocked_users_upsert',
    ]) {
      const checkStart = combined.indexOf(untouchedAlias)
      expect(checkStart).toBeGreaterThan(-1)
      const coalesceStart = combined.lastIndexOf('coalesce(', checkStart)
      const predicate = combined.slice(coalesceStart, checkStart)
      expect(predicate).not.toContain('regexp_replace')
    }
  })
})

describe('worth reading verifier source — VERIFIER ROBUSTNESS PATCH: structure/order over punctuation adjacency', () => {
  it('checks_author_public_visibility proves author_content_publicly_visible and v_dispatch.author_id, in order, via the whitespace-normalized text', () => {
    const start = sql.indexOf('function_check as (')
    const end = sql.indexOf('block_user_check as (', start)
    const body = sql.slice(start, end)
    const checkStart = body.indexOf('as checks_author_public_visibility')
    const coalesceStart = body.lastIndexOf('coalesce(', checkStart)
    const predicate = body.slice(coalesceStart, checkStart)
    expect(predicate).toContain("regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', ' ', 'g')")
    const likeIndex = predicate.indexOf('like')
    const pattern = predicate.slice(likeIndex)
    const authorHelperIndex = pattern.indexOf('author_content_publicly_visible')
    const argumentIndex = pattern.indexOf('v_dispatch.author_id')
    expect(authorHelperIndex).toBeGreaterThan(-1)
    expect(argumentIndex).toBeGreaterThan(authorHelperIndex)
    // No exact call adjacency required — the pattern between the two
    // tokens is a wildcard, never a literal `(`.
    expect(pattern.slice(authorHelperIndex, argumentIndex)).not.toContain('(')
  })

  it('pair_lock_precedes_is_blocked_pair proves the pair-lock guard, the bare is_blocked_pair token, and their order — never the full parenthesized call', () => {
    const start = sql.indexOf('function_check as (')
    const end = sql.indexOf('block_user_check as (', start)
    const body = sql.slice(start, end)
    const checkStart = body.indexOf('as pair_lock_precedes_is_blocked_pair')
    const coalesceStart = body.lastIndexOf('coalesce(', checkStart)
    const predicate = body.slice(coalesceStart, checkStart)
    expect(predicate).toContain("position('if auth.uid() < v_dispatch.author_id then'")
    expect(predicate).toContain("position('tempa_private.is_blocked_pair'")
    expect(predicate).not.toContain("'tempa_private.is_blocked_pair('")
    expect(predicate).not.toContain('v_dispatch.author_id)\'')
  })

  it('worth_reading_cleanup_both_directions proves the five expected tokens in order, tolerant of the subquery wrapper around author_id', () => {
    const start = sql.indexOf('block_user_check as (')
    const end = sql.indexOf('no_scope_creep_check as (', start)
    const body = sql.slice(start, end)
    const checkStart = body.indexOf('as worth_reading_cleanup_both_directions')
    const coalesceStart = body.lastIndexOf('coalesce(', checkStart)
    const predicate = body.slice(coalesceStart, checkStart)
    const likeIndex = predicate.indexOf('like')
    const pattern = predicate.slice(likeIndex)
    const expectedTokensInOrder = [
      'delete from public.dispatch_worth_reading',
      'user_id = auth.uid()',
      'author_id = p_blocked_id',
      'user_id = p_blocked_id',
      'author_id = auth.uid()',
    ]
    let cursor = -1
    for (const token of expectedTokensInOrder) {
      const found = pattern.indexOf(token, cursor + 1)
      expect(found).toBeGreaterThan(cursor)
      cursor = found
    }
    // Never requires the exact subquery-wrapper punctuation.
    expect(pattern).not.toContain('dispatch_id in (select id from public.dispatches where')
  })
})

describe('worth reading verifier source — summary guarantees exactly one row', () => {
  it('the final SELECT computes overall_pass from every sub-check, and every CTE is joined without a WHERE that could drop the row', () => {
    const summaryStart = sql.indexOf('select\n  t.table_exists')
    const summaryEnd = sql.indexOf('-- ====', summaryStart)
    const summary = sql.slice(summaryStart, summaryEnd)
    expect(summary).toContain('overall_pass')
    expect(summary).toContain(
      'from table_check t, column_check col, fk_check fk, pk_check pk, policy_check pol,'
    )
    expect(summary).toContain('grant_check g, function_check f, block_user_check bu, no_scope_creep_check n')
    expect(summary).not.toMatch(/\nwhere\b/i)
  })

  it('overall_pass depends on every new correction\'s own column — grant_check anon inserts/updates/deletes, function_check search_path/NULL-rejection/FOR SHARE, and every block_user_check column', () => {
    const overallPassStart = sql.indexOf('(\n    t.table_exists')
    const overallPassEnd = sql.indexOf(') as overall_pass')
    const overallPassBody = sql.slice(overallPassStart, overallPassEnd)
    for (const clause of [
      'g.anon_no_insert',
      'g.anon_no_update',
      'g.anon_no_delete',
      'f.search_path_fixed',
      'f.rejects_null_worth_reading',
      'f.dispatch_select_uses_for_share',
      'bu.exact_signature_exists',
      'bu.exists_at_all',
      'bu.is_security_definer',
      'bu.search_path_fixed',
      'bu.worth_reading_cleanup_inside_full_branch',
      'bu.worth_reading_cleanup_both_directions',
      'bu.worth_reading_cleanup_after_full_guard',
      'bu.worth_reading_cleanup_exactly_once',
      'f.pair_lock_uses_deterministic_order',
      'f.pair_lock_precedes_is_blocked_pair',
      'bu.pair_lock_uses_deterministic_order',
      'bu.pair_lock_precedes_blocked_users_upsert',
      'bu.authenticated_exec',
      'bu.anon_no_exec',
    ]) {
      expect(overallPassBody).toContain(clause)
    }
  })
})
