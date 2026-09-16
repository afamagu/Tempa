import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import FeatureIntroduction from './feature-introduction'

// Onboarding & First-Use checkpoint — the one shared FeatureIntroduction
// architecture. Same SSR-only limitation as every other dismissible
// client component in this codebase: dismissal (useState + the
// guide_completions write) can't be exercised via renderToStaticMarkup,
// so this proves the default (not-yet-dismissed) render shape and its
// static contract; app/minds/page.tsx, app/board/page.tsx, and
// app/board/dispatch-composer.tsx's own tests prove the read-side gate
// (only mounted when !hasCompletedGuide) at their own call sites.
describe('FeatureIntroduction — default render', () => {
  it('renders the title, body, and CTA label given', () => {
    const html = renderToStaticMarkup(
      <FeatureIntroduction guideKey="people" title="People worth writing to" ctaLabel="Start exploring">
        <p>Open someone&rsquo;s profile and write when somebody catches your attention.</p>
      </FeatureIntroduction>
    )
    expect(html).toContain('People worth writing to')
    expect(html).toContain('Open someone')
    expect(html).toContain('Start exploring')
  })

  it('offers a dismiss control with a real accessible name, distinct from the CTA', () => {
    const html = renderToStaticMarkup(
      <FeatureIntroduction guideKey="board" title="The Board" ctaLabel="See what's on the Board">
        <p>Body.</p>
      </FeatureIntroduction>
    )
    expect(html).toMatch(/aria-label="Dismiss"/)
    // Two distinct buttons: the small "×" dismiss and the CTA.
    expect((html.match(/<button/g) ?? []).length).toBe(2)
  })

  it('is never a browser alert, never a modal/dialog, never a full-screen takeover', () => {
    const html = renderToStaticMarkup(
      <FeatureIntroduction guideKey="postcard" title="Send something from somewhere" ctaLabel="Choose a Postcard">
        <p>Body.</p>
      </FeatureIntroduction>
    )
    expect(html).not.toMatch(/role="dialog"/)
    expect(html).not.toContain('fixed inset-0')
  })

  it('is a small, self-contained card — not an unstyled bare note', () => {
    const html = renderToStaticMarkup(
      <FeatureIntroduction guideKey="dispatch_composer" title="Leave something on the Board" ctaLabel="Start writing">
        <p>Body.</p>
      </FeatureIntroduction>
    )
    expect(html).toMatch(/rounded-lg border/)
  })

  it('never requires a "Don\'t show this again" checkbox — dismissal is a single action', () => {
    const html = renderToStaticMarkup(
      <FeatureIntroduction guideKey="people" title="People worth writing to" ctaLabel="Start exploring">
        <p>Body.</p>
      </FeatureIntroduction>
    )
    expect(html).not.toContain('type="checkbox"')
  })
})

describe('FeatureIntroduction — source-level: dismissal writes to the existing guide_completions architecture, never a second persistence system', () => {
  it('calls markGuideCompleted with the given guideKey on dismiss, from lib/guide.ts — no new table/RPC', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./feature-introduction.tsx', import.meta.url), 'utf8')
    )
    expect(source).toContain("import { markGuideCompleted, type GuideKey } from '@/lib/guide'")
    expect(source).toContain('markGuideCompleted(supabase, guideKey)')
    expect(source).not.toContain('sessionStorage')
    expect(source).not.toContain('localStorage')
  })

  // Checkpoint 2B, Section C — "seen it" (an INSERT into
  // guide_completions) must never be conflated with "delete/hide this
  // explanation permanently." This component performs no delete/update
  // of any kind — dismissal only ever ADDS a completion row; the
  // introduction's own content is never touched, which is exactly what
  // makes an unconditional replay (app/you/guide/replay-feature-
  // introduction.tsx) safe to mount regardless of completion state.
  it('performs no delete/update of any kind — dismissal is purely an additive completion record', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./feature-introduction.tsx', import.meta.url), 'utf8')
    )
    expect(source).not.toContain('.delete(')
    expect(source).not.toContain('.update(')
    expect(source).not.toContain('.upsert(')
  })
})
