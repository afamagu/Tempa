import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Post-onboarding corrections checkpoint (Q2) — the first-read Dispatch
// introduction, shown at the start of the AUTHENTICATED reader only,
// never stacked with the Board introduction (a separate page) and never
// merged with MomentHint (contextual Moments microcopy, unchanged). Async
// Server Component with heavy Supabase dependency, same "not directly
// unit-tested" convention as every other page like this in this
// codebase — proven via source inspection instead.
const readerSource = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const guideSource = readFileSync(path.join(__dirname, '..', '..', '..', 'lib', 'guide.ts'), 'utf8')
const sharedReaderSource = readFileSync(
  path.join(__dirname, '..', '..', 'd', '[shareToken]', 'page.tsx'),
  'utf8'
)
const sharedDispatchViewSource = readFileSync(
  path.join(__dirname, '..', '..', 'd', '[shareToken]', 'shared-dispatch-view.tsx'),
  'utf8'
)
const replaySource = readFileSync(path.join(__dirname, '..', '..', 'you', 'guide', 'dispatch-reading', 'page.tsx'), 'utf8')
const guideIndexSource = readFileSync(path.join(__dirname, '..', '..', 'you', 'guide', 'page.tsx'), 'utf8')

describe('Dispatch reading introduction — appearance (Q2)', () => {
  it('is gated on the account-persisted guide_completions state, never unconditionally', () => {
    expect(readerSource).toContain("import { hasCompletedGuide } from '@/lib/guide'")
    expect(readerSource).toContain("hasCompletedGuide(supabase, user.id, 'dispatch_reading')")
    expect(readerSource).toContain('{!readingIntroSeen && (')
  })

  it('has its own dedicated GuideKey, never reusing "board" or "dispatch_composer"', () => {
    expect(guideSource).toContain("'dispatch_reading'")
    const introBlockStart = readerSource.indexOf('{!readingIntroSeen && (')
    const introBlockEnd = readerSource.indexOf(')}', introBlockStart)
    const introBlock = readerSource.slice(introBlockStart, introBlockEnd)
    expect(introBlock).toContain('guideKey="dispatch_reading"')
  })

  it('uses the approved copy direction', () => {
    expect(readerSource).toContain('Reading a Dispatch')
    expect(readerSource).toContain('Start reading')
    expect(readerSource).toContain('mark it Worth Reading, reply publicly, or write privately')
  })

  it('is positioned immediately before the reading surface, never at the end of the Dispatch', () => {
    const introIndex = readerSource.indexOf('guideKey="dispatch_reading"')
    const readerSurfaceIndex = readerSource.indexOf('<DispatchReader')
    const worthReadingIndex = readerSource.indexOf('<WorthReadingButton')
    expect(introIndex).toBeGreaterThan(-1)
    expect(readerSurfaceIndex).toBeGreaterThan(introIndex)
    // Nothing about "the end" (Worth Reading, replies, read-next) sits
    // before it — it's the first thing above the actual reading surface.
    expect(worthReadingIndex).toBeGreaterThan(readerSurfaceIndex)
  })
})

describe('Dispatch reading introduction — completed-guide suppression', () => {
  it('the render gate is the negation of the same completion flag, not a second independent check', () => {
    expect(readerSource).toContain('readingIntroSeen')
    expect(readerSource).toMatch(/!readingIntroSeen/)
  })
})

describe('Dispatch reading introduction — same-page "Start reading" behavior', () => {
  it('passes no onDismiss/onCta on the reader page, so the default (stay put, no navigation) behavior applies — never navigates away', () => {
    const introBlockStart = readerSource.indexOf('<FeatureIntroduction guideKey="dispatch_reading"')
    const introBlockEnd = readerSource.indexOf('</FeatureIntroduction>', introBlockStart)
    const introBlock = readerSource.slice(introBlockStart, introBlockEnd)
    expect(introBlock).not.toContain('onDismiss')
    expect(introBlock).not.toContain('onCta')
    expect(introBlock).not.toContain('router.push')
  })
})

describe('Dispatch reading introduction — never appears on the anonymous shared reader', () => {
  it('the /d/[shareToken] page and its shared-dispatch-view component never import FeatureIntroduction or check this guide key', () => {
    expect(sharedReaderSource).not.toContain('FeatureIntroduction')
    expect(sharedReaderSource).not.toContain('dispatch_reading')
    expect(sharedDispatchViewSource).not.toContain('FeatureIntroduction')
    expect(sharedDispatchViewSource).not.toContain('dispatch_reading')
  })
})

describe('Dispatch reading introduction — Tempa Guide replay', () => {
  it('is added to the Guide index alongside the other five', () => {
    expect(guideIndexSource).toContain("{ key: 'dispatch_reading', title: 'Reading a Dispatch', href: '/you/guide/dispatch-reading' }")
  })

  it('the replay route mounts the introduction unconditionally via the shared replay shell — its own completion state can never suppress it', () => {
    expect(replaySource).toContain('ReplayFeatureIntroduction')
    expect(replaySource).toContain('guideKey="dispatch_reading"')
    // ReplayFeatureIntroduction (app/you/guide/replay-feature-introduction.tsx)
    // always mounts FeatureIntroduction directly, bypassing the normal
    // hasCompletedGuide read-side gate every ordinary call site applies —
    // there is no hasCompletedGuide call in this file to bypass.
    expect(replaySource).not.toContain('hasCompletedGuide')
  })

  it('uses the same title/CTA/copy as the live first-read introduction', () => {
    expect(replaySource).toContain('title="Reading a Dispatch"')
    expect(replaySource).toContain('ctaLabel="Start reading"')
    const normalizedReplay = replaySource.replace(/\s+/g, ' ')
    const normalizedReader = readerSource.replace(/\s+/g, ' ')
    expect(normalizedReplay).toContain('mark it Worth Reading, reply publicly, or write privately')
    expect(normalizedReader).toContain('mark it Worth Reading, reply publicly, or write privately')
  })
})

describe('Dispatch reading introduction — MomentHint unchanged', () => {
  it('MomentHint is still rendered from its own untouched module, unconditionally on the same gate as before (moments with an image)', () => {
    expect(readerSource).toContain("import MomentHint from '../moment-hint'")
    expect(readerSource).toContain('{moments.some((m) => m.imageUrl) && <MomentHint dispatchId={dispatch.id} />}')
  })

  it('the reading introduction and MomentHint are two distinct elements, never merged into one', () => {
    const introBlockStart = readerSource.indexOf('<FeatureIntroduction guideKey="dispatch_reading"')
    const introBlockEnd = readerSource.indexOf('</FeatureIntroduction>', introBlockStart)
    const introBlock = readerSource.slice(introBlockStart, introBlockEnd)
    expect(introBlock).not.toContain('MomentHint')
  })
})
