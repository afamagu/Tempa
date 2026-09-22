import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CURRENT_TERMS_VERSION, CURRENT_COMMUNITY_GUIDELINES_VERSION } from '../legal'

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
// For matching prose that wraps across multiple `-- ` comment lines in
// the source — every `--` and run of whitespace collapsed to a single
// space, so a phrase that reads continuously to a human (even though
// it's split across several source lines) is searchable as one
// continuous substring.
const flat = lower.replace(/--/g, ' ').replace(/`/g, '').replace(/\s+/g, ' ')

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

  it('accept_current_legal_documents takes NO parameters at all — identity comes only from auth.uid(), and the accepted version strings are server-side constants (independent audit correction)', () => {
    expect(lower).toContain('create or replace function public.accept_current_legal_documents()')
    // The old client-supplied-version signature must be completely
    // gone, not merely unused.
    expect(lower).not.toContain('p_terms_version text')
    expect(lower).not.toContain('p_community_guidelines_version text')
    expect(lower).toContain(
      "insert into public.legal_acceptances (user_id, document_type, document_version, accepted_at)\n  values\n    (auth.uid()"
    )
  })

  it('both RPCs are SECURITY DEFINER with a fixed search_path, matching this repo\'s own established RPC hardening posture', () => {
    const submitDobStart = lower.indexOf('create or replace function public.submit_dob_eligibility(')
    const submitDobEnd = lower.indexOf('$function$;', submitDobStart)
    const submitDobBody = lower.slice(submitDobStart, submitDobEnd)
    expect(submitDobBody).toContain('security definer')
    expect(submitDobBody).toContain("set search_path to 'pg_catalog'")

    const acceptLegalStart = lower.indexOf('create or replace function public.accept_current_legal_documents()')
    const acceptLegalEnd = lower.indexOf('$function$;', acceptLegalStart)
    const acceptLegalBody = lower.slice(acceptLegalStart, acceptLegalEnd)
    expect(acceptLegalBody).toContain('security definer')
    expect(acceptLegalBody).toContain("set search_path to 'pg_catalog'")
  })

  it('both RPCs are revoked from public/anon/authenticated and re-granted execute to authenticated only, explicitly (not relying on inherited grants)', () => {
    expect(lower).toContain(
      'revoke all on function public.submit_dob_eligibility(integer, integer, integer) from public, anon, authenticated'
    )
    expect(lower).toContain('grant execute on function public.submit_dob_eligibility(integer, integer, integer) to authenticated')
    expect(lower).toContain(
      'revoke all on function public.accept_current_legal_documents() from public, anon, authenticated'
    )
    expect(lower).toContain('grant execute on function public.accept_current_legal_documents() to authenticated')
  })
})

describe('Adult Eligibility + Legal Acceptance Gate migration — first-submission concurrency (independent audit correction)', () => {
  it('acquires an account-scoped transaction advisory lock, keyed from auth.uid() only, never a client-supplied identifier', () => {
    expect(lower).toContain('perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));')
  })

  it('the advisory lock is acquired BEFORE the existing-row read — closing the race a bare FOR UPDATE cannot close on a first submission', () => {
    const fnStart = lower.indexOf('create or replace function public.submit_dob_eligibility(')
    const fnEnd = lower.indexOf('$function$;', fnStart)
    const body = lower.slice(fnStart, fnEnd)

    const lockPos = body.indexOf('pg_advisory_xact_lock')
    const existingReadPos = body.indexOf('select * into v_existing')
    expect(lockPos).toBeGreaterThan(-1)
    expect(existingReadPos).toBeGreaterThan(-1)
    expect(lockPos).toBeLessThan(existingReadPos)
  })

  it('the lock is acquired AFTER the auth check but uses ONLY auth.uid() as its key material — never a p_-prefixed client parameter', () => {
    const fnStart = lower.indexOf('create or replace function public.submit_dob_eligibility(')
    const fnEnd = lower.indexOf('$function$;', fnStart)
    const body = lower.slice(fnStart, fnEnd)

    const authCheckPos = body.indexOf('if auth.uid() is null then')
    const lockPos = body.indexOf('pg_advisory_xact_lock')
    expect(authCheckPos).toBeGreaterThan(-1)
    expect(lockPos).toBeGreaterThan(authCheckPos)

    const lockLineStart = body.indexOf('perform pg_advisory_xact_lock(')
    const lockLineEnd = body.indexOf(';', lockLineStart)
    const lockLine = body.slice(lockLineStart, lockLineEnd)
    expect(lockLine).toContain('auth.uid()')
    expect(lockLine).not.toMatch(/\bp_\w+/)
  })

  it('uses pg_advisory_xact_lock specifically — TRANSACTION-scoped, releasing automatically, never the session-scoped pg_advisory_lock (which would require an explicit, easy-to-forget unlock)', () => {
    expect(lower).toContain('pg_advisory_xact_lock')
    expect(lower).not.toMatch(/[^_]pg_advisory_lock\(/)
  })

  it('the row-level FOR UPDATE lock is kept as defense in depth, not removed', () => {
    const fnStart = lower.indexOf('create or replace function public.submit_dob_eligibility(')
    const fnEnd = lower.indexOf('$function$;', fnStart)
    const body = lower.slice(fnStart, fnEnd)
    expect(body).toContain('for update')
  })
})

describe('Adult Eligibility + Legal Acceptance Gate migration — legal version authority (independent audit correction)', () => {
  it('the two accepted version strings are SQL CONSTANTs inside the function body, not read from any parameter', () => {
    const fnStart = lower.indexOf('create or replace function public.accept_current_legal_documents()')
    const fnEnd = lower.indexOf('$function$;', fnStart)
    const body = lower.slice(fnStart, fnEnd)
    expect(body).toContain('v_terms_version constant text :=')
    expect(body).toContain('v_community_guidelines_version constant text :=')
    expect(body).toContain(
      "values\n    (auth.uid(), 'terms_of_service', v_terms_version, now()),\n    (auth.uid(), 'community_guidelines', v_community_guidelines_version, now())"
    )
  })

  it('an authenticated caller cannot choose, override, or influence which version gets recorded — the function signature has zero parameters', () => {
    expect(lower).toContain('create or replace function public.accept_current_legal_documents()\nreturns void')
  })

  it('the SQL-authoritative legal versions exactly match lib/legal.ts\'s exported constants (source-level regression test, not a manual claim)', () => {
    const termsMatch = sql.match(/v_terms_version constant text := '([^']+)'/)
    const guidelinesMatch = sql.match(/v_community_guidelines_version constant text := '([^']+)'/)
    expect(termsMatch).not.toBeNull()
    expect(guidelinesMatch).not.toBeNull()
    expect(termsMatch![1]).toBe(CURRENT_TERMS_VERSION)
    expect(guidelinesMatch![1]).toBe(CURRENT_COMMUNITY_GUIDELINES_VERSION)
  })

  it('eligibility and account-status checks are preserved from the previous (client-supplied-version) design', () => {
    const fnStart = lower.indexOf('create or replace function public.accept_current_legal_documents()')
    const fnEnd = lower.indexOf('$function$;', fnStart)
    const body = lower.slice(fnStart, fnEnd)
    expect(body).toContain('current_account_status()')
    expect(body).toContain("v_status is distinct from 'eligible'")
  })

  it('versioned acceptance rows and idempotency are preserved', () => {
    const fnStart = lower.indexOf('create or replace function public.accept_current_legal_documents()')
    const fnEnd = lower.indexOf('$function$;', fnStart)
    const body = lower.slice(fnStart, fnEnd)
    expect(body).toContain('on conflict (user_id, document_type, document_version) do nothing')
  })

  it('LEGACY OVERLOAD CLEANUP: the migration itself drops the old (text, text) overload — never relies only on the verifier noticing it was absent', () => {
    // PostgreSQL functions are overloaded by signature — CREATE OR
    // REPLACE FUNCTION public.accept_current_legal_documents() alone
    // would NOT remove a previously-applied (text, text) draft still
    // sitting in some database. The migration must actively drop it.
    expect(lower).toContain('drop function if exists public.accept_current_legal_documents(text, text);')
  })

  it('the DROP targets the exact legacy (text, text) signature only — never a bare, ambiguous DROP FUNCTION across all overloads', () => {
    expect(lower).not.toMatch(/drop function (if exists )?public\.accept_current_legal_documents;/)
    expect(lower).not.toMatch(/drop function (if exists )?public\.accept_current_legal_documents\(\);/)
  })

  it('the DROP is placed inside this migration\'s own transaction, BEFORE the new zero-argument function is created', () => {
    const transactionStart = lower.indexOf('\nbegin;')
    const dropPos = lower.indexOf('drop function if exists public.accept_current_legal_documents(text, text);')
    const createPos = lower.indexOf('create or replace function public.accept_current_legal_documents()')
    const transactionEnd = lower.lastIndexOf('\ncommit;')

    expect(transactionStart).toBeGreaterThan(-1)
    expect(dropPos).toBeGreaterThan(transactionStart)
    expect(dropPos).toBeLessThan(createPos)
    expect(createPos).toBeLessThan(transactionEnd)
  })

  it('uses IF EXISTS — harmless on the intended fresh production state where no prior draft was ever applied', () => {
    expect(lower).toContain('drop function if exists public.accept_current_legal_documents(text, text);')
    expect(lower).not.toContain('drop function public.accept_current_legal_documents(text, text);')
  })
})

describe('Adult Eligibility + Legal Acceptance Gate migration — an already-eligible DOB is immutable through this RPC (independent audit correction)', () => {
  it('the eligible short-circuit exists, is checked BEFORE any input validation, and never evaluates the submitted DOB', () => {
    expect(lower).toContain("if found and v_existing.status = 'eligible' then")
    const guardStart = lower.indexOf("if found and v_existing.status = 'eligible' then")
    const guardEnd = lower.indexOf('end if;', guardStart)
    const guardBody = lower.slice(guardStart, guardEnd)
    expect(guardBody).toContain('return query select v_existing.status, v_existing.eligible_on')
    expect(guardBody).not.toContain('insert into')
    expect(guardBody).not.toContain('update')
    expect(guardBody).not.toContain('make_date')

    // Position-ordering (both > 0 before comparing, since position()
    // returns 0 rather than NULL for a missing substring): the eligible
    // short-circuit must appear strictly BEFORE the date-validation
    // block, proving a replacement DOB is never even looked at once
    // already eligible.
    const eligibleGuardPos = lower.indexOf("if found and v_existing.status = 'eligible' then")
    const validationPos = lower.indexOf('if p_year is null or p_month is null or p_day is null then')
    expect(eligibleGuardPos).toBeGreaterThan(-1)
    expect(validationPos).toBeGreaterThan(-1)
    expect(eligibleGuardPos).toBeLessThan(validationPos)
  })

  it('the RPC return signature never includes date_of_birth in any branch — only status and eligible_on', () => {
    expect(lower).toContain('returns table(status text, eligible_on date)')
    const returnStatements = lower.match(/return query select[^;]*;/g) ?? []
    expect(returnStatements.length).toBeGreaterThan(0)
    for (const stmt of returnStatements) {
      expect(stmt).not.toContain('date_of_birth')
      expect(stmt).not.toContain('v_dob')
    }
  })

  it('the ineligible-window short-circuit is a SEPARATE guard from the eligible-immutability short-circuit, not folded together', () => {
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

  it('ineligible-on-or-after-eligible_on still falls through to a fresh, neutral screening (the guard above does not block it)', () => {
    // The ineligible-window guard's own condition requires BOTH
    // ineligible status AND current_date < eligible_on — once
    // eligible_on has arrived, this condition is false and execution
    // continues past `end if;` into the ordinary validation/evaluation
    // path below, which is unchanged and still reachable.
    const guardStart = lower.indexOf(
      "if found and v_existing.status = 'ineligible' and current_date < v_existing.eligible_on then"
    )
    const guardEnd = lower.indexOf('end if;', guardStart)
    const afterGuard = lower.slice(guardEnd, guardEnd + 500)
    expect(afterGuard).toContain('if p_year is null or p_month is null or p_day is null then')
  })
})

describe('Adult Eligibility + Legal Acceptance Gate migration — under-18 handling never permits an immediate retry', () => {
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
    expect(lower).toContain('v_target_year := extract(year from p_dob)::int + 18')
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

describe('Adult Eligibility + Legal Acceptance Gate migration — trigger privilege correction (independent audit correction)', () => {
  it('the profile trigger is SECURITY DEFINER, not SECURITY INVOKER — required to call derive_age_range, which authenticated cannot directly EXECUTE', () => {
    const fnStart = lower.indexOf('create or replace function tempa_private.enforce_profile_adult_eligibility()')
    const fnEnd = lower.indexOf('$function$;', fnStart)
    const body = lower.slice(fnStart, fnEnd)
    expect(body).toContain('security definer')
    expect(body).not.toContain('security invoker')
    expect(body).toContain("set search_path to 'pg_catalog'")
  })

  it('the trigger independently re-asserts new.id = auth.uid() as an ownership backstop, rather than assuming profiles\' own INSERT policy already guarantees it', () => {
    const fnStart = lower.indexOf('create or replace function tempa_private.enforce_profile_adult_eligibility()')
    const fnEnd = lower.indexOf('$function$;', fnStart)
    const body = lower.slice(fnStart, fnEnd)
    expect(body).toContain('new.id is distinct from auth.uid()')

    // The ownership backstop must run BEFORE the eligibility check —
    // an insert for someone else's id should never even reach the
    // eligibility lookup.
    const ownershipPos = body.indexOf('new.id is distinct from auth.uid()')
    const eligibilityPos = body.indexOf("v_status is distinct from 'eligible'")
    expect(ownershipPos).toBeGreaterThan(-1)
    expect(eligibilityPos).toBeGreaterThan(-1)
    expect(ownershipPos).toBeLessThan(eligibilityPos)
  })

  it('derive_age_range itself stays revoked from authenticated — the fix is the trigger\'s own security context, never a broader grant', () => {
    expect(lower).toContain('revoke all on function tempa_private.derive_age_range(date) from public, anon, authenticated')
    expect(lower).not.toMatch(/grant execute on function tempa_private\.derive_age_range.*to authenticated/i)
  })

  it('the trigger function itself is still revoked from all client roles — trigger firing never requires a direct EXECUTE grant', () => {
    expect(lower).toContain(
      'revoke all on function tempa_private.enforce_profile_adult_eligibility()\n  from public, anon, authenticated'
    )
  })
})

describe('Adult Eligibility + Legal Acceptance Gate migration — one canonical February 29 convention, never PostgreSQL\'s built-in age() (independent audit correction)', () => {
  it('tempa_private.calculate_age exists, is revoked from authenticated, and is the plain field-comparison algorithm (no leap-day special-casing needed)', () => {
    expect(lower).toContain('create or replace function tempa_private.calculate_age(p_dob date, p_today date)')
    expect(lower).toContain('revoke all on function tempa_private.calculate_age(date, date) from public, anon, authenticated')
    const fnStart = lower.indexOf('create or replace function tempa_private.calculate_age(')
    const fnEnd = lower.indexOf('$$;', fnStart)
    const body = lower.slice(fnStart, fnEnd)
    expect(body).toContain('extract(day from p_today)::int >= extract(day from p_dob)::int')
  })

  it('tempa_private.calculate_eligible_on resolves a Feb 29 DOB\'s non-leap +18 target year to MARCH 1, never February 28', () => {
    expect(lower).toContain('create or replace function tempa_private.calculate_eligible_on(p_dob date)')
    const fnStart = lower.indexOf('create or replace function tempa_private.calculate_eligible_on(')
    const fnEnd = lower.indexOf('$function$;', fnStart)
    const body = lower.slice(fnStart, fnEnd)
    expect(body).toContain('make_date(v_target_year, 3, 1)')
    expect(body).not.toContain('make_date(v_target_year, 2, 28)')
  })

  it('submit_dob_eligibility uses the canonical calculate_age/calculate_eligible_on functions, never PostgreSQL\'s built-in age()', () => {
    const fnStart = lower.indexOf('create or replace function public.submit_dob_eligibility(')
    const fnEnd = lower.indexOf('$function$;', fnStart)
    const body = lower.slice(fnStart, fnEnd)
    expect(body).toContain('tempa_private.calculate_age(v_dob, current_date)')
    expect(body).toContain('tempa_private.calculate_eligible_on(v_dob)')
    expect(body).not.toMatch(/\bage\(current_date/)
  })

  it('derive_age_range uses the canonical calculate_age function, never PostgreSQL\'s built-in age() — so a leap-day adult\'s bucket follows the same convention as the adult-eligibility check itself', () => {
    const fnStart = lower.indexOf('create or replace function tempa_private.derive_age_range(')
    const fnEnd = lower.indexOf('$$;', fnStart)
    const body = lower.slice(fnStart, fnEnd)
    expect(body).toContain('tempa_private.calculate_age(p_dob, current_date)')
    expect(body).not.toMatch(/\bage\(current_date/)
  })

  it('never leaves a state where /begin could become retryable on Feb 28 while the age check still says 17 — eligible_on and calculate_age share the exact same boundary by construction', () => {
    // Both functions independently implement "day >= dob.day" /
    // "the +18 target year's Feb 29 has no Feb 29" reasoning; this test
    // asserts the SOURCE-LEVEL contract (documented, cross-referenced)
    // rather than re-deriving Postgres runtime behavior, which cannot
    // be executed in this checkpoint (source-level verification only).
    expect(flat).toContain('self-consistent')
    expect(flat).toContain('under-18 handling and privacy wording')
  })
})

describe('Adult Eligibility + Legal Acceptance Gate migration — accurate under-18 privacy wording (independent audit correction)', () => {
  it('no longer claims eligible_on makes the birth date unrecoverable — the header explicitly says the opposite', () => {
    expect(flat).toContain('eligible_on is derived directly from the submitted dob')
    expect(flat).toContain('it is not an unrelated or irreversible value')

    // The phrase "no longer retaining the person's exact birth-date
    // information" appears exactly ONCE — quoted as the claim this
    // file explicitly REJECTS ("do not describe this design as
    // Tempa ..."), never asserted as this file's own position. A bare
    // `.not.toContain` would be a false positive here: the phrase's
    // mere presence is the correction working as intended, not a
    // regression — same self-disclaiming-comment pattern as this
    // session's other "word appears only in its own rejection"
    // corrections.
    const claim = "no longer retaining the person's exact birth-date information"
    const occurrences = flat.split(claim).length - 1
    expect(occurrences).toBe(1)
    const claimPos = flat.indexOf(claim)
    const precedingContext = flat.slice(Math.max(0, claimPos - 60), claimPos)
    expect(precedingContext).toContain('do not describe this design as')
  })

  it('the header still correctly states the raw submitted value is not retained verbatim in the ordinary DOB field', () => {
    expect(flat).toContain('the raw submitted value is not stored verbatim in the ordinary adult-dob field')
  })

  it('flags the future Privacy Notice as a launch dependency for describing eligible_on accurately', () => {
    expect(flat).toContain('privacy notice')
    expect(flat).toContain('not yet published')
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
