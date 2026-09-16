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
  // Reader Polish Checkpoint (final copy pass) — the exact, intentional
  // final wording: more than a mechanical image instruction, Moments are
  // small glimpses into the writer's world encountered while reading.
  it('shows the exact final explanation copy', () => {
    const html = renderToStaticMarkup(<MomentHint dispatchId="d-1" />)
    // Matches the project's typographic-apostrophe convention (&rsquo; in
    // JSX renders as the real U+2019 character, never a re-escaped entity).
    expect(html).toContain('Little glimpses from the writer’s world may appear along the way. Tap a Moment to open it.')
  })

  it('never mentions "postcard" — this hint is gated on a photo Moment only, never on an attached Postcard', () => {
    const html = renderToStaticMarkup(<MomentHint dispatchId="d-1" />)
    expect(html.toLowerCase()).not.toContain('postcard')
  })

  it('never mentions "image" — uses the real product term "Moment" instead', () => {
    const html = renderToStaticMarkup(<MomentHint dispatchId="d-1" />)
    expect(html.toLowerCase()).not.toContain('image')
  })

  it('never mentions audio or any future feature — this checkpoint is copy-only, no feature list', () => {
    const html = renderToStaticMarkup(<MomentHint dispatchId="d-1" />)
    expect(html.toLowerCase()).not.toContain('audio')
  })

  it('is rendered through TempaNote — the clay left rule and "Tempa Note" label', () => {
    const html = renderToStaticMarkup(<MomentHint dispatchId="d-1" />)
    expect(html).toMatch(/border-clay/)
    expect(html).toContain('Tempa Note')
  })

  // Reader Polish Checkpoint — inherits TempaNote's own italic body
  // treatment automatically, with no change needed in this file (see
  // app/tempa-note.test.tsx for the primitive's own contract).
  it('the explanatory body copy is italic', () => {
    const html = renderToStaticMarkup(<MomentHint dispatchId="d-1" />)
    expect(html).toMatch(/class="italic /)
  })

  it('the "Tempa Note" label itself is never italicized — only the body copy is', () => {
    const html = renderToStaticMarkup(<MomentHint dispatchId="d-1" />)
    const labelMatch = html.match(/<p class="([^"]*)">Tempa Note<\/p>/)
    expect(labelMatch).not.toBeNull()
    expect(labelMatch![1]).not.toContain('italic')
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
