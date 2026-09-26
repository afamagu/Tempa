import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  applyQuery,
  availableViews,
  buildMarketplace,
  currentPrice,
  facetTerms,
  forYouOrder,
  isHumanLabel,
  isSendable,
  itemState,
} from './marketplace'
import { fixture, NOW } from './__tests__/marketplaceFixture'

const owned = (m: ReturnType<typeof buildMarketplace>) => ({ productIds: new Set(m.ownedProductIds), postcardKeys: new Set(m.ownedPostcardKeys) })

describe('buildMarketplace', () => {
  const m = buildMarketplace(fixture(), NOW)
  const byKey = Object.fromEntries(m.items.map((i) => [i.key, i]))
  const state = (key: string) => itemState(byKey[key], owned(m))

  it('lists published products for active Postcards; draft/unlisted products are hidden', () => {
    expect(Object.keys(byKey).sort()).toEqual(['bangkok', 'essaouira', 'harbour', 'lanterns', 'noPrice', 'retiredOwned'])
    expect(byKey.newDraft).toBeUndefined()
  })

  it('states: Complimentary, Yours (entitled), X Credits, Unavailable (no current price)', () => {
    expect(state('essaouira')).toBe('complimentary')
    expect(state('harbour')).toBe('owned')
    expect(state('lanterns')).toBe('available')
    expect(byKey.lanterns.credits).toBe(40)
    expect(state('noPrice')).toBe('unavailable')
  })

  it('an owned Postcard withdrawn from sale stays yours to send', () => {
    expect(state('retiredOwned')).toBe('owned')
    expect(isSendable(state('retiredOwned'), byKey.retiredOwned)).toBe(true)
  })

  it('sendable = Complimentary or owned; a premium Postcard you only RECEIVED is not sendable', () => {
    expect(isSendable(state('essaouira'), byKey.essaouira)).toBe(true)
    expect(isSendable(state('harbour'), byKey.harbour)).toBe(true)
    // Receiving 'lanterns' leaves no entitlement, so it is still just "available"
    expect(isSendable(state('lanterns'), byKey.lanterns)).toBe(false)
    expect(isSendable(state('noPrice'), byKey.noPrice)).toBe(false)
  })

  it('internal country-code placeholders never become labels; human labels do', () => {
    expect(byKey.essaouira.terms.map((t) => t.label)).toEqual(['Morocco', 'Calm'])
    expect(isHumanLabel('MA')).toBe(false)
    expect(isHumanLabel('NG', 'NG')).toBe(false)
    expect(isHumanLabel('Morocco', 'MA')).toBe(true)
  })

  it('preview policy is carried per product (unknown values fall back to still)', () => {
    expect(byKey.essaouira.previewPolicy).toBe('controlled_full')
    expect(byKey.harbour.previewPolicy).toBe('none')
    const odd = buildMarketplace(fixture({ products: [{ ...fixture().products![0], preview_policy: 'surprise' }] }), NOW)
    expect(odd.items.find((i) => i.key === 'essaouira')!.previewPolicy).toBe('still_only')
  })

  it('no Gifts unless a real published Gift with a current version exists', () => {
    expect(m.items.some((i) => i.kind === 'gift')).toBe(false)
    const withGift = buildMarketplace(
      fixture({
        products: [...fixture().products!, { id: 'g1', slug: 'gift-thanks', product_type: 'gift', title: 'Thanks', short_description: null, story_description: null, is_complimentary: false, postcard_key: null, preview_policy: 'still_only' }],
        prices: [...fixture().prices, { product_id: 'g1', credit_amount: 10, effective_from: '2026-09-01T00:00:00Z', effective_to: null }],
        giftVersions: [{ product_id: 'g1', title: 'Thanks', image_path: '/g.jpg', thumbnail_path: null }],
      }),
      NOW
    )
    const gift = withGift.items.find((i) => i.kind === 'gift')!
    expect(gift.key).toBe('gift-thanks')
    expect(isSendable(itemState(gift, owned(withGift)), gift)).toBe(false)
    const noVersion = buildMarketplace(fixture({ products: [...fixture().products!, { id: 'g2', slug: 'g2', product_type: 'gift', title: 'x', short_description: null, story_description: null, is_complimentary: false, postcard_key: null, preview_policy: 'still_only' }] }), NOW)
    expect(noVersion.items.some((i) => i.kind === 'gift')).toBe(false)
  })

  it('degraded mode (commerce unreadable): the active catalogue as before, no labels, nothing unlockable', () => {
    const d = buildMarketplace(fixture({ products: null, context: { spendEnabled: true, giftsEnabled: true, checkoutEnabled: false, balance: 5 } }), NOW)
    expect(d.degraded).toBe(true)
    expect(d.items).toHaveLength(7)
    expect(d.context.spendEnabled).toBe(false)
    expect(d.items.every((i) => itemState(i, owned(d)) === 'unknown' && isSendable('unknown', i))).toBe(true)
  })
})

