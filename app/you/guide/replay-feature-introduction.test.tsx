import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ReplayFeatureIntroduction from './replay-feature-introduction'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))

// Onboarding & First-Use checkpoint (Section O) — the shared replay
// shell, mirroring app/you/guide/minds/replay.tsx's existing pattern for
// the two full walkthroughs.
describe('ReplayFeatureIntroduction — mounts the introduction directly, bypassing the normal completed-state gate', () => {
  it('renders the given introduction unconditionally, regardless of any completion state', () => {
    const html = renderToStaticMarkup(
      <ReplayFeatureIntroduction guideKey="people" title="People worth writing to" ctaLabel="Start exploring">
        <p>Body copy.</p>
      </ReplayFeatureIntroduction>
    )
    expect(html).toContain('People worth writing to')
    expect(html).toContain('Body copy.')
    expect(html).toContain('Start exploring')
  })
})
