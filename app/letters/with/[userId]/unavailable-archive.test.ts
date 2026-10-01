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

  it('does not leave dead profile/write actions for an unavailable member', () => {
    expect(source).toContain('{otherProfile ? (')
    expect(source).toContain('{otherProfile && <WriteQuillButton')
    expect(source).not.toContain('if (!otherProfile) {\n    notFound()\n  }')
  })

  it('still sends an invalid archive URL to the correspondence unavailable state', () => {
    expect(source).toMatch(/if \(!otherProfile && !hasHistoricalAccess\) \{\s*notFound\(\)\s*\}/)
  })
})
