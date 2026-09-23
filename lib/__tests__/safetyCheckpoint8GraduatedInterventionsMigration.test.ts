// Same convention as every earlier Safety checkpoint's own migration
// test — this repository cannot execute Postgres in CI, so every
// requirement that lives purely in SQL (the is_staff gate, the fixed
// three-status intervention allow-list excluding 'warned', the dual
// NULL-safe staleness checks on both the case AND the account status,
// atomicity via reusing admin_set_account_status unmodified, the
// case-specific audit row, and the complete absence of any automatic
// wiring from content/behavioral detection into this new capability)
// is verified directly against the tracked migration source text.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const MIGRATION_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-10-09-safety-checkpoint8-graduated-interventions.sql')
const VERIFY_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-10-09-safety-checkpoint8-graduated-interventions-verify.sql')
const sql = readFileSync(MIGRATION_PATH, 'utf8')
const verifySql = readFileSync(VERIFY_PATH, 'utf8')

function stripLineComments(text: string): string {
  return text.replace(/^\s*--.*$/gm, '')
}
const codeOnly = stripLineComments(sql)

function extractFunctionBody(qualifiedName: string): string {
  const start = sql.indexOf(`create or replace function ${qualifiedName}(`)
  expect(start, `expected to find "${qualifiedName}" defined in ${MIGRATION_PATH}`).toBeGreaterThan(-1)
  const end = sql.indexOf('$function$;', start)
  expect(end, `expected a closing $function$; for "${qualifiedName}"`).toBeGreaterThan(start)
  return sql.slice(start, end)
}

describe('one BEGIN/COMMIT, not yet applied', () => {
  it('wraps everything in exactly one begin/commit and is explicitly marked NOT EXECUTED', () => {
    expect((sql.match(/^begin;/m) ?? []).length).toBe(1)
    expect((sql.match(/^commit;/m) ?? []).length).toBe(1)
    expect(sql).toContain('STATUS: NOT EXECUTED')
  })
})

