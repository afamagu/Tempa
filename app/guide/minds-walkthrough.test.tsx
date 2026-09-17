import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import MindsWalkthrough from './minds-walkthrough'

describe('MindsWalkthrough', () => {
  it('always exposes a working Close affordance on its first screen — never a trap', () => {
    const html = renderToStaticMarkup(<MindsWalkthrough onExit={() => {}} onFinish={() => {}} />)
    expect(html).toContain('aria-label="Close"')
    expect(html).toContain('Close')
  })

  it('is a full-screen overlay, which is why it must only ever be reached by deliberately opening it (see app/you/guide/minds), never auto-shown on a primary nav destination', () => {
    const html = renderToStaticMarkup(<MindsWalkthrough onExit={() => {}} onFinish={() => {}} />)
    expect(html).toMatch(/class="[^"]*\bfixed\b[^"]*\binset-0\b[^"]*"/)
  })

  it('never uses letter/correspondence vocabulary', () => {
    const html = renderToStaticMarkup(<MindsWalkthrough onExit={() => {}} onFinish={() => {}} />)
    expect(html.toLowerCase()).not.toContain('send letter')
    expect(html.toLowerCase()).not.toContain('mail call')
  })

  // Post-onboarding corrections checkpoint (Section E) — this replay-only
  // walkthrough (guide key 'minds', reached from /you/guide/minds) still
  // said "Welcome to Minds" after the product-wide People rename. Fixed
  // to "Welcome to People"; the route and guide_key stay 'minds'
  // deliberately (internal identifiers, not user-visible copy).
  it('says "Welcome to People", never "Welcome to Minds" — screen 1 is user-visible copy, not an internal identifier', () => {
    const html = renderToStaticMarkup(<MindsWalkthrough onExit={() => {}} onFinish={() => {}} />)
    expect(html).toContain('Welcome to People')
    expect(html).not.toContain('Welcome to Minds')
  })
})
