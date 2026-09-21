import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATION_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-09-21-adult-eligibility-and-legal-acceptance.sql')
const VERIFY_PATH = path.join(
  __dirname,
  '..',
  '..',
  'docs',
  'sql',
  '2026-09-21-adult-eligibility-and-legal-acceptance-verify.sql'
)
const sql = readFileSync(MIGRATION_PATH, 'utf8')
const verifySql = readFileSync(VERIFY_PATH, 'utf8')
const lower = sql.toLowerCase()

describe('Adult Eligibility + Legal Acceptance Gate migration — both tables are RPC-only, own-row-only', () => {
  it('account_eligibility RLS is scoped to auth.uid() = user_id, never a broader/other-row policy', () => {
    expect(lower).toContain('create policy account_eligibility_own')
    expect(lower).toContain('auth.uid() = user_id')
  })

  it('account_eligibility grants SELECT only — no direct insert/update/delete to any role', () => {
    expect(lower).toContain('revoke all on public.account_eligibility from public, anon, authenticated')
    expect(lower).toContain('grant select on public.account_eligibility to authenticated')
    expect(lower).not.toMatch(/grant\s+insert.*on\s+public\.account_eligibility/i)
    expect(lower).not.toMatch(/grant\s+update.*on\s+public\.account_eligibility/i)
  })

  it('legal_acceptances RLS is scoped to auth.uid() = user_id, and grants SELECT only', () => {
    expect(lower).toContain('create policy legal_acceptances_own')
    expect(lower).toContain('revoke all on public.legal_acceptances from public, anon, authenticated')
    expect(lower).toContain('grant select on public.legal_acceptances to authenticated')
  })

  it('legal_acceptances has a (user_id, document_type, document_version) uniqueness rule, never a bare boolean flag', () => {
    expect(lower).toContain('unique (user_id, document_type, document_version)')
    expect(lower).not.toContain('accepted_terms boolean')
  })
})

describe('Adult Eligibility + Legal Acceptance Gate migration — identity is always auth.uid(), never a client-supplied user id', () => {
  it('submit_dob_eligibility takes no user-id argument at all — identity comes only from auth.uid()', () => {
    expect(lower).toContain('create or replace function public.submit_dob_eligibility(')
    const sigStart = lower.indexOf('create or replace function public.submit_dob_eligibility(')
    const sigEnd = lower.indexOf(')', sigStart)
    const signature = lower.slice(sigStart, sigEnd)
    expect(signature).not.toContain('user_id')
    expect(signature).not.toContain('uuid')
    expect(lower).toContain('if auth.uid() is null then')
  })

  it('accept_current_legal_documents takes no user-id argument at all — identity comes only from auth.uid()', () => {
    expect(lower).toContain('create or replace function public.accept_current_legal_documents(')
    const sigStart = lower.indexOf('create or replace function public.accept_current_legal_documents(')
    const sigEnd = lower.indexOf(')', sigStart)
    const signature = lower.slice(sigStart, sigEnd)
    expect(signature).not.toContain('uuid')
    expect(lower).toContain(
      "insert into public.legal_acceptances (user_id, document_type, document_version, accepted_at)\n  values\n    (auth.uid()"
    )
  })

  it('both RPCs are SECURITY DEFINER with a fixed search_path, matching this repo\'s own established RPC hardening posture', () => {
    for (const fn of ['public.submit_dob_eligibility', 'public.accept_current_legal_documents']) {
      const fnStart = lower.indexOf(`create or replace function ${fn}(`)
      const fnEnd = lower.indexOf('$function$;', fnStart)
      const body = lower.slice(fnStart, fnEnd)
      expect(body).toContain('security definer')
      expect(body).toContain("set search_path to 'pg_catalog'")
    }
  })

  it('both RPCs are revoked from public/anon/authenticated and re-granted execute to authenticated only, explicitly (not relying on inherited grants)', () => {
    expect(lower).toContain(
      'revoke all on function public.submit_dob_eligibility(integer, integer, integer) from public, anon, authenticated'
    )
    expect(lower).toContain('grant execute on function public.submit_dob_eligibility(integer, integer, integer) to authenticated')
    expect(lower).toContain(
      'revoke all on function public.accept_current_legal_documents(text, text) from public, anon, authenticated'
    )
    expect(lower).toContain('grant execute on function public.accept_current_legal_documents(text, text) to authenticated')
  })
})

