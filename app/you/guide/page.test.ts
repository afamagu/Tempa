import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Onboarding & First-Use checkpoint (Section O) — the four new
// FeatureIntroduction entries, added to the SAME existing, already-
// extensible GUIDES list the two full walkthroughs (minds/moments)
// already use — never a second Help Center.
const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('Tempa Guide index — replayable FeatureIntroductions added to the existing list', () => {
  it('lists all five lightweight introductions alongside the two existing full walkthroughs', () => {
    for (const href of [
      '/you/guide/minds',
      '/you/guide/moments',
      '/you/guide/people',
      '/you/guide/board',
      '/you/guide/dispatch-composer',
      '/you/guide/postcard',
      '/you/guide/dispatch-reading',
    ]) {
      expect(source).toContain(`href: '${href}'`)
    }
  })

  it('is still one small array-driven list, not a rebuilt/second Help Center', () => {
    expect(source).toContain('const GUIDES = [')
    expect(source).toContain('{GUIDES.map((guide) => (')
  })
})
