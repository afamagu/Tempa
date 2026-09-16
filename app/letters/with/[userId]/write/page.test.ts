import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Onboarding & First-Use checkpoint (Checkpoint 2B, Section A) — the
// Write Anytime composer page, resolving the SAME shared 'postcard'
// guide_completions key the Dispatch composer's own page already uses
// (app/board/write/page.tsx). Async Server Component with heavy
// Supabase dependency, same "not directly unit-tested" convention as
// every other page like this in this codebase.
const dispatchWriteSource = readFileSync(
  path.join(__dirname, '..', '..', '..', '..', 'board', 'write', 'page.tsx'),
  'utf8'
)
const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('Write Anytime page — Postcard FeatureIntroduction, cross-surface with the Dispatch composer', () => {
  it('checks the SAME guide key ("postcard") the Dispatch composer checks — never a second, surface-specific key', () => {
    expect(source).toContain("hasCompletedGuide(supabase, user.id, 'postcard')")
    expect(dispatchWriteSource).toContain("hasCompletedGuide(supabase, user.id, 'postcard')")
    expect(source).not.toContain('letter_postcard')
  })

  it('passes showPostcardIntro as the inverse of already-completed, same convention as the Dispatch composer', () => {
    expect(source).toContain('showPostcardIntro={!postcardIntroSeen}')
  })

  it('never touches correspondence resolution/sending mechanics — the existing establishment/reply-resolution calls are unchanged', () => {
    expect(source).toContain('getActiveEstablishedCorrespondenceWithUser(supabase, user.id, otherUserId)')
    expect(source).toContain('isEstablishedForViewer(supabase, correspondence.id)')
    expect(source).toContain('resolveReplyToId(')
  })
})
