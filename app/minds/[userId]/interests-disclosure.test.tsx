import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import InterestsDisclosure, { visibleInterests } from './interests-disclosure'

const SIX = ['Music', 'Movies', 'Food', 'Travel', 'Books', 'Hiking']
const NINE = [...SIX, 'Cooking', 'Photography', 'Chess']

describe('visibleInterests (pure)', () => {
  it('collapsed shows only the first 6', () => {
    expect(visibleInterests(NINE, false)).toEqual(SIX)
  })

  it('expanded shows every item', () => {
    expect(visibleInterests(NINE, true)).toEqual(NINE)
  })

  it('a list at or under the threshold is unaffected either way', () => {
    expect(visibleInterests(SIX, false)).toEqual(SIX)
    expect(visibleInterests(SIX, true)).toEqual(SIX)
  })
})

describe('InterestsDisclosure', () => {
  it('at or below the threshold: every item renders, no Show all control', () => {
    const html = renderToStaticMarkup(<InterestsDisclosure items={SIX} />)
    for (const item of SIX) expect(html).toContain(item)
    expect(html).not.toContain('Show all')
  })

  it('above the threshold: only the first 6 render, plus a Show all (+N) control', () => {
    const html = renderToStaticMarkup(<InterestsDisclosure items={NINE} />)
    expect(html).toContain('Music')
    expect(html).toContain('Hiking')
    expect(html).not.toContain('Cooking')
    expect(html).not.toContain('Photography')
    expect(html).not.toContain('Chess')
    expect(html).toContain('Show all (+3)')
    expect(html).toContain('aria-expanded="false"')
  })

  it('renders nothing at all for an empty list', () => {
    const html = renderToStaticMarkup(<InterestsDisclosure items={[]} />)
    expect(html).toBe('')
  })
})
