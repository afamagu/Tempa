import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import QuestionIncompleteNotice from './question-incomplete-notice'

describe('QuestionIncompleteNotice', () => {
  it('uses the established tone — no guilt, streaks, or urgency — with a clear CTA and a Not now dismissal', () => {
    const html = renderToStaticMarkup(<QuestionIncompleteNotice />)
    expect(html).toContain("Share your answer when you&#x27;re ready.")
    expect(html).toContain('It helps other minds discover you.')
    expect(html).toContain('href="/minds?view=answer"')
    expect(html).toContain('Not now')
  })

  it('never uses guilt/urgency language', () => {
    const html = renderToStaticMarkup(<QuestionIncompleteNotice />)
    expect(html.toLowerCase()).not.toContain('streak')
    expect(html.toLowerCase()).not.toContain('hurry')
    expect(html.toLowerCase()).not.toContain('miss out')
    expect(html.toLowerCase()).not.toContain('deadline')
  })

  // Home consolidation checkpoint — this same component is now reused
  // on Home as the non-blocking Question reminder (see app/home/page.tsx).
  // Non-blocking means: no modal/dialog semantics, and a genuine
  // dismiss control that isn't merely decorative.
  it('is a plain card, never a modal/dialog — nothing about it blocks the rest of the page', () => {
    const html = renderToStaticMarkup(<QuestionIncompleteNotice />)
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain('role="alertdialog"')
    expect(html).not.toContain('aria-modal')
  })

  it('presents through the shared system-voice card treatment (a bordered/background container), not a plain unstyled line', () => {
    const html = renderToStaticMarkup(<QuestionIncompleteNotice />)
    expect(html).toMatch(/class="[^"]*\bborder\b[^"]*"/)
  })
})
