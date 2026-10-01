import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DispatchCard from './dispatch-card'
import { resolveDispatchIdentity } from '@/lib/dispatch-identity'
import type { DispatchListItem } from '@/lib/dispatches'
function card(country: string | null = 'United Kingdom', editorial = true) {
  const identity = resolveDispatchIdentity({publishedAs:'member',authorId:'house',authorPseudonym:'Lady Larkspur',authorCountry:country,authorEditorialTitle:editorial?'Tempa House Columnist':null})
  const dispatch: DispatchListItem = {id:'d',authorId:'house',authorPseudonym:'Lady Larkspur',authorCountry:country,title:'A Sunday observation',body:'Tea and quiet company.',topics:[],publishedAs:'member',moderationStatus:'visible',publishedAt:'2026-09-30T12:00:00Z',identity}
  return renderToStaticMarkup(<DispatchCard dispatch={dispatch} keepSlot={<button>Keep Lady Larkspur</button>} />)
}
describe('editorial Board header', () => {
  it('puts the byline and dateline after the name/Keep row, before the excerpt', () => {
    const html=card()
    expect(html).toContain('data-editorial-card-header')
    expect(html.indexOf('Keep Lady Larkspur')).toBeLessThan(html.indexOf('Tempa House Columnist'))
    expect(html.indexOf('Tempa House Columnist')).toBeLessThan(html.indexOf('United Kingdom'))
    expect(html.indexOf('United Kingdom')).toBeLessThan(html.indexOf('<time'))
    expect(html.indexOf('<time')).toBeLessThan(html.indexOf('A Sunday observation'))
  })
  it('shows one complete byline and keeps the date together', () => {
    const html=card()
    expect(html.match(/Tempa House Columnist/g)).toHaveLength(1)
    expect(html).toMatch(/<time class="shrink-0 whitespace-nowrap" dateTime="2026-09-30T12:00:00Z">Sep 30, 2026<\/time>/)
  })
  it('keeps the separator outside the country truncation', () => {
    expect(card()).toMatch(/United Kingdom<\/span><span class="shrink-0" aria-hidden="true">·<\/span><time/)
  })
  it('omits the separator cleanly without a country', () => {
    const html=card(null)
    expect(html).not.toContain('aria-hidden="true">·')
    expect(html).toContain('Sep 30, 2026')
  })
  it('preserves the ordinary member header and separate profile/reader links', () => {
    const html=card('Kenya', false)
    expect(html).not.toContain('data-editorial-card-header')
    expect(html).not.toContain('Tempa House Columnist')
    expect(html).toContain('href="/minds/house"')
    expect(html).toContain('href="/board/d"')
  })
})
