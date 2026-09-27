// Forward-only fix for account_closures.auth_disabled_at staying NULL on
// Auth-banned accounts: finalizeAccountClosure()'s service-role UPDATE
// was refused because 2026-10-16 granted service_role nothing on the
// table. CI cannot run Postgres, so the SQL contract is checked against
// the tracked text (same convention as the other migration tests).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const DIR = path.join(__dirname, '..', '..', 'docs', 'sql')
const read = (f: string) => readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (s: string) => s.replace(/--.*$/gm, '')
const fix = read('2026-10-24-account-closure-service-role-grant.sql')
const verify = read('2026-10-24-account-closure-service-role-grant-verify.sql')
const backfill = read('2026-10-24-account-closure-auth-disabled-backfill.sql')
const lifecycle = stripComments(read('2026-10-16-account-lifecycle.sql'))
const safetyVerify = read('2026-10-03-safety-persistence-verify.sql')
const finalize = readFileSync(path.join(__dirname, '..', 'account-deletion.ts'), 'utf8').replace(/\r\n/g, '\n')
const fixCode = stripComments(fix)

describe('root cause (reproduced from the applied SQL)', () => {
  it('2026-10-16 revokes account_closures from members and grants service_role nothing', () => {
    expect(lifecycle).toContain('revoke all on public.account_closures from public, anon, authenticated;')
    expect(lifecycle).not.toMatch(/grant [^;]* on (table )?public\.account_closures/i)
  })

  it('this project does not give service_role default table privileges (the safety_cases verifier relies on it)', () => {
    expect(safetyVerify).toContain("not has_table_privilege('service_role', 'public.safety_cases', 'SELECT')")
  })

  it('the app writes account_closures through the service role and filters by user_id', () => {
    const start = finalize.indexOf(".from('account_closures')")
    expect(start).toBeGreaterThan(-1)
    const call = finalize.slice(start, finalize.indexOf(".eq('user_id', userId)", start))
    for (const col of ['storage_cleaned_at', 'auth_disabled_at', 'last_error']) expect(call).toContain(col)
  })
})

describe('2026-10-24 account_closures service_role grant', () => {
  it('is one forward-only transaction, not yet marked applied, and edits nothing else', () => {
    expect((fix.match(/^begin;/gm) ?? []).length).toBe(1)
    expect((fix.match(/^commit;/gm) ?? []).length).toBe(1)
    expect(fix).toContain('STATUS: NOT YET APPLIED')
    expect(fixCode).not.toMatch(/\b(drop|alter|create|revoke|delete|insert|update public|truncate)\b/i)
  })

  it('grants exactly the columns the app writes, plus SELECT on the filter column — nothing else', () => {
    const grants = (fixCode.match(/^grant [^;]*;/gm) ?? []).map((g) => g.replace(/\s+/g, ' '))
    expect(grants).toEqual([
      'grant select (user_id) on public.account_closures to service_role;',
      'grant update (storage_cleaned_at, auth_disabled_at, last_error) on public.account_closures to service_role;',
    ])
    expect(fixCode).not.toMatch(/\b(anon|authenticated|public)\s*;/)
  })

  it('verifier is read-only and checks the fix, the limits and that members still have nothing', () => {
    expect(stripComments(verify)).not.toMatch(/\b(insert|update|delete|grant|revoke|alter|create|drop)\b\s/i)
    for (const col of [
      'service_role_can_update_progress',
      'service_role_no_insert_delete',
      'service_role_cannot_read_closure_contents',
      'service_role_cannot_rewrite_identity_or_time',
      'no_member_privileges',
      'no_policies',
      'rls_still_enabled',
      'overall_pass',
    ]) {
      expect(verify).toContain(col)
    }
  })
})

describe('owner backfill file', () => {
  it('is marked not run; the only live statement is the read-only listing', () => {
    expect(backfill).toContain('STATUS: NOT RUN')
    const live = stripComments(backfill).trim()
    expect(live.startsWith('select')).toBe(true)
    expect((live.match(/;/g) ?? []).length).toBe(1)
    expect(live).not.toMatch(/\b(update|insert|delete|email|raw_user_meta_data|reason_)/i)
  })

  it('the commented backfill only stamps auth_disabled_at on rows really carrying the closure ban', () => {
    expect(backfill).toContain('-- update public.account_closures c')
    expect(backfill).toContain("-- set auth_disabled_at = u.banned_until - interval '876000 hours'")
    expect(backfill).toContain('--   and c.auth_disabled_at is null')
    expect(backfill).toContain("--   and u.banned_until > now() + interval '50 years';")
  })
})
