import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Post-onboarding corrections checkpoint (Section P) — a live smoke test
// recalled an approved rule involving a limited editing window (possibly
// 30 minutes) and editing becoming unavailable once public interaction/
// replies exist, but was explicit that this recollection should NOT be
// trusted as source of truth. Audited instead from the actual, currently
// live SQL (docs/sql/2026-09-11-safety-blocking-foundation.sql, the last
// file to redefine update_dispatch — docs/sql/2026-09-23-dispatch-
// replies.sql was checked too and confirmed to touch Reply editing only,
// never Dispatch editing) and from docs/tempa-build-guide.md's own
// recorded Edit contract, which agree with each other: there is no time
// window and no reply-lock. This file pins that actual contract as a
// regression guard — a future migration or build-guide edit that adds
// either restriction should have to touch this test deliberately, not
// silently diverge from what's documented.
const updateDispatchSource = readFileSync(
  path.join(__dirname, '..', '..', 'docs', 'sql', '2026-09-11-safety-blocking-foundation.sql'),
  'utf8'
)

const fnStart = updateDispatchSource.indexOf('create or replace function public.update_dispatch(')
const fnEnd = updateDispatchSource.indexOf('\n$function$', fnStart)
const updateDispatchFn = updateDispatchSource.slice(fnStart, fnEnd)

const buildGuideSource = readFileSync(path.join(__dirname, '..', '..', 'docs', 'tempa-build-guide.md'), 'utf8')

describe('update_dispatch — the actual, currently live Dispatch edit contract (Section P audit)', () => {
  it('is the real function body this test is reading (sanity check the slice found it)', () => {
    expect(fnStart).toBeGreaterThan(-1)
    expect(updateDispatchFn).toContain('returns public.dispatches')
  })

  it('has NO time-based editing window — no published_at comparison, no now()/interval check anywhere in the function', () => {
    expect(updateDispatchFn).not.toContain('published_at')
    expect(updateDispatchFn.toLowerCase()).not.toMatch(/now\(\)\s*-|interval\s+'/)
  })

  it('has NO reply-count or reply-existence lock — no reference to Dispatch replies at all', () => {
    // Scoped past the "create or replace" preamble itself, which
    // legitimately contains "repl" as a substring of "replace" — the
    // same self-inflicted false-positive shape this codebase has hit
    // before with bare substring checks.
    const bodyOnly = updateDispatchFn.slice(updateDispatchFn.indexOf('$function$'))
    expect(bodyOnly.toLowerCase()).not.toMatch(/\breply\b|\breplies\b|dispatch_replies/)
  })

  it('the only eligibility gates are: authenticated, not restricted/suspended/banned, author of a currently PUBLISHED Dispatch', () => {
    expect(updateDispatchFn).toContain('if auth.uid() is null then')
    expect(updateDispatchFn).toContain("current_account_status() in ('restricted', 'suspended', 'banned')")
    expect(updateDispatchFn).toContain('d.author_id = auth.uid()')
    expect(updateDispatchFn).toContain("d.status = 'published'")
  })

  it('the build guide\'s own recorded Edit contract agrees — no time window or reply-lock documented there either', () => {
    const editSectionStart = buildGuideSource.indexOf('**Edit** (`update_dispatch`')
    const editSectionEnd = buildGuideSource.indexOf('**Delete**', editSectionStart)
    expect(editSectionStart).toBeGreaterThan(-1)
    const editSection = buildGuideSource.slice(editSectionStart, editSectionEnd).toLowerCase()
    expect(editSection).not.toMatch(/\b30\s*minutes?\b|\bediting window\b|\bonce replies\b/)
  })
})