describe('prices', () => {
  const row = (from: string, to: string | null, amount = 10) => ({ product_id: 'p', credit_amount: amount, effective_from: from, effective_to: to })
  it('only the one window containing now counts; expired, future or ambiguous fail closed', () => {
    expect(currentPrice([row('2026-09-01T00:00:00Z', null, 40)], 'p', NOW)).toBe(40)
    expect(currentPrice([row('2026-09-01T00:00:00Z', '2026-09-30T00:00:00Z')], 'p', NOW)).toBeNull()
    expect(currentPrice([row('2026-11-01T00:00:00Z', null)], 'p', NOW)).toBeNull()
    expect(currentPrice([row('2026-09-01T00:00:00Z', null), row('2026-09-15T00:00:00Z', null)], 'p', NOW)).toBeNull()
  })
})

describe('discovery', () => {
  const m = buildMarketplace(fixture(), NOW)
  const listed = m.items.filter((i) => itemState(i, owned(m)) !== 'unavailable')

  it('views are facets, not containers — one Postcard can appear in several; empty views are hidden', () => {
    expect(availableViews(listed)).toEqual(['for_you', 'countries', 'moods', 'occasions', 'complimentary'])
    expect(applyQuery(listed, { view: 'moods', term: 'calm', search: '' }).map((i) => i.key).sort()).toEqual(['essaouira', 'lanterns'])
    expect(applyQuery(listed, { view: 'occasions', term: null, search: '' }).map((i) => i.key)).toEqual(['lanterns'])
    expect(facetTerms(listed, 'world')).toEqual([])
    expect(availableViews([])).toEqual([])
  })

  it('Countries uses human labels only (the "MA" placeholder is not a term)', () => {
    expect(facetTerms(listed, 'place')).toEqual([{ slug: 'morocco', label: 'Morocco', count: 1 }])
  })

  it('search matches title, collection, place, mood, occasion, description and aliases/tags — every word must match', () => {
    const find = (search: string) => applyQuery(listed, { view: 'for_you', term: null, search }).map((i) => i.key).sort()
    expect(find('maghreb')).toEqual(['essaouira'])
    expect(find('monsoon')).toEqual(['bangkok'])
    expect(find('festival')).toEqual(['lanterns'])
    expect(find('celebration')).toEqual(['lanterns'])
    expect(find('harbour collection')).toEqual(['harbour'])
    expect(find('calm morocco')).toEqual(['essaouira'])
    expect(find('zzz')).toEqual([])
  })

  it('Complimentary view lists only Complimentary Postcards', () => {
    expect(applyQuery(listed, { view: 'complimentary', term: null, search: '' }).map((i) => i.key).sort()).toEqual(['bangkok', 'essaouira'])
  })

  it('Featured is editorial/default ordering — featured collections first, then by title', () => {
    expect(forYouOrder(listed).map((i) => i.key)).toEqual(['lanterns', 'bangkok', 'essaouira', 'harbour', 'retiredOwned'])
  })

  it('Featured never reads private content: the marketplace module queries no Letters, Moments or profiles', () => {
    const src = readFileSync(path.join(__dirname, 'marketplace.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    expect(src).not.toMatch(/from\('(letters|letter_postcards|moments|profiles|correspondences|dispatches)/)
    expect(src).not.toMatch(/get_my_postcards/)
    // explicit catalogue columns only — never internal ones
    expect(src).not.toMatch(/rights_review|metadata|created_by|idempotency_key|select\('\*'\)/)
  })
})
