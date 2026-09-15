import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import MomentHint from './moment-hint'

// Same SSR-only limitation as every other interactive control in this
// codebase (see author-actions-menu.test.tsx's own comment) — dismissal
// is internal `useState` + `sessionStorage`, which renderToStaticMarkup
// can't exercise. This proves the hint's default (first-visit) shape:
// restrained, one line, dismissible, never a modal. Shared between the
// external reader (app/d/[shareToken]/shared-dispatch-view.tsx) and the
// authenticated reader (app/board/[dispatchId]/page.tsx) — see each
// consumer's own test/usage for the "only when a Moment resolves"
// gating, which lives at the call site, not in this component.
//
// Dispatch Culture Polish Pass: now rendered through the shared
// TempaNote primitive (app/tempa-note.tsx) — see tempa-note.test.tsx
// for the primitive's own contract (clay rule, "Tempa Note" label).
describe('MomentHint — restrained, dismissible, one-time explanation, shared internal/external', () => {
  it('shows the restrained explanation copy by default', () => {
    const html = renderToStaticMarkup(<MomentHint dispatchId="d-1" />)
    expect(html).toContain('A glimpse from the writer')
    expect(html).toContain('Tap a small image as you read to open it.')
  })

  it('is rendered through TempaNote — the clay left rule and "Tempa Note" label', () => {
    const html = renderToStaticMarkup(<MomentHint dispatchId="d-1" />)
    expect(html).toMatch(/border-clay/)
    expect(html).toContain('Tempa Note')
  })

  it('is a plain inline element, never a modal/dialog', () => {
    const html = renderToStaticMarkup(<MomentHint dispatchId="d-1" />)
    expect(html).not.toMatch(/role="dialog"/)
    expect(html).not.toContain('fixed inset-0')
  })

  it('offers a dismiss control with a real accessible name', () => {
    const html = renderToStaticMarkup(<MomentHint dispatchId="d-1" />)
    expect(html).toMatch(/aria-label="Dismiss this hint"/)
  })
})
