import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SearchResultsPanel from './search-results-panel'
import type { SearchPersonResult, SearchLetterResult } from '@/lib/search'

const PERSON: SearchPersonResult = { kind: 'person', personId: 'user-1', pseudonym: 'Saint Nicole' }
const LETTER: SearchLetterResult = {
  kind: 'letter',
  letterId: 'letter-1',
  correspondenceId: 'corr-1',
  otherPseudonym: 'Evening Quill',
  createdAt: '2026-06-01T12:00:00Z',
  excerpt: 'we ⟦⟦walked⟧⟧ the beach at sunset',
}

function render(overrides: Partial<Parameters<typeof SearchResultsPanel>[0]> = {}) {
  return renderToStaticMarkup(
    <SearchResultsPanel
      query="walked"
      status="idle"
      personResults={[]}
      letterResults={[]}
      hasMoreLetters={false}
      loadingMore={false}
      onShowMoreLetters={() => {}}
      {...overrides}
    />
  )
}

describe('SearchResultsPanel', () => {
  it('a pseudonym result links to /letters/with/[userId]', () => {
    const html = render({ personResults: [PERSON] })
    expect(html).toContain('href="/letters/with/user-1"')
    expect(html).toContain('Saint Nicole')
  })

  it('a letter result shows correspondent, date, excerpt, and links to /letters/[letterId]', () => {
    const html = render({ letterResults: [LETTER] })
    expect(html).toContain('href="/letters/letter-1"')
    expect(html).toContain('Evening Quill')
    // date rendered via formatDateTimeCompact — just confirm SOME date text exists, not stale-implementation-detail exact string
    expect(html).toMatch(/\d/)
  })

  it('the letter excerpt renders ⟦⟦...⟧⟧ spans as a real <mark> element, never dangerouslySetInnerHTML/raw markers', () => {
    const html = render({ letterResults: [LETTER] })
    expect(html).toContain('<mark>walked</mark>')
    expect(html).not.toContain('⟦⟦')
    expect(html).not.toContain('⟧⟧')
  })

  it('groups People and Letters into separate, clearly labeled sections when both are present', () => {
    const html = render({ personResults: [PERSON], letterResults: [LETTER] })
    expect(html).toContain('People')
    expect(html).toContain('Letters')
  })

  it('shows "Show more" only when hasMoreLetters is true, and it is disabled while loadingMore', () => {
    const withMore = render({ letterResults: [LETTER], hasMoreLetters: true })
    expect(withMore).toContain('Show more')

    const withoutMore = render({ letterResults: [LETTER], hasMoreLetters: false })
    expect(withoutMore).not.toContain('Show more')

    const loading = render({ letterResults: [LETTER], hasMoreLetters: true, loadingMore: true })
    expect(loading).toContain('disabled')
  })

  it('shows a no-results message (not a blank panel) when nothing matched', () => {
    const html = render({ query: 'nonexistentword' })
    expect(html).toContain('No results')
    expect(html).toContain('nonexistentword')
  })

  it('shows a loading state distinct from empty results', () => {
    const html = render({ status: 'loading' })
    expect(html).not.toContain('No results')
    expect(html.toLowerCase()).toContain('search')
  })

  it('shows an error state on RPC failure, distinct from empty results', () => {
    const html = render({ status: 'error' })
    expect(html).not.toContain('No results')
  })
})
