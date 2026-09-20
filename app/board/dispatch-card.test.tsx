import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DispatchCard from './dispatch-card'
import type { DispatchListItem } from '@/lib/dispatches'

function item(overrides: Partial<DispatchListItem> = {}): DispatchListItem {
  return {
    id: 'd-1',
    authorId: 'author-1',
    authorPseudonym: 'Evening Quill',
    authorCountry: null,
    title: 'A quiet morning ritual',
    body: 'A short Dispatch to whoever finds it, longer than one line so the excerpt has something to clamp.',
    publishedAt: '2026-09-07T12:00:00Z',
    moderationStatus: 'visible',
    topics: [],
    ...overrides,
  }
}

describe('DispatchCard', () => {
  it('links to the Dispatch reader, not the profile, from the card itself', () => {
    const html = renderToStaticMarkup(<DispatchCard dispatch={item()} />)
    expect(html).toContain('href="/board/d-1"')
  })

  it('shows the title, author pseudonym, and topics', () => {
    const html = renderToStaticMarkup(<DispatchCard dispatch={item({ topics: ['ritual', 'memory'] })} />)
    expect(html).toContain('A quiet morning ritual')
    expect(html).toContain('Evening Quill')
    expect(html).toContain('ritual')
    expect(html).toContain('memory')
  })

  it('7. never renders like/reaction/comment/view-count/follower chrome', () => {
    const html = renderToStaticMarkup(<DispatchCard dispatch={item()} />)
    const lower = html.toLowerCase()
    expect(lower).not.toContain('like')
    expect(lower).not.toContain('follow')
    expect(lower).not.toContain('comment')
    // Not a bare "view" substring check — the Mindform placeholder's
    // own SVG viewBox attribute lowercases to "viewbox", a false
    // positive with nothing to do with a view-count feature.
    expect(lower).not.toMatch(/\bviews?\b|\bviewed\b|\bviewer\b|view count/)
  })

  it('renders an optional keep slot when supplied', () => {
    const html = renderToStaticMarkup(<DispatchCard dispatch={item()} keepSlot={<span>Keep slot marker</span>} />)
    expect(html).toContain('Keep slot marker')
  })

  // Board usability visual follow-up (2026-09-09).
  it('wraps only the excerpt in the shared bg-surface-shell authored-paper surface', () => {
    const html = renderToStaticMarkup(<DispatchCard dispatch={item()} />)
    expect(html).toMatch(/class="[^"]*bg-surface-shell[^"]*"[^>]*>[\s\S]*A short Dispatch to whoever/)
    expect((html.match(/bg-surface-shell/g) ?? []).length).toBe(1)
  })

  it('is its own bordered, rounded card — not a flush divide-y row — so distinct posts read as separate pieces', () => {
    const html = renderToStaticMarkup(<DispatchCard dispatch={item()} />)
    expect(html).toMatch(/^<div class="[^"]*rounded-md[^"]*border[^"]*"/)
    expect(html).not.toContain('divide-y')
  })

  it('renders a country name beside the pseudonym when the author has a country recorded', () => {
    const html = renderToStaticMarkup(<DispatchCard dispatch={item({ authorCountry: 'France' })} />)
    expect(html).toContain('France')
    expect(html).not.toContain('/flags/')
  })

  it('renders no country label, with no broken spacing, when none is recorded', () => {
    const html = renderToStaticMarkup(<DispatchCard dispatch={item({ authorCountry: null })} />)
    expect(html).not.toMatch(/aria-label="Country:/)
  })

  it('keeps Moment imagery inside the Dispatch instead of competing with the author Mark', () => {
    const html = renderToStaticMarkup(<DispatchCard dispatch={item()} />)
    expect(html).not.toContain('object-cover')
  })

  // Board live-test corrections (2026-09-10): Keep must sit only in the
  // identity row, never inside the same flex row as the title/excerpt —
  // a live-test report found the previous layout let Keep's width
  // influence the excerpt column. Proven here by DOM order: the keep
  // slot appears before the title in the rendered markup, and outside
  // the reader Link entirely.
  // Visual-fidelity pass (2026-09-10): the Moment discovery hint is an
  // opened-Dispatch education treatment (see app/board/moment-hint.tsx)
  // — it must never appear on a listing card.
  it('never renders the Moment discovery hint on a listing card', () => {
    const html = renderToStaticMarkup(<DispatchCard dispatch={item()} />)
    expect(html).not.toContain('Little glimpses from the writer')
  })

  // Live-test regression (Checkpoint 1C, §7): the Board card's author
  // pseudonym must itself link to /minds/[authorId] — previously
  // inert text, requiring a member to open the Dispatch first and click
  // the author there instead.
  it('the author pseudonym links to their profile', () => {
    const html = renderToStaticMarkup(<DispatchCard dispatch={item()} />)
    expect(html).toMatch(/<a[^>]*href="\/minds\/author-1"[^>]*>[\s\S]*Evening Quill[\s\S]*<\/a>/)
  })

  it('never nests the profile link inside the Dispatch-reader link — two sibling anchors, not one inside the other', () => {
    const html = renderToStaticMarkup(<DispatchCard dispatch={item()} />)
    // The profile link must close (</a>) before the reader Link opens.
    const profileLinkEnd = html.indexOf('</a>', html.indexOf('href="/minds/author-1"'))
    const readerLinkStart = html.indexOf('href="/board/d-1"')
    expect(profileLinkEnd).toBeGreaterThan(-1)
    expect(profileLinkEnd).toBeLessThan(readerLinkStart)
  })

  it('places the keep slot in the identity row, before the title/excerpt block and outside the reader link', () => {
    const html = renderToStaticMarkup(
      <DispatchCard dispatch={item()} keepSlot={<span data-testid="keep-marker">Keep slot marker</span>} />
    )
    const keepIndex = html.indexOf('Keep slot marker')
    const titleIndex = html.indexOf('A quiet morning ritual')
    const linkIndex = html.indexOf('href="/board/d-1"')
    expect(keepIndex).toBeGreaterThan(-1)
    expect(keepIndex).toBeLessThan(titleIndex)
    expect(keepIndex).toBeLessThan(linkIndex)
  })

  // Home Phase 1 (Reading Trail) — trailQuery is purely additive: when
  // present, it's appended as the link's own query string; when absent
  // (a search result — see app/board/page.tsx), the href stays bare,
  // exactly matching the "no trail manufactured" requirement.
  describe('Reading Trail — trailQuery', () => {
    it('appends the trail query string to the Dispatch link when supplied', () => {
      const html = renderToStaticMarkup(
        <DispatchCard dispatch={item()} trailQuery="s=2026-09-01T00%3A00%3A00Z&seed=abc&tier=2&aseq=1&shash=99" />
      )
      expect(html).toContain('href="/board/d-1?s=2026-09-01T00%3A00%3A00Z&amp;seed=abc&amp;tier=2&amp;aseq=1&amp;shash=99"')
    })

    it('omits the query string entirely when trailQuery is not supplied — a bare href, no trail manufactured', () => {
      const html = renderToStaticMarkup(<DispatchCard dispatch={item()} />)
      expect(html).toContain('href="/board/d-1"')
      expect(html).not.toContain('?')
    })
  })
})
