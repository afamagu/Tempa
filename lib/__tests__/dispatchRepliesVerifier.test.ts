// Board Experience Phase 2B — same source-text-inspection approach as
// dispatchRepliesMigration.test.ts/boardFeedVerifier.test.ts, since
// there is no live Postgres to run the verifier against here.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const VERIFIER_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-09-23-dispatch-replies-verify.sql')

const sql = readFileSync(VERIFIER_PATH, 'utf8')

describe('dispatch replies verifier source — read-only', () => {
  it('contains no INSERT, UPDATE, DELETE, or DDL statement anywhere (outside of an ilike pattern searching another function\'s source for that text)', () => {
    // "insert into public.admin_audit_log" legitimately appears as the
    // STRING ARGUMENT to an ilike check (verifying admin_hide_reply's
    // own source contains that phrase) — every such line also contains
    // "ilike", which a genuine executable INSERT statement never would.
    const lower = sql.toLowerCase()
    const linesWithMutationText = lower
      .split('\n')
      .filter((line) => /insert into|delete from|update public\./.test(line))
    for (const line of linesWithMutationText) {
      expect(line).toContain('ilike')
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

// ============================================================
// Final verifier hardening pass — weakness A: fk_check must prove
// existence of ALL five expected FKs, not merely bool_and() over
// whichever FK rows already happen to exist.
// ============================================================
describe('dispatch replies verifier source — fk_check hardening (weakness A)', () => {
  it('is driven off a fixed 5-row expected-values relation, not a bare pg_constraint scan', () => {
    const start = sql.indexOf('fk_check as (')
    const end = sql.indexOf('),\nconstraint_check', start)
    const body = sql.slice(start, end)
    expect(body).toContain("('dispatch_replies_dispatch_id_fkey', 'a', 'public.dispatches')")
    expect(body).toContain("('dispatch_replies_author_id_fkey', 'c', 'auth.users')")
    expect(body).toContain("('dispatch_replies_parent_reply_id_fkey', 'n', 'public.dispatch_replies')")
    expect(body).toContain("('dispatch_replies_root_reply_id_fkey', 'n', 'public.dispatch_replies')")
    expect(body).toContain("('dispatch_replies_reply_to_user_id_fkey', 'n', 'auth.users')")
    expect(body).toContain('left join pg_constraint actual')
  })

  it('proves each FK actually exists (actual.oid is not null), not merely that its confdeltype matches IF a row happens to exist', () => {
    const start = sql.indexOf('fk_check as (')
    const end = sql.indexOf('),\nconstraint_check', start)
    const body = sql.slice(start, end)
    expect(body).toContain('actual.oid is not null')
    expect(body).toContain('actual.confdeltype = expected.expected_deltype')
  })

  it('also verifies each FK\'s target table (confrelid), where practical', () => {
    const start = sql.indexOf('fk_check as (')
    const end = sql.indexOf('),\nconstraint_check', start)
    const body = sql.slice(start, end)
    expect(body).toContain('actual.confrelid = to_regclass(expected.expected_target)')
  })

  it('uses the null-safe to_regclass rather than a hard-erroring ::regclass cast', () => {
    const start = sql.indexOf('fk_check as (')
    const end = sql.indexOf('),\nconstraint_check', start)
    const body = sql.slice(start, end)
    expect(body).not.toContain('::regclass')
    expect(body).toContain("to_regclass('public.dispatch_replies')")
  })
})

// ============================================================
// Weakness B — every CTE must be guaranteed to return exactly one row,
// even when the object it checks for is entirely missing, so the final
// summary query never silently returns zero rows.
// ============================================================
describe('dispatch replies verifier source — one-row guarantee (weakness B)', () => {
  const oneRowAnchoredCtes = [
    'delete_dispatch_reply_guard_check',
    'create_reply_check',
    'delete_reply_check',
    'admin_hide_reply_check',
    'admin_restore_reply_check',
    'reports_target_type_check',
    'report_content_check',
  ]

  it.each(oneRowAnchoredCtes)('%s is driven off a one-row anchor LEFT JOIN, not a bare catalog scan that could return zero rows', (cteName) => {
    const start = sql.indexOf(`${cteName} as (`)
    expect(start).toBeGreaterThan(-1)
    const end = sql.indexOf('\n),\n', start)
    const body = sql.slice(start, end)
    expect(body).toContain('from (select 1 as anchor) _anchor')
    expect(body).toContain('left join')
  })

  it('policy_check is one-row-safe via its own anchor chain (policy_source -> policy_gate -> policy_gate2 -> policy_check), not a direct catalog scan', () => {
    const sourceStart = sql.indexOf('policy_source as (')
    const sourceEnd = sql.indexOf('),\npolicy_gate as (', sourceStart)
    const sourceBody = sql.slice(sourceStart, sourceEnd)
    expect(sourceBody).toContain('from (select 1 as anchor) _anchor')
    expect(sourceBody).toContain('left join pg_policy pol')

    const checkStart = sql.indexOf('policy_check as (')
    const checkEnd = sql.indexOf('\n),\n', checkStart)
    const checkBody = sql.slice(checkStart, checkEnd)
    // policy_check itself selects FROM policy_gate2 (a plain 1:1
    // transform of policy_gate, itself a 1:1 transform of policy_source)
    // — never re-queries pg_policy directly, so it inherits the anchor's
    // one-row guarantee without needing its own separate anchor.
    expect(checkBody).toContain('from policy_gate2 pg2')
  })

  it('every ilike-derived boolean column in create_reply_check is wrapped in a coalesce(..., false) — one coalesce( per ilike-based check', () => {
    const start = sql.indexOf('create_reply_check as (')
    const end = sql.indexOf('\n),\ndelete_reply_check', start)
    const body = sql.slice(start, end)
    const ilikeCount = (body.match(/ilike/g) ?? []).length
    const coalesceCount = (body.match(/coalesce\(/g) ?? []).length
    // Every ilike-based check in this CTE is coalesce-wrapped; there may
    // be additional coalesce(...) calls for non-ilike checks too (e.g.
    // p.prosecdef), so coalesce count is always >= ilike count here.
    expect(coalesceCount).toBeGreaterThanOrEqual(ilikeCount)
    expect(ilikeCount).toBeGreaterThan(0)
  })

  it('every ~*-derived boolean column in policy_check is wrapped in a coalesce(..., false) — no bare ~* comparison sits directly as a column value', () => {
    const start = sql.indexOf('policy_check as (')
    const end = sql.indexOf('\n),\n', start)
    const body = sql.slice(start, end)
    // Split on "coalesce(" — every fragment AFTER the first must contain
    // its own "~*" before its own "false)" close (i.e. every ~* usage
    // lives inside some coalesce(...) call's own boundaries), and there
    // must be at least one coalesce( at all.
    const coalesceCount = (body.match(/coalesce\(/g) ?? []).length
    expect(coalesceCount).toBeGreaterThan(0)
    // Every "as <column_name>" select-list item that contains "~*"
    // ALSO contains "coalesce(" earlier in that same item.
    const items = body.split(/,\n(?=\s*coalesce|\s*pg2)/)
    const regexItems = items.filter((item) => item.includes('~*'))
    expect(regexItems.length).toBeGreaterThan(0)
    for (const item of regexItems) {
      expect(item).toContain('coalesce(')
    }
  })

  it('table_check, column_check, constraint_check, index_check, no_scope_creep_check were already one-row-safe and remain scalar-exists()/fixed-values-driven', () => {
    for (const cte of ['table_check', 'column_check', 'constraint_check', 'index_check', 'no_scope_creep_check']) {
      expect(sql).toContain(`${cte} as (`)
    }
    expect(sql).toContain("from (values\n      ('id', 'NO')")
    expect(sql).toContain("from unnest(array[\n      'dispatch_replies_dispatch_id_created_at_idx'")
  })

  it('grant_check guards has_table_privilege against a missing table via to_regclass, avoiding a hard error', () => {
    const start = sql.indexOf('grant_check as (')
    const end = sql.indexOf('\n),\n', start)
    const body = sql.slice(start, end)
    expect(body).toContain("case when to_regclass('public.dispatch_replies') is null then false")
  })
})

// ============================================================
// Weakness C — new, tightly-scoped security assertions for Defects 1-3
// (unchanged in shape from the prior pass; the underlying policy_check
// implementation was rewritten under weakness F below, but these column
// names/summary wiring stay the same).
// ============================================================
describe('dispatch replies verifier source — Defect 1 (RLS parent gate) assertions', () => {
  it('proves the parent gate requires published + moderation-visible + not-blocked + publicly-visible, all four individually', () => {
    expect(sql).toContain('parent_requires_published')
    expect(sql).toContain('parent_requires_moderation_visible')
    expect(sql).toContain('parent_checks_author_blocking')
    expect(sql).toContain('parent_checks_author_visibility')
  })

  it('also proves it as one combined boolean requiring all five conditions on the scoped dispatch_gate_text', () => {
    expect(sql).toContain('parent_gate_full_boundary')
    const start = sql.indexOf('as parent_gate_full_boundary')
    const blockStart = sql.lastIndexOf('coalesce(', start)
    const block = sql.slice(blockStart, start)
    expect(block).toContain("pg2.dispatch_gate_text ~* 'dispatches\\s+d\\y'")
    expect(block).toContain("pg2.dispatch_gate_text ~* 'd\\.status\\s*=\\s*''published''(::text)?'")
    expect(block).toContain("pg2.dispatch_gate_text ~* 'd\\.moderation_status\\s*=\\s*''visible''(::text)?'")
    expect(block).toContain('tempa_private\\.is_blocked_pair')
    expect(block).toContain('tempa_private\\.author_content_publicly_visible')
  })

  it('proves there is NO own-author bypass on the parent gate, tolerant of either operand order', () => {
    expect(sql).toContain('no_parent_dispatch_own_author_bypass')
    expect(sql).toContain("'(d\\.author_id\\s*=\\s*auth\\.uid\\(\\)|auth\\.uid\\(\\)\\s*=\\s*d\\.author_id)'")
  })
})

describe('dispatch replies verifier source — Defect 2 (create_reply author-visibility) assertions', () => {
  it('proves the Dispatch author\'s public-visibility check, scoped adjacent to its own blocking check', () => {
    expect(sql).toContain('checks_dispatch_author_public_visibility')
    expect(sql).toContain(
      "'%is_blocked_pair(auth.uid(), v_dispatch.author_id)%or not tempa_private.author_content_publicly_visible(v_dispatch.author_id)%'"
    )
  })

  it('proves the parent Reply author\'s public-visibility check, scoped adjacent to ITS OWN blocking check', () => {
    expect(sql).toContain('checks_parent_author_public_visibility')
    expect(sql).toContain(
      "'%is_blocked_pair(auth.uid(), v_parent.author_id)%or not tempa_private.author_content_publicly_visible(v_parent.author_id)%'"
    )
  })

  it('still proves create_reply never uses the letters-only blocking helper', () => {
    expect(sql).toContain('create_reply_never_uses_letters_only_helper')
  })
})

describe('dispatch replies verifier source — Defect 3 (report_content reply branch) assertions', () => {
  it('proves the reply branch checks the parent Dispatch gate and the Reply-author gate individually', () => {
    expect(sql).toContain('reply_branch_checks_dispatch_gate')
    expect(sql).toContain('reply_branch_checks_reply_author_gate')
  })

  it('also proves it as one long seven-condition adjacent-fragment pattern, scoped to the reply branch\'s own WHERE clause', () => {
    expect(sql).toContain('reply_branch_full_visibility_boundary')
    expect(sql).toContain(
      "'%where r.id = p_target_id%and d.status = ''published''%and d.moderation_status = ''visible''%and not tempa_private.is_blocked_pair(auth.uid(), d.author_id)%and tempa_private.author_content_publicly_visible(d.author_id)%and r.moderation_status = ''visible''%and not tempa_private.is_blocked_pair(auth.uid(), r.author_id)%and tempa_private.author_content_publicly_visible(r.author_id)%'"
    )
  })
})

// ============================================================
// Weakness D — admin_hide_reply/admin_restore_reply full introspection.
// ============================================================
describe('dispatch replies verifier source — admin RPC hardening (weakness D)', () => {
  it.each(['admin_hide_reply_check', 'admin_restore_reply_check'])('%s proves exact signature, SECURITY DEFINER, and both grants', (cteName) => {
    const start = sql.indexOf(`${cteName} as (`)
    const end = sql.indexOf('\n),\n', start)
    const body = sql.slice(start, end)
    expect(body).toContain('exact_signature_exists')
    expect(body).toContain('is_security_definer')
    expect(body).toContain('authenticated_exec')
    expect(body).toContain('anon_no_exec')
  })

  it.each(['admin_hide_reply_check', 'admin_restore_reply_check'])('%s proves the moderator-staff gate and the admin-bypass-or-report-existence gate', (cteName) => {
    const start = sql.indexOf(`${cteName} as (`)
    const end = sql.indexOf('\n),\n', start)
    const body = sql.slice(start, end)
    expect(body).toContain("is_staff(''moderator'')")
    expect(body).toContain('checks_admin_bypass_or_report_existence')
    expect(body).toContain("is_staff(''admin'')")
    expect(body).toContain("where target_type = ''reply'' and target_id = p_reply_id")
  })

  it.each(['admin_hide_reply_check', 'admin_restore_reply_check'])('%s proves the audit-log write', (cteName) => {
    const start = sql.indexOf(`${cteName} as (`)
    const end = sql.indexOf('\n),\n', start)
    const body = sql.slice(start, end)
    expect(body).toContain('writes_audit_log')
    expect(body).toContain('insert into public.admin_audit_log')
  })

  it('admin_hide_reply_check proves the correct hidden transition; admin_restore_reply_check proves the correct visible transition', () => {
    const hideStart = sql.indexOf('admin_hide_reply_check as (')
    const hideEnd = sql.indexOf('\n),\n', hideStart)
    const hideBody = sql.slice(hideStart, hideEnd)
    expect(hideBody).toContain('transitions_to_hidden')
    expect(hideBody).toContain("set moderation_status = ''hidden''")

    const restoreStart = sql.indexOf('admin_restore_reply_check as (')
    const restoreEnd = sql.indexOf('\n),\n', restoreStart)
    const restoreBody = sql.slice(restoreStart, restoreEnd)
    expect(restoreBody).toContain('transitions_to_visible')
    expect(restoreBody).toContain("set moderation_status = ''visible''")
  })
})

// ============================================================
// Final concurrency + verifier robustness pass — weakness F: policy_check
// must not depend on pg_get_expr's exact pretty-printed form.
// ============================================================
describe('dispatch replies verifier source — policy_check pg_get_expr robustness (weakness F)', () => {
  it('resolves the policy source once, then derives dispatch_gate_text and reply_gate_text as separate scoped substrings', () => {
    expect(sql).toContain('policy_source as (')
    expect(sql).toContain('policy_gate as (')
    expect(sql).toContain('policy_gate2 as (')
    expect(sql).toContain('dispatch_gate_text')
    expect(sql).toContain('reply_gate_text')
  })

  it('the dispatch_gate_text extraction pattern is tolerant of arbitrary formatting between "dispatches d" and the closing author_content_publicly_visible(d.author_id) call', () => {
    expect(sql).toContain(
      "'dispatches\\s+d.*?tempa_private\\.author_content_publicly_visible\\s*\\(\\s*d\\.author_id\\s*\\)'"
    )
  })

  it('every string-literal comparison in policy_check tolerates an optional ::text cast', () => {
    const start = sql.indexOf('policy_check as (')
    const end = sql.indexOf('\n),\n', start)
    const body = sql.slice(start, end)
    // Both locked-value comparisons carry the (::text)? tolerance.
    expect(body).toContain("''published''(::text)?")
    expect(body).toContain("''visible''(::text)?")
  })

  it('policy_check uses ~* (regex) throughout, not ilike, for every derived predicate column', () => {
    const start = sql.indexOf('policy_check as (')
    const end = sql.indexOf('\n),\n', start)
    const body = sql.slice(start, end)
    expect(body).not.toContain('ilike')
    expect(body).toContain('~*')
  })

  it('the joins_through_dispatches check tolerates an optional public. schema prefix implicitly (matches "dispatches d" without anchoring on a preceding "public.")', () => {
    expect(sql).toContain("~* 'dispatches\\s+d\\y'")
    // Deliberately does NOT require "public.dispatches" as a literal
    // substring anywhere in policy_check — pg_get_expr may or may not
    // include the schema prefix depending on search_path/version.
    const start = sql.indexOf('policy_check as (')
    const end = sql.indexOf('\n),\n', start)
    const body = sql.slice(start, end)
    expect(body).not.toContain("'%from public.dispatches d%'")
  })

  it('the Reply-own-clause checks (checks_own_moderation, checks_blocking, checks_account_visibility, author_exception_preserved) are scoped to reply_gate_text, never dispatch_gate_text — so they cannot be satisfied by the Dispatch\'s own textually similar d.-qualified conditions', () => {
    const start = sql.indexOf('policy_check as (')
    const end = sql.indexOf('\n),\n', start)
    const body = sql.slice(start, end)
    const ownClauseBlock = body.slice(body.indexOf('checks_own_moderation') - 200, body.indexOf('never_uses_letters_only_helper') + 30)
    expect(ownClauseBlock).toContain('pg2.reply_gate_text')
    expect(ownClauseBlock).not.toContain('pg2.dispatch_gate_text')
  })
})

// ============================================================
// Final concurrency + verifier robustness pass — weakness G: exact
// function-signature joins, and report_content's anon check.
// ============================================================
describe('dispatch replies verifier source — exact function-signature joins (weakness G)', () => {
  const expectedJoins: [string, string][] = [
    ['delete_dispatch_reply_guard_check', "to_regprocedure('public.delete_dispatch(uuid)')"],
    ['create_reply_check', "to_regprocedure('public.create_reply(uuid, text, uuid)')"],
    ['delete_reply_check', "to_regprocedure('public.delete_reply(uuid)')"],
    ['admin_hide_reply_check', "to_regprocedure('public.admin_hide_reply(uuid, text)')"],
    ['admin_restore_reply_check', "to_regprocedure('public.admin_restore_reply(uuid, text)')"],
    ['report_content_check', "to_regprocedure('public.report_content(text, uuid, text, text)')"],
  ]

  it.each(expectedJoins)('%s joins pg_proc on the EXACT oid to_regprocedure resolves, not merely by proname', (cteName, regprocedureCall) => {
    const start = sql.indexOf(`${cteName} as (`)
    const end = sql.indexOf('\n),\n', start)
    const body = sql.slice(start, end)
    expect(body).toContain(`on p.oid = ${regprocedureCall}`)
    expect(body).not.toContain('p.proname =')
  })

  it('every one of the six functions also keeps its own exact_signature_exists flag reported in the summary', () => {
    for (const alias of ['dd', 'cr', 'dr', 'ahr', 'arr', 'rc']) {
      expect(sql).toContain(`${alias}.exact_signature_exists`)
    }
  })

  it('report_content_check additionally proves anon lacks EXECUTE, consistent with every other RPC check', () => {
    const start = sql.indexOf('report_content_check as (')
    const end = sql.indexOf('\n),\n', start)
    const body = sql.slice(start, end)
    expect(body).toContain('anon_no_exec')
    expect(body).toContain("has_function_privilege('anon', p.oid, 'EXECUTE')")
  })

  it('report_content_anon_no_exec is reported in the summary select list and required by overall_pass', () => {
    expect(sql).toContain('rc.anon_no_exec as report_content_anon_no_exec')
    const overallStart = sql.indexOf('as overall_pass')
    const parenStart = sql.lastIndexOf('(', overallStart)
    const overallClause = sql.slice(parenStart, overallStart)
    expect(overallClause).toContain('rc.anon_no_exec')
  })
})

// ============================================================
// Summary query structure — always exactly one row, folding in every
// hardened CTE.
// ============================================================
describe('dispatch replies verifier source — summary query completeness', () => {
  it('the FROM clause cross-joins every CTE, including the two new admin RPC checks', () => {
    const fromStart = sql.lastIndexOf('from table_check t,')
    const fromEnd = sql.indexOf(';', fromStart)
    const fromClause = sql.slice(fromStart, fromEnd)
    expect(fromClause).toContain('admin_hide_reply_check ahr')
    expect(fromClause).toContain('admin_restore_reply_check arr')
    expect(fromClause).toContain('policy_check pol')
    expect(fromClause).toContain('create_reply_check cr')
    expect(fromClause).toContain('delete_dispatch_reply_guard_check dd')
    expect(fromClause).toContain('report_content_check rc')
  })

  it('overall_pass ANDs together every hardened property, including the new Defect 1/2/3, admin-RPC, exact-signature, and report_content-anon columns', () => {
    const overallStart = sql.indexOf('as overall_pass')
    const parenStart = sql.lastIndexOf('(', overallStart)
    const overallClause = sql.slice(parenStart, overallStart)
    expect(overallClause).toContain('pol.parent_gate_full_boundary')
    expect(overallClause).toContain('pol.no_parent_dispatch_own_author_bypass')
    expect(overallClause).toContain('cr.checks_dispatch_author_public_visibility')
    expect(overallClause).toContain('cr.checks_parent_author_public_visibility')
    expect(overallClause).toContain('rc.reply_branch_full_visibility_boundary')
    expect(overallClause).toContain('ahr.checks_admin_bypass_or_report_existence')
    expect(overallClause).toContain('arr.checks_admin_bypass_or_report_existence')
    expect(overallClause).toContain('dd.exact_signature_exists')
    expect(overallClause).toContain('dr.exact_signature_exists')
    expect(overallClause).toContain('rc.exact_signature_exists')
  })

  it('the DETAIL section includes delete_dispatch\'s own full source for manual reading', () => {
    expect(sql).toContain("where n.nspname = 'public' and p.proname = 'delete_dispatch';")
  })

  it('has a live data spot-check for the deletion-compatible body invariant', () => {
    expect(sql).toContain('impossible_deleted_with_body')
    expect(sql).toContain('impossible_active_body_length')
    expect(sql).toContain('from public.dispatch_replies;')
  })
})
