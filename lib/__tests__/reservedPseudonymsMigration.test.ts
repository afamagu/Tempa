import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
const sql = readFileSync(new URL('../../docs/sql/2026-10-30-reserved-pseudonyms.sql', import.meta.url), 'utf8')
const form = readFileSync(new URL('../../app/profile/profile-form.tsx', import.meta.url), 'utf8')
describe('reserved-name enforcement contract', () => {
  it('guards INSERT and every UPDATE through the real profiles trigger', () => {
    expect(sql).toMatch(/before insert or update on public\.profiles/)
    expect(sql).toContain("raise exception 'That name is reserved.' using errcode = '23514'")
  })
  it('does not rename existing profiles and aborts for ordinary collisions', () => {
    expect(sql).not.toMatch(/update\s+public\.profiles\s+set/i)
    expect(sql).toContain('where not is_editorial and public.is_reserved_pseudonym(pseudonym)')
  })
  it('permits protected changes only to designated house accounts with a privileged JWT and role', () => {
    expect(sql).toContain("tg_op = 'UPDATE' and new.is_editorial")
    expect(sql).toContain("v_jwt_role in ('', 'service_role')")
    expect(sql).toContain("not in ('anon', 'authenticated')")
  })
  it('does not expose the trigger as a callable member RPC', () => {
    expect(sql).toContain('revoke all on function tempa_private.guard_reserved_pseudonym() from public, anon, authenticated')
  })
  it('filters both availability and suggestions through the reserved rule', () => {
    expect(sql).toContain('select not public.is_reserved_pseudonym(candidate) and not exists')
    expect(sql).toContain('if public.is_reserved_pseudonym(clean_base) then return suggestions')
  })
  it('uses the same client rule on typing and submission, and handles a database rejection', () => {
    expect(form).toContain('isReservedPseudonym(value)')
    expect(form).toContain("insertError.code === '23514'")
    expect(form).toContain("pseudonymStatus === 'reserved'")
    expect(form).toContain('++checkIdRef.current')
  })
})
