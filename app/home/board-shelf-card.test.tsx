import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import BoardShelfCard from './board-shelf-card'
import type { DispatchListItem } from '@/lib/dispatches'

function item(overrides: Partial<DispatchListItem> = {}): DispatchListItem {
  return {
    id: 'd-1',
    authorId: 'author-1',
    authorPseudonym: 'Evening Quill',
    authorCountry: null,
    title: 'A quiet morning ritual',
    body: 'A short Dispatch preview line for the Home shelf.',
    publishedAt: '2026-09-07T12:00:00Z',
    moderationStatus: 'visible',
    topics: [],
    ...overrides,
  }
}

describe('BoardShelfCard', () => {
  it('links to the Dispatch reader', () => {
    const html = renderToStaticMarkup(<BoardShelfCard dispatch={item()} />)
    expect(html).toContain('href="/board/d-1"')
  })

  it('shows title, excerpt, pseudonym, and date — writing-first content', () => {
    const html = renderToStaticMarkup(<BoardShelfCard dispatch={item()} />)
    expect(html).toContain('A quiet morning ritual')
    expect(html).toContain('Evening Quill')
    expect(html).toContain('A short Dispatch preview line')
  })

  it('keeps Moment imagery inside the Dispatch instead of competing with the author Mark', () => {
    const html = renderToStaticMarkup(<BoardShelfCard dispatch={item()} />)
    expect(html).not.toContain('object-cover')
  })

  // Visual-fidelity pass (2026-09-10): the Moment discovery hint is an
  // opened-Dispatch education treatment (see app/board/moment-hint.tsx)
  // — it must never appear on a listing card.
  it('never renders the Moment discovery hint on a listing card', () => {
    const html = renderToStaticMarkup(<BoardShelfCard dispatch={item()} />)
    expect(html).not.toContain('Little glimpses from the writer')
  })

  it('is a plain wide card with no swipe/carousel/drag affordance of its own', () => {
    const html = renderToStaticMarkup(<BoardShelfCard dispatch={item()} />)
    const lower = html.toLowerCase()
    expect(lower).not.toContain('swipe')
    expect(lower).not.toContain('carousel')
    expect(html).not.toContain('ondrag')
  })

  // Board usability visual follow-up (2026-09-09).
  it('wraps only the excerpt in the shared bg-surface-shell authored-paper surface', () => {
    const html = renderToStaticMarkup(<BoardShelfCard dispatch={item()} />)
    expect(html).toMatch(/class="[^"]*bg-surface-shell[^"]*"[^>]*>[\s\S]*A short Dispatch preview line/)
  })

  it('renders a country name beside the pseudonym when the author has a country recorded', () => {
    const html = renderToStaticMarkup(<BoardShelfCard dispatch={item({ authorCountry: 'Japan' })} />)
    expect(html).toContain('Japan')
    expect(html).not.toContain('/flags/')
  })

  it('renders no country label when the author has no country recorded', () => {
    const html = renderToStaticMarkup(<BoardShelfCard dispatch={item({ authorCountry: null })} />)
    expect(html).not.toMatch(/aria-label="Country:/)
  })

  // Live-test regression (Checkpoint 1C, §7): the Home Board shelf's
  // author pseudonym must itself link to /minds/[authorId] — the whole
  // card used to be one single Link to /board/[id], leaving no way to
  // reach the author's profile without opening the Dispatch first.
  it('the author pseudonym links to their profile', () => {
    const html = renderToStaticMarkup(<BoardShelfCard dispatch={item()} />)
    expect(html).toMatch(/<a[^>]*href="\/minds\/author-1"[^>]*>[\s\S]*Evening Quill[\s\S]*<\/a>/)
  })

  it('never nests the profile link inside the Dispatch-reader link — two sibling anchors, not one inside the other', () => {
    const html = renderToStaticMarkup(<BoardShelfCard dispatch={item()} />)
    const profileLinkEnd = html.indexOf('</a>', html.indexOf('href="/minds/author-1"'))
    const readerLinkStart = html.indexOf('href="/board/d-1"')
    expect(profileLinkEnd).toBeGreaterThan(-1)
    expect(profileLinkEnd).toBeLessThan(readerLinkStart)
  })

  // Home Phase 1 (Reading Trail) — identical contract to
  // dispatch-card.test.tsx's own trailQuery coverage.
  describe('Reading Trail — trailQuery', () => {
    it('appends the trail query string to the Dispatch link when supplied', () => {
      const html = renderToStaticMarkup(
        <BoardShelfCard dispatch={item()} trailQuery="s=2026-09-01T00%3A00%3A00Z&seed=abc&tier=1&aseq=2&shash=5" />
      )
      expect(html).toContain('href="/board/d-1?s=2026-09-01T00%3A00%3A00Z&amp;seed=abc&amp;tier=1&amp;aseq=2&amp;shash=5"')
    })

    it('omits the query string entirely when trailQuery is not supplied', () => {
      const html = renderToStaticMarkup(<BoardShelfCard dispatch={item()} />)
      expect(html).toContain('href="/board/d-1"')
      expect(html).not.toContain('?')
    })
  })

  // Home Phase 1 (Editorial Reading Surface) — the SAME card language
  // and layout grammar at every size, only type scale/clamp/thumbnail
  // size change; never a different component or structure.
  describe('size variants', () => {
    it('defaults to the "default" size when size is omitted', () => {
      const withDefault = renderToStaticMarkup(<BoardShelfCard dispatch={item()} />)
      const explicitDefault = renderToStaticMarkup(<BoardShelfCard dispatch={item()} size="default" />)
      expect(withDefault).toBe(explicitDefault)
    })

    it('"lead" renders a visibly larger title than "default" or "shelf"', () => {
      const lead = renderToStaticMarkup(<BoardShelfCard dispatch={item()} size="lead" />)
      const defaultSize = renderToStaticMarkup(<BoardShelfCard dispatch={item()} size="default" />)
      const shelf = renderToStaticMarkup(<BoardShelfCard dispatch={item()} size="shelf" />)
      expect(lead).toContain('text-[19px]')
      expect(defaultSize).not.toContain('text-[19px]')
      expect(shelf).not.toContain('text-[19px]')
    })

    it('every size still renders exactly the same two sibling links (identity + reader), never a different structure', () => {
      for (const size of ['lead', 'default', 'shelf', 'continue'] as const) {
        const html = renderToStaticMarkup(<BoardShelfCard dispatch={item()} size={size} />)
        expect((html.match(/<a /g) ?? []).length).toBe(2)
      }
    })

    // Home Phase 1C — Continue Reading's desktop card quality pass: more
    // room than 'shelf' (2-per-row, not 3), a 2-line title instead of a
    // hard single-line truncate, a larger thumbnail, and — unlike every
    // other size — no bg-surface-shell inset around the excerpt, so it
    // reads as editorial preview copy rather than a small form control.
    describe('"continue" size (Continue Reading shelf)', () => {
      it('still shows identity, title, and excerpt', () => {
        const html = renderToStaticMarkup(<BoardShelfCard dispatch={item()} size="continue" />)
        expect(html).toContain('Evening Quill')
        expect(html).toContain('A quiet morning ritual')
        expect(html).toContain('A short Dispatch preview line')
      })

      it('allows the title up to two lines (line-clamp-2), never a hard single-line truncate', () => {
        const html = renderToStaticMarkup(<BoardShelfCard dispatch={item()} size="continue" />)
        expect(html).toMatch(/class="[^"]*line-clamp-2[^"]*"[^>]*>A quiet morning ritual/)
      })

      it('does NOT wrap the excerpt in the bg-surface-shell inset that every other size uses', () => {
        const html = renderToStaticMarkup(<BoardShelfCard dispatch={item()} size="continue" />)
        expect(html).not.toContain('bg-surface-shell')
      })

      it('keeps Moment imagery inside the Dispatch at every size', () => {
        const continueSize = renderToStaticMarkup(<BoardShelfCard dispatch={item()} size="continue" />)
        const shelf = renderToStaticMarkup(<BoardShelfCard dispatch={item()} size="shelf" />)
        expect(continueSize).not.toContain('object-cover')
        expect(shelf).not.toContain('object-cover')
      })
    })
  })
})