describe('admin_apply_safety_case_intervention — the one case-aware transactional enforcement path', () => {
  const body = () => extractFunctionBody('public.admin_apply_safety_case_intervention')

  it('checks is_staff() as its own gate', () => {
    expect(body()).toMatch(/if not public\.is_staff\(\) then\s*\n\s*raise exception 'Not authorized\.';/)
  })

  it('requires a real, trimmed, length-bounded reason', () => {
    const b = body()
    expect(b).toContain("raise exception 'A reason is required.';")
    expect(b).toContain('char_length(v_reason) > 500')
  })

  it('accepts only the three graduated intervention statuses — never warned, never review-only statuses', () => {
    const b = body()
    expect(b).toContain("if p_new_status not in ('restricted', 'suspended', 'banned') then")
    expect(b).not.toContain("'warned'")
    expect(b).not.toContain("'open'::text = p_new_status")
    expect(b).not.toContain("'reviewing'::text = p_new_status")
  })

  it('locks and verifies the case row (FOR UPDATE, then its own staleness check), THEN locks and verifies the account_enforcement_state row the same way', () => {
    const b = body()
    const caseLockIndex = b.indexOf('from public.safety_cases')
    const caseStaleCheckIndex = b.indexOf('is distinct from p_expected_case_status')
    const accountLockIndex = b.indexOf('from public.account_enforcement_state')
    const accountStaleCheckIndex = b.indexOf('is distinct from p_expected_account_status')
    expect(caseLockIndex).toBeGreaterThan(-1)
    expect(accountLockIndex).toBeGreaterThan(-1)
    expect(caseLockIndex).toBeLessThan(caseStaleCheckIndex)
    expect(caseStaleCheckIndex).toBeLessThan(accountLockIndex)
    expect(accountLockIndex).toBeLessThan(accountStaleCheckIndex)
    // Both locks are FOR UPDATE, not a plain read.
    const caseSelectBlock = b.slice(caseLockIndex, b.indexOf(';', caseLockIndex))
    const accountSelectBlock = b.slice(accountLockIndex, b.indexOf(';', accountLockIndex))
    expect(caseSelectBlock).toContain('for update')
    expect(accountSelectBlock).toContain('for update')
  })

  it('both staleness checks are NULL-safe (IS DISTINCT FROM), never <>', () => {
    const b = body()
    expect(b).not.toMatch(/v_case\.status\s*<>\s*p_expected_case_status/)
    expect(b).not.toMatch(/v_actual_account_status\s*<>\s*p_expected_account_status/)
  })

  it('only accepts an intervention when the case is currently open or reviewing', () => {
    const b = body()
    expect(b).toContain("if v_case.status not in ('open', 'reviewing') then")
  })

  it('a missing account_enforcement_state row is treated as active, matching current_account_status()\'s own default', () => {
    const b = body()
    expect(b).toContain("v_actual_account_status := coalesce(v_actual_account_status, 'active');")
  })

  it('reuses admin_set_account_status unmodified — never re-implements staff-account protection or status validation', () => {
    const b = body()
    expect(b).toContain('perform public.admin_set_account_status(v_case.subject_user_id, p_new_status, v_reason);')
    expect(b).not.toContain('staff_roles')
    expect(b).not.toContain('Staff accounts must be managed separately')
  })

  it('this migration never redefines admin_set_account_status itself — only calls it, so the ordinary member-workspace path is completely untouched', () => {
    expect(sql).not.toContain('create or replace function public.admin_set_account_status(')
  })

  it('has NO exception handler anywhere in its body — a failure in admin_set_account_status, the case update, or the audit insert must abort the WHOLE transaction, never be swallowed (rollback safety, items 7/12)', () => {
    const b = body()
    // Unlike Checkpoint 5's own deliberately-guarded behavioral-signal
    // calls (a non-essential side effect that must NOT block a real
    // mutation), every effect here IS the real mutation — so there must
    // be no nested BEGIN/EXCEPTION subtransaction anywhere that could
    // catch and swallow a failure instead of letting it abort the whole
    // transaction.
    expect(b).not.toMatch(/exception\s+when\s+others/i)
  })

  it('never deletes anything — the historical case and its signals/evidence are always retained, never rewritten or removed', () => {
    const b = stripLineComments(body())
    expect(b).not.toMatch(/\bdelete\s+from\b/i)
  })

  it('the subject is derived ONLY from the locked case row — there is no separate p_user_id parameter that could ever diverge from it', () => {
    const start = sql.indexOf('create or replace function public.admin_apply_safety_case_intervention(')
    const paramsEnd = sql.indexOf(')\nreturns void', start)
    const params = sql.slice(start, paramsEnd)
    expect(params).not.toMatch(/p_user_id|p_subject_id|p_account_id/)
  })

  it('updates the case to the SAME new_status, sets reviewed_at/reviewed_by, AFTER the account status call succeeds', () => {
    const b = body()
    const accountCallIndex = b.indexOf('perform public.admin_set_account_status(')
    const caseUpdateIndex = b.indexOf('update public.safety_cases')
    expect(accountCallIndex).toBeLessThan(caseUpdateIndex)
    expect(b).toContain('status = p_new_status,')
    expect(b).toContain('reviewed_at = now(),')
    expect(b).toContain('reviewed_by = auth.uid()')
  })

  it('writes its own case-specific audit row, in the same transaction, AFTER the case update, with structured metadata only', () => {
    const b = body()
    const caseUpdateIndex = b.indexOf('update public.safety_cases')
    const auditIndex = b.indexOf('insert into public.admin_audit_log')
    expect(caseUpdateIndex).toBeLessThan(auditIndex)
    expect(b).toContain("'apply_safety_case_intervention'")
    expect(b).toContain("'subject_user_id', v_case.subject_user_id")
    expect(b).toContain("'old_case_status', v_case.status")
    expect(b).toContain("'new_case_status', p_new_status")
    expect(b).toContain("'old_account_status', v_actual_account_status")
    expect(b).toContain("'new_account_status', p_new_status")
  })

  it('never selects or logs a Letter body, Safety fingerprint, or any raw evidence text', () => {
    const b = stripLineComments(body())
    expect(b).not.toMatch(/\.body\b/)
    expect(b).not.toContain('fingerprint')
    expect(b).not.toContain('safety_signals')
    expect(b).not.toContain('safety_evaluations')
  })

  it('grants EXECUTE to authenticated only — is_staff() inside the body remains the real gate', () => {
    expect(codeOnly).toContain(
      'grant execute on function public.admin_apply_safety_case_intervention(uuid, text, text, text, text) to authenticated;'
    )
  })
})

