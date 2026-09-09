import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import RecommendedMindCard from './recommended-mind-card'

describe('RecommendedMindCard', () => {
  it('Mindform + pseudonym + demographics are ONE link to the public profile route', () => {
    const html = renderToStaticMarkup(
      <RecommendedMindCard
        mind={{ userId: 'user-1', pseudonym: 'Evening Quill', country: 'South Africa', genderDisplay: 'Woman', ageRange: '25-34' }}
      />
    )
    // Exactly one anchor, and everything (name + demographics) lives
    // inside it — never split into a separate avatar link and text link.
    const anchorCount = (html.match(/<a /g) ?? []).length
    expect(anchorCount).toBe(1)
    expect(html).toContain('href="/minds/user-1"')
    expect(html).toContain('Evening Quill')
    expect(html).toContain('South Africa')
  })

  it('never links to the Minds tutorial, Discover Minds, or a write composer', () => {
    const html = renderToStaticMarkup(
      <RecommendedMindCard
        mind={{ userId: 'user-2', pseudonym: 'Saint Nico', country: 'United States', genderDisplay: null, ageRange: '35-44' }}
      />
    )
    expect(html).not.toContain('/write/')
    expect(html).not.toContain('view=answer')
  })
})
