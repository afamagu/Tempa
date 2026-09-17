import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import ReplayFeatureIntroduction from './replay-feature-introduction'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))

const source = readFileSync(new URL('./replay-feature-introduction.tsx', import.meta.url), 'utf8')

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

// Post-onboarding corrections checkpoint (Section F) — a live smoke test
// found every replay CTA (labeled action) just closed back to /you/guide,
// identical to the small "×" — e.g. Board's "See what's on the Board"
// never actually went to /board. The × and the labeled CTA must now
// genuinely differ: × always returns to /you/guide; the CTA goes to
// whatever destinationHref the call site promises.
describe('ReplayFeatureIntroduction — the × and the CTA are no longer the same action (Section F)', () => {
  it('the × (onDismiss) always returns to /you/guide, regardless of destinationHref', () => {
    expect(source).toContain("onDismiss={() => router.push('/you/guide')}")
  })

  it('the CTA (onCta) navigates to destinationHref specifically — a genuinely different callback from onDismiss', () => {
    expect(source).toContain('onCta={() => router.push(destinationHref)}')
  })

  it('destinationHref defaults to /you/guide, preserving prior behavior for a call site that never sets it', () => {
    expect(source).toContain("destinationHref = '/you/guide'")
  })
})
