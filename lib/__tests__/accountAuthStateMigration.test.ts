// Deleted vs suspended vs permanently banned (2026-10-25). CI cannot run
// Postgres, so the SQL contract is checked against the tracked text,
// same convention as the other migration tests.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(__dirname, '..', '..')
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')
const strip = (s: string) => s.replace(/--.*$/gm, '')
const migration = read('docs/sql/2026-10-25-account-auth-state.sql')
const verify = read('docs/sql/2026-10-25-account-auth-state-verify.sql')
const listing = read('docs/sql/2026-10-25-account-auth-state-remediation-list.sql')
const script = read('scripts/remediate-account-auth.mjs')
const code = strip(migration)

const fn = (name: string) => {
  const start = code.indexOf(`create or replace function public.${name}(`)
  expect(start, name).toBeGreaterThan(-1)
  return code.slice(start, code.indexOf('$function$;', start))
}

describe('2026-10-25 account auth state — forward-only, functions only', () => {
  it('one transaction, not yet applied, creates functions and nothing else', () => {
    expect((migration.match(/^begin;/gm) ?? []).length).toBe(1)
    expect((migration.match(/^commit;/gm) ?? []).length).toBe(1)
    expect(migration).toContain('STATUS: NOT YET APPLIED')
    expect(code).not.toMatch(/\b(drop|alter|insert|update|delete|truncate|create table|create policy)\b/i)
  })

  it('both functions are SECURITY DEFINER with a pinned search_path and service_role-only execute', () => {
    for (const [name, sig] of [
      ['account_auth_state', 'uuid'],
      ['account_auth_state_for_email_link', 'text'],
    ]) {
      const body = fn(name)
      expect(body).toContain('security definer')
      expect(body).toContain("set search_path to 'pg_catalog'")
      expect(code).toContain(`revoke all on function public.${name}(${sig}) from public, anon, authenticated;`)
      expect(code).toContain(`grant execute on function public.${name}(${sig}) to service_role;`)
      expect(code).not.toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to (anon|authenticated)`))
    }
  })

  it('Tempa tables are the source of truth; reports, cases and restriction are never inputs', () => {
    const body = fn('account_auth_state')
    expect(body).toContain("when es.status = 'banned' then 'permanently_banned'")
    expect(body).toContain("when c.user_id is not null and es.status = 'suspended' then 'deleted_suspended'")
    expect(body).toContain("when c.user_id is not null then 'deleted'")
    expect(body).toContain('public.account_enforcement_state')
    expect(body).toContain('public.account_closures')
    expect(body).not.toMatch(/restricted|reports|safety_cases/)
    // a permanent ban wins over everything, including deletion
    expect(body.indexOf("'permanently_banned'")).toBeLessThan(body.indexOf("'deleted'"))
  })

  it('the email-link lookup returns the state word only and ignores empty/implausible hashes', () => {
    const body = fn('account_auth_state_for_email_link')
    expect(body).toContain('select public.account_auth_state(u.id)')
    expect(body).toContain('char_length(p_token_hash) between 40 and 128')
    expect(body).toContain('(u.recovery_token = p_token_hash or u.confirmation_token = p_token_hash)')
    expect(body).not.toMatch(/select[^;]*\bu\.(email|id)\b\s*(,|from)/)
  })

  it('verifier is read-only and covers grants, definer, and never-matching inputs', () => {
    expect(strip(verify)).not.toMatch(/\b(insert|update|delete|grant|revoke|alter|create|drop)\b\s/i)
    for (const col of [
      'service_role_can_execute',
      'members_cannot_execute',
      'no_public_execute',
      'owner_can_read_auth_users',
      'empty_or_short_hash_matches_nothing',
      'reports_and_restriction_not_inputs',
      'overall_pass',
    ]) {
      expect(verify).toContain(col)
    }
  })
})

describe('remediation — listing is read-only; the script is dry-run by default', () => {
  it('the listing contains only SELECTs, ids and timestamps', () => {
    const live = strip(listing)
    expect(listing).toContain('STATUS: READ-ONLY. NOT RUN.')
    expect(live).not.toMatch(/\b(insert|update|delete|grant|revoke|alter|create|drop|truncate)\b\s/i)
    expect(live).not.toMatch(/\bemail\b|raw_user_meta_data|reason_/i)
    expect(live).toContain("where coalesce(es.status, 'active') not in ('suspended', 'banned')")
  })

  it('the script acts only with --apply, re-checks each id, and never hard-deletes', () => {
    expect(script).toContain("const apply = args.includes('--apply')")
    expect(script).toContain("if (!apply) {")
    expect(script).toContain("service.rpc('account_auth_state', { p_user_id: id })")
    expect(script).toContain('service.auth.admin.deleteUser(id, true)')
    expect(script).not.toMatch(/deleteUser\(id\)|deleteUser\(id, false\)/)
    expect(script).toContain('SKIPPED (not eligible)')
    expect(script).not.toMatch(/\.email\b/)
  })
})
