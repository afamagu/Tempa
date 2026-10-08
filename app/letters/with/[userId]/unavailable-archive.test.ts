import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('Letter archive when a correspondent profile is unavailable', () => {
  it('keeps a retained archive readable when the profile row is gone', () => {
    expect(source).toContain('const hasHistoricalAccess = letters.length > 0 || visibleCorrespondenceIds.length > 0')
    expect(source).toContain('if (!otherProfile && !hasHistoricalAccess)')
    expect(source).toContain("const otherPseudonym = otherProfile?.pseudonym ?? 'A Tempa member'")
    expect(source).toContain('This profile is no longer available. Your letters remain here.')
  })

  it('does not leave dead profile/write actions for an unavailable or unestablished member', () => {
    expect(source).toContain('{otherProfile ? (')
    expect(source).toContain('{otherProfile && activeCorrespondence && establishedForViewer && (')
    expect(source).toContain('<WriteQuillButton otherUserId={otherProfile.id}')
    expect(source).not.toContain('if (!otherProfile) {\n    notFound()\n  }')
  })

  it('gives an unestablished incoming first letter a direct reply route instead of the established quill', () => {
    expect(source).toContain('const replyableFirstLetter =')
    expect(source).toContain("letter.status === 'closed' && letter.closedBy === 'system'")
    expect(source).toContain('Reply to this first letter')
    expect(source).toContain('href={`/letters/${replyableFirstLetter.id}`}')
  })

  it('still sends an invalid archive URL to the correspondence unavailable state', () => {
    expect(source).toMatch(/if \(!otherProfile && !hasHistoricalAccess\) \{\s*notFound\(\)\s*\}/)
  })
})


describe('Letter archive management polish', () => {
  it('has no second whole-correspondence removal control in the person header or footer', () => {
    expect(source).not.toContain('RemoveFromLetterbox')
    expect(source).not.toContain('Remove from my Letterbox')
  })

  it('surfaces the one-follow-up action for an unanswered first contact', () => {
    expect(source).toContain('One follow-up is available.')
    expect(source).toContain('Write one follow-up')
    expect(source).toContain('?followUp=1')
  })
})
