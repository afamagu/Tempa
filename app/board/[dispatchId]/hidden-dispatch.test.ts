// Admin Phase 2A-1, Section 8 — the Board detail page
// (app/board/[dispatchId]/page.tsx) is a Server Component reading
// cookies()/Supabase directly, so — same convention as
// app/admin/route-structure.test.ts — its hidden-Dispatch branch is
// verified by source inspection rather than a full render.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('a hidden Dispatch renders the author\'s calm own-view, never the normal reading view', () => {
  it('branches on moderationStatus === "hidden" before the full data-fetch Promise.all', () => {
    const hiddenBranchIndex = source.indexOf("dispatch.moderationStatus === 'hidden'")
    const promiseAllIndex = source.indexOf('await Promise.all([')
    expect(hiddenBranchIndex).toBeGreaterThan(-1)
    expect(promiseAllIndex).toBeGreaterThan(-1)
    expect(hiddenBranchIndex).toBeLessThan(promiseAllIndex)
  })

  it('the hidden branch renders exactly "Hidden by TEMPA." — no reporter, moderator, or internal reason exposed', () => {
    const hiddenBranchStart = source.indexOf("dispatch.moderationStatus === 'hidden'")
    const hiddenBranchEnd = source.indexOf('await Promise.all([')
    const branch = source.slice(hiddenBranchStart, hiddenBranchEnd)

    expect(branch).toContain('Hidden by TEMPA.')
    expect(branch).not.toMatch(/reason|moderator|report/i)
  })

  it('the hidden branch offers a way back to the Board, and shows the Dispatch\'s own title (not a generic placeholder)', () => {
    const hiddenBranchStart = source.indexOf("dispatch.moderationStatus === 'hidden'")
    const hiddenBranchEnd = source.indexOf('await Promise.all([')
    const branch = source.slice(hiddenBranchStart, hiddenBranchEnd)

    expect(branch).toContain('href="/board"')
    expect(branch).toContain('{dispatch.title}')
  })

  it('the hidden check happens after the getDispatchById lookup and notFound() gate — a nonexistent id is still handled first', () => {
    const notFoundIndex = source.indexOf('notFound()')
    const hiddenBranchIndex = source.indexOf("dispatch.moderationStatus === 'hidden'")
    expect(notFoundIndex).toBeGreaterThan(-1)
    expect(notFoundIndex).toBeLessThan(hiddenBranchIndex)
  })
})
