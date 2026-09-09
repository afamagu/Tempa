import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import LetterboxFilters from './letterbox-filters'

describe('LetterboxFilters', () => {
  it('renders exactly All / New / Sent — no Waiting, no Correspondences', () => {
    const html = renderToStaticMarkup(<LetterboxFilters active="all" onChange={() => {}} />)
    expect(html).toContain('>All<')
    expect(html).toContain('>New<')
    expect(html).toContain('>Sent<')
    expect(html).not.toContain('Waiting')
    expect(html).not.toContain('Correspondences')
  })

  it('marks the active tab via aria-selected, and only that one', () => {
    const html = renderToStaticMarkup(<LetterboxFilters active="new" onChange={() => {}} />)
    const selectedCount = (html.match(/aria-selected="true"/g) ?? []).length
    expect(selectedCount).toBe(1)
  })

  it('exposes a tablist for assistive tech', () => {
    const html = renderToStaticMarkup(<LetterboxFilters active="all" onChange={() => {}} />)
    expect(html).toContain('role="tablist"')
    expect((html.match(/role="tab"/g) ?? []).length).toBe(3)
  })
})
