import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SharedDispatchView from './shared-dispatch-view'
import DispatchUnavailable from './dispatch-unavailable'
import type { SharedDispatch } from '@/lib/dispatches'

function dispatch(overrides: Partial<SharedDispatch> = {}): SharedDispatch {
  return {
    id: 'd-1',
    title: 'A quiet morning ritual',
    body: 'First paragraph.\n\nSecond paragraph.',
    publishedAt: '2026-09-08T12:00:00Z',
    authorPseudonym: 'Evening Quill',
    authorCountry: null,
    topics: ['mornings'],
    moments: [],
    ...overrides,
  }
}

describe('SharedDispatchView — reads the entire Dispatch before joining', () => {
  it('renders the full title, body, pseudonym, and topics', () => {
    const html = renderToStaticMarkup(<SharedDispatchView dispatch={dispatch()} isAuthenticated={false} />)
    expect(html).toContain('A quiet morning ritual')
    expect(html).toContain('First paragraph.')
    expect(html).toContain('Second paragraph.')
    expect(html).toContain('Evening Quill')
    expect(html).toContain('mornings')
  })

  it('19. the Join Tempa CTA is additive — the full writing renders alongside it, never behind it', () => {
    const html = renderToStaticMarkup(<SharedDispatchView dispatch={dispatch()} isAuthenticated={false} />)
    expect(html).toContain('Join Tempa')
    expect(html).toContain('First paragraph.')
    expect(html).toContain('Second paragraph.')
  })

  // Board live-test corrections (2026-09-10): the wordmark rule reserves
  // the italic-serif "Tempa" treatment for an actual masthead position —
  // never all-caps "TEMPA" anywhere, and never italicized inside an
  // ordinary sentence/button below the masthead.
  it('never renders the all-caps wordmark "TEMPA" anywhere', () => {
    const html = renderToStaticMarkup(<SharedDispatchView dispatch={dispatch()} isAuthenticated={false} />)
    expect(html).not.toContain('TEMPA')
  })

  it('the Join CTA routes to account creation first, not a bare sign-in', () => {
    const html = renderToStaticMarkup(<SharedDispatchView dispatch={dispatch()} isAuthenticated={false} />)
    expect(html).toContain('href="/sign-in?intent=join"')
  })

  // Board live-test corrections (2026-09-10): pen-pal/correspondence
  // positioning, not a Medium-style "discover more content" line.
  it('positions Tempa as a pen-pal experience, not a content-discovery platform', () => {
    const html = renderToStaticMarkup(<SharedDispatchView dispatch={dispatch()} isAuthenticated={false} />)
    expect(html).toContain('pen-pal')
    expect(html).not.toContain('Discover more minds and writing like this.')
  })

  it('shows a country flag beside the author when one is available', () => {
    const html = renderToStaticMarkup(
      <SharedDispatchView dispatch={dispatch({ authorCountry: 'Japan' })} isAuthenticated={false} />
    )
    expect(html).toContain('src="/flags/JP.svg"')
  })

  it('shows no flag, and no broken layout, when no country is available', () => {
    const html = renderToStaticMarkup(
      <SharedDispatchView dispatch={dispatch({ authorCountry: null })} isAuthenticated={false} />
    )
    expect(html).not.toMatch(/aria-label="Country:/)
  })

  // Board live-test corrections (2026-09-10): a restrained, one-time
  // hint appears only when the Dispatch actually has a visible Moment —
  // never for plain text, never per-image, never a modal.
  it('shows the Moment discovery hint when a Moment has a resolved image', () => {
    const html = renderToStaticMarkup(
      <SharedDispatchView
        dispatch={dispatch({ moments: [{ id: 'm-1', position: 0, imageUrl: 'https://signed.test/a.jpg' }] })}
        isAuthenticated={false}
      />
    )
    expect(html).toContain('A glimpse from the writer')
  })

  it('shows no Moment hint when the Dispatch has no Moments', () => {
    const html = renderToStaticMarkup(<SharedDispatchView dispatch={dispatch({ moments: [] })} isAuthenticated={false} />)
    expect(html).not.toContain('A glimpse from the writer')
  })

  it('8. renders Moments only from the data it was given', () => {
    const html = renderToStaticMarkup(
      <SharedDispatchView
        dispatch={dispatch({ moments: [{ id: 'm-1', position: 0, imageUrl: 'https://signed.test/a.jpg' }] })}
        isAuthenticated={false}
      />
    )
    expect(html).toContain('https://signed.test/a.jpg')
  })

  it('18. an authenticated visitor sees a route into the Board instead of a Join prompt, and still reads the full Dispatch', () => {
    const html = renderToStaticMarkup(<SharedDispatchView dispatch={dispatch()} isAuthenticated />)
    expect(html).toContain('Go to The Board')
    expect(html).toContain('href="/board"')
    expect(html).not.toContain('Join Tempa')
    expect(html).toContain('First paragraph.')
  })

  it('10/11/12/13. exposes no Board/Keep/profile/feed-continuation affordance of any kind', () => {
    const html = renderToStaticMarkup(<SharedDispatchView dispatch={dispatch()} isAuthenticated={false} />)
    const lower = html.toLowerCase()
    expect(lower).not.toContain('keep')
    expect(lower).not.toContain('/minds/')
    expect(lower).not.toContain('/letters')
    expect(lower).not.toContain('/you')
    expect(lower).not.toContain('search')
    expect(lower).not.toContain('swipe')
    expect(lower).not.toContain('up next')
    expect(lower).not.toContain('next dispatch')
    expect(lower).not.toContain('carousel')
  })

  it('never links to the writer\'s profile or any other Dispatch', () => {
    const html = renderToStaticMarkup(<SharedDispatchView dispatch={dispatch()} isAuthenticated={false} />)
    expect(html).not.toMatch(/<a[^>]*href="\/minds/)
    expect(html).not.toMatch(/<a[^>]*href="\/board\/[^"]+"/)
  })

  // Visual-rule follow-up (2026-09-09): the writing sits on the same
  // bg-surface-shell paper token as the private-letter reader and the
  // authenticated Dispatch reader — never a new/invented colour — while
  // the surrounding furniture (TEMPA mark, identity, title, topics,
  // Join CTA) stays on the ordinary page background.
  it('wraps only the writing body in bg-surface-shell — the same paper token as the private-letter and authenticated readers', () => {
    const html = renderToStaticMarkup(<SharedDispatchView dispatch={dispatch()} isAuthenticated={false} />)
    expect(html).toMatch(/class="[^"]*bg-surface-shell[^"]*"[^>]*>[\s\S]*First paragraph\./)
  })

  it('does not tint the surrounding identity/title/CTA furniture', () => {
    const html = renderToStaticMarkup(<SharedDispatchView dispatch={dispatch()} isAuthenticated={false} />)
    // Exactly one bg-surface-shell wrapper exists — the paper card
    // around the body — not one around the whole page or the CTA.
    expect((html.match(/bg-surface-shell/g) ?? []).length).toBe(1)
  })
})

describe('DispatchUnavailable — the same quiet state for any failure reason', () => {
  it('shows generic copy, never revealing why the Dispatch is unavailable', () => {
    const html = renderToStaticMarkup(<DispatchUnavailable />)
    expect(html).toContain('This Dispatch is no longer available.')
    expect(html.toLowerCase()).not.toContain('revoked')
    expect(html.toLowerCase()).not.toContain('unpublished')
    expect(html.toLowerCase()).not.toContain('invalid token')
  })

  it('offers a Join Tempa path, not a dead end, routed to account creation', () => {
    const html = renderToStaticMarkup(<DispatchUnavailable />)
    expect(html).toContain('Join Tempa')
    expect(html).toContain('href="/sign-in?intent=join"')
  })

  it('never implies the writer chose to stop sharing — that would leak "revoked" specifically', () => {
    const html = renderToStaticMarkup(<DispatchUnavailable />)
    expect(html.toLowerCase()).not.toContain('stopped sharing')
  })

  it('never renders the all-caps wordmark "TEMPA"', () => {
    const html = renderToStaticMarkup(<DispatchUnavailable />)
    expect(html).not.toContain('TEMPA')
  })
})
