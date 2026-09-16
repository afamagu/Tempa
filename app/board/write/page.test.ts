import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Onboarding & First-Use checkpoint — Dispatch composer + Postcard
// FeatureIntroductions, resolved server-side and passed down (this
// page's own DispatchComposer child is a client component).
const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('Dispatch write page — resolves both FeatureIntroduction gates once, passes them to the composer', () => {
  it('checks both guide keys via the existing guide_completions architecture, no new persistence', () => {
    expect(source).toContain("import { hasCompletedGuide } from '@/lib/guide'")
    expect(source).toContain("hasCompletedGuide(supabase, user.id, 'dispatch_composer')")
    expect(source).toContain("hasCompletedGuide(supabase, user.id, 'postcard')")
  })

  it('passes showComposerIntro/showPostcardIntro as the inverse of already-completed', () => {
    expect(source).toContain('showComposerIntro={!composerIntroSeen}')
    expect(source).toContain('showPostcardIntro={!postcardIntroSeen}')
  })
})
