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

describe('Write Anytime page — repeated-first-photo-explanation fix', () => {
  it('reads the durable per-correspondence acknowledgement, not just photoConsentStatus, to decide isFirstPhotoRequest', () => {
    expect(source).toContain(
      "hasAcknowledgedCorrespondenceFeature(supabase, user.id, correspondence.id, 'first_photo_notice')"
    )
    expect(source).toContain(
      "correspondence.photoConsentStatus === 'no_request' && !firstPhotoNoticeAcknowledged"
    )
  })

  it('never derives isFirstPhotoRequest from photoConsentStatus alone any more', () => {
    expect(source).not.toContain("const isFirstPhotoRequest = correspondence.photoConsentStatus === 'no_request'\n")
  })
})

describe('Write Anytime page — "View [pseudonym]\'s letter" source data', () => {
  it('fetches the source letter body in the SAME round trip as replyToId resolution, never a second query keyed on the raw searchParam', () => {
    const start = source.indexOf('const { data: replyToLetterRow }')
    const end = source.indexOf('const replyToId = resolveReplyToId(')
    const block = source.slice(start, end)
    expect(block).toContain("select('id, correspondence_id, body')")
  })

  it('resolves sourceLetter from the VALIDATED replyToId, never the raw replyTo searchParam', () => {
    const start = source.indexOf('const sourceLetter =')
    const end = source.indexOf('return (', start)
    const block = source.slice(start, end)
    expect(block).toContain('const sourceLetter = replyToId')
    expect(block).toContain('id: replyToId,')
  })

  it('is null for a fresh, non-reply Write Anytime letter — never fabricated', () => {
    const start = source.indexOf('const sourceLetter =')
    const end = source.indexOf('return (', start)
    const block = source.slice(start, end)
    expect(block.trim().endsWith(': null')).toBe(true)
  })

  it('fetches this exact source letter\'s Moments (for the panel) using the existing getMomentsForLetters helper — no new photo-fetch path', () => {
    expect(source).toContain('getMomentsForLetters(supabase, [replyToId])')
  })

  it('passes viewerId and sourceLetter through to MomentsComposer', () => {
    expect(source).toContain('viewerId={user.id}')
    expect(source).toContain('sourceLetter={sourceLetter}')
  })
})