describe('no automatic wiring — human authority only (item 3)', () => {
  it('no earlier Safety migration file references this new intervention function at all', () => {
    const earlierFiles = [
      '2026-10-03-safety-persistence.sql',
      '2026-10-05-safety-checkpoint3-letter-wiring.sql',
      '2026-10-06-safety-checkpoint4-public-surfaces.sql',
      '2026-10-07-safety-checkpoint5-behavior-signals.sql',
      '2026-10-08-safety-checkpoint7-admin-needs-attention.sql',
    ]
    for (const file of earlierFiles) {
      const earlierSql = readFileSync(path.join(__dirname, '..', '..', 'docs', 'sql', file), 'utf8')
      expect(earlierSql).not.toContain('admin_apply_safety_case_intervention')
    }
  })

  it('this migration itself never calls the intervention function from anywhere except its own definition', () => {
    const occurrences = (codeOnly.match(/admin_apply_safety_case_intervention/g) ?? []).length
    // create, revoke, grant — exactly three mentions, no fourth (a call site).
    expect(occurrences).toBe(3)
  })
})

describe('admin_list_safety_cases — widened status-filter domain only, no other behavior changed', () => {
  const body = () => extractFunctionBody('public.admin_list_safety_cases')

  it('accepts the four historical intervention outcomes plus warned as filter values', () => {
    const b = body()
    for (const status of ['warned', 'restricted', 'suspended', 'banned']) {
      expect(b).toContain(`'${status}'`)
    }
  })

  it('ordering/aggregation logic is unchanged from Checkpoint 7 — only open/reviewing ever sort as "active"', () => {
    const b = body()
    // The literal ORDER BY clause itself proves the sort key was never
    // widened to also treat a historical outcome (restricted/suspended/
    // banned/warned) as "active" — those four values only ever appear
    // in the p_status filter validation list, never in this clause.
    expect(b).toContain("order by (c.status in ('open', 'reviewing')) desc, c.updated_at desc")
    const orderByClause = b.slice(b.indexOf('order by'))
    for (const status of ['restricted', 'suspended', 'banned', 'warned']) {
      expect(orderByClause).not.toContain(`'${status}'`)
    }
  })

  it('grants EXECUTE to authenticated, matching the unchanged Checkpoint 7 convention', () => {
    expect(codeOnly).toContain('grant execute on function public.admin_list_safety_cases(text, integer, integer) to authenticated;')
  })
})

describe('verification SQL', () => {
  it('exists, is read-only, and checks signatures/grants/staleness/atomicity/no-automatic-wiring', () => {
    const codeOnlyVerify = stripLineComments(verifySql).replace(/'[^']*'/g, "''")
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\binsert\s+into\b/)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\bupdate\s+public\./)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\bdelete\s+from\b/)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\bdrop\s+(table|function|index|policy)\b/)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\balter\s+table\b/)
    for (const name of ['admin_apply_safety_case_intervention', 'admin_list_safety_cases', 'admin_set_account_status']) {
      expect(verifySql).toContain(name)
    }
    expect(verifySql).toContain('overall_pass')
  })
})
