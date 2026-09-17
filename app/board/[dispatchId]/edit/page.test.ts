import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Smoke-test contract completion checkpoint (Section G) — a direct/
// bookmarked visit to /board/[dispatchId]/edit after the 30-minute
// window closes or a Reply has landed is redirected away, the same
// courtesy the existing non-author guard already provides. This is a
// courtesy only — update_dispatch itself is the actual enforcement
// boundary (see lib/dispatches.test.ts's own eligibility coverage) —
// so a possibly-stale read here can never create an unsafe edit, only
// at worst briefly show the composer before Save safely rejects it.
// Async Server Component with a heavy Supabase dependency, same "not
// directly unit-tested" convention as every other page like this in
// this codebase — proven via source inspection instead.
const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('EditDispatchPage — eligibility redirect (Section G)', () => {
  it('imports the same pure eligibility helpers the reader page and lib/dispatches.test.ts both use — no reimplementation', () => {
    expect(source).toContain('isWithinDispatchEditWindow')
    expect(source).toContain('canEditDispatch')
    expect(source).toContain("from '@/lib/dispatches'")
  })

  it('reads Replies through the same getDispatchReplies helper the reader page uses — no second query shape', () => {
    expect(source).toContain("import { getDispatchReplies } from '@/lib/replies'")
    expect(source).toContain('getDispatchReplies(supabase, dispatch.id)')
  })

  it('redirects to the reader page when ineligible, the same destination the existing non-author guard already uses', () => {
    expect(source).toContain('if (!editable) {')
    const guardStart = source.indexOf('if (!editable) {')
    const guardEnd = source.indexOf('\n  }', guardStart)
    expect(source.slice(guardStart, guardEnd)).toContain('redirect(`/board/${dispatch.id}`)')
  })

  it('the eligibility check runs AFTER the existing author guard, never before it — never reveals eligibility state to a non-author', () => {
    const authorGuardIndex = source.indexOf('if (dispatch.authorId !== user.id)')
    const eligibilityGuardIndex = source.indexOf('if (!editable) {')
    expect(authorGuardIndex).toBeGreaterThan(-1)
    expect(eligibilityGuardIndex).toBeGreaterThan(authorGuardIndex)
  })

  it('passes isAuthor: true unconditionally — reachable only after the author guard above already confirmed it', () => {
    expect(source).toContain('isAuthor: true,')
  })
})
