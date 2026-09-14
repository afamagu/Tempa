import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import KeepsakesEmptyState from './keepsakes-empty-state'

// Release Polish Pass — a restrained, intentional empty state,
// replacing a lone line of text on an otherwise enormous blank canvas.
describe('KeepsakesEmptyState', () => {
  it('shows the specified restrained copy', () => {
    const html = renderToStaticMarkup(<KeepsakesEmptyState />)
    expect(html).toContain('No Postcards here yet.')
    expect(html).toContain('When someone sends you one, it will appear here after it arrives.')
  })

  it('renders a small line-art motif, not a photo/placeholder image', () => {
    const html = renderToStaticMarkup(<KeepsakesEmptyState />)
    expect(html).toContain('<svg')
    expect(html).not.toContain('<img')
  })

  it('never introduces gamification, rarity, counters, or purchase language', () => {
    const html = renderToStaticMarkup(<KeepsakesEmptyState />)
    const lower = html.toLowerCase()
    expect(lower).not.toMatch(/rarity|points|purchase|buy|collect\b|progress|unlock/)
  })
})
