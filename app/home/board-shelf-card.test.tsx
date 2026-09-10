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

  it('renders an optional Moment thumbnail only when supplied, as a small fixed-size image', () => {
    const withThumb = renderToStaticMarkup(
      <BoardShelfCard dispatch={item()} thumbnailUrl="https://example.com/a.jpg" />
    )
    const without = renderToStaticMarkup(<BoardShelfCard dispatch={item()} />)
    expect(withThumb).toContain('<img')
    expect(without).not.toContain('<img')
    // Board usability checkpoint: the image must never dominate the
    // card — a small, fixed h-14 w-14 tile, not a large/hero image.
    expect(withThumb).toMatch(/<img[^>]*class="[^"]*h-14 w-14[^"]*"/)
  })

  // Visual-fidelity pass (2026-09-10): the Moment discovery hint is an
  // opened-Dispatch education treatment (see app/board/moment-hint.tsx)
  // — it must never appear on a listing card.
  it('never renders the Moment discovery hint on a listing card', () => {
    const html = renderToStaticMarkup(<BoardShelfCard dispatch={item()} thumbnailUrl="https://example.com/a.jpg" />)
    expect(html).not.toContain('A glimpse from the writer')
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

  it('renders a country flag beside the pseudonym when the author has a country recorded', () => {
    const html = renderToStaticMarkup(<BoardShelfCard dispatch={item({ authorCountry: 'Japan' })} />)
    expect(html).toContain('src="/flags/JP.svg"')
  })

  it('renders no flag when the author has no country recorded', () => {
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
})
