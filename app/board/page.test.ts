import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Onboarding & First-Use checkpoint — the Board FeatureIntroduction.
// Async Server Component with heavy Supabase dependency, same "not
// directly unit-tested" convention as every other page like this.
const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('Board page — FeatureIntroduction, shown once at first encounter', () => {
  it('gated on the account-persisted guide_completions state, never unconditionally', () => {
    expect(source).toContain("import { hasCompletedGuide } from '@/lib/guide'")
    expect(source).toContain("hasCompletedGuide(supabase, user.id, 'board')")
    expect(source).toContain('{!introSeen && (')
    expect(source).toContain('<FeatureIntroduction guideKey="board"')
  })

  it('uses the approved copy direction', () => {
    expect(source).toContain('The Board')
    expect(source).toContain('Writing meant to be stumbled upon.')
    expect(source).toContain("See what's on the Board")
  })

  it('never touches Board ranking/query logic — the same getBoardFeedPage call, same searchDispatches call, unchanged', () => {
    expect(source).toContain('getBoardFeedPage(supabase, { sessionStartedAt: s!, seed: seed!, cursor: null })')
    expect(source).toContain('searchDispatches(supabase, query)')
  })
})