describe('Adult Eligibility + Legal Acceptance Gate migration — under-18 handling never permits an immediate retry', () => {
  it('a persisted ineligible decision inside its blocked window is returned unchanged, without accepting a replacement DOB', () => {
    expect(lower).toContain(
      "if found and v_existing.status = 'ineligible' and current_date < v_existing.eligible_on then"
    )
    const guardStart = lower.indexOf(
      "if found and v_existing.status = 'ineligible' and current_date < v_existing.eligible_on then"
    )
    const guardEnd = lower.indexOf('end if;', guardStart)
    const guardBody = lower.slice(guardStart, guardEnd)
    expect(guardBody).toContain('return query select v_existing.status, v_existing.eligible_on')
    expect(guardBody).not.toContain('insert into')
    expect(guardBody).not.toContain('update')
  })

  it('an ineligible submission does NOT retain the exact DOB — date_of_birth is written as null', () => {
    // Scoped by position() ordering rather than a sliced region: the
    // ineligible branch itself contains a nested if/else/end if (the
    // Feb-29 leap-day special case), so slicing "from else to the next
    // end if;" would wrongly stop at THAT inner end if instead of the
    // outer one — position()-ordering avoids that trap entirely.
    const eligibleCheckPos = lower.indexOf('if v_age >= 18 then')
    const ineligibleInsertPos = lower.indexOf("values (auth.uid(), null, 'ineligible'", eligibleCheckPos)
    const dateOfBirthNullPos = lower.indexOf('date_of_birth = null', ineligibleInsertPos)
    expect(eligibleCheckPos).toBeGreaterThan(-1)
    expect(ineligibleInsertPos).toBeGreaterThan(eligibleCheckPos)
    expect(dateOfBirthNullPos).toBeGreaterThan(ineligibleInsertPos)
  })

  it('an eligible submission DOES retain the exact DOB (deliberate product decision, not an oversight)', () => {
    const eligibleBranch = lower.indexOf('if v_age >= 18 then')
    const elseBranch = lower.indexOf('else', eligibleBranch)
    const eligibleBody = lower.slice(eligibleBranch, elseBranch)
    expect(eligibleBody).toContain("values (auth.uid(), v_dob, 'eligible', null, now(), now())")
  })

  it('eligible_on is computed as dob + 18 years, calendar-correct, never a fixed-day-count approximation', () => {
    expect(lower).toContain('v_target_year := extract(year from v_dob)::int + 18')
    expect(lower).not.toMatch(/18\s*\*\s*365/)
  })
})

describe('Adult Eligibility + Legal Acceptance Gate migration — profile creation defense in depth', () => {
  it('a BEFORE INSERT trigger on profiles blocks any insert for a non-eligible account, same shape as the existing profiles_force_initial_mark_stage trigger', () => {
    expect(lower).toContain('before insert on public.profiles')
    expect(lower).toContain('profiles_enforce_adult_eligibility')
    expect(lower).toContain("if v_status is distinct from 'eligible' then")
    expect(lower).toContain("raise exception 'a tempa profile requires confirmed adult eligibility.'")
  })

  it('age_range is force-overwritten from the authoritative DOB, never trusted from the client', () => {
    expect(lower).toContain('new.age_range := tempa_private.derive_age_range(v_dob)')
  })

  it('the canonical age-range bucket rule matches lib/age.ts\'s deriveAgeRangeBucket exactly (same six buckets, same boundaries)', () => {
    for (const bucket of ["'18-24'", "'25-34'", "'35-44'", "'45-54'", "'55-64'", "'65+'"]) {
      expect(lower).toContain(bucket)
    }
    expect(lower).toContain('a.age < 25')
    expect(lower).toContain('a.age < 35')
    expect(lower).toContain('a.age < 45')
    expect(lower).toContain('a.age < 55')
    expect(lower).toContain('a.age < 65')
  })
})

describe('Adult Eligibility + Legal Acceptance Gate migration — no invasive collection', () => {
  it('never references device fingerprinting, IP harvesting, or browser-fingerprint collection', () => {
    // "fingerprint" appears exactly twice — only inside this file's own
    // disclaiming header comment ("NO device fingerprinting... or
    // browser-fingerprint collection is introduced by this
    // migration") — never as an actual column, table, or collection
    // mechanism.
    expect((lower.match(/fingerprint/g) ?? []).length).toBe(2)
    expect(lower).not.toContain('ip_address')
    expect(lower).not.toContain('user_agent')
  })

  it('legal acceptance requires eligibility to already be confirmed', () => {
    expect(lower).toContain("if v_status is distinct from 'eligible' then")
    expect(lower).toContain("raise exception 'adult eligibility must be confirmed before accepting these documents.'")
  })

  it('legal acceptance checks account status, matching every other write RPC\'s own gate', () => {
    expect(lower).toContain("if public.current_account_status() in ('restricted', 'suspended', 'banned') then")
  })
})

describe('Adult Eligibility + Legal Acceptance Gate — verification file exists and targets the same objects', () => {
  it('the verify file references every object this migration creates', () => {
    const verifyLower = verifySql.toLowerCase()
    for (const object of [
      'account_eligibility',
      'legal_acceptances',
      'submit_dob_eligibility',
      'accept_current_legal_documents',
      'derive_age_range',
      'profiles_enforce_adult_eligibility',
    ]) {
      expect(verifyLower).toContain(object)
    }
    expect(verifyLower).toContain('overall_pass')
  })

  it('the verify file performs no mutation — every statement is read-only', () => {
    const verifyLower = verifySql.toLowerCase()
    expect(verifyLower).not.toMatch(/\binsert\s+into\b/)
    expect(verifyLower).not.toMatch(/\bupdate\s+public\./)
    expect(verifyLower).not.toMatch(/\bdelete\s+from\b/)
    expect(verifyLower).not.toContain('drop table')
    expect(verifyLower).not.toContain('drop function')
  })
})
